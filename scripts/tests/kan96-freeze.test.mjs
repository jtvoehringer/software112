// KAN-96 (04.10.2026): Freeze-Sperren – die App liest den 42501-Fehler des Datenbank-Triggers s112_freeze (HINT
// 'freeze', DETAIL als JSON) und macht daraus eine verständliche Meldung; dbFehlerText reicht den deutschen Text durch.
//
// Aufruf:  npm run -s test:csv   bzw. node --experimental-strip-types --test scripts/tests/kan96-freeze.test.mjs

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { freezeSperreAus, sperrTitel, sperrMeldung } from '../../src/lib/freeze/sperre.ts'

const fehler = (details, extra = {}) => ({
  code: '42501', hint: 'freeze', message: 'Gesperrt: …', details: JSON.stringify(details), ...extra,
})
const D = { tabelle: 'pruefnummernantraege', grund: 'Prüfnummernantrag eingereicht', seit: '04.10.2026',
  erlaubt: ['notizen', 'status'], spalten: ['menge_liter'], aktion: 'UPDATE' }

describe('KAN-96 Freeze-Sperre aus dem Datenbankfehler', () => {
  test('erkennt die Sperre und liest alle Felder', () => {
    assert.deepEqual(freezeSperreAus(fehler(D)), D)
  })
  test('andere Fehler sind keine Sperre', () => {
    assert.equal(freezeSperreAus(null), null)
    assert.equal(freezeSperreAus({ code: '42501', message: 'new row violates row-level security policy' }), null)
    assert.equal(freezeSperreAus(fehler(D, { hint: 'abo_gesperrt' })), null)
    assert.equal(freezeSperreAus(fehler(D, { code: '23514' })), null)
    assert.equal(freezeSperreAus({ code: '42501', hint: 'freeze', details: 'kein json' }), null)
  })
  test('ohne Datum und beim Löschen', () => {
    const s = freezeSperreAus(fehler({ ...D, seit: null, aktion: 'DELETE', spalten: [] }))
    assert.equal(sperrTitel(s), 'Gesperrt: Prüfnummernantrag eingereicht')
    assert.equal(sperrMeldung(s), 'Gesperrt: Prüfnummernantrag eingereicht – Löschen ist nicht möglich.')
  })
  test('Meldung mit erlaubten und abgelehnten Feldern, Feldnamen übersetzbar', () => {
    const s = freezeSperreAus(fehler(D))
    const name = x => ({ notizen: 'Notizen', status: 'Status', menge_liter: 'Menge' })[x] ?? x
    assert.equal(sperrMeldung(s, name),
      'Gesperrt: Prüfnummernantrag eingereicht am 04.10.2026 – änderbar sind nur Notizen, Status (nicht: Menge). Weitere Korrekturen nur durch die Betriebsleitung.')
    assert.equal(sperrMeldung({ ...s, erlaubt: [] }),
      'Gesperrt: Prüfnummernantrag eingereicht am 04.10.2026 – keine Änderung möglich (menge_liter). Korrekturen nur durch die Betriebsleitung.')
  })
})
