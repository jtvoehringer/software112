// KAN-286 (10.10.2026): Sitzung endet nach Inaktivität (Standard 60 Minuten) und beim Schließen des Browsers –
// serverseitig im Proxy, auch wenn der Tab geschlossen war. Vorher lief nur ein Timer im offenen Tab, und bei Betrieben
// ohne Einstellung (Gebeshuber, Spaetrot, Sandbox) lief die Sitzung nie ab.
//
// Aufruf:  npm run -s test:csv

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { hooksRegistrieren, laden, nurMitHooks, hooksMoeglich } from './buchung-attrappe.mjs'

hooksRegistrieren()
const s = hooksMoeglich ? await laden('lib/auth/sitzung.ts') : null
const quelle = p => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const MIN = 60_000
const T0 = Date.parse('2026-10-10T08:00:00Z')

describe('Sitzungsprüfung', nurMitHooks, () => {
  test('Zeitspanne: Standard 60, Grenzen 5–480', () => {
    assert.equal(s.timeoutMinuten(null), 60)
    assert.equal(s.timeoutMinuten(undefined), 60)
    assert.equal(s.timeoutMinuten(0), 60)
    assert.equal(s.timeoutMinuten(2), 5)
    assert.equal(s.timeoutMinuten(900), 480)
    assert.equal(s.timeoutMinuten(30), 30)
  })

  test('Cookie lesen und schreiben', () => {
    assert.equal(s.sitzungWert(T0, 30), `${T0}.30`)
    assert.deepEqual(s.leseSitzung(`${T0}.30`), { zuletzt: T0, minuten: 30 })
    assert.equal(s.leseSitzung('kaputt'), null)
    assert.equal(s.leseSitzung(''), null)
  })

  test('innerhalb der Zeitspanne ok, danach abgelaufen', () => {
    const cookie = s.sitzungWert(T0, 60)
    const alt = '2026-10-09T18:00:00Z'
    assert.deepEqual(s.pruefeSitzung({ cookie, jetztMs: T0 + 59 * MIN, letzteAnmeldung: alt }), { ergebnis: 'ok', minuten: 60 })
    assert.deepEqual(s.pruefeSitzung({ cookie, jetztMs: T0 + 61 * MIN, letzteAnmeldung: alt }), { ergebnis: 'abgelaufen' })
  })

  test('Befund KAN-286: Tab gestern geschlossen, heute neuer Tab → abgemeldet', () => {
    // Browser offen geblieben, Cookie von gestern Abend
    assert.deepEqual(s.pruefeSitzung({ cookie: s.sitzungWert(Date.parse('2026-10-09T18:00:00Z'), 60), jetztMs: T0, letzteAnmeldung: '2026-10-09T17:00:00Z' }), { ergebnis: 'abgelaufen' })
    // Browser geschlossen: Sitzungs-Cookie weg, Anmeldung von gestern
    assert.deepEqual(s.pruefeSitzung({ cookie: null, jetztMs: T0, letzteAnmeldung: '2026-10-09T17:00:00Z' }), { ergebnis: 'browser' })
  })

  test('frische Anmeldung beginnt eine neue Sitzung – auch mit altem, abgelaufenem Cookie', () => {
    assert.deepEqual(s.pruefeSitzung({ cookie: null, jetztMs: T0 + 2 * MIN, letzteAnmeldung: new Date(T0).toISOString() }), { ergebnis: 'neu', minuten: 60 })
    const altesCookie = s.sitzungWert(T0 - 5 * 60 * MIN, 30)
    assert.deepEqual(s.pruefeSitzung({ cookie: altesCookie, jetztMs: T0 + MIN, letzteAnmeldung: new Date(T0).toISOString() }), { ergebnis: 'neu', minuten: 30 })
    // ohne Cookie und Anmeldung älter als 10 Minuten → Browser war zu
    assert.deepEqual(s.pruefeSitzung({ cookie: null, jetztMs: T0 + 11 * MIN, letzteAnmeldung: new Date(T0).toISOString() }), { ergebnis: 'browser' })
  })

  test('Hinweis auf der Login-Seite', () => {
    assert.match(s.abmeldeHinweis('timeout'), /Inaktivität/)
    assert.match(s.abmeldeHinweis('browser'), /Schließen des Browsers/)
    assert.equal(s.abmeldeHinweis(null), null)
  })
})

describe('Verdrahtung', () => {
  test('Proxy: prüft angemeldete Seitenaufrufe, meldet ab und setzt das Cookie ohne Ablaufdatum', () => {
    const p = quelle('src/proxy.ts')
    assert.match(p, /if \(user && !isPublicRoute && !pathname\.startsWith\('\/auth\/'\)\) \{/)
    assert.match(p, /pruefeSitzung\(\{ cookie: request\.cookies\.get\(SITZUNG_COOKIE\)\?\.value, jetztMs: Date\.now\(\), letzteAnmeldung: user\.last_sign_in_at \}\)/)
    assert.match(p, /await supabase\.auth\.signOut\(\{ scope: 'local' \}\)/)
    assert.match(p, /ziel\.searchParams\.set\('grund', ABMELDE_GRUND\[p\.ergebnis\]\)/)
    assert.match(p, /supabaseResponse\.cookies\.set\(SITZUNG_COOKIE, sitzungWert\(Date\.now\(\), p\.minuten\), sitzungsCookie\)/)
    const opt = /const sitzungsCookie = \{([^}]*)\}/.exec(p)?.[1] ?? ''
    assert.doesNotMatch(opt, /maxAge|expires/, 'Sitzungs-Cookie ohne Ablaufdatum (endet mit dem Browser)')
  })

  test('SessionTimeout: immer aktiv (Standard 60), schreibt die Aktivität ins Sitzungs-Cookie, löscht es beim Abmelden', () => {
    const c = quelle('src/components/SessionTimeout.tsx')
    assert.match(c, /const timeoutMinuten = zeitspanne\(eingestellt\)/)
    assert.match(c, /sitzungsCookieSchreiben\(timeoutMinuten\) \}/)
    assert.match(c, /sitzungsCookieSchreiben\(timeoutMinuten, true\)\n\s*await s\.auth\.signOut\(\)/)
  })

  test('Login zeigt den Grund der Abmeldung', () => {
    assert.match(quelle('src/app/(auth)/login/page.tsx'), /abmeldeHinweis\(new URLSearchParams\(window\.location\.search\)\.get\('grund'\)\)/)
  })
})
