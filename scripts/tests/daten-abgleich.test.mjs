// Datenabgleich (09.10.2026): scripts/daten-abgleich.sql bleibt ein reines Leseskript mit einheitlichen Befunden –
// es läuft als postgres gegen die Produktion, ein Schreibbefehl darin würde ohne RLS ausgeführt.
//
// Aufruf:  npm run -s test:csv

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HIER = path.dirname(fileURLToPath(import.meta.url))
const SQL = fs.readFileSync(path.join(HIER, '..', 'daten-abgleich.sql'), 'utf8')
const CODE = SQL.split('\n').map(z => z.replace(/--.*$/, '')).join('\n')

describe('scripts/daten-abgleich.sql', () => {
  test('nur lesend: keine Schreib-, DDL- oder Sitzungsbefehle', () => {
    assert.doesNotMatch(CODE, /\b(insert|update|delete|truncate|merge|drop|alter|create|grant|revoke|copy|call|do)\b/i)
    assert.doesNotMatch(CODE, /set_config|session_replic\w*|\bset\s+/i)
    assert.match(CODE, /^\s*with betrieb as/m)
  })

  test('jeder Befund hat eine bekannte Schwere und eine eindeutige Kennung', () => {
    const befunde = [...CODE.matchAll(/'(fehler|pflege|hinweis)'(?:\s+as schwere)?,\s*'([a-z_]+)'/g)]
    assert.ok(befunde.length >= 15, `nur ${befunde.length} Befunde`)
    const namen = befunde.map(b => b[2])
    assert.equal(new Set(namen).size, namen.length, 'Kennung doppelt')
    for (const n of ['flaschenverkauf_ohne_bewegung', 'fuellung_kette', 'ried_ohne_herkunft', 'charge_ohne_jahrgang',
      'gebinde_ohne_material', 'kg_ungueltig', 'gst_nr_fehlt', 'bezahlt_ohne_zahlung']) assert.ok(namen.includes(n), n)
  })

  test('stornierte Bewegungen und Verkäufe zählen nicht', () => {
    const abfragen = [...CODE.matchAll(/from public\.(weinausbau|fuellungen)\s+\w+(?:\s+join[^\n]*)?\s*\n?\s*(?:left join lateral[^\n]*\n\s*)?where([^\n]*)/g)]
    assert.ok(abfragen.length >= 7, `nur ${abfragen.length} Abfragen auf Chargen/Füllungen erkannt`)
    for (const m of abfragen) assert.match(m[2], /storniert_am is null/, `${m[1]}: ${m[2].trim()}`)
    assert.match(CODE, /not coalesce\(v\.storniert, false\) and v\.storniert_am is null/)
  })
})
