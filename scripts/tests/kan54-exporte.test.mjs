// Tests für die Datenexporte unter /api/export (KAN-54, 25.09.2026): Kontakte, Firmen,
// Lagerbestand und Verkaufshistorie laufen über den CSV-Baustein (src/lib/csv, PROFIL_EXCEL_AT);
// die Zeilenaufbereitung steht in src/lib/export/datenexporte.ts. Geprüft werden Kopfzeile
// (Inhalt und Reihenfolge wie vor der Umstellung), Trennzeichen, BOM, CRLF, Formelschutz, je
// Export ein Beispiel samt Rundung/Datum sowie, dass die Routen keinen CSV-Eigenbau mehr haben.
//
// Aufruf:  npm run -s test:csv   (alle scripts/tests/*.test.mjs)
//          bzw. node --experimental-strip-types --test scripts/tests/kan54-exporte.test.mjs
//
// datenexporte.ts importiert nur lib/csv mit relativem Pfad samt .ts-Endung (wie
// lib/buchhaltung/bmd.ts) und ist deshalb ohne Auflösungs-Hook ladbar. Das Rebsorten-Kürzel
// reicht die Lager-Route als Funktion herein; lib/wein/bki_kuerzel.ts importiert mit '@/…' und
// wird hier über denselben Hook wie in den Ernte-Tests geladen (ernte.aufloesung.mjs).

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { register } from 'node:module'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import path from 'node:path'

import * as dx from '../../src/lib/export/datenexporte.ts'
import { csvDateiname, csvKopfzeilen } from '../../src/lib/csv/index.ts'

register('./ernte.aufloesung.mjs', import.meta.url)
const { getRebsorteKuerzel } = await import('../../src/lib/wein/bki_kuerzel.ts')

const HIER = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HIER, '..', '..')
const BOM = '\uFEFF'
const CRLF = '\r\n'

/** Eine CSV-Zeile (Semikolon, "…" mit "" als Escape) in Felder zerlegen */
function felder(zeile) {
  const out = []
  let feld = '', inQuote = false
  for (let i = 0; i < zeile.length; i++) {
    const c = zeile[i]
    if (inQuote) {
      if (c === '"' && zeile[i + 1] === '"') { feld += '"'; i++ }
      else if (c === '"') inQuote = false
      else feld += c
    } else if (c === '"') inQuote = true
    else if (c === ';') { out.push(feld); feld = '' }
    else feld += c
  }
  out.push(feld)
  return out
}

/** CSV-Text → { kopf, zeilen } nach Prüfung von BOM und CRLF (auch nach der letzten Zeile) */
function lesen(text) {
  assert.ok(text.startsWith(BOM), 'UTF-8-BOM am Anfang')
  assert.ok(text.endsWith(CRLF), 'CRLF auch nach der letzten Zeile')
  const linien = text.slice(1, -2).split(CRLF)
  assert.ok(!linien.some(l => /[\r\n]/.test(l)), 'keine nackten CR/LF in Zeilen')
  const [kopf, ...zeilen] = linien.map(felder)
  for (const z of zeilen) assert.equal(z.length, kopf.length, 'jede Zeile hat so viele Felder wie der Kopf')
  return { kopf, zeilen, linien }
}

/** Zeile als Objekt Kopf → Wert */
const alsObjekt = (kopf, z) => Object.fromEntries(kopf.map((k, i) => [k, z[i]]))

