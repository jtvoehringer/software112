// E2E-Ausbau (10.10.2026): Produktionsschutz der Playwright-Tests (e2e/umgebung.ts) – läuft in verify mit.
// Schreibende Tests sind nur gegen Staging (sjpeghrlhsowmquacjhb) oder einen lokalen Supabase-Stack erlaubt.
// Befund beim Ausbau: der alte Domain-Vergleich (includes) hätte staging.software112.icp-consultants.at als Produktion
// eingestuft; ein unbekanntes Supabase-Projekt galt als „nicht Produktion“ und hätte schreiben dürfen.
//
// Aufruf:  npm run -s test:csv

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

/** zielPruefen() und fremdeDatensaetze() in einem eigenen Prozess (umgebung.ts liest die Variablen beim Import) */
function pruefe(base, supabase) {
  const env = { ...process.env, E2E_BASE_URL: base, E2E_SUPABASE_URL: supabase, NEXT_PUBLIC_SUPABASE_URL: '', E2E_FREMDE_IDS: '', E2E_NUR_LESEN: '' }
  const aus = execFileSync(process.execPath, ['--experimental-strip-types', '--disable-warning=ExperimentalWarning', '--disable-warning=MODULE_TYPELESS_PACKAGE_JSON', '-e',
    "import('./e2e/umgebung.ts').then(u => console.log(JSON.stringify({ p: u.zielPruefen().produktion, s: u.schreibenErlaubt(), f: u.fremdeDatensaetze().length })))"],
    { cwd: ROOT, env, encoding: 'utf8' })
  return JSON.parse(aus.trim().split('\n').pop())
}

const STAGING = 'https://staging.software112.icp-consultants.at'
const STAGING_DB = 'https://sjpeghrlhsowmquacjhb.supabase.co'

test('Staging mit Staging-Datenbank: schreiben erlaubt, Fremddatensätze hinterlegt', () => {
  const r = pruefe(STAGING, STAGING_DB)
  assert.deepEqual({ p: r.p, s: r.s }, { p: false, s: true })
  // seit E2E-Ausbau 3 (11.10.2026): 22 Detailseiten über 11 Datensätze des Fremdbetriebs
  assert.ok(r.f >= 22, `nur ${r.f} Fremddatensätze`)
})

test('jeder Fremddatensatz der Tests ist in e2e/fremdbetrieb.sql angelegt und gehört dem Fremdbetrieb', () => {
  const sql = readFileSync(path.join(ROOT, 'e2e', 'fremdbetrieb.sql'), 'utf8')
  const aus = execFileSync(process.execPath, ['--experimental-strip-types', '--disable-warning=ExperimentalWarning', '--disable-warning=MODULE_TYPELESS_PACKAGE_JSON', '-e',
    "import('./e2e/umgebung.ts').then(u => console.log(JSON.stringify({ t: u.FREMD_TENANT, ids: Object.values(u.FREMD_ID), pfade: u.STAGING_FREMDE.map(d => d.pfad) })))"],
    { cwd: ROOT, encoding: 'utf8' })
  const { t, ids, pfade } = JSON.parse(aus.trim().split('\n').pop())
  for (const id of ids) {
    const zeile = sql.split('\n').find(z => z.includes(`'${id}'`) && z.startsWith('VALUES'))
    assert.ok(zeile, `${id} fehlt in e2e/fremdbetrieb.sql`)
    assert.ok(zeile.includes(`'${t}'`), `${id} gehört in e2e/fremdbetrieb.sql nicht zum Fremdbetrieb`)
  }
  for (const p of pfade) assert.ok(ids.some(id => p.includes(id)), `${p} zeigt auf keinen Datensatz des Fremdbetriebs`)
  assert.equal(new Set(pfade).size, pfade.length, 'doppelter Pfad')
})

test('Produktion (Haupt- und Betriebs-Subdomain), Produktions-DB, unbekannte DB, Preview ohne DB: gesperrt', () => {
  for (const [base, db] of [
    ['https://software112.icp-consultants.at', 'https://zwcsgnemijkpyxrqykul.supabase.co'],
    ['https://spaetrot.software112.icp-consultants.at', STAGING_DB],
    [STAGING, 'https://zwcsgnemijkpyxrqykul.supabase.co'],
    [STAGING, 'https://abcdefghijklmnopqrst.supabase.co'],
    ['https://software112-abc123.vercel.app', ''],
  ]) {
    const r = pruefe(base, db)
    assert.equal(r.p, true, `${base} / ${db}`)
    assert.equal(r.s, false, `${base} / ${db}`)
  }
})

test('lokal mit lokalem Supabase-Stack: schreiben erlaubt', () => {
  assert.equal(pruefe('http://localhost:3000', 'http://127.0.0.1:54321').s, true)
})
