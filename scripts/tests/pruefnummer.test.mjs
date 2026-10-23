// Tests KAN-72: Gültigkeit der Prüfnummer (Blend-Protokoll, TBS, Füllung) – ohne Datenbank
//
// Aufruf:  node --experimental-strip-types --disable-warning=ExperimentalWarning --test scripts/tests/pruefnummer.test.mjs
//
// 1. Reiner Helfer src/lib/kellerbuch/pruefnummer.ts mit einer Fixture, die den Musterhof-Fall
//    nachbildet (R1 „blendprotokoll (case: musterhof)“, 25.09.2026): Antrag über 5.000 l,
//    eingereicht 20.05.2026, Bescheid 08.06.2026, N 10716/26; Füllung CH-2026-012 am 20.06.2026
//    mit 4.500 l; Verschnitt von 48 l GV in den Rest am 25.09.2026 → Bestand 548 l.
// 2. Lader, Blend-Protokoll (Charge und Füllung, CSV und Dateiname) und TBS-Vorbelegung gegen
//    eine Attrappe des Supabase-Clients (Tabellen als Arrays).
// 3. Quelltextprüfungen der Verdrahtung (Server liest die Prüfnummer aus dem Antrag,
//    Chargenwechsel setzt sie zurück, Dateiname ohne Prüfnummer, Seite lädt nur gültige Anträge).
// kellerbuch-hooks.mjs löst '@/…', Pfade ohne Endung und 'server-only' auf.

import { register } from 'node:module'
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

register('./kellerbuch-hooks.mjs', import.meta.url)

const pn = await import('../../src/lib/kellerbuch/pruefnummer.ts')
const laden = await import('../../src/lib/kellerbuch/pruefnummerLaden.ts')
const csv = await import('../../src/lib/csv/index.ts')
const typen = await import('../../src/lib/behoerden/typen.ts')
const { MELDUNGEN_KELLERBUCH: M } = await import('../../src/lib/behoerden/register/kellerbuch.ts')
const tb = await import('../../src/lib/behoerden/transportbescheinigung.ts')

const WURZEL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const quelle = rel => readFileSync(path.join(WURZEL, rel), 'utf8').replace(/\r\n/g, '\n')

const T = '33333333-3333-4333-8333-333333333333'           // Musterhof
const X = '99999999-9999-4999-8999-999999999999'           // anderer Betrieb
const CH = '33333333-3333-4333-8333-000b00000012'          // Riesling Ried Pfaffenberg
const CH_B = '33333333-3333-4333-8333-000b00000013'        // Charge ohne genehmigten Antrag
const ANTRAG_ID = '33333333-3333-4333-8333-001200000002'
const FUELLUNG_ID = '33333333-3333-4333-8333-00130000000b'
const VERSCHNITT_ID = '9aeff0ec-30cb-432c-9c84-97f762bdfddf'
const FREMD_ANTRAG_ID = '99999999-0000-4000-8000-000000000001'
const BETRIEB = { name: 'Weingut Musterhof (Demo)', betriebsnummer: '1234567' }

// ── Fixture Musterhof (Helferform) ────────────────────────────────────────────

const ANTRAG = {
  id: ANTRAG_ID, weinausbauId: CH, status: 'genehmigt', aktiv: true, pruefnummer: 'N 10716/26',
  mengeLiter: 5000, eingereichtAm: '2026-05-20', bescheidAm: '2026-06-08', angelegtAm: '2026-05-20',
  bezeichnung: 'Riesling Ried Pfaffenberg 2025',
}
const PRESSUNG = { art: 'pressung', datum: '2025-09-28', id: 'pressung' }        // Herkunft, vor dem Antrag
const VERSCHNITT = { art: 'verschnitt', datum: '2026-09-25', id: VERSCHNITT_ID }
const FUELLUNG = { id: FUELLUNG_ID, datum: '2026-06-20', liter: 4500, dacAntragId: ANTRAG_ID }

function musterhof(extra = {}) {
  return {
    chargeId: CH, bestandLiter: 548, bestandAm: '2026-09-25',
    antraege: [ANTRAG], zugaenge: [PRESSUNG, VERSCHNITT], abfuellungen: [FUELLUNG],
    ...extra,
  }
}

const HINWEIS_MUSTERHOF = 'Frühere Prüfnummer N 10716/26 gilt nicht für den aktuellen Bestand: Verschnitt am 25.09.2026 (§ 25 Abs. 6 WeinG).'

// ── 1. Helfer ────────────────────────────────────────────────────────────────

describe('pruefnummerGueltig – Musterhof', () => {
  test('Verschnitt nach der Einreichung → ungültig, mit Datum und Hinweis', () => {
    const e = pn.pruefnummerGueltig(musterhof(), '2026-09-25')
    assert.equal(e.gueltig, false)
    assert.equal(e.grund, 'verschnitt')
    assert.equal(e.ereignisDatum, '2026-09-25')
    assert.equal(e.pruefnummer, 'N 10716/26')
    assert.equal(e.antragId, ANTRAG_ID)
    assert.equal(pn.pruefnummerHinweis(e), HINWEIS_MUSTERHOF)
  })
  test('Stichtag vor dem Verschnitt → gültig (Mengenregel ohne Bestand am Stichtag nicht geprüft)', () => {
    const e = pn.pruefnummerGueltig(musterhof(), '2026-09-24')
    assert.equal(e.gueltig, true)
    assert.equal(e.pruefnummer, 'N 10716/26')
    assert.equal(e.grund, null)
    assert.equal(e.mengeGeprueft, false)
    assert.equal(pn.pruefnummerHinweis(e), null)
    // mit dem Bestand an diesem Tag (500 l = 5.000 − 4.500) auch nach der Mengenregel gültig
    const m = pn.pruefnummerGueltig(musterhof({ bestandLiter: 500, bestandAm: '2026-09-24' }), '2026-09-24')
    assert.equal(m.gueltig, true)
    assert.equal(m.mengeGeprueft, true)
    assert.deepEqual(m.menge, { bestandLiter: 500, beantragtLiter: 5000, abgefuelltLiter: 4500, zulaessigLiter: 500 })
  })
  test('Füllung CH-2026-012 (Stichtag Abfüllung 20.06.2026) → gültig', () => {
    assert.equal(pn.pruefnummerGueltig(musterhof(), '2026-06-20').gueltig, true)
  })
  test('Stichtag vor der Einreichung → Nummer gilt noch nicht', () => {
    const e = pn.pruefnummerGueltig(musterhof(), '2026-05-01')
    assert.equal(e.gueltig, false)
    assert.equal(e.grund, 'nach_stichtag')
    assert.equal(e.ereignisDatum, '2026-05-20')
  })
})

