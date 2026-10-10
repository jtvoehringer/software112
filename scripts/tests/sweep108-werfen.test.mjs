// Sweep 108 (10.10.2026): Fehler im Server-Code als AktionsFehler werfen.
// Befund: Next.js blendet in Produktion den Text jedes Fehlers aus Server Actions und Server Components aus; nur der
// digest kommt an. 225 Stellen warfen new Error(…) – darunter geladen()/gezaehlt() (Ladefehler auf Hunderten Seiten) und
// alle Lader der Behördenmeldungen. Die Fehlerseite zeigte nur „Unbekannter Fehler“. Jetzt AktionsFehler (digest mit
// Meldung); Wächter scripts/check-werfen.js (prebuild).
//
// Aufruf:  npm run -s test:csv

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { geladen, gezaehlt } from '../../src/lib/supabase/geladen.ts'
import { fehlerText } from '../../src/lib/fehler.ts'

const HIER = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(HIER, '..', '..')
const require = createRequire(import.meta.url)
const { pruefeText, pruefeWurzel } = require(path.join(HIER, '..', 'check-werfen.js'))

/** Was die Fehlerseite in Produktion sieht: Next.js ersetzt die Meldung, behält den digest */
function wieInProduktion(e) {
  return Object.assign(new Error('An error occurred in the Server Components render. The specific message is omitted in production builds.'), { digest: e.digest })
}

describe('geladen/gezaehlt: Meldung kommt in Produktion an', () => {
  test('geladen wirft AktionsFehler mit digest', () => {
    let fehler
    try { geladen({ data: null, error: { message: 'permission denied for table weinausbau' } }, 'Chargen') } catch (e) { fehler = e }
    assert.equal(fehler.name, 'AktionsFehler')
    assert.ok(fehler instanceof Error)
    assert.match(fehlerText(wieInProduktion(fehler)), /^Chargen konnte nicht geladen werden/)
  })
  test('gezaehlt ebenso', () => {
    let fehler
    try { gezaehlt({ count: null, error: { message: 'x' } }, 'Belege') } catch (e) { fehler = e }
    assert.match(fehlerText(wieInProduktion(fehler)), /^Belege konnte nicht gezählt werden/)
  })
  test('zum Vergleich: ein normales Error kommt nur als Ersatztext an', () => {
    assert.equal(fehlerText(wieInProduktion(new Error('weg')), 'Unbekannter Fehler'), 'Unbekannter Fehler')
  })
})

describe('Wächter', () => {
  test('Erkennung', () => {
    const z = t => pruefeText(t).funde.map(f => f.zeile)
    assert.deepEqual(z("export async function x() {\n  throw new Error('a')\n}"), [2])
    assert.deepEqual(z("throw new AktionsFehler('a')"), [])
    assert.deepEqual(z("'use client'\nthrow new Error('a')"), [])
    assert.deepEqual(z("// throw new Error('a')"), [])
    assert.deepEqual(z("// werfen-ok: interner Programmierfehler, nie für Benutzer\nthrow new Error('a')"), [])
  })
  test('Projekt ohne Fund, im prebuild', () => {
    const e = pruefeWurzel(ROOT)
    assert.ok(e.server > 300, `zu wenige Server-Dateien (${e.server})`)
    assert.deepEqual(e.funde, [])
    assert.match(JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')).scripts.prebuild, /check-werfen\.js/)
  })
})
