// KAN-309 (10.10.2026): Befunde aus dem ersten vollständigen E2E-Lauf gegen Staging – Regressionstests.
//
// Aufruf:  npm run -s test:csv

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const lies = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')

test('Nachrichten: keine verbundene Mailbox ist ein Zustand (200 + nichtVerbunden), kein HTTP 400', () => {
  const route = lies('src/app/api/nachrichten/list/route.ts')
  assert.match(route, /return NextResponse\.json\(\{ nichtVerbunden: true, messages: \[\] \}\)/)
  assert.doesNotMatch(route, /Kein E-Mail-Modul konfiguriert' \}, \{ status: 400 \}/)
  const seite = lies('src/app/(dashboard)/nachrichten/NachrichtenClient.tsx')
  // Verbindungsprüfung zeigt „Mailbox verbinden“ ohne Fehlermeldung, die Listen laden ohne Fehler
  assert.match(seite, /if \(r\.ok && data\.nichtVerbunden\) \{ setVerbunden\(false\); return \}\n\s+if \(!r\.ok \|\| data\.fehler\)/)
  assert.equal(seite.split('if (res.ok && data.nichtVerbunden) return').length - 1, 2)
})

test('Behandlungsprotokoll: Titel ist die Hauptüberschrift (h1)', () => {
  assert.match(lies('src/app/(dashboard)/reports/(pflicht)/behandlungsprotokoll/page.tsx'),
    /<h1 className="text-lg font-semibold text-s112-text">Weinbauliches Behandlungsprotokoll<\/h1>/)
})

test('E2E CRM: wartet, bis auch „Wird gespeichert…“ verschwunden ist (sonst bricht die Server Action ab)', () => {
  assert.match(lies('e2e/crm-kontakt.spec.ts'), /getByRole\('button', \{ name: \/\^\(Anlegen\|Wird gespeichert…\)\$\/ \}\)\)\.toHaveCount\(0/)
})