describe('pruefnummerGueltig – Regeln', () => {
  test('Mengenregel: Bestand > beantragt − abgefüllt → ungültig (auch ohne Zugangsbuchung)', () => {
    const e = pn.pruefnummerGueltig(musterhof({ zugaenge: [PRESSUNG] }), '2026-09-25')
    assert.equal(e.gueltig, false)
    assert.equal(e.grund, 'menge')
    assert.deepEqual(e.menge, { bestandLiter: 548, beantragtLiter: 5000, abgefuelltLiter: 4500, zulaessigLiter: 500 })
    assert.match(pn.pruefnummerHinweis(e), /548,00 l Bestand, beantragt waren 5\.000,00 l, davon 4\.500,00 l abgefüllt – höchstens 500,00 l/)
    // genau die zulässige Menge (Rundung numeric(10,2)) → gültig
    assert.equal(pn.pruefnummerGueltig(musterhof({ zugaenge: [], bestandLiter: 500.004 }), '2026-09-25').gueltig, true)
    // Stichtag in der Vergangenheit: Bestand damals unbekannt → Mengenregel entfällt
    assert.equal(pn.pruefnummerGueltig(musterhof({ zugaenge: [] }), '2026-09-01').gueltig, true)
  })
  test('Mengenregel: Füllungen vor der Einreichung zählen nur, wenn sie mit dem Antrag verknüpft sind', () => {
    const vorher = { datum: '2026-05-10', liter: 1000, dacAntragId: null }
    const verknuepft = { datum: '2026-05-10', liter: 1000, dacAntragId: ANTRAG_ID }
    const basis = { zugaenge: [], bestandLiter: 500, abfuellungen: [FUELLUNG] }
    assert.equal(pn.pruefnummerGueltig(musterhof({ ...basis, abfuellungen: [FUELLUNG, vorher] }), '2026-09-25').gueltig, true)
    const e = pn.pruefnummerGueltig(musterhof({ ...basis, abfuellungen: [FUELLUNG, verknuepft] }), '2026-09-25')
    assert.equal(e.grund, 'menge')
    assert.equal(e.menge.zulaessigLiter, -500)
    // Füllung am Einreichungstag ohne Verknüpfung gilt als davor
    assert.equal(pn.pruefnummerGueltig(musterhof({ ...basis, abfuellungen: [FUELLUNG, { ...vorher, datum: '2026-05-20' }] }), '2026-09-25').gueltig, true)
  })
  test('Status und aktiv: nur genehmigte, aktive Anträge mit Nummer', () => {
    const ohneZugang = { zugaenge: [], bestandLiter: 500 }
    for (const status of ['entwurf', 'eingereicht', 'in_pruefung']) {
      const e = pn.pruefnummerGueltig(musterhof({ ...ohneZugang, antraege: [{ ...ANTRAG, status, pruefnummer: null }] }), '2026-09-25')
      assert.equal(e.gueltig, false, status)
      assert.equal(e.grund, 'nicht_genehmigt', status)
      assert.equal(pn.pruefnummerHinweis(e), null, status)            // keine Nummer → kein Hinweis
    }
    const inaktiv = pn.pruefnummerGueltig(musterhof({ ...ohneZugang, antraege: [{ ...ANTRAG, aktiv: false }] }), '2026-09-25')
    assert.equal(inaktiv.gueltig, false)
    assert.equal(inaktiv.grund, 'nicht_genehmigt')
    assert.equal(inaktiv.pruefnummer, 'N 10716/26')
    assert.match(pn.pruefnummerHinweis(inaktiv), /^Prüfnummer N 10716\/26 gilt nicht: Der DAC-Antrag ist nicht \(mehr\) genehmigt oder inaktiv\.$/)
    const abgelehnt = pn.pruefnummerGueltig(musterhof({ ...ohneZugang, antraege: [{ ...ANTRAG, status: 'abgelehnt' }] }), '2026-09-25')
    assert.equal(abgelehnt.grund, 'nicht_genehmigt')
    const genehmigtOhneNummer = pn.pruefnummerGueltig(musterhof({ ...ohneZugang, antraege: [{ ...ANTRAG, pruefnummer: '  ' }] }), '2026-09-25')
    assert.equal(genehmigtOhneNummer.gueltig, false)
    const kein = pn.pruefnummerGueltig(musterhof({ antraege: [] }), '2026-09-25')
    assert.deepEqual([kein.gueltig, kein.grund, kein.pruefnummer], [false, 'kein_antrag', null])
    // Antrag einer anderen Charge zählt nicht
    assert.equal(pn.pruefnummerGueltig(musterhof({ antraege: [{ ...ANTRAG, weinausbauId: CH_B }] }), '2026-09-25').grund, 'kein_antrag')
    assert.equal(pn.pruefnummerAusAntrag(ANTRAG), 'N 10716/26')
    assert.equal(pn.pruefnummerAusAntrag({ ...ANTRAG, aktiv: false }), null)
    assert.equal(pn.pruefnummerAusAntrag({ ...ANTRAG, status: 'eingereicht' }), null)
  })
  test('Zukauf und Zugang mit der Charge als Ziel → ungültig; am Einreichungstag → davor', () => {
    const zukauf = pn.pruefnummerGueltig(musterhof({ bestandLiter: 500, zugaenge: [PRESSUNG, { art: 'zukauf', datum: '2026-07-01' }] }), '2026-09-25')
    assert.deepEqual([zukauf.gueltig, zukauf.grund, zukauf.ereignisDatum], [false, 'zukauf', '2026-07-01'])
    assert.equal(pn.pruefnummerHinweis(zukauf), 'Frühere Prüfnummer N 10716/26 gilt nicht für den aktuellen Bestand: Zukauf am 01.07.2026 (§ 25 Abs. 6 WeinG).')
    const zugang = pn.pruefnummerGueltig(musterhof({ bestandLiter: 500, zugaenge: [{ art: 'zugang', datum: '2026-08-01' }] }), '2026-09-25')
    assert.equal(zugang.grund, 'zugang')
    assert.match(pn.pruefnummerHinweis(zugang, 'den Bestand am 25.09.2026'), /gilt nicht für den Bestand am 25\.09\.2026: Zugang per Umzug am 01\.08\.2026 \(§ 25 Abs\. 6 WeinG\)\.$/)
    // Pressung nach der Einreichung (Nachpressung): eigener Grund und Text, nicht „aus einer anderen Charge“
    const pressung = pn.pruefnummerGueltig(musterhof({ bestandLiter: 500, zugaenge: [PRESSUNG, { art: 'pressung', datum: '2026-08-02' }] }), '2026-09-25')
    assert.deepEqual([pressung.grund, pressung.ereignisDatum], ['pressung', '2026-08-02'])
    assert.equal(pn.pruefnummerHinweis(pressung), 'Frühere Prüfnummer N 10716/26 gilt nicht für den aktuellen Bestand: Pressung in die Charge am 02.08.2026 (§ 25 Abs. 6 WeinG).')
    // Buchung am Einreichungstag (Annahme: Probe nach dem letzten Verschnitt gezogen)
    assert.equal(pn.pruefnummerGueltig(musterhof({ bestandLiter: 500, zugaenge: [{ art: 'verschnitt', datum: '2026-05-20' }] }), '2026-09-25').gueltig, true)
    // der früheste schädliche Zugang wird genannt
    const zwei = pn.pruefnummerGueltig(musterhof({ zugaenge: [VERSCHNITT, { art: 'zukauf', datum: '2026-07-01' }] }), '2026-09-25')
    assert.equal(zwei.ereignisDatum, '2026-07-01')
    // Zugang ohne Datum wird nicht gewertet
    assert.equal(pn.pruefnummerGueltig(musterhof({ bestandLiter: 500, zugaenge: [{ art: 'zugang', datum: null }] }), '2026-09-25').gueltig, true)
  })
  test('Abgänge schaden nicht: Füllung, Tankverkauf, Schwund mindern nur den Bestand', () => {
    // nach dem Antrag: Füllung 4.500 l, danach Tankverkauf und Schwund (nur Bestand kleiner)
    const e = pn.pruefnummerGueltig(musterhof({ zugaenge: [PRESSUNG], bestandLiter: 320 }), '2026-09-25')
    assert.equal(e.gueltig, true)
    assert.equal(e.pruefnummer, 'N 10716/26')
    assert.equal(e.mengeGeprueft, true)
  })
  test('ohne eingereicht_am: Entwurf ohne Zugangsregel, sonst der frühere von Anlage- und Bescheidtag', () => {
    // nachträglich erfasster, genehmigter Antrag: Bescheid 01.06., angelegt 20.09., kein Einreichungsdatum
    const nacherfasst = { ...ANTRAG, eingereichtAm: null, bescheidAm: '2026-06-01', angelegtAm: '2026-09-20' }
    assert.deepEqual(pn.antragBeginnMitQuelle(nacherfasst), { tag: '2026-06-01', quelle: 'bescheid' })
    // Verschnitt am 01.08. (nach dem Bescheid) → ungültig (bisher: Anlagetag → gültig)
    const e = pn.pruefnummerGueltig(musterhof({ bestandLiter: 500, antraege: [nacherfasst], zugaenge: [PRESSUNG, { art: 'verschnitt', datum: '2026-08-01' }] }), '2026-09-25')
    assert.deepEqual([e.gueltig, e.grund, e.ereignisDatum], [false, 'verschnitt', '2026-08-01'])
    // Mengenregel zählt die Füllung vom 01.07. als abgefüllt
    const m = pn.pruefnummerGueltig(musterhof({ bestandLiter: 500, antraege: [nacherfasst], zugaenge: [PRESSUNG], abfuellungen: [{ datum: '2026-07-01', liter: 4500, dacAntragId: null }] }), '2026-09-25')
    assert.deepEqual([m.gueltig, m.menge.abgefuelltLiter], [true, 4500])
    // Stichtag vor dem Bescheid: Text nennt den Bescheid, nicht eine „Einreichung“
    const vor = pn.pruefnummerGueltig(musterhof({ antraege: [nacherfasst] }), '2026-05-10')
    assert.deepEqual([vor.grund, vor.ereignisDatum, vor.beginnQuelle], ['nach_stichtag', '2026-06-01', 'bescheid'])
    assert.equal(pn.pruefnummerHinweis(vor, 'den Bestand am 10.05.2026'), 'Prüfnummer N 10716/26 gilt nicht für den Bestand am 10.05.2026: Sie wurde erst mit dem Bescheid vom 01.06.2026 erteilt (Einreichungsdatum fehlt).')
    const nurAngelegt = pn.pruefnummerGueltig(musterhof({ antraege: [{ ...ANTRAG, eingereichtAm: null, bescheidAm: null, angelegtAm: '2026-06-01' }] }), '2026-05-10')
    assert.match(pn.pruefnummerHinweis(nurAngelegt), /erst am 01\.06\.2026 erfasst \(Einreichungsdatum fehlt\)/)
    // Entwurf ohne Einreichung: noch keine Probe – keine Zugangsregel
    assert.equal(pn.antragBeginn({ ...ANTRAG, status: 'entwurf', eingereichtAm: null, angelegtAm: '2026-09-10' }), null)
  })
  test('bescheidBisStichtag (TBS): Nummer erst ab dem Bescheid', () => {
    const daten = musterhof({ zugaenge: [PRESSUNG] })
    const e = pn.pruefnummerGueltig(daten, '2026-06-01', { bescheidBisStichtag: true })
    assert.deepEqual([e.gueltig, e.grund, e.ereignisDatum], [false, 'vor_bescheid', '2026-06-08'])
    assert.equal(pn.pruefnummerHinweis(e, 'den Bestand am 01.06.2026 (Verkaufsdatum)'), 'Prüfnummer N 10716/26 gilt nicht für den Bestand am 01.06.2026 (Verkaufsdatum): Sie wurde erst mit dem Bescheid vom 08.06.2026 erteilt.')
    // ohne Option (Blend-Protokoll, Füllung): ab der Einreichung
    assert.equal(pn.pruefnummerGueltig(daten, '2026-06-01').gueltig, true)
    assert.equal(pn.pruefnummerGueltig(daten, '2026-06-08', { bescheidBisStichtag: true }).gueltig, true)
  })
  test('bescheidBisStichtag: ein jüngerer, noch nicht beschiedener Antrag verdrängt den geltenden älteren nicht', () => {
    const x = { ...ANTRAG, id: 'X', pruefnummer: 'N 1/26', eingereichtAm: '2026-08-01', bescheidAm: '2026-08-10', angelegtAm: '2026-08-01' }
    const y = { ...ANTRAG, id: 'Y', pruefnummer: 'N 2/26', eingereichtAm: '2026-09-01', bescheidAm: '2026-09-20', angelegtAm: '2026-09-01' }
    const daten = musterhof({ antraege: [x, y], zugaenge: [PRESSUNG] })
    const e = pn.pruefnummerGueltig(daten, '2026-09-10', { bescheidBisStichtag: true })
    assert.deepEqual([e.gueltig, e.pruefnummer, e.antragId], [true, 'N 1/26', 'X'])
    // ab dem Bescheid des jüngeren gilt dessen Nummer; ohne Option ab seiner Einreichung
    assert.equal(pn.pruefnummerGueltig(daten, '2026-09-20', { bescheidBisStichtag: true }).pruefnummer, 'N 2/26')
    assert.equal(pn.pruefnummerGueltig(daten, '2026-09-10').pruefnummer, 'N 2/26')
    // Zugang nach der Einreichung von X (vor Y): X gilt nicht mehr – Hinweis nennt den jüngeren Antrag
    const mitZugang = musterhof({ antraege: [x, y], zugaenge: [PRESSUNG, { art: 'verschnitt', datum: '2026-08-20' }] })
    const z = pn.pruefnummerGueltig(mitZugang, '2026-09-10', { bescheidBisStichtag: true })
    assert.deepEqual([z.gueltig, z.grund, z.antragId], [false, 'vor_bescheid', 'Y'])
  })
  test('mehrere Anträge: der zuletzt eingereichte genehmigte bis zum Stichtag zählt', () => {
    const neu = { ...ANTRAG, id: 'neu', pruefnummer: 'N 20001/26', mengeLiter: 548, eingereichtAm: '2026-09-26', bescheidAm: '2026-10-05', angelegtAm: '2026-09-26' }
    const daten = musterhof({ antraege: [ANTRAG, neu], bestandAm: '2026-10-05' })
    const e = pn.pruefnummerGueltig(daten, '2026-10-05')
    assert.deepEqual([e.gueltig, e.pruefnummer, e.antragId], [true, 'N 20001/26', 'neu'])
    // vor der neuen Einreichung: der alte Antrag, nach dem Verschnitt ungültig
    const alt = pn.pruefnummerGueltig(daten, '2026-09-25')
    assert.deepEqual([alt.gueltig, alt.grund, alt.antragId], [false, 'verschnitt', ANTRAG_ID])
  })
})