// Kopfzeilen vor der Umstellung (Stand main 2763962) – Reihenfolge und Inhalt müssen bleiben;
// geändert ist nur die Einheit im Kopf („Sonderrabatt %“ → „Sonderrabatt (%)“ usw.).
const KOPF_ALT = {
  kontakte: ['Accountnummer', 'Vorname', 'Nachname', 'Segment', 'E-Mail', 'Weitere E-Mails', 'Tel.-Vorwahl', 'Telefon', 'Mobil-Vorwahl', 'Mobil', 'Straße', 'PLZ', 'Ort', 'Land', 'Stammkunde', 'Lead', 'Sonderrabatt %', 'Notizen', 'Angelegt am'],
  firmen: ['Accountnummer', 'Firmenname', 'Segment', 'E-Mail', 'Weitere E-Mails', 'Tel.-Vorwahl', 'Telefon', 'Straße', 'PLZ', 'Ort', 'Land', 'UID-Nummer', 'Zahlungsziel (Tage)', 'Lead', 'Sonderrabatt %', 'Notizen'],
  lager: ['Name', 'Jahrgang', 'Rebsorte', 'Kürzel', 'Flaschengröße', 'Bestand (Fl.)', 'VK-Preis (€)', 'Lagerwert (€)'],
  verkauf: ['Datum', 'Rechnungsnummer', 'Accountnummer', 'DebitorNr.', 'Kunde', 'Artikel', 'Menge', 'Einheit', 'Preis (€)', 'Rabatt %', 'Sonderrabatt %', 'USt %', 'Zeilenbetrag (€)', 'Bezahlt', 'Storniert'],
}
const neuerKopf = k => k.replace(/ %$/, ' (%)')

const EXPORTE = {
  kontakte: { csv: dx.kontakteCsv, spalten: dx.SPALTEN_KONTAKTE },
  firmen: { csv: dx.firmenCsv, spalten: dx.SPALTEN_FIRMEN },
  lager: { csv: rows => dx.lagerCsv(rows, getRebsorteKuerzel), spalten: dx.SPALTEN_LAGER },
  verkauf: { csv: dx.verkaufCsv, spalten: dx.SPALTEN_VERKAUF },
}

describe('Gemeinsames Format (PROFIL_EXCEL_AT)', () => {
  for (const [name, e] of Object.entries(EXPORTE)) {
    test(`${name}: Kopfzeile in bisheriger Reihenfolge, Semikolon, BOM, CRLF, Leermeldung`, () => {
      const r = e.csv([])
      assert.equal(r.zeilen, 0)
      assert.deepEqual(r.warnungen, [])
      const erwartet = KOPF_ALT[name].map(neuerKopf)
      assert.equal(r.text, BOM + erwartet.join(';') + CRLF, 'Leermeldung = nur die Kopfzeile')
      assert.deepEqual(e.spalten.map(s => s.kopf), erwartet)
      assert.ok(!r.text.includes(','), 'kein Komma als Trenner (Kopf ohne Komma)')
    })
  }

  test('Zahlspalten haben feste Stellen, Beträge 2', () => {
    for (const [name, e] of Object.entries(EXPORTE)) {
      for (const s of e.spalten) {
        if (['ganzzahl', 'dezimal', 'betrag', 'prozent'].includes(s.typ)) assert.equal(typeof s.stellen, 'number', `${name}: ${s.kopf}`)
        if (s.typ === 'betrag') assert.equal(s.stellen, 2, `${name}: ${s.kopf}`)
        if (s.typ === 'betrag') assert.match(s.kopf, /\(€\)$/, `${name}: Einheit im Kopf`)
        if (s.typ === 'prozent') assert.match(s.kopf, /\(%\)$/, `${name}: Einheit im Kopf`)
      }
    }
  })

  test('Dateiname wie bisher (<export>_<JJJJ-MM-TT>.csv), Download-Kopf aus dem Baustein', () => {
    const n = csvDateiname(['kontakte'], '2026-09-25')
    assert.deepEqual(n, { ascii: 'kontakte_2026-09-25.csv', utf8: 'kontakte_2026-09-25.csv' })
    const h = csvKopfzeilen(csvDateiname(['lagerbestand'], '2026-09-25'), 3)
    assert.equal(h['Content-Type'], 'text/csv; charset=utf-8')
    assert.match(h['Content-Disposition'], /^attachment; filename="lagerbestand_2026-09-25\.csv"; filename\*=UTF-8''lagerbestand_2026-09-25\.csv$/)
    assert.match(h['Cache-Control'], /no-store/)
    assert.equal(h['X-Zeilen'], '3')
  })
})

