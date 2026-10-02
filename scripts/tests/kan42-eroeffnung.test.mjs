// KAN-42 Etappe 1 (02.10.2026) – Eröffnungsbestand zum Stichtag (Tank und Flaschen) für den Echtbetrieb ab 01.01.2027
//
// Aufruf:  npm run -s test:csv   (alle scripts/tests/*.test.mjs)
//
// 1. Stichtag: Standard 01.01., Grenzen, created_at = 00:00 Uhr Wiener Zeit, gelesen als Wiener Kalendertag
//    (bestehende Eröffnungsbestände vom 01.01.2026 bleiben am 01.01.2026).
// 2. Tank-Zeilen: gültig und ungültig (Gebinde unbekannt/belegt/fremd/doppelt, Liter, Kataloge, Mostgewicht).
// 3. Flaschen-Zeilen: gültig und ungültig (Flaschengröße, Anzahl, Land, Qualität, doppelt).
// 4. Vorlagen: Kopfzeilen = Spalten der Felder, Excel-AT-Format, Beispielzeile besteht die eigene Prüfung.
// 5. Gebindestand am Stichtag (Rückrechnung wie die Bestandsmeldung).
// 6. Quelltext: Import nutzt die Kernlogik der Einzelformulare (kein zweiter Schreibpfad), Bewegungsbuch liest den
//    Stichtag aus created_at, Flaschen-Eröffnungsbestand ohne Tankabgang.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { hooksRegistrieren, laden, nurMitHooks } from './buchung-attrappe.mjs'

hooksRegistrieren()

const quelle = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')

// ── 1. Stichtag ───────────────────────────────────────────────────────────────────────────────────────────

describe('KAN-42 Stichtag', nurMitHooks, () => {
  test('Standard 01.01. des laufenden Jahres, Prüfung der Grenzen', async () => {
    const s = await laden('lib/kellerbuch/eroeffnungsStichtag.ts')
    assert.equal(s.standardEroeffnungsStichtag('2026-10-02'), '2026-01-01')
    assert.equal(s.eroeffnungsStichtagFehler('2027-01-01', '2026-12-15'), null)
    assert.equal(s.eroeffnungsStichtagFehler('2026-01-01', '2026-10-02'), null)
    assert.match(s.eroeffnungsStichtagFehler('2026-02-30', '2026-10-02'), /gültigen Stichtag/)
    assert.match(s.eroeffnungsStichtagFehler('01.01.2027', '2026-10-02'), /gültigen Stichtag/)
    assert.match(s.eroeffnungsStichtagFehler('', '2026-10-02'), /gültigen Stichtag/)
    assert.match(s.eroeffnungsStichtagFehler('2028-01-01', '2026-10-02'), /zu weit in der Zukunft – höchstens bis 31\.12\.2027/)
    assert.match(s.eroeffnungsStichtagFehler('1999-12-31', '2026-10-02'), /vor dem Jahr 2000/)
    assert.equal(s.stichtagText('2027-01-01'), '01.01.2027')
  })

  test('created_at = Stichtag 00:00 Uhr Wiener Zeit (Winter- und Sommerzeit)', async () => {
    const s = await laden('lib/kellerbuch/eroeffnungsStichtag.ts')
    assert.equal(s.eroeffnungsZeitpunkt('2027-01-01'), '2026-12-31T23:00:00.000Z')
    assert.equal(s.eroeffnungsZeitpunkt('2026-07-01'), '2026-06-30T22:00:00.000Z')
    assert.equal(s.eroeffnungsZeitpunkt('2026-03-29'), '2026-03-28T23:00:00.000Z')   // Umstellung erst um 2 Uhr
    assert.equal(s.eroeffnungsZeitpunkt('2026-10-25'), '2026-10-24T22:00:00.000Z')
    assert.throws(() => s.eroeffnungsZeitpunkt('2026-13-01'))
  })

  test('gelesen als Wiener Kalendertag – Rundlauf und bestehende Daten', async () => {
    const s = await laden('lib/kellerbuch/eroeffnungsStichtag.ts')
    for (const t of ['2027-01-01', '2026-01-01', '2026-03-29', '2026-03-30', '2026-10-25', '2026-12-31', '2028-02-29']) {
      assert.equal(s.eroeffnungsTag(s.eroeffnungsZeitpunkt(t)), t, t)
    }
    // bisher: new Date('2026-01-01T00:00:00').toISOString() auf dem UTC-Server bzw. lokal in Wien
    assert.equal(s.eroeffnungsTag('2026-01-01T00:00:00+00:00'), '2026-01-01')
    assert.equal(s.eroeffnungsTag('2026-01-01 00:00:00+00'), '2026-01-01')
    assert.equal(s.eroeffnungsTag('2025-12-31T23:00:00.000Z'), '2026-01-01')
    assert.equal(s.eroeffnungsTag('2027-01-01'), '2027-01-01')
    assert.equal(s.eroeffnungsTag(null), null)
    assert.equal(s.eroeffnungsTag('kein Datum'), null)
  })

  test('Kennzeichen Flaschen-Eröffnungsbestand', async () => {
    const s = await laden('lib/kellerbuch/eroeffnungsStichtag.ts')
    assert.equal(s.IMPORT_QUELLE_EROEFFNUNG, 'eroeffnungsbestand')
    assert.equal(s.istFlaschenEroeffnung({ import_quelle: 'eroeffnungsbestand', weinausbau_id: null }), true)
    assert.equal(s.istFlaschenEroeffnung({ import_quelle: 'eroeffnungsbestand', weinausbau_id: 'x' }), false)
    assert.equal(s.istFlaschenEroeffnung({ import_quelle: 'Datenmigration aus Drittsystem', weinausbau_id: null }), false)
  })
})

