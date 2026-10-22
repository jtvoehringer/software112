// Sweep 93 (KAN-288, 10.10.2026): still bei 1.000 Zeilen gekappte Abfragen über die Helfer q('…') bzw. ctx.q('…').
// check-alle erkannte nur .from('…') und nur tf(…) als Mandanten-Wrapper – Dashboard, Finanzübersicht und Morgenbericht
// liefen daran vorbei (Summe offener Posten, Umsatzreihe, Flaschenbestand, Fläche, Kontosaldo). Dazu Zählungen mit
// fester Obergrenze (.limit(500/1000)) und die Lieferanten-Auswahl im Lager.
//
// Aufruf:  npm run -s test:csv

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'

const require = createRequire(import.meta.url)
const c = require('../check-alle.js')
const inFn = t => `async function f() {\n${t}\n}`
const regeln = t => c.pruefeText(inFn(t), 'src/x.ts').funde.map(f => [f.regel, f.tabelle])
const quelle = p => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')

describe('check-alle: Helfer q()/ctx.q() und ctx.tf()', () => {
  test('q(…) und ctx.q(…) ohne alle() sind ein Fund', () => {
    assert.deepEqual(regeln(`const { data } = await tf(q('verkaufsposten').select('id').eq('bezahlt', false))`), [['VOLLABFRAGE', 'verkaufsposten']])
    assert.deepEqual(regeln(`const { data } = await ctx.tf(ctx.q('fuellungen').select('id').eq('aktiv', true))`), [['VOLLABFRAGE', 'fuellungen']])
  })

  test('alle(ctx.tf(ctx.q(…)).order(…)) bzw. alle(tf(q(…))) ist gepaged, kleine Tabelle kein Fund', () => {
    assert.deepEqual(regeln(`const { data } = await alle(ctx.tf(ctx.q('fuellungen').select('id').eq('aktiv', true)).order('id'))`), [])
    assert.deepEqual(regeln(`const { data } = await alle(tf(q('verkaufsposten').select('id')).order('id'))`), [])
    assert.deepEqual(regeln(`const { data } = await ctx.tf(ctx.q('rabattgruppen').select('id'))`), [])
  })
})

describe('Regression: die gefundenen Stellen laufen über alle()', () => {
  // KAN-346/374: offene Posten und Umsatzreihe über die zentralen Lader (alle() in lib/verkauf/umsatz.ts)
  test('Verkaufs-Dashboard: offene Posten und Umsatzreihe', () => {
    const p = quelle('src/app/(dashboard)/dashboard/verkauf/page.tsx')
    assert.match(p, /ladeUmsatzRechnungen\(supabase, tenantId, absatzVon, absatzBis\)/)
    assert.match(p, /ladeOffenePosten\(ctx\)/)
    assert.doesNotMatch(p, /q\('verkaufsposten'\)\s*\n?\s*\.select\('id, datum/)
  })

  test('Dashboard-Daten: Gebinde, Chargen, Flaschen, Grundstücke, Maßnahmen der Saison, BMD-Belege, AfA – ohne .limit()', () => {
    const d = quelle('src/app/(dashboard)/dashboard/_shared/data.ts')
    // KAN-375: Rechnungen ohne BMD-Übergabe über ladeRechnungenOhneBmdExport (umsatz.ts, alle()) statt verkaufsposten
    assert.match(d, /ladeRechnungenOhneBmdExport\(ctx\.supabase, ctx\.tenantId, seit, ctx\.heuteStr\)/)
    for (const t of ['behaelter', 'weinausbau', 'fuellungen', 'grundstuecke', 'behandlungen', 'ea_transaktionen']) {
      assert.match(d, new RegExp(`alle<R>\\(ctx\\.tf\\(ctx\\.q\\('${t}'\\)`), t)
    }
    assert.doesNotMatch(d, /BEHANDLUNG_RIEDEN_SELECT\}`\)[^\n]*\.limit\(500\)/)
    assert.doesNotMatch(d, /bmd_export_id', null\)\.gte\('datum', seit\)\.limit\(1000\)/)
  })

  test('Finanzübersicht, Morgenbericht, Anlagen, Lager-Lieferanten', () => {
    assert.match(quelle('src/lib/finanzen/uebersicht.ts'), /alle<R>\(ctx\.tf\(ctx\.q\('konto_umbuchungen'\)/)
    const m = quelle('src/lib/morgenbericht/pruefungen.ts')
    assert.match(m, /ladeOffenePosten\(ctx\),/)   // KAN-346/374: zentral, vollständig über alle()
    assert.match(quelle('src/app/(dashboard)/buchhaltung/anlagen/daten.ts'), /alle<R>\(ctx\.tf\(ctx\.q\('ea_transaktionen'\)/)
    const l = quelle('src/app/(dashboard)/behandlungen/lager/page.tsx')
    assert.match(l, /alle<AR>\(tf\(\(supabase\.from\('firmen'\) as any\)\n\s*\.select\('id, name'\)\.eq\('ist_lieferant', true\)\.eq\('aktiv', true\)\)\.order\('name'\)\.order\('id'\)\)/)
  })

  test('Projekt: keine ungepagte Vollabfrage', () => {
    const e = c.pruefeWurzel(new URL('../..', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1'))
    assert.deepEqual(e.funde, [])
  })
})
