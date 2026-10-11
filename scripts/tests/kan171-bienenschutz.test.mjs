// KAN-171 (08.10.2026) – Bienenschutz: bienengefährliches Mittel in der Blüte (BBCH 60–69) nur mit bestätigten
// Bienenschutz-Auflagen speichern – Hinweis und Haken im Formular (Anlegen, Bearbeiten), dieselbe Prüfung in der
// Server Action und Parameter im Assistenten.
//
// Aufruf:  npm run -s test:csv   (alle scripts/tests/*.test.mjs)

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import * as b from '../../src/lib/behandlungen/bienenschutz.ts'

const quelle = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')

describe('KAN-171: Bienenschutz in der Blüte', () => {
  test('inBluete: BBCH 60–69', () => {
    for (const ja of ['61', '65', '69', '60', ' 68 ']) assert.equal(b.inBluete(ja), true, ja)
    for (const nein of ['57', '70', '71', '09', '', null, undefined, '6x', '650']) assert.equal(b.inBluete(nein), false, String(nein))
  })
  test('bienenschutzFehler: nur bienengefährlich + Blüte + ohne Bestätigung', () => {
    assert.match(b.bienenschutzFehler({ bienengefaehrlich: true, bbch: '65', bestaetigt: false }) ?? '', /Bienenschutz-Auflagen/)
    assert.equal(b.bienenschutzFehler({ bienengefaehrlich: true, bbch: '65', bestaetigt: true }), null)
    assert.equal(b.bienenschutzFehler({ bienengefaehrlich: false, bbch: '65', bestaetigt: false }), null)
    assert.equal(b.bienenschutzFehler({ bienengefaehrlich: true, bbch: '71', bestaetigt: false }), null)
    assert.equal(b.bienenschutzFehler({ bienengefaehrlich: true, bbch: null, bestaetigt: false }), null)
  })
  test('Server Action prüft nach der Uhrzeit, mit Formularfeld', () => {
    const a = quelle('src/app/(dashboard)/behandlungen/actions.ts')
    // seit KAN-325 über bienenEingabe (dieselbe Eingabe auch für die gespeicherte Bestätigung)
    assert.match(a, /const bienenEingabe = \{\r?\n\s+bienengefaehrlich, bbch: \(formData\.get\('bbch_stadium'\) as string \| null\) \|\| null, bestaetigt: formData\.get\(BIENENSCHUTZ_FELD\) === '1',\r?\n\s+\}\r?\n\s+const bienen = bienenschutzFehler\(bienenEingabe\)\r?\n\s+if \(bienen\) throw new AktionsFehler\(bienen\)/)
  })
  test('Formulare und Assistent', () => {
    assert.match(quelle('src/app/(dashboard)/behandlungen/neu/NeueBehandlungForm.tsx'), /<BienenschutzHinweis bienengefaehrlich=\{felder\.psm !== 'hidden' && !!selectedPsm\?\.bienengefaehrlich\}\n\s+bbch=\{felder\.bbch !== 'hidden' \? bbch : null\} \/>/)
    // seit KAN-325 folgt die gespeicherte Bestätigung als weiteres Prop
    assert.match(quelle('src/app/(dashboard)/behandlungen/[id]/edit/BehandlungEditForm.tsx'), /bbch=\{modus\.bbch === 'sichtbar' \? bbch : modus\.bbch === 'behalten' \? behandlung\.bbch_stadium : null\}(\s*\/>|\r?\n\s+bestaetigung=)/)
    const k = quelle('src/components/behandlungen/BienenschutzHinweis.tsx')
    assert.match(k, /<input type="checkbox" name=\{BIENENSCHUTZ_FELD\} value="1" required/)
    const m = quelle('src/lib/assistent/tools/massnahme.ts')
    assert.match(m, /if \(input\.bienenschutz_bestaetigt === true\) fd\.set\(BIENENSCHUTZ_FELD, '1'\)/)
    assert.match(m, /bienenschutz_bestaetigt: \{ type: 'boolean'/)
  })
})