// ── 2. Tank ───────────────────────────────────────────────────────────────────────────────────────────────

const STICHTAG = '2027-01-01'
const g = (id, name, rest = {}) => ({ id, name, anzeigeName: name, volumen: 3000, aktiv: true, fremdBelegt: null, literHeute: 0, literAmStichtag: 0, ...rest })
const GEBINDE = [
  g('g1', 'T12'),
  g('g2', 'T13', { volumen: 1000 }),
  g('g3', 'T14', { literHeute: 500 }),
  g('g4', 'T15', { literAmStichtag: 200 }),
  g('g5', 'P1', { anzeigeName: 'P1 · Weingut Nachbar', fremdBelegt: 'Weingut Nachbar' }),
  g('g6', 'T16', { aktiv: false }),
  g('g7', 'T17', { volumen: null }),
]
const TANK_KOPF = ['Gebinde', 'Chargenname', 'Rebsorte', 'Jahrgang', 'Menge (l)', 'Qualitätsstufe', 'Zusatzbezeichnung', 'Erzeugnis', 'Weinart', 'Herkunfts-Code', 'Mostgewicht', 'Einheit Mostgewicht', 'Prüfnummer', 'Notiz']
const tz = (w = {}) => ({
  Gebinde: 'T12', Chargenname: 'GV Hohenberg', Rebsorte: 'Grüner Veltliner', Jahrgang: '2026', 'Menge (l)': '1.500,5',
  'Qualitätsstufe': 'Qualitätswein', Zusatzbezeichnung: '', Erzeugnis: '', Weinart: 'weiß', 'Herkunfts-Code': 'Weinviertel DAC',
  Mostgewicht: '19,2', 'Einheit Mostgewicht': '°KMW', 'Prüfnummer': '', Notiz: '', ...w,
})

