// KAN-196 (Freeze-Korrektur durch die Betriebsleitung, Bedienoberfläche) und KAN-197 (Prüfbericht Altanträge), 06.10.2026
//
// Aufruf:  npm run -s test:csv   (alle scripts/tests/*.test.mjs)
//
// 1. korrekturAenderungen: nur geänderte Felder, Typen (Zahl mit Komma, Datum nicht in der Zukunft, Auswahl), Pflicht,
//    Stimmigkeit des Prüfnummernantrags (Einreichdatum, Zugeteilt mit Nummer und Bescheid), Entzug nur über den Statuswechsel.
// 2. Server Action: Reihenfolge der Prüfungen (Seitenbetrieb, Schreibsperre, Betriebsleitung), nur bekannte Tabellen,
//    Aufruf der RPC; Seite zeigt den Baustein nur der Betriebsleitung.
// 3. altantragBefunde: Zugeteilt ohne Nummer/Bescheid, Einreichdatum fehlt, Bescheid vor Einreichung, ohne Charge,
//    Zugang nach Einreichung, Mengenregel; Endstatus ohne Regelprüfung.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { hooksRegistrieren, laden, nurMitHooks } from './buchung-attrappe.mjs'

hooksRegistrieren()
const quelle = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const HEUTE = '2026-10-06'

