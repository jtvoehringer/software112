// KAN-105 Teil B (4) (08.10.2026) – Umsatz-Reports wahlweise nach Liefer- oder Rechnungsdatum: ?basis=rechnung liest
// Rechnungen (Rechnungsdatum, Positionen aller Lieferscheine, Sammelrechnung als ein Beleg), sonst Lieferscheine wie bisher.
//
// Aufruf:  npm run -s test:csv   (alle scripts/tests/*.test.mjs)

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
// @ts-expect-error TS5097 – node:test lädt die .ts-Datei direkt
import { umsatzBasis } from '../../src/lib/verkauf/umsatzBasis.ts'

const quelle = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')

describe('KAN-105 Teil B (4): Reports nach Liefer- oder Rechnungsdatum', () => {
  test('umsatzBasis: nur „rechnung“ schaltet um, alles andere bleibt Lieferdatum', () => {
    assert.equal(umsatzBasis('rechnung'), 'rechnung')
    assert.equal(umsatzBasis('lieferung'), 'lieferung')
    assert.equal(umsatzBasis(null), 'lieferung')
    assert.equal(umsatzBasis(undefined), 'lieferung')
    assert.equal(umsatzBasis('Rechnung'), 'lieferung')
  })
  test('Monatsumsatz: Rechnungen nach Rechnungsdatum, aktiv und nicht storniert, über alsBeleg', () => {
    const u = quelle('src/app/api/reports/umsatz/route.ts')
    assert.match(u, /const basis {7}= umsatzBasis\(req\.nextUrl\.searchParams\.get\('basis'\)\)/)
    assert.match(u, /\? await alle<R>\(supabase\.from\('rechnungen'\)\n\s+\.select\(`id, \$\{lieferscheineSelect\('preis_brutto, menge, rabatt_pct, sonderrabatt_pct'\)\}`\)\n\s+\.eq\('tenant_id', tenantId\)\n\s+\.eq\('aktiv', true\)\.eq\('storniert', false\)\n\s+\.gte\('datum', von\)\.lte\('datum', bis\)/)
    assert.match(u, /const posten = basis === 'rechnung' \? \(\(data \?\? \[\]\) as R\[\]\)\.map\(alsBeleg\)/)
    assert.match(u, /ladeMonat\(supabase, z, tenantId, basis\)/)
  })
  test('Detail: Rechnungen mit Link zur Rechnungsseite', () => {
    const d = quelle('src/app/api/reports/umsatz-detail/route.ts')
    assert.match(d, /if \(umsatzBasis\(req\.nextUrl\.searchParams\.get\('basis'\)\) === 'rechnung'\) \{/)
    assert.match(d, /\.from\('rechnungen'\) as any\)[\s\S]{0,400}\.eq\('tenant_id', tenantId\)\n\s+\.eq\('aktiv', true\)\.eq\('storniert', false\)/)
    assert.match(d, /href: `\/weinhandel\/rechnungen\/\$\{r\.id\}`/)
  })
  test('Reports-Seite: Umschalter, Basis in allen Abfragen, Link je Beleg', () => {
    const c = quelle('src/app/(dashboard)/reports/ReportsClient.tsx')
    assert.match(c, /useState<'lieferung' \| 'rechnung'>\('lieferung'\)/)
    assert.match(c, /\[\['lieferung', 'nach Lieferdatum'\], \['rechnung', 'nach Rechnungsdatum'\]\]/)
    assert.match(c, /&bis=\$\{bisMonat\}&basis=\$\{basis\}/)
    assert.match(c, /\$\{vergleichB\}&basis=\$\{basis\}/)
    assert.match(c, /umsatz-detail\?von=\$\{von\}&bis=\$\{bis\}&basis=\$\{umsatzBasis\}/)
    assert.match(c, /href=\{p\.href \?\? `\/weinhandel\/verkauf\/\$\{p\.id\}`\}/)
  })
})
