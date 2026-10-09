// Sweep 82 (09.10.2026): Ladezustände in Client-Komponenten immer zurücksetzen, fetch-Antworten nie verwerfen.
// Befunde: 28 Stellen setX(true) … await … ohne try/finally (Login, Passwort, Zwei-Faktor, Abo/Zahlung, E-Mail-Client,
// CRM …) – bei Netzwerk- oder Serverfehler blieb der Knopf gesperrt. Stille Fehler: CRM-Antwort-Mail löschte den Text
// und schloss das Fenster auch wenn das Senden scheiterte; CRM-Notiz zeigte bei einem Fehler nichts; „überwachte
// Mailbox speichern“ und „Trennen“ luden die Seite auch bei einem Fehler neu.
// Hier: der Wächter scripts/check-laden.js und die Verdrahtung der reparierten Stellen.
//
// Aufruf:  npm run -s test:csv

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const HIER = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(HIER, '..', '..')
const require = createRequire(import.meta.url)
const { pruefeText, pruefeWurzel } = require(path.join(HIER, '..', 'check-laden.js'))
const quelle = p => readFileSync(path.join(ROOT, p), 'utf8')
const C = "'use client'\n"
const funde = t => pruefeText(C + t).funde.map(f => f.text)

describe('check-laden: Erkennung', () => {
  test('Ladezustand vor await ohne try/finally → Fund', () => {
    assert.equal(funde('async function f() {\n  setSaving(true)\n  await speichern()\n  setSaving(false)\n}\n').length, 1)
    assert.equal(funde('const g = async () => { setNotizLaden(true); await x(); setNotizLaden(false) }\n').length, 1)
  })
  test('kein Fund: try/finally, startTransition, kein await, kein Ladezustand, Server-Datei', () => {
    assert.equal(funde('async function f() {\n  setSaving(true)\n  try { await speichern() } finally { setSaving(false) }\n}\n').length, 0)
    assert.equal(funde('function f() {\n  setLogoUploading(true)\n  startTransition(async () => { await up(); setLogoUploading(false) })\n}\n').length, 0)
    assert.equal(funde('function f() { setSaving(true); setOffen(false) }\n').length, 0)
    assert.equal(funde('async function f() { setOffen(true); await x() }\n').length, 0)
    assert.equal(pruefeText('async function f() { setSaving(true); await x() }\n').funde.length, 0, 'ohne use client')
  })
  test('verworfene fetch-Antwort → Fund; ausgewertete Antwort und Begründung → kein Fund', () => {
    assert.equal(funde("async function f() {\n  await fetch('/api/x', { method: 'POST' })\n}\n").length, 1)
    assert.equal(funde("async function f() {\n  const res = await fetch('/api/x')\n  if (!res.ok) return\n}\n").length, 0)
    assert.equal(funde("async function f() {\n  // laden-ok: Nebensache, scheitert still und kommt wieder\n  await fetch('/api/x')\n}\n").length, 0)
    assert.equal(funde("async function f() {\n  // laden-ok: kurz\n  await fetch('/api/x')\n}\n").length, 1)
  })
  test('ganzes Projekt ohne Fund', () => {
    assert.deepEqual(pruefeWurzel(ROOT).funde, [])
  })
})

describe('reparierte Stellen', () => {
  for (const [p, art] of [['src/app/(dashboard)/crm/firmen/[id]/FirmaDetailClient.tsx', 'Firma'], ['src/app/(dashboard)/crm/kontakte/[id]/KontaktDetailClient.tsx', 'Kontakt']]) {
    test(`CRM ${art}: Antwort-Mail prüft die Antwort und behält den Text bei einem Fehler`, () => {
      const s = quelle(p)
      assert.match(s, /const res = await fetch\('\/api\/email\/unified'/)
      assert.match(s, /if \(!res\.ok \|\| d\.fehler\) \{ setReplyFehler\([^)]*\); return \}\s*\n\s*setReplyOpen\(false\); setReplyText\(''\)/)
      assert.match(s, /\{replyFehler && <p role="alert"/)
    })
    test(`CRM ${art}: Notiz zeigt Fehler und behält den Text`, () => {
      const s = quelle(p)
      assert.match(s, /await createAktivitaet\(fd\)\s*\n\s*setNotizText\(''\)\s*\n\s*\} catch \(e\) \{\s*\n\s*setNotizFehler\(fehlerText\(e\)\)/)
      assert.match(s, /\} finally \{\s*\n\s*setNotizLaden\(false\)/)
      assert.match(s, /\{notizFehler && <p role="alert"/)
    })
  }
  test('E-Mail-Client: Mailbox speichern und Trennen laden nur nach Erfolg neu', () => {
    const s = quelle('src/app/(dashboard)/nachrichten/NachrichtenClient.tsx')
    assert.equal((s.match(/const res = await fetch\('\/api\/nachrichten\/monitored'/g) ?? []).length, 2)
    assert.equal((s.match(/const res = await fetch\('\/api\/nachrichten\/disconnect'/g) ?? []).length, 2)
    assert.equal((s.match(/setFehler\(`Mailbox konnte nicht gespeichert werden/g) ?? []).length, 2)
    assert.match(s, /\} finally \{\s*\n\s*setDetailLaden\(false\)/)
  })
})
