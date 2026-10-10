// Sweep 91 (KAN-283, 10.10.2026): Abfragen in Client-Komponenten werten ihren Fehler aus.
// Befund: Behandlungen eines Gebindes (Client-Seite) zeigten bei einem Lesefehler eine leere Liste; ohne Prüfnummern
// erschienen gesperrte Behandlungen als bearbeitbar. Release-Notes-Verwaltung „keine Neuerungen“, Zwei-Faktor-Seite
// ohne Auswertung der Sitzungsstufe. Der Wächter prüft jetzt auch 'use client'-Dateien und src/components.
//
// Aufruf:  npm run -s test:csv

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const HIER = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(HIER, '..', '..')
const require = createRequire(import.meta.url)
const { pruefeWurzel } = require(path.join(HIER, '..', 'check-einzelabfrage.js'))
const quelle = p => readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n')
const BH = 'src/app/(dashboard)/kellerbuch/behaelter/[id]/behandlungen/page.tsx'

describe('KAN-283: Client-Komponenten', () => {
  test('Projekt sauber – auch Client-Dateien und src/components', () => {
    const e = pruefeWurzel(ROOT)
    assert.deepEqual(e.funde, [])
    assert.ok(e.dateien > 800, `${e.dateien} Dateien geprüft`)
  })

  test('Behandlungen eines Gebindes: Lesefehler sichtbar, Bearbeiten ohne Prüfnummern gesperrt', () => {
    const p = quelle(BH)
    assert.match(p, /const ladeErr = bhErr \?\? bhDataErr \?\? typenErr \?\? behandlungenErr \?\? stoffeErr\n\s*if \(ladeErr\) \{\n\s*setLadeFehler\(/)
    assert.match(p, /if \(pnErr\) setLadeFehler\(/)
    assert.match(p, /setFormGesperrt\(!!ladeFehler \|\| behandlungPnGesperrt\(/)
    assert.match(p, /\{ladeFehler && <p role="alert"/)
    assert.match(p, /error: r\.error \?\? null \}\)\)/, 'Fehler der RPC lade_behaelter wird durchgereicht')
  })

  test('Release Notes und Zwei-Faktor werten den Fehler aus', () => {
    assert.match(quelle('src/app/(dashboard)/admin/release-notes/ReleaseNotesAdminClient.tsx'), /if \(error\) \{ setMeldung\(`Fehler: Neuerungen konnten nicht geladen werden/)
    assert.match(quelle('src/app/zwei-faktor/page.tsx'), /if \(error \|\| aalErr\) \{ setFehler\(/)
  })
})
