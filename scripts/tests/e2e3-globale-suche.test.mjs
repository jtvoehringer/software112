// E2E-Ausbau 3 (11.10.2026): Globale Suche (Strg K) lieferte HTTP 500.
// Befund des neuen Mandantentrennungs-Tests gegen Staging: /api/global-search?q=E2E-Fremd → 500 für alle Rollen.
// Ursache: Jahrgänge und Chargen wurden über eine Typumwandlung im Filter gesucht (Spalte jahrgang als Text, ilike).
// PostgREST erlaubt Typumwandlungen nur im select und antwortet im Filter mit 400 – die Route machte daraus 500, die
// ganze Suche blieb leer. Jetzt: Jahrgang nur bei einer Zahl, als Bereich (src/lib/suche/global.ts); der Wächter
// check-einbettung meldet Typumwandlungen in Filtern.
//
// Aufruf:  npm run -s test:csv

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { jahrgangBereich, jahrgangFilter, sucheSicher } from '../../src/lib/suche/global.ts'

const HIER = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(HIER, '..', '..')
const require = createRequire(import.meta.url)
const { pruefeText, index } = require(path.join(HIER, '..', 'check-einbettung.js'))
const ix = index(
  JSON.parse(readFileSync(path.join(HIER, '..', 'fremdschluessel.json'), 'utf8')),
  Object.keys(JSON.parse(readFileSync(path.join(HIER, '..', 'schema.json'), 'utf8'))),
)
const casts = (text) => pruefeText(text, ix).filter(f => /Typumwandlung/.test(f.meldung))

describe('globale Suche: Jahrgang ohne Typumwandlung im Filter', () => {
  test('Jahrgang nur bei 1–4 Ziffern, als Bereich der Jahreszahl', () => {
    assert.deepEqual(jahrgangBereich('2025'), { von: 2025, bis: 2025 })
    assert.deepEqual(jahrgangBereich('202'), { von: 2020, bis: 2029 })
    assert.deepEqual(jahrgangBereich('20'), { von: 2000, bis: 2099 })
    assert.deepEqual(jahrgangBereich(' 19 '), { von: 1900, bis: 1999 })
    for (const q of ['E2E-Fremd', 'Veltliner', '20255', '2025a', '', '20 25']) assert.equal(jahrgangBereich(q), null, q)
  })

  test('Filterteil: eine Jahreszahl → eq, ein Anfang → and(gte, lte), sonst keiner', () => {
    assert.equal(jahrgangFilter('2025'), 'jahrgang.eq.2025')
    assert.equal(jahrgangFilter('202'), 'and(jahrgang.gte.2020,jahrgang.lte.2029)')
    assert.equal(jahrgangFilter('E2E-Fremd'), null)
    assert.ok(!/::/.test(jahrgangFilter('202')))
  })

  test('Suchtext ohne Zeichen, die den or()-Filter zerlegen („Müller, Hans“)', () => {
    assert.equal(sucheSicher('Müller, Hans'), 'Müller Hans')
    assert.equal(sucheSicher(' a(b)%c_d*e\\f"g '), 'a b c d e f g')
    assert.equal(sucheSicher('E2E-Fremd'), 'E2E-Fremd')
  })
})

describe('check-einbettung: Typumwandlung in einem Filter', () => {
  test('Regression: die alte Suche (Jahrgänge und Chargen) wird zweimal gemeldet', () => {
    const alt = [
      "const { data } = await (supabase.from('weinjahrgaenge') as any)",
      "  .select('id, jahrgang')",
      '  .or(`jahrgang::text.ilike.%${q}%`)',
      "const { data: c } = await (supabase.from('weinausbau') as any)",
      "  .select('id, name')",
      '  .or(`name.ilike.%${q}%,rebsorte.ilike.%${q}%,jahrgang::text.ilike.%${q}%`)',
    ].join('\n')
    const f = casts(alt)
    assert.deepEqual(f.map(x => x.zeile), [3, 6])
    assert.match(f[0].meldung, /jahrgang::text.*400/)
  })

  test('auch als Filterspalte und mit not.; Typumwandlung im select bleibt erlaubt', () => {
    assert.equal(casts("q.ilike('jahrgang::text', `%${q}%`)").length, 1)
    assert.equal(casts("q.or('menge::int.not.eq.0')").length, 1)
    assert.equal(casts("q.select('id, jahrgang::text, menge_liter::float')").length, 0)
    assert.equal(casts("q.select('id, j:jahrgang::text')").length, 0)
  })

  test('Ausnahme mit Begründung', () => {
    assert.equal(casts("// einbettung-ignore: Test der Ausnahme mit Grund\nq.or('x::text.eq.1')").length, 0)
  })

  test('die echte Route sucht ohne Typumwandlung und über jahrgangFilter', () => {
    const route = readFileSync(path.join(ROOT, 'src', 'app', 'api', 'global-search', 'route.ts'), 'utf8')
    assert.equal(casts(route).length, 0)
    assert.match(route, /jahrgangFilter\(q\)/)
    assert.match(route, /sucheSicher\(/)
  })
})
