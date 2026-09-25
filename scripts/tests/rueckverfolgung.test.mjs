// Tests KAN-75: Rückverfolgung – Maßnahmen im Weingarten nur bis zur Lese, nur am gelesenen GST
//
// Aufruf:  node --experimental-strip-types --disable-warning=ExperimentalWarning --test scripts/tests/rueckverfolgung.test.mjs
//
// 1. Reine Fensterfunktion src/lib/behoerden/rueckverfolgungFenster.ts mit einer Fixture, die
//    die Musterhof-Daten nachbildet (per SELECT am 25.09.2026 ermittelt: 20 Lesezeilen aus
//    pressung_weingaerten mit GST und Lesedatum, 52 Maßnahmen mit ihren GST aus
//    behandlung_grundstuecke, 17 Grundstücke). Akzeptanz: bei keiner der 20 Lesezeilen liegt
//    eine Maßnahme nach dem Lesedatum; Anzahl je Lese wie die SQL-Gegenprobe.
//    Echtbetrieb: Das Pressungsformular schreibt pw.ernte_datum nicht – ohne es liefert das
//    Lesedatum laut Erntemeldung (15 Musterhof-Einträge aus ernte_parzellen) dieselben Fenster.
// 2. Randfälle: mehrere Lesen desselben GST im selben Jahr, Lese ohne GST, Maßnahme am
//    Lesetag bzw. am Tag nach der vorigen Lese, Jahrgangswechsel, Eiswein des Vorjahrgangs,
//    mehrtägige Maßnahmen, Maßnahmen nur am Weingarten, fremdes GST, Lese ohne Lesedatum
//    (Erntemeldung bzw. Pressungsdatum), Mehrfachlese mit vertippter bzw. fehlender Hauptlese
//    in der Erntemeldung (Prüfrunde 2), Sammelwarnungen.
// 3. Gemeinsame Ladefunktion gegen eine Attrappe des Supabase-Clients: Seite
//    (ladeFuellungKette mit details) und CSV (Register „rueckverfolgung“) zeigen dieselben
//    Maßnahmen; Mandantentrennung (fremde Lese, fremde Maßnahme, fremder Lese-Eintrag und
//    fremde Pressung am selben GST bzw. Weingarten); Mengenprüfung der Erntemeldung;
//    Sonderfälle als X-Warnungen.
// 4. Quelltextprüfung: Die Seite nutzt die gemeinsame Ladefunktion und lädt keine
//    Maßnahmen selbst.
// kellerbuch-hooks.mjs löst '@/…', Pfade ohne Endung und 'server-only' auf.

import { register } from 'node:module'
import { test, describe, before } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

register('./kellerbuch-hooks.mjs', import.meta.url)

const fenster = await import('../../src/lib/behoerden/rueckverfolgungFenster.ts')
const rueck = await import('../../src/lib/behoerden/rueckverfolgung.ts')
const csv = await import('../../src/lib/csv/index.ts')
const typen = await import('../../src/lib/behoerden/typen.ts')
const { MELDUNGEN_KELLERBUCH: M } = await import('../../src/lib/behoerden/register/kellerbuch.ts')

const WURZEL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const quelle = rel => readFileSync(path.join(WURZEL, rel), 'utf8').replace(/\r\n/g, '\n')

const T = '33333333-3333-4333-8333-333333333333'           // Musterhof
const X = '99999999-9999-4999-8999-999999999999'           // anderer Betrieb
const id = typ => s => `33333333-3333-4333-8333-${typ}000000${s}`
const G = id('0003'), W = id('0002'), P = id('0009'), C = id('000b'), B = id('0006')

// ── Fixture Musterhof (SELECT vom 25.09.2026, nur lesend) ─────────────────────

const WEINGAERTEN = {
  '01': 'Pfaffenberg Riesling', '02': 'Steiner Hund Riesling', '03': 'Kremsleithen Grüner Veltliner',
  '04': 'Sandgrube Grüner Veltliner', '05': 'Gebling Grüner Veltliner', '06': 'Wachtberg Weißburgunder',
  '07': 'Wachtberg Chardonnay', '08': 'Frechau Zweigelt', '09': 'Frechau St. Laurent',
  '0a': 'Sandgrube Muskateller', '0b': 'Gebling Zweigelt', '0c': 'Pfaffenberg Grüner Veltliner',
}
// [GST, Weingarten, GST-Nr.]
const GRUNDSTUECKE = [
  ['01', '01', '512/1'], ['02', '01', '512/2'], ['03', '02', '488/3'], ['04', '03', '1021/4'], ['05', '03', '1021/5'],
  ['06', '04', '1305/1'], ['07', '04', '1305/2'], ['08', '04', '1306'], ['09', '05', '1188/2'], ['0a', '06', '977/1'],
  ['0b', '07', '977/2'], ['0c', '08', '2213/1'], ['0d', '08', '2213/2'], ['0e', '09', '2214'], ['0f', '0a', '1307/3'],
  ['10', '0b', '1189/1'], ['11', '0c', '513'],
]
// Lesezeilen (pressung_weingaerten): [id, Pressung, Pressungsdatum, Jahrgang, Weingarten, GST, Lesedatum, Chargen, kg]
const LESEZEILEN = [
  ['938efa97-876f-45bc-a4d8-6d0b037126dc', '29', '2024-09-30', 2024, '01', '01', '2024-09-30', ['29'], 6600],
  ['e9e49cd9-28ce-4d26-bde5-b316b6895b2c', '08', '2025-09-28', 2025, '01', '01', '2025-09-28', ['12'], 7200],
  ['baa9d67e-1de2-4ff3-aaab-129485228594', '09', '2025-10-02', 2025, '02', '03', '2025-10-02', ['13'], 4250],
  ['85efa5c8-0667-49dc-bb11-5bc515449a62', '28', '2024-09-25', 2024, '03', '04', '2024-09-24', ['28'], 13500],
  ['8c214cf8-28b1-4194-9fa2-fd9c0e0c52b3', '07', '2025-09-24', 2025, '03', '04', '2025-09-22', ['11'], 11500],
  ['efee758b-5419-43c5-97e8-4eacd9ec9e35', '06', '2025-09-16', 2025, '04', '06', '2025-09-16', ['10'], 9000],
  ['62bc1857-091f-429f-ab21-f1f2d0bab0be', '2a', '2024-09-05', 2024, '06', '0a', '2024-09-05', ['2a'], 600],
  ['bb190551-6da8-486c-9dbd-99b1de49239d', '05', '2025-09-14', 2025, '06', '0a', '2025-09-14', ['0f'], 4200],
  ['a63ae59a-0fba-48ed-a96c-03b797aa6506', '17', '2026-09-12', 2026, '06', '0a', '2026-09-12', ['34'], 4000],
  ['d76ccd49-af53-4ec1-a417-ff0c47c76209', '2a', '2024-09-05', 2024, '07', '0b', '2024-09-04', ['2a'], 1300],
  ['9bd3c04c-13fc-4d64-a6f0-f7ebffe1cafa', '04', '2025-09-12', 2025, '07', '0b', '2025-09-12', ['0d', '0e'], 2570],
  ['58049a76-ab4f-4bf5-9c50-ab44e1151667', '0b', '2025-10-06', 2025, '08', '0c', '2025-09-30', ['17', '18', '19', '1a'], 10200],
  ['9a171cd9-fdf7-46e7-bffa-3652da4692dc', '0a', '2025-10-04', 2025, '09', '0e', '2025-09-24', ['14', '15', '16'], 2100],
  ['41abdb75-b774-4fde-92b3-ee6b48e978b2', '01', '2025-09-08', 2025, '0a', '0f', '2025-09-08', ['0a'], 2750],
  ['07b6a6e2-5609-4ed3-8512-55547ea6f422', '15', '2026-09-02', 2026, '0a', '0f', '2026-09-02', ['32'], 2100],
  ['3cd11817-f570-41ff-8219-22b4588f258e', '02', '2025-09-10', 2025, '0b', '10', '2025-09-10', ['0b'], 2000],
  ['62796043-2710-49b8-a6ff-14fa445aea02', '03', '2025-09-13', 2025, '0b', '10', '2025-09-10', ['0c'], 3200],
  ['a40f2659-9f48-46dd-a30f-94e047d095e5', '16', '2026-09-06', 2026, '0b', '10', '2026-09-06', ['33'], 1300],
  ['84e7c234-2307-4fda-8482-9501cd9783dc', '28', '2024-09-25', 2024, '0c', '11', '2024-09-25', ['28'], 4700],
  ['a66846ca-1e20-4a21-adcb-437104b37eb4', '07', '2025-09-24', 2025, '0c', '11', '2025-09-23', ['11'], 4900],
]
// Maßnahmen 2025 (behandlungen + behandlung_grundstuecke): [id, datum, datum_bis, art, Weingarten, Mittel, GST]
// 2026 wiederholt der Musterhof dieselbe Folge (ids 1b–34, gleiche Tage ein Jahr später).
const ALLE = ['01', '02', '03', '04', '05', '06', '07', '09', '0a', '0b', '0c', '0d', '0e', '0f', '10', '11']
const MASSNAHMEN_2025 = [
  ['01', '2025-02-12', '2025-03-06', 'schnitt', '01', null, ALLE],
  ['02', '2025-03-18', null, 'bodenbearbeitung', '01', null, ALLE],
  ['03', '2025-03-25', null, 'duengung', '03', null, ['04', '05', '06', '07', '09', '11']],
  ['04', '2025-04-08', null, 'duengung', '01', null, ['01', '02', '03', '0c', '0d']],
  ['05', '2025-05-06', null, 'spritzung', '01', 'Netzschwefel Stulln', ALLE],
  ['06', '2025-05-19', null, 'spritzung', '01', 'Folpan 80 WDG', ALLE],
  ['07', '2025-05-19', null, 'spritzung', '01', 'Netzschwefel Stulln', ALLE],
  ['08', '2025-05-30', '2025-06-06', 'laubarbeit', '01', null, ALLE],
  ['09', '2025-06-03', null, 'spritzung', '01', 'Mildicut', ALLE],
  ['0a', '2025-06-03', null, 'spritzung', '01', 'Topas', ALLE],
  ['0b', '2025-06-14', null, 'spritzung', '01', 'Folpan 80 WDG', ALLE],
  ['0c', '2025-06-14', null, 'spritzung', '01', 'Netzschwefel Stulln', ALLE],
  ['0d', '2025-06-20', '2025-06-27', 'laubarbeit', '01', null, ALLE],
  ['0e', '2025-06-26', null, 'spritzung', '01', 'Luna Experience', ALLE],
  ['0f', '2025-06-26', null, 'spritzung', '01', 'Mildicut', ALLE],
  ['10', '2025-07-02', null, 'spritzung', '01', 'Steward', ['01', '02', '03', '04', '05', '11']],
  ['11', '2025-07-08', null, 'bodenbearbeitung', '01', null, ALLE],
  ['12', '2025-07-10', null, 'spritzung', '01', 'Cuprozin progress', ALLE],
  ['13', '2025-07-10', null, 'spritzung', '01', 'Topas', ALLE],
  ['14', '2025-07-18', '2025-07-24', 'laubarbeit', '01', null, ['01', '02', '03', '04', '05', '06', '07', '09', '11']],
  ['15', '2025-07-24', null, 'spritzung', '01', 'Bordeaux Manica 20', ALLE],
  ['16', '2025-07-24', null, 'spritzung', '01', 'Netzschwefel Stulln', ALLE],
  ['17', '2025-08-12', null, 'spritzung', '01', 'Cuprozin progress', ALLE],
  ['18', '2025-08-20', '2025-08-21', 'laubarbeit', '08', null, ['0c', '0d', '0e', '10']],
  ['19', '2025-08-22', null, 'bodenbearbeitung', '01', null, ALLE],
  ['1a', '2025-09-01', '2025-09-03', 'sonstiges', '01', null, ALLE],
]
const plusJahr = d => d && `${Number(d.slice(0, 4)) + 1}${d.slice(4)}`
const MASSNAHMEN = [
  ...MASSNAHMEN_2025,
  ...MASSNAHMEN_2025.map(([s, d, bis, ...rest]) => [(parseInt(s, 16) + 26).toString(16).padStart(2, '0'), plusJahr(d), plusJahr(bis), ...rest]),
]

