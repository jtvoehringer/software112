// Tests für den CSV-Baustein (src/lib/csv) – Behördenmeldungen als CSV (24.09.2026)
//
// Aufruf:  npm run test:csv
//          (node --test mit Type-Stripping; Node ≥ 22.6, keine zusätzliche Abhängigkeit)
//
// Golden-Files (scripts/tests/golden/*.csv) werden byte-genau verglichen. Sie werden NIE
// automatisch überschrieben: Fehlt eine Datei, legt `GOLDEN_SCHREIBEN=1 npm run test:csv`
// sie einmalig an. bmd_*.csv stammen aus der UNVERÄNDERTEN bisherigen bmdCsv()/
// personenkontenCsv() (Stand main 4de2971) – PROFIL_BMD und jede spätere Umstellung von
// lib/buchhaltung/bmd.ts müssen sie byte-identisch treffen.
// .gitattributes: scripts/tests/golden/** -text (CRLF und BOM bleiben beim Einchecken erhalten).

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

import { register } from 'node:module'
import * as csv from '../../src/lib/csv/index.ts'
import * as bmd from '../../src/lib/buchhaltung/bmd.ts'

// Produktive BKI-Spalten (lib/behoerden/traubenverkauf.ts) importieren mit '@/…' – Auflösung wie
// in ernte.test.mjs; '@/lib/csv' zeigt auf dieselbe Datei wie der statische Import oben.
register('./ernte.aufloesung.mjs', import.meta.url)
const tv = await import('../../src/lib/behoerden/traubenverkauf.ts')

const {
  PROFIL_EXCEL_AT, PROFIL_BKI, PROFIL_BMD,
  csvText, csvDatei, csvZelle, csvDateiname, csvDateinameAus, csvKopfzeilen,
  wienHeute, wienZeitpunkt, wienDatum, runden, rundeText,
} = csv

const HIER = path.dirname(fileURLToPath(import.meta.url))
const GOLDEN = path.join(HIER, 'golden')
const SCHREIBEN = process.env.GOLDEN_SCHREIBEN === '1'
const BOM = '\uFEFF'

/** Golden-File lesen (Buffer); fehlt sie und GOLDEN_SCHREIBEN=1, wird sie aus `erzeugen()` angelegt. */
function golden(name, erzeugen) {
  const datei = path.join(GOLDEN, name)
  if (!existsSync(datei) && SCHREIBEN) {
    mkdirSync(GOLDEN, { recursive: true })
    writeFileSync(datei, Buffer.from(erzeugen(), 'utf8'))
  }
  assert.ok(existsSync(datei), `Golden-File ${name} fehlt – einmalig mit GOLDEN_SCHREIBEN=1 aus unverändertem Altcode erzeugen`)
  return readFileSync(datei)
}

function gleicheBytes(ist, soll, text) {
  const a = Buffer.from(ist, 'utf8')
  if (!a.equals(soll)) {
    assert.equal(JSON.stringify(ist), JSON.stringify(soll.toString('utf8')), text)
  }
}

// ── Beispieldaten BMD (realistisch, inkl. Randfälle der bisherigen Logik) ──────

const AR = [
  { satzart: '0', konto: '200001', gkonto: '4001', belegnr: 'RE-2026-0142', belegdatum: '03.08.2026', buchdatum: '03.08.2026', buchsymbol: 'AR', buchcode: '1', prozent: 13, steuercode: '1', betrag: 486.2, steuer: 55.94, text: 'Gasthaus "Zur Linde" RE RE-2026-0142', kost: '', extbelegnr: '', nettodatum: '17.08.2026', skontopz: 2, dokument: '' },
  { satzart: '0', konto: '200002', gkonto: '4000', belegnr: 'RE-2026-0143', belegdatum: '04.08.2026', buchdatum: '04.08.2026', buchsymbol: 'AR', buchcode: '1', prozent: 20, steuercode: '1', betrag: 1234.5, steuer: 205.75, text: 'Weinhandel Huber; Filiale Wien RE RE-2026-0143', kost: '', extbelegnr: '', nettodatum: '03.09.2026', skontopz: 2.5, dokument: '' },
  { satzart: '0', konto: '299999', gkonto: '4001', belegnr: 'RE-2026-0144', belegdatum: '05.08.2026', buchdatum: '05.08.2026', buchsymbol: 'AR', buchcode: '1', prozent: 13, steuercode: '1', betrag: 12.345, steuer: 1.42, text: 'Barverkauf RE RE-2026-0144', kost: '', extbelegnr: '', nettodatum: '19.08.2026', skontopz: 0, dokument: '' },
  { satzart: '0', konto: '200003', gkonto: '4011', belegnr: 'RE-2026-0145', belegdatum: '12.08.2026', buchdatum: '12.08.2026', buchsymbol: 'AR', buchcode: '1', prozent: 0, steuercode: '7', betrag: 2400, steuer: 0, text: 'Weingut Müller GmbH RE RE-2026-0145', kost: '', extbelegnr: '', nettodatum: '11.09.2026', skontopz: 0, dokument: '' },
  { satzart: '0', konto: '200005', gkonto: '4010', belegnr: 'RE-2026-0146', belegdatum: '20.08.2026', buchdatum: '20.08.2026', buchsymbol: 'AR', buchcode: '1', prozent: 0, steuercode: '5', betrag: 980.4, steuer: 0, text: 'Wine & Dine Ltd. RE RE-2026-0146', kost: '', extbelegnr: '', nettodatum: '03.09.2026', skontopz: 0, dokument: '' },
  // Steuer −5,225 → Altlogik Math.round(−522,5)/100 = „-5,22“ (kaufmännisch −5,23)
  { satzart: '0', konto: '200001', gkonto: '4001', belegnr: 'RE-2026-0147', belegdatum: '28.08.2026', buchdatum: '28.08.2026', buchsymbol: 'AR', buchcode: '1', prozent: 13, steuercode: '1', betrag: -45.5, steuer: -5.225, text: 'Gutschrift Bruch RE RE-2026-0147', kost: '', extbelegnr: '', nettodatum: '11.09.2026', skontopz: 0, dokument: '' },
  // E&A-Einnahme: Dateiname mit Tabulator und Zeilenumbruch (bmdText greift beim Dokument nicht)
  { satzart: '0', konto: '299999', gkonto: '4800', belegnr: 'EA-3F2A9C1B', belegdatum: '31.08.2026', buchdatum: '31.08.2026', buchsymbol: 'AR', buchcode: '1', prozent: 20, steuercode: '1', betrag: 150, steuer: 25, text: 'Miete Veranstaltungsraum', kost: '', extbelegnr: '', nettodatum: '31.08.2026', skontopz: 0, dokument: 'Beleg Miete\tAugust\r\nKopie.pdf' },
]

