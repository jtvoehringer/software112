// Sweep 118 (10.10.2026): Pflichtfelder – Label mit „*“ und Feld mit required bzw. aria-required.
// Befund: 43 Felder in 27 Dateien waren im Label als Pflicht (*) gekennzeichnet, das Feld selbst wusste nichts davon:
// der Browser prüfte nichts vor dem Absenden (Fehler erst vom Server), der Screenreader sagte „Pflichtfeld“ nicht an
// (WCAG 3.3.2). Betroffen u. a. Abstufen, Produktion, Umziehen, Schnellerfassung, Storno-Grund, USt-Satz, Zukauf,
// Sammelrechnung, Prüfnummer-Status, Freeze-Korrektur. Bedingte Sterne mit derselben Bedingung (required={…}),
// gegenseitig berechnete Felder (Spritzbrühe ↔ Wasseraufwand) und Dateiauswahl/Import-Zuordnung mit aria-required.
// Wächter: scripts/check-a11y.js Regel 6 PFLICHT_OHNE_KENNZEICHEN.
//
// Aufruf:  npm run -s test:csv

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const HIER = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(HIER, '..', '..')
const require = createRequire(import.meta.url)
const { pflichtOhneKennzeichen } = require(path.join(HIER, '..', 'check-a11y.js'))
const lies = (p) => readFileSync(path.join(ROOT, p), 'utf8')
const funde = (jsx) => pflichtOhneKennzeichen(`const x = (${jsx})`, 'x.tsx').map(f => f.tag)

describe('check-a11y PFLICHT_OHNE_KENNZEICHEN', () => {
  test('Label mit * und Feld ohne Kennzeichen: folgendes Feld, htmlFor, Feld im Label, Radios im folgenden Block', () => {
    assert.deepEqual(funde('<div><label>Datum *</label><input type="date" /></div>'), ['input'])
    assert.deepEqual(funde('<div><label htmlFor="d">Datum *</label><p>Hinweis</p><input id="d" /></div>'), ['input'])
    assert.deepEqual(funde('<label>Grund * <textarea /></label>'), ['textarea'])
    assert.deepEqual(funde('<div><label>Art <span className="text-s112-err">*</span></label><div><input type="radio" name="a" /></div></div>'), ['input'])
    assert.deepEqual(funde("<div><label>Prüfnummer{p ? ' *' : ''}</label><input /></div>"), ['input'])
  })
  test('in Ordnung: required, aria-required, Spread, ohne Stern, eigene Komponente statt Feld', () => {
    assert.deepEqual(funde('<div><label>Datum *</label><input type="date" required /></div>'), [])
    assert.deepEqual(funde('<div><label>Menge *</label><input aria-required={pflicht} /></div>'), [])
    assert.deepEqual(funde('<div><label>Menge *</label><input {...p} /></div>'), [])
    assert.deepEqual(funde('<div><label>Notiz</label><input /></div>'), [])
    assert.deepEqual(funde('<div><label>Kunde *</label><KundenAuswahl /></div>'), [])
    assert.deepEqual(funde('<div><label>Menge (L) – 5 * 2</label><input /></div>'), [])
  })
})

describe('Sweep 118: Stellen', () => {
  test('feste Pflichtfelder mit required', () => {
    const erwartet = [
      ['src/app/(dashboard)/kellerbuch/weinausbau/[id]/abstufen/AbstufenForm.tsx', 4],
      ['src/app/(dashboard)/kellerbuch/produktion/ProduktionForm.tsx', 3],
      ['src/components/kellerbuch/Schnellerfassung.tsx', 4],
      ['src/components/kellerbuch/UmziehenWidget.tsx', 3],
    ]
    for (const [d, n] of erwartet) assert.ok((lies(d).match(/<(input|select|textarea) required\b/g) ?? []).length >= n, d)
    assert.match(lies('src/components/StornoButton.tsx'), /<textarea required id=\{id\}/)
  })
  test('bedingte Pflicht mit derselben Bedingung wie der Stern', () => {
    assert.match(lies('src/components/dac/DacStatusKarte.tsx'), /required=\{angaben\.pruefnummer === 'pflicht'\}/)
    assert.match(lies('src/components/FreezeKorrektur.tsx'), /<select id=\{fid\} required=\{f\.pflicht\}/)
    assert.match(lies('src/app/(dashboard)/erntemeldung/[id]/PressungSection.tsx'), /required=\{!!row\.weingarten_id\}/)
  })
  test('gegenseitig berechnete Felder nur aria-required (blockieren das Absenden nicht)', () => {
    const neu = lies('src/app/(dashboard)/behandlungen/neu/NeueBehandlungForm.tsx')
    assert.match(neu, /aria-required=\{felder\.mengeGesamt !== 'optional'\}/)
    assert.match(neu, /aria-required=\{felder\.wasseraufwand !== 'optional'\}/)
    assert.match(lies('src/app/(dashboard)/admin/import/ImportClient.tsx'), /<select aria-label=\{f\.label\} aria-required=\{f\.pflicht \|\| undefined\}/)
  })
  test('ganzer Quellbaum ohne Fund (Stichprobe der geänderten Formulare)', () => {
    for (const d of ['src/components/kellerbuch/Schnellerfassung.tsx', 'src/app/(dashboard)/weinhandel/zukauf/neu/page.tsx',
      'src/app/(dashboard)/buchhaltung/neu/page.tsx', 'src/components/dac/DacStatusKarte.tsx']) assert.deepEqual(pflichtOhneKennzeichen(lies(d), d), [], d)
  })
})