// Soll laut SQL-Gegenprobe (Bericht KAN-75): Maßnahmen je Lese im Fenster; Ist = bisher alle des GST
const SOLL = {
  '938efa97-876f-45bc-a4d8-6d0b037126dc': [0, 48], 'e9e49cd9-28ce-4d26-bde5-b316b6895b2c': [24, 48],
  'baa9d67e-1de2-4ff3-aaab-129485228594': [24, 48], '85efa5c8-0667-49dc-bb11-5bc515449a62': [0, 48],
  '8c214cf8-28b1-4194-9fa2-fd9c0e0c52b3': [24, 48], 'efee758b-5419-43c5-97e8-4eacd9ec9e35': [23, 46],
  '62bc1857-091f-429f-ab21-f1f2d0bab0be': [0, 42], 'bb190551-6da8-486c-9dbd-99b1de49239d': [21, 42],
  'a63ae59a-0fba-48ed-a96c-03b797aa6506': [21, 42], 'd76ccd49-af53-4ec1-a417-ff0c47c76209': [0, 42],
  '9bd3c04c-13fc-4d64-a6f0-f7ebffe1cafa': [21, 42], '58049a76-ab4f-4bf5-9c50-ab44e1151667': [23, 46],
  '9a171cd9-fdf7-46e7-bffa-3652da4692dc': [22, 44], '41abdb75-b774-4fde-92b3-ee6b48e978b2': [21, 42],
  '07b6a6e2-5609-4ed3-8512-55547ea6f422': [21, 42], '3cd11817-f570-41ff-8219-22b4588f258e': [22, 44],
  '62796043-2710-49b8-a6ff-14fa445aea02': [22, 44], 'a40f2659-9f48-46dd-a30f-94e047d095e5': [22, 44],
  '84e7c234-2307-4fda-8482-9501cd9783dc': [0, 48], 'a66846ca-1e20-4a21-adcb-437104b37eb4': [24, 48],
}

// Erntemeldung (ernte_parzellen, SELECT vom 25.09.2026): [Jahrgang, Weingarten, Lesedatum, kg] –
// alle ohne GST, je Weingarten und Jahrgang ein Eintrag; 2024 ohne Einträge. Das Lesedatum stimmt
// bei jeder Lesezeile mit Eintrag mit pw.ernte_datum überein (auch Rotwein mit späterer Pressung,
// z. B. Frechau 30.09. / 06.10.); die Menge deckt das Verpresste (Sandgrube: 17.500 kg erfasst,
// 9.000 kg verpresst; Gebling GV ohne Pressung; kein Traubenverkauf).
const ERNTEMELDUNG = [
  [2025, '0a', '2025-09-08', 2750], [2025, '0b', '2025-09-10', 5200], [2025, '07', '2025-09-12', 2570], [2025, '06', '2025-09-14', 4200],
  [2025, '04', '2025-09-16', 17500], [2025, '05', '2025-09-18', 10200], [2025, '03', '2025-09-22', 11500], [2025, '0c', '2025-09-23', 4900],
  [2025, '09', '2025-09-24', 2100], [2025, '01', '2025-09-28', 7200], [2025, '08', '2025-09-30', 10200], [2025, '02', '2025-10-02', 4250],
  [2026, '0a', '2026-09-02', 2100], [2026, '0b', '2026-09-06', 1300], [2026, '06', '2026-09-12', 4000],
]
const JG = jahr => `jg-${jahr}`

// Helferform (rueckverfolgungFenster.ts)
const lesenHelfer = LESEZEILEN.map(([pw, , pDatum, jahrgang, wg, gst, lese]) => ({
  id: pw, grundstueckId: G(gst), weingartenId: W(wg), lesedatum: lese, pressungDatum: pDatum, jahrgang, jahrgangId: JG(jahrgang),
}))
const historieHelfer = lesenHelfer.map(l => ({ id: l.id, grundstueckId: l.grundstueckId, lesedatum: l.lesedatum, jahrgang: l.jahrgang }))
const ernteHelfer = ERNTEMELDUNG.map(([jahr, wg, datum, kg]) => ({ jahrgangId: JG(jahr), weingartenId: W(wg), grundstueckId: null, lesedatum: datum, mengeKg: kg }))
// verpresste Trauben (Mengenprüfung des Ersatz-Lesedatums) = die Lesezeilen selbst
const verpresstHelfer = LESEZEILEN.map(([pw, , pDatum, jahrgang, wg, gst, , , kg]) => ({ id: pw, jahrgangId: JG(jahrgang), weingartenId: W(wg), grundstueckId: G(gst), pressungDatum: pDatum, traubenKg: kg }))
const massnahmenHelfer = MASSNAHMEN.map(([s, datum, bis, , wg, , gst]) => ({ id: B(s), datum, datumBis: bis, weingartenId: W(wg), grundstueckIds: gst.map(G) }))
const gstJeWg = new Map()
const wgJeGst = new Map()
for (const [g, w] of GRUNDSTUECKE) { gstJeWg.set(W(w), [...(gstJeWg.get(W(w)) ?? []), G(g)]); wgJeGst.set(G(g), W(w)) }

