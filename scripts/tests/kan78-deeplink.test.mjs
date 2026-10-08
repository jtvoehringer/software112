// KAN-78 (08.10.2026) – Deep-Link durch Login, Zwei-Faktor und Betriebswahl: Der Proxy hängt das Ziel als `weiter`
// an /login bzw. /zwei-faktor, Login, Zwei-Faktor und Betriebswahl reichen es weiter – nur sichere relative Pfade
// (sichererWeiterPfad). Absolute oder fremde URLs werden ignoriert.
//
// Aufruf:  npm run -s test:csv   (alle scripts/tests/*.test.mjs)

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import * as w from '../../src/lib/tenant/waechter.ts'

const quelle = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')

describe('KAN-78: weiter-Parameter', () => {
  test('weiterFuerUmleitung: Zielseite mit Query; Anmelde-Stationen reichen ihr eigenes weiter durch', () => {
    assert.equal(w.weiterFuerUmleitung('/kellerbuch/behaelter/0f8f1c3e-1111-4222-8333-444455556666', ''), '/kellerbuch/behaelter/0f8f1c3e-1111-4222-8333-444455556666')
    assert.equal(w.weiterFuerUmleitung('/kellerbuch', '?tab=gebinde'), '/kellerbuch?tab=gebinde')
    assert.equal(w.weiterFuerUmleitung('/betrieb-waehlen', '?weiter=%2Fkellerbuch%2Fbehaelter%2Fx'), '/kellerbuch/behaelter/x')
    assert.equal(w.weiterFuerUmleitung('/zwei-faktor', '?weiter=%2Fcrm'), '/crm')
    assert.equal(w.weiterFuerUmleitung('/betrieb-waehlen', ''), null)
    assert.equal(w.weiterFuerUmleitung('/dashboard', ''), null)
    assert.equal(w.weiterFuerUmleitung('/', ''), null)
    assert.equal(w.weiterFuerUmleitung('/login', ''), null)
  })
  test('absolute oder fremde Ziele werden ignoriert', () => {
    for (const fremd of ['https://boese.example/x', '//boese.example/x', '/\\boese.example', 'javascript:alert(1)', '/auth/betrieb?tenant_id=x', 'kellerbuch']) {
      assert.equal(w.weiterFuerUmleitung('/betrieb-waehlen', `?weiter=${encodeURIComponent(fremd)}`), null, fremd)
      assert.equal(w.mitWeiter('/betrieb-waehlen', fremd), '/betrieb-waehlen', fremd)
    }
  })
  test('mitWeiter: hängt ein sicheres Ziel kodiert an', () => {
    assert.equal(w.mitWeiter('/betrieb-waehlen', '/kellerbuch?tab=gebinde'), '/betrieb-waehlen?weiter=%2Fkellerbuch%3Ftab%3Dgebinde')
    assert.equal(w.mitWeiter('/auth/betrieb?tenant_id=t', '/crm'), '/auth/betrieb?tenant_id=t&weiter=%2Fcrm')
    assert.equal(w.mitWeiter('/betrieb-waehlen', null), '/betrieb-waehlen')
    assert.equal(w.mitWeiter('/betrieb-waehlen', ''), '/betrieb-waehlen')
  })

  test('Verdrahtung: Proxy, Login, Zwei-Faktor, Betriebswahl', () => {
    const p = quelle('src/proxy.ts')
    assert.match(p, /const weiter = weiterFuerUmleitung\(pathname, request\.nextUrl\.search\)\n\s+if \(weiter\) url\.searchParams\.set\('weiter', weiter\)/)
    assert.match(p, /return umleiten\('\/login'\)/)
    assert.match(p, /return umleiten\('\/zwei-faktor'\)/)
    assert.match(p, /const ziel = sichererWeiterPfad\(request\.nextUrl\.searchParams\.get\('weiter'\)\) \?\? '\/dashboard'/)
    assert.match(quelle('src/app/(auth)/login/page.tsx'), /router\.push\(mitWeiter\('\/betrieb-waehlen', new URLSearchParams\(window\.location\.search\)\.get\('weiter'\)\)\)/)
    assert.match(quelle('src/app/zwei-faktor/page.tsx'), /router\.push\(mitWeiter\('\/betrieb-waehlen', params\.get\('weiter'\)\)\)/)
    const b = quelle('src/app/(auth)/betrieb-waehlen/page.tsx')
    assert.match(b, /const weiter = sichererWeiterPfad\(\(await searchParams\)\.weiter\)/)
    assert.match(b, /redirect\(wechselUrl\(String\(\(memberships\[0\] as R\)\.tenant_id\), weiter\)\)/)
    assert.match(b, /<BetriebListe betriebe=\{betriebe\} weiter=\{weiter\} \/>/)
    assert.match(quelle('src/app/(auth)/betrieb-waehlen/BetriebListe.tsx'), /\{weiter && <input type="hidden" name="weiter" value=\{weiter\} \/>\}/)
    const a = quelle('src/app/(auth)/betrieb-waehlen/actions.ts')
    assert.match(a, /const weiter = sichererWeiterPfad\(formData\.get\('weiter'\) as string \| null\) \?\? '\/dashboard'/)
    assert.match(a, /redirect\(ziel\?\.url \?\? weiter\)/)
  })
})
