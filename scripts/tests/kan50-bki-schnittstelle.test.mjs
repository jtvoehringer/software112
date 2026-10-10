// KAN-50 AP13 (10.10.2026): Export-Grundgerüst der BKI-Schnittstelle – XLSX-Schreiber ohne Abhängigkeiten, eine Mappe mit
// einem Blatt je Spezifikationsblatt (Reihenfolge der Spezifikation) plus Prüfbericht, Katalogblätter, Prüfregeln.
//
// Aufruf:  npm run -s test:csv   (Node ≥ 22.15 wegen module.registerHooks)

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import * as x from '../../src/lib/xlsx/index.ts'
import { hooksRegistrieren, laden, nurMitHooks, hooksMoeglich } from './buchung-attrappe.mjs'

hooksRegistrieren()
const s = hooksMoeglich ? await laden('lib/behoerden/bki-schnittstelle.ts') : null
const reg = hooksMoeglich ? await laden('lib/behoerden/register.ts') : null
const kat = hooksMoeglich ? await laden('lib/behoerden/bki-kataloge.ts') : null
const ld = hooksMoeglich ? await laden('lib/behoerden/bki-schnittstelle-laden.ts') : null
const quelle = p => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')

/** Unkomprimiertes ZIP lesen: Pfad → Text (nur Methode 0, wie zipStored schreibt) */
function zipLesen(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const dateien = new Map()
  let p = 0
  while (dv.getUint32(p, true) === 0x04034b50) {
    assert.equal(dv.getUint16(p + 8, true), 0, 'Methode stored')
    const groesse = dv.getUint32(p + 18, true), nl = dv.getUint16(p + 26, true), xl = dv.getUint16(p + 28, true)
    const name = new TextDecoder().decode(bytes.subarray(p + 30, p + 30 + nl))
    const inhalt = bytes.subarray(p + 30 + nl + xl, p + 30 + nl + xl + groesse)
    assert.equal(x.crc32(inhalt), dv.getUint32(p + 14, true), `CRC ${name}`)
    dateien.set(name, new TextDecoder().decode(inhalt))
    p += 30 + nl + xl + groesse
  }
  assert.equal(dv.getUint32(bytes.length - 22, true), 0x06054b50, 'Ende des Zentralverzeichnisses')
  assert.equal(dv.getUint16(bytes.length - 22 + 10, true), dateien.size, 'Einträge im Zentralverzeichnis')
  return dateien
}