describe('Musterhof – keine Maßnahme nach dem Lesedatum (Akzeptanz)', () => {
  const ergebnis = fenster.ordneMassnahmenZu(lesenHelfer, historieHelfer, massnahmenHelfer, gstJeWg, wgJeGst)

  test('Fixture wie die Live-Daten: 20 Lesezeilen, 52 Maßnahmen, bisherige Anzeige 42–48 je GST', () => {
    assert.equal(LESEZEILEN.length, 20)
    assert.equal(MASSNAHMEN.length, 52)
    assert.equal(new Set(MASSNAHMEN.map(m => m[0])).size, 52)
    for (const l of lesenHelfer) {
      const ist = massnahmenHelfer.filter(m => m.grundstueckIds.includes(l.grundstueckId))
      assert.equal(ist.length, SOLL[l.id][1], `Ist ${l.id}`)
      // bisher: bei den Lesen 2024 alle nach der Lese, 2025 die Hälfte
      const nach = ist.filter(m => m.datum > l.lesedatum).length
      if (l.jahrgang === 2024) assert.equal(nach, ist.length, l.id)
      if (l.jahrgang === 2025) assert.equal(nach, ist.length / 2, l.id)
    }
  })

  test('alle 20 Lesezeilen: jede Maßnahme beginnt am oder vor dem Lesedatum und liegt im Fenster', () => {
    assert.equal(ergebnis.length, 20)
    for (const z of ergebnis) {
      const l = lesenHelfer.find(x => x.id === z.leseId)
      assert.ok(z.fenster, z.leseId)
      assert.equal(z.fenster.bis, l.lesedatum)
      assert.equal(z.fenster.von, `${l.jahrgang}-01-01`)           // keine vorige Lese mit anderem Datum
      for (const t of z.massnahmen) {
        assert.ok(t.massnahme.datum <= l.lesedatum, `${t.massnahme.id} nach der Lese ${z.leseId}`)
        assert.ok((t.massnahme.datumBis ?? t.massnahme.datum) >= z.fenster.von)
        assert.deepEqual(t.grundstueckIds, [l.grundstueckId])       // nur das gelesene GST
        assert.equal(t.nurWeingarten, false)
      }
      assert.deepEqual(z.hinweise, [])
    }
  })

  test('Anzahl je Lese wie die SQL-Gegenprobe (2024: 0, 2025/2026: 21–24)', () => {
    for (const z of ergebnis) assert.equal(z.massnahmen.length, SOLL[z.leseId][0], z.leseId)
    const summe = ergebnis.reduce((s, z) => s + z.massnahmen.length, 0)
    assert.equal(summe, 335)                                        // SQL-Gegenprobe: Summe der Soll-Spalte
    assert.equal(summe, Object.values(SOLL).reduce((s, [soll]) => s + soll, 0))
  })

  test('Muskateller 02.09.2026: mehrtägige Maßnahme 01.–03.09. zählt (Beginn vor der Lese), Maßnahmen von 2025 nicht', () => {
    const z = ergebnis.find(e => e.leseId === '07b6a6e2-5609-4ed3-8512-55547ea6f422')
    const ids = z.massnahmen.map(t => t.massnahme.id)
    assert.ok(ids.includes(B('34')))
    assert.ok(ids.every(i => massnahmenHelfer.find(m => m.id === i).datum >= '2026-01-01'))
  })

  test('Gebling Zweigelt: zwei Lesen am selben Tag (zwei Pressungen) → dasselbe Fenster, keine „vorige Lese“', () => {
    const a = ergebnis.find(e => e.leseId === '3cd11817-f570-41ff-8219-22b4588f258e')
    const b = ergebnis.find(e => e.leseId === '62796043-2710-49b8-a6ff-14fa445aea02')
    assert.deepEqual(a.fenster, b.fenster)
    assert.equal(a.fenster.beginn, 'jahresbeginn')
    assert.deepEqual(a.massnahmen.map(t => t.massnahme.id), b.massnahmen.map(t => t.massnahme.id))
  })

  test('Laubarbeit Frechau (nur GST 2213/1, 2213/2, 2214, 1189/1) erscheint nicht bei Sandgrube 1305/1', () => {
    const frechau = ergebnis.find(e => e.leseId === '58049a76-ab4f-4bf5-9c50-ab44e1151667')
    const sandgrube = ergebnis.find(e => e.leseId === 'efee758b-5419-43c5-97e8-4eacd9ec9e35')
    assert.ok(frechau.massnahmen.some(t => t.massnahme.id === B('18')))
    assert.ok(!sandgrube.massnahmen.some(t => t.massnahme.id === B('18')))
  })

  test('Echtbetrieb ohne pw.ernte_datum: Lesedatum laut Erntemeldung → dieselben Fenster und Maßnahmen; 2024 ohne Eintrag bis zur Pressung', () => {
    const ohneDatum = lesenHelfer.map(l => ({ ...l, lesedatum: null }))
    const historie = ohneDatum.map(l => ({ id: l.id, grundstueckId: l.grundstueckId, lesedatum: null, jahrgang: l.jahrgang }))
    const echt = fenster.ordneMassnahmenZu(ohneDatum, historie, massnahmenHelfer, gstJeWg, wgJeGst, ernteHelfer, verpresstHelfer)
    let ausErnte = 0
    for (const z of echt) {
      const l = lesenHelfer.find(x => x.id === z.leseId)
      const soll = ergebnis.find(e => e.leseId === z.leseId)
      if (l.jahrgang === 2024) {
        assert.equal(z.fenster.bisAus, 'pressungsdatum', z.leseId)
        assert.equal(z.fenster.bis, l.pressungDatum)
        assert.match(z.hinweise[0], /^Lesedatum weder an der Pressung noch in der Erntemeldung erfasst – Zeitfenster bis zum Pressungsdatum/)
        assert.equal(z.massnahmen.length, 0)
        continue
      }
      ausErnte++
      assert.equal(z.fenster.bisAus, 'erntemeldung', z.leseId)
      assert.equal(z.fenster.bis, l.lesedatum, z.leseId)                 // = Lesedatum laut Lesezeile
      assert.equal(z.fenster.von, soll.fenster.von)
      assert.deepEqual(z.massnahmen.map(t => t.massnahme.id), soll.massnahmen.map(t => t.massnahme.id), z.leseId)
      for (const t of z.massnahmen) assert.ok(t.massnahme.datum <= l.lesedatum, `${t.massnahme.id} nach der Lese ${z.leseId}`)
      assert.match(z.hinweise[0], new RegExp(`^Lesedatum an der Pressung nicht erfasst – Zeitfenster bis zum Lesedatum laut Erntemeldung ${fenster.ttmmjjjj(l.lesedatum).replace(/\./g, '\\.')}`))
      assert.equal(z.ersatz.grund, 'eindeutig', z.leseId)                // ein Lesetag, Menge deckt das Verpresste
    }
    assert.equal(ausErnte, 15)
    // Frechau Zweigelt (Lese 30.09., Pressung 06.10.): Fenster endet an der Lese, nicht an der Pressung
    const frechau = echt.find(e => e.leseId === '58049a76-ab4f-4bf5-9c50-ab44e1151667')
    assert.equal(frechau.fenster.bis, '2025-09-30')
  })
})

// ── Randfälle der reinen Funktion ────────────────────────────────────────────

const lese = (id, extra = {}) => ({ id, grundstueckId: 'gA', weingartenId: 'w1', lesedatum: '2025-10-05', pressungDatum: '2025-10-05', jahrgang: 2025, ...extra })
const m = (id, datum, extra = {}) => ({ id, datum, datumBis: null, weingartenId: 'w1', grundstueckIds: ['gA'], ...extra })
const GST_W1 = new Map([['w1', ['gA', 'gB']], ['w2', ['gC']]])
const WG_GST = new Map([['gA', 'w1'], ['gB', 'w1'], ['gC', 'w2']])
const zuordnen = (lesen, massnahmen, historie = lesen) => fenster.ordneMassnahmenZu(lesen, historie, massnahmen, GST_W1, WG_GST)
const ids = z => z.massnahmen.map(t => t.massnahme.id)

