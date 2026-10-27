// Tests KAN-358 (27.10.2026) – „Teilabstufung der Charge nicht möglich“ (UAT)
//
// Befund: Beim Abstufen war die Option „Teilmenge“ ausgegraut, obwohl leere Gebinde da waren. Abstufen zählte jede Charge
// mit aktiv = true als Belegung – auch eine abgeschlossene –, Umziehen nicht, die Ziel-Gebinde-Auswahl des Zukaufs nur
// „aktiv“. Jetzt gilt EINE Regel (src/lib/kellerbuch/leereGebinde.ts), übernommen vom Umzug: Eine Charge belegt ihr
// Gebinde, solange sie aktiv, nicht storniert und nicht abgeschlossen ist.
//
// Aufruf:  npm run -s test:csv
//
// 1. Regel (belegtGebinde, belegteGebinde, gebindeLeer, leereGebinde).
// 2. Abfrage-Baustein nurBelegendeChargen liefert gegen eine PostgREST-Attrappe dieselben Zeilen wie belegtGebinde.
// 3. Verdrahtung (Quelltext): Abstufen (Seite + Action), Umzug (Seite, umziehen(), Umzug bearbeiten) und Zukauf
//    (Action + Ziel-Gebinde-Auswahl) nutzen die gemeinsame Regel; keine eigene Belegungs-Abfrage mehr. Ohne den Fix rot
//    (Abstufen fragte `.eq('aktiv', true).is('storniert_am', null)` ohne Status ab).
// 4. Hinweis „Gebinde anlegen“ neben der ausgegrauten Teilmenge.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import {
  BELEGUNG_SPALTEN, GEBINDE_ANLEGEN_PFAD, belegendeChargen, belegtGebinde, belegteGebinde, gebindeLeer, leereGebinde, nurBelegendeChargen,
} from '../../src/lib/kellerbuch/leereGebinde.ts'

const quelle = p => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')

const c = (behaelter_id, mehr = {}) => ({ behaelter_id, aktiv: true, status: 'ausbau', storniert_am: null, menge_liter: 500, ...mehr })

// ── 1. Regel ─────────────────────────────────────────────────────────────────

describe('KAN-358: Belegung eines Gebindes', () => {
  test('aktive Charge mit Menge belegt ihr Gebinde – in jedem offenen Status', () => {
    for (const status of ['ernte', 'gaerung', 'ausbau', 'abfuellung']) assert.equal(belegtGebinde(c('G1', { status })), true, status)
  })
  test('abgeschlossene Charge belegt kein Gebinde – auch wenn sie noch aktiv ist (Befund UAT)', () => {
    assert.equal(belegtGebinde(c('G1', { status: 'abgeschlossen' })), false)
    assert.equal(belegtGebinde(c('G1', { status: 'abgeschlossen', aktiv: true, menge_liter: 0 })), false)
  })
  test('inaktive bzw. stornierte Charge belegt kein Gebinde', () => {
    assert.equal(belegtGebinde(c('G1', { aktiv: false })), false)
    assert.equal(belegtGebinde(c('G1', { storniert_am: '2026-10-20T10:00:00Z' })), false)
    assert.equal(belegtGebinde(c('G1', { storniert_am: '2026-10-20T10:00:00Z', aktiv: false, status: 'abgeschlossen' })), false)
  })
  test('Charge ohne Gebinde belegt nichts; leere Eingaben', () => {
    assert.equal(belegtGebinde(c(null)), false)
    assert.equal(belegtGebinde(null), false)
    assert.equal(belegtGebinde(undefined), false)
  })
  test('aktive, offene Charge mit 0 L belegt ihr Gebinde (der Umzug würde in sie zusammenführen)', () => {
    assert.equal(belegtGebinde(c('G1', { menge_liter: 0 })), true)
  })
  test('belegteGebinde, belegendeChargen, gebindeLeer', () => {
    const chargen = [c('G1'), c('G2', { status: 'abgeschlossen' }), c('G3', { aktiv: false }), c('G4', { storniert_am: '2026-10-01' }), null, c('G1')]
    assert.deepEqual([...belegteGebinde(chargen)], ['G1'])
    assert.equal(belegendeChargen(chargen).length, 2)
    assert.equal(gebindeLeer('G1', chargen), false)
    for (const g of ['G2', 'G3', 'G4', 'G9']) assert.equal(gebindeLeer(g, chargen), true, g)
  })
  test('leereGebinde: ohne belegte, ohne gesperrte (Kellergemeinschaft), ohne das eigene Gebinde', () => {
    const gebinde = [{ id: 'G1' }, { id: 'G2' }, { id: 'G3', gesperrt: true }, { id: 'G4' }, { id: 'G5' }]
    const chargen = [c('G1'), c('G2', { status: 'abgeschlossen' }), c('G5')]
    assert.deepEqual(leereGebinde(gebinde, chargen).map(g => g.id), ['G2', 'G4'])
    assert.deepEqual(leereGebinde(gebinde, chargen, { ausser: 'G4' }).map(g => g.id), ['G2'])
    assert.deepEqual(leereGebinde(gebinde, []).map(g => g.id), ['G1', 'G2', 'G4', 'G5'])
  })
  test('Regressionsfall UAT: einziges „belegtes“ Gebinde hat nur eine abgeschlossene Charge → Teilmenge möglich', () => {
    const gebinde = [{ id: 'QUELLE' }, { id: 'ALT' }]
    const chargen = [c('QUELLE'), c('ALT', { status: 'abgeschlossen', aktiv: true, menge_liter: 0 })]
    assert.deepEqual(leereGebinde(gebinde, chargen, { ausser: 'QUELLE' }).map(g => g.id), ['ALT'])
  })
  test('Spalten für die Abfrage und Pfad zum Anlegen', () => {
    for (const s of ['behaelter_id', 'aktiv', 'status', 'storniert_am']) assert.ok(BELEGUNG_SPALTEN.includes(s), s)
    assert.equal(GEBINDE_ANLEGEN_PFAD, '/kellerbuch/behaelter/neu')
  })
})

