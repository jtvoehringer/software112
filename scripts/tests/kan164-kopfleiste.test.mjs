// KAN-164 (29.09.2026) – Kopfleiste im Betriebs-CD: Primärfarbe als Fläche, Sekundärfarbe als Schrift
//
// Aufruf:  npm run -s test:csv   (alle scripts/tests/*.test.mjs)
//
// Geprüft: kopfleistenFarben() (Standard bleibt CD-Blau/Weiß, eigene Farben mit Kontrastschutz 5,5 : 1),
// die Verdrahtung in layout.tsx/Topbar.tsx (Quelltext) und dass Aktion-Knöpfe die Sekundärfarbe als Schrift nehmen.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'

const farbe = await import('../../src/lib/farbe.ts')
const { kopfleistenFarben, kontrast, rgbKanaele, KONTRAST_KOPFLEISTE, CD_KOPFLEISTE } = farbe
const quelle = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')

describe('kopfleistenFarben()', () => {
  test('Standardfarben → CD-Blau mit Weiß (wie seit KAN-142)', () => {
    assert.deepEqual(kopfleistenFarben('#4F86D6', '#FFFFFF'), { flaeche: CD_KOPFLEISTE, schrift: '#FFFFFF' })
    assert.deepEqual(kopfleistenFarben('#4f86d6', '#ffffff'), { flaeche: CD_KOPFLEISTE, schrift: '#FFFFFF' })
    assert.equal(CD_KOPFLEISTE, '#2F63AC')
  })

  test('ungültige oder fehlende Primärfarbe → Standard', () => {
    assert.deepEqual(kopfleistenFarben(null, '#FFFFFF'), { flaeche: CD_KOPFLEISTE, schrift: '#FFFFFF' })
    assert.deepEqual(kopfleistenFarben('grün', '#F9E54F'), { flaeche: CD_KOPFLEISTE, schrift: '#FFFFFF' })
  })

  test('Staging-Beispiel: dunkelgrün mit gelber Schrift bleibt unverändert (Kontrast reicht)', () => {
    const k = kopfleistenFarben('#025450', '#F9E54F')
    assert.deepEqual(k, { flaeche: '#025450', schrift: '#F9E54F' })
    assert.ok(kontrast(k.flaeche, k.schrift) >= KONTRAST_KOPFLEISTE)
  })

  test('zu helle Primärfarbe mit weißer Schrift wird abgedunkelt, Farbton bleibt', () => {
    const k = kopfleistenFarben('#9AD1A0', '#FFFFFF')
    assert.equal(k.schrift, '#FFFFFF')
    assert.notEqual(k.flaeche, '#9AD1A0')
    assert.ok(kontrast(k.flaeche, k.schrift) >= KONTRAST_KOPFLEISTE)
    const [r, g, b] = rgbKanaele(k.flaeche).split(' ').map(Number)
    assert.ok(g > r && g > b, `Grünton bleibt erhalten (${k.flaeche})`)
  })

  test('dunkle Schrift auf dunkler Fläche → Fläche wird aufgehellt', () => {
    const k = kopfleistenFarben('#222222', '#111111')
    assert.ok(kontrast(k.flaeche, k.schrift) >= KONTRAST_KOPFLEISTE)
  })

  test('jede Kombination erreicht mind. 5,5 : 1', () => {
    const farben = ['#000000', '#FFFFFF', '#FF0000', '#00FF00', '#0000FF', '#FFFF00', '#808080', '#025450', '#F9E54F', '#4F86D6', '#C0C0C0']
    for (const p of farben) for (const s of farben) {
      const k = kopfleistenFarben(p, s)
      assert.ok(kontrast(k.flaeche, k.schrift) >= KONTRAST_KOPFLEISTE, `${p}/${s} → ${k.flaeche}/${k.schrift}`)
    }
  })

  test('rgbKanaele() für CSS-Variablen', () => {
    assert.equal(rgbKanaele('#2F63AC'), '47 99 172')
    assert.equal(rgbKanaele('#fff'), '255 255 255')
    assert.equal(rgbKanaele('xyz'), null)
  })
})

describe('Verdrahtung', () => {
  test('layout.tsx setzt --s112-kopf und --s112-kopf-text aus kopfleistenFarben()', () => {
    const layout = quelle('src/app/(dashboard)/layout.tsx')
    assert.match(layout, /const kopfleiste = kopfleistenFarben\(branding\.primary_color, branding\.secondary_color\)/)
    assert.match(layout, /--s112-kopf:\s+\$\{rgbKanaele\(kopfleiste\.flaeche\)\}/)
    assert.match(layout, /--s112-kopf-text: \$\{rgbKanaele\(kopfleiste\.schrift\)\}/)
  })

  test('globals.css-Standard entspricht CD-Blau/Weiß', () => {
    const css = quelle('src/app/globals.css')
    assert.match(css, /--s112-kopf:\s+47 99 172;/)
    assert.match(css, /--s112-kopf-text: 255 255 255;/)
  })

  test('Topbar: Fläche und Schrift aus den Kopfleisten-Token, kein festes Weiß auf der Fläche', () => {
    const t = quelle('src/components/layout/Topbar.tsx')
    assert.match(t, /<header className="bg-s112-kopf text-s112-kopf-text /)
    assert.doesNotMatch(t, /bg-s112-blue-700 text-white/)
    assert.doesNotMatch(t, /text-white\/\d+/)
    assert.doesNotMatch(t, /border-white\//)
  })

  test('Aktion-Flächen (bg-s112-teal) haben keine feste weiße Schrift mehr', () => {
    const dateien = []
    const lauf = d => { for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name)
      if (e.isDirectory()) lauf(p); else if (/\.tsx?$/.test(e.name)) dateien.push(p)
    } }
    lauf(new URL('../../src', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
    const treffer = []
    for (const f of dateien) {
      for (const abschnitt of readFileSync(f, 'utf8').match(/[^'"`{}$\r\n]+/g) ?? []) {
        if (/(^|\s)bg-s112-teal(?=\s|$)/.test(abschnitt) && /(^|\s)text-white(?=\s|$)/.test(abschnitt)) treffer.push(`${f}: ${abschnitt.trim()}`)
      }
    }
    assert.deepEqual(treffer, [])
    assert.match(quelle('src/app/globals.css'), /\.btn-primary \{\s*@apply bg-s112-teal text-s112-yellow /)
  })
})