describe('Zeitfenster – Randfälle', () => {
  test('mehrere Lesen desselben GST im selben Jahr: zweite Lese ab dem Tag nach der ersten', () => {
    const erste = lese('l1', { lesedatum: '2025-09-10', pressungDatum: '2025-09-10' })
    const zweite = lese('l2')
    const [a, b] = zuordnen([erste, zweite], [m('vorher', '2025-06-01'), m('amErstenLesetag', '2025-09-10'), m('tagDanach', '2025-09-11'), m('amLesetag', '2025-10-05'), m('danach', '2025-10-06')])
    assert.deepEqual(a.fenster, { von: '2025-01-01', bis: '2025-09-10', beginn: 'jahresbeginn', vorigeLese: null, bisAus: 'lesedatum' })
    assert.deepEqual(ids(a), ['vorher', 'amErstenLesetag'])
    assert.deepEqual(b.fenster, { von: '2025-09-11', bis: '2025-10-05', beginn: 'vorige_lese', vorigeLese: '2025-09-10', bisAus: 'lesedatum' })
    assert.deepEqual(ids(b), ['tagDanach', 'amLesetag'])
    assert.equal(fenster.fensterBeginnText(b.fenster), 'ab dem Tag nach der vorigen Lese dieses Grundstücks am 10.09.2025')
  })

  test('vorige Lese aus einer anderen Charge zählt (Historie), die eines anderen GST nicht', () => {
    const [z] = zuordnen([lese('l2')], [m('a', '2025-09-01')], [
      { id: 'l2', grundstueckId: 'gA', lesedatum: '2025-10-05' },
      { id: 'andereCharge', grundstueckId: 'gA', lesedatum: '2025-09-20' },
      { id: 'anderesGst', grundstueckId: 'gB', lesedatum: '2025-09-30' },
      { id: 'ohneDatum', grundstueckId: 'gA', lesedatum: null },
    ])
    assert.equal(z.fenster.von, '2025-09-21')
    assert.deepEqual(ids(z), [])
  })

  test('Maßnahme am Lesetag zählt, am Folgetag nicht; mehrtägig über die vorige Lese hinweg zählt', () => {
    const [, z] = zuordnen([lese('l1', { lesedatum: '2025-09-10' }), lese('l2')], [
      m('ueberlappt', '2025-09-08', { datumBis: '2025-09-12' }), m('endetAmVorigenLesetag', '2025-09-05', { datumBis: '2025-09-10' }),
      m('lesetag', '2025-10-05'), m('folgetag', '2025-10-06'), m('beginntVorEndetNach', '2025-10-04', { datumBis: '2025-10-07' }),
    ])
    assert.deepEqual(ids(z), ['ueberlappt', 'beginntVorEndetNach', 'lesetag'])
  })

  test('Jahrgangswechsel: Lese des Vorjahres verkürzt nicht, Fenster ab 01.01.; über Silvester reichende Maßnahme zählt', () => {
    const vorjahr = lese('l2024', { lesedatum: '2024-10-01', pressungDatum: '2024-10-01', jahrgang: 2024 })
    const [a, b] = zuordnen([vorjahr, lese('l2025', { lesedatum: '2025-09-20' })], [
      m('herbst2024', '2024-11-15'), m('silvester', '2024-12-20', { datumBis: '2025-01-05' }), m('fruehjahr', '2025-04-01'), m('nachLese2024', '2024-10-02'),
    ])
    assert.deepEqual(ids(a), [])                                            // nichts vor der Lese 2024 erfasst
    assert.deepEqual(b.fenster, { von: '2025-01-01', bis: '2025-09-20', beginn: 'jahresbeginn', vorigeLese: null, bisAus: 'lesedatum' })
    assert.deepEqual(ids(b), ['silvester', 'fruehjahr'])
  })

  test('Eiswein: Jahrgang 2024, Lese im Jänner 2025 → Fenster ab der vorigen Lese 2024 (bzw. 01.01.2024)', () => {
    const herbst = lese('herbst', { lesedatum: '2024-09-20', jahrgang: 2024 })
    const eis = lese('eis', { lesedatum: '2025-01-10', pressungDatum: '2025-01-10', jahrgang: 2024 })
    const [, z] = zuordnen([herbst, eis], [m('vorHerbst', '2024-08-01'), m('dezember', '2024-12-01')])
    assert.equal(z.fenster.von, '2024-09-21')
    assert.deepEqual(ids(z), ['dezember'])
    const [allein] = zuordnen([eis], [m('vorHerbst', '2024-08-01')])
    assert.equal(allein.fenster.von, '2024-01-01')
    assert.deepEqual(ids(allein), ['vorHerbst'])
  })

  test('Eiswein des Vorjahrgangs im Jänner verkürzt das Fenster der nächsten Lese nicht (nur Lesen desselben Jahrgangs)', () => {
    const eis = lese('eis2025', { lesedatum: '2026-01-10', pressungDatum: '2026-01-10', jahrgang: 2025 })
    const haupt = lese('haupt2026', { lesedatum: '2026-09-15', pressungDatum: '2026-09-15', jahrgang: 2026 })
    const [, z] = zuordnen([eis, haupt], [m('jaenner', '2026-01-05'), m('mai', '2026-05-01')])
    assert.deepEqual(z.fenster, { von: '2026-01-01', bis: '2026-09-15', beginn: 'jahresbeginn', vorigeLese: null, bisAus: 'lesedatum' })
    assert.deepEqual(ids(z), ['jaenner', 'mai'])
    // Jahrgang der Historie unbekannt: nur das Datum entscheidet (wie bisher)
    const [y] = zuordnen([haupt], [m('jaenner', '2026-01-05')], [{ id: 'eis2025', grundstueckId: 'gA', lesedatum: '2026-01-10' }])
    assert.equal(y.fenster.von, '2026-01-11')
  })

  test('Lese ohne GST: alle GST des Weingartens ab 01.01. (auch bei voriger Lese), mit Hinweis und GST je Maßnahme', () => {
    const vorige = lese('l1', { lesedatum: '2025-09-10' })
    const ohne = lese('l2', { grundstueckId: null })
    const [, z] = zuordnen([vorige, ohne], [
      m('gA', '2025-05-01'), m('gB', '2025-06-01', { grundstueckIds: ['gB'] }), m('beide', '2025-07-01', { grundstueckIds: ['gA', 'gB', 'gC'] }),
      m('fremderWg', '2025-07-02', { weingartenId: 'w2', grundstueckIds: ['gC'] }), m('nurWg', '2025-08-01', { grundstueckIds: [] }),
      m('nurWgFremd', '2025-08-02', { weingartenId: 'w2', grundstueckIds: [] }), m('nachLese', '2025-10-06', { grundstueckIds: ['gB'] }),
    ])
    assert.equal(z.fenster.von, '2025-01-01')
    assert.equal(z.fenster.beginn, 'jahresbeginn')
    assert.deepEqual(ids(z), ['gA', 'gB', 'beide', 'nurWg'])
    assert.deepEqual(z.massnahmen.find(t => t.massnahme.id === 'beide').grundstueckIds, ['gA', 'gB'])
    assert.equal(z.massnahmen.find(t => t.massnahme.id === 'nurWg').nurWeingarten, true)
    assert.deepEqual(z.hinweise, [fenster.HINWEIS_OHNE_GST, '1 Maßnahme ist nur am Weingarten erfasst (ohne Grundstück) und hier mit aufgeführt.'])
  })

  test('Lese mit GST: fremdes GST desselben Weingartens nicht, Maßnahme nur am Weingarten schon (mit Kennzeichen)', () => {
    const [z] = zuordnen([lese('l1')], [
      m('eigenes', '2025-05-01'), m('fremdesGst', '2025-05-02', { grundstueckIds: ['gB'] }),
      m('nurWg', '2025-05-03', { grundstueckIds: [] }), m('nurWgGstWeingarten', '2025-05-04', { weingartenId: 'w1', grundstueckIds: [] }),
      m('nurFremderWg', '2025-05-05', { weingartenId: 'w2', grundstueckIds: [] }), m('ohneOrt', '2025-05-06', { weingartenId: null, grundstueckIds: [] }),
    ])
    assert.deepEqual(ids(z), ['eigenes', 'nurWg', 'nurWgGstWeingarten'])
    assert.deepEqual(z.massnahmen.map(t => t.nurWeingarten), [false, true, true])
    assert.match(z.hinweise[0], /^2 Maßnahmen sind nur am Weingarten erfasst/)
    // Weingarten laut Grundstück zählt auch, wenn die Lesezeile einen anderen Weingarten nennt
    const [y] = zuordnen([lese('l9', { weingartenId: 'w2' })], [m('nurW1', '2025-05-03', { grundstueckIds: [] })])
    assert.deepEqual(ids(y), ['nurW1'])
  })

  test('Lese ohne Lesedatum und ohne Erntemeldung: bis zum Pressungsdatum, keine Verkürzung über eine vorige Lese, Hinweis', () => {
    const [, z] = zuordnen([lese('l1', { lesedatum: '2025-09-10' }), lese('l2', { lesedatum: null, pressungDatum: '2025-10-07' })], [m('juni', '2025-06-01'), m('okt', '2025-10-07'), m('spaet', '2025-10-08')])
    assert.deepEqual(z.fenster, { von: '2025-01-01', bis: '2025-10-07', beginn: 'jahresbeginn', vorigeLese: null, bisAus: 'pressungsdatum' })
    assert.deepEqual(ids(z), ['juni', 'okt'])
    assert.deepEqual(z.hinweise, ['Lesedatum weder an der Pressung noch in der Erntemeldung erfasst – Zeitfenster bis zum Pressungsdatum 07.10.2025; Maßnahmen zwischen Lese und Pressung können mit aufgeführt sein.'])
  })

  test('Echtbetrieb (Gutachten KAN-75): Zweigelt gelesen 25.09., gepresst 10.10., Kupfer am GST 05.10. → nicht bei der Lese', () => {
    const zw = lese('zw', { lesedatum: null, pressungDatum: '2026-10-10', jahrgang: 2026, jahrgangId: 'jg26' })
    const ms = [m('juli', '2026-07-01'), m('lesetag', '2026-09-25'), m('kupfer', '2026-10-05')]
    const ernte = [{ jahrgangId: 'jg26', weingartenId: 'w1', grundstueckId: 'gA', lesedatum: '2026-09-25' }]
    const [z] = fenster.ordneMassnahmenZu([zw], [], ms, GST_W1, WG_GST, ernte)
    assert.deepEqual(z.fenster, { von: '2026-01-01', bis: '2026-09-25', beginn: 'jahresbeginn', vorigeLese: null, bisAus: 'erntemeldung' })
    assert.deepEqual(ids(z), ['juli', 'lesetag'])
    assert.deepEqual(z.hinweise, ['Lesedatum an der Pressung nicht erfasst – Zeitfenster bis zum Lesedatum laut Erntemeldung 25.09.2026 (einziger passender Lesetag im Jahrgang, Pressung am 10.10.2026).'])
    // ohne Erntemeldung: bis zur Pressung, Kupfer dabei – aber mit Hinweis, nie still
    const [y] = fenster.ordneMassnahmenZu([zw], [], ms, GST_W1, WG_GST, [])
    assert.deepEqual(ids(y), ['juli', 'lesetag', 'kupfer'])
    assert.equal(y.fenster.bisAus, 'pressungsdatum')
  })

  test('Lesedatum laut Erntemeldung: nur ein eindeutiger Lesetag bis zur Pressung, im Zweifel keiner', () => {
    const e = (lesedatum, extra = {}) => ({ jahrgangId: 'jg25', weingartenId: 'w1', grundstueckId: 'gA', lesedatum, ...extra })
    const mitGst = lese('l', { lesedatum: null, pressungDatum: '2025-10-12', jahrgangId: 'jg25' })
    const ld = (l, eintraege) => fenster.lesedatumLautErntemeldung(l, eintraege)
    // Vorlese und Spätlese am selben GST: offen, welche verpresst wurde → keiner (Pressungsdatum),
    // auch wenn ein Eintrag nach der Pressung liegt
    assert.equal(ld(mitGst, [e('2025-09-20'), e('2025-10-10'), e('2025-10-20')]), null)
    assert.equal(ld(mitGst, [e('2025-09-20'), e('2025-10-10')]), null)
    // zwei Einträge am selben Tag (z. B. Kabinett + Spätlese an einem Lesetag): ein Lesetag
    assert.equal(ld(mitGst, [e('2025-10-10'), e('2025-10-10')]), '2025-10-10')
    // Eintrag ohne GST am Weingarten der Lesezeile zählt mit (anderer Tag → nicht eindeutig),
    // anderes GST und anderer Jahrgang nicht
    assert.equal(ld(mitGst, [e('2025-09-20'), e('2025-10-01', { grundstueckId: null })]), null)
    assert.equal(ld(mitGst, [e('2025-10-01', { grundstueckId: null })]), '2025-10-01')
    assert.equal(ld(mitGst, [e('2025-09-20'), e('2025-10-01', { grundstueckId: 'gB' }), e('2025-10-02', { jahrgangId: 'jg24' })]), '2025-09-20')
    assert.equal(ld(mitGst, [e('2025-10-01', { grundstueckId: null, weingartenId: 'w2' })]), null)
    // passender Eintrag ohne Datum: offen, welche Lese verpresst wurde → Pressungsdatum
    assert.equal(ld(mitGst, [e('2025-09-20'), e(null)]), null)
    // nur Einträge nach der Pressung, keine Einträge, kein Jahrgang, keine Pressung: keiner
    assert.equal(ld(mitGst, [e('2025-10-20')]), null)
    assert.equal(ld(mitGst, []), null)
    assert.equal(ld({ ...mitGst, jahrgangId: null }, [e('2025-09-20')]), null)
    assert.equal(ld({ ...mitGst, pressungDatum: null }, [e('2025-09-20')]), null)
    // Lesezeile ohne GST: alle Einträge des Weingartens; ohne Weingarten und GST: keiner
    assert.equal(ld({ ...mitGst, grundstueckId: null }, [e('2025-10-01'), e('2025-10-01', { grundstueckId: 'gB' })]), '2025-10-01')
    assert.equal(ld({ ...mitGst, grundstueckId: null }, [e('2025-09-20'), e('2025-10-01', { grundstueckId: 'gB' })]), null)
    assert.equal(ld({ ...mitGst, grundstueckId: null, weingartenId: null }, [e('2025-09-20', { weingartenId: null, grundstueckId: null })]), null)
    // eigenes Lesedatum geht immer vor; der Ersatz verkürzt nie über eine vorige Lese
    const vorige = lese('v', { lesedatum: '2025-09-01', jahrgangId: 'jg25' })
    const [, z] = fenster.ordneMassnahmenZu([vorige, mitGst], [vorige, mitGst], [m('aug', '2025-08-15')], GST_W1, WG_GST, [e('2025-10-10')])
    assert.equal(z.fenster.bis, '2025-10-10')
    assert.equal(z.fenster.von, '2025-01-01')
    assert.deepEqual(ids(z), ['aug'])
    assert.equal(fenster.leseFenster(vorige, [], [e('2025-10-10')]).bis, '2025-09-01')
  })

  // Prüfrunde 2: GST A, Vorlese 20.09. (500 kg, gepresst 21.09.), Hauptlese tatsächlich 05.10.
  // (2.000 kg, gepresst 06.10.), Spritzung 28.09. – die Hauptlese ist in der Erntemeldung
  // vertippt (15.10.) oder noch nicht erfasst. Vorher endete das Fenster an der Vorlese.
  describe('Mehrfachlese: Vorlese + vertippte bzw. fehlende Hauptlese in der Erntemeldung', () => {
    const e = (lesedatum, mengeKg, extra = {}) => ({ jahrgangId: 'jg26', weingartenId: 'w1', grundstueckId: 'gA', lesedatum, mengeKg, ...extra })
    const vorlese = lese('vor', { lesedatum: null, pressungDatum: '2026-09-21', jahrgang: 2026, jahrgangId: 'jg26' })
    const haupt = lese('haupt', { lesedatum: null, pressungDatum: '2026-10-06', jahrgang: 2026, jahrgangId: 'jg26' })
    const v = (l, traubenKg, extra = {}) => ({ id: l.id, jahrgangId: 'jg26', weingartenId: 'w1', grundstueckId: 'gA', pressungDatum: l.pressungDatum, traubenKg, ...extra })
    const verpresst = [v(vorlese, 500), v(haupt, 2000)]
    const ms = [m('juli', '2026-07-01'), m('sprit2809', '2026-09-28'), m('nachPressung', '2026-10-07')]
    const zu = (lesen, ernte, vp = verpresst) => fenster.ordneMassnahmenZu(lesen, [], ms, GST_W1, WG_GST, ernte, vp)

    test('Hauptlese vertippt (15.10. nach der Pressung): mehrere Lesetage → bis zur Pressung, Spritzung 28.09. dabei', () => {
      const [z] = zu([haupt], [e('2026-09-20', 500), e('2026-10-15', 2000)])
      assert.deepEqual(z.fenster, { von: '2026-01-01', bis: '2026-10-06', beginn: 'jahresbeginn', vorigeLese: null, bisAus: 'pressungsdatum' })
      assert.deepEqual(ids(z), ['juli', 'sprit2809'])
      assert.equal(z.ersatz.grund, 'mehrere_lesetage')
      assert.deepEqual(z.hinweise, ['Lesedatum an der Pressung nicht erfasst und laut Erntemeldung nicht eindeutig (mehrere Lesetage: 20.09.2026, 15.10.2026) – Zeitfenster bis zum Pressungsdatum 06.10.2026; Maßnahmen zwischen Lese und Pressung können mit aufgeführt sein.'])
    })

    test('Hauptlese noch nicht erfasst: Vorlese-Eintrag deckt die verpressten 2.500 kg nicht → bis zur Pressung', () => {
      const [z] = zu([haupt], [e('2026-09-20', 500)])
      assert.equal(z.fenster.bis, '2026-10-06')
      assert.equal(z.fenster.bisAus, 'pressungsdatum')
      assert.deepEqual(ids(z), ['juli', 'sprit2809'])
      assert.deepEqual({ ...z.ersatz }, { datum: null, grund: 'menge_nicht_gedeckt', lesetage: ['2026-09-20'], erfasstKg: 500, verpresstKg: 2500 })
      assert.deepEqual(z.hinweise, ['Lesedatum an der Pressung nicht erfasst und laut Erntemeldung nicht eindeutig (Lesetag 20.09.2026 mit 500 kg deckt die bis zur Pressung verpressten 2500 kg nicht – weitere Lese nicht erfasst?) – Zeitfenster bis zum Pressungsdatum 06.10.2026; Maßnahmen zwischen Lese und Pressung können mit aufgeführt sein.'])
      // die Pressung der Vorlese selbst bleibt beim Lesetag (bis 21.09. nur 500 kg verpresst)
      const [a] = zu([vorlese], [e('2026-09-20', 500)])
      assert.equal(a.fenster.bis, '2026-09-20')
      assert.equal(a.fenster.bisAus, 'erntemeldung')
      assert.deepEqual(ids(a), ['juli'])
      // Vorlese nicht verpresst (z. B. verkauft): die Hauptlese allein übersteigt die Erntemeldung
      const [b] = zu([haupt], [e('2026-09-20', 500)], [v(haupt, 2000)])
      assert.equal(b.ersatz.grund, 'menge_nicht_gedeckt')
      assert.deepEqual(ids(b), ['juli', 'sprit2809'])
    })

    test('ein zusätzlicher richtiger Eintrag verschlechtert das Ergebnis nicht mehr', () => {
      const ohneEintrag = zu([haupt], [])[0]
      for (const ernte of [[e('2026-09-20', 500)], [e('2026-09-20', 500), e('2026-10-15', 2000)], [e('2026-09-20', 500), e('2026-10-05', 2000)]]) {
        const [z] = zu([haupt], ernte)
        assert.deepEqual(ids(z), ids(ohneEintrag))
        assert.equal(z.fenster.bis, '2026-10-06')
      }
    })

    test('Lesetag nach der Pressung, Eintrag ohne Menge, fremder Jahrgang und anderes GST', () => {
      // einziger Lesetag nach der Pressung: Datenfehler → Pressungsdatum mit Grund
      const [a] = zu([haupt], [e('2026-10-15', 2000)])
      assert.equal(a.ersatz.grund, 'nach_pressung')
      assert.match(a.hinweise[0], /nicht eindeutig \(Lesetag 15\.10\.2026 liegt nach der Pressung\)/)
      // Eintrag ohne Menge deckt nichts
      const [b] = zu([haupt], [e('2026-10-05', null)], [v(haupt, 2000)])
      assert.equal(b.ersatz.grund, 'menge_nicht_gedeckt')
      assert.match(b.hinweise[0], /Lesetag 05\.10\.2026 ohne Menge deckt die bis zur Pressung verpressten 2000 kg nicht/)
      // Menge gedeckt, nur ein Lesetag: Lesetag gilt; Pressungen anderer GST, Jahrgänge und nach
      // dieser Pressung zählen nicht mit
      const [c] = zu([haupt], [e('2026-10-05', 2000)], [
        v(haupt, 2000), v({ id: 'andererGst', pressungDatum: '2026-10-01' }, 9000, { grundstueckId: 'gB' }),
        v({ id: 'vorjahr', pressungDatum: '2025-10-01' }, 9000, { jahrgangId: 'jg25' }), v({ id: 'spaeter', pressungDatum: '2026-10-20' }, 9000),
      ])
      assert.equal(c.fenster.bis, '2026-10-05')
      assert.equal(c.ersatz.grund, 'eindeutig')
      assert.deepEqual(ids(c), ['juli', 'sprit2809'])
    })

    test('X-Warnung nennt die nicht eindeutige Erntemeldung statt „weder … noch“', () => {
      const lesen = [...zu([haupt], [e('2026-09-20', 500)]), ...zu([haupt], [])]
      assert.deepEqual(fenster.leseWarnungen(lesen), [
        '1 Lese hat weder an der Pressung noch in der Erntemeldung ein Lesedatum – Zeitfenster bis zum Pressungsdatum, Maßnahmen zwischen Lese und Pressung können mit aufgeführt sein.',
        '1 Lese hat kein Lesedatum an der Pressung, und die Erntemeldung ist dafür nicht eindeutig (mehrere Lesetage, Lesetag nach der Pressung oder Menge nicht gedeckt) – Zeitfenster bis zum Pressungsdatum, Maßnahmen zwischen Lese und Pressung können mit aufgeführt sein.',
      ])
    })
  })

  test('Sammelwarnungen je Sonderfall (X-Warnungen der CSV)', () => {
    const f = bisAus => ({ von: '2025-01-01', bis: '2025-10-01', beginn: 'jahresbeginn', vorigeLese: null, bisAus })
    const w = fenster.leseWarnungen([
      { fenster: f('lesedatum'), hinweise: [], massnahmen: [{ nurWeingarten: false }] },
      { fenster: f('erntemeldung'), hinweise: ['…'], massnahmen: [{ nurWeingarten: true }] },
      { fenster: f('pressungsdatum'), hinweise: [fenster.HINWEIS_OHNE_GST], massnahmen: [{ nurWeingarten: true }, { nurWeingarten: true }] },
      { fenster: f('pressungsdatum'), hinweise: [fenster.HINWEIS_OHNE_ORT], massnahmen: [] },
      { fenster: null, hinweise: [fenster.HINWEIS_OHNE_FENSTER], massnahmen: [] },
    ])
    assert.deepEqual(w, [
      '2 Lesen haben weder an der Pressung noch in der Erntemeldung ein Lesedatum – Zeitfenster bis zum Pressungsdatum, Maßnahmen zwischen Lese und Pressung können mit aufgeführt sein.',
      '1 Lese hat kein Lesedatum an der Pressung – Zeitfenster bis zum Lesedatum laut Erntemeldung.',
      '1 Lese hat weder Lese- noch Pressungsdatum – alle Maßnahmen des Grundstücks aufgeführt.',
      '1 Lese ist ohne Grundstück erfasst – Maßnahmen aller Grundstücke des Weingartens ab 01.01. des Jahrgangs aufgeführt.',
      '1 Lesezeile hat weder Weingarten noch Grundstück (z. B. Traubenzukauf) – keine Maßnahmen zuordenbar.',
      'Bei 2 Lesen sind Maßnahmen mit aufgeführt, die nur am Weingarten erfasst sind (ohne Grundstück).',
    ])
    assert.deepEqual(fenster.leseWarnungen([{ fenster: f('lesedatum'), hinweise: [], massnahmen: [] }]), [])
  })

  test('Lese ohne Weingarten und GST (Zukauf): keine Maßnahmen, Hinweis; ohne jedes Datum: alle Maßnahmen des GST mit Hinweis', () => {
    const [z] = zuordnen([lese('l1', { grundstueckId: null, weingartenId: null })], [m('a', '2025-05-01')])
    assert.deepEqual(ids(z), [])
    assert.deepEqual(z.hinweise, [fenster.HINWEIS_OHNE_ORT])
    const [y] = zuordnen([lese('l2', { lesedatum: null, pressungDatum: null, jahrgang: null })], [m('a', '2025-05-01'), m('b', '2026-05-01')])
    assert.equal(y.fenster, null)
    assert.deepEqual(ids(y), ['a', 'b'])
    assert.deepEqual(y.hinweise, [fenster.HINWEIS_OHNE_FENSTER])
  })

  test('Lese ohne GST in einem Weingarten ohne Grundstücke: nur Maßnahmen am Weingarten, zwei Hinweise', () => {
    const [z] = fenster.ordneMassnahmenZu([lese('l1', { grundstueckId: null, weingartenId: 'w3' })], [], [m('nurW3', '2025-05-01', { weingartenId: 'w3', grundstueckIds: [] })], GST_W1, WG_GST)
    assert.deepEqual(ids(z), ['nurW3'])
    assert.deepEqual(z.hinweise.slice(0, 2), [fenster.HINWEIS_OHNE_GST, fenster.HINWEIS_WEINGARTEN_OHNE_GST])
  })

  test('Hilfen: Folgetag, Ladebereich, TT.MM.JJJJ', () => {
    assert.equal(fenster.tagDanach('2024-02-28'), '2024-02-29')
    assert.equal(fenster.tagDanach('2025-02-28'), '2025-03-01')
    assert.equal(fenster.tagDanach('2025-12-31'), '2026-01-01')
    assert.throws(() => fenster.tagDanach('31.12.2025'))
    assert.equal(fenster.ttmmjjjj('2025-09-10'), '10.09.2025')
    const f = (von, bis) => ({ von, bis, beginn: 'jahresbeginn', vorigeLese: null, bisAus: 'lesedatum' })
    assert.deepEqual(fenster.ladebereich([f('2025-01-01', '2025-09-10'), f('2024-01-01', '2024-09-30')]), { von: '2024-01-01', bis: '2025-09-10' })
    assert.deepEqual(fenster.ladebereich([f('2025-01-01', '2025-09-10'), null]), { von: null, bis: null })
    assert.deepEqual(fenster.ladebereich([]), { von: null, bis: null })
    assert.equal(fenster.kalendertag('2025-09-10T00:00:00+00:00'), '2025-09-10')
    assert.equal(fenster.kalendertag(''), null)
  })
})

