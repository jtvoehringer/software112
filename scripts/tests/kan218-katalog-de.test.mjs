// KAN-218 Nachtrag (08.10.2026): deutsche Katalogbegriffe des E-Labels nach dem amtlichen Wortlaut (EUR-Lex), englische
// Namen als Schlüssel der Übersetzungen unverändert; Kategorie „Fülldosage und Versanddosage“.
//
// Aufruf:  npm run -s test:csv   (alle scripts/tests/*.test.mjs)

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'

const migDir = new URL('../../supabase/migrations/', import.meta.url)
const mig = readdirSync(migDir).find(f => f.endsWith('_kan218_katalog_amtlich_de.sql'))
// Entwurf nur bis zum Einspielen (liegt lokal, nicht im Repository)
const sql = readFileSync(mig ? new URL(mig, migDir) : new URL('../entwurf/kan218_katalog_amtlich_de.sql', migDir), 'utf8').replace(/\r\n/g, '\n')
const katalog = readFileSync(new URL('../../src/lib/elabel/katalog.ts', import.meta.url), 'utf8')

describe('KAN-218: deutsche Katalogbegriffe amtlich', () => {
  test('fünf Begriffe nach EUR-Lex, nur name_de, nur vom bisherigen Wert aus', () => {
    for (const [en, alt, neu] of [
      ['Egg (egg white)', 'Ei (Eiklar)', 'Albumin aus Ei'],
      ['Milk (casein)', 'Milch (Casein)', 'Kasein aus Milch'],
      ['Bottled in a protective atmosphere', 'Abgefüllt in Schutzatmosphäre', 'Unter Schutzatmosphäre abgefüllt'],
      ['Yeast mannoproteins', 'Mannoproteine aus Hefe', 'Hefe-Mannoproteine'],
      ['Potassium hydrogen carbonate', 'Kaliumhydrogencarbonat', 'Kaliumbicarbonat'],
    ]) {
      assert.match(sql, new RegExp(`\\('${en.replace(/[()]/g, '\\$&')}',\\s+'${alt.replace(/[()]/g, '\\$&')}',\\s+'${neu}'\\)`), en)
    }
    assert.match(sql, /SET name_de = n\.neu/)
    assert.doesNotMatch(sql, /SET name_en|name_en = n\.neu/)
    assert.match(sql, /AND z\.name_de = n\.alt;/)
  })

  test('Kategorie Dosage amtlich', () => {
    assert.match(katalog, /dosage: +\{ de: 'Fülldosage und Versanddosage', +en: 'Tirage liqueur and expedition liqueur' \}/)
  })
})
