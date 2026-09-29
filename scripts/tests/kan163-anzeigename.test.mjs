// KAN-163 (29.09.2026) – Kopfleiste zeigt bei leerem Anzeigenamen den Betriebsnamen statt „software:112“
//
// Aufruf:  npm run -s test:csv   (alle scripts/tests/*.test.mjs)
//
// Anlass: Bei Spaetrot Gebeshuber war tenant_einstellungen.anzeigename leer (NULL). „Mein Betrieb“ belegt
// das Feld mit tenants.name vor, die Kopfleiste fiel aber auf DEFAULT_BRANDING („software:112“) zurück.
// Quelltext-Prüfung, weil das Layout eine async Server Component mit Supabase-Zugriff ist; die
// Fallback-Regel selbst steckt in betriebsName() (src/lib/tenant/kopf.ts).

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const quelle = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')

describe('KAN-163: Anzeigename in der Kopfleiste', () => {
  const layout = quelle('src/app/(dashboard)/layout.tsx')
  const kopf = quelle('src/lib/tenant/kopf.ts')

  test('Branding nimmt den Namen aus betriebsName() (Anzeigename, sonst tenants.name)', () => {
    assert.match(layout, /seitenBetriebName = betriebsName\(kopf\)/)
    assert.match(layout, /anzeigename:\s+seitenBetriebName \|\| DEFAULT_BRANDING\.anzeigename/)
    assert.doesNotMatch(layout, /anzeigename:\s+d\.anzeigename \?\? DEFAULT_BRANDING\.anzeigename/)
  })

  test('ohne tenant_einstellungen-Zeile ebenfalls der Betriebsname', () => {
    assert.match(layout, /else if \(tenantRow\) \{\s*(\/\/[^\n]*\n\s*)?branding = \{ \.\.\.branding, anzeigename: seitenBetriebName \}/)
  })

  test('betriebsName(): leerer oder nur aus Leerzeichen bestehender Anzeigename fällt auf tenants.name zurück', () => {
    assert.match(kopf, /\(typeof anzeige === 'string' && anzeige\.trim\(\)\) \|\| kopf\.tenant\?\.name \|\| 'Betrieb'/)
  })
})
