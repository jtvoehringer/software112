// KAN-129 Etappe 4: Eiswein-Stufe aus der Lese-Art (Soll 2), Ersatz-Lesedatum der Rückverfolgung je Lese
// (Soll 7), Weinbuch nur aus den Lesen der Charge (Soll 8).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { register } from 'node:module'
import { EISWEIN_MIN_KMW, eisweinHinweis, leseStufe } from '../../src/lib/wein/lesen.ts'

register('./ernte.aufloesung.mjs', import.meta.url)
const fenster = await import('../../src/lib/behoerden/rueckverfolgungFenster.ts')

test('Eiswein-Lese: Stufe Eiswein statt Ableitung, Hinweis unter 25 °KMW', () => {
  assert.equal(leseStufe('eiswein', 'beerenauslese'), 'eiswein')
  assert.equal(leseStufe('hauptlese', 'kabinett'), 'kabinett')
  assert.equal(leseStufe(null, 'qualitaetswein'), 'qualitaetswein')
  assert.equal(EISWEIN_MIN_KMW, 25)
  assert.equal(eisweinHinweis('eiswein', 27), null)
  assert.match(eisweinHinweis('eiswein', 22.5), /mindestens 25 °KMW .* erfasst sind 22,5 °KMW/)
  assert.match(eisweinHinweis('eiswein', null), /Mostgewicht nicht erfasst/)
  assert.equal(eisweinHinweis('hauptlese', 10), null)
})

test('Rückverfolgung: Hauptlese und Eiswein am selben GST → eindeutiger Ersatz je Lese', () => {
  const ernte = [
    { jahrgangId: 'jg', leseId: 'l1', weingartenId: 'w1', grundstueckId: 'g1', lesedatum: '2026-09-20', mengeKg: 1000 },
    { jahrgangId: 'jg', leseId: 'l2', weingartenId: 'w1', grundstueckId: 'g1', lesedatum: '2027-01-12', mengeKg: 200 },
  ]
  const zeile = (leseId, pressungDatum) => ({ id: 'z', grundstueckId: 'g1', weingartenId: 'w1', lesedatum: null, pressungDatum, jahrgang: 2026, jahrgangId: 'jg', leseId })
  const eis = fenster.ersatzAusErntemeldung(zeile('l2', '2027-01-13'), ernte, [])
  assert.deepEqual([eis.grund, eis.datum], ['eindeutig', '2027-01-12'])
  const haupt = fenster.ersatzAusErntemeldung(zeile('l1', '2026-09-21'), ernte, [])
  assert.deepEqual([haupt.grund, haupt.datum], ['eindeutig', '2026-09-20'])
  // ohne Lese (Altdaten) wie bisher je Jahrgang → mehrere Lesetage
  assert.equal(fenster.ersatzAusErntemeldung(zeile(null, '2027-01-13'), ernte, []).grund, 'mehrere_lesetage')
  // Verpresstes einer anderen Lese zählt nicht gegen die Eiswein-Menge
  const verpresst = [{ id: 'v', jahrgangId: 'jg', leseId: 'l1', weingartenId: 'w1', grundstueckId: 'g1', pressungDatum: '2026-09-21', traubenKg: 900 }]
  assert.equal(fenster.ersatzAusErntemeldung(zeile('l2', '2027-01-13'), ernte, verpresst).grund, 'eindeutig')
})

const lies = p => fs.readFileSync(p, 'utf8')

test('Verdrahtung: Eiswein in Mehrfacherfassung und Pressung, Lese in Rückverfolgung und Weinbuch', () => {
  const a = lies('src/app/(dashboard)/erntemeldung/actions.ts')
  assert.ok(a.includes('const perQualitaet = leseStufe(leseWirksam?.art,'), 'Mehrfacherfassung')
  assert.ok(a.includes('const jgMehrfach = await ladeJahrgang(supabase, tenantId, jahrgangId)'), 'N4')
  assert.ok(a.includes("qualitaetsstufe: qualitaetsstufeInput ?? (lesePressung?.art === 'eiswein' ? 'eiswein' : null)"), 'Charge')
  assert.ok(a.indexOf('const ueberObergrenze = abstufungFehler(') > a.indexOf('let lesePressung ='), 'Obergrenze nach der Lese')
  const r = lies('src/lib/behoerden/rueckverfolgung.ts')
  assert.ok(r.includes('leseId: text(p.lese_id)') && r.includes('pressung:pressung_id!inner(tenant_id, datum, jahrgang_id, lese_id)'))
  const w = lies('src/lib/wein/weinbuch.ts')
  // KAN-127: Lese-Ereignisse aus den Lesezeilen der Charge samt Lese-Nummer (Hauptlese ≠ Eiswein)
  assert.ok(w.includes("titel: l.leseText ? `Lese ${l.leseText}` : 'Lese'"))
})
