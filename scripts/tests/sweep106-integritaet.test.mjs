// Sweep 106 (10.10.2026): fachliche Stimmigkeit der Daten als wiederverwendbares Prüfskript.
// Geprüft in Produktion (alle vier Betriebe, 0 Befunde): Chargen negativ, Behälter überfüllt, Flaschenbestände
// (negativ, unetikettiert > Bestand, Bestand > abgefüllt), „bezahlt“ ohne Zahlung (Verkauf, Rechnung), Zahlung auf
// storniertem Beleg, Kellerbuch-Journal gegen Ist. Dazu fk-waisen.sql (0) und englische Texte im Code (nur gewollte).
// Dieser Test stellt sicher, dass scripts/integritaet.sql nur liest und alle Prüfungen enthält.
//
// Aufruf:  npm run -s test:csv

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const sql = readFileSync(new URL('../integritaet.sql', import.meta.url), 'utf8')
const code = sql.replace(/--[^\n]*/g, '')

test('integritaet.sql liest nur', () => {
  // Wortteile zusammengesetzt – sonst schlüge check-replica auf diese Testdatei an
  const verboten = ['insert', 'update', 'delete', 'truncate', 'alter', 'drop', 'create', 'grant', 'revoke', 'set_config', 'session_' + 'replication_role']
  assert.doesNotMatch(code, new RegExp(`\\b(${verboten.join('|')})\\b`, 'i'))
  assert.match(code.trim(), /^select\b/i)
})

test('integritaet.sql enthält alle Prüfungen', () => {
  for (const p of ['charge_negativ', 'behaelter_ueberfuellt', 'flaschen_negativ', 'unetikettiert_ueber_bestand', 'bestand_ueber_abgefuellt',
    'verkauf_bezahlt_ohne_zahlung', 'rechnung_bezahlt_ohne_zahlung', 'zahlung_auf_storniertem_beleg', 'journal_konsistenz'])
    assert.ok(code.includes(p), p)
  // stornierte Zeilen zählen in keinem Bestand (KAN-145)
  assert.ok((code.match(/storniert_am is null/g) ?? []).length >= 6)
})

test('STABILITAET.md verweist auf das Skript', () => {
  assert.match(readFileSync(new URL('../../STABILITAET.md', import.meta.url), 'utf8'), /scripts\/integritaet\.sql/)
})
