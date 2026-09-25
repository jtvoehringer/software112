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
const PRESSUNG = { art: 'zugang', datum: '2025-09-28', id: 'pressung' }          // Herkunft, vor dem Antrag
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
    assert.match(pn.pruefnummerHinweis(zugang, 'den Bestand am 25.09.2026'), /gilt nicht für den Bestand am 25\.09\.2026: Zugang aus einer anderen Charge am 01\.08\.2026/)
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
  test('genehmigter Antrag: Nummer nur, wenn sie am Abfülldatum gilt', () => {
    assert.deepEqual(pn.fuellungAntragPruefen(musterhof(), ANTRAG_ID, '2026-06-20'), { ok: true, pruefnummer: 'N 10716/26' })
    // Abfüllung vor der Einreichung (Probe aus der Füllung): Stand am Einreichungstag
    assert.deepEqual(pn.fuellungAntragPruefen(musterhof(), ANTRAG_ID, '2026-05-10'), { ok: true, pruefnummer: 'N 10716/26' })
    const r = pn.fuellungAntragPruefen(musterhof(), ANTRAG_ID, '2026-09-25')
    assert.equal(r.ok, false)
    assert.match(r.fehler, /Verschnitt am 25\.09\.2026 \(§ 25 Abs\. 6 WeinG\)/)
    assert.match(r.fehler, /neuer DAC-Antrag nötig/)
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
  test('Musterhof heute: kein wählbarer Antrag, dafür Hinweis; bis zum Verschnitt der genehmigte', () => {
    assert.deepEqual(pn.waehlbareAntraege(musterhof(), '2026-09-25'), [])
    assert.deepEqual(pn.waehlbareAntraege(musterhof(), '2026-09-24'), [ANTRAG_ID])
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
    assert.deepEqual(d.zugaenge.map(z => [z.art, z.datum]).sort(), [['verschnitt', '2026-09-25'], ['zugang', '2025-09-28']])
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
    positionen: [{ id: 'p1', typ: 'tank', name: 'Riesling Tank', menge: 200, einheit: 'l', weinausbau: { id: CH, name: 'Riesling Ried Pfaffenberg', jahrgang: 2025, qualitaetsstufe: 'qualitaetswein', rebsorte: 'Riesling', weinart: 'weiss' } }],
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
  const pruefen = (eingabe, p) => laden.pruefnummerFuerFuellung(attrappe(dbMusterhof()), T,
    { dacAntragId: null, pruefnummer: null, ...eingabe },
    { weinausbauId: CH, chargeName: 'Riesling Ried Pfaffenberg', abfuelldatum: '2026-06-20', ...p })
  const aktionsFehler = muster => e => e.name === 'AktionsFehler' && muster.test(e.message)

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
    assert.deepEqual(await pruefen({ dacAntragId: ANTRAG_ID, pruefnummer: 'GEFÄLSCHT 1/26' }), { pruefnummer: 'N 10716/26', dacAntragId: ANTRAG_ID })
  })
  test('Musterhof nach dem Verschnitt: Antrag nicht mehr verknüpfbar', async () => {
    await assert.rejects(pruefen({ dacAntragId: ANTRAG_ID }, { abfuelldatum: '2026-09-25' }), aktionsFehler(/Verschnitt am 25\.09\.2026/))
  })
  test('freie Eingabe: bewusst erhalten ohne Charge bzw. für Chargen ohne Antrag, gesperrt für Chargen mit Antrag', async () => {
    assert.deepEqual(await pruefen({ pruefnummer: ' L 4711/25 ' }, { weinausbauId: null }), { pruefnummer: 'L 4711/25', dacAntragId: null })
    assert.deepEqual(await pruefen({ pruefnummer: 'L 4711/25' }, { weinausbauId: CH_B }), { pruefnummer: 'L 4711/25', dacAntragId: null })
    await assert.rejects(pruefen({ pruefnummer: 'L 4711/25' }), aktionsFehler(/gibt es einen DAC-Antrag/))
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
    assert.match(helfer, /ladePruefnummerDaten\(supabase, tenantId, \[p\.weinausbauId\]\)/)
    assert.match(helfer, /freiePruefnummerPruefen\(freieNummer/)
    assert.match(helfer, /if \(!r\.ok\) throw new AktionsFehler\(r\.fehler\)/)
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
    assert.match(s, /pruefnummerGueltig\(daten, verkaufstag\)/)
    assert.match(s, /ladePruefnummerDaten\(supabase, tenantId, waIds\)/)
    assert.doesNotMatch(s, /pn\.jeWeinausbau\[d\.weinausbau_id\] = /)
  })
})
