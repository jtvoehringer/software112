/* software:112 – Service Worker (KAN-180, 01.10.2026)
 *
 * Grundsatz Datenschutz / Mandantentrennung: NIE Seiten, Server-Action- oder /api-Antworten, Supabase-Abfragen
 * oder Storage-Dateien cachen – sie enthalten Daten eines Betriebs und eines Benutzers. Gecacht werden nur
 * unveränderliche Build-Dateien (/_next/static/* mit Hash im Namen, auch Schriften), die App-Symbole und die
 * statische Offline-Seite. Alles andere geht unverändert ans Netz (kein respondWith).
 *
 * Seitenaufrufe (Navigation) gehen immer ans Netz; nur wenn keine Verbindung besteht, zeigt der Worker die
 * Offline-Seite. Ein neuer Worker wartet, bis der Benutzer im Hinweis „Neu laden“ wählt (Nachricht
 * 'skip-waiting') – sonst liefen Server Actions des offenen Tabs gegen eine neue Version. Beim Abmelden und beim
 * Betriebswechsel leert die App den Cache (Nachricht 'cache-leeren', components/pwa/SwCacheLeeren.tsx).
 *
 * Bei Änderungen an dieser Datei VERSION erhöhen (neuer Cache-Name, alte Caches werden beim Aktivieren entfernt).
 * Routing-Regeln: scripts/tests/kan180-sw.test.mjs.
 */

const VERSION = 1
const CACHE = 's112-statisch-v' + VERSION
const OFFLINE_URL = '/offline.html'
const VORAB = [OFFLINE_URL, '/favicon.svg', '/favicon-192.png', '/favicon-512.png', '/icon-maskable-192.png', '/icon-maskable-512.png']

/**
 * Was passiert mit einer Anfrage?
 *  'statisch'  – Cache zuerst (unveränderliche Datei), sonst Netz und in den Cache legen
 *  'navigation' – nur Netz; ohne Verbindung die Offline-Seite
 *  'netz'      – unverändert ans Netz, nichts wird gespeichert
 */
function cacheRegel(url, methode, modus) {
  if (methode !== 'GET') return 'netz'
  if (url.origin !== self.location.origin) return 'netz'
  if (url.search) return url.pathname.startsWith('/_next/static/') ? 'statisch' : modus === 'navigate' ? 'navigation' : 'netz'
  if (url.pathname.startsWith('/_next/static/')) return 'statisch'
  if (VORAB.includes(url.pathname)) return 'statisch'
  if (modus === 'navigate') return 'navigation'
  return 'netz'
}

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(VORAB)))
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((namen) => Promise.all(namen.filter((n) => n !== CACHE).map((n) => caches.delete(n))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('message', (event) => {
  const typ = event.data && event.data.typ
  if (typ === 'skip-waiting') self.skipWaiting()
  if (typ === 'cache-leeren') {
    event.waitUntil(
      caches.keys()
        .then((namen) => Promise.all(namen.map((n) => caches.delete(n))))
        .then(() => caches.open(CACHE).then((c) => c.addAll(VORAB))),
    )
  }
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  const regel = cacheRegel(new URL(req.url), req.method, req.mode)
  if (regel === 'statisch') {
    event.respondWith(
      caches.open(CACHE).then((c) => c.match(req).then((treffer) => treffer || fetch(req).then((antwort) => {
        if (antwort.ok && antwort.type === 'basic') c.put(req, antwort.clone())
        return antwort
      }))),
    )
  } else if (regel === 'navigation') {
    event.respondWith(fetch(req).catch(() => caches.match(OFFLINE_URL)))
  }
  // 'netz': kein respondWith – der Browser holt wie ohne Service Worker
})