describe('Kontakte', () => {
  const KONTAKT = {
    accountnummer: '00042', vorname: 'Anna', nachname: 'Müller', segment: 'Privat',
    email: 'anna@example.at', email_weitere: ['büro@example.at', '', 'privat@example.at'],
    telefon: '0664 1234567', telefon_vorwahl: '+43', mobil: null, mobil_vorwahl: '+43',
    strasse: 'Hauptstraße 1', plz: '3400', ort: 'Klosterneuburg', land: 'AT',
    stammkunde: true, is_lead: null, sonderrabatt_pct: null,
    notizen: '=HYPERLINK("http://böse.example";"Klick")\nzweite Zeile',
    // 31.03.2026 22:30 UTC = 01.04.2026 00:30 in Wien (Sommerzeit)
    erstellt_am: '2026-03-31T22:30:00+00:00',
  }

  test('Beispielzeile: Codes unverändert, Ja/Nein, Datum in Wiener Zeit, Sonderrabatt 0,00', () => {
    const r = dx.kontakteCsv([KONTAKT])
    const { kopf, zeilen } = lesen(r.text)
    assert.equal(r.zeilen, 1)
    const o = alsObjekt(kopf, zeilen[0])
    assert.equal(o.Accountnummer, '00042', 'führende Nullen bleiben')
    assert.equal(o.Nachname, 'Müller')
    assert.equal(o['Weitere E-Mails'], 'büro@example.at; privat@example.at', 'wie bisher „; “-getrennt, leere Einträge fallen weg')
    assert.equal(o.Telefon, '0664 1234567')
    assert.equal(o.Mobil, '', 'fehlender Wert = leeres Feld')
    assert.equal(o.PLZ, '3400')
    assert.equal(o.Stammkunde, 'Ja')
    assert.equal(o.Lead, 'Nein', 'is_lead null → Nein wie bisher')
    assert.equal(o['Sonderrabatt (%)'], '0,00', 'ohne Sonderrabatt 0 % wie bisher')
    assert.equal(o['Angelegt am'], '01.04.2026')
  })

  test('Formelschutz: Apostroph vor = + - @, Umbrüche → Leerzeichen, Anführungszeichen verdoppelt', () => {
    const { text } = dx.kontakteCsv([KONTAKT])
    const { kopf, zeilen, linien } = lesen(text)
    assert.ok(linien[1].includes('"\'=HYPERLINK(""http://böse.example"";""Klick"") zweite Zeile"'), linien[1])
    const o = alsObjekt(kopf, zeilen[0])
    assert.equal(o['Tel.-Vorwahl'], "'+43", 'auch die Vorwahl „+43“ bekommt den Apostroph (Excel läse sonst die Zahl 43)')
    assert.equal(o.Notizen, '\'=HYPERLINK("http://böse.example";"Klick") zweite Zeile')
  })

  test('ungültiges Datum → leeres Feld und Warnung', () => {
    const r = dx.kontakteCsv([{ ...KONTAKT, erstellt_am: 'gestern' }])
    const { kopf, zeilen } = lesen(r.text)
    assert.equal(alsObjekt(kopf, zeilen[0])['Angelegt am'], '')
    assert.equal(r.warnungen.length, 1)
    assert.match(r.warnungen[0], /Angelegt am/)
  })
})