const ER = [
  { satzart: '0', konto: '300001', gkonto: '5000', belegnr: 'ER-2026-017', belegdatum: '02.08.2026', buchdatum: '02.08.2026', buchsymbol: 'ER', buchcode: '2', prozent: 20, steuercode: '2', betrag: 1799.99, steuer: 300, text: 'Weinbau Technik GmbH: Pumpe Kellerwirtschaft', kost: '', extbelegnr: '', nettodatum: '01.09.2026', skontopz: 0, dokument: 'pumpe_rechnung.pdf' },
  { satzart: '0', konto: '300002', gkonto: '7600', belegnr: 'ER-2026-018', belegdatum: '06.08.2026', buchdatum: '06.08.2026', buchsymbol: 'ER', buchcode: '2', prozent: 10, steuercode: '2', betrag: 54.9, steuer: 4.99, text: 'Druckerei Wagner: Etiketten „Grüner Veltliner 2025“', kost: '', extbelegnr: '', nettodatum: '20.08.2026', skontopz: 0, dokument: '' },
  // führendes Minus/Gleichheitszeichen: BMD ohne Formelschutz → unverändert
  { satzart: '0', konto: '399999', gkonto: '7990', belegnr: 'EA-9B1C0D2E', belegdatum: '15.08.2026', buchdatum: '15.08.2026', buchsymbol: 'ER', buchcode: '2', prozent: 0, steuercode: '', betrag: 35, steuer: 0, text: '-Korrektur Kassadifferenz', kost: '', extbelegnr: '', nettodatum: '29.08.2026', skontopz: 0, dokument: '=Beleg.pdf' },
  // 1.005 → Altlogik „1,00“
  { satzart: '0', konto: '300003', gkonto: '7380', belegnr: 'ER-2026-019', belegdatum: '30.08.2026', buchdatum: '30.08.2026', buchsymbol: 'ER', buchcode: '2', prozent: 20, steuercode: '2', betrag: 1.005, steuer: 0.17, text: 'Post AG: Porto', kost: '', extbelegnr: '', nettodatum: '13.09.2026', skontopz: 0, dokument: '' },
]

const PK = [
  { kontonummer: '200001', kontoart: 'D', name: 'Gasthaus "Zur Linde"', strasse: 'Hauptstraße 12', plz: '3500', ort: 'Krems an der Donau', land: 'AT', uid: 'ATU12345678', email: 'office@zurlinde.at', telefon: '+43 2732 12345', zahlungsziel: 14, skontopz: 2, skontotage: 10, extnummer: 'K-0042' },
  { kontonummer: '200002', kontoart: 'D', name: 'Weinhandel Huber; Filiale Wien', strasse: 'Mariahilfer Straße 101/3', plz: '1060', ort: 'Wien', land: 'AT', uid: 'ATU87654321', email: 'einkauf@huber-wein.at', telefon: '+43 1 5961234', zahlungsziel: 30, skontopz: 2.5, skontotage: 14, extnummer: '' },
  { kontonummer: '200003', kontoart: 'D', name: 'Weingut Müller GmbH', strasse: 'Weinstraße 3', plz: '67146', ort: 'Deidesheim', land: 'DE', uid: 'DE123456789', email: 'info@mueller-wein.de', telefon: '+49 6326 700', zahlungsziel: 30, skontopz: '', skontotage: '', extnummer: 'K-0107' },
  // Name in NFD (Eingabe am Mac/iPhone): BMD normalisiert bewusst NICHT
  { kontonummer: '200004', kontoart: 'D', name: 'Ma\u0308rz Josef', strasse: 'Kellergasse 7', plz: '3491', ort: 'Straß im Straßertale', land: 'AT', uid: '', email: 'j.maerz@example.at', telefon: '', zahlungsziel: '', skontopz: '', skontotage: '', extnummer: '' },
  { kontonummer: '300001', kontoart: 'K', name: 'Weinbau Technik GmbH', strasse: 'Industriestraße 5', plz: '2000', ort: 'Stockerau', land: 'AT', uid: 'ATU11223344', email: '', telefon: '+43 2266 6789', zahlungsziel: 30, skontopz: 3, skontotage: 8, extnummer: '' },
]

/** Spalten, mit denen PROFIL_BMD die bisherige bmdCsv() nachbildet (Vorlage für lib/buchhaltung/bmd.ts) */
const BMD_DEF = bmd.BMD_SPALTEN.map(k =>
  k === 'prozent' || k === 'skontopz' ? { kopf: k, typ: 'dezimal', stellen: 'roh', wert: z => z[k] }
    : k === 'betrag' || k === 'steuer' ? { kopf: k, typ: 'betrag', wert: z => z[k] }
      : { kopf: k, typ: 'text', wert: z => z[k] })

const PK_DEF = bmd.PERSONENKONTO_SPALTEN.map(k =>
  k === 'zahlungsziel' || k === 'skontotage' ? { kopf: k, typ: 'ganzzahl', stellen: 'roh', wert: z => z[k] }
    : k === 'skontopz' ? { kopf: k, typ: 'dezimal', stellen: 'roh', wert: z => z[k] }
      : { kopf: k, typ: 'text', wert: z => z[k] })

