// KAN-84 (04.10.2026): Füllung anlegen – Charge Pflicht (außer Flaschen-Eröffnungsbestand), Jahrgang und Rebsorte aus der
// Charge (abweichende Formular-/Assistentenwerte ignoriert, mit Hinweis); Qualität und Herkunft bleiben abstufbar.
//
// Aufruf:  npm run -s test:csv   bzw. node --experimental-strip-types --test scripts/tests/kan84-fuellung-merkmale.test.mjs

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { merkmaleAusCharge } from '../../src/lib/wein/fuellungMerkmale.ts'

const WURZEL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const quelle = rel => readFileSync(path.join(WURZEL, rel), 'utf8').replace(/\r\n/g, '\n')

describe('KAN-84 Merkmale aus der Charge', () => {
  test('abweichende Angaben werden durch die Charge ersetzt, mit Hinweis', () => {
    const r = merkmaleAusCharge({ jahrgang: 2024, rebsorte: 'Zweigelt' }, { jahrgang: 2025, rebsorte: 'Grüner Veltliner' })
    assert.equal(r.jahrgang, 2025)
    assert.equal(r.rebsorte, 'Grüner Veltliner')
    assert.match(r.hinweis, /Jahrgang 2024 → 2025, Rebsorte „Zweigelt“ → „Grüner Veltliner“/)
  })
  test('gleiche Angaben (auch andere Groß-/Kleinschreibung) ohne Hinweis', () => {
    const r = merkmaleAusCharge({ jahrgang: 2025, rebsorte: 'grüner veltliner' }, { jahrgang: 2025, rebsorte: 'Grüner Veltliner' })
    assert.deepEqual(r, { jahrgang: 2025, rebsorte: 'Grüner Veltliner', hinweis: null })
  })
  test('Charge ohne Wert (Eröffnungsbestand ohne Jahrgang): Eingabe zählt', () => {
    assert.deepEqual(merkmaleAusCharge({ jahrgang: 2023, rebsorte: ' Riesling ' }, { jahrgang: null, rebsorte: null }),
      { jahrgang: 2023, rebsorte: 'Riesling', hinweis: null })
  })
  test('ohne Eingabe: Werte der Charge', () => {
    assert.deepEqual(merkmaleAusCharge({ jahrgang: null, rebsorte: null }, { jahrgang: 2025, rebsorte: 'Riesling' }),
      { jahrgang: 2025, rebsorte: 'Riesling', hinweis: null })
  })
})

describe('KAN-84 Verdrahtung', () => {
  const s = quelle('src/app/(dashboard)/weinhandel/actions.ts')
  const anlegen = s.slice(s.indexOf('async function fuellungAnlegen'), s.indexOf('// Füllung bearbeiten'))
  test('Charge Pflicht außer Eröffnungsbestand, vor jedem Schreibzugriff', () => {
    assert.match(anlegen, /if \(!eroeffnung && !weinausbauId\) \{\s+throw new AktionsFehler\('Bitte die Kellerbuch-Charge wählen/)
    assert.ok(anlegen.indexOf('if (!eroeffnung && !weinausbauId)') < anlegen.indexOf("rpc as any)('get_next_chargennummer'"))
    assert.ok(anlegen.indexOf('if (!eroeffnung && !weinausbauId)') < anlegen.indexOf('chargeAktualisieren('))
  })
  test('Jahrgang und Rebsorte aus der Charge, Hinweis im Ergebnis', () => {
    assert.match(anlegen, /\.select\('name, menge_liter, status, aktiv, jahrgang, rebsorte, /)
    assert.match(anlegen, /merkmaleAusCharge\(\{ jahrgang, rebsorte \}, \{ jahrgang: charge\.jahrgang \?\? null, rebsorte: charge\.rebsorte \?\? null \}\)/)
    assert.match(anlegen, /\n    jahrgang,\s+\/\/ KAN-84: aus der Charge\n    rebsorte,\n/)
    assert.doesNotMatch(anlegen, /jahrgang:\s+parseInt\(dezimal\(formData\.get\('jahrgang'\)/)
    assert.match(anlegen, /const hinweise: string\[\] = \[\.\.\.vorabHinweise\]/)
  })
  test('Formular: Charge Pflicht, Jahrgang/Rebsorte schreibgeschützt bei Charge mit Wert', () => {
    const f = quelle('src/app/(dashboard)/weinhandel/fuellungen/neu/FuellungFormClient.tsx')
    assert.doesNotMatch(f, /– keine Verknüpfung –/)
    assert.match(f, /name="weinausbau_id"[\s\S]{0,200}required/)
    assert.match(f, /readOnly=\{!!selectedCharge\?\.jahrgang\}/)
    assert.match(f, /readOnly=\{!!selectedCharge\?\.rebsorte\}/)
  })
  test('Assistent übernimmt Jahrgang und Rebsorte aus der Charge', () => {
    const t = quelle('src/lib/assistent/tools/abfuellen.ts')
    assert.match(t, /fd\.set\('jahrgang', ch\.jahrgang != null \? String\(ch\.jahrgang\)/)
    assert.match(t, /fd\.set\('rebsorte', ch\.rebsorte \? String\(ch\.rebsorte\)/)
  })
  test('DAC-Antrag: Jahrgang aus der Charge vorgeschlagen (Kleinfix KAN-84/KAN-98)', () => {
    const d = quelle('src/components/dac/DacForm.tsx')
    assert.match(d, /String\(dac\?\.jahrgang \?\? jahrgangDerCharge\(dac\?\.weinausbau_id \?\? preChargeId\) \?\? new Date\(\)\.getFullYear\(\)\)/)
    assert.match(quelle('src/app/(dashboard)/dac/neu/page.tsx'), /select\('id, name, jahrgang/)
  })
})
