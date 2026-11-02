// KAN-394 Nachtrag (02.11.2026, Abnahme Schritt 2 „Menge falsch“): Eine Lesemenge ohne Grundstück („ganzer
// Weingarten“) ist anteilig (Fläche) auf die Grundstücke der Ried zu verteilen (Entscheidung Jörgen). Anzeige
// (Pressungsformular, Traubenverkauf, Verkauf-Stammdaten) und Sperre beim Speichern rechnen gleich.
//
// Aufruf:  npm run -s test:csv   (alle scripts/tests/*.test.mjs)

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { gstDerRiedJeLese, leseOrtSchluessel, neueUeberdeckungen, riedLeseVerteilen, verfuegbarJeLese } from '../../src/lib/wein/leseBilanz.ts'

const WURZEL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const quelle = (p) => readFileSync(path.join(WURZEL, p), 'utf8').replace(/\r\n/g, '\n')

const z = (wg, gst, kg, lese = 'L1') => ({ lese_id: lese, weingarten_id: wg, grundstueck_id: gst, kg })
// Musterhof, Wachtberg Weißburgunder, Lese 2026/1: 977/1 0,8 ha, 977/2 0,6 ha
const GST = [{ id: 'g1', flaeche_ha: 0.8 }, { id: 'g2', flaeche_ha: 0.6 }]
const wachtberg = () => riedLeseVerteilen([z('w1', null, 4000), z('w1', 'g1', 5000)], () => GST)

describe('KAN-394: Lese ohne GST anteilig auf die GST der Ried', () => {
  test('nach Fläche verteilt, Ried-Summe exakt (Rest an das letzte Grundstück)', () => {
    const v = wachtberg()
    assert.deepEqual(v.map(r => [r.grundstueck_id, r.kg]), [['g1', 2285.71], ['g2', 1714.29], ['g1', 5000]])
    assert.equal(v.filter(r => r.grundstueck_id !== null).length, 3)
    const drittel = riedLeseVerteilen([z('w1', null, 100)], () => [{ id: 'a', flaeche_ha: 1 }, { id: 'b', flaeche_ha: 1 }, { id: 'c', flaeche_ha: 1 }])
    assert.deepEqual(drittel.map(r => r.kg), [33.33, 33.33, 33.34])
  })
  test('ohne vollständige Flächen zu gleichen Teilen; ohne Grundstücke oder ohne Menge unverändert', () => {
    assert.deepEqual(riedLeseVerteilen([z('w1', null, 1000)], () => [{ id: 'a', flaeche_ha: 0.5 }, { id: 'b', flaeche_ha: null }]).map(r => r.kg), [500, 500])
    const ohne = [z('w1', null, 1000), z('w2', null, null)]
    assert.deepEqual(riedLeseVerteilen(ohne, r => (r.weingarten_id === 'w1' ? [] : GST)), ohne)
  })
  test('Regression Wachtberg: GST 977/1 hat 3.285,71 kg frei (vorher 1.000), die Ried 5.000', () => {
    const verf = verfuegbarJeLese(wachtberg(), [z('w1', 'g1', 4000)])
    assert.equal(verf.ried.get(leseOrtSchluessel('L1', 'w1')), 5000)
    assert.equal(verf.gst.get(leseOrtSchluessel('L1', 'g1')), 3285.71)
    assert.equal(verf.gst.get(leseOrtSchluessel('L1', 'g2')), 1714.29)
    // ohne Verteilung (alter Stand) wären es 1.000 kg und für 977/2 nichts
    const alt = verfuegbarJeLese([z('w1', null, 4000), z('w1', 'g1', 5000)], [z('w1', 'g1', 4000)])
    assert.equal(alt.gst.get(leseOrtSchluessel('L1', 'g1')), 1000)
  })
  test('ein Grundstück zeigt nie mehr als seine Ried (Verbrauch „ganzer Weingarten“)', () => {
    const verf = verfuegbarJeLese(wachtberg(), [z('w1', 'g1', 4000), z('w1', null, 4500)])
    assert.equal(verf.ried.get(leseOrtSchluessel('L1', 'w1')), 500)
    assert.equal(verf.gst.get(leseOrtSchluessel('L1', 'g1')), 500)
  })
  test('Sperre: 3.285,71 kg aus GST 977/1 gehen, 3.286 kg nicht; 5.000 kg „ganzer Weingarten“ gehen', () => {
    const gelesen = wachtberg()
    const andere = [z('w1', 'g1', 4000)]
    assert.equal(neueUeberdeckungen({ gelesen, andere, vorher: [], nachher: [z('w1', 'g1', 3285.71)] }).length, 0)
    const ue = neueUeberdeckungen({ gelesen, andere, vorher: [], nachher: [z('w1', 'g1', 3286)] })
    assert.deepEqual([ue[0].art, ue[0].grundstueck_id], ['gst', 'g1'])
    assert.equal(neueUeberdeckungen({ gelesen, andere, vorher: [], nachher: [z('w1', null, 5000)] }).length, 0)
    assert.equal(neueUeberdeckungen({ gelesen, andere, vorher: [], nachher: [z('w1', null, 5001)] })[0].art, 'ried')
  })
  test('gstDerRiedJeLese: nur Weinbau, im Jahr des Jahrgangs bewirtschaftet, Lese ohne Jahr → keine', () => {
    const f = gstDerRiedJeLese([
      { id: 'a', weingarten_id: 'w1', flaeche_ha: 0.5, nutzart: 'WI', aktiv: true },
      { id: 'b', weingarten_id: 'w1', flaeche_ha: 0.5, nutzart: 'WI', aktiv: false, deaktiviert_am: '2026-03-01' },
      { id: 'c', weingarten_id: 'w1', flaeche_ha: 0.5, nutzart: 'WI', aktiv: false, deaktiviert_am: '2025-06-01' },
      { id: 'd', weingarten_id: 'w1', flaeche_ha: 0.5, nutzart: 'OB', aktiv: true },
    ], id => (id === 'L1' ? 2026 : null))
    assert.deepEqual(f(z('w1', null, 1)).map(g => g.id), ['a', 'b'])
    assert.deepEqual(f(z('w1', null, 1, 'L9')), [])
  })
})