describe('KAN-42 Tank-Zeilen', nurMitHooks, () => {
  test('gültige Zeile → Eingabe mit Katalogwerten', async () => {
    const m = await laden('lib/import/eroeffnungsbestand.ts')
    const b = m.pruefeTankZeilen(TANK_KOPF, [tz()], GEBINDE, { stichtag: STICHTAG })
    assert.deepEqual(b.dateiFehler, [])
    const z = b.zeilen[0]
    assert.deepEqual(z.fehler, [])
    assert.equal(z.zeile, 2)
    assert.deepEqual(z.eingabe, {
      behaelterId: 'g1', gebinde: 'T12', name: 'GV Hohenberg', rebsorte: 'Grüner Veltliner', jahrgang: 2026, liter: 1500.5,
      angabe: { stufe: 'qualitaetswein', zusatz: null, erzeugnis: null }, weinart: 'weiss', herkunftCode: 'weinviertel_dac',
      mostgewicht: { wert: '19,2', einheit: 'kmw' }, pruefnummer: null, notiz: null,
    })
  })

  test('Varianten: Einheit in der Zelle, °Oe, Code und BKI-Kürzel, Spaltenköpfe in anderer Schreibweise', async () => {
    const m = await laden('lib/import/eroeffnungsbestand.ts')
    const kopf = ['gebinde', 'Charge', 'Liter', 'Qualität', 'Zusatz', 'Farbe', 'Herkunft', 'Mostgewicht']
    const zeilen = [
      { gebinde: 't12', Charge: 'Ried Reserve', Liter: '800', 'Qualität': 'qualitaetswein', Zusatz: 'Reserve', Farbe: 'Rotwein', Herkunft: 'WLWV', Mostgewicht: '92 °Oe' },
      { gebinde: 'T13', Charge: 'BA', Liter: '100,25', 'Qualität': 'BA', Zusatz: '', Farbe: 'rosé', Herkunft: 'wlnoe', Mostgewicht: '' },
    ]
    const b = m.pruefeTankZeilen(kopf, zeilen, GEBINDE, { stichtag: STICHTAG })
    assert.deepEqual(b.zeilen.map(z => z.fehler), [[], []])
    assert.equal(b.zeilen[0].eingabe.herkunftCode, 'weinviertel_dac')
    assert.deepEqual(b.zeilen[0].eingabe.angabe, { stufe: 'qualitaetswein', zusatz: 'reserve', erzeugnis: null })
    assert.deepEqual(b.zeilen[0].eingabe.mostgewicht, { wert: '92', einheit: 'oechsle' })
    assert.equal(b.zeilen[0].eingabe.weinart, 'rot')
    assert.equal(b.zeilen[1].eingabe.angabe.stufe, 'beerenauslese')
    assert.equal(b.zeilen[1].eingabe.weinart, 'rose')
    assert.equal(b.zeilen[1].eingabe.mostgewicht, null)
    assert.ok(b.zeilen[1].hinweise.length === 0)
  })

  test('ungültige Zeilen werden mit Grund abgelehnt, die gültigen bleiben', async () => {
    const m = await laden('lib/import/eroeffnungsbestand.ts')
    const zeilen = [
      tz({ Gebinde: 'X99' }),                                        // 2 unbekannt
      tz({ Gebinde: 'T14' }),                                        // 3 heute belegt
      tz({ Gebinde: 'T15' }),                                        // 4 am Stichtag belegt
      tz({ Gebinde: 'P1' }),                                         // 5 fremd belegt
      tz({ Gebinde: 'T16' }),                                        // 6 deaktiviert
      tz({ Gebinde: 'T13', 'Menge (l)': '1.200' }),                  // 7 > Fassungsvermögen
      tz({ Gebinde: 'T17', 'Menge (l)': '0' }),                      // 8 Menge 0
      tz({ Gebinde: 'T17', 'Menge (l)': 'viel' }),                   // 9 keine Zahl (und T17 doppelt)
      tz({ Gebinde: '', Chargenname: '' }),                          // 10 Pflichtfelder
    ]
    const b = m.pruefeTankZeilen(TANK_KOPF, zeilen, GEBINDE, { stichtag: STICHTAG })
    const f = b.zeilen.map(z => z.fehler.join(' | '))
    assert.match(f[0], /„X99“ nicht gefunden/)
    assert.match(f[1], /nicht leer \(heute 500,00 l\)/)
    assert.match(f[2], /am Stichtag 01\.01\.2027 nicht leer \(200,00 l\)/)
    assert.match(f[3], /durch Weingut Nachbar belegt/)
    assert.match(f[4], /deaktiviert/)
    assert.match(f[5], /übersteigt das Fassungsvermögen von „T13“ \(1\.000,00 l\)/)
    assert.match(f[6], /größer als 0 l/)
    assert.match(f[7], /„viel“ ist keine Zahl/)
    assert.match(f[6], /mehrfach in der Datei \(Zeilen 8, 9\)/)
    assert.match(f[8], /Gebinde fehlt/)
    assert.match(f[8], /Chargenname fehlt/)
    assert.ok(b.zeilen.every(z => z.eingabe === null))
  })

  test('Kataloge und Optionen: Qualität, Zusatz nur auf Qualitätswein, Erzeugnis, Weinart, Herkunft, Mostgewicht', async () => {
    const m = await laden('lib/import/eroeffnungsbestand.ts')
    const fehler = w => m.pruefeTankZeilen(TANK_KOPF, [tz(w)], GEBINDE, { stichtag: STICHTAG }).zeilen[0].fehler.join(' | ')
    assert.match(fehler({ 'Qualitätsstufe': 'Tafelwein' }), /Qualitätsstufe „Tafelwein“ unbekannt/)
    assert.match(fehler({ 'Qualitätsstufe': 'Landwein', Zusatzbezeichnung: 'Reserve' }), /setzt die Qualitätsstufe „Qualitätswein“ voraus/)
    assert.match(fehler({ Zusatzbezeichnung: 'Super' }), /Zusatzbezeichnung „Super“ unbekannt/)
    assert.match(fehler({ Erzeugnis: 'Limonade' }), /Erzeugnis „Limonade“ unbekannt/)
    assert.equal(fehler({ Erzeugnis: 'Sekt g.U.' }), '')
    assert.match(fehler({ Weinart: 'grün' }), /Weinart „grün“ unbekannt/)
    assert.match(fehler({ 'Herkunfts-Code': 'Atlantis' }), /Herkunfts-Code „Atlantis“ unbekannt/)
    assert.match(fehler({ Mostgewicht: 'abc' }), /Mostgewicht/)
    assert.match(fehler({ 'Einheit Mostgewicht': 'Brix' }), /Einheit des Mostgewichts „Brix“ unbekannt/)
    assert.match(fehler({ Jahrgang: '26' }), /Jahrgang „26“ ungültig/)
    const ohneEinheit = m.pruefeTankZeilen(TANK_KOPF, [tz({ 'Einheit Mostgewicht': '' })], GEBINDE, { stichtag: STICHTAG }).zeilen[0]
    assert.deepEqual(ohneEinheit.fehler, [])
    assert.match(ohneEinheit.hinweise.join(), /als °KMW übernommen/)
    const sorte = m.pruefeTankZeilen(TANK_KOPF, [tz({ Rebsorte: 'Fantasiesorte' })], GEBINDE, { stichtag: STICHTAG }).zeilen[0]
    assert.deepEqual(sorte.fehler, [])
    assert.match(sorte.hinweise.join(), /kein amtliches BKI-Kürzel/)
  })

  test('fehlende Pflichtspalte und Fassungsvermögen unbekannt; Zeilennummern mit Versatz', async () => {
    const m = await laden('lib/import/eroeffnungsbestand.ts')
    const b = m.pruefeTankZeilen(['Gebinde', 'Chargenname'], [{ Gebinde: 'T12', Chargenname: 'x' }], GEBINDE, { stichtag: STICHTAG })
    assert.match(b.dateiFehler.join(), /Pflichtspalte fehlt: Menge \(l\)/)
    const v = m.pruefeTankZeilen(TANK_KOPF, [tz({ Gebinde: 'T17' })], GEBINDE, { stichtag: STICHTAG, zeilenOffset: 100 }).zeilen[0]
    assert.equal(v.zeile, 102)
    assert.deepEqual(v.fehler, [])
    assert.match(v.hinweise.join(), /Fassungsvermögen von „T17“ unbekannt/)
  })

  test('Formularwerte = Felder des Einzelformulars (insertEroeffnungsbestand)', async () => {
    const m = await laden('lib/import/eroeffnungsbestand.ts')
    const e = m.pruefeTankZeilen(TANK_KOPF, [tz({ 'Prüfnummer': 'N 1234/26', Notiz: 'Altsystem' })], GEBINDE, { stichtag: STICHTAG }).zeilen[0].eingabe
    const w = m.tankFormularWerte(e, STICHTAG, 'Eröffnungsbestand zum 01.01.2027')
    assert.deepEqual(w, {
      stichtag: '2027-01-01', name: 'GV Hohenberg', behaelter_id: 'g1', jahrgang: '2026', menge_liter: '1500,5',
      qualitaetsstufe: 'qualitaetswein', zusatzbezeichnung: '', erzeugnis: '', rebsorte: 'Grüner Veltliner', weinart: 'weiss',
      herkunft_code: 'weinviertel_dac', notizen: 'Altsystem\nPrüfnummer (Altsystem): N 1234/26\nEröffnungsbestand zum 01.01.2027',
      mostgewicht_wert: '19,2', mostgewicht_einheit: 'kmw',
    })
    const fmt = await laden('lib/format.ts')
    assert.equal(parseFloat(fmt.dezimal(w.menge_liter)), 1500.5)
  })
})