describe('XLSX-Schreiber', () => {
  test('CRC32, Spaltennamen, Excel-Datum, Blattnamen', () => {
    assert.equal(x.crc32(new TextEncoder().encode('123456789')), 0xCBF43926)
    assert.deepEqual([0, 25, 26, 51, 701, 702].map(x.spaltenName), ['A', 'Z', 'AA', 'AZ', 'ZZ', 'AAA'])
    assert.deepEqual(['1900-03-01', '2026-10-10', '2026-02-30', 'x'].map(x.excelDatum), [61, 46305, null, null])
    const v = new Set()
    assert.deepEqual(['Lagerstand zum Zeitraum/Test', 'a'.repeat(40), 'BSM', 'bsm', ''].map(n => x.blattName(n, v)),
      ['Lagerstand zum Zeitraum Test', 'a'.repeat(31), 'BSM', 'bsm (2)', 'Blatt'])
  })

  test('Mappe: gültiges ZIP mit Content-Types, Blättern in Reihenfolge, typisierten Zellen und XML-Escaping', () => {
    const bytes = x.xlsxMappe([
      { name: 'Prüfbericht', kopf: ['Blatt', 'Hinweis'], zeilen: [[{ t: 's', v: 'A & <B> "C"\u0001' }, null]] },
      { name: 'Daten', kopf: ['Datum', 'Menge', 'Bio', 'Stück'], zeilen: [[{ t: 'd', v: '2026-10-10' }, { t: 'n', v: 1234.5, stellen: 2 }, { t: 'b', v: true }, { t: 'n', v: 7, stellen: 0 }]] },
    ])
    const z = zipLesen(bytes)
    assert.deepEqual([...z.keys()], ['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml', 'xl/worksheets/sheet1.xml', 'xl/worksheets/sheet2.xml'])
    assert.match(z.get('xl/workbook.xml'), /<sheet name="Prüfbericht" sheetId="1" r:id="rId1"\/><sheet name="Daten" sheetId="2" r:id="rId2"\/>/)
    assert.match(z.get('xl/worksheets/sheet1.xml'), /<t xml:space="preserve">A &amp; &lt;B&gt; &quot;C&quot; <\/t>/)
    const d = z.get('xl/worksheets/sheet2.xml')
    assert.match(d, /<c r="A2" s="2"><v>46305<\/v><\/c>/, 'Datum als Seriennummer mit Datumsstil')
    assert.match(d, /<c r="B2" s="5"><v>1234.5<\/v><\/c>/, 'Zahl mit Stil 0.00')
    assert.match(d, /<c r="C2" t="b"><v>1<\/v><\/c>/)
    assert.match(d, /<pane ySplit="1"[^>]*state="frozen"\/>/)
    assert.match(d, /<autoFilter ref="A1:D2"\/>/)
    assert.match(z.get('xl/styles.xml'), /formatCode="yyyy\\-mm\\-dd"/)
    assert.deepEqual(x.xlsxMappe([{ name: 'a', kopf: ['x'], zeilen: [] }]), x.xlsxMappe([{ name: 'a', kopf: ['x'], zeilen: [] }]), 'deterministisch')
    assert.throws(() => x.xlsxMappe([]))
  })
})

describe('BKI-Schnittstelle: Blätter und Register', nurMitHooks, () => {
  test('15 Blätter in der Reihenfolge der Spezifikation; jede Meldung existiert, fehlende mit Ticket', () => {
    assert.deepEqual(s.BKI_BLAETTER.map(b => b.blatt), ['Betriebsdaten', 'Qualitätsstufen', 'Weingärten', 'Erzeugnisse', 'Buchungsarten',
      'GebindeVerzeichnis', 'RV zum Eingang', 'RV zum Ausgang', 'Lagerstand zum Zeitraum', 'Verkauf im Zeitraum', 'Einkauf im Zeitraum',
      'TBS-Aufstellung', 'Lagerbewegungen', 'Besondere Konten', 'BSM'])
    for (const b of s.BKI_BLAETTER) {
      if (b.meldung) assert.ok(reg.meldungFinden(b.meldung), b.meldung)
      else assert.match(b.folgt, /^KAN-\d+$/, b.blatt)
    }
  })

  test('Längen und Mindestangaben verweisen auf vorhandene Spaltenköpfe', () => {
    for (const [tab, name] of [[s.LAENGEN, 'LAENGEN'], [s.MINDESTANGABEN, 'MINDESTANGABEN']]) {
      for (const [id, felder] of Object.entries(tab)) {
        const koepfe = reg.meldungFinden(id).spalten.map(sp => sp.kopf)
        for (const k of Array.isArray(felder) ? felder : Object.keys(felder)) assert.ok(koepfe.includes(k), `${name} ${id}: „${k}“`)
      }
    }
  })

  test('Parameter je Meldung aus dem gemeinsamen Zeitraum (S1); Weinwirtschaftsjahr', () => {
    const z = { von: '2025-08-01', bis: '2026-07-31', stichtag: '2026-07-31' }
    assert.equal(s.parameterFuer('bki-lagerstand', z).toString(), 'stichtag=2026-07-31')
    assert.equal(s.parameterFuer('bsm', z).toString(), 'von=2025-08-01&bis=2026-07-31')
    assert.equal(s.parameterFuer('besondere-konten', z).toString(), 'jahr=2025')
    assert.equal(s.parameterFuer('bki-betriebsdaten', z).toString(), '')
    assert.deepEqual(['2026-07-31', '2026-08-01'].map(s.weinwirtschaftsjahr), [2025, 2026])
    for (const b of s.BKI_BLAETTER.filter(b => b.meldung && !b.nurEinzeln)) {   // KAN-46: RV-Blätter brauchen eine Auswahl
      const p = reg.meldungFinden(b.meldung).parameter(s.parameterFuer(b.meldung, z))
      assert.ok(!p.parameterFehler, `${b.meldung}: ${p.fehler ?? ''}`)
    }
  })

  test('Zeitraum aus der URL: Vorgaben, Prüfung', () => {
    assert.deepEqual(ld.bkiZeitraumAus(new URLSearchParams(), '2026-10-10'), { von: '2026-08-01', bis: '2026-10-10', stichtag: '2026-10-10' })
    assert.deepEqual(ld.bkiZeitraumAus(new URLSearchParams('bis=2026-07-31'), '2026-10-10'), { von: '2025-08-01', bis: '2026-07-31', stichtag: '2026-07-31' })
    assert.match(ld.bkiZeitraumAus(new URLSearchParams('von=2026-09-01&bis=2026-08-01'), '2026-10-10').fehler, /Beginn liegt nach/)
    assert.match(ld.bkiZeitraumAus(new URLSearchParams('bis=2026-12-31'), '2026-10-10').fehler, /Zukunft/)
    assert.match(ld.bkiZeitraumAus(new URLSearchParams('stichtag=31.07.2026'), '2026-10-10').fehler, /stichtag/)
  })
})

