// KAN-40 E1 (03.10.2026, Jörgen: „Cron ja, Musterhof vorerst aus“): der tägliche Sammel-Cron gleicht das
// Bewegungsjournal aller Betriebe mit eröffnetem Journal ab (journal_abgleichen, Service-Role).
//
// Aufruf:  node --experimental-strip-types --test scripts/tests/kan40-journal-cron.test.mjs

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { journalAbgleichAlle } from '../../src/lib/kellerbuch/journal.ts'

const quelle = f => readFileSync(new URL(`../../${f}`, import.meta.url), 'utf8')

/** Admin-Client-Attrappe: tenant_einstellungen mit journal_ab-Filter, rpc journal_abgleichen */
function attrappe(betriebe, rpcErgebnis) {
  const aufrufe = []
  const filter = []
  return {
    aufrufe, filter,
    from: tabelle => ({
      select: spalten => ({
        not: (spalte, op, wert) => {
          filter.push({ tabelle, spalten, spalte, op, wert })
          return Promise.resolve({ data: betriebe.map(t => ({ tenant_id: t })), error: null })
        },
      }),
    }),
    rpc: (name, args) => {
      aufrufe.push({ name, args })
      return Promise.resolve(rpcErgebnis(args.p_tenant_id))
    },
  }
}

test('ruft journal_abgleichen nur für Betriebe mit journal_ab auf und summiert die Korrekturen', async () => {
  const admin = attrappe(['a', 'b'], t => ({ data: t === 'a' ? 2 : 0, error: null }))
  const lauf = await journalAbgleichAlle(admin)
  assert.deepEqual(admin.filter, [{ tabelle: 'tenant_einstellungen', spalten: 'tenant_id', spalte: 'journal_ab', op: 'is', wert: null }])
  assert.deepEqual(admin.aufrufe.map(a => [a.name, a.args.p_tenant_id]), [['journal_abgleichen', 'a'], ['journal_abgleichen', 'b']])
  assert.deepEqual(lauf, { betriebe: 2, korrekturen: 2, fehler: [] })
})

test('ein Fehler in einem Betrieb bricht den Lauf nicht ab', async () => {
  const admin = attrappe(['a', 'b'], t => (t === 'a' ? { data: null, error: { message: 'kaputt' } } : { data: 3, error: null }))
  const lauf = await journalAbgleichAlle(admin)
  assert.deepEqual(lauf, { betriebe: 1, korrekturen: 3, fehler: [{ tenantId: 'a', meldung: 'kaputt' }] })
})

test('ohne eröffnetes Journal (z. B. Musterhof) kein Aufruf', async () => {
  const admin = attrappe([], () => assert.fail('kein Aufruf erwartet'))
  assert.deepEqual(await journalAbgleichAlle(admin), { betriebe: 0, korrekturen: 0, fehler: [] })
})

test('Sammel-Cron: Abgleich nach den Daueraufträgen und vor dem Morgenbericht, Fehler zählen mit', () => {
  const route = quelle('src/app/api/cron/taeglich/route.ts')
  const da = route.indexOf("rpc as any)('process_ea_dauerauftraege')")
  const j = route.indexOf('await journalAbgleichAlle(admin)')
  const mb = route.indexOf('await laufMorgenberichte(')
  assert.ok(da > 0 && j > da && mb > j)
  assert.match(route, /journal\.fehler\.length/)
})
