// KAN-399 (01.11.2026): Passkey-Anmeldung schneller (eine Navigation, eine Umleitung weniger, auf der Subdomain kein
// zweiter Klick) und ein einheitlicher Ladekreisel in CD-Blau #2F63AC – auch an Tabs und Breadcrumbs.
//
// Aufruf:  npm run -s test:csv   (alle scripts/tests/*.test.mjs)

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PASSKEY_START_PFAD, passkeyAutomatisch } from '../../src/lib/auth/passkey.ts'

const WURZEL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const quelle = (p) => readFileSync(path.join(WURZEL, p), 'utf8').replace(/\r\n/g, '\n')

function alleDateien(dir, out = []) {
  for (const n of readdirSync(dir)) {
    const p = path.join(dir, n)
    if (statSync(p).isDirectory()) alleDateien(p, out)
    else if (/\.tsx$/.test(n)) out.push(p)
  }
  return out
}

describe('KAN-399: Passkey auf der Subdomain ohne zweiten Klick', () => {
  test('Startpfad trägt passkey=1, nur genau dieser Wert startet', () => {
    assert.equal(PASSKEY_START_PFAD, '/login?passkey=1')
    assert.equal(passkeyAutomatisch('?passkey=1'), true)
    assert.equal(passkeyAutomatisch('?weiter=%2Fdashboard&passkey=1'), true)
    assert.equal(passkeyAutomatisch(''), false)
    assert.equal(passkeyAutomatisch('?passkey=0'), false)
    assert.equal(passkeyAutomatisch('?passkey=ja'), false)
  })
  test('Login: Subdomain springt auf den Startpfad, Auto-Start ohne Fehlermeldung, nur einmal', () => {
    const s = quelle('src/app/(auth)/login/page.tsx')
    assert.match(s, /basisLogin: sub \? subdomainUrl\(null, PASSKEY_START_PFAD\) : null/)
    assert.match(s, /if \(autoGestartet \|\| !passkey\.moeglich \|\| passkey\.basisLogin\) return/)
    assert.match(s, /void mitPasskey\(true\)/)
    assert.match(s, /if \(!automatisch\) setError\(passkeyFehlerText\(error\)\)/)
    assert.match(s, /onClick=\{\(\) => void mitPasskey\(\)\}/)
  })
})

describe('KAN-399: weniger Umleitungen nach der Anmeldung', () => {
  test('Login und Zwei-Faktor: eine Navigation direkt zu /auth/betrieb, kein push + refresh', () => {
    for (const p of ['src/app/(auth)/login/page.tsx', 'src/app/zwei-faktor/page.tsx']) {
      const s = quelle(p)
      assert.match(s, /window\.location\.assign\(mitWeiter\('\/auth\/betrieb', /, p)
      assert.doesNotMatch(s, /mitWeiter\('\/betrieb-waehlen'/, p)
      assert.doesNotMatch(s, /router\.refresh\(\)/, p)
    }
  })
  test('/auth/betrieb ohne tenant_id: ein Betrieb → selbst wählen, sonst Auswahl mit weiter; nur eigene aktive', () => {
    const s = quelle('src/app/auth/betrieb/route.ts')
    assert.match(s, /if \(!user\) return NextResponse\.redirect/)
    assert.match(s, /tenantId = await einzigerBetrieb\(supabase, user\.id\)/)
    assert.match(s, /if \(!tenantId\) return NextResponse\.redirect\(new URL\(mitWeiter\('\/betrieb-waehlen', searchParams\.get\('weiter'\)\), origin\)\)/)
    assert.match(s, /\.eq\('user_id', userId\)\.eq\('aktiv', true\)\.order\('tenant_id'\)\.limit\(2\)/)
    assert.match(s, /return zeilen\.length === 1 \?/)
    // die Mitgliedschaftsprüfung danach bleibt (auch für den selbst gewählten Betrieb)
    assert.ok(s.indexOf('einzigerBetrieb(supabase') < s.indexOf("// Sicherheit: nur eigene, aktive Mitgliedschaften"))
  })
})

describe('KAN-399: Ladekreisel in CD-Blau', () => {
  test('Baustein: fest s112-blue-700 (#2F63AC), auf farbigen Knöpfen in Schriftfarbe', () => {
    const k = quelle('src/components/ui/Kreisel.tsx')
    assert.match(k, /export const KREISEL_FARBE = 'text-s112-blue-700'/)
    assert.match(quelle('src/app/globals.css'), /--color-s112-blue-700: #2f63ac;/)
    assert.match(quelle('src/app/(auth)/login/page.tsx'), /<Kreisel aufKnopf \/>/)
  })
  test('keine eigenen Kreisel-SVGs mehr in Anmeldung, Zwei-Faktor, Betriebsauswahl, Willkommen', () => {
    for (const p of ['src/app/(auth)/login/page.tsx', 'src/app/zwei-faktor/page.tsx', 'src/app/(auth)/betrieb-waehlen/BetriebCard.tsx', 'src/app/signup/willkommen/page.tsx']) {
      const s = quelle(p)
      assert.doesNotMatch(s, /<svg[^>]*animate-spin/, p)
      assert.match(s, /import Kreisel from '@\/components\/ui\/Kreisel'/, p)
    }
  })
  test('dreht auch bei „weniger Bewegung“ (Windows-Animationseffekte aus), nur langsamer', () => {
    const css = quelle('src/app/globals.css')
    const block = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'))
    assert.match(block, /\.animate-spin \{\s*animation-duration: 1\.5s !important;\s*animation-iteration-count: infinite !important;/)
    // die allgemeine Regel bleibt
    assert.match(block, /animation-iteration-count: 1 !important;/)
  })
  test('LinkSpinner immer blau, Tabs ohne eigene Farbe (nicht die Betriebsfarbe s112-teal)', () => {
    assert.match(quelle('src/components/ui/Link.tsx'), /animate-spin align-\[-1px\] \$\{KREISEL_FARBE\} \$\{className\}/)
    const t = quelle('src/components/layout/TabNav.tsx')
    assert.equal((t.match(/<LinkSpinner \/>/g) ?? []).length, 2)
    assert.doesNotMatch(t, /LinkSpinner className="text-s112-teal"/)
  })
  test('jede Breadcrumb-Leiste nutzt BrotkrumenLink', () => {
    let leisten = 0
    for (const p of alleDateien(path.join(WURZEL, 'src'))) {
      const s = readFileSync(p, 'utf8').replace(/\r\n/g, '\n')
      // Leiste = vom Kommentar bis zum ersten </nav> bzw. </div> (eine äußere Zeile mit Aktionsknöpfen zählt nicht)
      const re = /\{\/\* *Breadcrumb[^]*?<(?:nav|div)[\s>]([^]*?)<\/(?:nav|div)>/gi
      for (const m of s.matchAll(re)) {
        leisten++
        assert.match(m[1], /<BrotkrumenLink[\s>]/, `${path.relative(WURZEL, p)}: Breadcrumb ohne BrotkrumenLink`)
        assert.doesNotMatch(m[1], /<Link[\s>]/, `${path.relative(WURZEL, p)}: Breadcrumb mit <Link> statt <BrotkrumenLink>`)
      }
    }
    assert.ok(leisten >= 17, `nur ${leisten} Breadcrumb-Leisten gefunden`)
  })
})
