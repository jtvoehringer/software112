// KAN-109 (07.10.2026) – Rückverfolgung Weinkeller vorwärts: Rückruf-Liste je Los bis zum Abnehmer, über Umzüge und
// Verschnitte. Entscheidung Jörgen 06.10.2026: alle Mitglieder des Betriebs dürfen die Liste sehen.
//
// Aufruf:  npm run -s test:csv   (alle scripts/tests/*.test.mjs)

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { hooksRegistrieren, laden, nurMitHooks } from './buchung-attrappe.mjs'

hooksRegistrieren()
const quelle = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const r = () => laden('lib/behoerden/rueckruf.ts')

describe('KAN-109: Vorwärtsgraph', nurMitHooks, () => {
  test('folgt Umzügen und Verschnitten, auch über mehrere Stufen, ohne Schleifen', async () => {
    const { folgeChargen } = await r()
    const k = [{ von: 'A', nach: 'B' }, { von: 'B', nach: 'C' }, { von: 'X', nach: 'C' }, { von: 'C', nach: 'A' }]
    assert.deepEqual([...folgeChargen(['A'], k)].sort(), ['A', 'B', 'C'])
    assert.deepEqual([...folgeChargen(['X'], k)].sort(), ['A', 'B', 'C', 'X'])
    assert.deepEqual([...folgeChargen(['Z'], k)], ['Z'])
  })
})

describe('KAN-109: Abnehmer und Rückruf-Zeilen', nurMitHooks, () => {
  test('Abnehmer: Firma vor Kontakt, Adresse, Betriebsnummer; Barverkauf ohne Kunde = null', async () => {
    const { abnehmerAus } = await r()
    assert.deepEqual(abnehmerAus({ firma: { name: 'Vinothek Huber', strasse: 'Hauptstr. 1', plz: '2500', ort: 'Baden', land: 'AT', betrieb_nr: '1234567' } }),
      { name: 'Vinothek Huber', adresse: 'Hauptstr. 1, 2500 Baden', betriebNr: '1234567' })
    assert.deepEqual(abnehmerAus({ kontakt: { vorname: 'Anna', nachname: 'Berger', plz: '80331', ort: 'München', land: 'DE' } }),
      { name: 'Anna Berger', adresse: '80331 München, DE', betriebNr: null })
    assert.equal(abnehmerAus({ kontakt: null, firma: null }), null)
  })
  test('Zeilen je Abgang, Endverbraucher summiert, Tankverkauf, Export; Abgleich mit Differenz', async () => {
    const { rueckrufZeilen } = await r()
    const fuellungen = [{ id: 'F1', name: 'GV Kellerberg 2025', chargennummer: 'L-2026-001', anzahl_flaschen: 600, bestand_flaschen: 500 }]
    const chargen = new Map([['C1', { id: 'C1', name: 'GV Tank', chargennummer: null }]])
    const kunde = { datum: '2026-09-10', rechnungsnummer: 'R-1', firma: { name: 'Vinothek Huber', ort: 'Baden' } }
    const bar = (d) => ({ datum: d, rechnungsnummer: null, kontakt: null, firma: null })
    const v = [
      { fuellungId: 'F1', weinausbauId: null, menge: 60, einheit: 'Fl', posten: kunde },
      { fuellungId: 'F1', weinausbauId: null, menge: 6, einheit: 'Fl', posten: bar('2026-09-01') },
      { fuellungId: 'F1', weinausbauId: null, menge: 12, einheit: 'Fl', posten: bar('2026-09-15') },
      { fuellungId: null, weinausbauId: 'C1', menge: 300, einheit: 'L', posten: { datum: '2026-09-20', rechnungsnummer: 'R-2', kontakt: { vorname: 'Max', nachname: 'Muster' } } },
    ]
    const ex = [{ fuellungId: 'F1', menge: 12, einheit: 'Fl', auftrag: { datum: '2026-09-25', referenz: 'EX-1', firma: { name: 'Wine Import GmbH', ort: 'Berlin', land: 'DE' } } }]
    const { zeilen, abgleich } = rueckrufZeilen(fuellungen, chargen, v, ex)
    assert.deepEqual(zeilen.map(z => [z.art, z.abnehmer, z.menge]), [
      ['Tankverkauf', 'Max Muster', 300],                              // ohne Los zuerst
      ['Endverbraucher (summiert)', 'Endverbraucher', 18],
      ['Verkauf', 'Vinothek Huber', 60],
      ['Export', 'Wine Import GmbH', 12],
    ])
    assert.equal(zeilen.find(z => z.art === 'Endverbraucher (summiert)').datum, '2026-09-01 – 2026-09-15')
    assert.deepEqual(abgleich[0], { fuellungId: 'F1', los: 'L-2026-001', produkt: 'GV Kellerberg 2025', abgefuellt: 600, verkauft: 78, exportiert: 12, bestand: 500, differenz: 10 })
  })
})

describe('KAN-109: Verdrahtung', () => {
  test('Lader: nicht stornierte Umzüge, Verschnitte, Verkäufe, Exporte; Blöcke und alle()', () => {
    const s = quelle('src/lib/behoerden/rueckruf.ts')
    assert.match(s, /from\(t\) as any\)/)
    assert.match(s, /'keller_umzuege'\)\.select\([^)]*\)\s*\.eq\('tenant_id', tenantId\)\.is\('storniert_am', null\)/)
    assert.match(s, /\.is\('verschneidung\.storniert_am', null\)/)
    assert.match(s, /\.eq\('verkaufsposten\.storniert', false\)/)
    assert.match(s, /\.is\('auftrag\.storniert_am', null\)/)
    // jede .in()-Liste aus Daten läuft in Blöcken (inBloecken), jede Abfrage seitenweise mit .order('id')
    assert.equal((s.match(/\.in\(/g) ?? []).length, (s.match(/inBloecken</g) ?? []).length)
  })
  test('Meldung „rueckverfolgung-vorwaerts“ für alle Mitglieder, Seite und Einstiege', async () => {
    const k = quelle('src/lib/behoerden/katalog/kellerbuch.ts')
    assert.match(k, /'rueckverfolgung-vorwaerts': \{[\s\S]{0,200}zugriff: 'mitglied'/)
    assert.match(quelle('src/lib/behoerden/register/kellerbuch.ts'), /'rueckverfolgung-vorwaerts': definiereMeldung/)
    const p = quelle('src/app/(dashboard)/kellerbuch/rueckverfolgung/vorwaerts/page.tsx')
    assert.match(p, /^\/\/ behoerdenmeldung: rueckverfolgung-vorwaerts/)
    assert.match(p, /csvPfad\('rueckverfolgung-vorwaerts', csvParam\)/)
    assert.match(quelle('src/app/(dashboard)/kellerbuch/rueckverfolgung/page.tsx'), /\/kellerbuch\/rueckverfolgung\/vorwaerts/)
    assert.match(quelle('src/app/(dashboard)/weinhandel/fuellungen/[id]/edit/page.tsx'), /\/kellerbuch\/rueckverfolgung\/vorwaerts\?fuellung=\$\{id\}/)
  })
})
