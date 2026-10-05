// KAN-207 (05.10.2026): Umzug und Verschnitt sofort fest – Korrektur per Storno (Matrix KAN-85). DB-Test 38.
//
// Aufruf:  npm run -s test:csv

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const WURZEL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const quelle = rel => readFileSync(path.join(WURZEL, rel), 'utf8').replace(/\r\n/g, '\n')

test('umziehen(): Datum Pflicht, kein stilles „heute“', () => {
  const a = quelle('src/app/(dashboard)/kellerbuch/umziehen/actions.ts')
  assert.match(a, /if \(!datum\) throw new AktionsFehler\('Bitte das Datum des Umzugs angeben\.'\)/)
  assert.doesNotMatch(a, /\(fd\.get\('datum'\)\s+as string\) \|\| new Date\(\)/)
})

test('updateUmzug(): Datum nicht mehr änderbar, nur Notizen; Formular zeigt das Datum fest', () => {
  const a = quelle('src/app/(dashboard)/kellerbuch/umziehen/actions.ts')
  const r = a.slice(a.indexOf('export async function updateUmzug('), a.indexOf('export async function updateUmzug(') + 2500)
  assert.match(r, /Das Datum eines gespeicherten Umzugs lässt sich nicht mehr ändern/)
  assert.doesNotMatch(r, /\.update\(\{ datum:/)
  const c = quelle('src/app/(dashboard)/kellerbuch/umziehen/UmziehenClient.tsx')
  assert.doesNotMatch(c, /<input type="date" value=\{datum\} onChange=\{e => setDatum/)
})

test('Migration: Umzug, Verschnitt und Quellen fest; Quellen mit Wartung über den Verschnitt, nur anteil_pct frei', () => {
  const f = readdirSync(path.join(WURZEL, 'supabase/migrations')).find(n => n.endsWith('_kan207_umzug_verschnitt_freeze.sql'))
  const m = quelle(f ? path.join('supabase/migrations', f) : 'supabase/entwurf/kan207_umzug_verschnitt_freeze.sql')
  for (const tab of ['keller_umzuege', 'verschneidungen']) {
    assert.match(m, new RegExp(`ON public\\.${tab}\\s+FOR EACH ROW EXECUTE FUNCTION public\\.s112_freeze\\('[^']+',\\s+\\$\\$o\\.storniert_am IS NULL\\$\\$,\\s+'notizen,storniert_am,storniert_von,storniert_von_name,storno_grund'`), tab)
  }
  assert.match(m, /ON public\.verschneidung_quellen[\s\S]*?s112_wartung_frei\(v\.tenant_id\)[\s\S]*?'anteil_pct'/)
})
