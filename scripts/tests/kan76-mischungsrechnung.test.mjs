// KAN-76: Mischungsrechnung – Herkunftsanteile zeitrichtig (src/lib/wein/mischungsrechnung.ts).
// Die Musterhof-Datensätze aus dem Ticket hat der Demo-Reset vom 29.09.2026 entfernt; die Fälle sind mit
// denselben Zahlen nachgebaut.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  zusammensetzung, zusammensetzungEntnahme, sortenAnteile, jahrgangsAnteile, simuliere, vergleicheEreignisse,
} from '../../src/lib/wein/mischungsrechnung.ts'

const info = (rebsorte, jahrgang, weingarten_name, gst_nr) => ({
  typ: 'pressung', rebsorte, jahrgang, weingarten_name, gst_nr, katastralgemeinde: null, ernte_datum: null, kmw: null, zukauf_von: null,
})
const RR = { key: 'pf-rr', info: info('Riesling', 2025, 'Pfaffenberg Riesling', '512/1') }
const GV = { key: 'sg-gv', info: info('Grüner Veltliner', 2025, 'Sandgrube Grüner Veltliner', '1305/1') }
const ZW = { key: 'fr-zw', info: info('Zweigelt', 2025, 'Frechau Zweigelt', '2213/1') }
const SL = { key: 'fr-sl', info: info('St. Laurent', 2025, 'Frechau St. Laurent', '2214') }

let n = 0
const zugang = (charge, datum, h, liter, erfasst = null) => ({ art: 'zugang', id: `z${++n}`, datum, erfasst, charge, herkunft: [{ key: h.key, liter, info: h.info }] })
const abgang = (charge, datum, liter, grund = 'fuellung', bezug = null, erfasst = null) => ({ art: 'abgang', id: `a${++n}`, datum, erfasst, charge, liter, grund, bezug })
const uebertrag = (datum, quellen, ziele, grund = 'umzug', erfasst = null) => ({ art: 'uebertrag', id: `u${++n}`, datum, erfasst, grund, quellen, ziele })
const pct = z => z.anteile.map(a => [a.key, a.anteil_pct])

// Ticket-Beispiel „Riesling Ried Pfaffenberg“: 5.000 L (28.09.2025) − 4.500 L Füllung (20.06.2026) = 500 L;
// 50 L GV aus Stahltank 03 per Umzug in eine Zwischencharge (48 L nach Schwund), dann Verschnitt → 91,2 / 8,8 %
const ticketFall = () => [
  zugang('A', '2025-09-28', RR, 5000),
  zugang('G', '2025-09-20', GV, 3000),
  abgang('A', '2026-06-20', 4500, 'fuellung', 'F-CH-2026-012'),
  uebertrag('2026-09-25', [{ charge: 'G', liter: 50 }], [{ charge: 'Z', liter: 48 }], 'umzug', '2026-09-25T08:00:00Z'),
  uebertrag('2026-09-25', [{ charge: 'Z', liter: 48 }], [{ charge: 'A', liter: 48 }], 'verschnitt', '2026-09-25T09:00:00Z'),
]

test('Ticket-Fall: 91,2 % Riesling GST 512/1, 8,8 % GV GST 1305/1, ohne „Herkunft unbekannt“', () => {
  const z = zusammensetzung(ticketFall(), 'A', { gebuchterBestand: 548 })
  assert.deepEqual(pct(z), [['pf-rr', 91.2], ['sg-gv', 8.8]])
  assert.deepEqual(z.anteile.map(a => a.liter), [500, 48])
  assert.deepEqual(z.warnungen, [])
})

test('Füllung vor dem Verschnitt: 100 % Riesling (Zusammensetzung unmittelbar vor der Abfüllung)', () => {
  const f = zusammensetzungEntnahme(ticketFall(), 'F-CH-2026-012')
  assert.deepEqual(pct(f), [['pf-rr', 100]])
  assert.equal(Math.round(f.saldoLiter), 4500)
})

test('Stichtag: vor dem Verschnitt 100 % Riesling, nach dem Verschnitt 91,2 / 8,8', () => {
  assert.deepEqual(pct(zusammensetzung(ticketFall(), 'A', { stichtag: '2026-09-24' })), [['pf-rr', 100]])
  assert.deepEqual(pct(zusammensetzung(ticketFall(), 'A', { stichtag: '2026-09-25' })), [['pf-rr', 91.2], ['sg-gv', 8.8]])
})

