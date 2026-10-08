// KAN-217 (07.10.2026) – öffentliche E-Label-Seite mit QR-Code (DE/EN); Nebenbefund: Weinpass /w/ war nicht öffentlich.
//
// Aufruf:  npm run -s test:csv   (alle scripts/tests/*.test.mjs)

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const quelle = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const o = await import('../../src/lib/elabel/oeffentlich.ts')

describe('KAN-217: Adresse, Umschreiben, Sprache', () => {
  test('Kennung wie der CHECK der Tabelle', () => {
    assert.equal(o.istElabelCode('ABCDEFGH23'), true)
    assert.equal(o.istElabelCode('ABCDEFGH20'), false)   // 0 nicht erlaubt
    assert.equal(o.istElabelCode('abcdefgh23'), false)
  })
  test('Link: ohne Host auf der App-Domain, mit Host auf der E-Label-Domain', () => {
    assert.equal(o.elabelUrl('ABCDEFGH23', 'https://app.example/', null), 'https://app.example/e/ABCDEFGH23')
    assert.equal(o.elabelUrl('ABCDEFGH23', 'https://app.example', 'e.hohenstein-partner.at'), 'https://e.hohenstein-partner.at/ABCDEFGH23')
    assert.equal(o.elabelHost(' https://E.Hohenstein-Partner.at/ '), 'e.hohenstein-partner.at')
    assert.equal(o.elabelHost(''), null)
  })
  test('Proxy schreibt nur Anfragen an den E-Label-Host um', () => {
    const h = 'e.hohenstein-partner.at'
    assert.equal(o.elabelRewritePfad('e.hohenstein-partner.at', '/ABCDEFGH23', h), '/e/ABCDEFGH23')
    assert.equal(o.elabelRewritePfad('E.hohenstein-partner.at:443', '/ABCDEFGH23', h), '/e/ABCDEFGH23')
    assert.equal(o.elabelRewritePfad('e.hohenstein-partner.at', '/e/ABCDEFGH23', h), null)
    assert.equal(o.elabelRewritePfad('software112.icp-consultants.at', '/ABCDEFGH23', h), null)
    assert.equal(o.elabelRewritePfad('e.hohenstein-partner.at', '/x', null), null)
  })
  test('Sprache: ?lang vor Browsersprache, ohne Angabe Deutsch', () => {
    assert.equal(o.elabelSprache('en', 'de-AT,de;q=0.9'), 'en')
    assert.equal(o.elabelSprache(null, 'en-GB,en;q=0.9,de;q=0.8'), 'en')
    assert.equal(o.elabelSprache(null, 'fr-FR,fr;q=0.9'), 'fr')   // KAN-218: alle EU-Amtssprachen (vorher Deutsch)
    assert.equal(o.zahlText(12.5, 1, 'de'), '12,5')
    assert.equal(o.zahlText(12.5, 1, 'en'), '12.5')
  })
})

describe('KAN-217: Verdrahtung', () => {
  test('Proxy: /w/ und /e/ öffentlich, Umschreiben vor der Anmeldeprüfung', () => {
    const p = quelle('src/proxy.ts')
    assert.match(p, /const PUBLIC_ROUTES = \[[^\]]*'\/w\/', '\/e\/'\]/)
    assert.ok(p.indexOf('elabelRewritePfad(') < p.indexOf('auth.getUser()'), 'Umschreiben vor getUser')
    assert.ok(p.includes("&& !pathname.startsWith('/w/') && !pathname.startsWith('/e/')) {"), 'öffentliche Seiten ohne Zwei-Faktor-Umleitung')
  })
  test('Öffentliche Seite: nur freigegebene E-Labels, Service-Role, keine Cookies/Tracking-Bausteine', () => {
    const s = quelle('src/app/e/[code]/page.tsx')
    assert.match(s, /\.eq\('code', code\)\.eq\('status', 'freigegeben'\)/)
    assert.match(s, /createSupabaseAdminClient\(\)/)
    assert.doesNotMatch(s, /cookies\(|gtag|analytics/i)
    assert.match(s, /robots: \{ index: false, follow: false \}/)
  })
  test('QR-Code lokal (lib/qr), erst nach der Freigabe, mit Druckhinweis', () => {
    const s = quelle('src/app/(dashboard)/weinhandel/fuellungen/[id]/elabel/page.tsx')
    assert.match(s, /stand\?\.status === 'freigegeben' \? elabelUrl\(stand\.code, appBasisUrl\(\)\) : null/)
    assert.match(s, /await qrSvg\(oeffentlich\)/)
    assert.doesNotMatch(s, /qrserver|chart\.googleapis/)
    assert.match(s, /etikettEnergie\(/)
  })
})
