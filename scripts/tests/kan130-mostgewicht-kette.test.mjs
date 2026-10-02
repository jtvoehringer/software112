// KAN-130 Etappe 2 (02.10.2026): Mostgewicht entlang der Kellerkette – Umzug, Zusammenführung, Verschnitt, Storno
//
// Aufruf:  node --experimental-strip-types --test scripts/tests/kan130-mostgewicht-kette.test.mjs
//          (läuft auch über npm run test:csv)
//
// Entscheidungen Jörgen 01.10.2026: mengengewichteter Mittelwert in °KMW (Liter über die Dichte, mischen()), auf
// 2 Stellen abgerundet; Anteile ohne Mostgewicht zählen nicht („teilweise“). Momentaufnahme für Storno/Ändern.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  mostgewichtNeu, mostgewichtZusammenfuehren, umzugMomentaufnahme, umzugRuecknahme,
  verschnittMomentaufnahme, verschnittRuecknahme, teilweiseVermerk,
} from '../../src/lib/kellerbuch/mostgewichtKette.ts'
import { mischen } from '../../src/lib/wein/mostgewicht.ts'

const quelle = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')
const charge = (kmw, oechsle = null, einheit = 'kmw') => ({ kmw, oechsle, mostgewicht_einheit: einheit })

describe('Neue Charge (Umzug in ein leeres Gebinde)', () => {
  test('eine Quelle: Messwert samt Einheit unverändert – auch °Oe bleibt °Oe', () => {
    const m = mostgewichtNeu([{ liter: 300, charge: charge(17.09, 84, 'oechsle') }])
    assert.deepEqual(m.spalten, { kmw: 17.09, oechsle: 84, mostgewicht_einheit: 'oechsle' })
    assert.equal(m.teilweise, false)
  })
  test('PostgREST liefert numeric als Text – wird als Zahl gelesen', () => {
    assert.deepEqual(mostgewichtNeu([{ liter: 1, charge: { kmw: '18.40', oechsle: '91.0', mostgewicht_einheit: 'kmw' } }]).spalten,
      { kmw: 18.4, oechsle: 91, mostgewicht_einheit: 'kmw' })
  })
  test('zwei Quellen mit verschiedenem Wert: Mittel in °KMW (Liter über die Dichte), Einheit kmw', () => {
    const m = mostgewichtNeu([{ liter: 500, charge: charge(14) }, { liter: 500, charge: charge(22) }])
    assert.deepEqual(m.spalten, { kmw: 18.07, oechsle: 89.2, mostgewicht_einheit: 'kmw' })
    // je 50 % nach MASSE ergibt 18,00 °KMW / 88,8 °Oe (Akzeptanzkriterium, Rechenkern)
    assert.deepEqual(mischen([{ menge: 50, kmw: 14 }, { menge: 50, kmw: 22 }]), { kmw: 18, oechsle: 88.8, einheit: 'kmw' })
  })
  test('Quelle ohne Mostgewicht: nur die mit Wert, „teilweise“; ohne jeden Wert: nichts', () => {
    const m = mostgewichtNeu([{ liter: 300, charge: charge(18.4) }, { liter: 100, charge: charge(null) }])
    assert.equal(m.spalten?.kmw, 18.4)
    assert.equal(m.teilweise, true)
    assert.match(teilweiseVermerk(m), /teilweise/)
    const leer = mostgewichtNeu([{ liter: 300, charge: charge(null) }])
    assert.equal(leer.spalten, null)
    assert.equal(teilweiseVermerk(leer), null)
  })
})

describe('Zusammenführung bzw. Verschnitt in eine bestehende Charge', () => {
  test('gleicher Wert: Charge bleibt unverändert (auch die gemessene Einheit °Oe)', () => {
    const z = mostgewichtZusammenfuehren(charge(17.09, 84, 'oechsle'), 1000, [{ liter: 200, charge: charge(17.09, 84.1) }])
    assert.equal(z.werte, null)
    assert.deepEqual(z.nachher, z.vorher)
  })
  test('verschiedene Werte: gewichtetes Mittel, Momentaufnahme vorher/nachher', () => {
    const ziel = charge(18, 88.8)
    const z = mostgewichtZusammenfuehren(ziel, 750, [{ liter: 250, charge: charge(22) }])
    assert.equal(z.werte?.mostgewicht_einheit, 'kmw')
    assert.ok(z.werte.kmw > 18 && z.werte.kmw < 22)
    assert.deepEqual(umzugMomentaufnahme(z), {
      kmw_vorher: 18, oechsle_vorher: 88.8, mostgewicht_einheit_vorher: 'kmw',
      kmw_nachher: z.werte.kmw, oechsle_nachher: z.werte.oechsle, mostgewicht_einheit_nachher: 'kmw',
    })
  })
  test('Ziel ohne Mostgewicht, Zugang mit: Wert des Zugangs, „teilweise“', () => {
    const z = mostgewichtZusammenfuehren(charge(null), 900, [{ liter: 100, charge: charge(19) }])
    assert.equal(z.werte?.kmw, 19)
    assert.equal(z.teilweise, true)
    assert.equal(z.vorher.kmw, null)
  })
  test('Verschnitt-Momentaufnahme hat immer eine Einheit (Kennzeichen für den Storno)', () => {
    assert.deepEqual(verschnittMomentaufnahme(charge(null)), { ziel_kmw_vorher: null, ziel_oechsle_vorher: null, ziel_mostgewicht_einheit_vorher: 'kmw' })
  })
})

