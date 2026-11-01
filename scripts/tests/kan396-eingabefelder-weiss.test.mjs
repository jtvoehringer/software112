// KAN-396 (Epic KAN-391): Eingabefelder ohne eigene Hintergrundfarbe waren durchsichtig und wirkten auf grauen
// Formularen (z. B. „Lese erfassen“) wie gesperrt. Seitdem: weiß als Grundfarbe in der Basisschicht, gesperrte und
// schreibgeschützte Felder grau; das umgerechnete Mostgewicht-Feld („≈“) ebenfalls weiß.
//
// Aufruf:  npm run -s test:csv

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const quelle = p => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')

test('Basisschicht: Eingabefelder weiß, gesperrte grau – Checkbox/Radio/Knöpfe ausgenommen', () => {
  const css = quelle('src/app/globals.css')
  const block = css.slice(css.indexOf('/* KAN-396'))
  assert.match(block, /^@layer base \{/m, 'in der Basisschicht, damit bg-Utilities Vorrang haben')
  assert.match(block, /select,\n\s+textarea \{\n\s+background-color: var\(--color-s112-surface\);/)
  assert.match(block, /input:is\(:disabled, :read-only\)[^{]*,\n\s+select:disabled,\n\s+textarea:is\(:disabled, :read-only\) \{\n\s+background-color: var\(--color-s112-bg\);/)
  for (const typ of ['checkbox', 'radio', 'submit', 'button', 'hidden']) assert.ok(block.includes(`[type='${typ}']`), typ)
})

test('Mostgewicht: umgerechnetes Feld weiß mit gestricheltem Rahmen', () => {
  const m = quelle('src/components/wein/MostgewichtEingabe.tsx')
  assert.match(m, /umgerechnet \? 'border-dashed border-s112-border bg-white text-s112-text-2'/)
})
