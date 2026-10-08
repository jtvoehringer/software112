// KAN-44 Teil 2 (08.10.2026): Füllstand je Gebinde = Bestand der nicht stornierten Chargen (wie das Bewegungsjournal),
// nicht mehr aus den Bewegungen nachgerechnet. Verhalten prüft DB-Test 74 auf Staging; hier der Migrationstext.
//
// Aufruf:  npm run -s test:csv   (alle scripts/tests/*.test.mjs)

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'

const migDir = new URL('../../supabase/migrations/', import.meta.url)
const mig = readdirSync(migDir).find(f => f.endsWith('_kan44_fuellstand_aus_bestand.sql'))
// Entwurf nur bis zum Einspielen (liegt lokal, nicht im Repository)
const sql = readFileSync(mig ? new URL(mig, migDir) : new URL('../entwurf/kan44_fuellstand_aus_bestand.sql', migDir), 'utf8').replace(/\r\n/g, '\n')

describe('KAN-44 Teil 2: v_behaelter_fuellstand aus dem Bestand der Chargen', () => {
  test('Bestand der nicht stornierten Chargen je Gebinde und Betrieb, jedes Gebinde mit 0 L', () => {
    assert.match(sql, /CREATE OR REPLACE VIEW public\.v_behaelter_fuellstand WITH \(security_invoker = true\) AS/)
    assert.match(sql, /SELECT w\.behaelter_id, w\.tenant_id, sum\(w\.menge_liter\) AS liter\s+FROM public\.weinausbau w/)
    assert.match(sql, /AND w\.storniert_am IS NULL/)
    assert.match(sql, /SELECT b\.id, b\.tenant_id FROM public\.behaelter b/)
    assert.match(sql, /round\(COALESCE\(i\.liter, 0::numeric\), 2\) AS liter_aktuell/)
  })

  test('keine Nachrechnung aus Bewegungen mehr', () => {
    for (const alt of ['umzuege_ein', 'umzuege_aus', 'abfuellungen', 'verkaeufe', 'verschneidungen_ein', 'zukauf_ein', 'pressungen_ein']) {
      assert.doesNotMatch(sql, new RegExp(`\\b${alt}\\b`), alt)
    }
  })
})