// ── 3. Flaschen ───────────────────────────────────────────────────────────────────────────────────────────

const FL_KOPF = ['Name', 'Bezeichnung', 'Jahrgang', 'Rebsorte', 'Weinart', 'Qualitätsstufe', 'Zusatzbezeichnung', 'Erzeugnis', 'Herkunfts-Code', 'Land', 'Flaschengröße (ml)', 'Anzahl (Flaschen)', 'Prüfnummer', 'VK-Preis brutto (€)', 'Notiz']
const fz = (w = {}) => ({
  Name: 'GV Klassik', Bezeichnung: '', Jahrgang: '2025', Rebsorte: 'Grüner Veltliner', Weinart: 'weiss', 'Qualitätsstufe': 'Qualitätswein',
  Zusatzbezeichnung: '', Erzeugnis: '', 'Herkunfts-Code': '', Land: '', 'Flaschengröße (ml)': '750', 'Anzahl (Flaschen)': '1.200',
  'Prüfnummer': '', 'VK-Preis brutto (€)': '9,50', Notiz: '', ...w,
})

describe('KAN-42 Flaschen-Zeilen', nurMitHooks, () => {
  test('gültige Zeilen (ml-Varianten, Land, Preis)', async () => {
    const m = await laden('lib/import/eroeffnungsbestand.ts')
    const b = m.pruefeFlaschenZeilen(FL_KOPF, [
      fz(),
      fz({ Name: 'Magnum', 'Flaschengröße (ml)': '1,5 l', Land: 'Österreich', 'VK-Preis brutto (€)': '' }),
      fz({ Name: 'Piccolo', 'Flaschengröße (ml)': '0,187', Erzeugnis: 'Sekt g.U.', 'Anzahl (Flaschen)': '24' }),
    ])
    assert.deepEqual(b.zeilen.map(z => z.fehler), [[], [], []])
    assert.deepEqual(b.zeilen[0].eingabe, {
      name: 'GV Klassik', bezeichnung: null, jahrgang: 2025, rebsorte: 'Grüner Veltliner', weinart: 'weiss',
      angabe: { stufe: 'qualitaetswein', zusatz: null, erzeugnis: null }, herkunftCode: null, land: 'AT',
      ml: 750, anzahl: 1200, pruefnummer: null, vkPreis: 9.5, notiz: null,
    })
    assert.equal(b.zeilen[1].eingabe.ml, 1500)
    assert.equal(b.zeilen[1].eingabe.vkPreis, null)
    assert.equal(b.zeilen[2].eingabe.ml, 187)
    assert.equal(b.zeilen[2].eingabe.angabe.erzeugnis, 'SEKTGU')
    assert.equal(b.zeilen[0].menge, '1.200 × 750 ml')
  })

  test('ungültige Zeilen: Größe, Anzahl, Land, Qualität fehlt, Preis, doppelt', async () => {
    const m = await laden('lib/import/eroeffnungsbestand.ts')
    const b = m.pruefeFlaschenZeilen(FL_KOPF, [
      fz({ 'Flaschengröße (ml)': '700' }),
      fz({ Name: 'A', 'Anzahl (Flaschen)': '0' }),
      fz({ Name: 'B', 'Anzahl (Flaschen)': '12,5' }),
      fz({ Name: 'C', Land: 'Narnia' }),
      fz({ Name: 'D', 'Qualitätsstufe': '' }),
      fz({ Name: 'E', 'VK-Preis brutto (€)': '-3' }),
      fz({ Name: 'F' }), fz({ Name: 'f ' }),
    ])
    const f = b.zeilen.map(z => z.fehler.join(' | '))
    assert.match(f[0], /Flaschengröße „700“ unzulässig/)
    assert.match(f[1], /Anzahl „0“ ungültig/)
    assert.match(f[2], /Anzahl „12,5“ ungültig/)
    assert.match(f[3], /Land „Narnia“ nicht erkannt/)
    assert.match(f[4], /Qualitätsstufe fehlt/)
    assert.match(f[5], /VK-Preis „-3“/)
    assert.match(f[6], /mehrfach \(Zeilen 8, 9\)/)
    assert.match(f[7], /mehrfach \(Zeilen 8, 9\)/)
    assert.ok(b.zeilen.every(z => z.eingabe === null))
  })

  test('Formularwerte = Felder des Füllungsformulars, Datum = Stichtag', async () => {
    const m = await laden('lib/import/eroeffnungsbestand.ts')
    const e = m.pruefeFlaschenZeilen(FL_KOPF, [fz({ Notiz: 'Lager 2' })]).zeilen[0].eingabe
    const w = m.flaschenFormularWerte(e, STICHTAG, 'Eröffnungsbestand zum 01.01.2027')
    assert.equal(w.datum, '2027-01-01')
    assert.equal(w.qualitaet, 'qualitaetswein')
    assert.equal(w.anzahl_flaschen, '1200')
    assert.equal(w.flaschengroesse_ml, '750')
    assert.equal(w.vk_preis_brutto, '9,5')
    assert.equal(w.notizen, 'Lager 2\nEröffnungsbestand zum 01.01.2027')
    assert.ok(!('weinausbau_id' in w), 'Füllung ohne Charge')
    assert.equal(m.eroeffnungsVermerk('2027-01-01', 'Altsystem X', '2026-12-15'), 'Eröffnungsbestand zum 01.01.2027 – Altsystem X, importiert am 15.12.2026')
  })
})

