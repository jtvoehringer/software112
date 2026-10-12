// Agentic Delivery (12.10.2026): Guard-Hook (PreToolUse) und Stopp-Gate (Stop) – docs/AGENTIC_DELIVERY.md.
// Geprüft wird die Entscheidung (blocken/erlauben) an echten Befehlen aus den Sitzungen, ohne Hook-Laufzeit.
//
// Aufruf:  npm run -s test:csv

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const HIER = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(HIER, '..', '..')
const require = createRequire(import.meta.url)
const { pruefe, REGELN } = require(path.join(ROOT, 'scripts', 'hooks', 'guard.js'))
const { entscheide } = require(path.join(ROOT, 'scripts', 'hooks', 'done-gate.js'))

const bash = (command) => pruefe({ tool_name: 'Bash', tool_input: { command } }, { existiert: () => false, lies: () => '' })
const id = (r) => r?.id ?? null

describe('Guard: Befehle', () => {
  test('blockt Force-Push, reset --hard, clean -f, supabase db push/reset', () => {
    assert.equal(id(bash('git push --force origin main')), 'force_push')
    assert.equal(id(bash('git push -f')), 'force_push')
    assert.equal(id(bash('git reset --hard origin/main')), 'reset_hard')
    assert.equal(id(bash('git clean -fd')), 'git_clean')
    assert.equal(id(bash('npx supabase db push')), 'supabase_push')
    assert.equal(id(bash('npx supabase db reset --linked')), 'supabase_push')
  })

  test('erlaubt normale Git-Arbeit, force-with-lease und Pushes ohne Force', () => {
    for (const c of [
      'git push -q -u origin claude/kan324-massnahmen-sortierung',
      'git push --force-with-lease origin claude/x',
      'git checkout -q -b claude/agentic-delivery origin/main',
      'git commit -q -m "fix: …"',
      'git fetch -q && git status --short',
    ]) assert.equal(bash(c), null, c)
  })

  test('.env lesen ist blockiert, *.example und process.env in Suchmustern nicht', () => {
    assert.equal(id(bash('cat .env.local')), 'env_lesen')
    assert.equal(id(bash('type .env')), 'env_lesen')
    assert.equal(id(bash('cat "C:/x/.env.e2e"')), 'env_lesen')
    assert.equal(bash('cat .env.local.example'), null)
    assert.equal(bash('grep -rn "process.env.SUPABASE_URL" src'), null)
  })

  test('rm -rf nur in Temp-Ordnern, Scratchpad und Build-Ausgaben', () => {
    assert.equal(id(bash('rm -rf src')), 'rm_rf')
    assert.equal(id(bash('rm -rf .')), 'rm_rf')
    assert.equal(id(bash('rm -fr supabase/migrations')), 'rm_rf')
    assert.equal(bash('S="C:/Users/joerg/AppData/Local/Temp/claude/x/scratchpad"; rm -rf "$S/ek2" && mkdir "$S/ek2"'), null)
    assert.equal(bash('rm -rf .next node_modules/.cache'), null)
    assert.equal(bash('rm -rf e2e/.ergebnisse'), null)
  })

  test('Produktion per CLI nur als Probelauf (Datei mit ROLLBACK, ohne COMMIT)', () => {
    const umgebung = (sql) => ({ existiert: () => true, lies: () => sql })
    const befehl = 'npx supabase db query --linked --project-ref zwcsgnemijkpyxrqykul -f C:/tmp/probe.sql'
    const g = (sql) => pruefe({ tool_name: 'Bash', tool_input: { command: befehl } }, umgebung(sql))
    assert.equal(g('BEGIN;\nALTER TABLE x ADD COLUMN y int;\nSELECT 1;\nROLLBACK;\n'), null)
    assert.equal(id(g('BEGIN;\nALTER TABLE x ADD COLUMN y int;\nCOMMIT;\n')), 'produktion_cli')
    assert.equal(id(g('ALTER TABLE x ADD COLUMN y int;')), 'produktion_cli')
    assert.equal(id(bash('npx supabase db query --linked --project-ref zwcsgnemijkpyxrqykul "select 1"')), 'produktion_cli')
    // Staging ist frei (Tests, Entwürfe)
    assert.equal(bash('npx supabase db query --linked --project-ref sjpeghrlhsowmquacjhb -f C:/tmp/stg.sql'), null)
  })
})

