// Sweep 115 (10.10.2026): Seitentitel – eigener Titel je Seite, Markenname nur einmal.
// Befund: Das Root-Layout hängt per title.template „| software:112“ an; 121 Seiten schrieben selbst „– software:112“ –
// der Tab hieß „Jetzt registrieren – software:112 | software:112“ (live an /signup). 36 Seiten hatten keinen eigenen
// Titel (Tab nur „software:112“). Wächter scripts/check-titel.js (prebuild), E2E-Smoke prüft den Titel jeder Seite.
//
// Aufruf:  npm run -s test:csv

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const HIER = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(HIER, '..', '..')
const require = createRequire(import.meta.url)
const { pruefe, hatTitel, markeImTitel } = require(path.join(HIER, '..', 'check-titel.js'))
const lies = (p) => readFileSync(path.join(ROOT, p), 'utf8')

describe('Sweep 115: Seitentitel', () => {
  test('Root-Layout hängt den Markennamen per Vorlage an', () => {
    assert.match(lies('src/app/layout.tsx'), /template: '%s \| software:112'/)
  })

  test('Regression: Registrierung, Rechnung, Behandlungsprotokoll ohne eigenen Markennamen im Titel', () => {
    assert.match(lies('src/app/signup/page.tsx'), /title: 'Jetzt registrieren' \}/)
    assert.match(lies('src/app/(dashboard)/weinhandel/rechnungen/[id]/page.tsx'), /title: 'Rechnung' \}/)
    assert.doesNotMatch(lies('src/app/(dashboard)/reports/(pflicht)/behandlungsprotokoll/page.tsx'), /title: '[^']*software:112/)
  })

  test('Regression: Seiten ohne Titel haben jetzt einen (Server-Seite direkt, Client-Seite über layout.tsx)', () => {
    assert.match(lies('src/app/(dashboard)/buchhaltung/page.tsx'), /export const metadata: Metadata = \{ title: 'E&A-Rechnung' \}/)
    assert.match(lies('src/app/(dashboard)/hilfe/faq/layout.tsx'), /export const metadata: Metadata = \{ title: 'Häufige Fragen \(FAQ\)' \}/)
    assert.match(lies('src/app/(dashboard)/controlling/kostenrechnung/layout.tsx'), /title: 'Kostenrechnung'[\s\S]*requireModul\('modul_controlling'\)/)
    assert.match(lies('src/app/(auth)/login/layout.tsx'), /title: 'Anmelden'/)
  })

  test('hatTitel und markeImTitel', () => {
    assert.equal(hatTitel("export const metadata: Metadata = { title: 'X' }", null), true)
    assert.equal(hatTitel('export async function generateMetadata() { return {} }', null), true)
    assert.equal(hatTitel("'use client'\nexport default function P() {}", "export const metadata = { title: 'X' }"), true)
    assert.equal(hatTitel("'use client'\nexport default function P() {}", null), false)
    assert.deepEqual(markeImTitel("export const metadata = { title: 'Rechnung – software:112' }\nconst a = 'software:112'"), [1])
    assert.deepEqual(markeImTitel("// titel-ausnahme: öffentliche Seite ohne Vorlage hier\nexport const metadata = { title: { absolute: 'software:112' } }"), [])
  })

  test('Wächter an Beispielseiten: ohne Titel, Client-Seite mit Layout, Weiterleitung, Marke im Titel', () => {
    const w = mkdtempSync(path.join(tmpdir(), 's115-'))
    const app = path.join(w, 'src', 'app')
    for (const d of ['ohne', 'mit', 'client', 'weiter', 'marke']) mkdirSync(path.join(app, d), { recursive: true })
    writeFileSync(path.join(app, 'layout.tsx'), "export const metadata = { title: { default: 'software:112', template: '%s | software:112' } }")
    writeFileSync(path.join(app, 'ohne', 'page.tsx'), 'export default function P() { return <h1>x</h1> }')
    writeFileSync(path.join(app, 'mit', 'page.tsx'), "export const metadata = { title: 'Mit' }\nexport default function P() { return <h1>x</h1> }")
    writeFileSync(path.join(app, 'client', 'page.tsx'), "'use client'\nexport default function P() { return <h1>x</h1> }")
    writeFileSync(path.join(app, 'client', 'layout.tsx'), "export const metadata = { title: 'Client' }\nexport default function L({ children }) { return children }")
    writeFileSync(path.join(app, 'weiter', 'page.tsx'), "import { redirect } from 'next/navigation'\nexport default function P() { redirect('/mit') }")
    writeFileSync(path.join(app, 'marke', 'page.tsx'), "export const metadata = { title: 'Marke – software:112' }\nexport default function P() { return <h1>x</h1> }")
    const r = pruefe(w)
    assert.equal(r.seiten, 4)
    assert.deepEqual(r.ohneTitel, ['src/app/ohne/page.tsx'])
    assert.deepEqual(r.marke, ['src/app/marke/page.tsx:1'])
  })

  test('echter Quellbaum sauber, Wächter im prebuild, E2E-Smoke prüft den Titel', () => {
    const r = pruefe(ROOT)
    assert.deepEqual([r.ohneTitel, r.marke], [[], []])
    assert.match(JSON.parse(lies('package.json')).scripts.prebuild, /node scripts\/check-titel\.js/)
    assert.match(lies('e2e/smoke.spec.ts'), /not\.toMatch\(\/software:112\.\*software:112\/\)/)
  })
})
