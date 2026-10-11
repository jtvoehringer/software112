// KAN-324 (UAT 11.10.2026): Maßnahmenliste mit dem neuesten Datum oben, umschaltbar auf chronologisch.
// Bisher fest chronologisch (älteste oben, Rückmeldung 30.09.2026); Entscheidung Jörgen 11.10.2026: neueste oben als
// Vorgabe, Umschalter in der Liste, Wahl im Browser gespeichert.
//
// Aufruf:  npm run -s test:csv

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { nachDatumGruppiert, richtungAus, RICHTUNG_VORGABE } from '../../src/lib/behandlungen/sortierung.ts'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const liste = [
  { id: 'a', datum: '2026-05-10' }, { id: 'b', datum: '2026-07-01' }, { id: 'c', datum: '2026-05-10' }, { id: 'd', datum: '2026-06-15' },
]

test('Vorgabe: neueste oben', () => {
  assert.equal(RICHTUNG_VORGABE, 'neueste')
  assert.deepEqual(nachDatumGruppiert(liste, RICHTUNG_VORGABE).map(([d]) => d), ['2026-07-01', '2026-06-15', '2026-05-10'])
})

test('umgeschaltet: älteste oben; Einträge eines Tages behalten ihre Reihenfolge', () => {
  const g = nachDatumGruppiert(liste, 'aelteste')
  assert.deepEqual(g.map(([d]) => d), ['2026-05-10', '2026-06-15', '2026-07-01'])
  assert.deepEqual(g[0][1].map(e => e.id), ['a', 'c'])
})

test('gespeicherter Wert: nur bekannte Richtungen, sonst Vorgabe', () => {
  assert.equal(richtungAus('aelteste'), 'aelteste')
  assert.equal(richtungAus('neueste'), 'neueste')
  for (const w of [null, undefined, '', 'asc', 'ÄLTESTE']) assert.equal(richtungAus(w), 'neueste', String(w))
})

test('die Liste gruppiert über nachDatumGruppiert mit Umschalter, nicht mehr fest chronologisch', () => {
  const quelle = readFileSync(path.join(ROOT, 'src', 'app', '(dashboard)', 'behandlungen', 'BehandlungenClient.tsx'), 'utf8')
  assert.match(quelle, /nachDatumGruppiert\(gefiltert, richtung\)/)
  assert.match(quelle, /onClick=\{richtungWechseln\}/)
  assert.doesNotMatch(quelle, /function groupByDate/)
})
