// E2E-Ausbau (10.10.2026): CSV-Leser der E2E-Tests (e2e/csv-lesen.ts) – Profil Excel-AT zurücklesen.
//
// Aufruf:  npm run -s test:csv

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { csvTabelle, zahlDe, spaltenSumme } from '../../e2e/csv-lesen.ts'

test('BOM, Semikolon, CRLF, Anführungszeichen mit ; und ""', () => {
  const t = csvTabelle('﻿Ried;Cu (kg);Notiz\r\nHohenberg;1,2500;"a;b"\r\nSteinbiß;0,7500;"sagt ""hallo"""\r\n')
  assert.deepEqual(t.kopf, ['Ried', 'Cu (kg)', 'Notiz'])
  assert.deepEqual(t.zeilen[0], ['Hohenberg', '1,2500', 'a;b'])
  assert.equal(t.zeilen[1][2], 'sagt "hallo"')
  assert.equal(spaltenSumme(t, 'Cu (kg)'), 2)
})

test('Zahlen der Druckseite und der CSV', () => {
  assert.equal(zahlDe('1.234,5678 kg'), 1234.5678)
  assert.equal(zahlDe('0,4500 kg/ha'), 0.45)
  assert.equal(zahlDe('-12,5'), -12.5)
  assert.equal(zahlDe(''), 0)
  assert.equal(zahlDe('–'), 0)
  assert.throws(() => zahlDe('abc'), /keine Zahl/)
})

test('unbekannte Spalte wirft mit Liste der vorhandenen', () => {
  assert.throws(() => spaltenSumme(csvTabelle('A;B\r\n1;2\r\n'), 'C'), /Spalte „C“ fehlt – vorhanden: A \| B/)
})