describe('PROFIL_BMD – byte-identisch zur bisherigen bmdCsv (Golden-Files)', () => {
  const faelle = [
    ['bmd_ausgangsrechnungen.csv', () => bmd.bmdCsv(AR), () => csvText(AR, BMD_DEF, PROFIL_BMD)],
    ['bmd_eingangsbelege.csv', () => bmd.bmdCsv(ER), () => csvText(ER, BMD_DEF, PROFIL_BMD)],
    ['bmd_personenkonten.csv', () => bmd.personenkontenCsv(PK), () => csvText(PK, PK_DEF, PROFIL_BMD)],
    ['bmd_leer.csv', () => bmd.bmdCsv([]), () => csvText([], BMD_DEF, PROFIL_BMD)],
  ]
  for (const [name, alt, neu] of faelle) {
    test(`${name}: lib/buchhaltung/bmd.ts trifft die Golden-File`, () => {
      gleicheBytes(alt(), golden(name, alt), `${name}: bmd.ts weicht von der Golden-File ab`)
    })
    test(`${name}: csvText(…, PROFIL_BMD) trifft die Golden-File`, () => {
      gleicheBytes(neu(), golden(name, alt), `${name}: PROFIL_BMD weicht von der Golden-File ab`)
    })
  }

  test('Altrundung bleibt erhalten (1,005 → 1,00; −5,225 → −5,22)', () => {
    assert.equal(csvZelle(1.005, 'betrag', PROFIL_BMD), '1,00')
    assert.equal(csvZelle(-5.225, 'betrag', PROFIL_BMD), '-5,22')
    assert.equal(csvZelle(1.005, 'betrag', PROFIL_EXCEL_AT), '1,01')
    assert.equal(csvZelle(-5.225, 'betrag', PROFIL_EXCEL_AT), '-5,23')
    assert.ok(bmd.bmdCsv(AR).includes(';-5,22;'))
    assert.ok(bmd.bmdCsv(ER).includes(';1,00;'))
  })
})

// ── Formelschutz ────────────────────────────────────────────────────────────

describe('Formelschutz (EXCEL_AT)', () => {
  test('Text-/Code-Zellen mit = + - @ TAB CR bekommen ein Apostroph', () => {
    assert.equal(csvZelle('=SUM(A1:A9)', 'text'), "'=SUM(A1:A9)")
    assert.equal(csvZelle('+43 2742 12345', 'text'), "'+43 2742 12345")
    assert.equal(csvZelle('-12,50', 'text'), "'-12,50")
    assert.equal(csvZelle('@SUMME(1)', 'code'), "'@SUMME(1)")
    assert.equal(csvZelle('\t=1+1', 'text'), "'\t=1+1")
    assert.equal(csvZelle('   =HYPERLINK("http://x")', 'text'), `"'   =HYPERLINK(""http://x"")"`)
    assert.equal(csvZelle('\uFF1D1+1', 'text'), "'\uFF1D1+1")
    assert.equal(csvZelle('Riede 5 = gut', 'text'), 'Riede 5 = gut')
  })

  test('Zahl bleibt Zahl: −12,50 als betrag ohne Apostroph', () => {
    assert.equal(csvZelle(-12.5, 'betrag'), '-12,50')
    assert.equal(csvZelle('-12.5', 'dezimal'), '-12,50')
  })

  test('Zahl-/Datumsspalten reichen keine Strings durch (kein Umgehen des Schutzes)', () => {
    const r = csvDatei([{ v: '=HYPERLINK("http://böse")', d: '=1+1', j: 'vielleicht' }], [
      { kopf: 'Menge (kg)', typ: 'dezimal', wert: z => z.v },
      { kopf: 'Datum', typ: 'datum', wert: z => z.d },
      { kopf: 'Bio', typ: 'janein', wert: z => z.j },
    ])
    assert.equal(r.text, `${BOM}Menge (kg);Datum;Bio\r\n;;\r\n`)
    assert.equal(r.warnungen.length, 3)
    assert.match(r.warnungen[0], /^Spalte „Menge \(kg\)“: 1 Wert keine gültige Zahl – Feld leer gelassen \(Datensatz 1\)$/)
    assert.equal(csvZelle('0x10', 'dezimal'), '')
    assert.equal(csvZelle('12,5', 'dezimal'), '')
    assert.equal(csvZelle('Infinity', 'dezimal'), '')
    assert.equal(csvZelle(Number.NaN, 'betrag'), '')
    assert.equal(csvZelle(true, 'dezimal'), '')
  })

  test('BKI: Formelzeichen am Anfang entfernen statt Apostroph (Upload), mit Hinweis; BMD unverändert (Golden-File)', () => {
    assert.equal(csvZelle('=SUM(A1)', 'text', PROFIL_BKI), 'SUM(A1)')
    assert.equal(csvZelle(' =1+1', 'text', PROFIL_BKI), '1+1')
    assert.equal(csvZelle('+43 1 234', 'code', PROFIL_BKI), '43 1 234')
    assert.equal(csvZelle('@SUM(A1)', 'text', PROFIL_BKI), 'SUM(A1)')
    assert.equal(csvZelle('\t-=cmd', 'text', PROFIL_BKI), 'cmd')
    assert.equal(csvZelle('Riede 5 = gut', 'text', PROFIL_BKI), 'Riede 5 = gut')
    const r = csvDatei([{ n: '=HYPERLINK("x")' }, { n: 'Huber' }], [{ kopf: 'Name_Empf', typ: 'text', wert: z => z.n }], PROFIL_BKI)
    assert.deepEqual(r.warnungen, ['Spalte „Name_Empf“: 1 Wert mit Formelzeichen am Anfang (= + - @) – Zeichen entfernt, Stammdaten prüfen (Datensatz 1)'])
    assert.equal(csvZelle('+43 1 234', 'text', PROFIL_BMD), '+43 1 234')
  })
})

// ── Zahlen und Rundung ──────────────────────────────────────────────────────