// ── 2. Abfrage-Baustein = Regel ─────────────────────────────────────────────

function attrappe(zeilen) {
  const filter = []
  const q = {
    eq(k, v) { filter.push(r => r[k] === v); return q },
    neq(k, v) { filter.push(r => r[k] != null && r[k] !== v); return q },   // PostgREST: NULL fällt bei neq heraus
    is(k, v) { filter.push(r => (r[k] ?? null) === v); return q },
    zeilen: () => zeilen.filter(r => filter.every(f => f(r))),
  }
  return q
}

describe('KAN-358: nurBelegendeChargen (Datenbank) = belegtGebinde (geladene Zeilen)', () => {
  test('gleiche Zeilen für jede Kombination aus aktiv, Status und Storno', () => {
    const zeilen = []
    for (const aktiv of [true, false]) for (const status of ['ernte', 'gaerung', 'ausbau', 'abfuellung', 'abgeschlossen'])
      for (const storniert_am of [null, '2026-10-01T08:00:00Z']) zeilen.push(c(`G-${zeilen.length}`, { aktiv, status, storniert_am }))
    const ausDb = nurBelegendeChargen(attrappe(zeilen)).zeilen()
    assert.deepEqual(ausDb, belegendeChargen(zeilen))
    assert.equal(ausDb.length, 4)   // nur aktiv, offen, nicht storniert
  })
})

// ── 3. Verdrahtung ───────────────────────────────────────────────────────────

const IMPORT = /from '@\/lib\/kellerbuch\/leereGebinde'/
const ALTE_BELEGUNG = /\.eq\('aktiv', true\)\s*\.(?:is\('storniert_am', null\)|neq\('status', 'abgeschlossen'\))/