describe('Füllung: fuellungAntragPruefen, waehlbareAntraege, freiePruefnummerPruefen', () => {
  // Stand beim Erfassen von CH-2026-012 am 20.06.2026: 5.000 l, noch nichts abgefüllt, kein Verschnitt
  const stand2006 = (extra = {}) => musterhof({ bestandLiter: 5000, bestandAm: '2026-06-20', zugaenge: [PRESSUNG], abfuellungen: [], ...extra })

  test('genehmigter Antrag: Nummer nur, wenn sie für den Bestand gilt, von dem abgebucht wird', () => {
    assert.deepEqual(pn.fuellungAntragPruefen(stand2006(), ANTRAG_ID, '2026-06-20'), { ok: true, pruefnummer: 'N 10716/26' })
    const r = pn.fuellungAntragPruefen(musterhof(), ANTRAG_ID, '2026-09-25')
    assert.equal(r.ok, false)
    assert.match(r.fehler, /Verschnitt am 25\.09\.2026 \(§ 25 Abs\. 6 WeinG\)/)
    assert.match(r.fehler, /neuer DAC-Antrag nötig/)
  })
  test('rückdatiertes Abfülldatum umgeht weder Zugangs- noch Mengenregel (Buchung vom heutigen Bestand)', () => {
    // Musterhof am 25.09. nach dem Verschnitt: Abfülldatum 24.09. (veralteter Tab) bzw. 01.01.
    for (const datum of ['2026-09-24', '2026-01-01']) {
      const r = pn.fuellungAntragPruefen(musterhof(), ANTRAG_ID, datum)
      assert.equal(r.ok, false, datum)
      assert.match(r.fehler, /Verschnitt am 25\.09\.2026/, datum)
    }
    assert.match(pn.fuellungAntragPruefen(musterhof(), ANTRAG_ID, '2026-09-24').fehler,
      /gilt nicht für den Bestand am 25\.09\.2026, von dem die Abfüllung vom 24\.09\.2026 abgebucht wird: .*bitte die Buchung stornieren, die Füllung erfassen/)
    // Mengenregel mit dem heutigen Bestand, auch bei einem Abfülldatum von gestern (900 l > 500 l zulässig)
    const mehr = pn.fuellungAntragPruefen(musterhof({ zugaenge: [PRESSUNG], bestandLiter: 900 }), ANTRAG_ID, '2026-09-24')
    assert.equal(mehr.ok, false)
    assert.match(mehr.fehler, /900,00 l Bestand, beantragt waren 5\.000,00 l, davon 4\.500,00 l abgefüllt/)
    // Formular (heute) und Server (Abfülldatum gestern) urteilen gleich
    assert.deepEqual(pn.waehlbareAntraege(musterhof({ zugaenge: [PRESSUNG], bestandLiter: 900 }), '2026-09-25'), [])
  })
  test('Abfüllung vor der Einreichung: nichts zwischen Abfüllung und Einreichung zugebucht', () => {
    // Probe aus den Flaschen, Antrag danach
    assert.deepEqual(pn.fuellungAntragPruefen(stand2006({ bestandLiter: 4000 }), ANTRAG_ID, '2026-05-10'), { ok: true, pruefnummer: 'N 10716/26' })
    // Verschnitt am 15.05. in den Tank: Flaschen (10.05.) und Probe (20.05.) verschieden
    const r = pn.fuellungAntragPruefen(stand2006({ bestandLiter: 4000, zugaenge: [PRESSUNG, { art: 'verschnitt', datum: '2026-05-15' }] }), ANTRAG_ID, '2026-05-10')
    assert.equal(r.ok, false)
    assert.match(r.fehler, /Abfüllung am 10\.05\.2026 liegt vor der Einreichung .* am 20\.05\.2026; dazwischen: Verschnitt am 15\.05\.2026/)
    // Buchung am Abfülltag gilt als davor
    assert.equal(pn.fuellungAntragPruefen(stand2006({ bestandLiter: 4000, zugaenge: [PRESSUNG, { art: 'verschnitt', datum: '2026-05-10' }] }), ANTRAG_ID, '2026-05-10').ok, true)
  })
  test('Abfüllung vor dem Beginn ohne eingereicht_am: Text nennt Bescheid bzw. Erfassung, keine „Einreichung“', () => {
    const nacherfasst = { ...ANTRAG, eingereichtAm: null, bescheidAm: '2026-09-10', angelegtAm: '2026-09-12' }
    const daten = stand2006({ bestandLiter: 500, bestandAm: '2026-09-25', antraege: [nacherfasst], zugaenge: [PRESSUNG, { art: 'verschnitt', datum: '2026-09-05' }] })
    const r = pn.fuellungAntragPruefen(daten, ANTRAG_ID, '2026-09-01')
    assert.equal(r.ok, false)
    assert.match(r.fehler, /^Die Abfüllung am 01\.09\.2026 liegt vor dem Bescheid zum DAC-Antrag „Riesling Ried Pfaffenberg 2025“ vom 10\.09\.2026 \(Einreichungsdatum fehlt\); dazwischen: Verschnitt am 05\.09\.2026/)
    assert.doesNotMatch(r.fehler, /Einreichung des/)
    const erfasst = { ...nacherfasst, bescheidAm: null, angelegtAm: '2026-09-10' }
    assert.match(pn.fuellungAntragPruefen({ ...daten, antraege: [erfasst] }, ANTRAG_ID, '2026-09-01').fehler, /liegt vor der Erfassung des DAC-Antrags „Riesling Ried Pfaffenberg 2025“ am 10\.09\.2026 \(Einreichungsdatum fehlt\)/)
  })
  test('Ersatznummer aus dem Antrag (TBS, Blend-Protokoll): Abfülldatum muss gegen den Beginn halten', () => {
    // Füllung am 03.09. mit einem Entwurf verknüpft, Verschnitt am 04.09., Einreichung 05.09., Bescheid 20.09.
    const antrag = { ...ANTRAG, pruefnummer: 'N 9/26', eingereichtAm: '2026-09-05', bescheidAm: '2026-09-20', angelegtAm: '2026-09-02' }
    const verschnitt = { art: 'verschnitt', datum: '2026-09-04' }
    const e = pn.ersatzPruefnummer(antrag, { datum: '2026-09-03', chargeId: CH }, [PRESSUNG, verschnitt])
    assert.equal(e.pruefnummer, null)
    assert.equal(e.hinweis, 'Prüfnummer N 9/26 des DAC-Antrags gilt nicht für diese Füllung: Die Abfüllung am 03.09.2026 liegt vor der Einreichung des DAC-Antrags „Riesling Ried Pfaffenberg 2025“ am 05.09.2026; dazwischen: Verschnitt am 04.09.2026 (§ 25 Abs. 6 WeinG). Flaschen und Probe enthalten damit verschiedenen Wein.')
    // dieselbe Füllung heute erfasst: dieselbe Regel lehnt sie ab
    assert.equal(pn.fuellungAntragPruefen(musterhof({ antraege: [antrag], zugaenge: [PRESSUNG, verschnitt], bestandLiter: 500, abfuellungen: [] }), ANTRAG_ID, '2026-09-03').ok, false)
    // ohne Zugang dazwischen: die Nummer
    assert.deepEqual(pn.ersatzPruefnummer(antrag, { datum: '2026-09-03', chargeId: CH }, [PRESSUNG]), { pruefnummer: 'N 9/26', hinweis: null })
    // Abfüllung nach einem Zugang seit der Einreichung: Flaschen enthalten den Zugang
    assert.match(pn.ersatzPruefnummer(antrag, { datum: '2026-09-26', chargeId: CH }, [PRESSUNG, VERSCHNITT]).hinweis, /liegt nach der Einreichung .*Verschnitt am 25\.09\.2026/)
    // andere Charge, nicht genehmigt, kein Antrag
    assert.deepEqual(pn.ersatzPruefnummer(antrag, { datum: '2026-09-03', chargeId: CH_B }, []), { pruefnummer: null, hinweis: 'Der DAC-Antrag der Füllung gehört zu einer anderen Charge.' })
    assert.deepEqual(pn.ersatzPruefnummer({ ...antrag, status: 'eingereicht' }, { datum: '2026-09-03', chargeId: CH }, []), { pruefnummer: null, hinweis: null })
    assert.deepEqual(pn.ersatzPruefnummer(null, { datum: '2026-09-03', chargeId: CH }, []), { pruefnummer: null, hinweis: null })
  })
  test('fremde oder nicht passende dac_antrag_id → abgelehnt', () => {
    const fremd = pn.fuellungAntragPruefen(musterhof(), '11111111-1111-4111-8111-111111111111', '2026-06-20')
    assert.equal(fremd.ok, false)
    assert.match(fremd.fehler, /gehört nicht zur gewählten Kellerbuch-Charge/)
    // Antrag von Charge A, gewählt ist Charge B
    const b = { chargeId: CH_B, bestandLiter: 800, bestandAm: '2026-09-25', antraege: [], zugaenge: [], abfuellungen: [] }
    assert.equal(pn.fuellungAntragPruefen(b, ANTRAG_ID, '2026-09-25').ok, false)
    assert.equal(pn.fuellungAntragPruefen(null, ANTRAG_ID, '2026-09-25').ok, false)
    assert.equal(pn.fuellungAntragPruefen({ ...b, antraege: [{ ...ANTRAG, weinausbauId: CH }] }, ANTRAG_ID, '2026-09-25').ok, false)
  })
  test('offener Antrag: Verknüpfung ohne Nummer, außer nach einem Zugang', () => {
    const offen = { ...ANTRAG, id: 'offen', status: 'eingereicht', pruefnummer: null, eingereichtAm: '2026-09-13', angelegtAm: '2026-09-13' }
    const daten = { chargeId: CH_B, bestandLiter: 2930, bestandAm: '2026-09-25', antraege: [{ ...offen, weinausbauId: CH_B, mengeLiter: 2930 }], zugaenge: [], abfuellungen: [] }
    assert.deepEqual(pn.fuellungAntragPruefen(daten, 'offen', '2026-09-25'), { ok: true, pruefnummer: null })
    const mitZugang = { ...daten, zugaenge: [{ art: 'verschnitt', datum: '2026-09-20' }] }
    assert.match(pn.fuellungAntragPruefen(mitZugang, 'offen', '2026-09-25').fehler, /passt nicht mehr zum Bestand/)
    const abgelehnt = { ...daten, antraege: [{ ...daten.antraege[0], status: 'abgelehnt' }] }
    assert.match(pn.fuellungAntragPruefen(abgelehnt, 'offen', '2026-09-25').fehler, /abgelehnt/)
    const inaktiv = { ...daten, antraege: [{ ...daten.antraege[0], aktiv: false }] }
    assert.match(pn.fuellungAntragPruefen(inaktiv, 'offen', '2026-09-25').fehler, /inaktiv/)
    assert.deepEqual(pn.waehlbareAntraege(daten, '2026-09-25'), ['offen'])
    assert.deepEqual(pn.waehlbareAntraege(mitZugang, '2026-09-25'), [])
  })
  test('Entwurf vor einem Verschnitt angelegt: bleibt verknüpfbar (noch keine Probe)', () => {
    const entwurf = { ...ANTRAG, id: 'entwurf', status: 'entwurf', pruefnummer: null, eingereichtAm: null, bescheidAm: null, angelegtAm: '2026-09-10', mengeLiter: 548 }
    const daten = musterhof({ antraege: [ANTRAG, entwurf] })          // Verschnitt am 25.09.
    assert.deepEqual(pn.fuellungAntragPruefen(daten, 'entwurf', '2026-09-25'), { ok: true, pruefnummer: null })
    assert.deepEqual(pn.waehlbareAntraege(daten, '2026-09-25'), ['entwurf'])
    // Mengenregel gilt weiter
    assert.match(pn.fuellungAntragPruefen(musterhof({ antraege: [{ ...entwurf, mengeLiter: 500 }] }), 'entwurf', '2026-09-25').fehler, /Bestand ist größer als die beantragte Menge/)
  })
  test('Musterhof heute: kein wählbarer Antrag, dafür Hinweis; bis zum Verschnitt der genehmigte', () => {
    assert.deepEqual(pn.waehlbareAntraege(musterhof(), '2026-09-25'), [])
    assert.deepEqual(pn.waehlbareAntraege(musterhof({ bestandLiter: 500, bestandAm: '2026-09-24', zugaenge: [PRESSUNG] }), '2026-09-24'), [ANTRAG_ID])
    assert.equal(pn.chargeHatAntrag(musterhof()), true)
    assert.equal(pn.chargeHatAntrag(musterhof({ antraege: [{ ...ANTRAG, aktiv: false }] })), false)
  })
  test('freie Prüfnummer: nur ohne Antrag der Charge und nie die Nummer einer anderen Charge', () => {
    const mitNummer = [ANTRAG]
    const ohneAntrag = { chargeId: CH_B, bestandLiter: 800, bestandAm: '2026-09-25', antraege: [], zugaenge: [], abfuellungen: [] }
    // Charge B ohne Antrag, stehen gebliebene Nummer von Charge A (auch anders geschrieben) → abgelehnt
    assert.match(pn.freiePruefnummerPruefen('n10716/26', { chargeId: CH_B, charge: ohneAntrag, antraegeMitNummer: mitNummer }), /gehört zum DAC-Antrag „Riesling Ried Pfaffenberg 2025“ einer anderen Charge/)
    // Zukauf mit Prüfnummer des Lieferanten → erlaubt
    assert.equal(pn.freiePruefnummerPruefen('L 4711/25', { chargeId: CH_B, charge: ohneAntrag, antraegeMitNummer: mitNummer }), null)
    // ohne Charge (Altbestand) → erlaubt, außer die Nummer gehört zu einem Antrag
    assert.equal(pn.freiePruefnummerPruefen('L 4711/25', { chargeId: null, charge: null, antraegeMitNummer: mitNummer }), null)
    assert.match(pn.freiePruefnummerPruefen('N 10716/26', { chargeId: null, charge: null, antraegeMitNummer: mitNummer }), /bitte diese Charge wählen/)
    // Charge mit Antrag → Nummer nur aus dem Antrag
    assert.match(pn.freiePruefnummerPruefen('N 10716/26', { chargeId: CH, chargeName: 'Riesling Ried Pfaffenberg', charge: musterhof(), antraegeMitNummer: mitNummer }), /gibt es einen DAC-Antrag – die Prüfnummer kommt aus dem Antrag/)
  })
  test('freie Prüfnummer: Nummer eines inaktiven oder abgelehnten Antrags der EIGENEN Charge → abgelehnt', () => {
    for (const [antrag, zustand] of [[{ ...ANTRAG, aktiv: false }, 'inaktiv'], [{ ...ANTRAG, status: 'abgelehnt' }, 'abgelehnt']]) {
      const daten = musterhof({ antraege: [antrag] })
      assert.equal(pn.chargeHatAntrag(daten), false)                  // Formular zeigt die freie Eingabe
      assert.equal(
        pn.freiePruefnummerPruefen('N 10716/26', { chargeId: CH, charge: daten, antraegeMitNummer: [antrag] }),
        `Die Prüfnummer N 10716/26 gehört zum DAC-Antrag „Riesling Ried Pfaffenberg 2025“ dieser Charge, der ${zustand} ist – sie kann nicht frei eingetragen werden.`,
      )
    }
  })
  test('freie Prüfnummer auf einer Umzugs-Charge: Nummer der Antrags-Charge, wenn sie beim Umzug galt', () => {
    const Z = '33333333-3333-4333-8333-000b00000014'
    const z = { chargeId: Z, bestandLiter: 500, bestandAm: '2026-09-25', antraege: [], zugaenge: [], abfuellungen: [] }
    const p = umzugAm => ({ chargeId: Z, charge: z, antraegeMitNummer: [ANTRAG], herkunft: { daten: musterhof(), name: 'Riesling Ried Pfaffenberg', umzugAm } })
    // Umzug am 10.07. (nach der Einreichung, vor dem Verschnitt): gilt – auch anders geschrieben
    assert.equal(pn.freiePruefnummerPruefen('N 10716/26', p('2026-07-10')), null)
    assert.equal(pn.freiePruefnummerPruefen('n10716/26', p('2026-07-10')), null)
    // Umzug nach dem Verschnitt in die Antrags-Charge
    assert.match(pn.freiePruefnummerPruefen('N 10716/26', p('2026-09-26')), /stammt aus der Charge „Riesling Ried Pfaffenberg“, aus der diese Charge per Umzug hervorging, gilt aber nicht für diesen Wein – .*Verschnitt am 25\.09\.2026/)
    // Umzug vor der Einreichung: der Antrag umfasst den umgezogenen Wein nicht
    assert.match(pn.freiePruefnummerPruefen('N 10716/26', p('2026-05-01')), /eingereicht/)
    // ohne Herkunft (z. B. Charge mit Pressung) bleibt es „einer anderen Charge“
    assert.match(pn.freiePruefnummerPruefen('N 10716/26', { ...p('2026-07-10'), herkunft: null }), /einer anderen Charge/)
  })
  test('Umzugs-Charge: Gültigkeit am ersten UND am letzten Umzugstag', () => {
    const Z = '33333333-3333-4333-8333-000b00000014'
    const z = { chargeId: Z, bestandLiter: 500, bestandAm: '2026-09-25', antraege: [], zugaenge: [], abfuellungen: [] }
    const p = (ersterUmzugAm, umzugAm, daten = musterhof()) => ({ chargeId: Z, charge: z, antraegeMitNummer: [ANTRAG], herkunft: { daten, name: 'Riesling Ried Pfaffenberg', umzugAm, ersterUmzugAm } })
    // Teil vor der Einreichung (01.05.), Rest danach (10.07.): der frühere Teil ist nicht vom Antrag erfasst
    assert.match(pn.freiePruefnummerPruefen('N 10716/26', p('2026-05-01', '2026-07-10')), /gilt nicht für den Wein, der am 01\.05\.2026 umgezogen wurde: Der DAC-Antrag wurde erst am 20\.05\.2026 eingereicht/)
    // Zukauf in die Antrags-Charge zwischen den Umzügen (nach der Einreichung): letzter Umzug ungültig
    const zukauf = musterhof({ zugaenge: [PRESSUNG, { art: 'zukauf', datum: '2026-06-01' }] })
    assert.match(pn.freiePruefnummerPruefen('N 10716/26', p('2026-05-25', '2026-07-10', zukauf)), /am 10\.07\.2026 umgezogen wurde: Zukauf am 01\.06\.2026/)
    // beide Umzüge nach der Einreichung, nichts dazwischen → gilt
    assert.equal(pn.freiePruefnummerPruefen('N 10716/26', p('2026-05-25', '2026-07-10')), null)
  })
  test('Umzugs-Charge: Mengenregel – Antrag über eine Teilmenge lässt sich per Umzug nicht strecken', () => {
    const Z = '33333333-3333-4333-8333-000b00000014'
    const z = { chargeId: Z, bestandLiter: 500, bestandAm: '2026-09-25', antraege: [], zugaenge: [], abfuellungen: [] }
    // Charge A: 1.500 l, Antrag über 1.000 l (eingereicht 01.09.), heute 500 l nach Z umgezogen → A 1.000 l
    const teil = { ...ANTRAG, mengeLiter: 1000, eingereichtAm: '2026-09-01', bescheidAm: '2026-09-10', angelegtAm: '2026-09-01' }
    const a = (extra = {}) => musterhof({ antraege: [teil], zugaenge: [PRESSUNG], abfuellungen: [], bestandLiter: 1000, ...extra })
    const p = (daten, umzugAm, umzuegeAus) => ({ chargeId: Z, charge: z, antraegeMitNummer: [teil], herkunft: { daten, name: 'A', umzugAm, ersterUmzugAm: umzugAm, umzuegeAus } })
    // A selbst: 1.000 l ≤ 1.000 l → gilt (Umzüge zählen dort nicht – der Überschuss darf weg)
    assert.equal(pn.pruefnummerGueltig(a(), '2026-09-25').gueltig, true)
    // Z: 1.000 l in A + 500 l umgezogen > 1.000 l beantragt → abgelehnt, heute wie bei einem früheren Umzugstag
    for (const tag of ['2026-09-25', '2026-09-12']) {
      assert.match(pn.freiePruefnummerPruefen('N 10716/26', p(a(), tag, [{ datum: tag, liter: 500 }])),
        /gilt aber nicht für diesen Wein – der DAC-Antrag umfasst 1\.000,00 l; seither wurden 500,00 l aus ihr umgezogen, 1\.000,00 l liegen noch in ihr – zusammen mehr als beantragt\.$/, tag)
    }
    // alles umgezogen (A leer): 1.500 l > 1.000 l
    assert.match(pn.freiePruefnummerPruefen('N 10716/26', p(a({ bestandLiter: 0 }), '2026-09-25', [{ datum: '2026-09-25', liter: 1500 }])), /seither wurden 1\.500,00 l aus ihr umgezogen – zusammen mehr als beantragt/)
    // Antrag über die ganze Menge → gilt; Umzug am Einreichungstag zählt mit
    assert.equal(pn.freiePruefnummerPruefen('N 10716/26', p(a({ antraege: [{ ...teil, mengeLiter: 1500 }] }), '2026-09-25', [{ datum: '2026-09-25', liter: 500 }])), null)
    assert.match(pn.freiePruefnummerPruefen('N 10716/26', p(a(), '2026-09-01', [{ datum: '2026-09-01', liter: 500 }])), /zusammen mehr als beantragt/)
    // Umzug vor der Einreichung zählt nicht (der Antrag betraf dann nur den Rest)
    const vorher = { ...p(a({ antraege: [{ ...teil, mengeLiter: 1500 }] }), '2026-09-25', [{ datum: '2026-08-01', liter: 400 }, { datum: '2026-09-25', liter: 500 }]) }
    assert.equal(pn.freiePruefnummerPruefen('N 10716/26', vorher), null)
    // Zugang in A nach dem Umzug: A trägt die Nummer nicht mehr, ihr Bestand zählt nicht
    const danach = a({ zugaenge: [PRESSUNG, { art: 'verschnitt', datum: '2026-09-20' }], bestandLiter: 1048 })
    assert.equal(pn.freiePruefnummerPruefen('N 10716/26', p(danach, '2026-09-12', [{ datum: '2026-09-12', liter: 1000 }])), null)
    // … ebenso, was danach aus ihr abgefüllt oder umgezogen wurde (Wein mit dem Zugang, ohne Verknüpfung)
    const weiter = a({ zugaenge: [PRESSUNG, { art: 'verschnitt', datum: '2026-09-20' }], bestandLiter: 0, abfuellungen: [{ datum: '2026-09-22', liter: 600, dacAntragId: null }] })
    assert.equal(pn.freiePruefnummerPruefen('N 10716/26', p(weiter, '2026-09-12', [{ datum: '2026-09-12', liter: 500 }, { datum: '2026-09-23', liter: 100 }])), null)
    // eine mit dem Antrag verknüpfte Füllung zählt immer
    const verknuepft = a({ zugaenge: [PRESSUNG, { art: 'verschnitt', datum: '2026-09-20' }], bestandLiter: 0, abfuellungen: [{ datum: '2026-09-15', liter: 600, dacAntragId: ANTRAG_ID }] })
    assert.match(pn.freiePruefnummerPruefen('N 10716/26', p(verknuepft, '2026-09-12', [{ datum: '2026-09-12', liter: 500 }])), /500,00 l aus ihr umgezogen und 600,00 l abgefüllt – zusammen mehr als beantragt/)
    // Rest der Antrags-Charge danach offen (Tank) verkauft: zählt wie eine Füllung – sonst gäbe der
    // Verkauf (TBS mit der Nummer der Antrags-Charge) die Nummer ein zweites Mal frei
    const verkauft = a({ bestandLiter: 0, tankverkaeufe: [{ datum: '2026-09-13', liter: 1000 }] })
    assert.match(pn.freiePruefnummerPruefen('N 10716/26', p(verkauft, '2026-09-12', [{ datum: '2026-09-12', liter: 500 }])),
      /der DAC-Antrag umfasst 1\.000,00 l; seither wurden 500,00 l aus ihr umgezogen und 1\.000,00 l offen \(Tank\) verkauft – zusammen mehr als beantragt\.$/)
    const alles = a({ bestandLiter: 0, tankverkaeufe: [{ datum: '2026-09-13', liter: 200 }], abfuellungen: [{ datum: '2026-09-14', liter: 600, dacAntragId: ANTRAG_ID }] })
    assert.match(pn.freiePruefnummerPruefen('N 10716/26', p(alles, '2026-09-12', [{ datum: '2026-09-12', liter: 500 }])), /500,00 l aus ihr umgezogen, 200,00 l offen \(Tank\) verkauft und 600,00 l abgefüllt – zusammen/)
    // Verkauf vor der Einreichung bzw. nach einem Zugang in A zählt nicht
    const frueh = a({ antraege: [{ ...teil, mengeLiter: 1500 }], tankverkaeufe: [{ datum: '2026-08-15', liter: 400 }] })
    assert.equal(pn.freiePruefnummerPruefen('N 10716/26', p(frueh, '2026-09-25', [{ datum: '2026-09-25', liter: 500 }])), null)
    const spaet = a({ zugaenge: [PRESSUNG, { art: 'verschnitt', datum: '2026-09-20' }], bestandLiter: 748, tankverkaeufe: [{ datum: '2026-09-22', liter: 300 }] })
    assert.equal(pn.freiePruefnummerPruefen('N 10716/26', p(spaet, '2026-09-12', [{ datum: '2026-09-12', liter: 1000 }])), null)
  })
})

