// KAN-156 (29.09.2026): Kunden- und Sonderrabatt im Verkaufsformular – src/lib/verkauf/rabatt.ts
// (genutzt von weinhandel/verkauf/neu/page.tsx). Der Ablauf der Seite (Kunde wählen, Produkt
// hinzufügen) ist unten mit denselben Funktionen nachgebaut wie in der Seite.
//
// Aufruf: npm run -s test:csv

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  OHNE_KUNDENRABATT, rabattFuerNeuePosition, wirksamerRabatt, wirksamerSonderrabatt,
  zeilenBetrag, gesamtBetrag,
} from '../../src/lib/verkauf/rabatt.ts'

// ── Nachbau des Formularzustands (wie page.tsx) ──────────────────────────────
function leerePosition(extra = {}) {
  return {
    preis_brutto: '', menge: '1',
    rabatt_pct: '0', rabatt_aktiv: false, sonderrabatt: '0', sonderrabatt_aktiv: false,
    ...extra,
  }
}
function formular() {
  return { kunde: OHNE_KUNDENRABATT, positionen: [leerePosition()] }
}
/** onChange der Kundensuche: Konditionen merken und auf ALLE Positionen anwenden */
function kundeWaehlen(f, konditionen) {
  const felder = rabattFuerNeuePosition(konditionen)
  return { kunde: konditionen, positionen: f.positionen.map(p => ({ ...p, ...felder })) }
}
/** Kundenauswahl leeren: Konditionen zurücksetzen, Positionen bleiben unverändert (wie bisher) */
function kundeLeeren(f) {
  return { ...f, kunde: OHNE_KUNDENRABATT }
}
/** addPosition(): neue Position mit den Konditionen des gewählten Kunden */
function positionHinzufuegen(f) {
  return { ...f, positionen: [...f.positionen, { ...leerePosition(), ...rabattFuerNeuePosition(f.kunde) }] }
}

const cent = x => Math.round(x * 100) / 100

describe('rabattFuerNeuePosition', () => {
  test('Kunde mit 10 % Rabattgruppe → Rabatt vorbelegt und aktiv', () => {
    assert.deepEqual(rabattFuerNeuePosition({ rabatt_pct: 10, sonderrabatt_pct: 0 }), {
      rabatt_pct: '10', rabatt_aktiv: true, sonderrabatt: '0', sonderrabatt_aktiv: false,
    })
  })
  test('Sonderrabatt des Kunden → Sonderrabatt vorbelegt und aktiv', () => {
    assert.deepEqual(rabattFuerNeuePosition({ rabatt_pct: 0, sonderrabatt_pct: 5 }), {
      rabatt_pct: '0', rabatt_aktiv: false, sonderrabatt: '5', sonderrabatt_aktiv: true,
    })
  })
  test('Kunde ohne Rabatt → nichts aktiv', () => {
    assert.deepEqual(rabattFuerNeuePosition(OHNE_KUNDENRABATT), {
      rabatt_pct: '0', rabatt_aktiv: false, sonderrabatt: '0', sonderrabatt_aktiv: false,
    })
  })
  test('Dezimalwerte bleiben erhalten', () => {
    const r = rabattFuerNeuePosition({ rabatt_pct: 7.5, sonderrabatt_pct: 2.5 })
    assert.equal(r.rabatt_pct, '7.5')
    assert.equal(r.sonderrabatt, '2.5')
  })
})