describe('KAN-358: alle Stellen nutzen die gemeinsame Regel', () => {
  test('Abstufen-Seite: belegte Gebinde über nurBelegendeChargen, Auswahl über leereGebinde', () => {
    const s = quelle('src/app/(dashboard)/kellerbuch/weinausbau/[id]/abstufen/page.tsx')
    assert.match(s, IMPORT)
    assert.match(s, /alle\(nurBelegendeChargen\(tf\(\(supabase\.from\('weinausbau'\) as any\)\.select\(BELEGUNG_SPALTEN\)\)\)/)
    assert.match(s, /leereGebindeAus\(behaelter, \(belegtRaw \?\? \[\]\) as R\[\], \{ ausser: wa\.behaelter_id/)
    assert.doesNotMatch(s, ALTE_BELEGUNG)
  })
  test('chargeAbstufen: „nicht leer“ und neue Charge nach dem Umzug mit derselben Regel', () => {
    const a = quelle('src/app/(dashboard)/kellerbuch/actions.ts')
    assert.match(a, IMPORT)
    const f = a.slice(a.indexOf('export async function chargeAbstufen'), a.indexOf('// ANALYSEN'))
    assert.match(f, /const \{ count, error: belegtErr \} = await nurBelegendeChargen\(/)
    assert.match(f, /const \{ data: neuRaw, error: neuErr \} = await nurBelegendeChargen\(/)
    assert.doesNotMatch(f, /\.eq\('aktiv', true\)/)
  })
  test('Umzug: Seite, umziehen() und Umzug bearbeiten', () => {
    for (const p of ['src/app/(dashboard)/kellerbuch/umziehen/page.tsx', 'src/app/(dashboard)/kellerbuch/umziehen/actions.ts', 'src/app/(dashboard)/kellerbuch/gebinde-actions.ts']) {
      const s = quelle(p)
      assert.match(s, IMPORT, p)
      assert.match(s, /nurBelegendeChargen\(/, p)
      assert.doesNotMatch(s, ALTE_BELEGUNG, p)
    }
    assert.equal((quelle('src/app/(dashboard)/kellerbuch/umziehen/actions.ts').match(/nurBelegendeChargen\(\(supabase\.from\('weinausbau'\)/g) ?? []).length, 3)
  })
  test('Zukauf: Buchung und Ziel-Gebinde-Auswahl (/api/zukauf-stammdaten)', () => {
    for (const p of ['src/app/(dashboard)/weinhandel/zukauf/actions.ts', 'src/app/api/zukauf-stammdaten/route.ts']) {
      const s = quelle(p)
      assert.match(s, IMPORT, p)
      assert.match(s, /nurBelegendeChargen\(\(supabase\.from\('weinausbau'\)/, p)
    }
    assert.doesNotMatch(quelle('src/app/api/zukauf-stammdaten/route.ts'), /\.eq\('aktiv', true\)/)
  })
})

describe('KAN-358: alle()-Wächter kennt nurBelegendeChargen als Filter-Hülle', () => {
  const require = createRequire(import.meta.url)
  const w = require('../check-alle.js')
  const funde = t => w.pruefeText(`async function f() {\n${t}\n}`, 'src/x.ts').funde.map(f => f.regel)
  test('alle(nurBelegendeChargen(tf(q))) ist gepaged, ohne alle() bleibt es ein Fund', () => {
    assert.deepEqual(funde(`await alle(nurBelegendeChargen(tf((supabase.from('weinausbau') as any).select('behaelter_id'))).order('id'))`), [])
    assert.deepEqual(funde(`await nurBelegendeChargen(tf((supabase.from('weinausbau') as any).select('behaelter_id'))).order('id')`), ['VOLLABFRAGE'])
  })
})

// ── 4. Hinweis „Gebinde anlegen“ ────────────────────────────────────────────

describe('KAN-358: Gebinde anlegen, wenn keines leer ist', () => {
  test('Seite reicht den Link mit Rückweg zum Abstufen weiter, Formular zeigt ihn neben der ausgegrauten Teilmenge', () => {
    const s = quelle('src/app/(dashboard)/kellerbuch/weinausbau/[id]/abstufen/page.tsx')
    assert.match(s, /gebindeAnlegenHref=\{mitZurueck\(GEBINDE_ANLEGEN_PFAD, `\/kellerbuch\/weinausbau\/\$\{wa\.id\}\/abstufen`\)\}/)
    const f = quelle('src/app/(dashboard)/kellerbuch/weinausbau/[id]/abstufen/AbstufenForm.tsx')
    assert.match(f, /\{leereGebinde\.length === 0 && \(\n\s*<p[^>]*>\n\s*Kein leeres Gebinde frei[^\n]*\n\s*<Link href=\{gebindeAnlegenHref\}[^>]*>Gebinde anlegen<\/Link>/)
  })
})