describe('BKI-Schnittstelle: Prüfung und Mappe', nurMitHooks, () => {
  const SP = [
    { kopf: 'Datum', typ: 'datum', wert: z => z.d },
    { kopf: 'BelegNr.', typ: 'code', wert: z => z.b },
    { kopf: 'Erzeugnis lt. Liste', typ: 'code', wert: z => z.e },
    { kopf: 'Buchungsart BSM', typ: 'code', wert: z => z.a },
    { kopf: 'Buchungsmenge in lt.', typ: 'dezimal', stellen: 2, wert: z => z.m },
  ]

  test('kürzt auf die Länge der Spezifikation, meldet ungültige Werte, fehlende Mindestangaben und BelegNr. ≠ int(10)', () => {
    const r = s.blattPruefen('bki-lagerbewegungen', 'Lagerbewegungen', SP, [
      { d: '2026-10-01', b: '1001', e: 'WEINGU', a: 'ERNTE', m: 1500.456 },
      { d: '2026-10-02', b: 'B-7', e: 'ZUVIELELANG', a: null, m: 'abc' },
    ])
    assert.deepEqual(r.xlsx[0], [{ t: 'd', v: '2026-10-01' }, { t: 's', v: '1001' }, { t: 's', v: 'WEINGU' }, { t: 's', v: 'ERNTE' }, { t: 'n', v: 1500.46, stellen: 2 }])
    assert.deepEqual(r.xlsx[1][2], { t: 's', v: 'ZUVIELEL' })
    const texte = r.hinweise.map(h => `${h.art}: ${h.text}`)
    assert.ok(texte.includes('fehler: 1 Zeile(n) ohne „Buchungsart BSM“ (Mindestangabe)'), texte.join(' | '))
    assert.ok(texte.includes('fehler: 1 ungültige(r) Wert(e) in „Buchungsmenge in lt.“ – Zelle leer gelassen'))
    assert.ok(texte.includes('warnung: 1 Wert(e) in „Erzeugnis lt. Liste“ auf 8 Zeichen gekürzt (Länge laut Spezifikation)'))
    assert.ok(texte.some(t => /1 BelegNr\. nicht rein numerisch/.test(t)))
  })

  test('Prüfbericht in Spezifikationsreihenfolge mit fehlenden Blättern; Mappe: Prüfbericht vorne, nur geladene Blätter', () => {
    const erg = s.BKI_BLAETTER.map(b => b.meldung === 'bki-lagerbewegungen'
      ? { blatt: b, daten: { spalten: SP, zeilen: [{ d: '2026-10-01', b: '1', e: 'WEIN', a: 'ERNTE', m: 1 }], warnungen: ['Ladehinweis'] }, hinweise: [] }
      : { blatt: b, daten: null, hinweise: b.meldung ? [{ blatt: b.blatt, art: 'fehler', text: 'kein Zugriff: x' }] : [] })
    const bericht = s.pruefbericht(erg)
    assert.deepEqual(bericht.filter(h => h.art === 'fehlt').map(h => h.blatt), ['Verkauf im Zeitraum', 'Einkauf im Zeitraum', 'TBS-Aufstellung'])   // RV seit KAN-46
    assert.ok(bericht.some(h => h.blatt === 'Lagerbewegungen' && h.text === '1 Zeile(n)'))
    assert.ok(bericht.some(h => h.blatt === 'Lagerbewegungen' && h.text === 'Ladehinweis'))
    const z = zipLesen(s.bkiMappe(erg, { betrieb: 'Testbetrieb', zeitraum: { von: '2026-08-01', bis: '2026-10-10', stichtag: '2026-10-10' } }))
    assert.match(z.get('xl/workbook.xml'), /<sheets><sheet name="Prüfbericht"[^>]*\/><sheet name="Lagerbewegungen"[^>]*\/><\/sheets>/)
    assert.match(z.get('xl/worksheets/sheet1.xml'), /folgt mit KAN-49/)
    assert.match(z.get('xl/worksheets/sheet1.xml'), /braucht eine Auswahl/)
  })

  test('Katalogblätter: Kürzel innerhalb der Längen, Buchungsarten nur BSM', () => {
    const q = kat.qualitaetsstufenZeilen(), e = kat.erzeugnisZeilen(), b = kat.buchungsartZeilen()
    assert.ok(q.length >= 17 && q.every(z => z.kuerzel.length <= 8))
    assert.ok(e.length >= 15 && e.every(z => z.kuerzel.length <= 8))
    assert.ok(b.length >= 17 && b.every(z => z.kuerzel.length <= 50))
    assert.ok(b.some(z => z.bezeichnung === 'eigene Ernte') && !b.some(z => /intern/i.test(z.bezeichnung)))
  })
})

