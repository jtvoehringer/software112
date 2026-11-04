// KAN-401 (04.11.2026): Prüf-Endpunkt /api/health für den externen Verfügbarkeitsmonitor (Anlage 3, Punkt 3.3).
// Aufruf: npm run -s test:csv

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { pruefeVerfuegbarkeit } from '../../src/lib/system/verfuegbarkeit.ts'

const WURZEL = path.resolve(import.meta.dirname, '../..')
const URL_ = 'https://beispiel.supabase.co/'
const KEY = 'anon-test'

/** fetch-Attrappe: Antwort je Pfadteil, merkt sich die Aufrufe */
function attrappe(antworten) {
  const aufrufe = []
  const fn = async (ziel, init) => {
    aufrufe.push({ ziel, init })
    const passend = Object.entries(antworten).find(([teil]) => ziel.includes(teil))
    const a = passend?.[1]
    if (a === 'wirft') throw new TypeError('fetch failed')
    if (a === 'haengt') {
      return new Promise((_, ablehnen) => init.signal.addEventListener('abort', () => ablehnen(new Error('abgebrochen'))))
    }
    return new Response('[]', { status: a ?? 200 })
  }
  return { fn, aufrufe }
}

describe('pruefeVerfuegbarkeit', () => {
  test('beide Teile antworten → ok', async () => {
    const { fn, aufrufe } = attrappe({ '/rest/v1/': 200, '/auth/v1/health': 200 })
    const e = await pruefeVerfuegbarkeit({ url: URL_, anonKey: KEY, fetchFn: fn })
    assert.deepEqual(e, { ok: true, teile: { app: 'ok', db: 'ok', auth: 'ok' } })
    assert.equal(aufrufe.length, 2)
    // ohne doppelten Schrägstrich, nur öffentlich lesbare Tabelle, eine Zeile
    assert.ok(aufrufe.some(a => a.ziel === 'https://beispiel.supabase.co/rest/v1/rebsorten?select=id&limit=1'))
    assert.ok(aufrufe.some(a => a.ziel === 'https://beispiel.supabase.co/auth/v1/health'))
    for (const a of aufrufe) {
      assert.equal(a.init.headers.apikey, KEY)
      assert.equal(a.init.cache, 'no-store')
    }
  })

  test('Datenbank antwortet mit 5xx → nicht ok, Teil db = fehler', async () => {
    const { fn } = attrappe({ '/rest/v1/': 503, '/auth/v1/health': 200 })
    const e = await pruefeVerfuegbarkeit({ url: URL_, anonKey: KEY, fetchFn: fn })
    assert.deepEqual(e, { ok: false, teile: { app: 'ok', db: 'fehler', auth: 'ok' } })
  })

  test('Anmeldedienst nicht erreichbar (Netzwerkfehler) → nicht ok', async () => {
    const { fn } = attrappe({ '/rest/v1/': 200, '/auth/v1/health': 'wirft' })
    const e = await pruefeVerfuegbarkeit({ url: URL_, anonKey: KEY, fetchFn: fn })
    assert.deepEqual(e, { ok: false, teile: { app: 'ok', db: 'ok', auth: 'fehler' } })
  })

  test('hängende Anfrage endet nach dem Zeitlimit als fehler', async () => {
    const { fn } = attrappe({ '/rest/v1/': 'haengt', '/auth/v1/health': 200 })
    const start = Date.now()
    const e = await pruefeVerfuegbarkeit({ url: URL_, anonKey: KEY, fetchFn: fn, zeitlimitMs: 50 })
    assert.equal(e.teile.db, 'fehler')
    assert.equal(e.ok, false)
    assert.ok(Date.now() - start < 2000)
  })

  test('fehlende Umgebungsvariablen → nicht ok ohne Netzaufruf', async () => {
    const { fn, aufrufe } = attrappe({})
    const e = await pruefeVerfuegbarkeit({ url: undefined, anonKey: KEY, fetchFn: fn })
    assert.equal(e.ok, false)
    assert.equal(aufrufe.length, 0)
  })
})

describe('Route /api/health', () => {
  const route = readFileSync(path.join(WURZEL, 'src/app/api/health/route.ts'), 'utf8')

  test('antwortet 200/503 und wird nie zwischengespeichert', () => {
    assert.match(route, /status:\s*ergebnis\.ok \? 200 : 503/)
    assert.match(route, /'Cache-Control':\s*'no-store/)
    assert.match(route, /export const dynamic = 'force-dynamic'/)
  })

  test('ohne Anmeldung erreichbar: begründete Zwei-Faktor-Ausnahme, kein Service-Role-Client', () => {
    assert.match(route, /\/\/ zwei-faktor-ausnahme: .{15,}/)
    assert.doesNotMatch(route, /admin|SERVICE_ROLE|createSupabase/i)
  })

  test('Proxy-Matcher schließt /api aus (sonst Umleitung auf den Login)', () => {
    const proxy = readFileSync(path.join(WURZEL, 'src/proxy.ts'), 'utf8')
    assert.match(proxy, /\(\?!_next\/static[^']*api\//)
  })

  test('nur GET – der Monitor schreibt nichts', () => {
    assert.doesNotMatch(route, /export async function (POST|PUT|PATCH|DELETE)/)
  })
})
