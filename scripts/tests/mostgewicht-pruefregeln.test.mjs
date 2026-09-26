// KAN-128 Teil A (Review 26.09.2026 III): deutsche Meldungen für die CHECK-Constraints der Migration
// kan128_mostgewicht_oechsle (src/lib/fehler.ts, PRUEFREGEL_MELDUNG)
//
// Aufruf:  node --experimental-strip-types --disable-warning=ExperimentalWarning --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test scripts/tests/mostgewicht-pruefregeln.test.mjs
//          (Node ≥ 22.6, ohne Datenbank; läuft auch über npm run test:csv)
//
// Constraint-Namen: Liegt die Migration schon unter supabase/migrations/ (<version>_kan128_mostgewicht_oechsle.sql,
// nach apply_migration), liest der Test die Namen aus der Datei (ADD CONSTRAINT …) und prüft zusätzlich,
// dass die feste Liste unten dazu passt; sonst nimmt er die feste Liste – abgeschrieben aus der
// Migration (Abschnitte 3a–3f, 4 und 5; im Kopf „Neue CHECK-Constraints“).

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const { uebersetzeDbMeldung, dbFehlerText, fehlerText, AktionsFehler } = await import('../../src/lib/fehler.ts')
const { parseEingabe, KMW_MAX, OECHSLE_MAX } = await import('../../src/lib/wein/mostgewicht.ts')

const MIGRATIONEN = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'supabase', 'migrations')

/** Neue CHECK-Constraints der Migration kan128_mostgewicht_oechsle (22) */
const FESTE_LISTE = [
  'ernte_parzellen_klosterneuburger_bereich_check', 'ernte_parzellen_oechsle_bereich_check', 'ernte_parzellen_mostgewicht_einheit_check',
  'pressungen_kmw_grad_bereich_check', 'pressungen_oechsle_bereich_check', 'pressungen_mostgewicht_einheit_check',
  'pressung_weingaerten_kmw_bereich_check', 'pressung_weingaerten_oechsle_bereich_check', 'pressung_weingaerten_mostgewicht_einheit_check',
  'traubenverkauf_kmw_grad_bereich_check', 'traubenverkauf_oechsle_bereich_check', 'traubenverkauf_mostgewicht_einheit_check',
  'weinausbau_kmw_bereich_check', 'weinausbau_oechsle_bereich_check', 'weinausbau_mostgewicht_einheit_check',
  'zukauf_posten_kmw_bereich_check', 'zukauf_posten_oechsle_bereich_check', 'zukauf_posten_mostgewicht_einheit_check',
  'tenant_einstellungen_mostgewicht_einheit_check',
  'verschneidungen_ziel_mostgewicht_einheit_vorher_check',
  'keller_umzuege_mostgewicht_einheit_vorher_check', 'keller_umzuege_mostgewicht_einheit_nachher_check',
]

/** Datei der eingespielten Migration oder null */
function migrationsDatei() {
  let dateien = []
  try { dateien = readdirSync(MIGRATIONEN) } catch { return null }
  const treffer = dateien.filter(d => /^\d{14}_kan128_mostgewicht_oechsle\.sql$/.test(d))
  assert.ok(treffer.length <= 1, `mehrere Migrationen kan128_mostgewicht_oechsle: ${treffer.join(', ')}`)
  return treffer.length ? path.join(MIGRATIONEN, treffer[0]) : null
}

function constraintNamen() {
  const datei = migrationsDatei()
  if (!datei) return { quelle: 'feste Liste', namen: FESTE_LISTE }
  const sql = readFileSync(datei, 'utf8')
  const namen = [...new Set([...sql.matchAll(/\bADD\s+CONSTRAINT\s+([a-z0-9_]+)/gi)].map(m => m[1]))]
  return { quelle: path.basename(datei), namen }
}

/** PostgREST-Meldung eines abgelehnten Schreibvorgangs (23514) */
const meldung = (constraint) => `new row for relation "x" violates check constraint "${constraint}"`

describe('PRUEFREGEL_MELDUNG kennt alle Constraints der Migration kan128_mostgewicht_oechsle', () => {
  const { quelle, namen } = constraintNamen()

  test(`Namen (${quelle}): 22, genau die feste Liste`, () => {
    assert.equal(namen.length, 22)
    assert.deepEqual([...namen].sort(), [...FESTE_LISTE].sort())
    for (const n of namen) assert.ok(n.length <= 63, `${n}: länger als 63 Zeichen (PostgreSQL kürzt Namen)`)
  })

  test('jede Meldung deutsch – kein allgemeiner Prüfregel-Text', () => {
    for (const n of namen) {
      const t = uebersetzeDbMeldung(meldung(n))
      assert.doesNotMatch(t, /Prüfregel der Datenbank/, n)
      assert.doesNotMatch(t, /violates/, n)
      assert.equal(dbFehlerText({ code: '23514', message: meldung(n) }), t, `${n} über dbFehlerText`)
      assert.equal(fehlerText(new AktionsFehler(`Speichern fehlgeschlagen: ${meldung(n)}`)), `Speichern fehlgeschlagen: ${t}`, `${n} über fehlerText`)
    }
  })

  test('Wortlaut je Art: °KMW-Bereich, °Oe-Bereich, Einheit – wie die Eingabeprüfung (parseEingabe)', () => {
    const kmw = parseEingabe(String(KMW_MAX + 1), 'kmw')
    const oe = parseEingabe(String(OECHSLE_MAX + 1), 'oechsle')
    assert.equal(kmw.fehler, 'Das Mostgewicht muss zwischen 0 und 60 °KMW liegen.')
    assert.equal(oe.fehler, 'Das Mostgewicht muss zwischen 0 und 350 °Oe liegen.')
    for (const n of namen) {
      const t = uebersetzeDbMeldung(meldung(n))
      if (/_oechsle_bereich_check$/.test(n)) assert.equal(t, oe.fehler, n)
      else if (/_bereich_check$/.test(n)) assert.equal(t, kmw.fehler, n)
      else if (/_mostgewicht_einheit(_vorher|_nachher)?_check$/.test(n)) assert.equal(t, 'Unbekannte Mostgewichts-Einheit – möglich sind °KMW und °Oe.', n)
      else assert.fail(`${n}: unbekannte Art`)
    }
  })

  test('feste Liste = Kopf der Migration: je Tabelle °KMW-Spalte, oechsle, Einheit', () => {
    const tabellen = [['ernte_parzellen', 'klosterneuburger'], ['pressungen', 'kmw_grad'], ['pressung_weingaerten', 'kmw'],
      ['traubenverkauf', 'kmw_grad'], ['weinausbau', 'kmw'], ['zukauf_posten', 'kmw']]
    const erwartet = tabellen.flatMap(([t, k]) => [`${t}_${k}_bereich_check`, `${t}_oechsle_bereich_check`, `${t}_mostgewicht_einheit_check`])
    for (const n of erwartet) assert.ok(FESTE_LISTE.includes(n), n)
    assert.equal(FESTE_LISTE.length, erwartet.length + 4)
  })
})
