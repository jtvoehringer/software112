// KAN-105 Teil B (3) (08.10.2026) – Suche und CRM: Verkäufe auch über die Lieferscheinnummer, Rechnungen (Sammel- und
// stornierte Rechnungen) als eigener Treffer; CRM zeigt nicht berechnete Lieferscheine mit ihrer LS-Nummer.
//
// Aufruf:  npm run -s test:csv   (alle scripts/tests/*.test.mjs)

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const quelle = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')

describe('KAN-105 Teil B (3): Suche und CRM', () => {
  test('globale Suche: Rechnungs- oder Lieferscheinnummer; Rechnungen ohne Doppel zum Lieferschein', () => {
    const g = quelle('src/app/api/global-search/route.ts')
    assert.match(g, /\.or\(`rechnungsnummer\.ilike\.%\$\{q\}%,lieferscheinnummer\.ilike\.%\$\{q\}%`\)/)
    assert.match(g, /supabase\.from\('rechnungen'\) as any\)\n\s+\.select\('id, rechnungsnummer, datum, bezahlt, storniert, art'\)\n\s+\.ilike\('rechnungsnummer', `%\$\{q\}%`\)\n\s+\.eq\('tenant_id', tenantId\)/)
    assert.match(g, /\.filter\(\(r: R\) => !gefundeneNummern\.has\(String\(r\.rechnungsnummer\)\)\)/)
    assert.match(g, /href:       `\/weinhandel\/rechnungen\/\$\{r\.id\}`/)
  })
  test('CRM Kontakt und Firma: nicht berechnet mit LS-Nummer', () => {
    for (const p of ['src/app/(dashboard)/crm/kontakte/[id]/page.tsx', 'src/app/(dashboard)/crm/firmen/[id]/page.tsx']) {
      const s = quelle(p)
      assert.match(s, /id, datum, rechnungsnummer, lieferscheinnummer, transaktions_nr, storniert, bezahlt,/, p)
      assert.match(s, /rechnungsnummer: v\.rechnungsnummer \?\? \(v\.lieferscheinnummer \? `\$\{v\.lieferscheinnummer\} \(nicht berechnet\)` : null\),/, p)
    }
  })
})
