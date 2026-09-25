// Tests für den Betriebs-Wächter (KAN-30): Nachrichtenformat, Entscheidungslogik, Dialogtext,
// Header an schreibenden Anfragen, Rücksprungziel, Next-Interna – ohne Browser und ohne
// Datenbank (25.09.2026)
//
// Aufruf:  npm run -s test:csv   (alle scripts/tests/*.test.mjs)
//          bzw. node --experimental-strip-types --test scripts/tests/betriebswaechter.test.mjs
//
// src/lib/tenant/waechter.ts und src/lib/fehler.ts haben bewusst keine '@/…'-Importe und laufen
// daher direkt mit Type-Stripping, ohne Auflösungs-Hook.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import * as w from '../../src/lib/tenant/waechter.ts'
import { AktionsFehler, fehlerText } from '../../src/lib/fehler.ts'

const A = 'fa22dc07-eca5-43df-af96-f7b9b09f0471'
const B = '0b1c2d3e-4f50-4617-8a9b-0c1d2e3f4a5b'
const ORIGIN = 'https://software112.icp-consultants.at'
const WEINGUT = { tenantId: A, name: 'Weingut Johannes Gebeshuber' }
const GMBH = { tenantId: B, name: 'Spaetrot Gebeshuber GmbH' }

describe('Meldungen zwischen Tabs', () => {
  test('bauen und lesen (Objekt aus BroadcastChannel)', () => {
    const m = w.meldungBauen(WEINGUT, 'tab-1', 1234)
    assert.deepEqual(w.meldungLesen(m), m)
    assert.equal(m.tenantId, A)
    assert.equal(m.name, 'Weingut Johannes Gebeshuber')
    assert.equal(m.tab, 'tab-1')
    assert.equal(m.zeit, 1234)
    assert.equal('mandant' in m, false)
  })

  test('lesen aus JSON (storage-Ereignis), Mandantenname wird mitgegeben', () => {
    const m = w.meldungBauen({ ...GMBH, mandant: 'Spaetrot Gebeshuber GmbH (FN 12345)' }, 'tab-2', 99)
    const gelesen = w.meldungLesen(JSON.stringify(m))
    assert.deepEqual(gelesen, m)
    assert.equal(gelesen.mandant, 'Spaetrot Gebeshuber GmbH (FN 12345)')
  })

  test('Prüf-Meldung ohne Betrieb (/abo, /zwei-faktor, /betrieb-waehlen)', () => {
    const p = w.pruefMeldungBauen('tab-3', 7)
    const gelesen = w.meldungLesen(JSON.stringify(p))
    assert.deepEqual(gelesen, p)
    assert.equal(w.istPruefMeldung(gelesen), true)
    assert.equal(w.istPruefMeldung(w.meldungLesen(w.meldungBauen(WEINGUT, 't'))), false)
    assert.equal('tenantId' in p, false)
  })

  test('fremde oder kaputte Nachrichten werden verworfen', () => {
    for (const roh of [null, undefined, 42, 'kein json', '{"typ":"anders"}', [], {},
      { typ: 's112-betrieb-aktiv' },
      { typ: 's112-betrieb-aktiv', tenantId: A },                 // ohne Tab
      { typ: 's112-betrieb-aktiv', tenantId: 7, tab: 't' },
      { typ: 's112-betrieb-aktiv', tenantId: '   ', tab: 't' },
      { typ: 's112-betrieb-aktiv', tenantId: 'x'.repeat(101), tab: 't' },
      { typ: 's112-betrieb-pruefen' },                            // Prüf-Meldung ohne Tab
      { typ: 'S112-BETRIEB-AKTIV', tenantId: A, tab: 't' }]) {
      assert.equal(w.meldungLesen(roh), null, JSON.stringify(roh))
    }
  })

  test('Name ist optional und wird begrenzt, Zeit fällt auf 0', () => {
    const m = w.meldungLesen({ typ: 's112-betrieb-aktiv', tenantId: A, tab: 't', name: 5 })
    assert.equal(m.name, '')
    assert.equal(m.zeit, 0)
    const lang = w.meldungLesen({ typ: 's112-betrieb-aktiv', tenantId: A, tab: 't', name: 'x'.repeat(500) })
    assert.equal(lang.name.length, 200)
  })
})

