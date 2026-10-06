// KAN-95 (01.10.2026): Dateinamen der BKI-CSV nach dem Schema
//   <Betriebsnummer>_<Jahr>_<Berichtsname>[_von_JJJJMMTT_bis_JJJJMMTT].csv
// Geprüft: bkiDateiname() (lib/csv), meldungsDateiname() (lib/behoerden/dateiname.ts, von der
// zentralen CSV-Route genutzt), die Jahr-Regel (Stichtag bzw. Jahrgang bei Ernte-/Bestandsmeldung und Lesedaten, sonst
// Exporttag), Platzhalter + Warnung ohne Betriebsnummer, unveränderte Namen ohne BKI-Bezug und
// welche Register-Einträge die Option `bki` tragen (Behörde nennt die BKI, dazu die Bestandsmeldung).

import { register } from 'node:module'
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

register('./kellerbuch-hooks.mjs', import.meta.url)

const csv = await import('../../src/lib/csv/index.ts')
const { meldungsDateiname, WARNUNG_BETRIEBSNUMMER_FEHLT } = await import('../../src/lib/behoerden/dateiname.ts')
// register/flaechen.ts lädt .tsx (grundstueckStatus) – hier nicht ladbar; geprüft unten über Katalog und Quelltext
const gruppen = await Promise.all(['ernte', 'pflanzenschutz', 'verkehr', 'kellerbuch', 'buchhaltung']
  .map(g => import(`../../src/lib/behoerden/register/${g}.ts`)))
const M = Object.assign({}, ...gruppen.map(g => Object.values(g).find(v => v && typeof v === 'object' && !Array.isArray(v))))

const B = { name: 'Weingut Muster', betriebsnummer: '9988776' }
const OHNE = { name: 'Weingut Muster', betriebsnummer: null }
const name = (id, query, betrieb = B, heute = '2026-10-01') => {
  const m = M[id]
  const p = m.parameter(new URLSearchParams(query))
  assert.ok(!p.parameterFehler, `${id}: ${p.fehler}`)
  return meldungsDateiname(m, p, betrieb, heute)
}

describe('KAN-95 bkiDateiname()', () => {
  test('ohne Zeitraum: Betriebsnummer_Jahr_Berichtsname.csv, kein Erstelldatum', () => {
    assert.deepEqual(csv.bkiDateiname({ betriebsnummer: '9988776', jahr: 2026, bericht: 'Gebindeverzeichnis' }),
      { utf8: '9988776_2026_Gebindeverzeichnis.csv', ascii: '9988776_2026_Gebindeverzeichnis.csv' })
  })
  test('mit Zeitraum: _von_JJJJMMTT_bis_JJJJMMTT', () => {
    assert.equal(csv.bkiDateiname({ betriebsnummer: '9988776', jahr: 2026, bericht: 'Lagerbewegungen', von: '2026-01-01', bis: '2026-09-25' }).utf8,
      '9988776_2026_Lagerbewegungen_von_20260101_bis_20260925.csv')
    assert.equal(csv.bkiDateiname({ betriebsnummer: '1', jahr: 2026, bericht: 'X', von: '2026-01-01' }).utf8, '1_2026_X_von_20260101.csv')
    assert.equal(csv.bkiDateiname({ betriebsnummer: '1', jahr: 2026, bericht: 'X', bis: '2026-09-25' }).utf8, '1_2026_X_bis_20260925.csv')
  })
  test('Zusätze mit „-“ am Berichtsnamen, Umlaute nur in der UTF-8-Fassung', () => {
    const n = csv.bkiDateiname({ betriebsnummer: '9988776', jahr: 2026, bericht: ['Bewegungsbuch', 'Tank 3 (Grüner)', null, ''] })
    assert.equal(n.utf8, '9988776_2026_Bewegungsbuch-Tank-3-Grüner.csv')
    assert.equal(n.ascii, '9988776_2026_Bewegungsbuch-Tank-3-Gruener.csv')
  })
  test('ohne Betriebsnummer: Platzhalter', () => {
    assert.equal(csv.bkiDateiname({ betriebsnummer: '  ', jahr: 2026, bericht: 'Gebindeverzeichnis' }).utf8,
      `${csv.BKI_BETRIEBSNUMMER_PLATZHALTER}_2026_Gebindeverzeichnis.csv`)
  })
})