describe('KAN-196: Korrektur trotz Sperre', nurMitHooks, () => {
  const alt = { status: 'eingereicht', pruefnummer: null, eingereicht_am: '2026-09-01', bescheid_am: null, bezeichnung: 'GV DAC', menge_liter: 1000, jahrgang: 2025 }
  test('nur echte Änderungen, Zahl mit Komma, Datum als Tag', async () => {
    const k = await laden('lib/freeze/korrektur.ts')
    assert.deepEqual(k.korrekturAenderungen('dac_antrag', alt, { menge_liter: '1000', bezeichnung: 'GV DAC', antragsnummer: ' A-17 ' }, HEUTE), { werte: { antragsnummer: 'A-17' } })
    assert.deepEqual(k.korrekturAenderungen('dac_antrag', alt, { menge_liter: '1.250,5', eingereicht_am: '2026-09-02' }, HEUTE),
      { werte: { menge_liter: 1250.5, eingereicht_am: '2026-09-02' } })
    assert.match(k.korrekturAenderungen('dac_antrag', alt, { bezeichnung: 'GV DAC' }, HEUTE).fehler, /Keine Änderung/)
  })
  test('Typ- und Pflichtfehler, unbekannte Tabelle', async () => {
    const k = await laden('lib/freeze/korrektur.ts')
    assert.match(k.korrekturAenderungen('dac_antrag', alt, { menge_liter: 'viel' }, HEUTE).fehler, /Zahl/)
    assert.match(k.korrekturAenderungen('dac_antrag', alt, { eingereicht_am: '2026-10-07' }, HEUTE).fehler, /Zukunft/)
    assert.match(k.korrekturAenderungen('dac_antrag', alt, { status: 'fertig' }, HEUTE).fehler, /ungültiger Wert/)
    assert.match(k.korrekturAenderungen('dac_antrag', alt, { bezeichnung: ' ' }, HEUTE).fehler, /darf nicht leer/)
    assert.match(k.korrekturAenderungen('kontakte', {}, { name: 'x' }, HEUTE).fehler, /keine Korrektur/)   // KAN-222: fuellungen ist jetzt korrigierbar
    assert.equal(k.korrekturGrundFehler('zu kurz'), 'Bitte einen Grund für die Korrektur angeben (mindestens 10 Zeichen).')
    assert.equal(k.korrekturGrundFehler('versehentlich eingereicht'), null)
  })
  test('Prüfnummernantrag: Status zurück auf Entwurf, Zugeteilt nur mit Nummer und Bescheid, Entzug nur per Statuswechsel', async () => {
    const k = await laden('lib/freeze/korrektur.ts')
    // versehentlich eingereicht → Entwurf: Einreichdatum muss mit
    assert.match(k.korrekturAenderungen('dac_antrag', alt, { status: 'entwurf' }, HEUTE).fehler, /kein Einreichdatum/)
    assert.deepEqual(k.korrekturAenderungen('dac_antrag', alt, { status: 'entwurf', eingereicht_am: '' }, HEUTE), { werte: { status: 'entwurf', eingereicht_am: null } })
    assert.match(k.korrekturAenderungen('dac_antrag', alt, { status: 'genehmigt' }, HEUTE).fehler, /fehlt die Prüfnummer/)
    assert.match(k.korrekturAenderungen('dac_antrag', alt, { status: 'genehmigt', pruefnummer: 'N 1/26' }, HEUTE).fehler, /Bescheiddatum/)
    assert.match(k.korrekturAenderungen('dac_antrag', alt, { status: 'genehmigt', pruefnummer: 'N 1/26', bescheid_am: '2026-08-01' }, HEUTE).fehler, /vor der Einreichung/)
    assert.ok('werte' in k.korrekturAenderungen('dac_antrag', alt, { status: 'genehmigt', pruefnummer: 'N 1/26', bescheid_am: '2026-09-20' }, HEUTE))
    assert.match(k.korrekturAenderungen('dac_antrag', alt, { status: 'entzogen' }, HEUTE).fehler, /Statuswechsel/)
    assert.match(k.korrekturAenderungen('dac_antrag', { ...alt, status: 'entzogen' }, { status: 'genehmigt' }, HEUTE).fehler, /Statuswechsel/)
    // die Charge eines Antrags ist nicht korrigierbar (Gültigkeit je Charge, KAN-99)
    assert.ok(!k.KORREKTUR_FELDER.dac_antrag.some(f => f.spalte === 'weinausbau_id'))
  })
  test('Server Action: Seitenbetrieb und Schreibsperre vor der Rolle, RPC mit Grund, nur Betriebsleitung auf der Seite', () => {
    const a = quelle('src/app/(dashboard)/freeze-korrektur-actions.ts')
    const i = (s) => a.indexOf(s)
    assert.ok(i('pruefeSeitenBetrieb(membership.tenantId)') > 0)
    assert.ok(i('pruefeSeitenBetrieb(membership.tenantId)') < i('pruefeSchreibzugriff(membership)'))
    assert.ok(i('pruefeSchreibzugriff(membership)') < i('canAdmin(membership.role)'))
    assert.ok(i('korrekturAenderungen(') < i("rpc as any)('s112_freeze_korrektur'"))
    assert.match(a, /\.eq\('id', id\)\.eq\('tenant_id', membership\.tenantId\)/)
    const p = quelle('src/app/(dashboard)/dac/[id]/page.tsx')
    assert.match(p, /const korrektur = !!membership && canAdmin\(membership\.role\) && !dac\.storniert_am && dac\.status !== 'entwurf'/)
    assert.match(p, /\{korrektur && \(\n\s+<div className="mt-4">\n\s+<FreezeKorrektur tabelle="dac_antrag"/)
  })
})

describe('KAN-197: Prüfbericht Altanträge', nurMitHooks, () => {
  const daten = (x = {}) => ({
    chargeId: 'C1', bestandLiter: 800, bestandAm: HEUTE, zugaenge: [], abfuellungen: [], tankverkaeufe: [],
    antraege: [{ id: 'A1', status: 'eingereicht', aktiv: true, pruefnummer: null, mengeLiter: 1000, eingereichtAm: '2026-09-01', bescheidAm: null, angelegtAm: '2026-08-30' }],
    ...x,
  })
  const antrag = (x = {}) => ({ id: 'A1', status: 'eingereicht', pruefnummer: null, eingereicht_am: '2026-09-01', bescheid_am: null, weinausbau_id: 'C1', ...x })
  test('unauffällig bzw. Formfehler', async () => {
    const { altantragBefunde } = await laden('lib/dac/altantraege.ts')
    assert.deepEqual(altantragBefunde(antrag(), daten(), HEUTE), [])
    const b = altantragBefunde(antrag({ status: 'genehmigt', eingereicht_am: null }), daten(), HEUTE)
    assert.deepEqual(b.slice(0, 3), ['„Zugeteilt“, aber keine Prüfnummer erfasst.', '„Zugeteilt“, aber kein Bescheiddatum erfasst.', 'Einreichdatum fehlt – Zugänge in die Charge lassen sich nicht sicher prüfen.'])
    assert.match(altantragBefunde(antrag({ bescheid_am: '2026-08-15' }), daten(), HEUTE)[0], /Bescheid \(15\.08\.2026\) liegt vor der Einreichung \(01\.09\.2026\)/)
    assert.deepEqual(altantragBefunde(antrag({ weinausbau_id: null }), null, HEUTE), ['Keiner Charge zugeordnet – Zugänge und Menge nicht prüfbar.'])
  })
  test('Zugang nach der Einreichung und Mengenregel; Endstatus ohne Regelprüfung', async () => {
    const { altantragBefunde } = await laden('lib/dac/altantraege.ts')
    const mitVerschnitt = daten({ zugaenge: [{ art: 'verschnitt', datum: '2026-09-10' }] })
    assert.match(altantragBefunde(antrag(), mitVerschnitt, HEUTE)[0], /^Wein passt nicht mehr zum Antrag: Verschnitt am 10\.09\.2026/)
    const zuViel = daten({ bestandLiter: 1200 })
    assert.match(altantragBefunde(antrag(), zuViel, HEUTE)[0], /^Bestand 1\.200,00 l größer als beantragt 1\.000,00 l/)
    assert.deepEqual(altantragBefunde(antrag({ status: 'erloschen' }), mitVerschnitt, HEUTE), [])
  })
  test('Seite: Bericht nur für die Betriebsleitung, Altantrag = ohne Ereignis', () => {
    const p = quelle('src/app/(dashboard)/dac/page.tsx')
    assert.match(p, /if \(tenantId && role && canAdmin\(role\)\) \{\n\s+try \{ altantraege = await ladeAltantragPruefung\(/)
    const l = quelle('src/lib/dac/altantraege.ts')
    assert.match(l, /\.neq\('status', 'entwurf'\)/)
    assert.match(l, /const alt = aRes\.data\.filter\(a => !mitEreignis\.has\(String\(a\.id\)\)\)/)
  })
})