// ── 2. Lader, Blend-Protokoll, TBS gegen eine Attrappe ───────────────────────

function attrappe(tabellen) {
  const log = []
  function from(tabelle) {
    const filter = []
    let einzel = false
    const b = {
      select() { return b }, range() { return b }, limit() { return b }, order() { return b },
      eq(k, v) { filter.push(['eq', k, v]); return b },
      neq(k, v) { filter.push(['neq', k, v]); return b },
      in(k, v) { filter.push(['in', k, v]); return b },
      is(k, v) { filter.push(['is', k, v]); return b },
      gte(k, v) { filter.push(['gte', k, v]); return b },
      lte(k, v) { filter.push(['lte', k, v]); return b },
      not(k, op) { filter.push([op === 'is' ? 'nichtNull' : 'x', k]); return b },
      maybeSingle() { einzel = true; return b },
      single() { einzel = true; return b },
      then(ok, fehler) {
        log.push({ tabelle, filter: [...filter] })
        let rows = (tabellen[tabelle] ?? []).slice()
        for (const [op, k, v] of filter) {
          rows = rows.filter(r => {
            const x = r[k]
            if (op === 'eq') return x === v
            if (op === 'neq') return x !== v
            if (op === 'in') return v.includes(x)
            if (op === 'is') return v === null ? x == null : x === v
            if (op === 'gte') return x != null && x >= v
            if (op === 'lte') return x != null && x <= v
            if (op === 'nichtNull') return x != null
            return true
          })
        }
        return Promise.resolve({ data: einzel ? (rows[0] ?? null) : rows, error: null }).then(ok, fehler)
      },
    }
    return b
  }
  return { from, rpc: () => Promise.resolve({ data: [], error: null }), log }
}

/** Jede Abfrage auf eine mandantenbezogene Tabelle trägt .eq('tenant_id', T) */
function mandantGefiltert(sb, ohne = ['pressung_behaelter', 'verschneidung_quellen']) {
  for (const a of sb.log) {
    if (ohne.includes(a.tabelle)) continue
    assert.ok(a.filter.some(([op, k, v]) => op === 'eq' && k === 'tenant_id' && v === T), `Abfrage auf ${a.tabelle} ohne Mandantenfilter`)
  }
}

function dbMusterhof() {
  return {
    dac_antrag: [
      { id: ANTRAG_ID, tenant_id: T, weinausbau_id: CH, bezeichnung: 'Riesling Ried Pfaffenberg 2025', status: 'genehmigt', aktiv: true, pruefnummer: 'N 10716/26', menge_liter: '5000.00', eingereicht_am: '2026-05-20', bescheid_am: '2026-06-08', created_at: '2026-05-20T00:00:00+00:00' },
      // anderer Betrieb, gleiche Charge-ID (Mehrfach-Mitgliedschaft) – darf nicht zählen
      { id: FREMD_ANTRAG_ID, tenant_id: X, weinausbau_id: CH, status: 'genehmigt', aktiv: true, pruefnummer: 'X 1/26', menge_liter: '9999', eingereicht_am: '2026-09-25', created_at: '2026-09-25T00:00:00+00:00' },
    ],
    weinausbau: [
      { id: CH, tenant_id: T, name: 'Riesling Ried Pfaffenberg', jahrgang: 2025, rebsorte: 'Riesling', qualitaetsstufe: 'qualitaetswein', menge_liter: '548.00', ist_eroeffnungsbestand: false, weinart: 'weiss' },
      { id: CH_B, tenant_id: T, name: 'GV Hohenberg', jahrgang: 2025, rebsorte: 'Grüner Veltliner', menge_liter: '800.00' },
    ],
    verschneidungen: [
      { id: VERSCHNITT_ID, tenant_id: T, datum: '2026-09-25', ziel_weinausbau_id: CH, quellen: [{ quell_weinausbau_id: CH_B, menge_liter: '48' }] },
      // CH als QUELLE eines Verschnitts (Abgang) – steht nur in verschneidung_quellen
      { id: 'v-ab', tenant_id: T, datum: '2026-07-01', ziel_weinausbau_id: CH_B, quellen: [{ quell_weinausbau_id: CH, menge_liter: '10' }] },
    ],
    zukauf_posten: [
      { id: 'zk-inaktiv', tenant_id: T, datum: '2026-07-01', ziel_weinausbau_id: CH, aktiv: false, art: 'wein', menge: '100' },
    ],
    keller_umzuege: [
      // Umzug der Charge in ein anderes Gebinde (Quelle und Ziel dieselbe Charge) – kein Zugang
      { id: 'u1', tenant_id: T, datum: '2026-07-10', zeilen_typ: 'quelle', von_weinausbau_id: CH, nach_weinausbau_id: null, umzug_batch_id: 'B1' },
      { id: 'u2', tenant_id: T, datum: '2026-07-10', zeilen_typ: 'ziel', von_weinausbau_id: null, nach_weinausbau_id: CH, umzug_batch_id: 'B1' },
      // Schwund (Abgang)
      { id: 'u3', tenant_id: T, datum: '2026-08-01', zeilen_typ: 'transfer', umzug_typ: 'schwund', von_weinausbau_id: CH, nach_weinausbau_id: null },
    ],
    pressung_behaelter: [
      { id: 'pb1', weinausbau_id: CH, menge_liter: '5000', pressung: { id: 'p1', datum: '2025-09-28', tenant_id: T, pressung_weingaerten: [] } },
      // Pressung eines anderen Betriebs im selben Gebinde – darf nicht zählen
      { id: 'pb2', weinausbau_id: CH, menge_liter: '10', pressung: { id: 'p2', datum: '2026-08-01', tenant_id: X } },
    ],
    fuellungen: [
      { id: FUELLUNG_ID, tenant_id: T, weinausbau_id: CH, name: 'Riesling Ried Pfaffenberg', chargennummer: 'CH-2026-012', pruefnummer: 'N 10716/26', dac_antrag_id: ANTRAG_ID, jahrgang: 2025, rebsorte: 'Riesling', qualitaet: 'qualitaetswein', datum: '2026-06-20', anzahl_flaschen: 6000, flaschengroesse_ml: 750, menge_liter_gefuellt: '4500.00', aktiv: true },
    ],
    fuellung_chargen: [
      { id: 'fc1', tenant_id: T, fuellung_id: FUELLUNG_ID, weinausbau_id: CH, anteil_liter: '4500.00', fuellung: { datum: '2026-06-20', aktiv: true, dac_antrag_id: ANTRAG_ID } },
    ],
    verkauf_positionen: [],
  }
}