describe('Firmen', () => {
  test('Beispielzeile: UID/PLZ als Code, Zahlungsziel ganzzahlig, Sonderrabatt 2 Stellen, Semikolon im Text gequotet', () => {
    const r = dx.firmenCsv([{
      accountnummer: 'F-0007', name: 'Heuriger „Zur Linde“; Filiale Wien', segment: 'Gastronomie',
      email: 'office@linde.at', email_weitere: null, telefon: '01 2345678', telefon_vorwahl: '+43',
      strasse: 'Lindengasse 3', plz: '1070', ort: 'Wien', land: 'AT', uid_nummer: 'ATU12345678',
      zahlungsziel_tage: 14, is_lead: true, sonderrabatt_pct: 2.5, notizen: '@Chef anrufen',
    }])
    const { kopf, zeilen, linien } = lesen(r.text)
    const o = alsObjekt(kopf, zeilen[0])
    assert.equal(o.Firmenname, 'Heuriger „Zur Linde“; Filiale Wien')
    assert.ok(linien[1].includes('"Heuriger „Zur Linde“; Filiale Wien"'), 'Feld mit Semikolon in Anführungszeichen')
    assert.equal(o['Weitere E-Mails'], '')
    assert.equal(o['UID-Nummer'], 'ATU12345678')
    assert.equal(o['Zahlungsziel (Tage)'], '14')
    assert.equal(o.Lead, 'Ja')
    assert.equal(o['Sonderrabatt (%)'], '2,50')
    assert.equal(o.Notizen, "'@Chef anrufen", 'Formelschutz auch für @')
  })
})

describe('Lagerbestand', () => {
  test('Beispielzeilen: Flaschengröße, Kürzel, Betrag mit Dezimalkomma, Lagerwert kaufmännisch gerundet', () => {
    const r = dx.lagerCsv([
      { name: 'Grüner Veltliner Ried Kirchberg', jahrgang: 2025, rebsorte: 'Grüner Veltliner', flaschengroesse_ml: 750, bestand_flaschen: 3, vk_preis_brutto: 8.35, aktiv: true },
      { name: 'Zweigelt Magnum', jahrgang: 2023, rebsorte: 'Zweigelt', flaschengroesse_ml: 1500, bestand_flaschen: 1200, vk_preis_brutto: 29.9, aktiv: true },
      { name: 'Muster ohne Preis', jahrgang: null, rebsorte: null, flaschengroesse_ml: 700, bestand_flaschen: null, vk_preis_brutto: null, aktiv: true },
      { name: 'Ohne Größe', jahrgang: 2024, rebsorte: 'Hausmarke', flaschengroesse_ml: null, bestand_flaschen: 5, vk_preis_brutto: '6.5', aktiv: true },
    ], getRebsorteKuerzel)
    const { kopf, zeilen } = lesen(r.text)
    const [a, b, c, d] = zeilen.map(z => alsObjekt(kopf, z))
    assert.equal(a.Jahrgang, '2025')
    assert.equal(a.Kürzel, 'GV')
    assert.equal(a.Flaschengröße, '0,75 L')
    assert.equal(a['Bestand (Fl.)'], '3')
    assert.equal(a['VK-Preis (€)'], '8,35')
    assert.equal(a['Lagerwert (€)'], '25,05', '8,35 × 3 = 25,049999… in Gleitkomma → kaufmännisch 25,05')
    assert.equal(b.Flaschengröße, '1,5 L')
    assert.equal(b['Lagerwert (€)'], '35880,00', 'ohne Tausenderpunkt')
    assert.equal(c.Flaschengröße, '700 ml')
    assert.equal(c.Kürzel, '')
    assert.equal(c['VK-Preis (€)'], '')
    assert.equal(c['Lagerwert (€)'], '', 'ohne VK-Preis kein Lagerwert')
    assert.equal(d.Flaschengröße, '', 'ohne Größe leer statt „null ml“')
    assert.equal(d['Lagerwert (€)'], '32,50', 'numeric als String von PostgREST')
    assert.equal(r.warnungen.length, 0)
  })

  test('Kürzel kommt aus der übergebenen Funktion – ohne Rebsorte kein Aufruf', () => {
    const gefragt = []
    const stub = s => { gefragt.push(s); return s === 'Zweigelt' ? 'ZW' : '' }
    const z = [{ rebsorte: 'Zweigelt' }, { rebsorte: null }, { rebsorte: 'Unbekannt' }].map(r => dx.lagerExportZeile(r, stub))
    assert.deepEqual(z.map(x => x.kuerzel), ['ZW', null, null])
    assert.deepEqual(gefragt, ['Zweigelt', 'Unbekannt'])
  })
})

