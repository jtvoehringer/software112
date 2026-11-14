// KAN-456 PR 4 (14.11.2026): E2E-Rundgang mit den Profilen „Extern“ und „Vertrieb“.
// Die Staging-Seite liegt hinter der Vercel-Anmeldung – die Durchsicht aller Seiten je Profil läuft deshalb als
// Playwright-Test in der CI (e2e/profile.spec.ts). Dieser Test sichert die Verdrahtung: eigene Projekte je Profil,
// die übrigen Tests laufen nicht mit Profil, Zugangsdaten nur aus Secrets, Pfade aus der Navigation.
//
// Aufruf:  npm run -s test:csv
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PROFILE } from '../../src/lib/auth/lesebereiche.ts'

const WURZEL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const quelle = p => readFileSync(path.join(WURZEL, p), 'utf8').replace(/\r\n/g, '\n')
const LISTE = JSON.parse(quelle('scripts/lesebereiche.json'))

describe('KAN-456: Playwright-Projekte je Profil', () => {
  const u = quelle('e2e/umgebung.ts')
  const c = quelle('playwright.config.ts')
  test('die Profil-Rollen sind genau die Profile der App und stehen nicht in ROLLEN', () => {
    const profile = /export const PROFIL_ROLLEN = \[([^\]]*)\] as const/.exec(u)[1].split(',').map(s => s.trim().replace(/'/g, ''))
    assert.deepEqual(profile.sort(), Object.keys(PROFILE).sort())
    assert.match(u, /export const ROLLEN = \['tenant_admin', 'winzer', 'leser'\] as const/)
  })
  test('Profil-Projekte führen nur profile.spec.ts aus; die Rollen-Projekte lassen die Datei aus', () => {
    assert.match(c, /\.\.\.PROFIL_ROLLEN\.map\(rolle => \(\{\n\s+name: rolle,\n\s+testMatch: \/profile\\\.spec\\\.ts\$\/,/)
    assert.match(c, /testMatch: \/\.\*\\\.spec\\\.ts\$\/,\n\s+testIgnore: \/profile\\\.spec\\\.ts\$\/,/)
  })
  test('Anmeldung für alle Rollen und Profile; ohne Zugangsdaten wird übersprungen', () => {
    const a = quelle('e2e/auth.setup.ts')
    assert.match(a, /for \(const rolle of \[\.\.\.ROLLEN, \.\.\.PROFIL_ROLLEN\]\) \{/)
    assert.match(a, /setup\.skip\(!zugang\(rolle\)/)
  })
  test('Zugangsdaten nur aus Secrets – keine Adresse und kein Passwort im Repository', () => {
    const w = quelle('.github/workflows/e2e.yml')
    for (const p of ['EXTERN', 'VERTRIEB']) for (const f of ['EMAIL', 'PASSWORT']) assert.ok(w.includes(`E2E_${p}_${f}: \${{ secrets.E2E_${p}_${f} }}`), `${p}_${f}`)
    for (const d of ['e2e/profile.spec.ts', 'e2e/umgebung.ts', 'e2e/auth.setup.ts', '.github/workflows/e2e.yml']) {
      assert.doesNotMatch(quelle(d), /@software112\.test/, d)
    }
  })
})

describe('KAN-456: Rundgang je Profil', () => {
  const s = quelle('e2e/profile.spec.ts')
  test('Pfade aus der Navigation und den Seitenregeln, nicht abgeschrieben', () => {
    assert.match(s, /for \(const pfad of navPfade\(profil\)\) \{/)
    assert.match(s, /navPfade\('tenant_admin'\)\.filter\(p => !lesbar\(profil, p\)\)/)
    assert.match(quelle('e2e/navigation.ts'), /\.\.\.\(profil \? \{ lesbar: profil\.lesen \} : \{\}\),/)
  })
  test('erlaubte Seite: kein Fehlerbild, keine Umleitung „kein Leserecht“, keine Lesefehler-Meldung, keine Konsolenfehler', () => {
    assert.match(s, /not\.toContain\('kein_leserecht'\)/)
    assert.match(s, /not\.toContainText\(\/Für diesen Bereich fehlt das Leserecht\/\)/)
    assert.match(s, /expect\(konsolenFehler\.liste, 'Konsolenfehler'\)\.toEqual\(\[\]\)/)
  })
  test('gesperrte Seite landet auf der Übersicht', () => {
    assert.match(s, /expect\(ziel\.pathname, `\$\{pfad\} ist für \$\{profil\} erreichbar`\)\.toBe\('\/dashboard'\)/)
  })
  test('Gegenprobe: jede genannte Tabelle liegt wirklich in einem gesperrten bzw. offenen Bereich des Profils', () => {
    const block = profil => new RegExp(`${profil}: \\{\\n\\s+gesperrt: \\[([^\\]]*)\\],\\n\\s+offen: '([a-z_]+)',\\n\\s+anlegen: \\{ tabelle: '([a-z_]+)'`).exec(s)
    for (const profil of Object.keys(PROFILE)) {
      const m = block(profil)
      assert.ok(m, profil)
      const lesen = PROFILE[profil].lesen
      const gesperrt = m[1].split(',').map(x => x.trim().replace(/'/g, ''))
      assert.ok(gesperrt.length >= 5, profil)
      for (const t of gesperrt) assert.ok(LISTE.tabellen[t] && !lesen.includes(LISTE.tabellen[t]), `${profil}: ${t} ist nicht gesperrt`)
      assert.ok(lesen.includes(LISTE.tabellen[m[2]]), `${profil}: ${m[2]} ist nicht lesbar`)
      assert.ok(!lesen.includes(LISTE.tabellen[m[3]]), `${profil}: ${m[3]} ist nicht gesperrt`)
    }
  })
  test('Gegenkontrolle vor der Gegenprobe; der Schreibversuch läuft nur, wenn Schreiben erlaubt ist', () => {
    assert.ok(s.indexOf('Gegenprobe wäre wertlos') < s.indexOf('liefert ${profil} Zeilen'))
    assert.match(s, /schreibend\(\)\n\s+const api = datenschnittstelle\(\)/)
    assert.match(s, /expect\(antwort\.status\(\), `\$\{g\.tabelle\}: \$\{text\}`\)\.toBe\(403\)/)
  })
})
