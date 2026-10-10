// Sweep 105 (10.10.2026): Symbol-Knöpfe und -Links haben einen Namen.
// Befund: check-a11y (SYMBOL_OHNE_NAME) prüfte per Textmuster nur <button> – durchgerutscht sind die Jahr-Pfeile im
// Anlagenverzeichnis (<Link> nur mit Chevron) und zwei Löschknöpfe der Kostenrechnung (onClick mit verschachteltem
// Template, an dem das Muster scheiterte). Vorleseprogramme sagten nur „Link“ bzw. „Schaltfläche“, beim Darüberfahren
// erschien kein Hinweis. Jetzt aria-label/title; die Regel arbeitet über den TypeScript-Syntaxbaum (button, a, Link).
//
// Aufruf:  npm run -s test:csv

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const HIER = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(HIER, '..', '..')
const require = createRequire(import.meta.url)
const { symbolOhneName } = require(path.join(HIER, '..', 'check-a11y.js'))
const tags = s => symbolOhneName(s).map(b => `${b.tag}:${b.symbol}`)

describe('SYMBOL_OHNE_NAME', () => {
  test('Knopf, Link und a nur mit Symbol → Fund (auch mit verschachteltem onClick-Template)', () => {
    assert.deepEqual(tags('<button onClick={() => { if (confirm(`"${x}" weg?`)) f() }}><Trash2 size={13} /></button>'), ['button:Trash2'])
    assert.deepEqual(tags('<Link href={`/a?jahr=${j}`}><ChevronLeft size={15} /></Link>'), ['Link:ChevronLeft'])
    assert.deepEqual(tags('<a href="/x"><X /></a>'), ['a:X'])
  })
  test('mit Namen, mit Text oder mit Spread → kein Fund', () => {
    assert.deepEqual(tags('<button aria-label="Löschen"><Trash2 /></button>'), [])
    assert.deepEqual(tags('<Link href="/x" title="Folgejahr"><ChevronRight /></Link>'), [])
    assert.deepEqual(tags('<button><Trash2 /> Löschen</button>'), [])
    assert.deepEqual(tags('<button {...p}><X /></button>'), [])
  })
})

describe('Projekt', () => {
  test('Jahr-Pfeile und Löschknöpfe haben Namen; Wächter grün', () => {
    const jw = readFileSync(path.join(ROOT, 'src/app/(dashboard)/buchhaltung/anlagen/JahrWaehler.tsx'), 'utf8')
    assert.match(jw, /aria-label="Vorjahr"/)
    assert.match(jw, /aria-label="Folgejahr"/)
    const kr = readFileSync(path.join(ROOT, 'src/app/(dashboard)/controlling/kostenrechnung/page.tsx'), 'utf8')
    assert.match(kr, /aria-label="Deaktivieren"/)
    assert.match(kr, /aria-label="Löschen"/)
    const aus = execFileSync(process.execPath, [path.join(ROOT, 'scripts/check-a11y.js')], { cwd: ROOT, encoding: 'utf8' })
    assert.match(aus, /keine Funde/)
  })
})
