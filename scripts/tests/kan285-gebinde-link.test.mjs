// KAN-285 (10.10.2026, Wunsch Jörgen): Kellerbuch-Übersicht – der Gebindename (z. B. „Barrique 1“) führt zu den
// Bewegungen des Gebindes und ersetzt den Knopf „Bewegungen →“; belegte und leere Gebinde, der Stift bleibt.
//
// Aufruf:  npm run -s test:csv

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const p = readFileSync(new URL('../../src/app/(dashboard)/kellerbuch/page.tsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n')

test('Gebindename verlinkt auf die Bewegungen (belegt und leer), kein Knopf „Bewegungen →“ mehr', () => {
  const links = p.match(/<Link href=\{`\/kellerbuch\/behaelter\/\$\{b\.id\}\/bewegungen`\} title=\{`\$\{b\.name\} – Bewegungen`\}[^>]*>\{b\.name\}<\/Link>/g) ?? []
  assert.equal(links.length, 2)
  assert.doesNotMatch(p, />Bewegungen →<\/Link>/)
  assert.equal((p.match(/aria-label="Bearbeiten"/g) ?? []).length, 2, 'Stift zum Bearbeiten bleibt')
})