/** Meldung wie die Route ausführen: parameter → laden → csvDatei → Dateiname */
async function ausfuehren(id, query, supabase) {
  const m = M[id]
  const p = m.parameter(new URLSearchParams(query))
  if (typen.istParameterFehler(p)) throw new Error(p.fehler)
  const e = await m.laden({ supabase, tenantId: T, membership: { tenantId: T, role: 'tenant_admin', schreibmodule: [] }, betrieb: BETRIEB }, p)
  const datei = csv.csvDatei(e.zeilen, m.spalten, m.profil ?? csv.PROFIL_EXCEL_AT)
  return { ...datei, warnungen: [...(e.warnungen ?? []), ...datei.warnungen], dateiname: csv.csvDateiname(m.dateiteile(p, BETRIEB), '2026-09-25') }
}

const zelle = (text, zeile, kopf) => {
  const z = text.replace(/^﻿/, '').split('\r\n').map(l => l.split(';'))
  const i = z[0].indexOf(kopf)
  assert.ok(i >= 0, `Spalte „${kopf}“ fehlt`)
  return z[zeile][i]
}

describe('Lader ladePruefnummerDaten', () => {
  test('Musterhof: Verschnitt als Ziel, Pressung als Herkunft; Abgänge, inaktive Zukäufe, fremde Betriebe zählen nicht', async () => {
    const sb = attrappe(dbMusterhof())
    const daten = await laden.ladePruefnummerDaten(sb, T, [CH, CH_B, 'keine-uuid', null], { heute: '2026-09-25' })
    assert.deepEqual([...daten.keys()].sort(), [CH, CH_B].sort())
    const d = daten.get(CH)
    assert.deepEqual(d.antraege.map(a => a.id), [ANTRAG_ID])
    assert.equal(d.antraege[0].angelegtAm, '2026-05-20')
    assert.equal(d.antraege[0].mengeLiter, 5000)
    assert.deepEqual(d.zugaenge.map(z => [z.art, z.datum]).sort(), [['pressung', '2025-09-28'], ['verschnitt', '2026-09-25']])
    assert.deepEqual(d.abfuellungen, [{ id: FUELLUNG_ID, datum: '2026-06-20', liter: 4500, dacAntragId: ANTRAG_ID }])   // einmal, nicht doppelt
    assert.deepEqual([d.bestandLiter, d.bestandAm], [548, '2026-09-25'])
    const e = pn.pruefnummerGueltig(d, '2026-09-25')
    assert.deepEqual([e.gueltig, e.grund, e.ereignisDatum], [false, 'verschnitt', '2026-09-25'])
    // Charge ohne Antrag: keine weiteren Abfragen nötig
    assert.deepEqual(daten.get(CH_B).antraege, [])
    mandantGefiltert(sb)
  })
  test('Umzug aus einer anderen Charge nach der Einreichung → Zugang', async () => {
    const db = dbMusterhof()
    db.verschneidungen = []
    db.keller_umzuege.push(
      { id: 'u4', tenant_id: T, datum: '2026-08-15', zeilen_typ: 'quelle', von_weinausbau_id: CH_B, nach_weinausbau_id: null, umzug_batch_id: 'B2' },
      { id: 'u5', tenant_id: T, datum: '2026-08-15', zeilen_typ: 'ziel', von_weinausbau_id: null, nach_weinausbau_id: CH, umzug_batch_id: 'B2' },
    )
    const d = (await laden.ladePruefnummerDaten(attrappe(db), T, [CH], { heute: '2026-09-25' })).get(CH)
    const e = pn.pruefnummerGueltig(d, '2026-09-25')
    assert.deepEqual([e.grund, e.ereignisDatum], ['zugang', '2026-08-15'])
  })
  test('Tankverkäufe aus der Charge mit Verkaufsdatum – stornierte, Flaschen und fremde Betriebe nicht', async () => {
    const db = dbMusterhof()
    db.verkauf_positionen = [
      { id: 'vp1', tenant_id: T, typ: 'tank', weinausbau_id: CH, menge: '200.00', verkaufsposten: { datum: '2026-09-20', storniert: false } },
      { id: 'vp2', tenant_id: T, typ: 'tank', weinausbau_id: CH, menge: '50', verkaufsposten: { datum: '2026-09-21', storniert: true } },
      { id: 'vp3', tenant_id: T, typ: 'flasche', weinausbau_id: null, menge: '12', verkaufsposten: { datum: '2026-09-21', storniert: false } },
      { id: 'vp4', tenant_id: X, typ: 'tank', weinausbau_id: CH, menge: '999', verkaufsposten: { datum: '2026-09-21', storniert: false } },
    ]
    const sb = attrappe(db)
    const d = (await laden.ladePruefnummerDaten(sb, T, [CH], { heute: '2026-09-25' })).get(CH)
    assert.deepEqual(d.tankverkaeufe, [{ datum: '2026-09-20', liter: 200 }])
    mandantGefiltert(sb)
  })
})

// Umzug in ein leeres Gebinde legt eine neue Charge an (umziehen/actions.ts, gebinde-actions.ts)
const Z = '33333333-3333-4333-8333-000b00000014'   // Abfülltank nach Filtration
const Y = '33333333-3333-4333-8333-000b00000015'   // Zwischenstation
function umzug(db, von, nach, datum, batch, liter = 500) {
  if (!db.weinausbau.some(w => w.id === nach)) db.weinausbau.push({ id: nach, tenant_id: T, name: `Umzug ${batch}`, menge_liter: '500.00', anfangsbestand_liter: null, ist_eroeffnungsbestand: false })
  db.keller_umzuege.push(
    { id: `${batch}-q`, tenant_id: T, datum, zeilen_typ: 'quelle', von_weinausbau_id: von, nach_weinausbau_id: null, umzug_batch_id: batch, menge_liter: String(liter) },
    { id: `${batch}-z`, tenant_id: T, datum, zeilen_typ: 'ziel', von_weinausbau_id: null, nach_weinausbau_id: nach, umzug_batch_id: batch, menge_liter: String(liter) },
  )
  return db
}

describe('Umzugsherkunft (ladeUmzugsherkunft) – Prüfnummer nach Abstich/Filtration', () => {
  test('Charge nur per Umzug aus der Antrags-Charge: Herkunft mit letztem Umzugstag, auch über zwei Umzüge', async () => {
    const sb = attrappe(umzug(dbMusterhof(), CH, Z, '2026-07-10', 'B3'))
    const h = await laden.ladeUmzugsherkunft(sb, T, Z, { heute: '2026-09-25' })
    assert.equal(h.daten.chargeId, CH)
    assert.equal(h.name, 'Riesling Ried Pfaffenberg')
    assert.equal(h.umzugAm, '2026-07-10')
    mandantGefiltert(sb)
    const kette = umzug(umzug(dbMusterhof(), CH, Y, '2026-07-10', 'B3'), Y, Z, '2026-07-20', 'B4')
    const h2 = await laden.ladeUmzugsherkunft(attrappe(kette), T, Z, { heute: '2026-09-25' })
    assert.deepEqual([h2.daten.chargeId, h2.umzugAm], [CH, '2026-07-10'])
  })
  test('erster und letzter Umzug; in einer Kette nur Umzüge bis zum Umzug ins nächste Glied', async () => {
    // Teilumzug 01.05., Rest 10.07. in dieselbe Charge
    const zwei = umzug(umzug(dbMusterhof(), CH, Z, '2026-05-01', 'B5', 200), CH, Z, '2026-07-10', 'B6', 300)
    const h = await laden.ladeUmzugsherkunft(attrappe(zwei), T, Z, { heute: '2026-09-25' })
    assert.deepEqual([h.ersterUmzugAm, h.umzugAm], ['2026-05-01', '2026-07-10'])
    // Kette: A→Y 01.05., Y→Z 01.06., A→Y 10.07. – der Wein von Z verließ Y am 01.06.
    const kette = umzug(umzug(umzug(dbMusterhof(), CH, Y, '2026-05-01', 'B7'), Y, Z, '2026-06-01', 'B8'), CH, Y, '2026-07-10', 'B9')
    const k = await laden.ladeUmzugsherkunft(attrappe(kette), T, Z, { heute: '2026-09-25' })
    assert.deepEqual([k.daten.chargeId, k.ersterUmzugAm, k.umzugAm], [CH, '2026-05-01', '2026-05-01'])
    // später in Y aus einer anderen Charge zugeführt: betrifft den Wein von Z nicht
    const spaeter = umzug(umzug(umzug(dbMusterhof(), CH, Y, '2026-07-01', 'B7'), Y, Z, '2026-07-05', 'B8'), CH_B, Y, '2026-08-01', 'B9')
    assert.equal((await laden.ladeUmzugsherkunft(attrappe(spaeter), T, Z, { heute: '2026-09-25' })).daten.chargeId, CH)
  })
  test('Umzüge aus der Antrags-Charge für die Mengenregel: je Batch, ohne Anteil zurück, ohne Schwund', async () => {
    const db = umzug(umzug(dbMusterhof(), CH, Z, '2026-07-10', 'B3', 300), CH, Y, '2026-08-01', 'B4', 150)
    // B1 (dbMusterhof): Umzug innerhalb der Charge, u3: Schwund – beide keine Abgänge
    db.keller_umzuege.find(u => u.id === 'u1').menge_liter = '80'
    db.keller_umzuege.find(u => u.id === 'u2').menge_liter = '80'
    db.keller_umzuege.find(u => u.id === 'u3').menge_liter = '5'
    // ältere Zeile mit von_ und nach_
    db.keller_umzuege.push({ id: 'alt1', tenant_id: T, datum: '2026-06-01', zeilen_typ: 'transfer', von_weinausbau_id: CH, nach_weinausbau_id: CH_B, menge_liter: '20' })
    const sb = attrappe(db)
    const h = await laden.ladeUmzugsherkunft(sb, T, Z, { heute: '2026-09-25' })
    assert.deepEqual(h.umzuegeAus.map(u => [u.datum, u.liter]).sort(), [['2026-06-01', 20], ['2026-07-10', 300], ['2026-08-01', 150]])
    mandantGefiltert(sb)
  })
  test('keine Herkunft bei eigenem Wein, Verschnitt, Zukauf, Pressung oder mehreren Quellen', async () => {
    const faelle = {
      anfangsbestand: db => { db.weinausbau.find(w => w.id === Z).anfangsbestand_liter = '200' },
      verschnitt: db => { db.verschneidungen.push({ id: 'v-z', tenant_id: T, datum: '2026-08-01', ziel_weinausbau_id: Z }) },
      zukauf: db => { db.zukauf_posten.push({ id: 'zk-z', tenant_id: T, datum: '2026-08-01', ziel_weinausbau_id: Z, aktiv: true }) },
      pressung: db => { db.pressung_behaelter.push({ id: 'pb-z', weinausbau_id: Z, pressung: { id: 'p3', datum: '2026-08-01', tenant_id: T } }) },
      zusammenfuehrung: db => { db.keller_umzuege.push({ id: 'B3-q2', tenant_id: T, datum: '2026-07-10', zeilen_typ: 'quelle', von_weinausbau_id: CH_B, umzug_batch_id: 'B3' }) },
    }
    for (const [name, aendern] of Object.entries(faelle)) {
      const db = umzug(dbMusterhof(), CH, Z, '2026-07-10', 'B3')
      aendern(db)
      assert.equal(await laden.ladeUmzugsherkunft(attrappe(db), T, Z, { heute: '2026-09-25' }), null, name)
    }
    // Pressung eines anderen Betriebs im selben Gebinde zählt nicht
    const fremd = umzug(dbMusterhof(), CH, Z, '2026-07-10', 'B3')
    fremd.pressung_behaelter.push({ id: 'pb-x', weinausbau_id: Z, pressung: { id: 'p4', datum: '2026-08-01', tenant_id: X } })
    assert.notEqual(await laden.ladeUmzugsherkunft(attrappe(fremd), T, Z, { heute: '2026-09-25' }), null)
  })
})