// ── 4. Vorlagen ───────────────────────────────────────────────────────────────────────────────────────────

describe('KAN-42 CSV-Vorlagen', nurMitHooks, () => {
  test('Kopfzeile = Spalten, Excel-AT (BOM, Semikolon, CRLF, Dezimalkomma), Beispielzeile besteht die Prüfung', async () => {
    const m = await laden('lib/import/eroeffnungsbestand.ts')
    const { parseCsv } = await laden('lib/import/csvLesen.ts')
    for (const art of ['tank', 'flaschen']) {
      const v = m.vorlageCsv(art, '2026-10-02')
      assert.equal(v.text.charCodeAt(0), 0xFEFF, art)
      assert.ok(v.text.endsWith('\r\n'), art)
      const zeilen = v.text.slice(1).split('\r\n').filter(Boolean)
      assert.equal(zeilen.length, 2, art)
      assert.equal(zeilen[0], m.felderFuer(art).map(f => f.kopf).join(';'), art)
      assert.match(v.dateiname, art === 'tank' ? /^Vorlage_Eroeffnungsbestand-Tank_2026-10-02\.csv$/ : /^Vorlage_Eroeffnungsbestand-Flaschen_2026-10-02\.csv$/)
      const p = parseCsv(v.text)
      assert.deepEqual(p.headers, m.felderFuer(art).map(f => f.kopf))
      const b = art === 'tank'
        ? m.pruefeTankZeilen(p.headers, p.rows, GEBINDE, { stichtag: STICHTAG })
        : m.pruefeFlaschenZeilen(p.headers, p.rows)
      assert.deepEqual(b.dateiFehler, [], art)
      assert.deepEqual(b.zeilen[0].fehler, [], art)
      assert.ok(b.zeilen[0].eingabe, art)
    }
    assert.equal(m.vorlageCsv('tank', '2026-10-02').text.split('\r\n')[1], 'T12;Grüner Veltliner Ried Hohenberg;Grüner Veltliner;2026;1500,00;Qualitätswein;;;weiß;Weinviertel DAC;19,0;°KMW;;Restbestand lt. Altsystem')
  })

  test('csvDekodieren: UTF-8 und Windows-1252 (Excel „CSV“ unter Windows)', async () => {
    const { csvDekodieren } = await laden('lib/import/csvLesen.ts')
    assert.equal(csvDekodieren(new TextEncoder().encode('Qualitätsstufe;Weiß')), 'Qualitätsstufe;Weiß')
    assert.equal(csvDekodieren(new Uint8Array([0x57, 0x65, 0x69, 0xDF])), 'Weiß')
  })
})

