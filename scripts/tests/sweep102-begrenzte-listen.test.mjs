// Sweep 102 (10.10.2026): begrenzte Listen, die die falschen Zeilen behalten.
// Befund 1: CRM-Kalender lud .order('datum', { ascending: true }).limit(5000) – über der Grenze fehlten still die
//           NEUESTEN, also die kommenden Termine. Jetzt vollständig über alle().
// Befund 2: /benutzer lud die Auth-Konten mit listUsers({ perPage: 1000 }) – nur die erste Seite, Fehler verworfen
//           (data undefiniert → Absturz). Jetzt alleKonten() (blättert, wirft bei Fehler).
// Wächter: check-alle Regeln AELTESTE_BEHALTEN (aufsteigend nach Datum + .limit ohne Untergrenze) und LISTUSERS_OHNE_SEITE.
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
const { pruefeText, pruefeWurzel } = require(path.join(HIER, '..', 'check-alle.js'))
const regeln = t => pruefeText(t, 'x.ts').funde.map(f => f.regel)
const quelle = d => readFileSync(path.join(ROOT, d), 'utf8')

describe('Regel AELTESTE_BEHALTEN', () => {
  test('aufsteigend nach Datum + limit → Fund', () => {
    assert.deepEqual(regeln("const r = await supabase.from('aktivitaeten').select('id').order('datum', { ascending: true }).limit(5000)"), ['AELTESTE_BEHALTEN'])
    assert.deepEqual(regeln("const r = await supabase.from('verkaufsposten').select('id').order('erstellt_am').limit(200)"), ['AELTESTE_BEHALTEN'])
  })
  test('absteigend, Untergrenze („die nächsten N ab heute“), Nicht-Datum und alle() → kein Fund', () => {
    assert.deepEqual(regeln("const r = await supabase.from('aktivitaeten').select('id').order('datum', { ascending: false }).limit(50)"), [])
    assert.deepEqual(regeln("const r = await supabase.from('aktivitaeten').select('id').gte('datum', heute).order('datum', { ascending: true }).limit(4)"), [])
    assert.deepEqual(regeln("const r = await supabase.from('kontakte').select('id').order('nachname').limit(300)"), [])
    assert.deepEqual(regeln("const r = await alle(supabase.from('aktivitaeten').select('id').order('datum').order('id'))"), [])
  })
  test('begründete Ausnahme', () => {
    assert.deepEqual(regeln("// alle-ausnahme: die ältesten offenen Rechnungen zuerst – Anzeige\nconst r = await supabase.from('verkaufsposten').select('id').order('datum').limit(200)"), [])
  })
})

describe('Regel LISTUSERS_OHNE_SEITE', () => {
  test('Erkennung', () => {
    assert.deepEqual(regeln('const { data } = await admin.auth.admin.listUsers({ perPage: 1000 })'), ['LISTUSERS_OHNE_SEITE'])
    assert.deepEqual(regeln('const { data } = await admin.auth.admin.listUsers({ page: seite, perPage: 1000 })'), [])
  })
})

describe('Projekt', () => {
  test('keine Funde; CRM-Kalender über alle(), Benutzerverwaltung über alleKonten()', () => {
    assert.deepEqual(pruefeWurzel(ROOT).funde, [])
    assert.match(quelle('src/app/(dashboard)/crm/page.tsx'), /geladen\(await alle\(tf\(\(supabase\.from\('aktivitaeten'\)/)
    assert.doesNotMatch(quelle('src/app/(dashboard)/crm/page.tsx'), /\.limit\(5000\)\)/)
    assert.match(quelle('src/app/(dashboard)/benutzer/actions.ts'), /const users = await alleKonten\(admin\)/)
    assert.match(quelle('src/lib/auth/einladung.ts'), /export async function alleKonten/)
  })
})
