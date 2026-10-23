// UAT 23.10.2026 – Warenlager: der Klick auf das Produkt führte in die Rückverfolgung, bearbeiten nur über den Stift.
// Jetzt öffnet das Produkt die Füllung; Reiter Füllung · E-Label · Rückverfolgung verbinden die drei Seiten.
//
// Aufruf:  npm run -s test:csv   (alle scripts/tests/*.test.mjs)

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const quelle = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')

describe('UAT: Reiter je Füllung', () => {
  test('Reiter: Füllung (nur mit Bearbeitungsrecht), E-Label, Rückverfolgung; aktiver Reiter aus der Adresse', () => {
    const r = quelle('src/components/handel/FuellungReiter.tsx')
    assert.match(r, /^'use client'/)
    assert.match(r, /\.\.\.\(bearbeiten \? \[\{ art: 'fuellung' as const, label: 'Füllung', href: `\/weinhandel\/fuellungen\/\$\{id\}\/edit` \}\] : \[\]\)/)
    assert.match(r, /\{ art: 'elabel', label: 'E-Label', href: `\/weinhandel\/fuellungen\/\$\{id\}\/elabel` \}/)
    assert.match(r, /\{ art: 'rueckverfolgung', label: 'Rückverfolgung', href: `\/kellerbuch\/rueckverfolgung\?fuellung_id=\$\{id\}` \}/)
    assert.match(r, /aria-current=\{aktiv === r\.art \? 'page' : undefined\}/)
    assert.match(r, /print:hidden/)
  })
  test('Layout der Füllung zeigt die Reiter; Bearbeiten-Reiter nur mit Schreibrecht der Warenwirtschaft (wie die Seite)', () => {
    const l = quelle('src/app/(dashboard)/weinhandel/fuellungen/[id]/layout.tsx')
    assert.match(l, /const bearbeiten = !!membership && canWrite\(membership, 'warenwirtschaft'\)/)
    assert.match(l, /<FuellungReiter id=\{id\} bearbeiten=\{bearbeiten\} \/>/)
    const edit = quelle('src/app/(dashboard)/weinhandel/fuellungen/[id]/edit/page.tsx')
    assert.match(edit, /if \(!canWrite\(role, 'warenwirtschaft'\)\) redirect\('\/weinhandel'\)/, 'gleiche Regel wie der Reiter')
  })
  test('Rückverfolgung einer Füllung zeigt dieselben Reiter', () => {
    const p = quelle('src/app/(dashboard)/kellerbuch/rueckverfolgung/page.tsx')
    assert.match(p, /\{fuellung && <FuellungReiter id=\{fuellung\.id\} bearbeiten=\{!!membership && canWrite\(membership, 'warenwirtschaft'\)\} \/>\}/)
  })
  test('Warenlager: Produkt öffnet die Füllung (Leser: Rückverfolgung), Lupe führt zur Rückverfolgung', () => {
    const w = quelle('src/app/(dashboard)/weinhandel/page.tsx')
    assert.match(w, /href=\{writeOk \? `\/weinhandel\/fuellungen\/\$\{f\.id\}\/edit` : `\/kellerbuch\/rueckverfolgung\?fuellung_id=\$\{f\.id\}`\}/)
    assert.match(w, /<Link href=\{`\/kellerbuch\/rueckverfolgung\?fuellung_id=\$\{f\.id\}`\} title="Rückverfolgung" aria-label=/)
  })
})