test('Abgang nach dem Verschnitt ändert die Anteile nicht (anteilige Entnahme)', () => {
  const e = [...ticketFall(), abgang('A', '2026-10-01', 200, 'verkauf')]
  const z = zusammensetzung(e, 'A')
  assert.deepEqual(pct(z), [['pf-rr', 91.2], ['sg-gv', 8.8]])
  assert.ok(Math.abs(z.saldoLiter - 348) < 0.01)
})

test('Zweigelt Klassik: 85,9 / 14,1 – Folgecharge per Umzug mit denselben Anteilen statt „unbekannt“', () => {
  const e = [
    zugang('K', '2025-10-01', ZW, 1370),
    zugang('S', '2025-10-02', SL, 800),
    uebertrag('2025-11-10', [{ charge: 'S', liter: 225 }], [{ charge: 'K', liter: 225 }], 'verschnitt'),
    uebertrag('2026-02-01', [{ charge: 'K', liter: 1595 }], [{ charge: 'K2', liter: 1590 }], 'umzug'),   // 5 L Schwund
  ]
  assert.deepEqual(pct(zusammensetzung(e, 'K', { stichtag: '2026-01-31' })), [['fr-zw', 85.9], ['fr-sl', 14.1]])
  assert.deepEqual(pct(zusammensetzung(e, 'K2')), [['fr-zw', 85.9], ['fr-sl', 14.1]])
})

test('n:m-Umzug mit Schwund: Ziele bekommen die Poolmischung im Verhältnis ihrer Mengen', () => {
  const e = [
    zugang('Q1', '2025-10-01', RR, 600),
    zugang('Q2', '2025-10-01', GV, 400),
    uebertrag('2025-11-01', [{ charge: 'Q1', liter: 600 }, { charge: 'Q2', liter: 400 }], [{ charge: 'Z1', liter: 700 }, { charge: 'Z2', liter: 290 }]),
  ]
  const z1 = zusammensetzung(e, 'Z1'), z2 = zusammensetzung(e, 'Z2')
  assert.deepEqual(pct(z1), [['pf-rr', 60], ['sg-gv', 40]])
  assert.deepEqual(pct(z2), [['pf-rr', 60], ['sg-gv', 40]])
  assert.ok(Math.abs(z1.saldoLiter - 700) < 0.01 && Math.abs(z2.saldoLiter - 290) < 0.01)
})

test('mehrfacher Verschnitt und Kette Umzug → Verschnitt → Umzug', () => {
  const e = [
    zugang('A', '2025-10-01', RR, 1000),
    zugang('B', '2025-10-01', GV, 1000),
    zugang('C', '2025-10-01', ZW, 1000),
    uebertrag('2025-11-01', [{ charge: 'B', liter: 250 }], [{ charge: 'A', liter: 250 }], 'verschnitt'),   // A: 1000 RR + 250 GV
    abgang('A', '2025-12-01', 625, 'fuellung', 'F1'),                                                     // A: 500 RR + 125 GV
    uebertrag('2026-01-10', [{ charge: 'C', liter: 125 }], [{ charge: 'A', liter: 125 }], 'verschnitt'),   // + 125 ZW
    uebertrag('2026-02-01', [{ charge: 'A', liter: 750 }], [{ charge: 'D', liter: 750 }], 'umzug'),
  ]
  assert.deepEqual(pct(zusammensetzung(e, 'D')), [['pf-rr', 66.7], ['fr-zw', 16.7], ['sg-gv', 16.6]])
  assert.deepEqual(pct(zusammensetzungEntnahme(e, 'F1')), [['pf-rr', 80], ['sg-gv', 20]])
})

test('Zirkel A → B → A: jede Bewegung einmal, keine Endlosschleife, Mengen bleiben erhalten', () => {
  const e = [
    zugang('A', '2025-10-01', RR, 100),
    zugang('B', '2025-10-01', GV, 100),
    uebertrag('2025-11-01', [{ charge: 'A', liter: 50 }], [{ charge: 'B', liter: 50 }]),
    uebertrag('2025-11-02', [{ charge: 'B', liter: 75 }], [{ charge: 'A', liter: 75 }]),
  ]
  const a = zusammensetzung(e, 'A'), b = zusammensetzung(e, 'B')
  assert.ok(Math.abs(a.saldoLiter + b.saldoLiter - 200) < 1e-6)
  assert.deepEqual(pct(a), [['pf-rr', 60], ['sg-gv', 40]])   // A: 50 RR + (25 RR + 50 GV aus B) = 75 : 50
})

