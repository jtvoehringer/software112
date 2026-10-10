// Sweep 116 (10.10.2026): Klickflächen auch per Tastatur bedienbar (WCAG 2.1.1).
// Befund: 18 Klickflächen ohne <button>/<a> (Zeilen zum Auf-/Zuklappen bei Lagen und Rieden, sortierbare Spaltenköpfe,
// Kalendereinträge und freie Zeitslots im CRM, Thread-Karten in den Nachrichten, Grundstückszeilen …) reagierten nur auf
// die Maus – mit Tab nicht erreichbar, Enter wirkungslos; einen Termin im CRM-Kalender anlegen ging ohne Maus gar nicht.
// 13 jetzt mit tastaturBedienbar(), 5 Komfortflächen mit Link/Knopf/Checkbox darin begründet ausgenommen.
// Wächter: scripts/check-a11y.js Regel 4 KLICK_OHNE_TASTATUR (prebuild).
//
// Aufruf:  npm run -s test:csv

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { tastaturBedienbar } from '../../src/lib/ui/tastatur.ts'

const HIER = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(HIER, '..', '..')
const require = createRequire(import.meta.url)
const { klickOhneTastatur } = require(path.join(HIER, '..', 'check-a11y.js'))
const lies = (p) => readFileSync(path.join(ROOT, p), 'utf8')

/** Tastendruck auf das Element selbst (target === currentTarget) bzw. auf ein Kind */
function taste(props, key, aufKind = false) {
  const el = {}
  let verhindert = false
  props.onKeyDown({ key, target: aufKind ? {} : el, currentTarget: el, preventDefault: () => { verhindert = true } })
  return verhindert
}

describe('tastaturBedienbar', () => {
  test('Enter und Leertaste lösen aus, andere Tasten nicht; Rolle und Tabindex', () => {
    let n = 0
    const p = tastaturBedienbar(() => n++)
    assert.equal(p.role, 'button')
    assert.equal(p.tabIndex, 0)
    assert.equal(taste(p, 'Enter'), true)
    assert.equal(taste(p, ' '), true)
    assert.equal(taste(p, 'a'), false)
    assert.equal(n, 2)
  })
  test('Tastendruck in einem Kind (Link, Knopf) löst nicht aus; Zeilen ohne eigene Rolle', () => {
    let n = 0
    const p = tastaturBedienbar(() => n++, null)
    assert.equal('role' in p, false)
    taste(p, 'Enter', true)
    assert.equal(n, 0)
  })
})

describe('check-a11y KLICK_OHNE_TASTATUR', () => {
  const funde = (jsx) => klickOhneTastatur(`const x = (${jsx})`, 'x.tsx').map(f => f.tag)
  test('meldet onClick auf div/tr/th ohne Tastatur', () => {
    assert.deepEqual(funde('<div onClick={() => f()}>x</div>'), ['div'])
    assert.deepEqual(funde('<tr onClick={() => go()}><td>x</td></tr>'), ['tr'])
    assert.deepEqual(funde('<th onClick={() => sort()}>A</th>'), ['th'])
  })
  test('in Ordnung: tastaturBedienbar, onKeyDown, Knopf, Überlagerung, stopPropagation', () => {
    assert.deepEqual(funde('<div onClick={() => f()} {...tastaturBedienbar(() => f())}>x</div>'), [])
    assert.deepEqual(funde('<div onClick={() => f()} onKeyDown={k}>x</div>'), [])
    assert.deepEqual(funde('<button onClick={() => f()}>x</button>'), [])
    assert.deepEqual(funde('<div className="fixed inset-0 bg-black/40" onClick={close}>x</div>'), [])
    assert.deepEqual(funde('<div onClick={e => e.stopPropagation()}>x</div>'), [])
    assert.deepEqual(funde('<div aria-hidden="true" onClick={close} />'), [])
  })
})

describe('Sweep 116: Stellen', () => {
  test('Lagen, Rieden, CRM-Kalender, Nachrichten, Spaltenköpfe nutzen tastaturBedienbar', () => {
    const erwartet = {
      'src/app/(dashboard)/lagen/LagenClient.tsx': 1,
      'src/app/(dashboard)/weingarten/WeingartenBaum.tsx': 6,
      'src/app/(dashboard)/weingarten/WeingartenTable.tsx': 1,
      'src/app/(dashboard)/crm/CRMUebersichtClient.tsx': 4,
      'src/app/(dashboard)/nachrichten/NachrichtenClient.tsx': 1,
    }
    for (const [d, anzahl] of Object.entries(erwartet)) {
      const t = lies(d)
      assert.equal(t.split('{...tastaturBedienbar(').length - 1, anzahl, d)
      assert.deepEqual(klickOhneTastatur(t, d), [], d)
    }
  })
  test('CRM-Kalender: freier Zeitslot legt per Tastatur einen Termin 09:00–10:00 an, Ganztags-Zelle einen ganztägigen', () => {
    const t = lies('src/app/(dashboard)/crm/CRMUebersichtClient.tsx')
    assert.match(t, /setNewAkt\(\{ datum: dateStr, von: '09:00', bis: '10:00', ganztags: false \}\)/)
    assert.match(t, /tastaturBedienbar\(\(\) => \{ if \(!dragInfo\) \{ setSaveErr\(null\); setNewAkt\(\{ datum: dateStr, von: '', bis: '', ganztags: true \}\) \} \}, null\)/)
  })
  test('Auf-/Zuklapp-Zeilen melden ihren Zustand (aria-expanded), Spaltenköpfe die Sortierung (aria-sort)', () => {
    assert.match(lies('src/app/(dashboard)/lagen/LagenClient.tsx'), /aria-expanded=\{open\}/)
    const baum = lies('src/app/(dashboard)/weingarten/WeingartenBaum.tsx')
    assert.equal(baum.split('aria-expanded=').length - 1, 2)
    assert.equal(baum.split('aria-sort=').length - 1, 3)
    assert.match(lies('src/app/(dashboard)/weingarten/WeingartenTable.tsx'), /aria-sort=\{active \? \(dir === 'asc' \? 'ascending' : 'descending'\) : undefined\}/)
  })
})