describe('KAN-95 Dateinamen der Meldungen (wie die CSV-Route)', () => {
  test('Gebindeverzeichnis: <Nr>_2026_Gebindeverzeichnis.csv', () => {
    assert.deepEqual(name('gebindeverzeichnis', ''), { dateiname: { utf8: '9988776_2026_Gebindeverzeichnis.csv', ascii: '9988776_2026_Gebindeverzeichnis.csv' }, warnungen: [] })
    assert.equal(name('gebindeverzeichnis', 'aktiv=1').dateiname.utf8, '9988776_2026_Gebindeverzeichnis-aktive.csv')
  })
  test('Erntemeldung 2026 heißt auch beim Export 2027 …_2026_Erntemeldung.csv (Stichtag)', () => {
    assert.equal(name('erntemeldung', 'jahrgang=2026', B, '2027-01-15').dateiname.utf8, '9988776_2026_Erntemeldung.csv')
  })
  test('Lesedaten 2026 heißen auch beim Export 2027 …_2026_Lesedaten.csv (Jahrgang, Nachtrag 02.10.2026)', () => {
    assert.equal(name('lesedaten', 'jahrgang=2026', B, '2027-01-15').dateiname.utf8, '9988776_2026_Lesedaten.csv')
    assert.equal(name('lesedaten', 'jahrgang=2025', B, '2026-10-01').dateiname.utf8, '9988776_2025_Lesedaten.csv')
  })
  test('ohne Stichtag zählt der Exporttag', () => {
    assert.equal(name('keller-auswertungen', 'von=2026-01-01&bis=2026-09-25').dateiname.ascii, '9988776_2026_Keller-Umzuege_von_20260101_bis_20260925.csv')
    assert.equal(name('transportbescheinigungen', 'von=2026-01-01&bis=2026-09-25&nur=gespeichert').dateiname.utf8,
      '9988776_2026_Transportbescheinigungen-gespeichert_von_20260101_bis_20260925.csv')
    assert.equal(name('bki-traubenverkauf', 'jahrgang=2025').dateiname.utf8, '9988776_2026_Traubenverkauf-2025.csv')
  })
  test('Bestandsmeldung: Jahr des Stichtags, Stichtag im Namen (KAN-43)', () => {
    const m = M.bestandsmeldung
    assert.equal(meldungsDateiname(m, { stichtag: '2025-07-31' }, B, '2026-10-01').dateiname.ascii,
      '9988776_2025_Weinbestand-Stichtag-2025-07-31.csv')
  })
  test('fehlende Betriebsnummer: Platzhalter und Warnung', () => {
    const r = name('gebindeverzeichnis', '', OHNE)
    assert.equal(r.dateiname.utf8, 'Betriebsnummer-fehlt_2026_Gebindeverzeichnis.csv')
    assert.deepEqual(r.warnungen, [WARNUNG_BETRIEBSNUMMER_FEHLT])
    assert.match(WARNUNG_BETRIEBSNUMMER_FEHLT, /Weinbau-Betriebsnummer fehlt/)
  })
  test('Meldungen ohne BKI-Bezug: Name unverändert (dateiteile + Erstelldatum), keine Warnung', () => {
    assert.deepEqual(meldungsDateiname(M.uva, { jahr: 2026, zeitraum: 'Q1' }, B, '2026-09-24'),
      { dateiname: { utf8: 'UVA_9988776_2026-Q1_2026-09-24.csv', ascii: 'UVA_9988776_2026-Q1_2026-09-24.csv' }, warnungen: [] })
    assert.equal(meldungsDateiname(M.uva, { jahr: 2026, zeitraum: 'Q1' }, OHNE, '2026-09-24').warnungen.length, 0)
  })
})

describe('KAN-95 Auswahl der BKI-Berichte', () => {
  const BKI = /\bBKI\b|Bundeskellereiinspektion/
  test('bki genau dort, wo die Behörde die BKI nennt – plus Bestandsmeldung und BSM', () => {
    for (const [id, m] of Object.entries(M)) {
      const soll = BKI.test(m.behoerde) || id === 'bestandsmeldung' || id.startsWith('bsm')   // KAN-43: BSM samt Kontrolljournal
      assert.equal(typeof m.bki === 'function', soll, `${id} (${m.behoerde})`)
    }
    const liste = Object.keys(M).filter(id => M[id].bki).sort()
    assert.deepEqual(liste, [
      'aenderungsprotokoll', 'bestandsmeldung', 'bewegungsbuch', 'bki-lagerbewegungen', 'bki-lagerstand', 'bki-traubenverkauf',   // KAN-44: Lagerstand/Lagerbewegungen
      'blend-protokoll', 'bsm', 'bsm-kontrolljournal', 'erntemeldung',
      'gebindeverzeichnis', 'keller-auswertungen', 'keller-behandlungen', 'keller-behandlungen-alle', 'lesedaten',
      'rueckverfolgung', 'rueckverfolgung-weingarten', 'transportbescheinigung', 'transportbescheinigungen', 'weinbuch', 'weinbuch-sammlung',
    ])
  })
  test('Flächen-Gruppe: keine BKI-Behörde, keine Option bki', async () => {
    const { KATALOG_FLAECHEN } = await import('../../src/lib/behoerden/katalog/flaechen.ts')
    for (const e of Object.values(KATALOG_FLAECHEN)) assert.doesNotMatch(e.behoerde, BKI, e.id)
    const quelle = readFileSync(new URL('../../src/lib/behoerden/register/flaechen.ts', import.meta.url), 'utf8')
    assert.doesNotMatch(quelle, /bki:/)
  })
  test('die CSV-Route holt den Dateinamen über meldungsDateiname()', () => {
    const route = readFileSync(new URL('../../src/app/(dashboard)/meldungen/[meldung]/csv/route.ts', import.meta.url), 'utf8')
    assert.match(route, /meldungsDateiname\(meldung, p, betrieb\)/)
    assert.match(route, /\.\.\.namensWarnungen/)
    assert.doesNotMatch(route, /csvDateiname\(/)
  })
})