describe('Vergleich: Tab sperren?', () => {
  test('nur bei eindeutig anderem Betrieb', () => {
    assert.equal(w.weichtAb(A, GMBH), true)
    assert.equal(w.weichtAb(A, { tenantId: A, name: 'umbenannt' }), false)
    assert.equal(w.weichtAb(A, null), false)        // keine Aussage (abgemeldet, Fehler)
    assert.equal(w.weichtAb(A, undefined), false)
  })

  test('Antwort von /api/betrieb/aktiv', () => {
    assert.deepEqual(w.aktivAusAntwort(GMBH), GMBH)
    assert.deepEqual(w.aktivAusAntwort({ ...GMBH, mandant: 'GmbH' }), { ...GMBH, mandant: 'GmbH' })
    assert.deepEqual(w.aktivAusAntwort({ ...GMBH, mandant: '' }), GMBH)
    assert.deepEqual(w.aktivAusAntwort({ tenantId: B }), { tenantId: B, name: '' })
    assert.equal(w.aktivAusAntwort({ tenantId: null, name: null }), null)
    assert.equal(w.aktivAusAntwort({ fehler: 'Zwei-Faktor-Anmeldung erforderlich' }), null)
    assert.equal(w.aktivAusAntwort(null), null)
    assert.equal(w.aktivAusAntwort('A'), null)
  })

  test('Server: Betrieb der Seite passt zum Cookie', () => {
    assert.equal(w.seitenBetriebPasst(A, A), true)
    assert.equal(w.seitenBetriebPasst(` ${A} `, A), true)
    assert.equal(w.seitenBetriebPasst(B, A), false)
    // rückwärtskompatibel: ohne Angabe nie ablehnen
    assert.equal(w.seitenBetriebPasst(null, A), true)
    assert.equal(w.seitenBetriebPasst(undefined, A), true)
    assert.equal(w.seitenBetriebPasst('', A), true)
  })

  test('Fehlermeldung wie im Ticket – und unverändert durch fehlerText (Fehlergrenze erkennt sie)', () => {
    assert.equal(w.BETRIEB_GEWECHSELT_MELDUNG, 'Der Betrieb wurde in einem anderen Tab gewechselt – bitte Seite neu laden.')
    assert.equal(fehlerText(new AktionsFehler(w.BETRIEB_GEWECHSELT_MELDUNG), ''), w.BETRIEB_GEWECHSELT_MELDUNG)
    // Next maskiert in Produktion message, digest bleibt
    const maskiert = { message: 'An error occurred in the Server Components render.', digest: new AktionsFehler(w.BETRIEB_GEWECHSELT_MELDUNG).digest }
    assert.equal(fehlerText(maskiert, ''), w.BETRIEB_GEWECHSELT_MELDUNG)
  })

  test('ohne Browser: kein gesperrter Tab', () => {
    assert.equal(w.istTabGesperrt(), false)
  })
})

describe('Entscheidung im Wächter', () => {
  const basis = { anlass: 'rueckkehr', gesperrt: false, laeuft: false, zuletzt: 0, jetzt: 100_000, abstandMs: 15_000 }

  test('Abfrage starten: Rückkehr gedrosselt, Meldung und Zurück-Cache immer, gesperrt nie', () => {
    assert.equal(w.abfrageStarten(basis), true)                                    // erste Rückkehr nach dem Laden
    assert.equal(w.abfrageStarten({ ...basis, zuletzt: 90_000 }), false)           // vor 10 s schon gefragt
    assert.equal(w.abfrageStarten({ ...basis, zuletzt: 85_000 }), true)            // genau 15 s
    assert.equal(w.abfrageStarten({ ...basis, laeuft: true }), false)              // läuft schon
    assert.equal(w.abfrageStarten({ ...basis, anlass: 'meldung', zuletzt: 99_999, laeuft: true }), true)
    assert.equal(w.abfrageStarten({ ...basis, anlass: 'erzwingen', zuletzt: 99_999 }), true)
    for (const anlass of ['rueckkehr', 'meldung', 'erzwingen']) {
      assert.equal(w.abfrageStarten({ ...basis, anlass, gesperrt: true }), false, anlass)
    }
  })

  test('Server-Antwort entscheidet', () => {
    assert.deepEqual(w.sperrGrund(A, { ok: true, aktiv: GMBH }), GMBH)
    assert.equal(w.sperrGrund(A, { ok: true, aktiv: WEINGUT }), null)
    // Server sagt „gleicher Betrieb“ → Meldung eines veraltet geladenen Tabs zählt nicht
    assert.equal(w.sperrGrund(A, { ok: true, aktiv: WEINGUT }, GMBH), null)
    // abgemeldet / keine Mitgliedschaft → keine Aussage, nicht sperren
    assert.equal(w.sperrGrund(A, { ok: true, aktiv: null }, GMBH), null)
  })

  test('Abfrage gescheitert (401, offline, HTML): nur mit abweichender Meldung sperren', () => {
    assert.equal(w.sperrGrund(A, { ok: false }), null)                 // Einzel-Tab: kein Fehlalarm
    assert.equal(w.sperrGrund(A, { ok: false }, null), null)
    assert.equal(w.sperrGrund(A, { ok: false }, WEINGUT), null)
    assert.deepEqual(w.sperrGrund(A, { ok: false }, GMBH), GMBH)
  })
})

