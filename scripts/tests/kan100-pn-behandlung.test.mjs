// KAN-100 (04.10.2026): Warnung „Prüfnummer wird entzogen“ – alle Auslöser inkl. Kellerbehandlungen und Abstufung.
// Entscheidungen Jörgen: Säurekorrektur u. Ä. (pn_wirkung 'veraenderung') beenden die Gültigkeit mit Rückfrage,
// Pflege-Typen nicht, nicht eingestufte Typen warnen nur; nach einer Abstufung erlischt die Nummer für den Tankbestand.
// Demo-Szenario Musterhof „Riesling Ried Pfaffenberg“ (N 10716/26): Säurekorrektur nach dem Bescheid.
//
// Aufruf:  npm run -s test:csv   bzw. node --experimental-strip-types --test scripts/tests/kan100-pn-behandlung.test.mjs

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import * as pn from '../../src/lib/kellerbuch/pruefnummer.ts'
import * as w from '../../src/lib/kellerbuch/pnWirkung.ts'

const WURZEL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const quelle = rel => readFileSync(path.join(WURZEL, rel), 'utf8').replace(/\r\n/g, '\n')

const CH = '33333333-3333-4333-8333-000b00000012'   // Riesling Ried Pfaffenberg (Demo Musterhof)
const PN = 'N 10716/26'
const antrag = teil => ({
  id: 'd1', weinausbauId: CH, status: 'genehmigt', aktiv: true, pruefnummer: PN, mengeLiter: 5000,
  eingereichtAm: '2026-05-20', bescheidAm: '2026-06-08', angelegtAm: '2026-05-20', bezeichnung: 'Riesling Ried Pfaffenberg 2025', ...teil,
})
const daten = teil => ({
  chargeId: CH, bestandLiter: 500, bestandAm: '2026-10-04', antraege: [antrag()],
  zugaenge: [], abfuellungen: [{ datum: '2026-06-20', liter: 4500, dacAntragId: 'd1' }], ...teil,
})
const ziel = (d = daten()) => [{ daten: d, name: 'Riesling Ried Pfaffenberg' }]

describe('KAN-100 Pfaffenberg: Säurekorrektur nach dem Bescheid', () => {
  test('Rückfrage mit Nummer und Menge, Vermerk am Vorgang', () => {
    const e = pn.pruefnummernSchaden('behandlung', ziel(), '2026-10-04')
    assert.equal(e.ablehnung, null)
    assert.deepEqual(e.schaeden, [{ chargeId: CH, name: 'Riesling Ried Pfaffenberg', pruefnummer: PN, bestandLiter: 500 }])
    assert.equal(pn.pruefnummernSchadenFrage(e.schaeden),
      'Die Prüfnummer N 10716/26 gilt für den Tankbestand der Charge „Riesling Ried Pfaffenberg“ (500 L) nicht mehr – bereits abgefüllte Flaschen behalten sie. Fortfahren?')
    assert.equal(pn.pruefnummernSchadenNotiz(e.schaeden), 'PN N 10716/26 für Tankbestand erloschen')
  })
  test('danach (Ende laut pruefnummer_chargen bzw. Behandlung als Zugang): Nummer gilt nicht, Hinweis nennt die Behandlung', () => {
    const nachEnde = pn.pruefnummerGueltig(daten({ antraege: [antrag({ gueltigBis: '2026-10-04', endeArt: 'behandlung' })] }), '2026-10-05')
    assert.equal(nachEnde.gueltig, false)
    assert.equal(nachEnde.grund, 'behandlung')
    const alsZugang = pn.pruefnummerGueltig(daten({ zugaenge: [{ art: 'behandlung', datum: '2026-10-04' }] }), '2026-10-04')
    assert.equal(alsZugang.gueltig, false)
    assert.equal(alsZugang.grund, 'behandlung')
    assert.equal(pn.pruefnummerHinweis(alsZugang),
      'Frühere Prüfnummer N 10716/26 gilt nicht für den aktuellen Bestand: Kellerbehandlung, die den Wein verändert, am 04.10.2026 (§ 25 Abs. 6 WeinG).')
  })
  test('Antrag eingereicht → Ablehnung mit passendem Satz', () => {
    const d = daten({ antraege: [antrag({ status: 'eingereicht', pruefnummer: null, bescheidAm: null })] })
    const e = pn.pruefnummernSchaden('behandlung', ziel(d), '2026-10-04')
    assert.match(e.ablehnung, /Eine Kellerbehandlung, die den Wein verändert, zwischen Antrag und Bescheid ist nicht zulässig – der Antrag würde ungültig und müsste neu gestellt werden \(§ 25 Abs\. 6 WeinG\)\. /)
  })
  test('bestehende Texte unverändert (Verschnitt)', () => {
    const d = daten({ antraege: [antrag({ status: 'in_pruefung', pruefnummer: null, bescheidAm: null })] })
    assert.match(pn.pruefnummernSchaden('verschnitt', ziel(d), '2026-10-04').ablehnung, /Ein Verschnitt zwischen Antrag und Bescheid ist nicht zulässig .*\(§ 25 Abs\. 6 WeinG\)\. /)
  })
})

