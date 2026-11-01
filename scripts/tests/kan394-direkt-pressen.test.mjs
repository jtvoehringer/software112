// KAN-394 (Epic KAN-391): Direkt pressen aus den Lesedaten – der Ried-Name einer Lese-Zeile mit noch nicht verpresster
// Menge verlinkt auf die Pressungsseite; dort öffnet das Formular mit der Traubenzeile dieses Orts
// (lib/wein/pressenLink.ts, ErnteDetailClient, kellerbuch/pressungen, PressungSection).
//
// Aufruf:  npm run -s test:csv

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
// @ts-expect-error TS5097 – node:test lädt die .ts-Datei direkt
import { pressenHref, pressenVorauswahl } from '../../src/lib/wein/pressenLink.ts'

const quelle = p => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const WG = '11111111-1111-4111-8111-111111111111'
const GST = '22222222-2222-4222-8222-222222222222'
const BASIS = '/kellerbuch/pressungen?jahrgang=j1&lese=1'
const zeile = (z = {}) => ({ weingarten_id: WG, grundstueck_id: GST, ernte_datum: '2026-11-01', menge_kg: 577, storno: null, ...z })
const VERF = { gst: { [GST]: 577 }, wg: { [WG]: 300 } }

describe('pressenHref', () => {
  test('Zeile mit verfügbarer Menge → Link mit Ried, GST und Lesetag', () => {
    assert.equal(pressenHref(BASIS, zeile(), VERF, true), `${BASIS}&ried=${WG}&gst=${GST}&tag=2026-11-01`)
    assert.equal(pressenHref('/kellerbuch/pressungen', zeile({ grundstueck_id: null }), VERF, true), `/kellerbuch/pressungen?ried=${WG}&tag=2026-11-01`)
  })
  test('kein Link: storniert, 0 kg, andere Lese, schon verpresst', () => {
    assert.equal(pressenHref(BASIS, zeile({ storno: { am: 'x' } }), VERF, true), null)
    assert.equal(pressenHref(BASIS, zeile({ menge_kg: 0 }), VERF, true), null)
    assert.equal(pressenHref(BASIS, zeile(), VERF, false), null)
    assert.equal(pressenHref(BASIS, zeile(), { gst: { [GST]: 0.004 }, wg: {} }, true), null)
    assert.equal(pressenHref(BASIS, zeile(), { gst: {}, wg: {} }, true), null)
  })
})

describe('pressenVorauswahl', () => {
  test('Options-IDs: mit Lesetag zuerst der Tag, dann der Ort', () => {
    assert.deepEqual(pressenVorauswahl({ ried: WG, gst: GST, tag: '2026-11-01' }), [`${WG}|${GST}|2026-11-01`, `${WG}|${GST}|`])
    assert.deepEqual(pressenVorauswahl({ ried: WG }), [`${WG}||`])
  })
  test('ohne bzw. mit ungültigen Parametern keine Vorauswahl', () => {
    assert.equal(pressenVorauswahl({}), null)
    assert.equal(pressenVorauswahl({ ried: 'x' }), null)
    assert.equal(pressenVorauswahl({ ried: WG, gst: 'x' }), null)
    assert.equal(pressenVorauswahl({ ried: WG, tag: '1.11.2026' }), null)
  })
})

test('Verdrahtung: Link in Tabelle und Karten, Formular öffnet mit der Zeile', () => {
  const c = quelle('src/app/(dashboard)/erntemeldung/[id]/ErnteDetailClient.tsx')
  assert.equal((c.match(/<RiedName p=\{p\} href=\{pressenLink\(p\)\} \/>/g) ?? []).length, 2)
  assert.match(c, /const pressenLink = \(p: ErnteParzelle\) => writeOk\n\s+\? pressenHref\(pressungenHref, p, pressenVerfuegbar, !mehrereLesen \|\| p\.lese_nr === aktiveLeseNr\)/)
  const seite = quelle('src/app/(dashboard)/erntemeldung/[id]/page.tsx')
  assert.match(seite, /pressenVerfuegbar=\{\{ gst: verfuegbareKgByGST, wg: verfuegbareKg \}\}/)
  const pr = quelle('src/app/(dashboard)/kellerbuch/pressungen/page.tsx')
  assert.match(pr, /vorauswahl=\{pressenVorauswahl\(sp\)\}/)
  const ps = quelle('src/app/(dashboard)/erntemeldung/[id]/PressungSection.tsx')
  assert.match(ps, /const \[showForm, setShowForm\]\s+= useState\(writeOk && !!vorauswahl\)/)
  assert.match(ps, /const z = vorauswahl\?\.map\(id => zeileAusOption\(id\)\)\.find/)
})
