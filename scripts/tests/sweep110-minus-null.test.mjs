// Sweep 110 (10.10.2026): keine „-0,00“ in der Anzeige.
// Befund: Rundungsreste aus Gleitkommarechnung (0,1 + 0,2 − 0,3 = 5,6e-17; Saldo nach Zahlung und Gegenbuchung, Behälter nach
// Umzug, Lagerstand) erschienen über toLocaleString als „€ -0,00“ bzw. „-0,00 L“. Jetzt behandeln alle Formathelfer
// (fmtNum, fmtEur, fmtLiter, fmtMenge, fmtHa, fmtEuro, fmtProzent, fmtZahl) und zahlLokal() Werte, die zu 0 gerundet
// würden, als 0. 22 direkte toLocaleString(ZAHL_LOCALE)-Aufrufe laufen über zahlLokal(); check-zahl-locale meldet neue.
// Die CSV-Ausgabe (rundeText) kannte das schon.
//
// Aufruf:  npm run -s test:csv

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fmtEur, fmtNum, fmtLiter, fmtMenge, fmtHa, fmtProzent, fmtZahl, zahlLokal, ohneMinusNull } from '../../src/lib/format.ts'
import { rundeText } from '../../src/lib/csv/index.ts'

const rest = 0.1 + 0.2 - 0.3   // 5,551115123125783e-17

test('Rundungsreste ohne Minuszeichen', () => {
  assert.equal(fmtEur(-rest), '€ 0,00')
  assert.equal(fmtNum(-0.0004, 2), '0,00')
  assert.equal(fmtLiter(-0.001), '0,00 L')
  assert.equal(fmtMenge(-0.004), '0,00')
  assert.equal(fmtHa(-0.00001), '0,0000')
  assert.equal(fmtProzent(-0.01), '0,0')
  assert.equal(fmtZahl(-0.0001), '0')
  assert.match(zahlLokal(-rest, { style: 'currency', currency: 'EUR' }), /^0,00\s€$/)   // Intl setzt ein geschütztes Leerzeichen
})

test('echte negative Werte bleiben negativ (kaufmännisch gerundet)', () => {
  assert.equal(fmtEur(-0.01), '€ -0,01')
  assert.equal(fmtEur(-0.005), '€ -0,01')
  assert.equal(fmtEur(-1234.5), '€ -1.234,50')
  assert.equal(fmtLiter(-12.5), '-12,50 L')
})

test('ohneMinusNull und CSV verhalten sich gleich', () => {
  assert.equal(ohneMinusNull(-0.004, 2), 0)
  assert.equal(ohneMinusNull(-0.006, 2), -0.006)
  assert.equal(rundeText(-rest, 2), '0.00')
})