describe('Sperrdialog', () => {
  test('Wortlaut KAN-30, wenn ein anderer Tab gewechselt hat', () => {
    const n = w.dialogNamen(WEINGUT, GMBH)
    assert.deepEqual(n, { alt: 'Weingut Johannes Gebeshuber', neu: 'Spaetrot Gebeshuber GmbH' })
    assert.equal(w.sperrText(true, n.alt, n.neu),
      'Der Betrieb wurde in einem anderen Tab auf ‚Spaetrot Gebeshuber GmbH‘ gewechselt. Diese Seite zeigt noch ‚Weingut Johannes Gebeshuber‘. Bitte neu laden, bevor Sie weiterarbeiten.')
  })

  test('neutral ohne Tab-Meldung (Browser-Zurück, Rückkehr, Layout neu gerendert)', () => {
    const t = w.sperrText(false, 'Weingut Johannes Gebeshuber', 'Spaetrot Gebeshuber GmbH')
    assert.ok(!t.includes('in einem anderen Tab auf'))
    assert.ok(t.startsWith('Der aktive Betrieb wurde inzwischen auf ‚Spaetrot Gebeshuber GmbH‘ gewechselt'))
    assert.ok(t.endsWith('Diese Seite zeigt noch ‚Weingut Johannes Gebeshuber‘. Bitte neu laden, bevor Sie weiterarbeiten.'))
    assert.ok(w.sperrText(true, 'A', null).startsWith('Der Betrieb wurde in einem anderen Tab gewechselt.'))
  })

  test('gleicher Anzeigename: auf den Mandantennamen ausweichen, sonst ohne neuen Namen', () => {
    const alt = { tenantId: A, name: 'Gebeshuber', mandant: 'Weingut Johannes Gebeshuber' }
    const neu = { tenantId: B, name: 'Gebeshuber', mandant: 'Spaetrot Gebeshuber GmbH' }
    assert.deepEqual(w.dialogNamen(alt, neu), { alt: 'Weingut Johannes Gebeshuber', neu: 'Spaetrot Gebeshuber GmbH' })
    assert.deepEqual(w.dialogNamen({ tenantId: A, name: 'Gebeshuber' }, { tenantId: B, name: 'Gebeshuber' }), { alt: 'Gebeshuber', neu: null })
    assert.deepEqual(w.dialogNamen(WEINGUT, null), { alt: 'Weingut Johannes Gebeshuber', neu: null })
    assert.deepEqual(w.dialogNamen({ tenantId: A, name: '' }, { tenantId: B, name: '' }), { alt: 'Betrieb', neu: null })
  })
})

