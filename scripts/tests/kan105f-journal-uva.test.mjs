// KAN-105 Teil B (5) (08.10.2026) – Rechnungsjournal: Export-Rechnungen als eigener Nummernkreis, Link je Zeile zur
// Rechnung bzw. zum Exportauftrag (vorher zeigte er mit der Rechnungs-id auf /weinhandel/verkauf/… ins Leere).
// UVA: Doppik-Vorschau nach Rechnungsdatum, E&A nach Zahlung (DB-Funktion berechne_ea_uva, DB-Test 71).
// Rechenlogik des Journals: buchhaltung.test.mjs.
//
// Aufruf:  npm run -s test:csv   (alle scripts/tests/*.test.mjs)

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const quelle = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')

describe('KAN-105 Teil B (5): Rechnungsjournal und UVA', () => {
  test('Journal-Seite: Link aus der Zeile, Kennzeichen Export', () => {
    const s = quelle('src/app/(dashboard)/buchhaltung/rechnungsjournal/page.tsx')
    assert.match(s, /\{z\.rechnungsnummer && z\.href \? <Link href=\{z\.href\}/)
    assert.doesNotMatch(s, /\/weinhandel\/verkauf\/\$\{z\.id\}/)
    assert.match(s, /\{z\.quelle === 'export' && <span/)
  })
  test('Journal-Ladefunktion: nur Exportaufträge mit ausgestellter Exportrechnung, Rechnungen mit Link', () => {
    const j = quelle('src/lib/behoerden/rechnungsausgang.ts')
    assert.match(j, /\.eq\('export_dokumente\.dokument_art', 'rechnung'\)\n\s+\.eq\('export_dokumente\.status', 'ausgestellt'\)/)
    assert.match(j, /export_dokumente!inner\(dokument_art, status\)/)
    assert.match(j, /href: `\/weinhandel\/rechnungen\/\$\{r\.id\}`/)
  })
  test('UVA: Hinweise nennen die Basis (Doppik Rechnungsdatum, E&A Zahlungseingang)', () => {
    const u = quelle('src/lib/behoerden/uva.ts')
    assert.match(u, /Umsätze aus den Rechnungen nach Rechnungsdatum, Vorsteuer aus den erfassten Belegen/)
    const p = quelle('src/app/(dashboard)/buchhaltung/uva/page.tsx')
    assert.match(p, /'Umsätze nach Rechnungsdatum \(Rechnungen\), Vorsteuer aus den Belegen\.'/)
    assert.match(p, /'Umsätze aus Verkäufen nach Zahlungseingang \(Ist-Versteuerung\), je Zahlung am Zahlungstag\.'/)
  })
})
