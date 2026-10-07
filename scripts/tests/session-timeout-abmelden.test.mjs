// Bugfix 07.10.2026 (Meldung Jörgen): Im Dialog „Sitzung läuft ab“ blieb die Sitzung nach Klick auf „Abmelden“ aktiv.
// Ursache: ein window-mousedown zählte als Aktivität und setzte den Timer zurück (Dialog weg), bevor der Klick den Knopf
// erreichte. Regression: solange die Warnung offen ist, setzen Aktivitäts-Ereignisse nichts zurück; „Abmelden“ meldet ab
// und lädt neu.
//
// Aufruf:  npm run -s test:csv   (alle scripts/tests/*.test.mjs)

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const s = readFileSync(new URL('../../src/components/SessionTimeout.tsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n')

test('Aktivitäts-Ereignisse setzen den Timer bei offener Warnung nicht zurück', () => {
  assert.match(s, /const aktivitaet = useCallback\(\(\) => \{\n\s+if \(!warnungRef\.current\) reset\(\)/)
  assert.match(s, /events\.forEach\(e => window\.addEventListener\(e, aktivitaet, \{ passive: true \}\)\)/)
  assert.doesNotMatch(s, /window\.addEventListener\(e, reset/)
  assert.match(s, /setTimeout\(\(\) => \{ warnungRef\.current = true; setWarnung\(true\) \}, ms - WARN_BEFORE\)/)
})

test('„Abmelden“ ruft abmelden direkt auf und lädt danach neu; „Aktiv bleiben“ setzt zurück', () => {
  assert.match(s, /<button onClick=\{abmelden\}/)
  assert.match(s, /<button onClick=\{reset\}/)
  assert.match(s, /await s\.auth\.signOut\(\)\n\s+router\.push\('\/login\?grund=timeout'\)\n\s+router\.refresh\(\)/)
})