// ── Gemeinsame Ladefunktion: Seite und CSV (Attrappe) ─────────────────────────

/** Wert an einem Pfad 'a.b' (eingebettete Relationen) */
const wert = (r, pfad) => pfad.split('.').reduce((o, k) => (o == null ? undefined : o[k]), r)

function attrappe(tabellen) {
  const log = []
  function from(tabelle) {
    const filter = []
    let einzel = false
    const sortierung = []
    const pruefe = (x, op, v) => {
      if (op === 'eq') return x === v
      if (op === 'in') return v.includes(x)
      if (op === 'gte') return x != null && x >= v
      if (op === 'lte') return x != null && x <= v
      return true
    }
    const b = {
      select() { return b }, range() { return b }, limit() { return b }, ilike() { return b },
      order(k, o) { sortierung.push([k, o?.ascending !== false]); return b },
      eq(k, v) { filter.push(['eq', k, v]); return b },
      in(k, v) { filter.push(['in', k, v]); return b },
      gte(k, v) { filter.push(['gte', k, v]); return b },
      lte(k, v) { filter.push(['lte', k, v]); return b },
      // nur die hier genutzte Form: 'a.op.wert,b.op.wert' (ODER)
      or(s) { filter.push(['or', s.split(',').map(t => { const [k, op, ...v] = t.split('.'); return [k, op, v.join('.')] })]); return b },
      maybeSingle() { einzel = true; return b },
      single() { einzel = true; return b },
      then(ok, fehler) {
        log.push({ tabelle, filter: filter.map(f => [...f]) })
        let rows = (tabellen[tabelle] ?? []).slice()
        for (const [op, k, v] of filter) {
          rows = rows.filter(r => op === 'or' ? k.some(([k2, op2, v2]) => pruefe(wert(r, k2), op2, v2)) : pruefe(wert(r, k), op, v))
        }
        rows.sort((r1, r2) => {
          for (const [k, auf] of sortierung) {
            const a = r1[k] ?? '', b2 = r2[k] ?? ''
            if (a < b2) return auf ? -1 : 1
            if (a > b2) return auf ? 1 : -1
          }
          return 0
        })
        return Promise.resolve({ data: einzel ? (rows[0] ?? null) : rows, error: null }).then(ok, fehler)
      },
    }
    return b
  }
  return { from, rpc: () => Promise.resolve({ data: [], error: null }), log }
}

