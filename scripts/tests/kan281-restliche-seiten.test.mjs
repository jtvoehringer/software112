// Sweep 89 (KAN-281, 10.10.2026): Abschluss des Abbaus aus KAN-278 – alle Seiten werten ihre Abfragen aus.
// Öffentlicher Weinpass und Betriebsauswahl haben eine eigene Fehlergrenze; die verbleibenden Ausnahmen sind begründet.
//
// Aufruf:  npm run -s test:csv

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const HIER = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(HIER, '..', '..')
const require = createRequire(import.meta.url)
const { pruefeWurzel, pruefeText } = require(path.join(HIER, '..', 'check-einzelabfrage.js'))
const quelle = p => readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n')

describe('KAN-281: keine Altfälle mehr', () => {
  test('Ausgangswerte leer, keine Seite mit Fund', () => {
    assert.deepEqual(JSON.parse(quelle('scripts/einzelabfrage-baseline.json')), {})
    const e = pruefeWurzel(ROOT)
    assert.deepEqual(e.funde, [])
    assert.deepEqual(e.seiten, {})
  })

  test('Weinpass: Lesefehler → Fehlerseite DE/EN statt „nicht gefunden“', () => {
    const p = quelle('src/app/w/[charge]/page.tsx')
    assert.match(p, /geladen\(await \(supabase\.from\('fuellungen'\) as R\)/)
    const f = quelle('src/app/w/[charge]/error.tsx')
    assert.match(f, /^'use client'/)
    assert.match(f, /lang="de"[\s\S]*lang="en"/)
    assert.doesNotMatch(f, /fetch\(/, 'öffentliche Seite: kein Aufruf an das Systemprotokoll')
  })

  test('Betriebsauswahl: Lesefehler ist nicht „Kein aktiver Betrieb“', () => {
    const p = quelle('src/app/(auth)/betrieb-waehlen/page.tsx')
    assert.match(p, /const memberships = geladen\(await alle\(/)
    assert.match(quelle('src/app/(auth)/betrieb-waehlen/error.tsx'), /Betriebe konnten nicht geladen werden/)
  })

  test('Wächter: geladen(…) mitten in der Abfragekette ist ein Fund (auch über eine Kommentarzeile), danach Array-Methoden nicht', () => {
    const kette = `export async function f(s) {\n  const a = geladen(await (s.from('t') as any), 'T')\n    // Kommentar\n    .select('id').eq('x', 1)\n  return a\n}\n`
    assert.deepEqual(pruefeText(kette, { route: true }).funde.map(x => [x.zeile, /\.select\(…\) hängt am Ergebnis/.test(x.text)]), [[2, true]])
    const richtig = `export async function f(s) {\n  const a = geladen(await (s.from('t') as any)\n    // Kommentar\n    .select('id').eq('x', 1), 'T')\n  return geladen(await s.from('u').select('id'), 'U').map(x => x.id)\n}\n`
    assert.deepEqual(pruefeText(richtig, { route: true }).funde, [])
  })

  test('verbleibende Ausnahmen sind begründet: Seitentitel, Layout, Karten-Design, Weiterleitung der Willkommensseite', () => {
    for (const f of ['crm/firmen/[id]/page.tsx', 'crm/kontakte/[id]/page.tsx', 'kellerbuch/kellerplan/[id]/page.tsx']) {
      assert.match(quelle(`src/app/(dashboard)/${f}`), /abfrage-ohne-fehler: nur Seitentitel \(generateMetadata\)/, f)
    }
    assert.match(quelle('src/app/(dashboard)/layout.tsx'), /abfrage-ohne-fehler: Layout – ein Wurf hier sperrte die ganze App/)
    assert.match(quelle('src/app/signup/willkommen/page.tsx'), /abfrage-ohne-fehler: nur der Abo-Status für die Weiterleitung der Willkommensseite/)
  })
})
