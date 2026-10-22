// Sweep 87 (KAN-279, 10.10.2026): Abbau der Altfälle aus KAN-278 – Dashboard-Daten (Kennzahlen, Fristen, Termine,
// Einstellungen) und Chargenseite werten jeden Lesefehler aus (geladen → Fehlergrenze), statt falsche Kennzahlen,
// fehlende Fristen oder „Charge nicht gefunden“ zu zeigen.
//
// Aufruf:  npm run -s test:csv

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const HIER = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(HIER, '..', '..')
const require = createRequire(import.meta.url)
const { pruefeText } = require(path.join(HIER, '..', 'check-einzelabfrage.js'))
const quelle = p => readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n')
const DATA = 'src/app/(dashboard)/dashboard/_shared/data.ts'
const CHARGE = 'src/app/(dashboard)/kellerbuch/weinausbau/[id]/page.tsx'

describe('KAN-279: Dashboard und Chargenseite ohne Altfall', () => {
  test('keine Abfrage ohne Fehlerauswertung, kein Ausgangswert mehr', () => {
    const baseline = JSON.parse(quelle('scripts/einzelabfrage-baseline.json'))
    for (const f of [DATA, CHARGE]) {
      assert.deepEqual(pruefeText(quelle(f), { route: true }).funde, [], f)
      assert.equal(baseline[f], undefined, f)
    }
  })

  test('Dashboard: Kennzahlen, Fristen, Termine und Einstellungen über geladen(); offene Posten melden selbst', () => {
    const d = quelle(DATA)
    for (const was of ['Gebinde', 'Chargen', 'Füllstände', 'Analysen', 'Füllungen', 'Rieden', 'Grundstücke', 'Fristen', 'UVA-Perioden',
      'Jahrgang', 'Prüfnummernanträge', 'Wartefristen', 'Anlagen', 'AfA-Buchungen', 'Pflanzenschutz-Aufzeichnungen', 'Termine',
      'Aufgaben und Termine', 'Einstellungen']) assert.match(d, new RegExp(`geladen\\([^\\n]*'${was}'\\)|, '${was}'\\)`), was)
    assert.match(d, /fehler: error \? String\(\(error as R\)\.message \?\? error\) : null/, 'offene Posten (KAN-158) unverändert')
  })

  test('Chargenseite: Charge und Bewegungen über geladen(), nicht gefunden bleibt notFound()', () => {
    const c = quelle(CHARGE)
    assert.match(c, /const rows = geladen\(rowsRes, 'Charge'\)/)
    assert.match(c, /if \(!weinausbau\) notFound\(\)/)
    for (const was of ['Lohnversektung', 'Prüfnummernanträge', 'Prüfnummern der Charge']) assert.ok(c.includes(`'${was}')`), was)
    // KAN-342: Umzüge (samt Ziel-/Quellnamen), Füllungen, Verkäufe … lädt das zentrale Bewegungsbuch – es wirft bei einem Lesefehler
    assert.match(c, /await ladeBewegungenCharge\(supabase, tenantId, weinausbau\.id\)/)
    const bb = quelle('src/lib/behoerden/bewegungsbuch.ts')
    assert.match(bb, /const \{ data, error \} = await alle<R>\(query\)\n\s+if \(error\) fehler\(tabelle, error\)/)
    assert.match(bb, /return ladeRohDerChargen\(supabase, tenantId, \{ pressungen, umzuegeEin, chargen, behandlungen \}, \[chargeId\]\)/)
  })
})