const GST_NR = Object.fromEntries(GRUNDSTUECKE.map(([g, , nr]) => [G(g), nr]))
const WG_VON_GST = Object.fromEntries(GRUNDSTUECKE.map(([g, w]) => [G(g), W(w)]))

function pwZeile([pw, , , , wg, gst, leseDatum, , kg], ohneLesedatum) {
  return {
    id: pw, trauben_kg: String(kg), rebsorte: null, ernte_datum: ohneLesedatum ? null : leseDatum, kmw: null, weingarten_id: W(wg), grundstueck_id: gst ? G(gst) : null,
    weingarten: { id: W(wg), name: WEINGAERTEN[wg], flaeche_ha: null }, grundstueck: gst ? { gst_nr: GST_NR[G(gst)], katastralgemeinde: '12119' } : null,
  }
}

// Zusätzlich zu den Musterhof-Daten: Lese ohne GST (Sandgrube GV, Charge cX), Maßnahme nur am
// Weingarten Gebling Zweigelt, Maßnahme ohne Ort (KAN-121), fremder Betrieb am selben GST.
// echtbetrieb: ohne pw.ernte_datum (schreibt das Pressungsformular nicht) – dann gilt das
// Lesedatum laut Erntemeldung; dazu ein Lese-Eintrag eines fremden Betriebs.
const CX = 'c0000000-0000-4000-8000-0000000000aa'
const PW_OHNE_GST = 'e0000000-0000-4000-8000-000000000001'
const PW_FREMD = 'e0000000-0000-4000-8000-000000000002'
function tabellen({ echtbetrieb = false } = {}) {
  const lesen = [...LESEZEILEN, [PW_OHNE_GST, 'ff', '2025-09-18', 2025, '04', null, '2025-09-17', ['aa'], 1000]]
  // je Pressung alle ihre Lesezeilen, je Charge der Pressung eine pressung_behaelter-Zeile
  const jePressung = new Map()
  for (const z of lesen) jePressung.set(z[1], [...(jePressung.get(z[1]) ?? []), z])
  const pressungBehaelter = []
  for (const [p, zeilen] of jePressung) {
    const [, , pDatum, jahrgang] = zeilen[0]
    for (const ch of new Set(zeilen.flatMap(z => z[7]))) {
      pressungBehaelter.push({
        id: `pb-${p}-${ch}`, weinausbau_id: ch === 'aa' ? CX : C(ch), menge_liter: '1000', notizen: null,
        pressung: { id: P(p), datum: pDatum, most_liter_gesamt: '1000', tenant_id: T, jahrgang_id: JG(jahrgang), jahrgang: { jahrgang }, pressung_weingaerten: zeilen.map(z => pwZeile(z, echtbetrieb)) },
      })
    }
  }
  const behandlungen = MASSNAHMEN.map(([s, datum, bis, art, wg, psm, gst]) => ({
    id: B(s), tenant_id: T, datum, datum_bis: bis, art, weingarten_id: W(wg), aufwandmenge: null, aufwandmenge_einheit: null,
    schaderreger: null, witterung: null, notizen: null, psm: psm ? { name: psm, handelsname: null } : null,
    behandlung_grundstuecke: gst.map(g => ({ grundstueck_id: G(g), flaeche_ha: '0.5' })),
  }))
  behandlungen.push(
    { id: 'b-nur-wg', tenant_id: T, datum: '2025-08-30', datum_bis: null, art: 'duengung', weingarten_id: W('0b'), psm: null, behandlung_grundstuecke: [] },
    { id: 'b-ohne-ort', tenant_id: T, datum: '2025-08-31', datum_bis: null, art: 'sonstiges', weingarten_id: null, psm: null, behandlung_grundstuecke: [] },
    { id: 'b-fremd', tenant_id: X, datum: '2025-08-15', datum_bis: null, art: 'spritzung', weingarten_id: W('0b'), psm: { name: 'Fremdmittel' }, behandlung_grundstuecke: [{ grundstueck_id: G('10'), flaeche_ha: '1' }] },
  )
  // Lese-Historie und verpresste Trauben (Mengenprüfung) – beides aus pressung_weingaerten
  const historie = lesen.map(z => ({
    id: z[0], weingarten_id: W(z[4]), grundstueck_id: z[5] ? G(z[5]) : null, trauben_kg: String(z[8]), ernte_datum: echtbetrieb ? null : z[6],
    pressung: { tenant_id: T, datum: z[2], jahrgang_id: JG(z[3]), jahrgang: { jahrgang: z[3] } },
  }))
  // fremder Betrieb, selbes GST, früher im Jahr, große Menge – dürfte weder das Fenster von Gebling
  // Zweigelt verkürzen noch dessen Erntemeldung „nicht gedeckt“ machen
  historie.push({ id: PW_FREMD, weingarten_id: W('0b'), grundstueck_id: G('10'), trauben_kg: '99999', ernte_datum: '2025-08-01', pressung: { tenant_id: X, datum: '2025-08-01', jahrgang_id: JG(2025), jahrgang: { jahrgang: 2025 } } })
  return {
    weinausbau: [
      { id: C('0b'), tenant_id: T, name: 'Zweigelt Gebling 2025 I', jahrgang: 2025, rebsorte: 'Zweigelt' },
      { id: C('0c'), tenant_id: T, name: 'Zweigelt Gebling 2025 II', jahrgang: 2025, rebsorte: 'Zweigelt' },
      { id: C('11'), tenant_id: T, name: 'Grüner Veltliner Kremstal 2025', jahrgang: 2025, rebsorte: 'Grüner Veltliner' },
      { id: CX, tenant_id: T, name: 'GV Sandgrube ohne GST', jahrgang: 2025, rebsorte: 'Grüner Veltliner' },
    ],
    pressung_behaelter: pressungBehaelter,
    pressung_weingaerten: historie,
    ernte_parzellen: [
      ...ERNTEMELDUNG.map(([jahr, wg, datum, kg], i) => ({ id: `ep${i}`, jahrgang_id: JG(jahr), weingarten_id: W(wg), grundstueck_id: null, ernte_datum: datum, menge_kg: String(kg), jahrgang: { tenant_id: T } })),
      // fremder Betrieb, später am Weingarten Gebling Zweigelt – darf das Fensterende nicht verschieben
      { id: 'ep-fremd', jahrgang_id: JG(2025), weingarten_id: W('0b'), grundstueck_id: null, ernte_datum: '2025-09-12', menge_kg: '100', jahrgang: { tenant_id: X } },
    ],
    grundstuecke: GRUNDSTUECKE.map(([g, w, nr]) => ({ id: G(g), tenant_id: T, weingarten_id: W(w), gst_nr: nr })),
    behandlungen,
    fuellungen: [{ id: 'f1', tenant_id: T, name: 'Cuvée Musterhof', chargennummer: 'CH-TEST', pruefnummer: null, datum: '2026-03-01', jahrgang: 2025, rebsorte: 'Cuvée', anzahl_flaschen: 1000, flaschengroesse_ml: 750 }],
    fuellung_chargen: [C('0b'), C('0c'), C('11'), CX].map((w, i) => ({ id: `fc${i}`, tenant_id: T, fuellung_id: 'f1', weinausbau_id: w, anteil_liter: '100' })),
    weinanalysen: [],
    keller_umzuege: [],
  }
}

