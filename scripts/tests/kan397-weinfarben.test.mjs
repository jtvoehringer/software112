// KAN-397 Nebenbefund (02.11.2026): Weinart-Auswahl im Zukauf zeigt wieder die Weinfarbe statt Grautöne.
//
// Aufruf:  npm run -s test:csv   (alle scripts/tests/*.test.mjs)

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { WEINART_AUSWAHL } from '../../src/lib/wein/weinart.ts'

const WURZEL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const quelle = (p) => readFileSync(path.join(WURZEL, p), 'utf8')

describe('KAN-397: Weinfarben in der Weinart-Auswahl', () => {
  test('Weiß gelb, Rot rot, Rosé rosa – drei verschiedene Farben, keine Grautöne', () => {
    const farbe = Object.fromEntries(WEINART_AUSWAHL.map(([w, , f]) => [w, f]))
    assert.deepEqual(Object.keys(farbe), ['weiss', 'rot', 'rose'])
    assert.match(farbe.weiss, /yellow/)
    assert.match(farbe.rot, /red/)
    assert.match(farbe.rose, /pink/)
    for (const f of Object.values(farbe)) assert.doesNotMatch(f, /s112-(tertiary|text|grey)/)
  })
  test('Zukauf anlegen und bearbeiten nutzen dieselbe Auswahl', () => {
    for (const p of ['src/app/(dashboard)/weinhandel/zukauf/neu/page.tsx', 'src/app/(dashboard)/weinhandel/zukauf/[id]/edit/ZukaufEditForm.tsx']) {
      const s = quelle(p)
      assert.match(s, /WEINART_AUSWAHL\.map\(/, p)
      assert.doesNotMatch(s, /\['weiss','Weißwein','bg-/, p)
    }
  })
})
