// KAN-234 (08.10.2026) – Support-Anfrage: Anhang über einen sichtbaren Knopf „Screenshot anhängen“, eine Ablagefläche
// (Ziehen) und Einfügen per Strg+V; Typ und Größe prüft der Browser sofort mit derselben Regel wie der Server.
//
// Aufruf:  npm run -s test:csv   (alle scripts/tests/*.test.mjs)

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { anfrageEingabeFehler, screenshotFehler, MAX_SCREENSHOT_BYTES } from '../../src/lib/support/anfrage.ts'

const s = readFileSync(new URL('../../src/app/(dashboard)/hilfe/support/SupportAnfrage.tsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n')

describe('KAN-234: Anhang in der Support-Anfrage', () => {
  test('screenshotFehler: Typ und Größe; Server nutzt dieselbe Regel', () => {
    assert.equal(screenshotFehler({ typ: 'image/png', groesse: 1000 }), null)
    assert.equal(screenshotFehler({ typ: 'image/webp', groesse: MAX_SCREENSHOT_BYTES }), null)
    assert.match(screenshotFehler({ typ: 'application/pdf', groesse: 10 }), /PNG, JPG oder WebP/)
    assert.match(screenshotFehler({ typ: 'image/jpeg', groesse: MAX_SCREENSHOT_BYTES + 1 }), /höchstens 5 MB/)
    const basis = { art: 'frage', betreff: 'Test Betreff', beschreibung: 'Eine ausreichend lange Beschreibung', dringlichkeit: 'normal', screenshotZustimmung: true }
    assert.match(anfrageEingabeFehler({ ...basis, screenshot: { typ: 'image/gif', groesse: 10 } }, false) ?? '', /PNG, JPG oder WebP/)
  })
  test('Oberfläche: Knopf öffnet die Dateiauswahl, Ziehen und Einfügen, Entfernen', () => {
    assert.match(s, /onClick=\{\(\) => dateiRef\.current\?\.click\(\)\}/)
    assert.match(s, /Screenshot anhängen/)
    assert.match(s, /onDrop=\{e => \{ e\.preventDefault\(\); setZiehen\(false\); bildUebernehmen\(e\.dataTransfer\.files\?\.\[0\]\) \}\}/)
    assert.match(s, /<form onSubmit=\{senden\} onPaste=\{einfuegen\}/)
    assert.match(s, /const bild = \[\.\.\.e\.clipboardData\.files\]\.find\(f => f\.type\.startsWith\('image\/'\)\)/)
    assert.match(s, /const fehlerText = screenshotFehler\(\{ typ: f\.type, groesse: f\.size \}\)/)
    assert.match(s, /onClick=\{anhangEntfernen\}/)
    assert.match(s, /className="sr-only"\n\s+aria-labelledby="support-anhang-titel"/)
  })
})
