// KAN-179 (01.10.2026): software:112 als installierbare App – Manifest, Icons, Proxy-Ausnahme, CSP
//
// Aufruf:  node --experimental-strip-types --disable-warning=ExperimentalWarning --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test scripts/tests/kan179-pwa.test.mjs
//          (läuft auch über npm run test:csv)

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'

const quelle = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')
const datei = (p) => new URL(`../../${p}`, import.meta.url)
const { default: manifest } = await import('../../src/app/manifest.ts')

describe('Manifest', () => {
  const m = manifest()
  test('installierbar: Name, Start, standalone, Icons 192/512 (any und maskable)', () => {
    assert.equal(m.name, 'software:112')
    assert.equal(m.start_url, '/dashboard')
    assert.equal(m.display, 'standalone')
    for (const groesse of ['192x192', '512x512']) {
      for (const zweck of ['any', 'maskable']) {
        assert.ok(m.icons.some(i => i.sizes === groesse && i.purpose === zweck), `${groesse} ${zweck}`)
      }
    }
  })
  test('alle Icons und Schnellzugriffe zeigen auf vorhandene Dateien bzw. Seiten', () => {
    for (const i of m.icons) assert.ok(existsSync(datei(`public${i.src}`)), i.src)
    const seite = { '/erntemeldung': 'src/app/(dashboard)/erntemeldung/page.tsx', '/behandlungen/neu': 'src/app/(dashboard)/behandlungen/neu/page.tsx', '/kellerbuch': 'src/app/(dashboard)/kellerbuch/page.tsx' }
    for (const s of m.shortcuts) assert.ok(existsSync(datei(seite[s.url])), s.url)
  })
})

describe('Auslieferung', () => {
  test('Proxy-Matcher nimmt manifest.webmanifest aus (sonst Umleitung auf den Login), Seiten bleiben geschützt', () => {
    const m = quelle('src/proxy.ts').match(/matcher:\s*\[\s*(?:\/\/[^\n]*\n\s*)*'([^']+)'/)
    assert.ok(m, 'Matcher gefunden')
    // Quelltext des String-Literals: „\\.“ steht für den Regex-Punkt „\.“
    const muster = new RegExp(`^${m[1].split('\\\\').join('\\')}$`)
    assert.equal(muster.test('/manifest.webmanifest'), false)
    for (const p of ['/dashboard', '/erntemeldung', '/kellerbuch', '/login']) assert.equal(muster.test(p), true, p)
  })
  test('CSP erlaubt das eigene Manifest; Layout mit iOS-Einstellungen, ohne doppelten Manifest-Link', () => {
    assert.match(quelle('next.config.ts'), /"manifest-src 'self'"/)
    const layout = quelle('src/app/layout.tsx')
    assert.doesNotMatch(layout, /manifest: '/)   // Next verlinkt app/manifest.ts selbst
    assert.match(layout, /appleWebApp: \{/)
  })
})
