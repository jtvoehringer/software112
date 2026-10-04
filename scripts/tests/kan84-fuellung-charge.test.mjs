// Tests KAN-84 (04.10.2026): Füllung – Weinmerkmale serverseitig aus der Charge, Formular nur lesend, Prüfnummer nur
// aus dem Antrag der Charge (ohne Migration). Entscheidungen Jörgen (25.09. und 04.10.2026):
//   * Eine Füllung braucht immer eine Charge (Ausnahme: Flaschen-Eröffnungsbestand per Import, KAN-42).
//   * createFuellung und der Assistent übernehmen Jahrgang, Rebsorte, Weinart und Land aus der Charge – abweichende
//     Werte werden ignoriert (Hinweis). Qualität/Herkunft bleiben „nur abstufen“ (KAN-80/111/186).
//   * Prüfnummer nur aus dem DAC-Antrag der Charge, keine freie Eingabe mehr bei Füllungen mit Charge.
//   * updateFuellung: nur Name, Preise, KN-Code, Notizen und „aktiv“; Merkmale, Datum, Los, Charge und Mengen werden
//     abgelehnt, die Prüfnummer lässt sich EINMAL aus dem Antrag der Charge nachtragen.
//   * Kleinfix: der PN-Antrag übernimmt den Jahrgang der Charge.
//
// Aufruf:  npm run -s test:csv  (Node ≥ 22.15 wegen module.registerHooks)
//
// 1. createFuellung gegen die Supabase-Attrappe (buchung-attrappe.mjs): Merkmale aus der Charge, Charge Pflicht,
//    freie Prüfnummer mit Charge abgelehnt.
// 2. updateFuellung: änderbare Felder, Ablehnung fester Felder, Prüfnummer einmal nachtragen.
// 3. pruefnummerNachtragPruefen (rein).
// 4. Assistent (fuehreAbfuellenAus): sendet keine Merkmale mehr, meldet ignorierte Angaben.
// 5. Quelltext: Formulare „Neue Füllung“ und „Füllung bearbeiten“, DAC-Antrag.