describe('KAN-100 Abstufung', () => {
  test('Rückfrage vor der Abstufung einer Charge mit geltender Nummer', () => {
    const e = pn.pruefnummernSchaden('abstufung', ziel(), '2026-10-04')
    assert.equal(e.schaeden.length, 1)
  })
  test('eingereichter Antrag → Ablehnung ohne Verweis auf § 25 Abs. 6', () => {
    const d = daten({ antraege: [antrag({ status: 'eingereicht', pruefnummer: null, bescheidAm: null })] })
    const a = pn.pruefnummernSchaden('abstufung', ziel(d), '2026-10-04').ablehnung
    assert.match(a, /Eine Abstufung bzw\. andere Bezeichnung der Charge zwischen Antrag und Bescheid ist nicht zulässig – der Antrag würde ungültig und müsste neu gestellt werden\. /)
    assert.doesNotMatch(a, /§ 25/)
  })
  test('Hinweis nach der Abstufung', () => {
    const e = pn.pruefnummerGueltig(daten({ antraege: [antrag({ gueltigBis: '2026-10-04', endeArt: 'abstufung' })] }), '2026-10-05')
    assert.equal(e.grund, 'abstufung')
    assert.equal(pn.pruefnummerHinweis(e),
      'Frühere Prüfnummer N 10716/26 gilt nicht für den aktuellen Bestand: Abstufung bzw. geänderte Bezeichnung der Charge am 04.10.2026.')
  })
  test('ohne geltende Nummer keine Rückfrage', () => {
    assert.deepEqual(pn.pruefnummernSchaden('abstufung', ziel(daten({ antraege: [] })), '2026-10-04').schaeden, [])
  })
})

describe('KAN-100 Einstufung der Behandlungstypen', () => {
  test('drei Werte, Unbekanntes wird „unklar“', () => {
    assert.deepEqual([...w.PN_WIRKUNGEN], ['pflege', 'veraenderung', 'unklar'])
    assert.equal(w.pnWirkungAus('veraenderung'), 'veraenderung')
    assert.equal(w.pnWirkungAus('egal'), 'unklar')
    assert.equal(w.pnWirkungAus(undefined), 'unklar')
  })
  test('Hinweis bei nicht eingestuftem Typ nennt den Typ', () => {
    assert.match(w.pnWirkungUnklarHinweis('Gummiarabikum'), /^Der Behandlungstyp „Gummiarabikum“ ist für die Prüfnummer nicht eingestuft\./)
  })
})