test('Bestand ≠ Saldo: Warnung, Liter auf den gebuchten Bestand bezogen; Fehlmenge bei Abgang > Bestand', () => {
  const z = zusammensetzung(ticketFall(), 'A', { gebuchterBestand: 600, name: 'Riesling Ried Pfaffenberg' })
  assert.match(z.warnungen.join(' '), /Bestand laut Kellerbuch 600 L, Saldo der Bewegungen 548 L – die Anteile beziehen sich auf den gebuchten Bestand/)
  assert.deepEqual(pct(z), [['pf-rr', 91.2], ['sg-gv', 8.8]])
  assert.ok(Math.abs(z.anteile.reduce((s, a) => s + a.liter, 0) - 600) <= 0.01)
  const zuViel = zusammensetzung([zugang('X', '2025-10-01', RR, 100), abgang('X', '2025-11-01', 130)], 'X')
  assert.match(zuViel.warnungen.join(' '), /Abgänge übersteigen den Bestand um 30 L/)
  const ohne = zusammensetzung([], 'Y', { gebuchterBestand: 50 })
  assert.deepEqual(ohne.anteile.map(a => [a.typ, a.anteil_pct]), [['unbekannt', 100]])
})

test('Summen: Anteile ergeben genau 100,0 %, Liter die Bezugsmenge (±0,01 L)', () => {
  const e = [zugang('A', '2025-10-01', RR, 1), zugang('A', '2025-10-01', GV, 1), zugang('A', '2025-10-01', ZW, 1)]
  const z = zusammensetzung(e, 'A', { gebuchterBestand: 3 })
  assert.equal(Math.round(z.anteile.reduce((s, a) => s + a.anteil_pct, 0) * 10), 1000)
  assert.ok(Math.abs(z.anteile.reduce((s, a) => s + a.liter, 0) - 3) <= 0.01)
  assert.deepEqual(z.anteile.map(a => a.anteil_pct).sort(), [33.3, 33.3, 33.4])
})

test('sortenAnteile / jahrgangsAnteile: absteigend, Gleichstand alphabetisch bzw. nach Jahr', () => {
  const e = [
    zugang('A', '2025-10-01', RR, 400),
    zugang('A', '2025-10-01', { key: 'rr-alt', info: info('Riesling', 2024, 'Steiner Hund', '488/3') }, 100),
    zugang('A', '2025-10-01', GV, 250),
    zugang('A', '2025-10-01', ZW, 250),
  ]
  const a = zusammensetzung(e, 'A').anteile
  assert.deepEqual(sortenAnteile(a).map(s => [s.wert, s.anteil_pct]), [['Riesling', 50], ['Grüner Veltliner', 25], ['Zweigelt', 25]])
  assert.deepEqual(jahrgangsAnteile(a).map(s => [s.wert, s.anteil_pct]), [['2025', 90], ['2024', 10]])
})

test('Reihenfolge am selben Tag: Erfassungszeit, dann Zugang vor Übertrag vor Abgang, dann ID', () => {
  const x = [
    abgang('A', '2026-01-01', 1, 'fuellung', null, '2026-01-01T10:00:00Z'),
    uebertrag('2026-01-01', [], [], 'umzug', '2026-01-01T09:00:00Z'),
    zugang('A', '2026-01-01', RR, 1, null),
    zugang('A', '', RR, 1, null),
  ].sort(vergleicheEreignisse).map(e => e.art)
  assert.deepEqual(x, ['zugang', 'uebertrag', 'abgang', 'zugang'])
  // Füllung am selben Tag vor dem Verschnitt erfasst → reiner Riesling in der Füllung
  const e = [
    zugang('A', '2026-01-01', RR, 100),
    zugang('G', '2026-01-01', GV, 100),
    abgang('A', '2026-02-01', 50, 'fuellung', 'F', '2026-02-01T08:00:00Z'),
    uebertrag('2026-02-01', [{ charge: 'G', liter: 50 }], [{ charge: 'A', liter: 50 }], 'verschnitt', '2026-02-01T09:00:00Z'),
  ]
  assert.deepEqual(pct(zusammensetzungEntnahme(e, 'F')), [['pf-rr', 100]])
  assert.equal(simuliere(e).fehlmengen.size, 0)
})