describe('Header an schreibenden Anfragen', () => {
  const action = (headers, method = 'POST') => ({ method, headers, body: '[]' })

  test('Server Action (Kopf als Objekt wie im Next-Router) bekommt den Betrieb', () => {
    const init = action({ Accept: 'text/x-component', 'Next-Action': 'abc123', 'Next-Router-State-Tree': '%5B%5D' })
    const neu = w.mitSeitenBetrieb('/weinhandel/verkauf/neu', init, A, ORIGIN)
    assert.ok(neu)
    const h = new Headers(neu.headers)
    assert.equal(h.get(w.SEITEN_BETRIEB_HEADER), A)
    assert.equal(h.get('next-action'), 'abc123')
    assert.equal(h.get('accept'), 'text/x-component')
    assert.equal(neu.method, 'POST')
    assert.equal(neu.body, '[]')
    // Original bleibt unverändert
    assert.equal(init.headers[w.SEITEN_BETRIEB_HEADER], undefined)
  })

  test('POST/PUT/PATCH/DELETE an /api (KI-Assistent, Import, Export, Belege) bekommen ihn auch', () => {
    for (const [url, methode] of [['/api/assistent/chat', 'POST'], ['/api/import', 'POST'], ['/api/weinexport/x', 'PATCH'],
      ['/api/kostenrechnung', 'post'], ['/api/nachrichten/delete', 'DELETE'], [`${ORIGIN}/api/weinexport`, 'PUT']]) {
      const neu = w.mitSeitenBetrieb(url, action({ 'content-type': 'application/json' }, methode), B, ORIGIN)
      assert.ok(neu, `${methode} ${url}`)
      const h = new Headers(neu.headers)
      assert.equal(h.get(w.SEITEN_BETRIEB_HEADER), B)
      assert.equal(h.get('content-type'), 'application/json')
    }
    // FormData-Upload ohne eigene Kopfzeilen (Belege): Content-Type setzt weiterhin der Browser
    const fd = new FormData()
    const neu = w.mitSeitenBetrieb('/api/buchhaltung/belege', { method: 'POST', body: fd }, A, ORIGIN)
    assert.equal(new Headers(neu.headers).get('content-type'), null)
    assert.equal(neu.body, fd)
  })

  test('Headers-Objekt, URL-Objekt, Request-ähnliche Eingabe und echter Request', () => {
    const neu = w.mitSeitenBetrieb(new URL('/kellerbuch/umziehen', ORIGIN), action(new Headers({ 'next-action': 'x' })), B, ORIGIN)
    assert.equal(new Headers(neu.headers).get(w.SEITEN_BETRIEB_HEADER), B)
    const neu2 = w.mitSeitenBetrieb({ url: `${ORIGIN}/buchhaltung/neu` }, action([['Next-Action', 'y']]), B, ORIGIN)
    assert.equal(new Headers(neu2.headers).get(w.SEITEN_BETRIEB_HEADER), B)
    // Request mit eigener Methode/Kopfzeilen und ohne init: Kopfzeilen bleiben erhalten
    const req = new Request(`${ORIGIN}/api/import`, { method: 'POST', headers: { 'x-eigen': '1' }, body: '{}' })
    const neu3 = w.mitSeitenBetrieb(req, undefined, A, ORIGIN)
    const h3 = new Headers(neu3.headers)
    assert.equal(h3.get('x-eigen'), '1')
    assert.equal(h3.get(w.SEITEN_BETRIEB_HEADER), A)
    assert.equal(new Request(req, neu3).headers.get(w.SEITEN_BETRIEB_HEADER), A)
  })

  test('alles andere bleibt unverändert', () => {
    assert.equal(w.mitSeitenBetrieb('/api/betrieb/aktiv', { cache: 'no-store' }, A, ORIGIN), null)            // GET
    assert.equal(w.mitSeitenBetrieb('/x', action({ 'Next-Action': 'a' }, 'GET'), A, ORIGIN), null)
    assert.equal(w.mitSeitenBetrieb('/x', action({}, 'HEAD'), A, ORIGIN), null)
    assert.equal(w.mitSeitenBetrieb('https://api.stripe.com/v1', action({ 'Next-Action': 'a' }), A, ORIGIN), null)  // fremde Herkunft
    assert.equal(w.mitSeitenBetrieb('https://zwcsgnemijkpyxrqykul.supabase.co/rest/v1/x', action({}), A, ORIGIN), null)
    assert.equal(w.mitSeitenBetrieb('//evil.example/x', action({}), A, ORIGIN), null)                       // protokollrelativ
    assert.equal(w.mitSeitenBetrieb('/x', undefined, A, ORIGIN), null)                                        // ohne init = GET
    assert.equal(w.mitSeitenBetrieb('/x', action({ 'Next-Action': 'a' }), null, ORIGIN), null)               // außerhalb des Arbeitsbereichs
    assert.equal(w.mitSeitenBetrieb(42, action({ 'Next-Action': 'a' }), A, ORIGIN), null)
    assert.equal(w.mitSeitenBetrieb(new Request(`${ORIGIN}/x`), undefined, A, ORIGIN), null)                  // Request mit GET
  })
})