describe('Verkaufshistorie', () => {
  const POSTEN = [
    {
      datum: '2026-08-03', rechnungsnummer: 'RE-2026-0142', bezahlt: true, storniert: false,
      kontakt: { vorname: 'Anna', nachname: 'Müller', accountnummer: '00042' },
      firma: { name: 'Müller GmbH', accountnummer: 'F-0001', debitor_nr: '200001' },
      verkauf_positionen: [
        { name: 'Grüner Veltliner 2025', menge: 6, einheit: 'Fl.', preis_brutto: 12.9, rabatt_pct: 10, sonderrabatt_pct: 5, ust_satz: 13 },
        { name: 'Karton', menge: 1, einheit: 'Stk.', preis_brutto: 8.3333, rabatt_pct: null, sonderrabatt_pct: null, ust_satz: 20 },
      ],
    },
    {
      datum: '2026-08-04', rechnungsnummer: null, bezahlt: false, storniert: true,
      kontakt: null, firma: null,
      verkauf_positionen: [{ name: '-Bruch', menge: 0.75, einheit: 'l', preis_brutto: 4, rabatt_pct: 0, sonderrabatt_pct: 0, ust_satz: 13 }],
    },
    { datum: '2026-08-05', rechnungsnummer: 'RE-2026-0143', bezahlt: false, storniert: false, kontakt: null, firma: { name: 'Weinhandel Huber', accountnummer: 'F-0002', debitor_nr: null }, verkauf_positionen: [] },
  ]

  test('eine Zeile je Position, Belegdaten wiederholt, Posten ohne Positionen entfallen', () => {
    const r = dx.verkaufCsv(POSTEN)
    assert.equal(r.zeilen, 3)
    const { kopf, zeilen } = lesen(r.text)
    const [p1, p2, p3] = zeilen.map(z => alsObjekt(kopf, z))
    assert.equal(p1.Datum, '03.08.2026', 'DATE stringbasiert als TT.MM.JJJJ')
    assert.equal(p1.Rechnungsnummer, 'RE-2026-0142')
    assert.equal(p1.Accountnummer, '00042', 'Accountnummer des Kontakts vor der Firma')
    assert.equal(p1['DebitorNr.'], '200001')
    assert.equal(p1.Kunde, 'Anna Müller')
    assert.equal(p1.Menge, '6,00')
    assert.equal(p1['Preis (€)'], '12,90')
    assert.equal(p1['Rabatt (%)'], '10,00')
    assert.equal(p1['Sonderrabatt (%)'], '5,00')
    assert.equal(p1['USt (%)'], '13,00')
    assert.equal(p1['Zeilenbetrag (€)'], '66,18', '12,90 × 6 × 0,9 × 0,95 = 66,177')
    assert.equal(p1.Bezahlt, 'Ja')
    assert.equal(p1.Storniert, 'Nein')
    assert.equal(p2.Datum, '03.08.2026')
    assert.equal(p2['Preis (€)'], '8,33', 'Preis numeric(10,4) → 2 Stellen wie bisher')
    assert.equal(p2['Rabatt (%)'], '', 'ohne Rabatt leer wie bisher')
    assert.equal(p2['Zeilenbetrag (€)'], '8,33')
    assert.equal(p3.Kunde, '', 'Barverkauf ohne Kunde: leer statt „–“')
    assert.equal(p3.Accountnummer, '')
    assert.equal(p3.Rechnungsnummer, '')
    assert.equal(p3.Artikel, "'-Bruch", 'Formelschutz auch in der Artikelbezeichnung')
    assert.equal(p3.Menge, '0,75')
    assert.equal(p3['Zeilenbetrag (€)'], '3,00')
    assert.equal(p3.Storniert, 'Ja')
  })

  test('Kunde nur Firma: Firmenname und Firmen-Accountnummer', () => {
    const [z] = dx.verkaufExportZeilen({ ...POSTEN[2], verkauf_positionen: [{ name: 'Wein', menge: 1, preis_brutto: 10, ust_satz: 13 }] })
    assert.equal(z.kunde, 'Weinhandel Huber')
    assert.equal(z.accountnummer, 'F-0002')
    assert.equal(z.debitorNr, null)
    assert.equal(z.zeilenbetrag, 10)
  })
})

