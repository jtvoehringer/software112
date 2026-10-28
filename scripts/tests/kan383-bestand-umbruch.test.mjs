// KAN-383 (UAT 28.10.2026) – Warenlager: „Bestand / Gesamt“ bricht bei fünfstelligen Zahlen nicht mehr in zwei Zeilen um.
//
// Aufruf:  npm run -s test:csv   (alle scripts/tests/*.test.mjs)

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const quelle = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')

test('Warenlager: Bestandszelle mit whitespace-nowrap', () => {
  const s = quelle('src/app/(dashboard)/weinhandel/page.tsx')
  assert.match(s, /<td className="px-4 py-3 text-right whitespace-nowrap">\n\s+<span className=\{`font-semibold tabular-nums \$\{bestandClr\}`\}>\{fmtNum\(bestand\)\}<\/span>\n\s+<span className="text-xs text-s112-muted ml-1">\/ \{fmtNum\(gesamt\)\}<\/span>/)
})
