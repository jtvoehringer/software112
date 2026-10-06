// KAN-31 (06.10.2026) – Betrieb je Tab über die Subdomain (gebeshuber.software112.icp-consultants.at …)
//
// Aufruf:  npm run -s test:csv   (alle scripts/tests/*.test.mjs)
//
// Geprüft: Host → Subdomain (nur unter der Basis, nur ein Label, reserviert/ungültig → null), gemeinsames
// Anmelde-Cookie nur unter der Basis, Ziel-URLs, und die Verdrahtung: ohne NEXT_PUBLIC_S112_SUBDOMAIN_BASIS bleibt
// alles wie bisher; auf einer Subdomain kein Rückfall auf Cookie/ersten Betrieb.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const s = await import('../../src/lib/tenant/subdomain.ts')
const quelle = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const B = 'software112.icp-consultants.at'

describe('subdomainAusHost()', () => {
  test('Betriebs-Subdomain unter der Basis, auch mit Port und Großbuchstaben', () => {
    assert.equal(s.subdomainAusHost(`gebeshuber.${B}`, B), 'gebeshuber')
    assert.equal(s.subdomainAusHost(`Spaetrot.${B.toUpperCase()}:443`, B), 'spaetrot')
  })
  test('Hauptdomain, fremde Hosts, mehrere Labels → null', () => {
    assert.equal(s.subdomainAusHost(B, B), null)
    assert.equal(s.subdomainAusHost('gebeshuber.example.com', B), null)
    assert.equal(s.subdomainAusHost(`a.b.${B}`, B), null)
    assert.equal(s.subdomainAusHost(`gebeshuber.${B}.evil.com`, B), null)
    assert.equal(s.subdomainAusHost(`x${B}`, B), null)
  })
  test('reservierte oder ungültige Namen → null', () => {
    for (const r of ['www', 'api', 'admin', 'staging', '-ab', 'ab-', 'a']) assert.equal(s.subdomainAusHost(`${r}.${B}`, B), null, r)
  })
  test('Funktion aus (keine Basis) → immer null', () => {
    assert.equal(s.subdomainAusHost(`gebeshuber.${B}`, ''), null)
    assert.equal(s.subdomainBasis(undefined), '')
    assert.equal(s.subdomainBasis(' .Software112.icp-consultants.at. '), B)
  })
})

describe('Cookie und Ziel-URLs', () => {
  test('gemeinsames Anmelde-Cookie nur unter der Basis (nicht auf Vercel-Previews)', () => {
    assert.deepEqual(s.authCookieOptionen(`gebeshuber.${B}`, B), { name: 'sb-s112-auth', domain: B, path: '/', sameSite: 'lax', secure: true })
    assert.ok(s.authCookieOptionen(B, B))
    assert.equal(s.authCookieOptionen('software112-git-x.vercel.app', B), undefined)
    assert.equal(s.authCookieOptionen(`gebeshuber.${B}`, ''), undefined)
  })
  test('subdomainUrl: nur relative Pfade, sonst /dashboard', () => {
    assert.equal(s.subdomainUrl('gebeshuber', '/kellerbuch?x=1', B), `https://gebeshuber.${B}/kellerbuch?x=1`)
    assert.equal(s.subdomainUrl(null, '/betrieb-waehlen', B), `https://${B}/betrieb-waehlen`)
    assert.equal(s.subdomainUrl('a1', '//evil.com', B), `https://a1.${B}/dashboard`)
    assert.equal(s.subdomainUrl('a1', '/x', ''), null)
  })
  test('subdomainFehler', () => {
    assert.equal(s.subdomainFehler('gebeshuber'), null)
    assert.match(s.subdomainFehler('www'), /reserviert/)
    assert.match(s.subdomainFehler('Gebes_huber'), /Kleinbuchstaben/)
  })
  test('reservierte Namen = CHECK der Migration', () => {
    const m = quelle('supabase/migrations/20261006132251_kan31_tenants_subdomain.sql')
    const liste = m.match(/NOT IN \(([^)]*)\)/)[1].split(',').map(x => x.trim().replace(/'/g, ''))
    assert.deepEqual([...liste].sort(), [...s.RESERVIERTE_SUBDOMAINS].sort())
  })
})

describe('Verdrahtung', () => {
  test('getCurrentMembership: Subdomain vor Cookie, ohne Rückfall', () => {
    const r = quelle('src/lib/auth/roles.ts')
    const sub = r.indexOf('const sub = await aktiveSubdomain()')
    assert.ok(sub > 0 && sub < r.indexOf('if (activeTenantId) {'))
    assert.match(r, /\.eq\('tenants\.subdomain', sub\)/)
    assert.match(r, /return data \? membershipAus\(data as R\) : null\n  \}/)
  })
  test('alle Supabase-Clients nutzen authCookieOptionen', () => {
    for (const f of ['src/lib/supabase/server.ts', 'src/lib/supabase/client.ts', 'src/proxy.ts']) {
      assert.match(quelle(f), /authCookieOptionen\(/, f)
      assert.match(quelle(f), /cookieOptions \?/, f)
    }
  })
  test('Betriebswahl und /auth/betrieb leiten auf die Subdomain', () => {
    assert.match(quelle('src/app/(auth)/betrieb-waehlen/actions.ts'), /subdomainZiel\(supabase, tenantId, '\/dashboard'\)/)
    assert.match(quelle('src/app/auth/betrieb/route.ts'), /subdomainZiel\(supabase, tenantId, weiter\)/)
  })
  test('Subdomain setzen nur Plattform-Admins', () => {
    const a = quelle('src/app/(dashboard)/admin/mandanten/[id]/actions.ts')
    const i = a.indexOf('export async function setTenantSubdomain')
    assert.ok(i > 0)
    assert.match(a.slice(i, i + 300), /istPlattformAdmin\(\)/)
  })
})

describe('Hauptdomain-Betrieb bleibt beim Wechsel auf eine Subdomain (Vorschlag Jörgen: Gebeshuber Hauptdomain, Spaetrot Subdomain)', () => {
  test('Betriebswahl und /auth/betrieb setzen das Cookie nur ohne Subdomain-Ziel oder beim Weg zurück zur Hauptdomain', () => {
    const w = quelle('src/app/(auth)/betrieb-waehlen/actions.ts')
    assert.match(w, /if \(!ziel \|\| ziel\.cookie\) await setActiveTenantCookie\(tenantId\)/)
    assert.ok(w.indexOf('subdomainZiel(') < w.indexOf('setActiveTenantCookie(tenantId)'), 'Ziel vor dem Cookie bestimmen')
    const r = quelle('src/app/auth/betrieb/route.ts')
    assert.match(r, /if \(!subZiel \|\| subZiel\.cookie\) await setActiveTenantCookie\(tenantId\)/)
  })
  test('subdomainZiel: Subdomain-Betrieb ohne Cookie, Weg zur Hauptdomain mit Cookie', () => {
    const s = quelle('src/lib/tenant/subdomainServer.ts')
    assert.match(s, /return \{ url: subUrl, cookie: false \}/)
    assert.match(s, /return haupt \? \{ url: haupt, cookie: true \} : null/)
  })
  test('Betriebs-Cookie im Subdomain-Betrieb für die ganze Basis (eigener Name), sonst wie bisher', () => {
    const a = quelle('src/lib/auth/activeTenant.ts')
    assert.match(a, /const COOKIE = 's112_active_tenant'/)
    assert.match(a, /if \(hostUnterBasis\(.*\)\) return \{ name: COOKIE_SUBDOMAIN, domain: subdomainBasis\(\) \}/)
  })
})