describe('KAN-394: Verdrahtung', () => {
  test('Sperre lädt die Grundstücke und verteilt (mit Jahrgang)', () => {
    const s = quelle('src/lib/wein/leseBilanz.ts')
    assert.match(s, /gelesen: riedLeseVerteilen\(gelesen, z => gstJeRied\.get/)
    assert.match(s, /ladeLeseVerbrauch\(supabase, tenantId, jahrgangId, lese\.id, jahrgang\)/)
  })
  test('Pressungsformular: verteilte GST-Mengen, „ganzer Weingarten“ = Ried statt 0', () => {
    const k = quelle('src/app/(dashboard)/erntemeldung/[id]/leseKontext.ts')
    assert.match(k, /const gelesenVerteilt = riedLeseVerteilen\(/)
    assert.doesNotMatch(k, /for \(const p of parzellen\) \{\n\s+if \(p\.grundstueck_id && p\.menge_kg\)\n\s+harvestedKgByGST/)
    const p = quelle('src/app/(dashboard)/erntemeldung/[id]/PressungSection.tsx')
    assert.match(p, /return gstId \? \(verfuegbareKgByGST\[gstId\] \?\? 0\) : \(verfuegbareKgByRied\[riedId\] \?\? 0\)/)
    assert.match(quelle('src/app/(dashboard)/kellerbuch/pressungen/page.tsx'), /verfuegbareKgByRied=\{k\.verfuegbareKg\}/)
  })
  test('Traubenverkauf und Verkauf-Stammdaten verteilen ebenso', () => {
    for (const p of ['src/app/(dashboard)/weinhandel/traubenverkauf/TraubenverkaufClient.tsx', 'src/app/api/verkauf-stammdaten/route.ts']) {
      assert.match(quelle(p), /riedLeseVerteilen\(\s*[^]*?gstDerRiedJeLese\(/, p)
    }
  })
})
