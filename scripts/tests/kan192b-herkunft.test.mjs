// KAN-192 Etappe B (03.10.2026): Herkunft laut Bewegungsjournal (Sicht charge_herkunft) und Abgleich mit der
// Mischungsrechnung (Zugänge je Quell-Charge)
//
// Aufruf:  node --experimental-strip-types --test scripts/tests/kan192b-herkunft.test.mjs

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { verdichteHerkunft, zugaengeLautRechnung, vergleicheHerkunft } from '../../src/lib/kellerbuch/herkunft.ts'

const quelle = f => readFileSync(new URL(`../../${f}`, import.meta.url), 'utf8')
const z = (beleg, datum, art, nach, von, liter, x = {}) => ({
  beleg_nr: beleg, datum, art, nach_weinausbau_id: nach, nach_fuellung_id: null, von_weinausbau_id: von, liter, gegenbuchung: false, ...x,
})

const ZEILEN = [
  z(1, '2026-09-20', 'ERNTE', 'C', null, 1000),
  z(2, '2026-09-25', 'UMZUG', 'C', 'A', 300),
  z(3, '2026-10-01', 'VS_ZU', 'C', 'A', '200.000'),
  z(4, '2026-10-01', 'VS_ZU', 'C', 'B', 100),
  // Storno des Umzugs aus B (Gegenbuchung) → netto 0, entfällt
  z(5, '2026-10-02', 'UMZUG', 'C', 'B', 50),
  z(6, '2026-10-03', 'UMZUG', 'C', 'B', -50, { gegenbuchung: true }),
  // Abgänge
  z(7, '2026-10-05', 'FUELLUNG', null, 'C', 750, { nach_fuellung_id: 'F' }),
  z(8, '2026-10-06', 'UMZUG', 'D', 'C', 400),
  // fremde Kante (Charge nicht beteiligt)
  z(9, '2026-10-06', 'UMZUG', 'X', 'Y', 10),
]

test('verdichten: Wurzeln, Vorgänger netto je Charge, Nachfolger je Charge/Füllung', () => {
  const v = verdichteHerkunft(ZEILEN, 'C')
  assert.deepEqual(v.wurzeln.map(k => [k.arten.join(), k.liter]), [['ERNTE', 1000]])
  assert.deepEqual(v.vorgaenger.map(k => [k.chargeId, k.liter, k.arten.join(), k.belege, k.erstes, k.letztes]),
    [['A', 500, 'UMZUG,VS_ZU', 2, '2026-09-25', '2026-10-01'], ['B', 100, 'VS_ZU,UMZUG', 3, '2026-10-01', '2026-10-03']])
  assert.deepEqual(v.nachfolger.map(k => [k.chargeId, k.fuellungId, k.liter]), [[null, 'F', 750], ['D', null, 400]])
})

test('Mischungsrechnung: Zugänge je Quelle ab Journalbeginn, n:m nach Quell-Litern', () => {
  const ereignisse = [
    { art: 'uebertrag', id: 'ku:1', datum: '2026-08-01', erfasst: null, grund: 'umzug', quellen: [{ charge: 'A', liter: 999 }], ziele: [{ charge: 'C', liter: 999 }] },   // vor dem Journal
    { art: 'uebertrag', id: 'ub:2', datum: '2026-09-25', erfasst: null, grund: 'umzug', quellen: [{ charge: 'A', liter: 310 }], ziele: [{ charge: 'C', liter: 300 }] },
    { art: 'uebertrag', id: 'vs:3', datum: '2026-10-01', erfasst: null, grund: 'verschnitt', quellen: [{ charge: 'A', liter: 200 }, { charge: 'B', liter: 100 }], ziele: [{ charge: 'C', liter: 300 }] },
    { art: 'uebertrag', id: 'ub:4', datum: '2026-10-06', erfasst: null, grund: 'umzug', quellen: [{ charge: 'C', liter: 400 }], ziele: [{ charge: 'D', liter: 400 }] },
  ]
  const r = zugaengeLautRechnung(ereignisse, 'C', '2026-09-01')
  assert.deepEqual([...r], [['A', 500], ['B', 100]])
  assert.deepEqual(vergleicheHerkunft(verdichteHerkunft(ZEILEN, 'C').vorgaenger, r), [])
  // Abweichung ab Toleranz
  const ab = vergleicheHerkunft(verdichteHerkunft(ZEILEN, 'C').vorgaenger, new Map([['A', 499.6], ['B', 98], ['Q', 1]]))
  assert.deepEqual(ab.map(a => [a.chargeId, a.differenz]), [['B', 2], ['Q', -1]])
})

test('Karte auf der Chargen-Seite: nur bei eröffnetem Journal, Sicht + Abgleich', () => {
  const k = quelle('src/app/(dashboard)/kellerbuch/weinausbau/[id]/HerkunftJournalKarte.tsx')
  assert.match(k, /if \(!beginn\) return null/)
  assert.match(k, /zugaengeLautRechnung\(graph\.ereignisse, chargeId, beginn\)/)
  const p = quelle('src/app/(dashboard)/kellerbuch/weinausbau/[id]/page.tsx')
  assert.match(p, /<HerkunftJournalKarte supabase=\{supabase\} tenantId=\{tenantId\} chargeId=\{weinausbau\.id\} \/>/)
})