describe('Verdrahtung', () => {
  test('Route liefert XLSX mit BKI-Dateinamen, Knopf versteht format="xlsx", Seite im Kellerbuch-Reiter', () => {
    const r = quelle('src/app/(dashboard)/meldungen/bki-schnittstelle/xlsx/route.ts')
    assert.match(r, /bericht: 'BKI-Schnittstelle', von: zeitraum\.von, bis: zeitraum\.bis/)
    assert.match(r, /headers: \{ \.\.\.kopf, 'Content-Type': XLSX_MIME \}/)
    const k = quelle('src/components/CsvExportKnopf.tsx')
    assert.match(k, /!typ\.startsWith\(xlsx \? XLSX_TYP : 'text\/csv'\)/)
    assert.match(quelle('src/app/(dashboard)/kellerbuch/bki-schnittstelle/page.tsx'), /<CsvExportKnopf href=\{`\/meldungen\/bki-schnittstelle\/xlsx\?\$\{qs\}`\} format="xlsx"/)
    assert.match(quelle('src/app/(dashboard)/kellerbuch/_behoerden/LagerTabs.tsx'), /href: '\/kellerbuch\/bki-schnittstelle'/)
    assert.doesNotMatch(quelle('package.json'), /"xlsx"\s*:/, 'keine SheetJS-Abhängigkeit')
  })
})