describe('Gemeinsame Ladefunktion – Seite und CSV zeigen dieselben Maßnahmen', () => {
  let sbSeite, sbCsv, seite, csvLaden
  before(async () => {
    const daten = tabellen()
    // Seite: ladeFuellungKette mit details (wie page.tsx)
    sbSeite = attrappe(daten)
    seite = await rueck.ladeFuellungKette(sbSeite, T, daten.fuellungen[0], { details: true })
    // CSV: Register-Eintrag wie die Route /meldungen/rueckverfolgung/csv
    sbCsv = attrappe(daten)
    const p = M.rueckverfolgung.parameter(new URLSearchParams(''))
    csvLaden = await M.rueckverfolgung.laden({ supabase: sbCsv, tenantId: T, membership: { tenantId: T, role: 'leser', schreibmodule: [] }, betrieb: { name: 'Musterhof', betriebsnummer: '1234567' } }, { ...p, fuellungId: 'f1' })
  })

  test('Seite: je Lese nur Maßnahmen bis zum Lesedatum, fremder Betrieb und Maßnahme ohne Ort nie', () => {
    assert.equal(seite.zuordnung, 'fuellung_chargen')
    const lesen = seite.chargen.flatMap(c => c.kette.lesen)
    assert.equal(lesen.length, 5)                                   // 2× Gebling, 2× Charge 11, 1× ohne GST
    for (const l of lesen) {
      const bis = l.lese.ernte_datum
      for (const mm of l.massnahmen) assert.ok(mm.behandlung.datum <= bis, `${mm.behandlung.id} nach ${bis}`)
      assert.ok(!l.massnahmen.some(mm => ['b-fremd', 'b-ohne-ort'].includes(mm.behandlung.id)))
    }
    const gebling = lesen.filter(l => l.lese.grundstueck_id === G('10'))
    for (const l of gebling) {
      assert.equal(l.fenster.von, '2025-01-01')                      // fremde Lese am 01.08. verkürzt nicht
      assert.equal(l.massnahmen.length, 22 + 1)                     // + Maßnahme nur am Weingarten
      const nurWg = l.massnahmen.find(mm => mm.behandlung.id === 'b-nur-wg')
      assert.equal(nurWg.nurWeingarten, true)
      assert.match(l.hinweise.join(' '), /nur am Weingarten erfasst/)
      assert.equal(l.massnahmen.find(mm => mm.behandlung.id === B('05')).flaecheHa, 0.5)
    }
    const ohne = lesen.find(l => l.leseId === PW_OHNE_GST)
    assert.equal(ohne.hinweise[0], fenster.HINWEIS_OHNE_GST)
    // Sandgrube GV hat GST 1305/1, 1305/2, 1306 – Düngung 25.03. traf 1305/1 und 1305/2
    assert.deepEqual(ohne.massnahmen.find(mm => mm.behandlung.id === B('03')).grundstuecke, ['1305/1', '1305/2'])
    assert.ok(ohne.massnahmen.every(mm => mm.behandlung.datum <= '2025-09-17'))
  })

  test('CSV: dieselben Maßnahmen je Lese (Anzahl und Text) wie die Seite, Fenster in eigenen Spalten', () => {
    const zeilen = csvLaden.zeilen
    const lesenSeite = new Map(seite.chargen.flatMap(c => c.kette.lesen).map(l => [l.leseId, l]))
    const mitLese = zeilen.filter(z => z.lesedatum)
    assert.equal(mitLese.length, 5)
    for (const z of mitLese) {
      const l = [...lesenSeite.values()].find(x => x.lese.ernte_datum === z.lesedatum && (x.lese.grundstueck?.gst_nr ?? null) === z.gstNr && Number(x.lese.trauben_kg) === z.traubenKg)
      assert.ok(l, `Lese ${z.lesedatum} ${z.gstNr}`)
      assert.equal(z.behandlungenAnzahl, l.massnahmen.length)
      assert.equal(z.behandlungen, l.massnahmen.map(mm => rueck.massnahmeText(mm, !l.lese.grundstueck_id)).join(' | ') || null)
      assert.equal(z.fensterVon, l.fenster.von)
      assert.equal(z.fensterBis, l.fenster.bis)
      assert.equal(z.behandlungenHinweis, rueck.leseHinweisText(l))
    }
    const text = csv.csvText(zeilen, rueck.SPALTEN_RUECKVERFOLGUNG)
    assert.ok(!text.includes('Fremdmittel'))
    assert.match(text, /01\.09\.2025–03\.09\.2025 Sonstiges/)
    assert.match(text, /30\.08\.2025 Düngung \(am Weingarten erfasst\)/)
    assert.match(text, /25\.03\.2025 Düngung \(GST 1305\/1, 1305\/2\)/)
  })

  test('CSV: Sonderfälle zusätzlich als X-Warnungen (je Lese einmal)', () => {
    assert.deepEqual(csvLaden.warnungen, [
      '1 Lese ist ohne Grundstück erfasst – Maßnahmen aller Grundstücke des Weingartens ab 01.01. des Jahrgangs aufgeführt.',
      'Bei 2 Lesen sind Maßnahmen mit aufgeführt, die nur am Weingarten erfasst sind (ohne Grundstück).',
    ])
  })

  test('Abfragen: jede mit Mandantenfilter, Maßnahmen im Gesamtbereich der Fenster', () => {
    for (const sb of [sbSeite, sbCsv]) {
      for (const e of sb.log.filter(l => ['grundstuecke', 'behandlungen', 'fuellung_chargen', 'weinausbau'].includes(l.tabelle))) {
        assert.ok(e.filter.some(([op, k, v]) => op === 'eq' && k === 'tenant_id' && v === T), e.tabelle)
      }
      const hist = sb.log.filter(l => l.tabelle === 'pressung_weingaerten')
      assert.ok(hist.length > 0 && hist.every(e => e.filter.some(([op, k, v]) => op === 'eq' && k === 'pressung.tenant_id' && v === T)))
      const beh = sb.log.filter(l => l.tabelle === 'behandlungen')
      assert.ok(beh.length > 0)
      for (const e of beh) {
        const bis = e.filter.find(([op, k]) => op === 'lte' && k === 'datum')?.[2]
        const oder = e.filter.find(([op]) => op === 'or')?.[1]
        assert.ok(bis && bis <= '2025-09-23', `lte ${bis}`)
        assert.deepEqual(oder?.map(([k, op]) => `${k}.${op}`), ['datum.gte', 'datum_bis.gte'])
      }
      // alle Lesezeilen mit Lesedatum: Erntemeldung wird nicht gebraucht
      assert.equal(sb.log.filter(l => l.tabelle === 'ernte_parzellen').length, 0)
    }
  })

  test('Parameter wie bisher (ungültige Füllung → 400)', () => {
    assert.ok(typen.istParameterFehler(M.rueckverfolgung.parameter(new URLSearchParams('fuellung_id=abc'))))
  })
})

