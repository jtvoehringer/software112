// Datenimport › Kontakte: Felder „Position“ und „Quelle“ (Hotfix 02.10.2026)
//
// Aufruf:  npm run -s test:csv   (alle scripts/tests/*.test.mjs)
//
// Geprüft wird: der gemeinsame Helfer bereinigterText (lib/crm/liste.ts, ohne Importe → direkt geladen),
// die Zuordnung samt automatischer Spaltenerkennung im ImportClient und der Kontakt-Insert der Import-Route
// (gleiche Bereinigung wie das Formular, zu lang → kürzen + Hinweis). Seite und Route per Quelltext-Prüfung.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import * as liste from '../../src/lib/crm/liste.ts'

const quelle = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const client = quelle('src/app/(dashboard)/admin/import/ImportClient.tsx')
const route = quelle('src/app/api/import/route.ts')
const actions = quelle('src/app/(dashboard)/crm/actions.ts')

describe('bereinigterText (Formular und Import)', () => {
  test('trimmt, fasst Leerzeichen zusammen, leer → null', () => {
    assert.equal(liste.bereinigterText('  Einkauf   und\tVerkauf \n'), 'Einkauf und Verkauf')
    assert.equal(liste.bereinigterText('   '), null)
    assert.equal(liste.bereinigterText(''), null)
    assert.equal(liste.bereinigterText(null), null)
    assert.equal(liste.bereinigterText(undefined), null)
    assert.equal(liste.bereinigterText(42), null)
  })
  test('Server Actions nutzen denselben Helfer', () => {
    assert.match(actions, /const wert = bereinigterText\(formData\.get\(feld\)\)/)
  })
})

describe('ImportClient: Kontaktfelder Position und Quelle', () => {
  const kontakte = client.slice(client.indexOf('  kontakte: ['), client.indexOf('  firmen: ['))
  const firmen = client.slice(client.indexOf('  firmen: ['), client.indexOf('  fuellungen: ['))
  test('Kontakte kennen position und quelle, Firmen nicht', () => {
    assert.match(kontakte, /key: 'position',\s+label: 'Position'/)
    assert.match(kontakte, /key: 'quelle',\s+label: 'Quelle'/)
    assert.doesNotMatch(firmen, /key: 'quelle'|key: 'position'/)
  })
  test('automatische Erkennung gängiger Spaltennamen', () => {
    for (const n of ['Funktion', 'Job Title']) assert.ok(kontakte.includes(`'${n}'`), n)
    for (const n of ['Source', 'Lead Source']) assert.ok(kontakte.includes(`'${n}'`), n)
    assert.match(client, /const namen = \[f\.key, f\.label, \.\.\.\(f\.erkennen \?\? \[\]\)\]\.map\(n => n\.toLowerCase\(\)\)/)
    assert.match(client, /p\.headers\.find\(h => namen\.includes\(h\.trim\(\)\.toLowerCase\(\)\)\)/)
  })
  test('Hinweise im Bericht werden angezeigt', () => {
    assert.match(client, /summe\.warnungen\.push/)
    assert.match(client, /Importiert mit Hinweis/)
  })
})

describe('Import-Route: Kontakt-Insert', () => {
  const kontaktZweig = route.slice(route.indexOf("if (typ === 'kontakte') {"), route.indexOf("} else if (typ === 'firmen') {"))
  const firmenZweig = route.slice(route.indexOf("} else if (typ === 'firmen') {"), route.indexOf("} else if (typ === 'fuellungen') {"))
  test('position und quelle mit Höchstlänge und Hinweis', () => {
    assert.match(kontaktZweig, /position:\s+importText\(mapVal\(row, mapping\.position\), 'Position', POSITION_MAX, i\+zeilenBasis, warnungen\)/)
    assert.match(kontaktZweig, /quelle:\s+importText\(mapVal\(row, mapping\.quelle\), 'Quelle', QUELLE_MAX, i\+zeilenBasis, warnungen\)/)
    assert.doesNotMatch(firmenZweig, /quelle|position:/)
  })
  test('importText: bereinigterText, Kürzung nach Zeichen, Hinweis', () => {
    const fn = route.slice(route.indexOf('function importText('), route.indexOf('\n}\n', route.indexOf('function importText(')))
    assert.match(fn, /const wert = bereinigterText\(roh\)/)
    assert.match(fn, /if \(!wert\) return null/)
    assert.match(fn, /Array\.from\(wert\)/)
    assert.match(fn, /gekürzt/)
    assert.match(route, /return NextResponse\.json\(\{ ok, fehler: rows\.length - ok - duplikate\.length, duplikate, details, warnungen \}\)/)
  })
})