describe('Routen unter /api/export ohne CSV-Eigenbau', () => {
  const route = name => readFileSync(path.join(ROOT, 'src', 'app', 'api', 'export', name, 'route.ts'), 'utf8')

  test('lager: Kürzel wie bisher aus getRebsorteKuerzel', () => {
    assert.match(route('lager'), /lagerCsv\(data \?\? \[\], getRebsorteKuerzel\)/)
  })

  for (const [name, fn] of [['kontakte', 'kontakteCsv'], ['firmen', 'firmenCsv'], ['lager', 'lagerCsv'], ['verkauf', 'verkaufCsv']]) {
    test(`${name}: Baustein statt Handarbeit, Rechte- und Zwei-Faktor-Prüfung bleiben`, () => {
      const s = route(name)
      assert.match(s, new RegExp(`import \\{ ${fn} \\} from '@/lib/export/datenexporte'`))
      assert.match(s, /return csvAntwort\(csv\.text, csvDateiname\(\['[a-z]+'\]\), csv\.zeilen, csv\.warnungen\)/)
      assert.doesNotMatch(s, /text\/csv|\.join\(['"][,;]['"]\)|new NextResponse/)
      assert.ok(!/\\uFEFF|\uFEFF/i.test(s), 'kein BOM-Literal')
      assert.match(s, /const zweiFaktor = await pruefeZweiFaktor\(\)\s+if \(zweiFaktor\) return zweiFaktor/)
      assert.match(s, /darfDatenexport\(membership\)/)
      assert.match(s, /\.eq\('tenant_id', tenantId\)/)
      assert.match(s, /await alle\(/)
    })
  }

  test('bmd: Download-Kopf über csvAntwort, Text weiter aus bmdCsv/personenkontenCsv (PROFIL_BMD)', () => {
    const s = route('bmd')
    assert.match(s, /csvAntwort\(csv, dateiname, csvZeilen\)/)
    assert.match(s, /bmdCsv\(r\.zeilen\)/)
    assert.match(s, /personenkontenCsv\(r\.zeilen\)/)
    assert.doesNotMatch(s, /text\/csv|new NextResponse/)
    for (const h of ['X-BMD-Anzahl', 'X-BMD-Summe', 'X-BMD-Dateiname', 'X-BMD-Protokolliert', 'X-BMD-Nur-Lesen', 'X-BMD-Sammelkonto']) {
      assert.ok(s.includes(`'${h}'`), `${h} bleibt (BmdClient liest ihn)`)
    }
    assert.match(s, /hatModul\('modul_ea'\)/)
  })

  test('check-behoerden-csv: keine Altfälle mehr, Prüfung grün', () => {
    const skript = readFileSync(path.join(ROOT, 'scripts', 'check-behoerden-csv.js'), 'utf8')
    assert.match(skript, /const ALTFAELLE = \{\}/)
    const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'check-behoerden-csv.js')], { cwd: ROOT, encoding: 'utf8' })
    assert.equal(r.status, 0, r.stderr)
    assert.doesNotMatch(r.stdout, /ALTFALL|Altfall/)
  })
})