describe('Zahlen und kaufmännische Rundung', () => {
  test('1,005 → 1,01 und −2,5 → −3 (vorzeichensymmetrisch)', () => {
    assert.equal(csvZelle(1.005, 'betrag'), '1,01')
    assert.equal(csvZelle(-1.005, 'betrag'), '-1,01')
    assert.equal(csvZelle(-2.5, 'ganzzahl'), '-3')
    assert.equal(csvZelle(2.5, 'ganzzahl'), '3')
    assert.equal(csvZelle(-0.5, 'ganzzahl'), '-1')
    assert.equal(runden(1.005, 2), 1.01)
    assert.equal(runden(-2.5, 0), -3)
    assert.equal(rundeText(9.995, 2), '10.00')
  })

  test('keine Float-Artefakte, kein „-0“, kein Tausenderpunkt', () => {
    assert.equal(csvZelle(0.1 + 0.2, 'dezimal'), '0,30')
    assert.equal(csvZelle(-0.004, 'betrag'), '0,00')
    assert.equal(csvZelle(1234567.891, 'betrag'), '1234567,89')
    assert.equal(csvZelle(1e21, 'ganzzahl'), '1000000000000000000000')
    assert.equal(csvZelle(1.5e-7, 'dezimal', PROFIL_EXCEL_AT, 8), '0,00000015')
  })

  test('feste Stellen je Spalte', () => {
    assert.equal(csvZelle(18.95, 'dezimal', PROFIL_EXCEL_AT, csv.STELLEN.kmw), '18,95')    // verlustfrei (numeric(5,2))
    assert.equal(csvZelle(17.25, 'dezimal', PROFIL_EXCEL_AT, csv.STELLEN.kmwBki), '17,3')  // BKI-Schnittstelle 1 Stelle
    assert.equal(csvZelle(0.12345, 'dezimal', PROFIL_EXCEL_AT, csv.STELLEN.ha), '0,1235')
    assert.equal(csvZelle(2, 'dezimal', PROFIL_EXCEL_AT, csv.STELLEN.hl), '2,00')
    assert.equal(csvZelle(1250.4, 'dezimal', PROFIL_EXCEL_AT, csv.STELLEN.kg), '1250')
    assert.equal(csvZelle(13, 'prozent'), '13,00')
    assert.equal(csvZelle('7', 'ganzzahl'), '7')
  })

  test('fehlender Wert = leeres Feld, nie 0', () => {
    for (const v of [null, undefined, '', '   ']) assert.equal(csvZelle(v, 'betrag'), '')
    assert.equal(csvZelle(0, 'betrag'), '0,00')
  })
})

// ── Datum und Zeitpunkt ─────────────────────────────────────────────────────

describe('Datum (DATE stringbasiert) vs. Zeitpunkt (timestamptz in Wien)', () => {
  test('DATE wird nicht verschoben', () => {
    assert.equal(csvZelle('2026-03-05', 'datum'), '05.03.2026')
    assert.equal(csvZelle('2026-12-31', 'datum'), '31.12.2026')
    assert.equal(csvZelle('2026-03-05', 'zeitpunkt'), '05.03.2026')
    assert.equal(csvZelle('2026-03-05', 'datum', { ...PROFIL_EXCEL_AT, datum: 'JJJJ-MM-TT' }), '2026-03-05')
  })

  test('timestamptz: Winterzeit (MEZ, +1)', () => {
    assert.equal(csvZelle('2026-03-04T23:30:00+00:00', 'datum'), '05.03.2026')
    assert.equal(csvZelle('2026-01-15T22:30:00Z', 'zeitpunkt'), '15.01.2026 23:30')
    assert.equal(csvZelle('2026-01-15T23:30:00.123456+00:00', 'zeitpunkt'), '16.01.2026 00:30')
  })

  test('timestamptz: Sommerzeit (MESZ, +2) und Umstellungen', () => {
    assert.equal(csvZelle('2026-07-15T22:30:00+00:00', 'datum'), '16.07.2026')
    assert.equal(csvZelle('2026-07-15T22:30:00+00:00', 'zeitpunkt'), '16.07.2026 00:30')
    assert.equal(csvZelle('2026-03-29T00:59:00Z', 'zeitpunkt'), '29.03.2026 01:59')
    assert.equal(csvZelle('2026-03-29T01:00:00Z', 'zeitpunkt'), '29.03.2026 03:00')
    assert.equal(csvZelle('2026-10-25T00:30:00Z', 'zeitpunkt'), '25.10.2026 02:30')
    assert.equal(csvZelle('2026-10-25T01:30:00Z', 'zeitpunkt'), '25.10.2026 02:30')
    assert.equal(csvZelle('2026-07-16 00:30:00+02', 'zeitpunkt'), '16.07.2026 00:30')
    assert.equal(csvZelle(new Date('2026-07-15T22:30:00Z'), 'datum'), '16.07.2026')
  })

  test('Zeitpunkt ohne Zone = Wandzeit, ungültige Werte → leer + Warnung', () => {
    assert.equal(csvZelle('2026-07-15T08:05:00', 'zeitpunkt'), '15.07.2026 08:05')
    const r = csvDatei([{ d: '2026-02-30' }, { d: '5.3.2026' }, { d: 1767225600000 }], [{ kopf: 'Datum', typ: 'datum', wert: z => z.d }])
    assert.equal(r.text, `${BOM}Datum\r\n\r\n\r\n\r\n`)
    assert.deepEqual(r.warnungen, ['Spalte „Datum“: 3 Werte kein gültiges Datum – Feld leer gelassen (Datensatz 1, 2, 3)'])
  })

  test('wienHeute/wienZeitpunkt/wienDatum', () => {
    assert.equal(wienHeute(new Date('2026-12-31T23:30:00Z')), '2027-01-01')
    assert.equal(wienHeute(new Date('2026-07-31T22:30:00Z')), '2026-08-01')
    assert.deepEqual(wienZeitpunkt('2026-07-31T22:30:00+00:00'), { datum: '2026-08-01', uhrzeit: '00:30' })
    assert.deepEqual(wienZeitpunkt('2026-07-31'), { datum: '2026-07-31', uhrzeit: null })
    assert.equal(wienDatum('2026-07-31T21:59:00Z'), '2026-07-31')
    assert.equal(wienDatum('kein Datum'), null)
  })
})

// ── Quoting, Steuerzeichen, Unicode ─────────────────────────────────────────

