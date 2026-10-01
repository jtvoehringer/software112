// KAN-180 (01.10.2026): Service Worker – cacht nur statische Dateien und die Offline-Seite, nie Betriebsdaten
//
// Aufruf:  node --experimental-strip-types --disable-warning=ExperimentalWarning --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test scripts/tests/kan180-sw.test.mjs
//          (läuft auch über npm run test:csv)
//
// public/sw.js wird in einer Sandbox geladen (self, caches als Attrappe); geprüft wird cacheRegel() und das Verhalten
// der Ereignisse install/activate/message/fetch.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import vm from 'node:vm'

const quelle = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')
const ORIGIN = 'https://software112.icp-consultants.at'

function ladeWorker() {
  const lauscher = {}
  const caches = new Map()
  const cacheApi = {
    open: async (n) => { if (!caches.has(n)) caches.set(n, new Map()); const c = caches.get(n); return { addAll: async (l) => l.forEach(u => c.set(u, 'vorab')), match: async (r) => c.get(typeof r === 'string' ? r : new URL(r.url).pathname), put: async (r, a) => c.set(new URL(r.url).pathname, a) } },
    keys: async () => [...caches.keys()],
    delete: async (n) => caches.delete(n),
    match: async (u) => { for (const c of caches.values()) if (c.has(u)) return c.get(u) },
  }
  const self = { location: new URL(ORIGIN), addEventListener: (t, f) => { lauscher[t] = f }, skipWaiting: () => { self.uebersprungen = true }, clients: { claim: async () => {} } }
  const ctx = vm.createContext({ self, caches: cacheApi, URL, Promise, fetch: async () => { throw new Error('offline') } })
  // const-Bindungen sind keine Eigenschaften des Kontexts – für die Prüfung ausdrücklich freigeben
  vm.runInContext(quelle('public/sw.js') + ';this.CACHE = CACHE; this.VORAB = VORAB', ctx)
  return { ctx, lauscher, caches, self }
}

describe('cacheRegel', () => {
  const { ctx } = ladeWorker()
  const regel = (pfad, methode = 'GET', modus = 'cors') => ctx.cacheRegel(new URL(pfad, ORIGIN), methode, modus)

  test('statisch: Build-Dateien mit Hash, Symbole, Offline-Seite', () => {
    for (const p of ['/_next/static/chunks/app-abc123.js', '/_next/static/media/plex-sans.woff2', '/_next/static/css/x.css?dpl=1', '/offline.html', '/favicon-192.png', '/icon-maskable-512.png']) {
      assert.equal(regel(p), 'statisch', p)
    }
  })
  test('nie gecacht: Seiten, RSC, Server Actions, /api, Bilder-Optimierung, fremde Hosts (Supabase)', () => {
    assert.equal(regel('/dashboard', 'GET', 'navigate'), 'navigation')
    assert.equal(regel('/kellerbuch?_rsc=abc'), 'netz')                     // RSC-Abruf beim Navigieren
    assert.equal(regel('/kellerbuch', 'POST'), 'netz')                      // Server Action
    for (const p of ['/api/export/kontakte', '/_next/image?url=%2Flogo.png&w=64', '/manifest.webmanifest', '/favicon-180.png', '/logos/betrieb.png']) {
      assert.equal(regel(p), 'netz', p)
    }
    assert.equal(ctx.cacheRegel(new URL('https://zwcsgnemijkpyxrqykul.supabase.co/rest/v1/weinausbau'), 'GET', 'cors'), 'netz')
    assert.equal(ctx.cacheRegel(new URL('https://zwcsgnemijkpyxrqykul.supabase.co/storage/v1/object/x.pdf'), 'GET', 'navigate'), 'netz')
    assert.equal(regel('/_next/static/x.js', 'POST'), 'netz')
  })
  test('alle Vorab-Dateien gibt es in public/', () => {
    for (const p of ctx.VORAB) assert.ok(existsSync(new URL(`../../public${p}`, import.meta.url)), p)
  })
})

describe('Ereignisse', () => {
  test('install legt nur die Vorab-Dateien an; Navigation offline → Offline-Seite; „netz“ ohne respondWith', async () => {
    const { lauscher, caches, ctx } = ladeWorker()
    let warte
    lauscher.install({ waitUntil: (p) => { warte = p } })
    await warte
    assert.deepEqual([...caches.keys()], [ctx.CACHE])
    assert.deepEqual([...caches.get(ctx.CACHE).keys()].sort(), [...ctx.VORAB].sort())

    let antwort
    lauscher.fetch({ request: { url: `${ORIGIN}/dashboard`, method: 'GET', mode: 'navigate' }, respondWith: (p) => { antwort = p } })
    assert.equal(await antwort, 'vorab')                                     // Inhalt der Offline-Seite (Attrappe)

    let aufgerufen = false
    lauscher.fetch({ request: { url: `${ORIGIN}/api/ki-abfrage`, method: 'POST', mode: 'cors' }, respondWith: () => { aufgerufen = true } })
    assert.equal(aufgerufen, false)
  })
  test('activate entfernt fremde bzw. alte Caches; cache-leeren leert alles und legt die Vorab-Dateien neu an', async () => {
    const { lauscher, caches, ctx } = ladeWorker()
    caches.set('s112-statisch-v0', new Map([['/alt.js', 'x']]))
    caches.set(ctx.CACHE, new Map([['/_next/static/a.js', 'x']]))
    let warte
    lauscher.activate({ waitUntil: (p) => { warte = p } })
    await warte
    assert.deepEqual([...caches.keys()], [ctx.CACHE])
    lauscher.message({ data: { typ: 'cache-leeren' }, waitUntil: (p) => { warte = p } })
    await warte
    assert.deepEqual([...caches.get(ctx.CACHE).keys()].sort(), [...ctx.VORAB].sort())
  })
  test('skip-waiting nur auf Nachricht (Hinweis „Neu laden“)', () => {
    const { lauscher, self } = ladeWorker()
    let warte
    lauscher.install({ waitUntil: (p) => { warte = p } })
    assert.equal(self.uebersprungen, undefined)
    lauscher.message({ data: { typ: 'skip-waiting' }, waitUntil: () => {} })
    assert.equal(self.uebersprungen, true)
    return warte
  })
})

describe('Einbindung', () => {
  test('Proxy lässt sw.js und offline.html ohne Anmeldung durch, Seiten bleiben geschützt', () => {
    const m = quelle('src/proxy.ts').match(/matcher:\s*\[\s*(?:\/\/[^\n]*\n\s*)*'([^']+)'/)
    const muster = new RegExp(`^${m[1].split('\\\\').join('\\')}$`)
    for (const p of ['/sw.js', '/offline.html', '/manifest.webmanifest']) assert.equal(muster.test(p), false, p)
    for (const p of ['/dashboard', '/login', '/sw.jsx', '/offline.html/x']) assert.equal(muster.test(p), true, p)
  })
  test('Header no-cache für sw.js, CSP worker-src; Registrierung im Root-Layout, Cache leeren im Auth-Layout', () => {
    const cfg = quelle('next.config.ts')
    assert.match(cfg, /"worker-src 'self'"/)
    assert.match(cfg, /source: '\/sw\.js'[\s\S]*no-cache, no-store[\s\S]*Service-Worker-Allowed/)
    assert.match(quelle('src/app/layout.tsx'), /<ServiceWorker \/>/)
    assert.match(quelle('src/app/(auth)/layout.tsx'), /<SwCacheLeeren \/>/)
    assert.match(quelle('src/components/pwa/ServiceWorker.tsx'), /NODE_ENV !== 'production'/)
  })
})