describe('Blend-Protokoll (Charge und Füllung)', () => {
  test('Charge „Riesling Ried Pfaffenberg“: keine Prüfnummer, Hinweis mit Verschnittdatum, CSV-Spalte leer, Dateiname ohne Nummer', async () => {
    const blend = await import('../../src/lib/behoerden/blend.ts')
    const sb = attrappe(dbMusterhof())
    const b = await blend.ladeBlendProtokoll(sb, T, { art: 'charge', id: CH })
    assert.equal(b.kopf.pruefnummer, null)
    assert.equal(b.kopf.pruefnummerHinweis, HINWEIS_MUSTERHOF)
    assert.ok(b.warnungen.includes(`${HINWEIS_MUSTERHOF} Die Spalte „Prüfnummer“ bleibt leer.`))
    mandantGefiltert(sb)

    const r = await ausfuehren('blend-protokoll', `charge=${CH}`, attrappe(dbMusterhof()))
    assert.ok(r.zeilen > 0)
    assert.equal(zelle(r.text, 1, 'Prüfnummer'), '')
    assert.ok(!r.text.includes('10716'))
    assert.ok(r.warnungen.some(w => w.includes('Verschnitt am 25.09.2026 (§ 25 Abs. 6 WeinG)')))
    assert.ok(!r.dateiname.utf8.includes('10716'), r.dateiname.utf8)
    assert.equal(r.dateiname.utf8, 'Blend-Protokoll_1234567_Riesling-Ried-Pfaffenberg_2026-09-25.csv')
  })
  test('Füllung CH-2026-012: zeigt weiter N 10716/26 (Stichtag Abfüllung), Dateiname mit Chargennummer', async () => {
    const r = await ausfuehren('blend-protokoll', `fuellung=${FUELLUNG_ID}`, attrappe(dbMusterhof()))
    assert.equal(zelle(r.text, 1, 'Prüfnummer'), 'N 10716/26')
    assert.equal(zelle(r.text, 1, 'Chargennummer'), 'CH-2026-012')
    assert.ok(!r.warnungen.some(w => w.includes('Prüfnummer')))
    assert.equal(r.dateiname.utf8, 'Blend-Protokoll_1234567_CH-2026-012_2026-09-25.csv')
  })
  test('Füllung ohne eigene Nummer: Nummer des genehmigten, aktiven Antrags – sonst leer', async () => {
    const blend = await import('../../src/lib/behoerden/blend.ts')
    const db = dbMusterhof()
    db.fuellungen[0] = { ...db.fuellungen[0], pruefnummer: null }
    assert.equal((await blend.ladeBlendProtokoll(attrappe(db), T, { art: 'fuellung', id: FUELLUNG_ID })).kopf.pruefnummer, 'N 10716/26')
    db.dac_antrag[0] = { ...db.dac_antrag[0], aktiv: false }
    assert.equal((await blend.ladeBlendProtokoll(attrappe(db), T, { art: 'fuellung', id: FUELLUNG_ID })).kopf.pruefnummer, null)
    // Antrag in /dac auf eine andere Charge umgehängt: keine Ersatznummer
    db.dac_antrag[0] = { ...db.dac_antrag[0], aktiv: true, weinausbau_id: CH_B }
    assert.equal((await blend.ladeBlendProtokoll(attrappe(db), T, { art: 'fuellung', id: FUELLUNG_ID })).kopf.pruefnummer, null)
  })
  test('Füllung ohne eigene Nummer, abgefüllt vor der Einreichung mit Verschnitt dazwischen: keine Ersatznummer, Warnung', async () => {
    const blend = await import('../../src/lib/behoerden/blend.ts')
    const db = dbMusterhof()
    db.fuellungen[0] = { ...db.fuellungen[0], pruefnummer: null, datum: '2026-05-10' }
    db.verschneidungen.push({ id: 'v-mai', tenant_id: T, datum: '2026-05-15', ziel_weinausbau_id: CH })
    const sb = attrappe(db)
    const b = await blend.ladeBlendProtokoll(sb, T, { art: 'fuellung', id: FUELLUNG_ID })
    assert.equal(b.kopf.pruefnummer, null)
    assert.match(b.kopf.pruefnummerHinweis, /Die Abfüllung am 10\.05\.2026 liegt vor der Einreichung .*Verschnitt am 15\.05\.2026/)
    assert.ok(b.warnungen.some(w => w.endsWith('Die Spalte „Prüfnummer“ bleibt leer.')), b.warnungen.join(' | '))
    mandantGefiltert(sb)
  })
  test('Charge mit gültigem Antrag (vor dem Verschnitt) zeigt die Nummer', async () => {
    const blend = await import('../../src/lib/behoerden/blend.ts')
    const db = dbMusterhof()
    db.verschneidungen = db.verschneidungen.filter(v => v.id !== VERSCHNITT_ID)
    db.weinausbau[0] = { ...db.weinausbau[0], menge_liter: '500.00' }
    const b = await blend.ladeBlendProtokoll(attrappe(db), T, { art: 'charge', id: CH })
    assert.equal(b.kopf.pruefnummer, 'N 10716/26')
    assert.equal(b.kopf.pruefnummerHinweis, null)
  })
})

describe('Transportbescheinigung: Tankverkauf aus der Charge', () => {
  const CFG = { tenant_id: T, betrieb_name: 'Weingut Musterhof', betrieb_ort: 'Poysdorf' }
  const posten = datum => ({
    id: '44444444-4444-4444-8444-444444444444', tenant_id: T, aktiv: true, rechnungsnummer: 'RE-2026-0100', datum, storniert: false,
    kontakt: null, firma: { name: 'Weinhandel Huber' },
    positionen: [{ id: 'p1', typ: 'tank', name: 'Riesling Tank', menge: 200, einheit: 'l', weinausbau: { id: CH, name: 'Riesling Ried Pfaffenberg', jahrgang: 2025, qualitaetsstufe: 'qualitaetswein', rebsorte: 'Riesling', weinart: 'weiss', herkunft_code: 'kamptal_gebietswein' } }],
  })
  const PN = { jeWeinausbau: { [CH]: musterhof() }, jeDacAntrag: {} }

  test('Verkauf nach dem Verschnitt: keine Prüfnummer vorbelegt, Hinweis', () => {
    const hinweise = []
    const f = tb.tbVorbelegung(posten('2026-09-25'), CFG, PN, '2026-09-25', hinweise)
    assert.equal(f.positionen[0].pruefnummer, '')
    assert.ok(hinweise.some(h => /^Position 1: Frühere Prüfnummer N 10716\/26 gilt nicht für den Bestand am 25\.09\.2026 \(Verkaufsdatum\): Verschnitt am 25\.09\.2026/.test(h)), hinweise.join(' | '))
  })
  test('Verkauf vor dem Verschnitt: Nummer vorbelegt (Stichtag = Verkaufsdatum)', () => {
    const hinweise = []
    assert.equal(tb.tbVorbelegung(posten('2026-09-01'), CFG, PN, '2026-09-25', hinweise).positionen[0].pruefnummer, 'N 10716/26')
    assert.ok(!hinweise.some(h => h.includes('Prüfnummer')))
  })
  test('Verkauf zwischen Einreichung und Bescheid: Nummer gab es am Transporttag noch nicht', () => {
    const hinweise = []
    assert.equal(tb.tbVorbelegung(posten('2026-06-01'), CFG, PN, '2026-09-25', hinweise).positionen[0].pruefnummer, '')
    assert.deepEqual(hinweise, ['Position 1: Prüfnummer N 10716/26 gilt nicht für den Bestand am 01.06.2026 (Verkaufsdatum): Sie wurde erst mit dem Bescheid vom 08.06.2026 erteilt. Prüfnummer nicht vorbelegt.'])
  })
  test('Mengenregel mit dem Bestand vor dem Verkauf: ganzer Tank über der Antragsmenge verkauft → keine Vorbelegung', () => {
    // Charge 700 l, Antrag über 500 l (eingereicht 01.09., Bescheid 10.09.); heute verkauft – der Bestand ist schon gemindert
    const teil = { ...ANTRAG, mengeLiter: 500, eingereichtAm: '2026-09-01', bescheidAm: '2026-09-10', angelegtAm: '2026-09-01' }
    const pnMit = (tankverkaeufe, bestandLiter = 0) => ({ jeWeinausbau: { [CH]: musterhof({ antraege: [teil], zugaenge: [PRESSUNG], abfuellungen: [], bestandLiter, tankverkaeufe }) }, jeDacAntrag: {} })
    const verkauf = menge => ({ ...posten('2026-09-25'), positionen: [{ ...posten('2026-09-25').positionen[0], menge }] })
    let h = []
    assert.equal(tb.tbVorbelegung(verkauf(700), CFG, pnMit([{ datum: '2026-09-25', liter: 700 }]), '2026-09-25', h).positionen[0].pruefnummer, '')
    assert.deepEqual(h, ['Position 1: Frühere Prüfnummer N 10716/26 gilt nicht für den Bestand am 25.09.2026 (Verkaufsdatum): 700,00 l Bestand, beantragt waren 500,00 l, davon 0,00 l abgefüllt – höchstens 500,00 l tragen die Nummer. Prüfnummer nicht vorbelegt.'])
    // Überschuss schon vorher verkauft, heute der Rest von 500 l → Nummer
    h = []
    assert.equal(tb.tbVorbelegung(verkauf(500), CFG, pnMit([{ datum: '2026-09-24', liter: 200 }, { datum: '2026-09-25', liter: 500 }]), '2026-09-25', h).positionen[0].pruefnummer, 'N 10716/26')
    assert.deepEqual(h, [])
    // zwei Verkäufe am selben Tag (Reihenfolge unbekannt): beide ohne Nummer
    h = []
    assert.equal(tb.tbVorbelegung(verkauf(350), CFG, pnMit([{ datum: '2026-09-25', liter: 350 }, { datum: '2026-09-25', liter: 350 }]), '2026-09-25', h).positionen[0].pruefnummer, '')
    // Verkauf in der Vergangenheit: Mengenregel wie bisher nicht geprüft, nichts zurückgerechnet
    assert.equal(pn.bestandVorVerkauf(pnMit([{ datum: '2026-09-20', liter: 700 }]).jeWeinausbau[CH], '2026-09-20').bestandLiter, 0)
  })
  test('KAN-90: Flaschenposition kommt nicht auf die TBS (keine TBS für Flaschenwein, Entscheidung 06.10.2026)', () => {
    const fl = { id: '44444444-4444-4444-8444-444444444445', tenant_id: T, aktiv: true, rechnungsnummer: 'RE-2026-0101', datum: '2026-09-26', storniert: false, kontakt: null, firma: { name: 'Weinhandel Huber' },
      positionen: [{ id: 'p3', typ: 'flasche', name: 'Riesling', menge: 12, fuellung: { id: FUELLUNG_ID, rebsorte: 'Riesling', flaschengroesse_ml: 750, datum: '2026-09-26', pruefnummer: null, dac_antrag_id: ANTRAG_ID, weinausbau_id: CH } }] }
    const h = []
    const f = tb.tbVorbelegung(fl, CFG, { jeWeinausbau: {} }, '2026-09-26', h)
    assert.deepEqual(f.positionen, [tb.TB_LEERE_POSITION])   // nur die leere Formularzeile
    assert.deepEqual(h, [])
    assert.deepEqual([...tb.TB_POSITIONSTYPEN], ['tank', 'trauben'])
  })
  test('Zeitraumliste: Prüfnummern-Hinweis je Beleg in den Warnungen', async () => {
    const db = { ...dbMusterhof(), verkaufsposten: [{ ...posten('2026-09-25'), aktiv: true }], tenant_einstellungen: [CFG], transportbescheinigungen: [] }
    const r = await tb.ladeTransportbescheinigungen(attrappe(db), T, { von: '2026-09-01', bis: '2026-09-30' })
    assert.equal(r.zeilen[0].pruefnummer, null)
    assert.ok(r.warnungen.some(w => /^RE-2026-0100: Position 1: Frühere Prüfnummer N 10716\/26 gilt nicht .*Verschnitt am 25\.09\.2026 .*Prüfnummer nicht vorbelegt\.$/.test(w)), r.warnungen.join(' | '))
  })
  test('Ladefunktion: dieselbe Regel, Hinweis in den Warnungen und für die Druckseite', async () => {
    const db = { ...dbMusterhof(), verkaufsposten: [posten('2026-09-25')], tenant_einstellungen: [CFG], transportbescheinigungen: [] }
    const sb = attrappe(db)
    const r = await tb.ladeTransportbescheinigung(sb, T, { id: '44444444-4444-4444-8444-444444444444' })
    assert.equal(r.formular.positionen[0].pruefnummer, '')
    assert.equal(r.zeilen[0].pruefnummer, null)
    assert.ok(r.warnungen.some(w => w.includes('Verschnitt am 25.09.2026')))
    assert.ok(r.vorbelegungHinweise.some(w => w.includes('Verschnitt am 25.09.2026')))
    mandantGefiltert(sb)
  })
})