describe('Quoting, Steuerzeichen, NFC', () => {
  test('Quoting nach Bedarf (EXCEL_AT)', () => {
    assert.equal(csvZelle('a;b', 'text'), '"a;b"')
    assert.equal(csvZelle('Gasthaus "Zur Linde"', 'text'), '"Gasthaus ""Zur Linde"""')
    assert.equal(csvZelle(' führend', 'text'), '" führend"')
    assert.equal(csvZelle('endend ', 'text'), '"endend "')
    assert.equal(csvZelle('a,b', 'text'), 'a,b')
    assert.equal(csvZelle('Zeile 1\r\nZeile 2\nZeile 3', 'text'), 'Zeile 1 Zeile 2 Zeile 3')
  })

  test('Quoting „immer“ und Kürzen langer Texte (Profil-Schalter)', () => {
    const immer = { ...PROFIL_EXCEL_AT, quoten: 'immer' }
    assert.equal(csvZelle('a', 'text', immer), '"a"')
    assert.equal(csvZelle(1.5, 'dezimal', immer), '"1,50"')
    const kurz = { ...PROFIL_EXCEL_AT, maxText: 5 }
    assert.equal(csvZelle('Grüner Veltliner', 'text', kurz), 'Grün…')
    assert.equal(csvZelle('Grüner Veltliner', 'code', kurz), 'Grüner Veltliner')
  })

  test('Steuerzeichen → Leerzeichen, TAB bleibt', () => {
    assert.equal(csvZelle('a\u0000b\u0007c\u007Fd\u0085e\u2028f\u2029g', 'text'), 'a b c d e f g')
    assert.equal(csvZelle('a\tb', 'text'), 'a\tb')
  })

  test('NFC: zerlegte Umlaute werden zusammengesetzt (nicht bei BMD)', () => {
    const nfd = 'Ma\u0308rz Gru\u0308ner Veltliner'
    assert.equal(csvZelle(nfd, 'text'), 'März Grüner Veltliner')
    assert.equal(csvZelle(nfd, 'text', PROFIL_BMD), nfd)
  })

  test('Codes mit führenden Nullen bleiben unverändert', () => {
    assert.equal(csvZelle('04023', 'code'), '04023')
    assert.equal(csvZelle('05', 'code'), '05')
    assert.equal(csvZelle('12-15', 'code'), '12-15')
    assert.equal(csvZelle('1E5', 'code'), '1E5')
  })

  test('Ja/Nein je Profil', () => {
    assert.equal(csvZelle(true, 'janein'), 'Ja')
    assert.equal(csvZelle(false, 'janein'), 'Nein')
    assert.equal(csvZelle(null, 'janein'), '')
    assert.equal(csvZelle(true, 'janein', PROFIL_BKI), 'J')
    assert.equal(csvZelle(false, 'janein', PROFIL_BKI), '')
  })

  test('SYLK-Falle: ohne BOM wird ein Kopf „ID…“ gequotet', () => {
    const ohneBom = { ...PROFIL_EXCEL_AT, bom: false }
    assert.equal(csvText([], [{ kopf: 'ID', typ: 'code', wert: () => '' }], ohneBom), '"ID"\r\n')
    assert.equal(csvText([], [{ kopf: 'ID', typ: 'code', wert: () => '' }]), `${BOM}ID\r\n`)
  })
})

// ── Leermeldung und Datei ───────────────────────────────────────────────────

describe('Leermeldung und Dateiaufbau', () => {
  const SP = [
    { kopf: 'Rebsorte', typ: 'text', wert: z => z.sorte },
    { kopf: 'Fläche (ha)', typ: 'dezimal', stellen: 4, wert: z => z.ha },
  ]

  test('0 Zeilen → BOM + Kopfzeile + CRLF', () => {
    const r = csvDatei([], SP)
    assert.equal(r.text, `${BOM}Rebsorte;Fläche (ha)\r\n`)
    assert.equal(r.zeilen, 0)
    assert.deepEqual(r.warnungen, [])
  })

  test('CRLF nach jeder Zeile inkl. der letzten, BOM nur als erstes Zeichen', () => {
    const t = csvText([{ sorte: 'Grüner Veltliner', ha: 1.2 }, { sorte: 'Zweigelt', ha: 0.85 }], SP)
    assert.equal(t, `${BOM}Rebsorte;Fläche (ha)\r\nGrüner Veltliner;1,2000\r\nZweigelt;0,8500\r\n`)
    assert.equal(t.indexOf(BOM, 1), -1)
  })

  test('Golden: EXCEL_AT-Beispiel mit Codes, Formeln, Zeitpunkten', () => {
    const zeilen = [
      { kg: '04023', gst: '1234/5', bbch: '05', mittel: 'Cuprozin progress', zul: '3172-0', menge: 0.6, cu: 0.1575, datum: '2026-05-12', erfasst: '2026-05-12T04:10:00+00:00', bio: true, notiz: '=Achtung Abdrift' },
      { kg: '12003', gst: '88', bbch: '71', mittel: 'Netzschwefel „Stulln“', zul: '2419-0', menge: 4, cu: null, datum: '2026-07-01', erfasst: '2026-06-30T22:15:00Z', bio: false, notiz: 'Reihe 3–7; Hang' },
    ]
    const spalten = [
      { kopf: 'KG-Nr.', typ: 'code', wert: z => z.kg },
      { kopf: 'GST-Nr.', typ: 'code', wert: z => z.gst },
      { kopf: 'BBCH', typ: 'code', wert: z => z.bbch },
      { kopf: 'Mittel', typ: 'text', wert: z => z.mittel },
      { kopf: 'Zulassungsnr.', typ: 'code', wert: z => z.zul },
      { kopf: 'Aufwandmenge (kg/ha)', typ: 'dezimal', stellen: 2, wert: z => z.menge },
      { kopf: 'Cu-Reinmenge (kg/ha)', typ: 'dezimal', stellen: csv.STELLEN.kgGenau, wert: z => z.cu },
      { kopf: 'Datum', typ: 'datum', wert: z => z.datum },
      { kopf: 'Erfasst am', typ: 'zeitpunkt', wert: z => z.erfasst },
      { kopf: 'Bio', typ: 'janein', wert: z => z.bio },
      { kopf: 'Notiz', typ: 'text', wert: z => z.notiz },
    ]
    const t = csvText(zeilen, spalten)
    gleicheBytes(t, golden('excel_at_beispiel.csv', () => t), 'EXCEL_AT-Beispiel weicht ab')
    assert.ok(t.includes('\r\n04023;1234/5;05;Cuprozin progress;3172-0;0,60;0,16;12.05.2026;12.05.2026 06:10;Ja;\'=Achtung Abdrift\r\n'))
    assert.ok(t.includes('\r\n12003;88;71;Netzschwefel „Stulln“;2419-0;4,00;;01.07.2026;01.07.2026 00:15;Nein;"Reihe 3–7; Hang"\r\n'))
  })
})

// ── PROFIL_BKI ──────────────────────────────────────────────────────────────