// ── 5. Gebindestand am Stichtag ───────────────────────────────────────────────────────────────────────────

describe('KAN-42 Gebindestand am Stichtag', nurMitHooks, () => {
  test('Rückrechnung je Gebinde: heute leer, am Stichtag belegt bzw. umgekehrt', async () => {
    const { literJeGebindeAmStichtag } = await laden('lib/kellerbuch/eroeffnungsGebinde.ts')
    const chargen = [
      // heute abgeschlossen, am 31.12. noch 400 l (Umzug am 05.01.)
      { id: 'c1', behaelter_id: 'g1', aktiv: false, status: 'abgeschlossen', menge_liter: 0, created_at: '2026-09-20T10:00:00Z' },
      // heute 300 l, erst am 10.01. befüllt
      { id: 'c2', behaelter_id: 'g2', aktiv: true, status: 'ausbau', menge_liter: 300, created_at: '2027-01-10T10:00:00Z' },
      { id: 'c3', behaelter_id: null, aktiv: true, status: 'ausbau', menge_liter: 50, created_at: '2026-01-01T00:00:00Z' },
    ]
    const bewegungen = [
      { chargeId: 'c1', datum: '2026-09-20', menge: 400 },
      { chargeId: 'c1', datum: '2027-01-05', menge: -400 },
      { chargeId: 'c2', datum: '2027-01-10', menge: 300 },
    ]
    const r1 = literJeGebindeAmStichtag(chargen, bewegungen, '2026-12-31')
    assert.equal(r1.amStichtag.get('g1'), 400)
    assert.equal(r1.amStichtag.get('g2') ?? 0, 0)
    assert.equal(r1.heute.get('g1'), 0)
    assert.equal(r1.heute.get('g2'), 300)
    const r2 = literJeGebindeAmStichtag(chargen, bewegungen, '2027-01-20')
    assert.equal(r2.amStichtag.get('g1') ?? 0, 0)
    assert.equal(r2.amStichtag.get('g2'), 300)
  })
})

