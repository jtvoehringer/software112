// Sweep 99 (10.10.2026): Datenbankfehler nie roh an den Benutzer.
// Befund: 43 Server Actions und API-Routen gaben error.message zurück – englische PostgreSQL-Texte wie
// „duplicate key value violates unique constraint …“ oder „value too long for type character varying(30)“.
// uebersetzeDbMeldung() kannte nur Prüfregeln, Fremdschlüssel und Berechtigungen. Jetzt auch: doppelter Eintrag (23505),
// zu lang (22001), ungültige Eingabe (22P02), Pflichtangabe fehlt (23502), Zahl zu groß (22003), ungültiges Datum (22008);
// die Rückgaben laufen über dbFehlerText(). Wächter: scripts/check-fehlertext.js (prebuild).
//
// Aufruf:  npm run -s test:csv

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { uebersetzeDbMeldung, dbFehlerText, fehlerText } from '../../src/lib/fehler.ts'

const HIER = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(HIER, '..', '..')
const require = createRequire(import.meta.url)
const { pruefeText, pruefeWurzel } = require(path.join(HIER, '..', 'check-fehlertext.js'))
const zeilen = t => pruefeText(t).funde.map(f => f.zeile)

describe('Übersetzung der PostgreSQL-Standardfehler', () => {
  test('doppelter Eintrag, zu lang, leer/ungültig, Pflichtangabe, Überlauf, Datum', () => {
    assert.match(uebersetzeDbMeldung('duplicate key value violates unique constraint "kellermittel_tenant_name_key"'), /^Diesen Eintrag gibt es bereits/)
    assert.equal(uebersetzeDbMeldung('value too long for type character varying(30)'), 'Eine Eingabe ist zu lang – höchstens 30 Zeichen.')
    assert.equal(uebersetzeDbMeldung('invalid input syntax for type date: ""'), 'Eine Pflichtangabe ist leer – erwartet wird ein Datum.')
    assert.equal(uebersetzeDbMeldung('invalid input syntax for type numeric: "1,5"'), '„1,5“ ist ungültig – erwartet wird eine Zahl.')
    assert.equal(uebersetzeDbMeldung('null value in column "datum" of relation "fristen" violates not-null constraint'), 'Pflichtangabe fehlt: „datum“ (fristen).')
    assert.equal(uebersetzeDbMeldung('numeric field overflow'), 'Eine Zahl ist zu groß für dieses Feld.')
    assert.equal(uebersetzeDbMeldung('date/time field value out of range: "2026-13-01"'), '„2026-13-01“ ist kein gültiges Datum.')
  })

  test('mitten im Text, über dbFehlerText und fehlerText; Unbekanntes und deutsche Meldungen bleiben', () => {
    assert.equal(uebersetzeDbMeldung('Speichern fehlgeschlagen: value too long for type character varying(10)'), 'Speichern fehlgeschlagen: Eine Eingabe ist zu lang – höchstens 10 Zeichen.')
    assert.match(dbFehlerText({ code: '23505', message: 'duplicate key value violates unique constraint "x_key"' }, 'Speichern'), /^Speichern: Diesen Eintrag gibt es bereits/)
    assert.match(fehlerText(new Error('duplicate key value violates unique constraint "x_key"')), /^Diesen Eintrag gibt es bereits/)
    assert.equal(dbFehlerText({ code: 'P0001', message: 'Die Charge ist abgeschlossen.' }), 'Die Charge ist abgeschlossen.')
    assert.equal(uebersetzeDbMeldung('etwas ganz anderes'), 'etwas ganz anderes')
  })
})

describe('Wächter', () => {
  test('Erkennung', () => {
    assert.deepEqual(zeilen('  if (error) return { error: error.message }'), [1])
    assert.deepEqual(zeilen('x\n  return NextResponse.json({ fehler: dbErr.message }, { status: 500 })'), [2])
    assert.deepEqual(zeilen('  if (error) { setFehler(error.message); return }'), [1])
    assert.deepEqual(zeilen('  setMeldung(`Fehler – ${error.message}`)'), [1])
    assert.deepEqual(zeilen('  if (error) return { error: dbFehlerText(error) }'), [])
    assert.deepEqual(zeilen('  if (e instanceof JsmFehler) return NextResponse.json({ fehler: e.message })'), [])
    assert.deepEqual(zeilen('  // return { error: error.message }'), [])
    assert.deepEqual(zeilen('  // fehlertext-ok: Supabase-Auth-Meldung, kein Datenbankfehler\n  setFehler(error.message)'), [])
    assert.deepEqual(zeilen('  // fehlertext-ok: kurz\n  setFehler(error.message)'), [2])
  })

  test('Projekt: keine Rohmeldung; Weinexport-Route übersetzt', () => {
    assert.deepEqual(pruefeWurzel(ROOT).funde, [])
    assert.match(readFileSync(path.join(ROOT, 'src/app/api/weinexport/route.ts'), 'utf8'), /fehler: dbFehlerText\(error\)/)
  })
})