describe('PROFIL_BKI – EDV-Liste Weindatenbank', () => {
  // Nachbau der bisherigen Datenblatt-Logik (weinhandel/traubenverkauf/datenblatt/route.ts)
  const altEsc = v => {
    if (v == null) return ''
    const s = String(v).replace(/"/g, '""')
    return s.includes(',') || s.includes('"') || s.includes('\n') || s.includes(';') ? `"${s}"` : s
  }
  const KOPF = ['Betriebsnr_Empf', 'Name_Empf', 'Vorname_Empf', 'Strasse_Empf', 'Hausnr_Empf', 'PLZ_Empf', 'Ort_Empf',
    'Betriebsnr_Vers', 'Name_Vers', 'Vorname_Vers', 'Strasse_Vers', 'Hausnr_Vers', 'PLZ_Vers', 'Ort_Vers',
    'Datum_Lieferung', 'Menge_kg', 'Art', 'Weiss', 'Rot', 'Sorte1', 'Sorte2', 'Sorte3',
    'Qualitaetsstufe', 'Jahrgang', 'Herkunft', 'KMW_Grad', 'Oechsle']
  const ZEILEN = [
    { empf: ['1234567', 'Winzerhof Gruber', '', 'Kellergasse', '12', '3491', 'Straß im Straßertale'], datum: '2026-09-05', kg: 1250.5, rot: false, sorte: 'GV', qual: 'QUW', jahrgang: 2026, herkunft: 'NÖ', kmw: 17.4 },
    { empf: ['7654321', 'Weingut Huber, Stiftung', 'Hans', 'Hauptstraße', '3a', '2170', 'Poysdorf'], datum: '2026-09-18', kg: 980, rot: true, sorte: 'ZW', qual: 'LDW', jahrgang: 2026, herkunft: 'Weinviertel', kmw: 18 },
  ]
  const VERS = ['9988776', 'Weingut Muster', '', 'Rebenweg', '1', '3500', 'Krems']
  const SPALTEN = [
    ...[0, 1, 2, 3, 4, 5, 6].map(i => ({ kopf: KOPF[i], typ: 'code', wert: z => z.empf[i] })),
    ...[0, 1, 2, 3, 4, 5, 6].map(i => ({ kopf: KOPF[7 + i], typ: 'code', wert: () => VERS[i] })),
    { kopf: 'Datum_Lieferung', typ: 'datum', wert: z => z.datum },
    { kopf: 'Menge_kg', typ: 'dezimal', stellen: 1, wert: z => z.kg },
    { kopf: 'Art', typ: 'code', wert: () => 'TB' },
    { kopf: 'Weiss', typ: 'janein', wert: z => !z.rot },
    { kopf: 'Rot', typ: 'janein', wert: z => z.rot },
    { kopf: 'Sorte1', typ: 'code', wert: z => z.sorte },
    { kopf: 'Sorte2', typ: 'code', wert: () => '' },
    { kopf: 'Sorte3', typ: 'code', wert: () => '' },
    { kopf: 'Qualitaetsstufe', typ: 'code', wert: z => z.qual },
    { kopf: 'Jahrgang', typ: 'ganzzahl', wert: z => z.jahrgang },
    { kopf: 'Herkunft', typ: 'code', wert: z => z.herkunft },
    { kopf: 'KMW_Grad', typ: 'dezimal', stellen: 1, wert: z => z.kmw },
    { kopf: 'Oechsle', typ: 'ganzzahl', wert: () => null },
  ]

  test('Profil-Mechanik wie die Altlogik: Vorspann, BOM, Quoting, kein abschließendes CRLF', () => {
    const t = csvText(ZEILEN, SPALTEN, PROFIL_BKI)
    // Erwartung mit der Altlogik – bewusst geändert nur: Datum mit führenden Nullen, Dezimalkomma
    const alt = [
      altEsc('EDV-Liste zum automatischen Einlesen in die Weindatenbank'),
      '',
      KOPF.map(altEsc).join(';'),
      ...ZEILEN.map(z => [
        ...z.empf, ...VERS,
        `${z.datum.slice(8, 10)}.${z.datum.slice(5, 7)}.${z.datum.slice(0, 4)}`,
        z.kg.toFixed(1).replace('.', ','),
        'TB', z.rot ? '' : 'J', z.rot ? 'J' : '', z.sorte, '', '', z.qual, String(z.jahrgang), z.herkunft,
        z.kmw.toFixed(1).replace('.', ','), '',
      ].map(altEsc).join(';')),
    ]
    assert.equal(t, BOM + alt.join('\r\n'))
  })

  // Golden-File aus den PRODUKTIVEN Spalten (SPALTEN_BKI_TRAUBENVERKAUF) und bkiZeilen():
  // Synonym- und Schreibweisen-Fälle, Rot/Weiß, Rosenmuskateller (Kürzel ohne eindeutige Farbe),
  // unbekannte Sorte, Rebsorte über Ried/Zukauf, ganze und gebrochene kg, Storno, Qualitätsstufen.
  // KAN-128 (26.09.2026, Golden-File neu erzeugt): KMW_Grad UND Oechsle immer befüllt, °KMW auf
  // 1 Stelle abgerundet (20,15 → „20,1“ statt „20,2“), °Oe wie erfasst ohne Nachkomma-Null, dazu
  // Lieferungen mit °Oe-Messung (80 → „80“, 83,5 → „83,5“, 94 °Oe = 18,97 °KMW → „18,9“).
  const BETRIEB = { betrieb_betriebsnummer: '9988776', betrieb_name: 'Weingut Muster', betrieb_strasse: 'Rebenweg 1', betrieb_plz: '3500', betrieb_ort: 'Krems' }
  const firma = { betrieb_nr: '7654321', name: 'Weingut Huber, Stiftung', strasse: 'Hauptstraße 3a', plz: '2170', ort: 'Poysdorf' }
  const VERKAEUFE = [
    // Herkunft (KAN-36): interne Stufen → BKI-Kürzel (wlnoe → WLNO, thermenregion_* → WLTH), Freitext leer
    { datum: '2026-09-05', liefernummer: 'TV-1', menge_kg: 1250, kmw_grad: 17.4, qualitaetsstufe: 'qualitaetswein', herkunft_code: 'wlnoe', grundstueck: { rebsorte: 'Weißgipfler' }, firma, jahrgang: { jahrgang: 2026 } },
    { datum: '2026-09-06', liefernummer: 'TV-2', menge_kg: 980.5, kmw_grad: 18, qualitaetsstufe: 'qualitaetswein', grundstueck: null, weingarten: { rebsorte: ' grüner   veltliner ', trauben_herkunft_code: 'thermenregion_gebietswein' }, firma, jahrgang: { jahrgang: 2026 } },
    { datum: '2026-09-07', liefernummer: 'TV-3', menge_kg: 500, kmw_grad: 19.2, qualitaetsstufe: 'kabinett', grundstueck: { rebsorte: 'Blauer Zweigelt' }, firma, jahrgang: { jahrgang: 2026 } },
    { datum: '2026-09-08', liefernummer: 'TV-4', menge_kg: 300, kmw_grad: 20.15, qualitaetsstufe: 'spaetlese', grundstueck: { rebsorte: 'Rosenmuskateller' }, firma, jahrgang: { jahrgang: 2026 } },
    { datum: '2026-09-09', liefernummer: 'TV-5', menge_kg: 120.25, kmw_grad: null, qualitaetsstufe: 'reserve', zukauf: { rebsorte: 'Uhudler', herkunft: 'Südburgenland' }, firma, jahrgang: { jahrgang: 2026 } },
    { datum: '2026-09-10', liefernummer: 'TV-6', menge_kg: 999, kmw_grad: 17, qualitaetsstufe: 'qualitaetswein', grundstueck: { rebsorte: 'Riesling' }, firma, jahrgang: { jahrgang: 2026 }, verkaufsposten: { storniert: true } },
    // KAN-128: in °Oe gemessen (kmw_grad nach Variante B, wie ihn der Abgleich-Trigger speichert)
    { datum: '2026-09-11', liefernummer: 'TV-7', menge_kg: 400, kmw_grad: 16.33, oechsle: 80, mostgewicht_einheit: 'oechsle', qualitaetsstufe: 'qualitaetswein', grundstueck: { rebsorte: 'Grüner Veltliner' }, firma, jahrgang: { jahrgang: 2026 } },
    { datum: '2026-09-12', liefernummer: 'TV-8', menge_kg: 400, kmw_grad: 17, oechsle: 83.5, mostgewicht_einheit: 'oechsle', qualitaetsstufe: 'kabinett', grundstueck: { rebsorte: 'Grüner Veltliner' }, firma, jahrgang: { jahrgang: 2026 } },
    { datum: '2026-09-13', liefernummer: 'TV-9', menge_kg: 400, kmw_grad: 18.97, oechsle: 94, mostgewicht_einheit: 'oechsle', qualitaetsstufe: 'kabinett', grundstueck: { rebsorte: 'Grüner Veltliner' }, firma, jahrgang: { jahrgang: 2026 } },
  ]

  test('Golden: produktive EDV-Liste (SPALTEN_BKI_TRAUBENVERKAUF + bkiZeilen)', () => {
    const { zeilen, warnungen } = tv.bkiZeilen(VERKAEUFE, BETRIEB)
    const t = csvText(zeilen, tv.SPALTEN_BKI_TRAUBENVERKAUF, PROFIL_BKI)
    const vers = '9988776;Weingut Muster;;Rebenweg;1;3500;Krems'
    const empf = '7654321;"Weingut Huber, Stiftung";;Hauptstraße;3a;2170;Poysdorf'
    // ausdrücklich gegen die Schnittstelle geprüft, nicht nur gegen die Golden-File:
    assert.equal(t, BOM + [
      'EDV-Liste zum automatischen Einlesen in die Weindatenbank',
      '',
      KOPF.join(';'),
      `${empf};${vers};05.09.2026;1250;TB;J;;GV;;;QUW;2026;WLNO;"17,4";"85,7"`,        // Synonym Weißgipfler → GV, ganze kg ohne Komma; °Oe aus dem °KMW
      `${empf};${vers};06.09.2026;"980,5";TB;J;;GV;;;QUW;2026;WLTH;"18,0";"88,8"`,     // Ried-Sorte, Schreibweise tolerant, Bruchteil mit Komma; DAC-Herkunft zu Qualitätswein
      `${empf};${vers};07.09.2026;500;TB;;J;ZW;;;KAB;2026;;"19,2";"95,3"`,              // Blauer Zweigelt → ZW, rot
      `${empf};${vers};08.09.2026;300;TB;;;RM;;;SPL;2026;;"20,1";"100,4"`,              // Rosenmuskateller: Kürzel ja, Farbe nicht eindeutig; 20,15 °KMW abgerundet
      `${empf};${vers};09.09.2026;"120,25";TB;;;;;;QUW;2026;;;`,                         // Zukauf „Uhudler“: kein amtliches Kürzel; Herkunft „Südburgenland“ kein BKI-Kürzel; ohne Mostgewicht
      `${empf};${vers};11.09.2026;400;TB;J;;GV;;;QUW;2026;;"16,3";80`,                  // 80 °Oe gemessen → „80“, °KMW 16,33 → „16,3“
      `${empf};${vers};12.09.2026;400;TB;J;;GV;;;KAB;2026;;"17,0";"83,5"`,              // 83,5 °Oe = 17,00 °KMW (Kabinett)
      `${empf};${vers};13.09.2026;400;TB;J;;GV;;;KAB;2026;;"18,9";94`,                  // 94 °Oe = 18,97 °KMW → „18,9“, nicht „19,0“
    ].join('\r\n'))
    gleicheBytes(t, golden('bki_traubenverkauf.csv', () => t), 'BKI-EDV-Liste weicht von der Golden-File ab')
    const w = warnungen.join('\n')
    assert.match(w, /„Rosenmuskateller“ \(RM\): Farbe nicht eindeutig/)
    assert.match(w, /„Uhudler“ steht nicht in der BKI-Kürzelliste/)
    assert.match(w, /Menge mit Nachkommastellen .* \(2 Lieferungen: TV-2, TV-5\)/)
    assert.match(w, /1 Traubenverkauf mit stornierter Rechnung ist nicht enthalten \(TV-6\)/)
    assert.match(w, /Herkunft „Südburgenland“ \(Zukauf\) ist kein BKI-Herkunftskürzel – Spalte leer gelassen\. \(1 Lieferung: TV-5\)/)
  })

  test('Leermeldung: Vorspann + Kopf, ohne abschließendes CRLF', () => {
    const t = csvText([], SPALTEN, PROFIL_BKI)
    assert.equal(t, `${BOM}EDV-Liste zum automatischen Einlesen in die Weindatenbank\r\n\r\n${KOPF.join(';')}`)
  })

  test('Profil-Schalter ausdrücklich festgelegt', () => {
    assert.equal(PROFIL_BKI.bom, true)
    assert.equal(PROFIL_BKI.abschlussCrlf, false)
    assert.equal(PROFIL_BKI.formelschutz, 'entfernen')
    assert.equal(PROFIL_BMD.formelschutz, false)
    assert.equal(PROFIL_BKI.dezimal, ',')
    assert.equal(PROFIL_EXCEL_AT.abschlussCrlf, true)
    assert.ok(Object.isFrozen(PROFIL_EXCEL_AT) && Object.isFrozen(PROFIL_BKI) && Object.isFrozen(PROFIL_BMD))
  })
})

// ── Dateiname und HTTP-Header ───────────────────────────────────────────────

describe('Dateiname und Header', () => {
  test('Muster <Meldung>_<Betriebsnummer>_<Zeitraum>_<Erstelldatum>.csv', () => {
    assert.deepEqual(csvDateiname(['Erntemeldung', '1234567', 2026], '2026-09-24'), {
      utf8: 'Erntemeldung_1234567_2026_2026-09-24.csv', ascii: 'Erntemeldung_1234567_2026_2026-09-24.csv',
    })
    assert.deepEqual(csvDateiname(['Nährstoffbilanz', null, '', '2026'], '2026-09-24'), {
      utf8: 'Nährstoffbilanz_2026_2026-09-24.csv', ascii: 'Naehrstoffbilanz_2026_2026-09-24.csv',
    })
    assert.deepEqual(csvDateiname(['Weinbuch Grüner Veltliner „Ried Kaiserberg“', 'Größe/Übersicht: 1'], '2026-09-24'), {
      utf8: 'Weinbuch-Grüner-Veltliner-Ried-Kaiserberg_Größe-Übersicht-1_2026-09-24.csv',
      ascii: 'Weinbuch-Gruener-Veltliner-Ried-Kaiserberg_Groesse-Uebersicht-1_2026-09-24.csv',
    })
    assert.equal(csvDateiname([], null).ascii, 'Export.csv')
    assert.match(csvDateiname(['X']).utf8, /^X_\d{4}-\d{2}-\d{2}\.csv$/)
    assert.deepEqual(csvDateinameAus('Übersicht 2026.csv'), { utf8: 'Übersicht-2026.csv', ascii: 'Uebersicht-2026.csv' })
  })

  test('Header: nur ASCII, filename + filename*, X-Header URI-kodiert', () => {
    const w = ['Spalte „Menge (kg)“: 1 Wert keine gültige Zahl – Feld leer gelassen (Datensatz 3)', 'Kellergemeinschaft: 2 Gebinde ohne Stammdaten (€ ő)']
    const h = csvKopfzeilen(csvDateiname(['Nährstoffbilanz', '2026'], '2026-09-24'), 12, w)
    for (const [k, v] of Object.entries(h)) assert.match(v, /^[\x20-\x7E]*$/, `Header ${k} enthält Nicht-ASCII`)
    assert.equal(h['Content-Type'], 'text/csv; charset=utf-8')
    assert.equal(h['Content-Disposition'], `attachment; filename="Naehrstoffbilanz_2026_2026-09-24.csv"; filename*=UTF-8''N%C3%A4hrstoffbilanz_2026_2026-09-24.csv`)
    assert.equal(h['Cache-Control'], 'private, no-store, max-age=0')
    assert.equal(h['X-Content-Type-Options'], 'nosniff')
    assert.equal(decodeURIComponent(h['X-Dateiname']), 'Nährstoffbilanz_2026_2026-09-24.csv')
    assert.equal(h['X-Zeilen'], '12')
    assert.deepEqual(decodeURIComponent(h['X-Warnungen']).split('\n'), w)
    assert.equal(h['X-Warnungen-Anzahl'], '2')
  })

  test('Header ohne Warnungen; lange Warnlisten werden gekürzt', () => {
    const ohne = csvKopfzeilen(csvDateiname(['A'], '2026-09-24'), 0)
    assert.equal(ohne['X-Zeilen'], '0')
    assert.equal('X-Warnungen' in ohne, false)
    const viele = Array.from({ length: 200 }, (_, i) => `Warnung Nummer ${i + 1} mit Umlauten äöü und etwas Text zur Länge`)
    const h = csvKopfzeilen(csvDateiname(['A'], '2026-09-24'), 5, viele)
    assert.ok(h['X-Warnungen'].length <= 3000)
    assert.equal(h['X-Warnungen-Anzahl'], '200')
    const erhalten = decodeURIComponent(h['X-Warnungen']).split('\n')
    assert.ok(erhalten.length > 3 && erhalten.length < 200)
    assert.equal(erhalten[0], viele[0])
  })

  test('lange Warnung mit Emoji an der Kürzungsstelle: kein URIError, Kürzung nach Codepoints', () => {
    const w = 'x'.repeat(298) + '🍇' + 'yyy'                                   // Surrogatpaar an Stelle 298/299
    const h = csvKopfzeilen(csvDateiname(['A'], '2026-09-24'), 1, [w, 'Ried „🍇 Traube“ ohne KG-Nr.'])
    const erhalten = decodeURIComponent(h['X-Warnungen']).split('\n')
    assert.equal(erhalten[0], 'x'.repeat(298) + '🍇…')
    assert.equal(erhalten[1], 'Ried „🍇 Traube“ ohne KG-Nr.')
    // ein einsames Surrogat im Rohtext wird ersetzt statt den Export abzubrechen
    const kaputt = csvKopfzeilen(csvDateiname(['A'], '2026-09-24'), 1, ['Name \uD83C ohne Paar'])
    assert.equal(decodeURIComponent(kaputt['X-Warnungen']), 'Name � ohne Paar')
  })
})