import { test, describe, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { DOPPEL, hooksRegistrieren, laden, nurMitHooks, hooksMoeglich, datenbank, uuid, zeile, schreibzugriffe, ohneMandant } from './buchung-attrappe.mjs'

const modul = code => 'data:text/javascript,' + encodeURIComponent(code)
DOPPEL['@/lib/auth/seitenBetrieb'] = modul('export const pruefeSeitenBetrieb = async () => {}')
DOPPEL['@/lib/auth/sperren'] = modul('export const pruefeSchreibzugriff = async () => {}')
DOPPEL['next/navigation'] = modul('export const redirect = ziel => { const e = new Error("NEXT_REDIRECT"); e.ziel = ziel; throw e }')
hooksRegistrieren()

const wh = hooksMoeglich ? await laden('app/(dashboard)/weinhandel/actions.ts') : null
const ab = hooksMoeglich ? await laden('lib/assistent/tools/abfuellen.ts') : null
const pn = await import('../../src/lib/kellerbuch/pruefnummer.ts')

const WURZEL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const quelle = rel => readFileSync(path.join(WURZEL, rel), 'utf8').replace(/\r\n/g, '\n')

const T = 'tenant-1'
const C1 = uuid(1)    // Riesling 2025, weiß, Österreich – mit genehmigtem DAC-Antrag A1
const C2 = uuid(2)    // Zweigelt 2024, rot – ohne Antrag
const A1 = uuid(11)
const A2 = uuid(12)   // Antrag von C2 (Entwurf)
const F1 = uuid(21)   // Füllung aus C1 ohne Prüfnummer
const F2 = uuid(22)   // Füllung ohne Charge (Eröffnungsbestand per Import)
const admin = { tenantId: T, role: 'tenant_admin', schreibmodule: [] }

const charge = (id, teil) => ({
  id, tenant_id: T, name: 'Riesling Kamptal', jahrgang: 2025, rebsorte: 'Riesling', weinart: 'weiss', land_iso: 'AT',
  menge_liter: 1000, status: 'ausbau', aktiv: true, qualitaetsstufe: 'qualitaetswein', zusatzbezeichnung: null, erzeugnis: null,
  herkunft_code: null, storniert_am: null, ...teil,
})
const fuellung = (id, teil) => ({
  id, tenant_id: T, weinausbau_id: C1, name: 'Riesling Kamptal 2025', datum: '2026-09-01', chargennummer: 'CH-2026-001',
  jahrgang: 2025, rebsorte: 'Riesling', weinart: 'weiss', land_iso: 'AT', qualitaet: 'qualitaetswein', zusatzbezeichnung: null,
  erzeugnis: null, herkunft_code: null, anbaugebiet: 'Kamptal', bezeichnung: null, anzahl_flaschen: 100, bestand_flaschen: 100,
  flaschengroesse_ml: 750, menge_liter_gefuellt: 75, pruefnummer: null, dac_antrag_id: null, storniert_am: null, aktiv: true,
  vk_preis_brutto: 10, einstandspreis: 4, mwst_pct: 20, zolltarifnummer: null, notizen: null, import_quelle: null, ...teil,
})
const antrag = (id, teil) => ({
  id, tenant_id: T, weinausbau_id: C1, bezeichnung: 'Riesling Kamptal 2025', status: 'genehmigt', aktiv: true, pruefnummer: 'N 123/26',
  menge_liter: '1000', eingereicht_am: '2026-08-01', bescheid_am: '2026-08-20', created_at: '2026-08-01T08:00:00+00:00', storniert_am: null, ...teil,
})

/** Attrappe samt single() (wie maybeSingle) und Nummernkreis; Server-Client = Attrappe */
function db(extra = {}) {
  const d = datenbank({
    weinausbau: [charge(C1), charge(C2, { name: 'Zweigelt', jahrgang: 2024, rebsorte: 'Zweigelt', weinart: 'rot' })],
    fuellungen: [fuellung(F1), fuellung(F2, { weinausbau_id: null, import_quelle: 'eroeffnungsbestand', pruefnummer: 'L 4711/25' })],
    fuellung_chargen: [], dac_antrag: [antrag(A1), antrag(A2, { weinausbau_id: C2, status: 'entwurf', pruefnummer: null, eingereicht_am: null, bescheid_am: null })],
    verschneidungen: [], zukauf_posten: [], keller_umzuege: [], pressung_behaelter: [], verkauf_positionen: [],
    ...extra,
  }, {
    rpc: async name => (name === 'get_next_chargennummer' ? { data: 'CH-2026-099', error: null } : { data: null, error: { message: `rpc ${name}` } }),
  })
  const from = d.from
  d.from = t => { const q = from(t); q.single = () => q.maybeSingle(); return q }
  globalThis.__serverFake = d
  return d
}

function formular(werte) {
  const fd = new FormData()
  for (const [k, v] of Object.entries(werte)) fd.set(k, String(v))
  return fd
}
const neueFuellung = teil => formular({
  weinausbau_id: C1, name: 'Riesling Kamptal 2025', anzahl_flaschen: 100, flaschengroesse_ml: 750, datum: '2026-10-01', qualitaet: 'qualitaetswein', ...teil,
})
const fehlerVon = async p => { try { await p } catch (e) { return e } assert.fail('Fehler erwartet') }
const neueZeile = d => d.tabellen.fuellungen.find(f => ![F1, F2].includes(f.id))

beforeEach(() => { globalThis.__membership = admin })

// ── 1. createFuellung ─────────────────────────────────────────────────────────

describe('createFuellung: Merkmale aus der Charge, Charge Pflicht (KAN-84)', nurMitHooks, () => {
  test('Jahrgang, Rebsorte, Weinart und Land aus der Charge – abweichende Formularwerte ignoriert, mit Hinweis', async () => {
    const d = db()
    const r = await wh.createFuellung(neueFuellung({ jahrgang: 2019, rebsorte: 'Zweigelt', weinart: 'rot', land_iso: 'it' }))
    const f = neueZeile(d)
    assert.equal(r.id, f.id)
    assert.deepEqual([f.jahrgang, f.rebsorte, f.weinart, f.land_iso, f.weinausbau_id], [2025, 'Riesling', 'weiss', 'AT', C1])
    assert.match(r.hinweis, /^Aus der Charge „Riesling Kamptal“ übernommen, abweichende Angaben ignoriert: /)
    for (const teil of ['Jahrgang 2025 statt „2019“', 'Rebsorte Riesling statt „Zweigelt“', 'Weinart Weißwein statt „Rotwein“', 'Land Österreich statt „Italien“']) {
      assert.ok(r.hinweis.includes(teil), teil)
    }
    assert.deepEqual(ohneMandant(d, T), [])
  })
  test('ohne Merkmale im Formular (neues Formular): Werte der Charge, kein Hinweis', async () => {
    const d = db()
    const r = await wh.createFuellung(neueFuellung({ weinausbau_id: C2, name: 'Zweigelt 2024' }))
    const f = neueZeile(d)
    assert.deepEqual([f.jahrgang, f.rebsorte, f.weinart, f.land_iso], [2024, 'Zweigelt', 'rot', 'AT'])
    assert.equal(r.hinweis, undefined)
    // gleiche Werte wie die Charge gelten nicht als Abweichung
    const d2 = db()
    const r2 = await wh.createFuellung(neueFuellung({ jahrgang: 2025, rebsorte: 'Riesling', weinart: 'weiss', land_iso: 'AT' }))
    assert.equal(r2.hinweis, undefined)
    assert.equal(neueZeile(d2).jahrgang, 2025)
  })
  test('ohne Charge abgelehnt – vor jedem Schreibzugriff', async () => {
    const d = db()
    const e = await fehlerVon(wh.createFuellung(neueFuellung({ weinausbau_id: '' })))
    assert.equal(e.name, 'AktionsFehler')
    assert.match(e.message, /^Bitte die Kellerbuch-Charge wählen – eine Füllung wird immer aus einer Charge abgefüllt\./)
    assert.deepEqual(schreibzugriffe(d), [])
  })
  test('freie Prüfnummer mit Charge abgelehnt (auch eine Lieferanten-Nummer), vor jedem Schreibzugriff', async () => {
    for (const [weinausbau_id, nummer] of [[C2, 'L 4711/25'], [C1, 'N 999/26']]) {
      const d = db()
      const e = await fehlerVon(wh.createFuellung(neueFuellung({ weinausbau_id, pruefnummer: nummer })))
      assert.match(e.message, new RegExp(`^Die Prüfnummer ${nummer.replace('/', '\\/')} gehört zu keinem genehmigten DAC-Antrag der Charge`), nummer)
      assert.deepEqual(schreibzugriffe(d), [], nummer)
    }
  })
  test('Qualität bleibt „nur abstufen“ (KAN-80): Aufwertung gegenüber der Charge abgelehnt', async () => {
    const d = db()
    const e = await fehlerVon(wh.createFuellung(neueFuellung({ qualitaet: 'kabinett' })))
    assert.match(e.message, /nur gleich oder niedriger/)
    assert.deepEqual(schreibzugriffe(d), [])
  })
})

// ── 2. updateFuellung ─────────────────────────────────────────────────────────

describe('updateFuellung: nur Name, Preise, KN-Code, Notizen, aktiv (KAN-84)', nurMitHooks, () => {
  test('änderbare Felder werden gespeichert – nur sie, mit Mandantenfilter', async () => {
    const d = db()
    await wh.updateFuellung(F1, formular({
      name: '  Riesling Ried Gaisberg 2025 ', vk_preis_brutto: '14,90', einstandspreis: '5.10', mwst_pct: '13',
      zolltarifnummer: '22042111', notizen: 'Etikett neu', aktiv: 'false',
    }))
    const upd = d.aufrufe.find(a => a.art === 'update' && a.tabelle === 'fuellungen')
    assert.deepEqual(Object.keys(upd.werte).sort(), ['aktiv', 'aktualisiert_am', 'einstandspreis', 'mwst_pct', 'name', 'notizen', 'vk_preis_brutto', 'zolltarifnummer'])
    const f = zeile(d, 'fuellungen', F1)
    assert.deepEqual([f.name, f.vk_preis_brutto, f.einstandspreis, f.mwst_pct, f.zolltarifnummer, f.notizen, f.aktiv],
      ['Riesling Ried Gaisberg 2025', 14.9, 5.1, 13, '22042111', 'Etikett neu', false])
    assert.deepEqual(ohneMandant(d, T), [])
  })
  test('unverändert mitgesendete feste Felder stören nicht (veralteter Tab mit vollem Formular)', async () => {
    const d = db()
    await wh.updateFuellung(F1, formular({
      name: 'Riesling', jahrgang: '2025', rebsorte: 'Riesling', datum: '2026-09-01', chargennummer: 'CH-2026-001', weinausbau_id: C1,
      anzahl_flaschen: '100', flaschengroesse_ml: '750', menge_liter_gefuellt: '75,00', qualitaet: 'qualitaetswein',
      zusatzbezeichnung: '', erzeugnis: '', herkunft_code: '', anbaugebiet: 'Kamptal', bezeichnung: '', land_iso: 'at',
    }))
    assert.equal(zeile(d, 'fuellungen', F1).name, 'Riesling')
  })
  test('geänderte Merkmale, Abfülldatum, Los, Charge und Mengen werden abgelehnt – nichts gespeichert', async () => {
    const faelle = [
      [{ jahrgang: '2024' }, 'Jahrgang'], [{ rebsorte: 'Grüner Veltliner' }, 'Rebsorte'], [{ weinart: 'rot' }, 'Weinart'],
      [{ land_iso: 'DE' }, 'Land'], [{ herkunft_code: 'wlnoe' }, 'Herkunft-Code (BKI)'], [{ anbaugebiet: 'Wachau' }, 'Anbaugebiet'],
      [{ bezeichnung: 'Ried Heiligenstein' }, 'Subbezeichnung / Ried'], [{ qualitaet: 'landwein' }, 'Qualitätsbezeichnung'],
      [{ zusatzbezeichnung: 'reserve' }, 'Zusatzbezeichnung'], [{ erzeugnis: 'SEKTGU' }, 'Erzeugnis'],
      [{ datum: '2026-09-02' }, 'Abfülldatum'], [{ chargennummer: 'CH-2026-777' }, 'Los (Chargennummer)'],
      [{ weinausbau_id: C2 }, 'Kellerbuch-Charge'], [{ weinausbau_id: '' }, 'Kellerbuch-Charge'],
      [{ anzahl_flaschen: '120' }, 'Anzahl Flaschen'], [{ flaschengroesse_ml: '1000' }, 'Flaschengröße'],
      [{ menge_liter_gefuellt: '80' }, 'Füllmenge'], [{ bestand_flaschen: '90' }, 'Lagerbestand'],
      [{ pruefnummer: 'N 123/26' }, 'Prüfnummer'], [{ dac_antrag_id: A1 }, 'DAC-Antrag'],
    ]
    for (const [werte, label] of faelle) {
      const d = db()
      const e = await fehlerVon(wh.updateFuellung(F1, formular({ name: 'Neu', ...werte })))
      assert.equal(e.name, 'AktionsFehler', label)
      assert.ok(e.message.startsWith(`Nach der Anlage nicht mehr änderbar: ${label}.`), `${label}: ${e.message}`)
      assert.match(e.message, /bitte sie stornieren .* und neu anlegen\.$/)
      assert.deepEqual(schreibzugriffe(d), [], label)
      assert.equal(zeile(d, 'fuellungen', F1).name, 'Riesling Kamptal 2025', label)
    }
    // mehrere auf einmal: alle genannt
    db()
    const e = await fehlerVon(wh.updateFuellung(F1, formular({ jahrgang: '2024', datum: '2026-09-02', anzahl_flaschen: '1' })))
    assert.match(e.message, /^Nach der Anlage nicht mehr änderbar: Jahrgang, Abfülldatum, Anzahl Flaschen\./)
  })
  test('ungültige Eingaben: leerer Name, negativer Preis, MwSt. über 100 %', async () => {
    db()
    assert.match((await fehlerVon(wh.updateFuellung(F1, formular({ name: '  ' })))).message, /Produktnamen/)
    assert.match((await fehlerVon(wh.updateFuellung(F1, formular({ vk_preis_brutto: '-1' })))).message, /^VK-Preis brutto: /)
    assert.match((await fehlerVon(wh.updateFuellung(F1, formular({ mwst_pct: '120' })))).message, /^MwSt\.-Satz: /)
  })
  test('stornierte Füllung lässt sich nicht wieder aktivieren', async () => {
    const d = db({ fuellungen: [fuellung(F1, { aktiv: false, storniert_am: '2026-09-30T10:00:00Z' })] })
    const e = await fehlerVon(wh.updateFuellung(F1, formular({ aktiv: 'true' })))
    assert.match(e.message, /stornierte Füllung kann nicht wieder aktiviert/)
    assert.deepEqual(schreibzugriffe(d), [])
  })
  test('fremder Betrieb: Füllung nicht gefunden, nichts gespeichert', async () => {
    const d = db({ fuellungen: [fuellung(F1, { tenant_id: 'tenant-2' })] })
    assert.match((await fehlerVon(wh.updateFuellung(F1, formular({ name: 'X' })))).message, /^Füllung nicht gefunden/)
    assert.deepEqual(schreibzugriffe(d), [])
  })
})

describe('updateFuellung: Prüfnummer einmal nachtragen – nur aus dem Antrag der Charge (KAN-84)', nurMitHooks, () => {
  test('genehmigter Antrag der Charge: Nummer und Antrag aus dem Antrag, Speichern nur solange leer', async () => {
    const d = db()
    await wh.updateFuellung(F1, formular({ name: 'Riesling Kamptal 2025', pn_antrag_id: A1 }))
    const f = zeile(d, 'fuellungen', F1)
    assert.deepEqual([f.pruefnummer, f.dac_antrag_id], ['N 123/26', A1])
    const upd = d.aufrufe.find(a => a.art === 'update' && a.tabelle === 'fuellungen')
    assert.ok(upd.filter.some(x => x[0] === 'is' && x[1] === 'pruefnummer' && x[2] === null), 'nur solange keine Nummer eingetragen ist')
    // zweites Mal: abgelehnt
    const e = await fehlerVon(wh.updateFuellung(F1, formular({ pn_antrag_id: A1 })))
    assert.match(e.message, /^Die Füllung hat bereits die Prüfnummer N 123\/26 – sie lässt sich nur einmal nachtragen/)
  })
  test('gleichzeitig in einem anderen Tab eingetragen: 0 Zeilen → Meldung statt still überschrieben', async () => {
    const d = db()
    const from = d.from
    d.from = t => {
      const q = from(t)
      const upd = q.update
      q.update = w => { if (t === 'fuellungen') zeile(d, 'fuellungen', F1).pruefnummer = 'N 1/26'; return upd(w) }
      return q
    }
    const e = await fehlerVon(wh.updateFuellung(F1, formular({ pn_antrag_id: A1 })))
    assert.match(e.message, /zwischenzeitlich eingetragen/)
    assert.equal(zeile(d, 'fuellungen', F1).pruefnummer, 'N 1/26')
  })
  test('Antrag einer anderen Charge, offener Antrag, Füllung ohne Charge → abgelehnt, nichts gespeichert', async () => {
    const d = db()
    assert.match((await fehlerVon(wh.updateFuellung(F1, formular({ pn_antrag_id: A2 })))).message, /gehört nicht zur Kellerbuch-Charge dieser Füllung/)
    const offen = db({ dac_antrag: [antrag(A1, { status: 'eingereicht', pruefnummer: null, bescheid_am: null })] })
    assert.match((await fehlerVon(wh.updateFuellung(F1, formular({ pn_antrag_id: A1 })))).message, /nicht genehmigt, inaktiv oder hat noch keine Prüfnummer/)
    const ohne = db({ fuellungen: [fuellung(F2, { weinausbau_id: null, pruefnummer: null })] })
    assert.match((await fehlerVon(wh.updateFuellung(F2, formular({ pn_antrag_id: A1 })))).message, /keine Kellerbuch-Charge/)
    for (const x of [d, offen, ohne]) assert.deepEqual(schreibzugriffe(x), [])
  })
  test('Verschnitt zwischen Einreichung und Abfüllung: Nummer gilt nicht für diese Füllung', async () => {
    const d = db({ verschneidungen: [{ id: 'v1', tenant_id: T, datum: '2026-08-15', ziel_weinausbau_id: C1, storniert_am: null }] })
    const e = await fehlerVon(wh.updateFuellung(F1, formular({ pn_antrag_id: A1 })))
    assert.match(e.message, /Die Abfüllung am 01\.09\.2026 liegt nach der Einreichung .*Verschnitt am 15\.08\.2026.* – die Prüfnummer N 123\/26 gilt für diese Füllung nicht\./)
    assert.deepEqual(schreibzugriffe(d), [])
  })
  test('Füllung mit offenem Antrag verknüpft (Abfüllung vor dem Bescheid): dessen Nummer nach der Genehmigung nachtragbar', async () => {
    const d = db({ fuellungen: [fuellung(F1, { dac_antrag_id: A1, datum: '2026-08-10' })] })
    await wh.updateFuellung(F1, formular({ pn_antrag_id: A1 }))
    assert.equal(zeile(d, 'fuellungen', F1).pruefnummer, 'N 123/26')
    // … aber nicht die eines anderen Antrags
    const A3 = uuid(13)
    db({ fuellungen: [fuellung(F1, { dac_antrag_id: A1 })], dac_antrag: [antrag(A1, { status: 'in_pruefung', pruefnummer: null }), antrag(A3, { pruefnummer: 'N 5/26', eingereicht_am: '2026-08-02' })] })
    assert.match((await fehlerVon(wh.updateFuellung(F1, formular({ pn_antrag_id: A3 })))).message, /bereits mit einem anderen DAC-Antrag/)
  })
})

// ── 3. pruefnummerNachtragPruefen (rein) ──────────────────────────────────────

describe('pruefnummerNachtragPruefen', () => {
  const PN_ANTRAG = { id: 'a1', weinausbauId: 'c1', status: 'genehmigt', aktiv: true, pruefnummer: 'N 123/26', mengeLiter: 1000, eingereichtAm: '2026-08-01', bescheidAm: '2026-08-20', angelegtAm: '2026-08-01', bezeichnung: 'Riesling' }
  const daten = teil => ({ chargeId: 'c1', bestandLiter: 0, bestandAm: '2026-10-04', antraege: [PN_ANTRAG], zugaenge: [], abfuellungen: [], ...teil })
  test('gültig: Nummer aus dem Antrag; Abfüllung vor der Einreichung ohne Zugang dazwischen ebenso', () => {
    assert.deepEqual(pn.pruefnummerNachtragPruefen(daten(), 'a1', '2026-09-01'), { ok: true, pruefnummer: 'N 123/26' })
    assert.deepEqual(pn.pruefnummerNachtragPruefen(daten(), 'a1', '2026-07-20'), { ok: true, pruefnummer: 'N 123/26' })
  })
  test('Zugang dazwischen, fremder bzw. abgelöster Antrag, anderer verknüpfter Antrag → Fehler', () => {
    const z = daten({ zugaenge: [{ art: 'zukauf', datum: '2026-07-25' }] })
    assert.match(pn.pruefnummerNachtragPruefen(z, 'a1', '2026-07-20').fehler, /liegt vor der Einreichung .*Zukauf am 25\.07\.2026/)
    assert.equal(pn.pruefnummerNachtragPruefen(daten(), 'x', '2026-09-01').ok, false)
    const neuer = { ...PN_ANTRAG, id: 'a2', pruefnummer: 'N 200/26', eingereichtAm: '2026-08-25', angelegtAm: '2026-08-25' }
    assert.match(pn.pruefnummerNachtragPruefen(daten({ antraege: [PN_ANTRAG, neuer] }), 'a1', '2026-09-01').fehler, /maßgeblich ist der zuletzt eingereichte/)
    assert.deepEqual(pn.pruefnummerNachtragPruefen(daten({ antraege: [PN_ANTRAG, neuer] }), 'a2', '2026-09-01'), { ok: true, pruefnummer: 'N 200/26' })
    assert.match(pn.pruefnummerNachtragPruefen(daten(), 'a1', '2026-09-01', 'a9').fehler, /bereits mit einem anderen DAC-Antrag/)
    assert.equal(pn.pruefnummerNachtragPruefen(daten({ antraege: [{ ...PN_ANTRAG, aktiv: false }] }), 'a1', '2026-09-01').ok, false)
  })
})

// ── 4. Assistent ──────────────────────────────────────────────────────────────

describe('Assistent „abfuellen“: Merkmale aus der Charge (KAN-84)', nurMitHooks, () => {
  const eingabe = teil => ({
    bestaetigt_vom_user: true, weinausbau_id: C1, name: 'Riesling Kamptal 2025', datum: '2026-10-01', flaschengroesse_ml: 750, anzahl_flaschen: 100, ...teil,
  })
  test('abweichender Jahrgang/Rebsorte: Füllung mit den Werten der Charge, Hinweis im Ergebnis – keine Nacharbeit', async () => {
    const d = db()
    const r = await ab.fuehreAbfuellenAus(eingabe({ jahrgang: 2019, rebsorte: 'Zweigelt' }), d)
    assert.equal(r.erfolg, true, JSON.stringify(r))
    assert.equal(r.nacharbeit_noetig, undefined)
    assert.match(r.merkmale_hinweis, /^Jahrgang und Rebsorte kommen immer aus der Charge „Riesling Kamptal“ – abweichende Angaben wurden ignoriert: Jahrgang 2025 statt 2019, Rebsorte Riesling statt „Zweigelt“\.$/)
    const f = neueZeile(d)
    assert.deepEqual([f.jahrgang, f.rebsorte, f.weinart, f.land_iso], [2025, 'Riesling', 'weiss', 'AT'])
  })
  test('ohne Abweichung kein Hinweis; das Tool sendet Jahrgang/Rebsorte nicht mehr', async () => {
    const d = db()
    const r = await ab.fuehreAbfuellenAus(eingabe({ jahrgang: 2025 }), d)
    assert.equal(r.merkmale_hinweis, undefined)
    assert.equal(r.erfolg, true)
    const s = quelle('src/lib/assistent/tools/abfuellen.ts')
    assert.doesNotMatch(s, /fd\.set\('(?:jahrgang|rebsorte|weinart|land_iso)'/)
  })
})

// ── 5. Quelltext ──────────────────────────────────────────────────────────────

describe('Formulare (Quelltext)', () => {
  test('„Neue Füllung“: Charge Pflicht, Merkmale nur angezeigt, keine freie Prüfnummer', () => {
    const s = quelle('src/app/(dashboard)/weinhandel/fuellungen/neu/FuellungFormClient.tsx')
    assert.doesNotMatch(s, /keine Verknüpfung/)
    const auswahl = s.slice(s.indexOf('aria-label="Weinausbau-Charge"'), s.indexOf('</select>', s.indexOf('aria-label="Weinausbau-Charge"')))
    assert.match(auswahl, /\brequired\b/)
    for (const feld of ['jahrgang', 'rebsorte', 'weinart', 'land_iso', 'pruefnummer']) assert.doesNotMatch(s, new RegExp(`name="${feld}"`), feld)
    assert.match(s, /\['Jahrgang', /)
    assert.match(s, /\['Land', /)
    const seite = quelle('src/app/(dashboard)/weinhandel/fuellungen/neu/page.tsx')
    assert.match(seite, /herkunft_code, weinart, land_iso'\)/)
    assert.doesNotMatch(seite, /chargenMitAntrag/)
  })
  test('„Füllung bearbeiten“: nur Name, Preise, KN-Code, Notizen und Prüfnummer-Nachtrag als Formularfelder', () => {
    const s = quelle('src/app/(dashboard)/weinhandel/fuellungen/[id]/edit/page.tsx')
    const formular = s.slice(s.indexOf('<FuellungEditFormular'), s.indexOf('</FuellungEditFormular>'))
    const namen = [...formular.matchAll(/\bname="([^"]+)"/g)].map(m => m[1]).sort()
    assert.deepEqual(namen, ['einstandspreis', 'name', 'notizen', 'pn_antrag_id', 'vk_preis_brutto', 'zolltarifnummer'])
    assert.match(s, /pruefnummerNachtragPruefen\(daten, a\.id, tag, fuellungAntrag\)\.ok/)
  })
  test('DAC-Antrag übernimmt den Jahrgang der Charge statt des aktuellen Jahrs', () => {
    const s = quelle('src/components/dac/DacForm.tsx')
    assert.match(s, /jahrgangDerCharge\(preChargeId\) \?\? new Date\(\)\.getFullYear\(\)/)
    assert.match(s, /onChange=\{e => \{ const j = jahrgangDerCharge\(e\.target\.value\); if \(j != null\) setJahrgang\(String\(j\)\) \}\}/)
    assert.doesNotMatch(s, /defaultValue=\{dac\?\.jahrgang \?\? new Date\(\)\.getFullYear\(\)\}/)
    for (const seite of ['src/app/(dashboard)/dac/neu/page.tsx', 'src/app/(dashboard)/dac/[id]/page.tsx']) {
      assert.match(quelle(seite), /from\('weinausbau'\) as any\)\.select\('id, name, jahrgang'\)/, seite)
    }
  })
  test('CSV-Import „Füllungen (Weinlager)“ kennzeichnet Füllungen ohne Charge als Import (import_quelle/importiert_am)', () => {
    const s = quelle('src/app/api/import/route.ts')
    const zweig = s.slice(s.indexOf("} else if (typ === 'fuellungen') {"), s.indexOf("} else if (typ === 'rieden_details') {"))
    assert.match(zweig, /\.\.\.herkunftFelder,/)
    assert.doesNotMatch(zweig, /weinausbau_id/)
    assert.match(s, /const herkunftFelder = \{ import_quelle: importQuelle, importiert_am: importiertAm\.toISOString\(\) \}/)
  })
})
