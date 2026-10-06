// KAN-41 Paket 2a (06.10.2026) – Zukauf Maische
//
// Aufruf:  npm run -s test:csv   (alle scripts/tests/*.test.mjs)
//
// Entscheidungen Jörgen (06.10.2026): Maische verhält sich wie zugekaufte Trauben – Quelle einer Pressung (Journal
// ZK_MAISC statt ZK_TRAUB), Qualitätsstufen der Lese, Mostgewicht Pflicht, zählt zur Zukaufsgrenze; sie wird nur
// gepresst, nicht weiterverkauft (kein Traubenverkauf). Die BSM-Rechnung prüft kan43-bsm.test.mjs (Test 1b), das
// Journal der Pressung DB-Test 50.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { register } from 'node:module'

register('./ernte.aufloesung.mjs', import.meta.url)

const w = await import('../../src/lib/zukauf/ware.ts')
const quelle = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')

const MAISCHE = {
  art: 'maische', weinart: 'rot', rebsorte: 'Zweigelt', jahrgang: 2026, qualitaetsstufe: 'qualitaetswein',
  herkunft: 'kamptal_gebietswein', mostgewicht: true, alkohol: null, pruefnummer: null,
}

describe('Regeln', () => {
  test('istTraubenArt: Trauben und Maische, nicht Wein/Most', () => {
    assert.equal(w.istTraubenArt('trauben'), true)
    assert.equal(w.istTraubenArt('maische'), true)
    for (const a of ['wein', 'most', null, undefined, '']) assert.equal(w.istTraubenArt(a), false, String(a))
    assert.equal(w.ZUKAUF_ART_LABEL.maische, 'Maische')
  })
  test('Ware: Maische wie Trauben – Mostgewicht Pflicht, kein Alkohol nötig', () => {
    assert.equal(w.zukaufWareFehler(MAISCHE, []), null)
    assert.match(w.zukaufWareFehler({ ...MAISCHE, mostgewicht: false }, []), /Mostgewicht/)
    assert.match(w.zukaufWareFehler({ ...MAISCHE, art: 'saft' }, []), /Wein, Traubenmost, Trauben oder Maische wählen/)
  })
})

describe('Verdrahtung', () => {
  test('Pressung: Zukauf-Auswahl mit Trauben und Maische, Traubenverkauf ohne Maische', () => {
    const k = quelle('src/app/(dashboard)/erntemeldung/[id]/leseKontext.ts')
    assert.match(k, /\.in\('art', \['trauben', 'maische'\]\)/)
    const p = quelle('src/app/(dashboard)/erntemeldung/[id]/page.tsx')
    assert.match(p, /zukaufOptions=\{zukaufTrauben\.filter\(z => z\.art !== 'maische'\)\}/)
    const a = quelle('src/app/(dashboard)/erntemeldung/actions.ts')
    assert.match(a, /find\(z => !istTraubenArt\(z\.art as string \| null\)\)/)
  })
  test('Zukaufsgrenze und BSM zählen Maische mit', () => {
    assert.match(quelle('src/app/(dashboard)/weinhandel/zukauf/page.tsx'), /\.in\('art', \['trauben', 'maische'\]\)/)
    const b = quelle('src/lib/behoerden/bsm.ts')
    assert.match(b, /\.in\('art', \['trauben', 'maische'\]\)/)
    assert.match(b, /zukauf:zukauf_posten_id\(art\)/)
  })
  test('Migration: Art erlaubt, Journal teilt ZK_TRAUB/ZK_MAISC, Genealogie mit ZK_MAISC als Wurzel', () => {
    const f = readdirSync(new URL('../../supabase/migrations', import.meta.url)).find(n => n.endsWith('_kan41_zukauf_maische.sql'))
    const m = quelle(f ? `supabase/migrations/${f}` : 'supabase/entwurf/kan41_zukauf_maische.sql')
    assert.match(m, /'maische'::text\]\)\)/)
    assert.match(m, /'code', 'ZK_MAISC'/)
    assert.match(m, /'ERNTE', 'ZK_TRAUB', 'ZK_MAISC', 'ZK_MOST'/)
    assert.match(m, /REVOKE EXECUTE ON FUNCTION public\.s112_journal_zeilen_pressung\(jsonb, numeric, numeric, numeric, uuid, uuid\) FROM PUBLIC, anon, authenticated/)
  })
})
