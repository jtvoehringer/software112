// Sweep 113 (10.10.2026): Einbettungen in .select() müssen zu einem Fremdschlüssel passen.
// Befund im ersten E2E-Lauf gegen Staging (KAN-309): Pflanzenschutz › Lager lieferte HTTP 500 – die Einbettung
// `lieferant:firmen!lieferant_firma_id(name)` fand keinen Fremdschlüssel, weil (lieferant_firma_id, tenant_id) ein
// Verbund-FK ist (PGRST200). Keine Typprüfung, kein Unit-Test und keiner der 24 Wächter sah das. Jetzt prüft
// scripts/check-einbettung.js (prebuild) jede Einbettung gegen scripts/fremdschluessel.json.
//
// Aufruf:  npm run -s test:csv

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const HIER = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(HIER, '..', '..')
const require = createRequire(import.meta.url)
const { pruefeText, pruefeLiteral, index } = require(path.join(HIER, '..', 'check-einbettung.js'))
const { fremdschluesselAusTypen } = require(path.join(HIER, '..', 'fremdschluessel-aus-typen.js'))

const fks = JSON.parse(readFileSync(path.join(HIER, '..', 'fremdschluessel.json'), 'utf8'))
const ix = index(fks, Object.keys(JSON.parse(readFileSync(path.join(HIER, '..', 'schema.json'), 'utf8'))))
const meldungen = (lit, quelle = null) => pruefeLiteral(lit, ix, quelle).map(f => f.meldung)

describe('check-einbettung', () => {
  test('Regression Pflanzenschutz-Lager: Spalten-Hinweis auf einen Verbund-FK wird gemeldet, mit Vorschlag', () => {
    const m = meldungen('id, lieferant:firmen!lieferant_firma_id(name)', 'betriebsmittel_lager_bewegungen')
    assert.equal(m.length, 1)
    assert.match(m[0], /Verbund-Fremdschlüssels betriebsmittel_lager_bewegungen_lieferant_fkey/)
    assert.match(m[0], /firmen!betriebsmittel_lager_bewegungen_lieferant_fkey/)
  })

  test('derselbe Spalten-Hinweis ist an einer Tabelle mit einspaltigem FK richtig (zukauf_posten)', () => {
    assert.deepEqual(meldungen('lieferant_firma:firmen!lieferant_firma_id(id, name)', 'zukauf_posten'), [])
  })

  test('Hinweis über den Namen des Fremdschlüssels ist richtig – auch der Name muss die beiden Tabellen verbinden', () => {
    assert.deepEqual(meldungen('lieferant:firmen!betriebsmittel_lager_bewegungen_lieferant_fkey(name)', 'betriebsmittel_lager_bewegungen'), [])
    assert.match(meldungen('k:kontakte!zukauf_posten_lieferant_firma_id_fkey(name)', 'zukauf_posten')[0], /verbindet zukauf_posten → firmen/)
  })

  test('Einbettung über eine Spalte, die nur einen Verbund-FK bildet (lese_id), wird gemeldet', () => {
    assert.match(meldungen('id, lese:lese_id(nr)', 'pressungen')[0], /lesen!pressungen_lese_fkey/)
    assert.deepEqual(meldungen('id, w:weingarten_id(name), j:jahrgang_id!inner(tenant_id)', 'ernte_parzellen'), [])
  })

  test('verschachtelt: der Hinweis gilt gegenüber der übergeordneten Einbettung, nicht der Abfrage', () => {
    assert.deepEqual(meldungen('id, positionen:verkauf_positionen(id, fuellung:fuellungen!fuellung_id(name), w:weinausbau_id(name))', 'verkaufsposten'), [])
    assert.match(meldungen('positionen:verkauf_positionen(f:fuellungen!kontakt_id(name))', 'verkaufsposten')[0], /zwischen verkauf_positionen und fuellungen/)
  })

  test('Tippfehler im Hinweis bzw. unbekannte Tabelle', () => {
    assert.match(meldungen('k:kontakte!tippfehler_id(name)', 'aktivitaeten')[0], /kein Fremdschlüssel über tippfehler_id/)
    assert.match(meldungen('k:kontakt!kontakt_id(name)', 'aktivitaeten')[0], /keine bekannte Tabelle/)
  })

  test('Funktionen und gewöhnlicher Text werden nicht beanstandet', () => {
    assert.deepEqual(meldungen('count(*)', 'kontakte'), [])
    assert.deepEqual(meldungen('Bitte prüfen (Hinweis)!', null), [])
  })

  test('Ausgangstabelle aus .from(…) bzw. q(…) davor; Ausnahme mit Begründung', () => {
    const quelle = "const r = await supabase.from('betriebsmittel_lager_bewegungen')\n  .select('id, lieferant:firmen!lieferant_firma_id(name)')\n"
    assert.equal(pruefeText(quelle, ix).length, 1)
    assert.equal(pruefeText(quelle.replace("  .select", "  // einbettung-ignore: absichtlich für den Test hier\n  .select"), ix).length, 0)
    assert.equal(pruefeText(quelle.replace("  .select", "  // einbettung-ignore: kurz\n  .select"), ix).length, 1, 'Grund unter 15 Zeichen zählt nicht')
  })

  test('Pflanzenschutz-Lager ist korrigiert (Einbettung über den Namen des Verbund-FK)', () => {
    const alt = readFileSync(path.join(ROOT, 'src/app/(dashboard)/behandlungen/lager/page.tsx'), 'utf8')
    assert.deepEqual(pruefeText(alt, ix), [])
  })
})

describe('fremdschluessel.json', () => {
  test('aus den generierten Typen gelesen – Name, Tabelle, Spalten, Ziel', () => {
    const typen = `export type Database = {
  public: {
    Tables: {
      lesen: {
        Row: {
          id: string
        }
        Relationships: []
      }
      pressungen: {
        Row: {
          id: string
        }
        Relationships: [
          {
            foreignKeyName: "pressungen_lese_fkey"
            columns: ["lese_id", "jahrgang_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "lesen"
            referencedColumns: ["id", "jahrgang_id", "tenant_id"]
          },
        ]
      }
    }
    Views: {
    }
  }
}`
    assert.deepEqual(fremdschluesselAusTypen(typen), [{ n: 'pressungen_lese_fkey', t: 'pressungen', s: ['lese_id', 'jahrgang_id', 'tenant_id'], z: 'lesen' }])
  })

  test('enthält die bekannten Verbund-FKs und ist mit dem prebuild verdrahtet', () => {
    const namen = new Set(fks.map(f => f.n))
    for (const n of ['betriebsmittel_lager_bewegungen_lieferant_fkey', 'pressungen_lese_fkey', 'ernte_parzellen_lese_fkey']) assert.ok(namen.has(n), n)
    assert.ok(fks.length > 300)
    assert.match(JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')).scripts.prebuild, /node scripts\/check-einbettung\.js/)
  })
})
