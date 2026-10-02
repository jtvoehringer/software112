// Pilottest 30.09.2026: Pressungen als eigener Kellerbuch-Tab nach der Übersicht, Zukauf daneben (aus der
// Warenwirtschaft); Lese mit Lesedaten und AMA-Erntemeldung bleibt unter Rieden, Verkauf/Warenlager unverändert.
//
// Aufruf:  node --test scripts/tests/pilot-navigation.test.mjs

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const quelle = f => readFileSync(new URL(`../../${f}`, import.meta.url), 'utf8')

/** Seiten je Bereich in Reihenfolge aus src/lib/navigation/index.ts (Quelltext, ohne Icons zu laden) */
function bereiche() {
  const nav = quelle('src/lib/navigation/index.ts')
  const erg = {}
  for (const m of nav.matchAll(/key: '([a-z]+)', label: '[^']+'[\s\S]*?items: \[([\s\S]*?)\n    \],/g)) {
    erg[m[1]] = [...m[2].matchAll(/\{ href: '([^']+)',\s*label: '([^']+)'/g)].map(x => ({ href: x[1], label: x[2] }))
  }
  return erg
}

test('Kellerbuch: Übersicht, Pressungen, Zukauf, dann der Rest', () => {
  const k = bereiche().kellerbuch
  assert.deepEqual(k.slice(0, 3).map(i => i.label), ['Übersicht', 'Pressungen', 'Zukauf'])
  assert.equal(k[1].href, '/kellerbuch/pressungen')
  assert.equal(k[2].href, '/weinhandel/zukauf')
})

test('Warenwirtschaft ohne Zukauf, Warenlager und Verkauf unverändert', () => {
  const w = bereiche().warenwirtschaft
  assert.ok(!w.some(i => i.href === '/weinhandel/zukauf'))
  assert.deepEqual(w.slice(0, 2).map(i => i.href), ['/weinhandel', '/weinhandel/verkauf'])
  // 30.09.2026: Liste der Transportbescheinigungen als eigener Tab nach „Offene Posten“
  const i = w.findIndex(x => x.href === '/weinhandel/offene-posten')
  assert.deepEqual(w[i + 1], { href: '/weinhandel/transportbescheinigungen', label: 'Transportbescheinigungen' })
})

test('Rieden: Lese und AMA-Erntemeldung bleiben', () => {
  const r = bereiche().rieden.map(i => i.href)
  assert.ok(r.includes('/erntemeldung'))
  assert.ok(r.includes('/reports/ama'))
})

test('Zukauf-Unterseiten öffnen den Kellerbuch-Bereich (längster Treffer)', () => {
  const b = bereiche()
  const kandidaten = Object.entries(b).flatMap(([key, items]) => items.map(i => ({ key, href: i.href })))
  const exakt = new Set(['/dashboard', '/crm', '/weinhandel', '/auswertungen', '/kellerbuch', '/behandlungen', '/buchhaltung'])
  const aktiv = pfad => kandidaten
    .filter(k => pfad === k.href || (!exakt.has(k.href) && pfad.startsWith(k.href)))
    .sort((a, b2) => b2.href.length - a.href.length)[0]?.key
  assert.equal(aktiv('/weinhandel/zukauf/neu'), 'kellerbuch')
  assert.equal(aktiv('/kellerbuch/pressungen'), 'kellerbuch')
  assert.equal(aktiv('/weinhandel/verkauf'), 'warenwirtschaft')
})

test('Lese-Seite zeigt nur noch den Verweis, Pressungen-Seite nutzt dieselbe Ladefunktion', () => {
  const client = quelle('src/app/(dashboard)/erntemeldung/[id]/ErnteDetailClient.tsx')
  assert.ok(!client.includes('<PressungSection'))
  assert.ok(client.includes('Kellerbuch › Pressungen'))
  const seite = quelle('src/app/(dashboard)/kellerbuch/pressungen/page.tsx')
  assert.ok(seite.includes('ladeLeseKontext(gewaehlt.id, sp.lese)'))
  assert.ok(seite.includes('<PressungSection'))
  const lese = quelle('src/app/(dashboard)/erntemeldung/[id]/page.tsx')
  assert.ok(lese.includes('ladeLeseKontext(id, leseParam)'))
  // Aktionen laden die neue Seite neu
  const aktionen = quelle('src/app/(dashboard)/erntemeldung/actions.ts')
  assert.equal((aktionen.match(/revalidatePath\('\/kellerbuch\/pressungen'\)/g) ?? []).length, 3)
})

test('Hotfix 02.10.2026: Datenimport auch für Betriebs-Manager (Navigation und Seite)', () => {
  const nav = quelle('src/lib/navigation/index.ts')
  assert.match(nav, /href: '\/admin\/import',\s+label: 'Datenimport',\s+adminOnly: true, betriebsleiter: true/)
  assert.match(nav, /if \(!isSysAdmin && !ctx\.sandboxAdminUnlock && !\(it\.betriebsleiter && isAdmin\)\) return false/)
  // übrige /admin/*-Seiten bleiben Super-Admin vorbehalten
  assert.equal((nav.match(/betriebsleiter: true/g) ?? []).length, 1)
  const seite = quelle('src/app/(dashboard)/admin/import/page.tsx')
  assert.match(seite, /membership\?\.role !== 'system_admin' && membership\?\.role !== 'tenant_admin'\) redirect\('\/dashboard'\)/)
})
