// KAN-177 (01.10.2026) – Keller-Auswertungen: der gewählte Zeitraum gilt für alle Bewegungen
//
// Aufruf:  npm run -s test:csv   (alle scripts/tests/*.test.mjs)
//
// 1. kellerZeitraum(): Standard 1.1. bis offen, „von=“ leer = ohne Untergrenze, vertauschte Grenzen
//    werden getauscht, ein ungültiges Datum wird gemeldet (früher: stillschweigend „gesamter Zeitraum“).
// 2. ladeKellerAuswertungen(): Kellerbehandlungen, Umzüge/Schwund und Füllungen bekommen von/bis als
//    gte/lte auf „datum“ – dieselben Ladefunktionen wie die CSVs „keller-auswertungen“ und
//    „keller-behandlungen-alle“.
// 3. Seite: getrennte Blöcke „Bewegungen im Zeitraum“ und „Bestand heute“, Hinweise zum Zeitraum.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { hooksRegistrieren, laden, nurMitHooks } from './buchung-attrappe.mjs'

hooksRegistrieren()

const quelle = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')
const T = 't1'

/** Aufzeichnender Supabase-Ersatz: jede Abfrage liefert 0 Zeilen, die Filter landen in `abfragen` */
function aufzeichner() {
  const abfragen = []
  const client = {
    rpc: async () => ({ data: [], error: null }),
    from(tabelle) {
      const a = { tabelle, filter: [] }
      abfragen.push(a)
      const q = {
        then(ok, fehl) { return Promise.resolve({ data: [], error: null }).then(ok, fehl) },
        range: async () => ({ data: [], error: null }),
      }
      for (const m of ['select', 'eq', 'is', 'not', 'in', 'order', 'gte', 'lte', 'or', 'neq']) {
        q[m] = (...args) => { a.filter.push([m, ...args]); return q }
      }
      return q
    },
  }
  return { client, abfragen }
}

describe('KAN-177 Zeitraum der Keller-Auswertungen', nurMitHooks, () => {
  test('kellerZeitraum: Standard, leer, gültig, vertauscht, ungültig', async () => {
    const { kellerZeitraum } = await laden('lib/behoerden/keller-auswertungen.ts')
    const H = '2026-10-01'
    assert.deepEqual(kellerZeitraum({}, H), { zeitraum: { von: '2026-01-01', bis: null }, hinweise: [] })
    assert.deepEqual(kellerZeitraum({ von: '' }, H), { zeitraum: { von: null, bis: null }, hinweise: [] })
    assert.deepEqual(kellerZeitraum({ von: '2026-09-01', bis: '2026-09-30' }, H), { zeitraum: { von: '2026-09-01', bis: '2026-09-30' }, hinweise: [] })
    assert.deepEqual(kellerZeitraum({ von: '', bis: '2025-12-31' }, H).zeitraum, { von: null, bis: '2025-12-31' })

    const vertauscht = kellerZeitraum({ von: '2026-09-30', bis: '2026-09-01' }, H)
    assert.deepEqual(vertauscht.zeitraum, { von: '2026-09-01', bis: '2026-09-30' })
    assert.equal(vertauscht.hinweise.length, 1)

    const ungueltig = kellerZeitraum({ von: '2026-02-30', bis: 'morgen' }, H)
    assert.deepEqual(ungueltig.zeitraum, { von: null, bis: null })
    assert.equal(ungueltig.hinweise.length, 2)
    assert.ok(ungueltig.hinweise[0].includes('Von'))
  })

  test('ladeKellerAuswertungen: von/bis gehen an Behandlungen, Umzüge und Füllungen', async () => {
    const { ladeKellerAuswertungen } = await laden('lib/behoerden/keller-auswertungen.ts')
    const { client, abfragen } = aufzeichner()
    const d = await ladeKellerAuswertungen(client, T, { von: '2026-09-01', bis: '2026-09-30' })
    assert.deepEqual(d.zeitraum, { von: '2026-09-01', bis: '2026-09-30' })

    const mitDatum = (tabelle) => abfragen.filter(a => a.tabelle === tabelle && a.filter.some(f => f[0] === 'gte'))
    for (const tabelle of ['keller_behandlungen', 'keller_umzuege', 'fuellungen']) {
      const treffer = mitDatum(tabelle)
      assert.equal(treffer.length, 1, `${tabelle}: genau eine Abfrage mit Zeitraum`)
      const f = treffer[0].filter
      assert.ok(f.some(x => x[0] === 'gte' && x[1] === 'datum' && x[2] === '2026-09-01'), `${tabelle}: gte datum`)
      assert.ok(f.some(x => x[0] === 'lte' && x[1] === 'datum' && x[2] === '2026-09-30'), `${tabelle}: lte datum`)
      assert.ok(f.some(x => x[0] === 'eq' && x[1] === 'tenant_id' && x[2] === T), `${tabelle}: tenant_id`)
    }
  })

  test('ohne Grenzen: keine Datumsfilter (gesamter Zeitraum)', async () => {
    const { ladeKellerAuswertungen } = await laden('lib/behoerden/keller-auswertungen.ts')
    const { client, abfragen } = aufzeichner()
    await ladeKellerAuswertungen(client, T, { von: null, bis: null })
    assert.ok(!abfragen.some(a => a.filter.some(f => f[0] === 'gte' || f[0] === 'lte')))
  })

  test('Seite nutzt kellerZeitraum und trennt Zeitraum und Bestand heute', () => {
    const page = quelle('src/app/(dashboard)/reports/(controlling)/keller/page.tsx')
    assert.match(page, /kellerZeitraum\(sp, wienHeute\(\)\)/)
    assert.match(page, /zeitraumHinweise=\{hinweise\}/)
    const client = quelle('src/app/(dashboard)/reports/(controlling)/keller/KellerAuswertungenClient.tsx')
    const iZeitraum = client.indexOf('Bewegungen im Zeitraum')
    const iBestand = client.indexOf('>Bestand heute<')
    assert.ok(iZeitraum > 0 && iBestand > iZeitraum, 'Zeitraum-Block vor dem Bestand')
    // Zeitraum-abhängige Tabellen stehen im Zeitraum-Block, Bestandstabellen im Bestand-Block
    for (const t of ['>Kellerbehandlungen<', '>Umzüge & Filtrationen<']) {
      const i = client.indexOf(t)
      assert.ok(i > iZeitraum && i < iBestand, t)
    }
    for (const t of ['>Behälter-Auslastung<', '>Chargen im Ausbau<', 'Liter im Ausbau (heute)', 'Laufende Chargen (heute)']) {
      assert.ok(client.indexOf(t) > iBestand, t)
    }
    assert.match(client, /zeitraumHinweise\.map/)
  })
})