describe('Storno und „Umzug ändern“', () => {
  const zeile = {
    kmw_vorher: 18, oechsle_vorher: 88.8, mostgewicht_einheit_vorher: 'kmw',
    kmw_nachher: 19, oechsle_nachher: 94.2, mostgewicht_einheit_nachher: 'kmw',
  }
  test('Umzug: zurück auf „vorher“, solange die Charge noch auf „nachher“ steht', () => {
    assert.deepEqual(umzugRuecknahme(zeile, charge(19, 94.2)), { kmw: 18, oechsle: 88.8, mostgewicht_einheit: 'kmw' })
  })
  test('Umzug: seither geändertes Mostgewicht bleibt; alte Zeilen ohne Momentaufnahme bleiben unverändert', () => {
    assert.equal(umzugRuecknahme(zeile, charge(19.5)), null)
    assert.equal(umzugRuecknahme({ kmw_vorher: null, kmw_nachher: null }, charge(19)), null)
  })
  test('Umzug: gemessene °Oe kommen samt Einheit zurück; vorher ohne Wert → beide Spalten leer', () => {
    assert.deepEqual(umzugRuecknahme({ ...zeile, kmw_vorher: 17.09, oechsle_vorher: 84, mostgewicht_einheit_vorher: 'oechsle' }, charge(19)),
      { kmw: 17.09, oechsle: 84, mostgewicht_einheit: 'oechsle' })
    assert.deepEqual(umzugRuecknahme({ ...zeile, kmw_vorher: null, oechsle_vorher: null }, charge(19)),
      { kmw: null, oechsle: null, mostgewicht_einheit: 'kmw' })
  })
  test('Verschnitt: Momentaufnahme zurück; Verschnitte vor KAN-130 Etappe 2 unverändert', () => {
    assert.deepEqual(verschnittRuecknahme({ ziel_kmw_vorher: '17.09', ziel_oechsle_vorher: '84.0', ziel_mostgewicht_einheit_vorher: 'oechsle' }),
      { kmw: 17.09, oechsle: 84, mostgewicht_einheit: 'oechsle' })
    assert.equal(verschnittRuecknahme({ ziel_kmw_vorher: null, ziel_mostgewicht_einheit_vorher: null }), null)
  })
})

describe('Verdrahtung (Quelltext)', () => {
  test('umziehen(): Zusammenführung mischt und schreibt die Momentaufnahme, neue Chargen bekommen das Mostgewicht', () => {
    const q = quelle('src/app/(dashboard)/kellerbuch/umziehen/actions.ts')
    assert.match(q, /mostgewichtZusammenfuehren\(vorhanden, parseFloat\(vorhanden\.menge_liter\) \|\| 0, anteileFuer\(z\.menge\)\)/)
    assert.match(q, /\.\.\.\(mg\.werte \?\? \{\}\)/)
    assert.equal((q.match(/\.\.\.mostgewichtFuerNeu\(anteileFuer\(z\.menge\), zielVermerke\)/g) ?? []).length, 2)
    assert.match(q, /\.\.\.mostgewichtSnapshot,/)
  })
  test('Gebinde-Umzug (Bearbeiten) macht dasselbe', () => {
    const q = quelle('src/app/(dashboard)/kellerbuch/gebinde-actions.ts')
    assert.match(q, /mostgewichtZusammenfuehren\(existing, altMenge, umzugAnteile\(e, quellCharge, z\.menge_netto\)\)/)
    assert.match(q, /mostgewichtNeu\(umzugAnteile\(e, quellCharge, z\.menge_netto\)\)/)
    assert.match(q, /\.\.\.mostgewichtSnapshot,/)
  })
  test('Verschnitt: Mittel über Ziel und Quellen, Momentaufnahme am Verschnitt', () => {
    const q = quelle('src/app/(dashboard)/kellerbuch/actions.ts')
    assert.match(q, /\.\.\.verschnittMomentaufnahme\(zielVorher\)/)
    assert.match(q, /const mg = mostgewichtZusammenfuehren\(zielVorher, aktuell,/)
  })
  test('Storno lädt die Momentaufnahmen und das Mostgewicht der Chargen (auch für die Rücknahme bei Fehlern)', () => {
    const q = quelle('src/lib/kellerbuch/storno.ts')
    assert.match(q, /kmw_vorher, kmw_nachher, oechsle_vorher, oechsle_nachher, mostgewicht_einheit_vorher, mostgewicht_einheit_nachher'/)
    assert.match(q, /ziel_kmw_vorher, ziel_oechsle_vorher, ziel_mostgewicht_einheit_vorher/)
    assert.match(q, /notizen, kmw, oechsle, mostgewicht_einheit[,']/)
    assert.match(q, /umzugRuecknahme\(z, c\)/)
    assert.match(q, /verschnittRuecknahme\(v\)/)
  })
})
