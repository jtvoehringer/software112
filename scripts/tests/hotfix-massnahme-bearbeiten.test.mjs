// Hotfix (KAN-280, 10.10.2026): „Maßnahme bearbeiten“ – geladen() umschloss nach dem Umbau in Sweep 88 nur den Anfang
// der Abfragekette (Kommentarzeile davor); .or()/.order() hingen am Ergebnis-Array → Laufzeitfehler beim Öffnen der Seite.
// Regressionstest: geladen() schließt nach der ganzen Kette, keine Builder-Methode hängt am Ergebnis.
//
// Aufruf:  npm run -s test:csv

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const p = readFileSync(new URL('../../src/app/(dashboard)/behandlungen/[id]/edit/page.tsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n')

test('Maßnahme bearbeiten: Betriebsmittel-Abfrage vollständig in geladen()', () => {
  assert.match(p, /const rawBm = geladen\(await \(supabase\.from\('betriebsmittel'\) as any\)\n[\s\S]{0,400}\.order\('name'\), 'Betriebsmittel'\)/)
  assert.doesNotMatch(p, /, 'Betriebsmittel'\)\n(\s*\/\/[^\n]*\n)*\s*\.(or|order)\(/)
})