describe('Guard: Dateien und Inhalte', () => {
  const datei = (tool_name, file_path, extra = {}, existiert = false) =>
    pruefe({ tool_name, tool_input: { file_path, ...extra } }, { existiert: () => existiert, lies: () => '' })

  test('.env-Dateien weder lesen noch schreiben, *.example schon', () => {
    assert.equal(id(datei('Read', 'C:/repo/.env.local')), 'env_datei')
    assert.equal(id(datei('Write', '/repo/.env', { content: 'X=1' })), 'env_datei')
    assert.equal(datei('Read', 'C:/repo/.env.e2e.example'), null)
    assert.equal(datei('Read', 'C:/repo/src/lib/env.ts'), null)
  })

  test('eingespielte Migration nicht ändern; neue Migrationsdatei anlegen geht', () => {
    const m = 'C:/repo/supabase/migrations/20261011112507_kan325_326_bienenschutz_psm_einkauf.sql'
    assert.equal(id(datei('Edit', m, { old_string: 'a', new_string: 'b' })), 'migration_aendern')
    assert.equal(id(datei('Write', m, { content: '--' }, true)), 'migration_aendern')
    assert.equal(datei('Write', 'C:/repo/supabase/migrations/20261012090000_neu.sql', { content: '--' }, false), null)
    assert.equal(id(datei('Edit', 'C:/repo/supabase/migrations_legacy/001_initial_schema.sql', { old_string: 'a', new_string: 'b' })), 'migration_legacy')
    assert.equal(datei('Edit', 'C:/repo/supabase/entwurf/x.sql', { old_string: 'a', new_string: 'b' }), null)
  })

  test('Schlüssel und Tokens nicht in Dateien schreiben', () => {
    const w = (content) => id(datei('Write', 'C:/repo/src/x.ts', { content }))
    assert.equal(w('const k = "sk-ant-api03-abcdefghijklmnopqrstuvwxyz"'), 'anthropic_key')
    assert.equal(w('key=eyJhbGciOiJIUzI1NiJ9.eyJpc3MiOiJzdXBhYmFzZSJ9.c2lnbmF0dXJlc2lnbmF0dXJl'), 'jwt')
    assert.equal(w('STRIPE=sk_live_1234567890abcdef'), 'stripe_live')
    assert.equal(w('-----BEGIN RSA PRIVATE KEY-----'), 'private_key')
    assert.equal(id(datei('Edit', 'C:/repo/src/x.ts', { old_string: 'a', new_string: 'ghp_' + 'a'.repeat(36) })), 'github_token')
    assert.equal(w('const hinweis = "Schlüssel in Vercel hinterlegen"'), null)
  })

  test('andere Werkzeuge bleiben unberührt; Regeln versioniert', () => {
    assert.equal(pruefe({ tool_name: 'Grep', tool_input: { pattern: '.env' } }), null)
    assert.match(REGELN.version, /^\d{4}-\d{2}-\d{2}\.\d+$/)
  })
})

describe('Stopp-Gate', () => {
  const umgebung = ({ stand = 'abc', stempel = null, aus = false } = {}) => ({
    stand: () => stand,
    existiert: (p) => (p.endsWith('done-gate-aus') ? aus : stempel !== null),
    lies: () => (stempel ?? '') + '\n',
  })

  test('ohne Änderungen darf der Agent stoppen', () => {
    assert.equal(entscheide({}, umgebung({ stand: '' })), null)
  })

  test('Änderungen ohne bzw. mit veraltetem Stempel: blockt mit Hinweis auf npm run verify', () => {
    assert.match(entscheide({}, umgebung({ stand: 'neu', stempel: null })), /npm run verify/)
    assert.match(entscheide({}, umgebung({ stand: 'neu', stempel: 'alt' })), /npm run verify/)
  })

  test('Stempel passt: darf stoppen; zweiter Stopp im Zug und bewusster Schalter: darf stoppen', () => {
    assert.equal(entscheide({}, umgebung({ stand: 'x1', stempel: 'x1' })), null)
    assert.equal(entscheide({ stop_hook_active: true }, umgebung({ stand: 'neu' })), null)
    assert.equal(entscheide({}, umgebung({ stand: 'neu', aus: true })), null)
  })

  test('verdrahtet: Hooks in .claude/settings.json, Stempel als letzter Schritt von verify', () => {
    const s = JSON.parse(readFileSync(path.join(ROOT, '.claude', 'settings.json'), 'utf8'))
    assert.match(JSON.stringify(s.hooks.PreToolUse), /scripts\/hooks\/guard\.js/)
    assert.match(s.hooks.PreToolUse[0].matcher, /Bash/)
    assert.match(JSON.stringify(s.hooks.Stop), /scripts\/hooks\/done-gate\.js/)
    const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
    assert.match(pkg.scripts.verify, /&& node scripts\/hooks\/verify-stempel\.js$/)
  })
})