describe('Ablauf im Formular', () => {
  test('Kunde 10 % wählen, dann Position hinzufügen → neue Position hat 10 %', () => {
    let f = kundeWaehlen(formular(), { rabatt_pct: 10, sonderrabatt_pct: 0 })
    f = positionHinzufuegen(f)
    assert.equal(f.positionen.length, 2)
    for (const p of f.positionen) {
      assert.equal(p.rabatt_pct, '10')
      assert.equal(p.rabatt_aktiv, true)
      assert.equal(wirksamerRabatt(p), 10)
    }
  })

  test('Sonderrabatt des Kunden gilt auch für später hinzugefügte Positionen', () => {
    let f = kundeWaehlen(formular(), { rabatt_pct: 10, sonderrabatt_pct: 3 })
    f = positionHinzufuegen(positionHinzufuegen(f))
    assert.equal(f.positionen.length, 3)
    for (const p of f.positionen) {
      assert.equal(wirksamerRabatt(p), 10)
      assert.equal(wirksamerSonderrabatt(p), 3)
    }
  })

  test('Kunde ohne Rabatt → neue Position ohne Rabatt', () => {
    let f = kundeWaehlen(formular(), OHNE_KUNDENRABATT)
    f = positionHinzufuegen(f)
    assert.equal(wirksamerRabatt(f.positionen[1]), 0)
    assert.equal(wirksamerSonderrabatt(f.positionen[1]), 0)
  })

  test('ohne gewählten Kunden → neue Position ohne Rabatt', () => {
    const f = positionHinzufuegen(formular())
    assert.equal(f.positionen[1].rabatt_aktiv, false)
    assert.equal(f.positionen[1].sonderrabatt_aktiv, false)
  })

  test('Kundenwechsel aktualisiert alle Positionen, danach hinzugefügte bekommen den neuen Rabatt', () => {
    let f = kundeWaehlen(formular(), { rabatt_pct: 10, sonderrabatt_pct: 5 })
    f = positionHinzufuegen(f)
    f = kundeWaehlen(f, { rabatt_pct: 15, sonderrabatt_pct: 0 })
    f = positionHinzufuegen(f)
    assert.equal(f.positionen.length, 3)
    for (const p of f.positionen) {
      assert.equal(wirksamerRabatt(p), 15)
      assert.equal(wirksamerSonderrabatt(p), 0)
    }
    // Wechsel zu einem Kunden ohne Rabatt nimmt den Rabatt überall weg
    f = kundeWaehlen(f, OHNE_KUNDENRABATT)
    for (const p of f.positionen) assert.equal(wirksamerRabatt(p), 0)
  })

  test('Kundenauswahl leeren: bestehende Positionen bleiben, neue ohne Rabatt', () => {
    let f = kundeWaehlen(formular(), { rabatt_pct: 10, sonderrabatt_pct: 0 })
    f = positionHinzufuegen(kundeLeeren(f))
    assert.equal(wirksamerRabatt(f.positionen[0]), 10)
    assert.equal(wirksamerRabatt(f.positionen[1]), 0)
  })
})

describe('zeilenBetrag / gesamtBetrag', () => {
  test('Kundenrabatt und Sonderrabatt multiplikativ', () => {
    const p = leerePosition({ preis_brutto: '20', menge: '6', ...rabattFuerNeuePosition({ rabatt_pct: 10, sonderrabatt_pct: 5 }) })
    assert.equal(cent(zeilenBetrag(p)), 102.6) // 20 · 0,9 · 0,95 · 6
  })

  test('rabatt_aktiv aus → Zeilensumme ohne Kundenrabatt', () => {
    const p = leerePosition({ preis_brutto: '20', menge: '6', rabatt_pct: '10', rabatt_aktiv: false })
    assert.equal(zeilenBetrag(p), 120)
    assert.equal(wirksamerRabatt(p), 0)
  })

  test('sonderrabatt_aktiv aus → Zeilensumme ohne Sonderrabatt', () => {
    const p = leerePosition({ preis_brutto: '20', menge: '6', sonderrabatt: '5', sonderrabatt_aktiv: false })
    assert.equal(zeilenBetrag(p), 120)
  })

  test('leere oder ungültige Eingaben zählen als 0', () => {
    assert.equal(zeilenBetrag(leerePosition()), 0)
    assert.equal(zeilenBetrag(leerePosition({ preis_brutto: '12', menge: '' })), 0)
    assert.equal(zeilenBetrag(leerePosition({ preis_brutto: '12', menge: '2', rabatt_pct: '', rabatt_aktiv: true })), 24)
  })

  test('Summe der Zeilen = Gesamtsumme', () => {
    const positionen = [
      leerePosition({ preis_brutto: '12.90', menge: '6', ...rabattFuerNeuePosition({ rabatt_pct: 10, sonderrabatt_pct: 0 }) }),
      leerePosition({ preis_brutto: '8.50', menge: '12', rabatt_pct: '10', rabatt_aktiv: false }),
      leerePosition({ preis_brutto: '3.20', menge: '100', rabatt_pct: '10', rabatt_aktiv: true, sonderrabatt: '2.5', sonderrabatt_aktiv: true }),
      leerePosition(),
    ]
    const summeZeilen = positionen.reduce((s, p) => s + zeilenBetrag(p), 0)
    assert.equal(gesamtBetrag(positionen), summeZeilen)
    assert.equal(cent(gesamtBetrag(positionen)), cent(69.66 + 102 + 280.8))
    assert.equal(gesamtBetrag([]), 0)
  })
})
