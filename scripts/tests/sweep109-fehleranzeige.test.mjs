// Sweep 109 (10.10.2026): gefangene Fehler im Browser über fehlerText() anzeigen.
// Befund: 26 catch-Stellen in Client-Komponenten zeigten String(e), (e as Error).message oder `${e}` – bei Server Actions in
// Produktion der ausgeblendete Next-Text („An error occurred in the Server Components render …“; Lohnversektung,
// Datenblatt-Bild, Visitenkarte), bei fetch „Fehler: TypeError: Failed to fetch“. Jetzt fehlerText(e) (liest den digest),
// dazu Übersetzung von Netz- und JSON-Fehlern. Wächter: check-fehlertext (Anzeige-Aufrufe mit Rohtext).
//
// Aufruf:  npm run -s test:csv

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { fehlerText, AktionsFehler } from '../../src/lib/fehler.ts'

const HIER = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(HIER, '..', '..')
const require = createRequire(import.meta.url)
const ft = require(path.join(HIER, '..', 'check-fehlertext.js'))

describe('fehlerText für Browser-Fehler', () => {
  test('Netzfehler aller Browser', () => {
    for (const m of ['Failed to fetch', 'NetworkError when attempting to fetch resource.', 'Load failed'])
      assert.match(fehlerText(new TypeError(m)), /^Keine Verbindung zum Server/)
  })
  test('JSON-Antwort statt HTML-Fehlerseite', () => {
    assert.match(fehlerText(new SyntaxError(`Unexpected token '<', "<!DOCTYPE "... is not valid JSON`)), /^Die Antwort des Servers konnte nicht gelesen werden/)
    assert.match(fehlerText(new SyntaxError('Unexpected end of JSON input')), /^Die Antwort des Servers/)
  })
  test('Server Action in Produktion: Meldung aus dem digest statt String(e)', () => {
    const imBrowser = Object.assign(new Error('An error occurred in the Server Components render. The specific message is omitted in production builds.'),
      { digest: new AktionsFehler('Die Charge ist abgeschlossen.').digest })
    assert.equal(fehlerText(imBrowser), 'Die Charge ist abgeschlossen.')
    assert.match(String(imBrowser), /An error occurred/)   // so stand es vorher da
  })
})

describe('Wächter', () => {
  const z = t => ft.pruefeText(t).funde.map(f => f.zeile)
  test('Rohtext in Anzeige-Aufrufen → Fund', () => {
    assert.deepEqual(z('  } catch (e) { setFehler(String(e)) }'), [1])
    assert.deepEqual(z('  .catch(e => setFehler((e as Error).message))'), [1])
    assert.deepEqual(z("  } catch (err) { setResult(`Fehler: ${err}`) }"), [1])
    assert.deepEqual(z("  } catch (err) { setFehler(err instanceof Error ? err.message : 'x') }"), [1])
    assert.deepEqual(z('  } catch (e) { setFehler(fehlerText(e)) }'), [])
  })
  test('Projekt ohne Fund', () => {
    assert.deepEqual(ft.pruefeWurzel(ROOT).funde, [])
  })
})
