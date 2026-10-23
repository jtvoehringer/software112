// KAN-380 (23.10.2026) – Der nächtliche Demo-Reset des Musterhofs scheiterte seit 12.10.2026 jede Nacht (HTTP 409):
// demo_musterhof_zuruecksetzen() löschte Betriebsmittel bzw. sonstige Artikel, während noch Maßnahmen (KAN-325/326) bzw.
// Lagerbewegungen sonstiger Artikel (KAN-115) darauf verwiesen (Fremdschlüssel ohne Kaskade). Der Reset ist atomar –
// ein Verweis aus dem UAT genügte, und nichts wurde mehr zurückgesetzt. Die Korrektur ersetzt in der Funktion genau die
// beiden Stellen (Prüfung auf genau einen Treffer).
//
// Aufruf:  npm run -s test:csv   (alle scripts/tests/*.test.mjs)

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'

const MIG = new URL('../../supabase/migrations/', import.meta.url)
const datei = (endung) => {
  const f = readdirSync(MIG).find(n => n.endsWith(endung))
  assert.ok(f, `Migration *${endung} fehlt`)
  return readFileSync(new URL(f, MIG), 'utf8').replace(/\r\n/g, '\n')
}

describe('KAN-380: Demo-Reset löscht abhängige Zeilen zuerst', () => {
  test('Maßnahmen verlieren den Betriebsmittel-Verweis vor dem Löschen der Betriebsmittel', () => {
    const m = datei('_kan380_demo_reset_betriebsmittel.sql')
    const neu = m.slice(m.indexOf('c_neu constant text'))
    assert.ok(m.includes("c_alt constant text := '  delete from betriebsmittel where tenant_id = c_t;';"))
    const a = neu.indexOf('update behandlungen set betriebsmittel_id = null where tenant_id = c_t and betriebsmittel_id is not null;')
    const b = neu.indexOf('delete from betriebsmittel where tenant_id = c_t;')
    assert.ok(a > 0 && b > a, 'Verweis leeren vor dem Löschen der Betriebsmittel')
    assert.match(m, /IF v_treffer <> 1 THEN/, 'genau eine Stelle')
    assert.match(m, /pg_get_functiondef\('public\.demo_musterhof_zuruecksetzen\(\)'::regprocedure\)/)
  })
  test('Lagerbewegungen sonstiger Artikel werden vor den Artikeln gelöscht', () => {
    const m = datei('_kan380b_demo_reset_sonstige_artikel.sql')
    const neu = m.slice(m.indexOf('c_neu constant text'))
    assert.ok(m.includes("c_alt constant text := '  delete from sonstige_artikel where tenant_id = c_t;';"))
    const a = neu.indexOf('delete from sonstige_artikel_bewegungen where tenant_id = c_t;')
    const b = neu.indexOf('delete from sonstige_artikel where tenant_id = c_t;')
    assert.ok(a > 0 && b > a, 'Bewegungen vor den Artikeln löschen')
    assert.match(m, /IF v_treffer <> 1 THEN/)
  })
  test('beide Migrationen prüfen sich selbst', () => {
    assert.match(datei('_kan380_demo_reset_betriebsmittel.sql'), /RAISE EXCEPTION 'KAN-380: Korrektur fehlt/)
    assert.match(datei('_kan380b_demo_reset_sonstige_artikel.sql'), /RAISE EXCEPTION 'KAN-380: Nachtrag fehlt/)
  })
})