describe('Server-Prüfung der Füllung (pruefnummerFuerFuellung, createFuellung)', () => {
  const pruefen = (eingabe, p, db = dbMusterhof()) => laden.pruefnummerFuerFuellung(attrappe(db), T,
    { dacAntragId: null, pruefnummer: null, ...eingabe },
    { weinausbauId: CH, chargeName: 'Riesling Ried Pfaffenberg', abfuelldatum: '2026-09-25', heute: '2026-09-25', ...p })
  const aktionsFehler = muster => e => e.name === 'AktionsFehler' && muster.test(e.message)
  /** Musterhof am 24.09.: vor dem Verschnitt, Rest 500 l */
  const vorVerschnitt = () => {
    const db = dbMusterhof()
    db.verschneidungen = db.verschneidungen.filter(v => v.id !== VERSCHNITT_ID)
    db.weinausbau[0] = { ...db.weinausbau[0], menge_liter: '500.00' }
    return db
  }

  test('Wechsel von Charge A (genehmigt) zu Charge B ohne Antrag: Formular sendet nichts → Füllung B ohne Prüfnummer', async () => {
    assert.deepEqual(await pruefen({}, { weinausbauId: CH_B, chargeName: 'GV Hohenberg' }), { pruefnummer: null, dacAntragId: null })
  })
  test('stehen gebliebene Nummer von Charge A mit Charge B (alter Client) → abgelehnt', async () => {
    await assert.rejects(pruefen({ pruefnummer: 'N 10716/26' }, { weinausbauId: CH_B }), aktionsFehler(/einer anderen Charge/))
  })
  test('fremde oder nicht passende dac_antrag_id → abgelehnt, kein Speichern', async () => {
    // Antrag eines anderen Betriebs (gleiche Charge-ID)
    await assert.rejects(pruefen({ dacAntragId: FREMD_ANTRAG_ID }), aktionsFehler(/gehört nicht zur gewählten Kellerbuch-Charge/))
    // Antrag von Charge A, gewählt ist Charge B
    await assert.rejects(pruefen({ dacAntragId: ANTRAG_ID }, { weinausbauId: CH_B }), aktionsFehler(/gehört nicht zur gewählten Kellerbuch-Charge/))
    // Antrag ohne Charge, ungültige ID
    await assert.rejects(pruefen({ dacAntragId: ANTRAG_ID }, { weinausbauId: null }), aktionsFehler(/nur zusammen mit seiner Kellerbuch-Charge/))
    await assert.rejects(pruefen({ dacAntragId: 'abc' }), aktionsFehler(/ungültig/))
  })
  test('passender Antrag: Nummer aus dem Antrag, nicht aus dem Formular', async () => {
    assert.deepEqual(await pruefen({ dacAntragId: ANTRAG_ID, pruefnummer: 'GEFÄLSCHT 1/26' }, { abfuelldatum: '2026-09-24', heute: '2026-09-24' }, vorVerschnitt()),
      { pruefnummer: 'N 10716/26', dacAntragId: ANTRAG_ID })
  })
  test('Musterhof nach dem Verschnitt: Antrag nicht mehr verknüpfbar – auch nicht rückdatiert', async () => {
    for (const abfuelldatum of ['2026-09-25', '2026-09-24', '2026-01-01']) {
      await assert.rejects(pruefen({ dacAntragId: ANTRAG_ID }, { abfuelldatum }), aktionsFehler(/Verschnitt am 25\.09\.2026/), abfuelldatum)
    }
  })
  test('freie Eingabe: bewusst erhalten ohne Charge bzw. für Chargen ohne Antrag, gesperrt für Chargen mit Antrag', async () => {
    assert.deepEqual(await pruefen({ pruefnummer: ' L 4711/25 ' }, { weinausbauId: null }), { pruefnummer: 'L 4711/25', dacAntragId: null })
    assert.deepEqual(await pruefen({ pruefnummer: 'L 4711/25' }, { weinausbauId: CH_B }), { pruefnummer: 'L 4711/25', dacAntragId: null })
    await assert.rejects(pruefen({ pruefnummer: 'L 4711/25' }), aktionsFehler(/gibt es einen DAC-Antrag/))
  })
  test('freie Eingabe: Nummer des inaktiven Antrags der eigenen Charge → abgelehnt', async () => {
    const db = dbMusterhof()
    db.dac_antrag[0] = { ...db.dac_antrag[0], aktiv: false }
    await assert.rejects(pruefen({ pruefnummer: 'N 10716/26' }, {}, db), aktionsFehler(/dieser Charge, der inaktiv ist/))
  })
  test('Umzugs-Charge (Filtration in den Abfülltank): Nummer der Antrags-Charge frei eintragbar, wenn sie beim Umzug galt', async () => {
    // Umzug am 10.07. – vor dem Verschnitt in die Antrags-Charge
    assert.deepEqual(await pruefen({ pruefnummer: 'N 10716/26' }, { weinausbauId: Z, chargeName: 'Umzug B3' }, umzug(dbMusterhof(), CH, Z, '2026-07-10', 'B3')),
      { pruefnummer: 'N 10716/26', dacAntragId: null })
    // Umzug erst nach dem Verschnitt
    await assert.rejects(pruefen({ pruefnummer: 'N 10716/26' }, { weinausbauId: Z }, umzug(dbMusterhof(), CH, Z, '2026-09-26', 'B3')), aktionsFehler(/gilt aber nicht für diesen Wein – .*Verschnitt am 25\.09\.2026/))
    // eine andere Nummer eines Antrags bleibt gesperrt
    const db = umzug(dbMusterhof(), CH, Z, '2026-07-10', 'B3')
    db.dac_antrag.push({ id: '33333333-3333-4333-8333-001200000009', tenant_id: T, weinausbau_id: CH_B, status: 'genehmigt', aktiv: true, pruefnummer: 'N 1/26', eingereicht_am: '2026-01-10', created_at: '2026-01-10T00:00:00+00:00' })
    await assert.rejects(pruefen({ pruefnummer: 'N 1/26' }, { weinausbauId: Z }, db), aktionsFehler(/einer anderen Charge/))
  })
  test('Umzugs-Charge: Teil vor der Einreichung umgezogen bzw. Kette nach dem Weiterzug befüllt → abgelehnt', async () => {
    const zwei = umzug(umzug(dbMusterhof(), CH, Z, '2026-05-01', 'B5', 200), CH, Z, '2026-07-10', 'B6', 300)
    zwei.zukauf_posten.push({ id: 'zk-ch', tenant_id: T, datum: '2026-05-10', ziel_weinausbau_id: CH, aktiv: true })
    await assert.rejects(pruefen({ pruefnummer: 'N 10716/26' }, { weinausbauId: Z }, zwei), aktionsFehler(/am 01\.05\.2026 umgezogen wurde: Der DAC-Antrag wurde erst am 20\.05\.2026 eingereicht/))
    const kette = umzug(umzug(umzug(dbMusterhof(), CH, Y, '2026-05-01', 'B7'), Y, Z, '2026-06-01', 'B8'), CH, Y, '2026-07-10', 'B9')
    await assert.rejects(pruefen({ pruefnummer: 'N 10716/26' }, { weinausbauId: Z }, kette), aktionsFehler(/am 01\.05\.2026 umgezogen wurde/))
  })
  test('Umzugs-Charge: Antrag über eine Teilmenge – Abstich des Überschusses bringt die Nummer nicht auf den Überschuss', async () => {
    // Charge A: 1.500 l, Antrag über 1.000 l (eingereicht 01.09.), heute 500 l in ein leeres Gebinde umgezogen
    const teilmenge = (antragLiter, umzugLiter, bestand) => {
      const db = dbMusterhof()
      db.dac_antrag[0] = { ...db.dac_antrag[0], menge_liter: String(antragLiter), eingereicht_am: '2026-09-01', bescheid_am: '2026-09-10', created_at: '2026-09-01T08:00:00+00:00' }
      db.verschneidungen = []
      db.fuellungen = []
      db.fuellung_chargen = []
      db.weinausbau[0] = { ...db.weinausbau[0], menge_liter: String(bestand) }
      return umzug(db, CH, Z, '2026-09-25', 'B10', umzugLiter)
    }
    await assert.rejects(pruefen({ pruefnummer: 'N 10716/26' }, { weinausbauId: Z }, teilmenge(1000, 500, 1000)), aktionsFehler(/zusammen mehr als beantragt/))
    await assert.rejects(pruefen({ pruefnummer: 'N 10716/26' }, { weinausbauId: Z }, teilmenge(1000, 1500, 0)), aktionsFehler(/zusammen mehr als beantragt/))
    assert.deepEqual(await pruefen({ pruefnummer: 'N 10716/26' }, { weinausbauId: Z }, teilmenge(1500, 500, 1000)), { pruefnummer: 'N 10716/26', dacAntragId: null })
    // die Antrags-Charge selbst behält die Nummer für ihren Rest (1.000 l ≤ 1.000 l)
    assert.deepEqual(await pruefen({ dacAntragId: ANTRAG_ID }, {}, teilmenge(1000, 500, 1000)), { pruefnummer: 'N 10716/26', dacAntragId: ANTRAG_ID })
  })
  test('freie Eingabe der gültigen Nummer der Charge (Bot, veralteter Tab): Antrag wird nach derselben Regel verknüpft', async () => {
    assert.deepEqual(await pruefen({ pruefnummer: 'n10716/26' }, { abfuelldatum: '2026-09-24', heute: '2026-09-24' }, vorVerschnitt()),
      { pruefnummer: 'N 10716/26', dacAntragId: ANTRAG_ID })
    // nach dem Verschnitt: Grund statt „Auswahl im Formular“
    await assert.rejects(pruefen({ pruefnummer: 'N 10716/26' }), aktionsFehler(/Verschnitt am 25\.09\.2026/))
    // eine andere Nummer bleibt abgelehnt
    await assert.rejects(pruefen({ pruefnummer: 'N 1/26' }, { abfuelldatum: '2026-09-24', heute: '2026-09-24' }, vorVerschnitt()), aktionsFehler(/gibt es einen DAC-Antrag – die Prüfnummer kommt aus dem Antrag, eine andere Nummer ist nicht zulässig/))
  })
})

describe('Bearbeiten: Abfülldatum geändert (pruefnummerBeiDatumsaenderung, updateFuellung)', () => {
  const aendern = (fuellung, datum, db = dbMusterhof()) => laden.pruefnummerBeiDatumsaenderung(attrappe(db), T,
    { pruefnummer: null, dacAntragId: null, weinausbauId: CH, ...fuellung }, { datum, heute: '2026-09-25' })
  const aktionsFehler = muster => e => e.name === 'AktionsFehler' && muster.test(e.message)

  test('verknüpfter Antrag: neues Datum nach einem Zugang seit der Einreichung → abgelehnt, davor erlaubt', async () => {
    await aendern({ pruefnummer: 'N 10716/26', dacAntragId: ANTRAG_ID }, '2026-06-01')
    await assert.rejects(aendern({ pruefnummer: 'N 10716/26', dacAntragId: ANTRAG_ID }, '2026-09-26'),
      aktionsFehler(/^Das Abfülldatum kann nicht auf den 26\.09\.2026 geändert werden: Die Abfüllung am 26\.09\.2026 liegt nach der Einreichung .*Verschnitt am 25\.09\.2026/))
    // Nummer des genehmigten Antrags ohne Verknüpfung: dieselbe Regel
    await assert.rejects(aendern({ pruefnummer: 'N 10716/26' }, '2026-09-26'), aktionsFehler(/liegt nach der Einreichung/))
  })
  test('Datum vor die Einreichung zurück, Verschnitt dazwischen → abgelehnt', async () => {
    const db = dbMusterhof()
    db.verschneidungen.push({ id: 'v-mai', tenant_id: T, datum: '2026-05-15', ziel_weinausbau_id: CH })
    await assert.rejects(aendern({ dacAntragId: ANTRAG_ID }, '2026-05-10', db), aktionsFehler(/liegt vor der Einreichung .*Verschnitt am 15\.05\.2026.*bitte die Füllung löschen/))
    await aendern({ dacAntragId: ANTRAG_ID }, '2026-05-16', db)
  })
  test('freie Nummer, Entwurf oder ohne Nummer: keine Datumsprüfung', async () => {
    await aendern({ pruefnummer: 'L 4711/25', weinausbauId: CH_B }, '2026-09-26')
    await aendern({ pruefnummer: 'L 4711/25', weinausbauId: null }, '2026-09-26')
    await aendern({}, '2026-09-26')
    const db = dbMusterhof()
    db.dac_antrag[0] = { ...db.dac_antrag[0], status: 'entwurf', pruefnummer: null, eingereicht_am: null, bescheid_am: null }
    await aendern({ dacAntragId: ANTRAG_ID }, '2026-09-26', db)
  })
})

