// KAN-300 (10.11.2026) – AGB, Datenschutzerklärung und Impressum als öffentliche Seiten; die Registrierung prüft die
// Zustimmung auf dem Server und speichert die bestätigte Vertragsfassung beim neuen Betrieb.
// Regression: bis dahin führten die Links der Registrierung ins Leere (404), und nur der Browser prüfte das Häkchen –
// ein Aufruf der Server Action ohne Formular legte einen Betrieb ohne Zustimmung an.
//
// Aufruf:  npm run -s test:csv

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'

const datei = (p) => new URL(`../../${p}`, import.meta.url)
const quelle = (p) => readFileSync(datei(p), 'utf8').replace(/\r\n/g, '\n')
const f = await import('../../src/lib/vertrag/fassung.ts')

describe('KAN-300: öffentliche Rechtsseiten', () => {
  test('Seiten /agb, /datenschutz, /impressum gibt es', () => {
    for (const s of ['agb', 'datenschutz', 'impressum']) assert.ok(existsSync(datei(`src/app/${s}/page.tsx`)), s)
  })
  test('die PDF der gültigen Fassung liegt unter public/ und die Seite verlinkt sie', () => {
    assert.match(f.VERTRAG_PDF, /^\/agb\/.+\.pdf$/)
    assert.ok(existsSync(datei(`public${f.VERTRAG_PDF}`)), f.VERTRAG_PDF)
    assert.match(quelle('src/app/agb/page.tsx'), /href=\{VERTRAG_PDF\}/)
  })
  test('ohne Anmeldung erreichbar (PUBLIC_ROUTES), E-Label und Weinpass bleiben am Ende', () => {
    const p = quelle('src/proxy.ts')
    for (const r of ['/agb', '/datenschutz', '/impressum']) assert.match(p, new RegExp(`const PUBLIC_ROUTES = \\[[^\\]]*'${r}'`), r)
    assert.match(p, /const PUBLIC_ROUTES = \[[^\]]*'\/w\/', '\/e\/'\]/)
  })
  test('Links im Fuß von Anmeldung, Registrierung und Anwendung', () => {
    for (const d of ['src/app/(auth)/login/page.tsx', 'src/app/signup/SignupClient.tsx', 'src/components/layout/AppShell.tsx'])
      assert.match(quelle(d), /<RechtsLinks\b/, d)
    const l = quelle('src/components/RechtsLinks.tsx')
    for (const r of ['/agb', '/datenschutz', '/impressum', '/barrierefreiheit']) assert.match(l, new RegExp(`href: '${r}'`), r)
  })
  test('Datenschutzerklärung nennt Verantwortlichen, Rechte und Datenschutzbehörde; ohne App-Rahmen', () => {
    const d = quelle('src/app/datenschutz/page.tsx')
    assert.match(d, /Hohenstein Consulting OG/)
    assert.match(d, /Datenschutzbehörde/)
    assert.match(d, /Auftragsverarbeitung/)
    assert.doesNotMatch(quelle('src/components/RechtsSeite.tsx'), /<main[^>]*data-app-rahmen/)
  })
})

describe('KAN-300: Zustimmung bei der Registrierung', () => {
  test('nur ein gesetztes Häkchen zählt', () => {
    for (const w of ['1', 'on', 'true']) assert.equal(f.zustimmungGegeben(w), true, w)
    for (const w of [null, '', '0', 'false', 'nein']) assert.equal(f.zustimmungGegeben(w), false, String(w))
  })
  test('Regression: der Server lehnt ohne Zustimmung ab, bevor ein Betrieb entsteht', () => {
    const a = quelle('src/app/signup/actions.ts')
    const pruefung = a.indexOf("if (!zustimmungGegeben(formData.get('zustimmung')))")
    const anlage = a.indexOf(".from('tenants') as R)\n    .insert(")
    assert.ok(pruefung > 0, 'Prüfung fehlt')
    assert.ok(anlage > pruefung, 'Prüfung muss vor dem Anlegen des Betriebs stehen')
    assert.match(a.slice(pruefung, pruefung + 200), /Bitte AGB und Datenschutzerklärung bestätigen/)
  })
  test('Nachweis: Fassung, Zeitpunkt und Person beim neuen Betrieb, sonst Rückbau', () => {
    const a = quelle('src/app/signup/actions.ts')
    assert.match(a, /vertrag_fassung: VERTRAG_KENNUNG, vertrag_bestaetigt_am: new Date\(\)\.toISOString\(\), vertrag_bestaetigt_von: userId/)
    const i = a.indexOf('vertrag_fassung: VERTRAG_KENNUNG')
    assert.match(a.slice(i, i + 600), /await betriebLoeschen\(\)/)
  })
  test('das Formular schickt die Zustimmung mit', () => {
    assert.match(quelle('src/app/signup/SignupClient.tsx'), /fd\.set\('zustimmung', zustimmung \? '1' : ''\)/)
  })
})
