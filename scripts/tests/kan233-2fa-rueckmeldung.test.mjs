// KAN-233 (08.10.2026) – Zwei-Faktor: Nach einem richtigen Code bleibt das Eingabefeld nicht leer stehen (man glaubte, den
// Code nochmals eingeben zu müssen), sondern die Seite zeigt „Code bestätigt … weitergeleitet“ bis zur nächsten Seite –
// beim Anmelden wie beim Einrichten. Ein falscher Code zeigt weiter das Feld mit Fehlermeldung.
//
// Aufruf:  npm run -s test:csv   (alle scripts/tests/*.test.mjs)

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const s = readFileSync(new URL('../../src/app/zwei-faktor/page.tsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n')

describe('KAN-233: Rückmeldung nach dem 2FA-Code', () => {
  test('Erfolg: Bestätigung statt Formular, läuft bleibt an bis zur Weiterleitung', () => {
    const i = s.indexOf('const bestaetigen = async')
    const fn = s.slice(i, s.indexOf('const entfernen', i))
    assert.match(fn, /if \(error\) \{\n\s+setLaeuft\(false\)/)
    assert.match(fn, /setBestaetigt\(true\)[\s\S]*weiter\(\)/)
    // vor dem Fehlerzweig wird läuft nicht zurückgesetzt – sonst stünde kurz wieder „Bestätigen“ da
    assert.doesNotMatch(fn.slice(0, fn.indexOf('if (error)')), /setLaeuft\(false\)/)
  })
  test('Anzeige: role=status mit „Code bestätigt“, Modi ausgeblendet', () => {
    assert.match(s, /const codeFeld = bestaetigt \? \(\n\s+<div role="status" aria-live="polite"/)
    assert.match(s, /<strong>Code bestätigt\.<\/strong> Du wirst angemeldet und weitergeleitet …/)
    assert.match(s, /\{bestaetigt && codeFeld\}/)
    assert.match(s, /\{!bestaetigt && modus === 'code' && \(/)
    assert.match(s, /\{!bestaetigt && modus === 'einrichten' && \(/)
  })
})