describe('Zurück wechseln: /auth/betrieb?weiter=…', () => {
  test('eigene relative Pfade bleiben erhalten', () => {
    assert.equal(w.sichererWeiterPfad('/weinhandel/verkauf/neu'), '/weinhandel/verkauf/neu')
    assert.equal(w.sichererWeiterPfad('/kellerbuch?tab=gebinde#liste'), '/kellerbuch?tab=gebinde#liste')
    assert.equal(w.sichererWeiterPfad('/crm/kontakte/ä'), '/crm/kontakte/%C3%A4')
    assert.equal(w.sichererWeiterPfad('/a/./b/../c'), '/a/c')
    assert.equal(w.sichererWeiterPfad('/%2F%2Fevil.example'), '/%2F%2Fevil.example')   // kodierte Schrägstriche bleiben Pfad
  })

  test('kein offener Redirect – auch nicht über Punktsegmente', () => {
    for (const roh of ['//evil.example', '/\\evil.example', 'https://evil.example/', 'evil', '',
      null, undefined, '/\tevil', '/\r\nSet-Cookie: x=1', `/${'a'.repeat(2001)}`,
      '/auth/betrieb?tenant_id=x', '/auth/callback',
      // erst nach dem Auflösen der Punktsegmente entsteht „//host“
      '/.//evil.example', '/..//evil.example', '/a/..//evil.example', '/%2e//evil.example',
      '/%2e%2e//evil.example', '/././/evil.example/pfad?x=1', '/a/b/../..//evil.example']) {
      assert.equal(w.sichererWeiterPfad(roh), null, String(roh))
    }
  })

  test('Ergebnis bleibt nach dem Auflösen in der eigenen Herkunft', () => {
    for (const roh of ['/dashboard', '/a/./b', '/a/../b', '/x?weiter=//evil.example', '/x#//evil.example']) {
      const ziel = w.sichererWeiterPfad(roh)
      assert.ok(ziel, roh)
      assert.equal(new URL(ziel, ORIGIN).origin, ORIGIN, roh)
    }
  })

  test('Wechsel-Link', () => {
    assert.equal(w.wechselUrl(A), `/auth/betrieb?tenant_id=${A}`)
    const url = new URL(w.wechselUrl(A, '/kellerbuch?tab=gebinde'), ORIGIN)
    assert.equal(url.pathname, '/auth/betrieb')
    assert.equal(url.searchParams.get('tenant_id'), A)
    assert.equal(url.searchParams.get('weiter'), '/kellerbuch?tab=gebinde')
    // unsicheres Ziel fällt weg (Route leitet dann wie bisher auf /dashboard)
    assert.equal(w.wechselUrl(A, '//evil.example'), `/auth/betrieb?tenant_id=${A}`)
    assert.equal(w.wechselUrl(A, '/.//evil.example'), `/auth/betrieb?tenant_id=${A}`)
  })
})

// Die Server-Prüfung (lib/auth/seitenBetrieb.ts) hängt daran, dass der Next-Client-Router
// Server Actions zur Laufzeit über das GLOBALE fetch schickt – nur dann sieht der Wrapper des
// Wächters sie. Ändert ein Next-Update das, fehlte der Header still (fail-open). Dieser Test
// schlägt dann fehl, bevor das unbemerkt in Produktion geht.
describe('Next-Interna: Server Actions laufen über das globale fetch', () => {
  const require = createRequire(import.meta.url)
  const nextDir = path.dirname(require.resolve('next/package.json'))
  const lies = rel => readFileSync(path.join(nextDir, 'dist', rel), 'utf8')

  test('segment-cache/fetch.js ruft window.fetch zur Laufzeit auf', () => {
    for (const rel of ['client/components/segment-cache/fetch.js', 'esm/client/components/segment-cache/fetch.js']) {
      assert.match(lies(rel), /return fetch\(input, init\);/, rel)
    }
  })

  test('server-action-reducer schickt die Action über diesen fetch (POST mit Header-Objekt)', () => {
    const cjs = lies('client/components/router-reducer/reducers/server-action-reducer.js')
    assert.match(cjs, /require\("\.\.\/\.\.\/segment-cache\/fetch"\)/)
    assert.match(cjs, /\(0, _fetch\.fetch\)\(state\.canonicalUrl, \{\s*method: 'POST',\s*headers,/)
    const esm = lies('esm/client/components/router-reducer/reducers/server-action-reducer.js')
    assert.match(esm, /import \{ fetch \} from '\.\.\/\.\.\/segment-cache\/fetch';/)
    assert.match(esm, /await fetch\(state\.canonicalUrl, \{\s*method: 'POST',\s*headers,/)
  })
})