describe('Bearbeiten: Charge nachträglich zugeordnet (pruefnummerBeiChargenzuordnung, updateFuellung)', () => {
  const zuordnen = (fuellung, weinausbauId, db = dbMusterhof(), extra = {}) => laden.pruefnummerBeiChargenzuordnung(attrappe(db), T,
    { pruefnummer: null, dacAntragId: null, ...fuellung }, { weinausbauId, chargeName: 'Riesling Ried Pfaffenberg', heute: '2026-09-25', ...extra })
  const aktionsFehler = muster => e => e.name === 'AktionsFehler' && muster.test(e.message)

  test('Nummer, die zu keinem Antrag gehört (früheres Los), auf eine Charge mit DAC-Antrag oder Entwurf → erlaubt (nichts wird abgebucht)', async () => {
    await zuordnen({ pruefnummer: 'N 9999/25' }, CH)
    const entwurf = dbMusterhof()
    entwurf.dac_antrag[0] = { ...entwurf.dac_antrag[0], status: 'entwurf', pruefnummer: null, eingereicht_am: null, bescheid_am: null }
    await zuordnen({ pruefnummer: 'N 9999/25' }, CH, entwurf)
    // die Nummer eines inaktiven eigenen Antrags bleibt gesperrt
    const inaktiv = dbMusterhof()
    inaktiv.dac_antrag[0] = { ...inaktiv.dac_antrag[0], aktiv: false }
    await assert.rejects(zuordnen({ pruefnummer: 'N 10716/26' }, CH, inaktiv), aktionsFehler(/kann nicht zugeordnet werden: .*dieser Charge, der inaktiv ist/))
  })
  test('Nummer bzw. DAC-Antrag der Charge: nur, wenn das Abfülldatum gegen den Beginn hält', async () => {
    // Abfüllung vor dem Verschnitt (25.09.) → erlaubt; danach enthalten die Flaschen den Verschnitt
    await zuordnen({ pruefnummer: 'N 10716/26' }, CH, dbMusterhof(), { datum: '2026-06-20' })
    await assert.rejects(zuordnen({ pruefnummer: 'N 10716/26' }, CH, dbMusterhof(), { datum: '2026-09-26' }),
      aktionsFehler(/kann nicht zugeordnet werden: Die Abfüllung am 26\.09\.2026 liegt nach der Einreichung des DAC-Antrags „Riesling Ried Pfaffenberg 2025“ am 20\.05\.2026; dazwischen: Verschnitt am 25\.09\.2026/))
    await assert.rejects(zuordnen({ dacAntragId: ANTRAG_ID }, CH, dbMusterhof(), { datum: '2026-09-26' }), aktionsFehler(/liegt nach der Einreichung/))
    // Abfüllung vor der Einreichung mit Verschnitt dazwischen
    const vorher = dbMusterhof()
    vorher.verschneidungen.push({ id: 'v-mai', tenant_id: T, datum: '2026-05-15', ziel_weinausbau_id: CH })
    await assert.rejects(zuordnen({ pruefnummer: 'N 10716/26' }, CH, vorher, { datum: '2026-05-10' }), aktionsFehler(/liegt vor der Einreichung .*Verschnitt am 15\.05\.2026/))
  })
  test('passende Nummer, Charge ohne Antrag, Füllung ohne Nummer → erlaubt', async () => {
    await zuordnen({ pruefnummer: 'N 10716/26' }, CH)
    await zuordnen({ pruefnummer: 'L 4711/25' }, CH_B)
    await zuordnen({}, CH)
  })
  test('Nummer einer anderen Charge bzw. DAC-Antrag einer anderen Charge → abgelehnt', async () => {
    await assert.rejects(zuordnen({ pruefnummer: 'N 10716/26' }, CH_B), aktionsFehler(/kann nicht zugeordnet werden: .*einer anderen Charge/))
    await assert.rejects(zuordnen({ dacAntragId: ANTRAG_ID }, CH_B), aktionsFehler(/DAC-Antrag einer anderen Charge/))
    await zuordnen({ dacAntragId: ANTRAG_ID }, CH)
  })
})

// ── 3. Quelltextprüfungen der Verdrahtung ────────────────────────────────────

describe('Verdrahtung (Quelltext)', () => {
  test('createFuellung: Prüfnummer und DAC-Antrag nur aus der Prüfung, vor jedem Schreibzugriff', () => {
    const s = quelle('src/app/(dashboard)/weinhandel/actions.ts')
    const create = s.slice(s.indexOf('export async function createFuellung'), s.indexOf('export async function updateFuellung'))
    assert.ok(create.length > 0)
    assert.doesNotMatch(create, /pruefnummer:\s*\(formData/)
    assert.doesNotMatch(create, /dac_antrag_id:\s*\(formData/)
    assert.match(create, /const \{ pruefnummer, dacAntragId \} = await pruefnummerFuerFuellung\(supabase, tenantId, \{/)
    assert.match(create, /dacAntragId: String\(formData\.get\('dac_antrag_id'\)/)
    assert.match(create, /abfuelldatum: datum \}\)/)
    assert.match(create, /\n\s+pruefnummer,\s/)
    assert.match(create, /dac_antrag_id:\s+dacAntragId,/)
    const pruefung = create.indexOf('pruefnummerFuerFuellung(')
    assert.ok(pruefung < create.indexOf("'get_next_chargennummer'"), 'Prüfung vor der Chargennummer')
    assert.ok(pruefung < create.indexOf('chargeAktualisieren('), 'Prüfung vor dem Mindern der Charge')
    assert.ok(pruefung < create.indexOf(".from('fuellungen')"), 'Prüfung vor dem Anlegen der Füllung')
    const l = quelle('src/lib/kellerbuch/pruefnummerLaden.ts')
    const helfer = l.slice(l.indexOf('export async function pruefnummerFuerFuellung'))
    assert.match(helfer, /fuellungAntragPruefen\(await chargeDaten\(\), dacAntragId, p\.abfuelldatum\)/)
    assert.match(helfer, /ladePruefnummerDaten\(supabase, tenantId, \[p\.weinausbauId\], \{ heute: p\.heute \}\)/)
    assert.match(helfer, /freieNummerFehler\(supabase, tenantId, freieNummer, \{/)
    assert.match(helfer, /if \(!r\.ok\) throw new AktionsFehler\(r\.fehler\)/)
    assert.match(l, /return freiePruefnummerPruefen\(nummer, \{[^}]*herkunft,/)
  })
  test('updateFuellung: nachgetragene Charge wird gegen Prüfnummer und DAC-Antrag geprüft, vor dem Nachtrag (KAN-101)', () => {
    const s = quelle('src/app/(dashboard)/weinhandel/actions.ts')
    const upd = s.slice(s.indexOf('export async function updateFuellung'), s.indexOf('export async function pruefnummerNachtragen'))
    assert.match(upd, /\.select\('weinausbau_id, datum, pruefnummer, dac_antrag_id[^']*'\)/)
    // nur leer → Wert (einmal nachtragbar), eingetragene Charge bleibt
    assert.match(upd, /if \(neueCharge && alt\.weinausbau_id && neueCharge !== alt\.weinausbau_id\) \{\s+throw new AktionsFehler/)
    assert.match(upd, /if \(neueCharge && !alt\.weinausbau_id\) \{[\s\S]*?await pruefnummerBeiChargenzuordnung\(supabase, tenantId,[\s\S]*?datum: pnTag\(alt\.datum\)/)
    assert.ok(upd.indexOf('pruefnummerBeiChargenzuordnung(') < upd.indexOf("'s112_fuellung_nachtragen'"), 'Prüfung vor dem Nachtrag')
    // KAN-378: gespeichert wird über die RPC s112_fuellung_aendern (mit Grund)
    assert.ok(upd.indexOf('s112_fuellung_aendern') > 0, 'Speichern über s112_fuellung_aendern')
    assert.ok(upd.indexOf("'s112_fuellung_nachtragen'") < upd.indexOf("'s112_fuellung_aendern'"), 'Nachtrag vor dem Speichern')
    // Abfülldatum ist gesperrt – keine Datumsänderung mehr über das Formular
    assert.doesNotMatch(upd, /pruefnummerBeiDatumsaenderung|formData\.get\('datum'\)/)
  })
  test('pruefnummerNachtragen: Nummer nur aus dem Antrag der Charge, Datumsregel KAN-72, dann RPC (KAN-101)', () => {
    const s = quelle('src/app/(dashboard)/weinhandel/actions.ts')
    const f = s.slice(s.indexOf('export async function pruefnummerNachtragen'), s.indexOf('// Flaschenbestand korrigieren (KAN-35)'))
    assert.match(f, /ladePruefnummerDaten\(supabase, tenantId, \[chargeId\]\)/)
    assert.match(f, /ersatzPruefnummer\(antrag, \{ datum, chargeId \}, daten\.zugaenge\)/)
    assert.match(f, /fuellungDatumVerletzung\(antrag, daten\.zugaenge, datum\)/)
    assert.ok(f.indexOf('ersatzPruefnummer(') < f.indexOf("'s112_fuellung_nachtragen'"), 'Prüfung vor der RPC')
  })
  test('Formular: Chargenwechsel setzt Antrag und Prüfnummer zurück, Hidden-Input nur bei freier Eingabe', () => {
    const s = quelle('src/app/(dashboard)/weinhandel/fuellungen/neu/FuellungFormClient.tsx')
    const wechsel = s.slice(s.indexOf('function handleChargeChange'), s.indexOf('function handleDacChange'))
    const reset = Math.max(wechsel.indexOf("setSelectedDacId('')"), wechsel.indexOf("setPruefnummerVal('')"))
    assert.ok(wechsel.indexOf("setSelectedDacId('')") > 0 && wechsel.indexOf("setPruefnummerVal('')") > 0)
    assert.ok(reset < wechsel.indexOf('vorschlag(id)'), 'Zurücksetzen vor dem neuen Vorschlag')
    assert.match(s, /\{freieEingabe && <input type="hidden" name="pruefnummer" value=\{pruefnummerVal\} \/>\}/)
  })
  test('Seite „Neue Füllung“ lädt keine abgelehnten/inaktiven Anträge und bietet nur wählbare an', () => {
    const s = quelle('src/app/(dashboard)/weinhandel/fuellungen/neu/page.tsx')
    const dac = s.slice(s.indexOf("from('dac_antrag')"), s.indexOf("from('dac_antrag')") + 300)
    assert.match(dac, /\.eq\('aktiv', true\)/)
    assert.match(dac, /\.neq\('status', 'abgelehnt'\)/)
    assert.match(s, /waehlbareAntraege\(daten, heute\)/)
    assert.match(s, /alleAntraege\.filter\(d => waehlbar\.has\(d\.id\)\)/)
  })
  test('Blend-Protokoll: Dateiname ohne Prüfnummer, Charge über den Helfer', () => {
    const reg = quelle('src/lib/behoerden/register/kellerbuch.ts')
    const blendEintrag = reg.slice(reg.indexOf("'blend-protokoll':"), reg.indexOf("'keller-auswertungen':"))
    assert.match(blendEintrag, /p\.anzeige\.name = b\.kopf\.chargennummer \?\? b\.kopf\.name/)
    assert.doesNotMatch(blendEintrag.replace(/\/\/.*$/gm, ''), /pruefnummer/)
    const b = quelle('src/lib/behoerden/blend.ts')
    assert.match(b, /pruefnummerGueltig\(daten, heute\)/)
    assert.doesNotMatch(b, /order\('created_at', \{ ascending: false \}\)/)
    const seite = quelle('src/app/(dashboard)/kellerbuch/weinausbau/[id]/blend-protokoll/page.tsx')
    assert.match(seite, /kopf\.pruefnummerHinweis &&/)
  })
  test('TBS: Tank über den Helfer am Verkaufsdatum, nicht mehr „ältester Antrag mit Nummer“', () => {
    const s = quelle('src/lib/behoerden/transportbescheinigung.ts')
    assert.match(s, /pruefnummerGueltig\(daten, verkaufstag, \{ bescheidBisStichtag: true \}\)/)
    assert.match(s, /const daten = roh \? bestandVorVerkauf\(roh, verkaufstag\) : undefined/)
    assert.match(s, /ladePruefnummerDaten\(supabase, tenantId, waIds\)/)
    assert.doesNotMatch(s, /pn\.jeWeinausbau\[d\.weinausbau_id\] = /)
    // Zeitraumliste verwirft die Hinweise der Vorbelegung nicht mehr
    assert.doesNotMatch(s, /tbVorbelegung\(v, cfg, pn, heute, \[\]\)/)
    // KAN-90: keine Flaschenposition auf der TBS – keine Ersatznummer aus dem DAC-Antrag der Füllung mehr
    assert.doesNotMatch(s, /ersatzPruefnummer|jeDacAntrag/)
    // Ersatznummer im Blend-Protokoll der Füllung über den Helfer
    assert.match(quelle('src/lib/behoerden/blend.ts'), /ersatzPruefnummer\(antrag, \{ datum: tag\(f\.datum\) \|\| null, chargeId \}, zugaenge\)/)
  })
  test('updateFuellung: Charge eines anderen Betriebs (unbekannte ID) wird abgelehnt, nie gespeichert', () => {
    const s = quelle('src/app/(dashboard)/weinhandel/actions.ts')
    const teil = s.slice(s.indexOf('export async function updateFuellung'))
    const laden = teil.slice(teil.indexOf("from('weinausbau')"), teil.indexOf("from('weinausbau')") + 600)
    assert.match(laden, /\.eq\('tenant_id', tenantId\)\s*\.maybeSingle\(\)/)
    assert.match(laden, /if \(waErr\) throw new AktionsFehler/)
    assert.match(laden, /if \(!wa\) throw new AktionsFehler\('Die gewählte Kellerbuch-Charge wurde nicht gefunden\.'\)/)
  })
})
