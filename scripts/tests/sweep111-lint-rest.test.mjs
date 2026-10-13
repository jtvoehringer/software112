// Sweep 111 (10.10.2026): Lint-Warnungen außer no-explicit-any abgebaut.
// Echte Mängel: „Abbrechen“ in Neue Lese und Lage bearbeiten lud als <a href> die ganze App neu (jetzt Link);
// SessionTimeout hielt eine Konstante im Komponentenkörper (jetzt Modulebene). Gewollte Stellen (Laden beim Öffnen,
// hartes Neuladen bei Abmelden/Betriebswechsel/Abstufung, Kamerabild als data:-URL) tragen eine Begründung.
// Ausgangswerte react-hooks/exhaustive-deps, @next/next/no-location-assign-relative-destination, no-html-link-for-pages
// und no-img-element stehen auf 0 – jede neue Warnung dieser Regeln fällt sofort auf.
//
// Aufruf:  npm run -s test:csv

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const quelle = d => readFileSync(new URL(`../../${d}`, import.meta.url), 'utf8')

test('Ausgangswerte der bereinigten Regeln stehen auf 0', () => {
  const b = JSON.parse(quelle('scripts/eslint-baseline.json'))
  const regeln = b.regeln ?? b
  for (const r of ['react-hooks/exhaustive-deps', '@next/next/no-location-assign-relative-destination', '@next/next/no-html-link-for-pages', '@next/next/no-img-element'])
    assert.ok(!(r in regeln) || regeln[r] === 0, `${r}: ${regeln[r]}`)
})

test('Abbrechen navigiert ohne Neuladen; Konstante auf Modulebene', () => {
  // KAN-333: AbbrechenKnopf (router.push, ohne Neuladen) führt dorthin, woher man kam – Standard ist die Liste
  assert.match(quelle('src/app/(dashboard)/erntemeldung/neu/NeueLeseForm.tsx'), /<AbbrechenKnopf standard="\/erntemeldung"/)
  assert.match(quelle('src/app/(dashboard)/lagen/[id]/page.tsx'), /<AbbrechenKnopf standard="\/lagen"/)
  assert.match(quelle('src/components/navigation/Abbrechen.tsx'), /router\.push\(zurueckZiel\(standard\)\)/)
  assert.match(quelle('src/components/SessionTimeout.tsx'), /^const WARN_BEFORE = /m)
})

test('jede eslint-disable-Zeile der gewollten Stellen nennt einen Grund', () => {
  for (const d of ['src/components/CommandPalette.tsx', 'src/components/kellerbuch/UmziehenWidget.tsx', 'src/app/(dashboard)/crm/kontakte/visitkarte/page.tsx'])
    for (const z of quelle(d).split('\n').filter(l => /eslint-disable-next-line @next\//.test(l)))
      assert.match(z, / -- \S.{14,}/, `${d}: ${z.trim()}`)
})