describe('Gemeinsame Ladefunktion – Echtbetrieb ohne Lesedatum an der Pressung', () => {
  let sb, seite, normal, csvLaden
  before(async () => {
    const daten = tabellen({ echtbetrieb: true })
    sb = attrappe(daten)
    seite = await rueck.ladeFuellungKette(sb, T, daten.fuellungen[0], { details: true })
    normal = await rueck.ladeFuellungKette(attrappe(tabellen()), T, daten.fuellungen[0], { details: true })
    const p = M.rueckverfolgung.parameter(new URLSearchParams(''))
    csvLaden = await M.rueckverfolgung.laden({ supabase: attrappe(daten), tenantId: T, membership: { tenantId: T, role: 'leser', schreibmodule: [] }, betrieb: { name: 'Musterhof', betriebsnummer: '1234567' } }, { ...p, fuellungId: 'f1' })
  })

  test('Seite: Fenster bis zum Lesedatum laut Erntemeldung (fremder Betrieb zählt nicht), dieselben Maßnahmen wie mit Lesedatum', () => {
    const lesen = seite.chargen.flatMap(c => c.kette.lesen)
    const mitDatum = new Map(normal.chargen.flatMap(c => c.kette.lesen).map(l => [l.leseId, l]))
    assert.equal(lesen.length, 5)
    for (const l of lesen) {
      assert.equal(l.lese.ernte_datum, null)
      assert.equal(l.fenster.bisAus, 'erntemeldung', l.leseId)
      const soll = LESEZEILEN.find(z => z[0] === l.leseId)
      // Lesezeilen mit GST: genau das Lesedatum; ohne GST: einziger Lesetag des Weingartens (16.09.)
      assert.equal(l.fenster.bis, l.leseId === PW_OHNE_GST ? '2025-09-16' : soll[6], l.leseId)
      assert.deepEqual(l.massnahmen.map(mm => mm.behandlung.id), mitDatum.get(l.leseId).massnahmen.map(mm => mm.behandlung.id), l.leseId)
      assert.match(l.hinweise[0], /^Lesedatum an der Pressung nicht erfasst – Zeitfenster bis zum Lesedatum laut Erntemeldung/)
      assert.equal(l.ersatz.grund, 'eindeutig', l.leseId)
    }
    // Gebling Zweigelt, gepresst 13.09.: fremder Lese-Eintrag vom 12.09. verschiebt das Ende nicht,
    // die 99.999 kg des fremden Betriebs zählen nicht (5.200 kg erfasst = 2.000 + 3.200 kg verpresst)
    const gebling = lesen.find(l => l.leseId === '62796043-2710-49b8-a6ff-14fa445aea02')
    assert.equal(gebling.fenster.bis, '2025-09-10')
    assert.equal(gebling.ersatz.erfasstKg, 5200)
    assert.equal(gebling.ersatz.verpresstKg, 5200)
    // Sandgrube ohne GST (gepresst 18.09.): alle Pressungen des Weingartens bis dahin (9.000 + 1.000 kg)
    assert.equal(lesen.find(l => l.leseId === PW_OHNE_GST).ersatz.verpresstKg, 10000)
  })

  test('Abfrage der Erntemeldung und der verpressten Trauben mit Mandantenfilter über den Jahrgang', () => {
    const ep = sb.log.filter(l => l.tabelle === 'ernte_parzellen')
    assert.ok(ep.length > 0)
    for (const e of ep) {
      assert.ok(e.filter.some(([op, k, v]) => op === 'eq' && k === 'jahrgang.tenant_id' && v === T))
      assert.ok(e.filter.some(([op, k, v]) => op === 'in' && k === 'jahrgang_id' && v.length === 1 && v[0] === JG(2025)))
    }
    const vp = sb.log.filter(l => l.tabelle === 'pressung_weingaerten' && l.filter.some(([op, k]) => op === 'in' && k === 'pressung.jahrgang_id'))
    assert.ok(vp.length > 0)
    for (const e of vp) {
      assert.ok(e.filter.some(([op, k, v]) => op === 'eq' && k === 'pressung.tenant_id' && v === T))
      assert.ok(e.filter.some(([op, k, v]) => op === 'in' && k === 'pressung.jahrgang_id' && v.length === 1 && v[0] === JG(2025)))
    }
  })

  test('Erntemeldung deckt das Verpresste nicht (zweite Lese nicht erfasst): Pressung 13.09. bis zur Pressung, 10.09. bleibt', async () => {
    const daten = tabellen({ echtbetrieb: true })
    // Gebling Zweigelt: nur 2.000 kg erfasst, verpresst 2.000 kg am 10.09. und 3.200 kg am 13.09.
    daten.ernte_parzellen = daten.ernte_parzellen.map(e => e.weingarten_id === W('0b') && e.jahrgang_id === JG(2025) && e.jahrgang.tenant_id === T ? { ...e, menge_kg: '2000' } : e)
    const kette = await rueck.ladeFuellungKette(attrappe(daten), T, daten.fuellungen[0], { details: true })
    const lesen = kette.chargen.flatMap(c => c.kette.lesen)
    const erste = lesen.find(l => l.leseId === '3cd11817-f570-41ff-8219-22b4588f258e')
    const zweite = lesen.find(l => l.leseId === '62796043-2710-49b8-a6ff-14fa445aea02')
    assert.equal(erste.fenster.bis, '2025-09-10')
    assert.equal(erste.fenster.bisAus, 'erntemeldung')
    assert.equal(zweite.fenster.bis, '2025-09-13')
    assert.equal(zweite.fenster.bisAus, 'pressungsdatum')
    assert.equal(zweite.ersatz.grund, 'menge_nicht_gedeckt')
    assert.match(zweite.hinweise[0], /Lesetag 10\.09\.2025 mit 2000 kg deckt die bis zur Pressung verpressten 5200 kg nicht/)
    const p = M.rueckverfolgung.parameter(new URLSearchParams(''))
    const { warnungen } = await M.rueckverfolgung.laden({ supabase: attrappe(daten), tenantId: T, membership: { tenantId: T, role: 'leser', schreibmodule: [] }, betrieb: { name: 'Musterhof', betriebsnummer: '1234567' } }, { ...p, fuellungId: 'f1' })
    assert.ok(warnungen.includes('1 Lese hat kein Lesedatum an der Pressung, und die Erntemeldung ist dafür nicht eindeutig (mehrere Lesetage, Lesetag nach der Pressung oder Menge nicht gedeckt) – Zeitfenster bis zum Pressungsdatum, Maßnahmen zwischen Lese und Pressung können mit aufgeführt sein.'))
    assert.ok(warnungen.includes('4 Lesen haben kein Lesedatum an der Pressung – Zeitfenster bis zum Lesedatum laut Erntemeldung.'))
  })

  test('CSV: Fensterende laut Erntemeldung, Hinweis je Zeile und als X-Warnung', () => {
    const zeilen = csvLaden.zeilen.filter(z => z.fensterBis)
    assert.equal(zeilen.length, 5)
    for (const z of zeilen) {
      assert.equal(z.lesedatum, null)                                  // kein erfundenes Lesedatum
      assert.match(z.behandlungenHinweis, /Lesedatum an der Pressung nicht erfasst – Zeitfenster bis zum Lesedatum laut Erntemeldung/)
    }
    assert.ok(csvLaden.warnungen.includes('5 Lesen haben kein Lesedatum an der Pressung – Zeitfenster bis zum Lesedatum laut Erntemeldung.'))
    const [kopf] = csv.csvText(csvLaden.zeilen, rueck.SPALTEN_RUECKVERFOLGUNG).replace(/^﻿/, '').split('\r\n')
    assert.ok(kopf.split(';').includes('Behandlungen bis'))
  })
})

// ── Quelltextprüfung ──────────────────────────────────────────────────────────

describe('Verdrahtung', () => {
  const seite = quelle('src/app/(dashboard)/kellerbuch/rueckverfolgung/page.tsx')
  const lib = quelle('src/lib/behoerden/rueckverfolgung.ts')
  const register = quelle('src/lib/behoerden/register/kellerbuch.ts')

  test('Seite nutzt die gemeinsame Ladefunktion und zeigt Kette.lesen je Lese', () => {
    assert.match(seite, /import \{[^}]*\bladeFuellungKette\b[^}]*\} from '@\/lib\/behoerden\/rueckverfolgung'/)
    assert.match(seite, /await ladeFuellungKette\(supabase, tenantId, fuellung, \{ details: true \}\)/)
    assert.match(seite, /lesen=\{entry\.kette\.lesen\}/)
    assert.match(seite, /Maßnahmen im Weingarten bis zur Lese/)
  })
  test('Seite lädt keine Maßnahmen selbst', () => {
    assert.doesNotMatch(seite, /from\('behandlung/)
    assert.doesNotMatch(seite, /behandlung_grundstuecke/)
    assert.doesNotMatch(seite, /kette\.behandlungen/)
  })
  test('CSV: Register lädt über ladeRueckverfolgung → ladeFuellungKette → ladeChargeKette → ladeLeseMassnahmen', () => {
    assert.match(register, /ladeRueckverfolgung\(ctx\.supabase, ctx\.tenantId, p\)/)
    assert.match(lib, /ladeFuellungKette\(supabase, tenantId, f, \{ cache \}\)/)
    assert.match(lib, /const lesen = await ladeLeseMassnahmen\(supabase, tenantId, pressungen\)/)
    assert.match(lib, /leseJeId\.get\(String\(wg\.id\)\)/)
    // kein zweiter, ungefilterter Weg zu den Maßnahmen
    assert.equal((lib.match(/from\('behandlung/g) ?? []).length, 1)
    assert.doesNotMatch(lib, /from\('behandlung_grundstuecke'\)/)
  })
  test('Fenstermodul ohne \'@/\'-Importe (node:test-fähig) und mit festgehaltener Annahme KAN-38', () => {
    const f = quelle('src/lib/behoerden/rueckverfolgungFenster.ts')
    assert.doesNotMatch(f, /^import /m)
    assert.match(f, /ANNAHME \(offene Frage KAN-38/)
  })
})