// ── 6. Quelltext ──────────────────────────────────────────────────────────────────────────────────────────

describe('KAN-42 Verdrahtung (Quelltext)', () => {
  const G = quelle('src/app/(dashboard)/kellerbuch/gebinde-actions.ts')
  const W = quelle('src/app/(dashboard)/weinhandel/actions.ts')

  test('Tank: Stichtag in insertEroeffnungsbestand, created_at über eroeffnungsZeitpunkt (nicht mehr fest 01.01.)', () => {
    const anlegen = G.slice(G.indexOf('async function insertEroeffnungsbestand'), G.indexOf('export async function createEroeffnungsbestand('))
    assert.match(anlegen, /const stichtag\s+= String\(formData\.get\('stichtag'\) \?\? ''\)\.trim\(\) \|\| standardEroeffnungsStichtag\(heute\)/)
    assert.match(anlegen, /const stichtagUnzulaessig = eroeffnungsStichtagFehler\(stichtag, heute\)\s+if \(stichtagUnzulaessig\) return stichtagUnzulaessig/)
    assert.match(anlegen, /created_at:\s+eroeffnungsZeitpunkt\(stichtag\),/)
    assert.doesNotMatch(G, /-01-01T00:00:00`\)\.toISOString\(\)/)
    assert.ok(anlegen.indexOf('eroeffnungsStichtagFehler(') < anlegen.indexOf('get_next_transaktionsnr'), 'Prüfung vor der Transaktionsnummer')
  })

  test('Tank-Import: Kontext mit Rechten, erneute Prüfung, je Zeile insertEroeffnungsbestand – kein eigener Insert', () => {
    const imp = G.slice(G.indexOf('// ── KAN-42: CSV-Import'), G.indexOf('// UMZIEHEN'))
    assert.ok(imp.length > 0)
    assert.match(imp, /await pruefeSeitenBetrieb\(membership\.tenantId\)[\s\S]*await pruefeSchreibzugriff\(membership\)[\s\S]*canWrite\(membership, 'kellerbuch'\)/)
    assert.match(imp, /membership\.role !== 'system_admin' && membership\.role !== 'tenant_admin'/)
    const importieren = imp.slice(imp.indexOf('export async function importiereEroeffnungTank'))
    assert.match(importieren, /const befund = pruefeTankZeilen\(d\.kopf, d\.zeilen, gebinde,/)
    assert.match(importieren, /const fehler = await insertEroeffnungsbestand\(fd, kontext\)/)
    assert.match(importieren, /if \(!z\.eingabe\) \{ ergebnis\.fehler\.push/)
    assert.doesNotMatch(imp, /from\('weinausbau'\)|\.insert\(/)
    assert.match(imp, /ladeGebindeStand\(supabase, tenantId, tag\)/)
  })

  test('Flaschen: createFuellung und Import gehen über fuellungAnlegen; Kennzeichen nur serverseitig', () => {
    assert.match(W, /export async function createFuellung\(formData: FormData\): Promise<\{ id: string; hinweis\?: string \}> \{\s+return fuellungAnlegen\(formData, null\)\s+\}/)
    assert.match(W, /\nasync function fuellungAnlegen\(formData: FormData, eroeffnung: FlaschenEroeffnung \| null\)/)
    assert.doesNotMatch(W, /export async function fuellungAnlegen/)
    assert.match(W, /if \(eroeffnung && weinausbauId\) throw new AktionsFehler/)
    assert.match(W, /import_quelle: IMPORT_QUELLE_EROEFFNUNG,/)
    const imp = W.slice(W.indexOf('// ── KAN-42: CSV-Import „Eröffnungsbestand Flaschen“'))
    assert.match(imp, /const r = await fuellungAnlegen\(fd, \{ weinart: z\.eingabe\.weinart, landIso: z\.eingabe\.land, importiertAm \}\)/)
    assert.match(imp, /pruefnummerFuerFuellung\(supabase, tenantId, \{ dacAntragId: null, pruefnummer: z\.eingabe\.pruefnummer \}/)
    assert.match(imp, /\.eq\('import_quelle', IMPORT_QUELLE_EROEFFNUNG\)/)
    assert.doesNotMatch(imp, /from\('fuellungen'\) as any\)\s*\.insert/)
  })

  test('Bewegungsbuch: Tank-Eröffnung am Stichtag aus created_at, Flaschen-Eröffnung ohne Tankabgang', () => {
    const B = quelle('src/lib/behoerden/bewegungsbuch.ts')
    assert.match(B, /datum: eroeffnungsTag\(eroeffnungsCharge\.created_at\) \?\? tag\(new Date\(\)\),/)
    assert.doesNotMatch(B, /datum: `\$\{jahr\}-01-01`/)
    assert.match(B, /if \(istFlaschenEroeffnung\(f\)\) \{[\s\S]{0,200}art: 'anfangsbestand',[\s\S]{0,200}menge: 0,/)
    assert.match(B, /storniert_von_name, import_quelle, weinart, weinausbau:weinausbau_id\(weinart\)'\)/)
  })

  test('Oberfläche: Stichtag in beiden Einzelformularen, neue Import-Typen, Vorlage über CsvExportKnopf', () => {
    for (const p of ['src/app/(dashboard)/kellerbuch/gebinde/page.tsx', 'src/app/(dashboard)/admin/import/ImportClient.tsx']) {
      assert.match(quelle(p), /name="stichtag" type="date" required\s+defaultValue=\{standardEroeffnungsStichtag\(wienHeute\(\)\)\}/, p)
    }
    const C = quelle('src/app/(dashboard)/admin/import/ImportClient.tsx')
    assert.match(C, /eroeffnung_tank: 'Eröffnungsbestand Tank',/)
    assert.match(C, /eroeffnung_flaschen: 'Eröffnungsbestand Flaschen',/)
    assert.match(C, /<EroeffnungImport key=\{typ\}/)
    const E = quelle('src/app/(dashboard)/admin/import/EroeffnungImport.tsx')
    assert.match(E, /<CsvExportKnopf label="CSV-Vorlage" [^>]*erzeugen=\{\(\) => vorlageCsv\(art\)\} \/>/)
    assert.match(E, /erst nach dem Abräumen der Bewegungsdaten im Dezember/)
  })
})
