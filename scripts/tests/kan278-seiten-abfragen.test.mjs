// Sweep 86 (KAN-278, 10.10.2026): Abfragen auf Seiten werten ihren Fehler aus.
// 1. geladen(res, was) wirft bei einem Datenbankfehler (Fehlergrenze statt stiller Lücke).
// 2. check-einzelabfrage prüft Server-Dateien unter src/app mit Ausgangswerten je Datei (neu/mehr → rot, weniger → rot
//    bis festgeschrieben; 'use client' und Dateien außerhalb von src/app bleiben außen vor).
// 3. Regression: öffentliches E-Label (Zutaten/Allergene), Erntemeldung und Abo-Seite sind ohne Altfall und haben eine
//    Fehlergrenze.
//
// Aufruf:  npm run -s test:csv

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { hooksRegistrieren, laden, nurMitHooks, hooksMoeglich } from './buchung-attrappe.mjs'

const HIER = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(HIER, '..', '..')
const require = createRequire(import.meta.url)
const { pruefeWurzel, schreibeBaseline } = require(path.join(HIER, '..', 'check-einzelabfrage.js'))
hooksRegistrieren()
const g = hooksMoeglich ? await laden('lib/supabase/geladen.ts') : null
const quelle = p => readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n')

describe('geladen()', nurMitHooks, () => {
  test('liefert data, wirft bei error mit Klartext', () => {
    assert.deepEqual(g.geladen({ data: [1, 2], error: null }, 'Lesedaten'), [1, 2])
    assert.equal(g.geladen({ data: null, error: null }, 'E-Label'), null)
    assert.throws(() => g.geladen({ data: null, error: { message: 'Zeitüberschreitung' } }, 'Zutatenkatalog'),
      /Zutatenkatalog konnte nicht geladen werden \(Zeitüberschreitung\)/)
  })
})

describe('check-einzelabfrage: Seiten mit Ausgangswert', () => {
  const abfrage = `export default async function Seite({ s }) {\n  const { data } = await s.from('t').select('id').eq('a', 1)\n  return data\n}\n`
  const mitWurzel = (fn) => {
    const w = mkdtempSync(path.join(tmpdir(), 's112-kan278-'))
    try {
      mkdirSync(path.join(w, 'src', 'app', 'x'), { recursive: true })
      mkdirSync(path.join(w, 'src', 'components'), { recursive: true })
      mkdirSync(path.join(w, 'scripts'), { recursive: true })
      fn(w)
    } finally { rmSync(w, { recursive: true, force: true }) }
  }
  const schreib = (w, p, t) => writeFileSync(path.join(w, p), t)

  test('neuer Fund in einer Seite → rot; Client-Komponente und src/components nicht geprüft', () => mitWurzel(w => {
    schreib(w, 'src/app/x/page.tsx', abfrage)
    schreib(w, 'src/app/x/Client.tsx', `'use client'\n${abfrage}`)
    schreib(w, 'src/components/Anzeige.tsx', abfrage)
    const e = pruefeWurzel(w)
    assert.deepEqual(e.funde.map(f => f.split('  ')[0]), ['src/app/x/page.tsx:2'])
    assert.match(e.funde[0], /Ausgangswert 0/)
  }))

  test('Ausgangswert: gleich → grün, mehr → rot, weniger → rot bis festgeschrieben', () => mitWurzel(w => {
    schreib(w, 'src/app/x/page.tsx', abfrage)
    assert.deepEqual(schreibeBaseline(w), { 'src/app/x/page.tsx': 1 })
    assert.deepEqual(pruefeWurzel(w).funde, [])
    assert.equal(pruefeWurzel(w).altfaelle, 1)
    schreib(w, 'src/app/x/page.tsx', abfrage + abfrage.replace('Seite', 'Zwei').replace('export default', 'export'))
    assert.equal(pruefeWurzel(w).funde.length, 2)
    schreib(w, 'src/app/x/page.tsx', `import { geladen } from '@/lib/supabase/geladen'\nexport default async function Seite({ s }) {\n  return geladen(await s.from('t').select('id'), 'T')\n}\n`)
    assert.match(pruefeWurzel(w).funde[0], /Ausgangswert 1, jetzt 0 – Abbau festschreiben/)
    assert.deepEqual(schreibeBaseline(w), {})
    assert.deepEqual(pruefeWurzel(w).funde, [])
  }))

  test('mit Fehler auswerten bzw. begründet: kein Fund', () => mitWurzel(w => {
    schreib(w, 'src/app/x/page.tsx', `export default async function S({ s }) {\n  const { data, error } = await s.from('t').select('id')\n  if (error) throw error\n  // abfrage-ohne-fehler: bewusst fehlertolerant, Zusatzanzeige ohne Folgen\n  const { data: b } = await s.from('u').select('id')\n  return [data, b]\n}\n`)
    assert.deepEqual(pruefeWurzel(w).funde, [])
  }))

  test('Projekt: Ausgangswerte stimmen, Datei ist eingecheckt', () => {
    assert.ok(existsSync(path.join(ROOT, 'scripts', 'einzelabfrage-baseline.json')))
    const e = pruefeWurzel(ROOT)
    assert.deepEqual(e.funde, [])
    // Sweep 89 (KAN-281): alle Altfälle abgebaut – jede Seite wertet ihre Abfragen aus
    assert.equal(e.altfaelle, 0, `${e.altfaelle} Altfälle`)
    assert.deepEqual(e.seiten, {})
  })
})

describe('Regression: kritische Seiten ohne Altfall, mit Fehlergrenze', () => {
  const baseline = JSON.parse(quelle('scripts/einzelabfrage-baseline.json'))
  const SEITEN = ['src/app/e/[code]/page.tsx', 'src/app/(dashboard)/erntemeldung/page.tsx', 'src/app/(dashboard)/erntemeldung/[id]/leseKontext.ts', 'src/app/abo/page.tsx']

  test('kein Ausgangswert für E-Label, Erntemeldung, Lese-Kontext und Abo', () => {
    for (const s of SEITEN) assert.equal(baseline[s], undefined, s)
  })

  test('E-Label: Katalog, Füllung, Betrieb und Archiv über geladen(); Fehlerseite DE/EN', () => {
    const p = quelle('src/app/e/[code]/page.tsx')
    for (const was of ['E-Label', 'Umleitungsziel', 'Füllung', 'Betrieb', 'Zutatenkatalog', 'E-Label-Archiv']) assert.match(p, new RegExp(`geladen\\([\\s\\S]{0,260}'${was}'\\)`), was)
    const f = quelle('src/app/e/[code]/error.tsx')
    assert.match(f, /^'use client'/)
    assert.match(f, /lang="de"[\s\S]*lang="en"/)
    assert.doesNotMatch(f, /fetch\(/, 'öffentliche Seite: kein Aufruf an das Systemprotokoll')
  })

  test('Erntemeldung: Jahrgang per maybeSingle (nicht gefunden ≠ Fehler), Abo mit eigener Fehlergrenze', () => {
    const l = quelle('src/app/(dashboard)/erntemeldung/[id]/leseKontext.ts')
    assert.match(l, /from\('weinjahrgaenge'\) as any\)\.select\('\*'\)\.eq\('id', id\)\.maybeSingle\(\)/)
    assert.match(l, /const jg = geladen\(jgRes, 'Jahrgang'\) as AR \| null\n  if \(!jg\) notFound\(\)/)
    assert.match(quelle('src/app/abo/error.tsx'), /Abo konnte nicht geladen werden/)
  })
})
