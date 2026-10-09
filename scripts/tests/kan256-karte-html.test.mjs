// KAN-256 (09.10.2026): Popup und Tooltip der Ried-Karte maskieren Datenbankwerte. Leaflet setzt beide als HTML
// (innerHTML) – ein Ried-Name wie <img src=x onerror=…> lief vorher bei jedem Mitglied, das die Karte öffnet.
//
// Aufruf:  npm run -s test:csv

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { riedPopupHtml, sichererPfad, tooltipText } from '../../src/lib/weingarten/kartePopup.ts'

const HIER = path.dirname(fileURLToPath(import.meta.url))
const KARTE = fs.readFileSync(path.join(HIER, '..', '..', 'src', 'components', 'weingarten', 'RiedKarte.tsx'), 'utf8')

describe('Popup der Ried-Karte', () => {
  test('Name, Rebsorte/Fläche und Link werden maskiert – kein ausführbares HTML', () => {
    const html = riedPopupHtml({ name: '<img src=x onerror=alert(1)>', sub: 'GV · <b>1,2</b> ha', href: '/weingarten/1"onmouseover="x' })
    assert.ok(!/<img|<b>1/.test(html), html)
    assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/)
    assert.match(html, /GV · &lt;b&gt;1,2&lt;\/b&gt; ha/)
    assert.match(html, /href="\/weingarten\/1&quot;onmouseover=&quot;x"/, 'Attribut kann nicht verlassen werden')
  })

  test('Link nur als relativer Pfad der App – javascript:, fremde Seiten und //host fallen weg', () => {
    assert.equal(sichererPfad('/weingarten/abc'), '/weingarten/abc')
    for (const boese of ['javascript:alert(1)', 'https://boese.example', '//boese.example', ' /x', '', undefined]) {
      assert.equal(sichererPfad(boese), null, String(boese))
      assert.ok(!/<a /.test(riedPopupHtml({ name: 'Kirchberg', href: boese })), String(boese))
    }
  })

  test('ohne Zusatz und Link: nur der Name', () => {
    assert.equal(riedPopupHtml({ name: 'Kirchberg' }), '<b style="font-size:13px">Kirchberg</b>')
    assert.equal(tooltipText('Ried <Süd> & „Ost“'), 'Ried &lt;Süd&gt; &amp; „Ost“')
  })

  test('RiedKarte nutzt die Helfer – kein Popup/Tooltip aus rohen Werten', () => {
    assert.match(KARTE, /m\.bindPopup\(riedPopupHtml\(p\)\)/)
    assert.match(KARTE, /m\.bindTooltip\(tooltipText\(p\.name\)/)
    assert.match(KARTE, /gj\.bindTooltip\(tooltipText\(u\.name\)/)
    assert.doesNotMatch(KARTE, /bind(Popup|Tooltip)\(\s*`[^`]*\$\{/, 'kein Template mit Interpolation')
    assert.doesNotMatch(KARTE, /bind(Popup|Tooltip)\(\s*(p|u)\.name\b/, 'kein roher Name')
  })
})