describe('KAN-100 Verdrahtung', () => {
  const act = quelle('src/app/(dashboard)/kellerbuch/actions.ts')
  const seite = quelle('src/app/(dashboard)/kellerbuch/behaelter/[id]/behandlungen/page.tsx')
  test('Seite schreibt Behandlungen und Typen nur noch über Server Actions', () => {
    assert.doesNotMatch(seite, /from\('keller_behandlungen'\) as any\)\s*\.(insert|update)/)
    assert.doesNotMatch(seite, /from\('keller_behandlungstypen'\) as any\)\s*\.insert/)
    // KAN-359: Rückfrage über den eigenen Dialog (serverRueckfrage) statt window.confirm
    assert.match(seite, /let r = await speichereKellerbehandlung\(fd\)\n\s*if \(r\.bestaetigung\) \{\n\s*if \(!\(await serverRueckfrage\(r\.bestaetigung, 'Trotzdem speichern'\)\)\) return\n\s*fd\.set\('pn_bestaetigt', '1'\)/)
    assert.doesNotMatch(seite, /window\.confirm/)
  })
  test('Action: Schreibrecht Kellerbuch, Rückfrage nur bei Veränderung, Warnung bei nicht eingestuftem Typ', () => {
    const f = act.slice(act.indexOf('export async function speichereKellerbehandlung'), act.indexOf('export async function createKellerbehandlung'))
    assert.match(f, /const tenantId = await kellerbuchSchreibrecht\(\)/)
    assert.match(f, /if \(typ\.pn_wirkung === 'veraenderung'\) \{\n\s*const pn = await pruefePruefnummernSchaden\(supabase, tenantId, 'behandlung', ziel, datum\)/)
    assert.match(f, /if \(pn && formData\.get\('pn_bestaetigt'\) !== '1'\) return \{ bestaetigung: pn\.frage \}/)
    assert.match(f, /\} else if \(typ\.pn_wirkung !== 'pflege'\) \{/)
    assert.match(f, /hinweis = pnWirkungUnklarHinweis\(/)
  })
  test('Assistent nutzt denselben Weg und reicht die Rückfrage weiter', () => {
    const t = quelle('src/lib/assistent/tools/kellerbehandlung.ts')
    assert.match(t, /const result = await createKellerbehandlung\(fd\)/)
    assert.match(t, /if \(input\.pn_bestaetigt === true\) fd\.set\('pn_bestaetigt', '1'\)/)
    assert.match(t, /pruefnummer_rueckfrage: result\.bestaetigung/)
  })
  test('Abstufung in updateWeinausbau: unveränderte Angaben nicht schreiben, sonst Rückfrage', () => {
    const f = act.slice(act.indexOf('export async function updateWeinausbau'), act.indexOf('// ANALYSEN'))
    assert.match(f, /if \(gleicheQualitaet\(altQualitaet, neuQualitaet\)\) \{\n\s*delete payload\.qualitaetsstufe; delete payload\.zusatzbezeichnung; delete payload\.erzeugnis/)
    assert.match(f, /pruefePruefnummernSchaden\(supabase, tenantId, 'abstufung'/)
    const wf = quelle('src/components/kellerbuch/WeinausbauForm.tsx')
    assert.match(wf, /if \(r\?\.bestaetigung\) \{\n\s*if \(!\(await serverRueckfrage\(r\.bestaetigung, 'Trotzdem speichern'\)\)\) \{ setSaving\(false\); return \}\n\s*normalized\.set\('pn_bestaetigt', '1'\)/)
    assert.doesNotMatch(wf, /window\.confirm/)
  })
  test('Lader: Behandlungen vom Typ Veränderung sind Zugänge, Ende-Arten Behandlung/Abstufung', () => {
    const l = quelle('src/lib/kellerbuch/pruefnummerLaden.ts')
    assert.match(l, /\.eq\('typ\.pn_wirkung', 'veraenderung'\)/)
    assert.match(l, /zugang\(k\.weinausbau_id, \{ art: 'behandlung'/)
    assert.match(l, /const ENDE_VORGANG: readonly PnZugangArt\[\] = \['verschnitt', 'zukauf', 'pressung', 'zugang', 'behandlung', 'abstufung', 'korrektur'\]/)   // KAN-53: + korrektur
  })
})
