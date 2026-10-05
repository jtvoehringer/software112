// KAN-89 (05.10.2026): Rebsorten-Stammtabelle = BKI-Kürzelliste, „Sortenverschnitt“ bei der Pressung mit Farbe,
// ss = ß, Prüfseite „Rebsorten ohne Kürzel“. Die Soll-Liste der Tabelle steht in DB-Test 41 (gegen Staging geprüft) –
// hier wird dieselbe Liste gegen REBSORTE_KUERZEL/bkiFarbe() abgeglichen.
//
// Aufruf:  npm run -s test:csv  (Node ≥ 22.15 wegen module.registerHooks)

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { hooksRegistrieren, laden, nurMitHooks, hooksMoeglich } from './buchung-attrappe.mjs'

hooksRegistrieren()
const WURZEL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const quelle = rel => readFileSync(path.join(WURZEL, rel), 'utf8').replace(/\r\n/g, '\n')
const bki = hooksMoeglich ? await laden('lib/wein/bki_kuerzel.ts') : null
const sa = hooksMoeglich ? await laden('lib/wein/sortenangabe.ts') : null
const rp = hooksMoeglich ? await laden('lib/wein/rebsortenPruefung.ts') : null

/** Soll-Liste aus DB-Test 41 ('KZ|Name|farbe', …) */
function sollListe() {
  const s = quelle('scripts/db-tests/41_rebsorten_kuerzel.sql')
  const block = s.slice(s.indexOf('c_soll  constant text[] := ARRAY['), s.indexOf('];', s.indexOf('c_soll  constant')))
  return [...block.matchAll(/'([A-Z]{2})\|([^|']+)\|(weiss|rot)'/g)].map(m => ({ kuerzel: m[1], name: m[2], farbe: m[3] }))
}

describe('KAN-89 Rebsorten-Stammtabelle = BKI-Kürzelliste', nurMitHooks, () => {
  test('jede Sorte der Soll-Liste (DB-Test 41) hat genau dieses Kürzel und diese Farbe laut bki_kuerzel.ts', () => {
    const liste = sollListe()
    assert.equal(liste.length, 21)
    for (const r of liste) {
      assert.equal(bki.bkiRebsorteKuerzel(r.name), r.kuerzel, r.name)
      assert.equal(bki.bkiFarbe(r.name), r.farbe, r.name)
    }
    assert.equal(new Set(liste.map(r => r.kuerzel)).size, liste.length, 'Kürzel eindeutig')
  })

  test('Migration: Zielkürzel aus der Liste, nur weiß/rot', () => {
    const f = readdirSync(path.join(WURZEL, 'supabase/migrations')).find(n => n.endsWith('_kan89_rebsorten_kuerzel.sql'))
    const m = quelle(f ? path.join('supabase/migrations', f) : 'supabase/entwurf/kan89_rebsorten_kuerzel.sql')
    const ziele = [...m.matchAll(/\('([A-Z]{2})', '([A-Z]{2})', '([^']+)',\s+(?:'[^']*'|NULL),\s+'(weiss|rot)'\)/g)]
    assert.equal(ziele.length, 9)
    for (const [, , kz, name, farbe] of ziele) {
      assert.equal(bki.bkiRebsorteKuerzel(name), kz, name)
      assert.equal(bki.bkiFarbe(name), farbe, name)
    }
    assert.match(m, /CHECK \(farbe IN \('weiss', 'rot'\)\)/)
  })
})

describe('KAN-89 Schreibweisen und Sortenverschnitt', nurMitHooks, () => {
  test('ss = ß beim Vergleich', () => {
    assert.equal(bki.bkiRebsorteKuerzel('Weisser Riesling'), 'RR')
    assert.equal(bki.bkiRebsorteKuerzel('Weissburgunder'), 'WB')
    assert.equal(bki.bkiRebsorteKuerzel('Grauer Burgunder'), 'GR')
  })

  test('Sortenverschnitte mit Farbe haben ein Kürzel, ohne Farbe nicht', () => {
    assert.equal(bki.bkiRebsorteKuerzel('Sortenverschnitt weiß'), 'SW')
    assert.equal(bki.bkiRebsorteKuerzel('Sortenverschnitt rot'), 'SO')
    assert.equal(bki.bkiRebsorteKuerzel('Sortenverschnitt Rosé'), 'SR')
    assert.equal(bki.bkiRebsorteKuerzel('Sortenverschnitt gleichgepresst'), 'SP')
    assert.equal(bki.bkiRebsorteKuerzel('Sortenverschnitt'), null)
  })

  test('Pressung aus mehreren Sorten: nie Sortenverschnitt ohne Farbe, wenn Weinart oder Sortenfarben bekannt sind', () => {
    const f = n => bki.bkiFarbe(n)
    assert.equal(sa.pressungSortenverschnitt('weiss', [f('Grüner Veltliner'), f('Zweigelt')]), 'Sortenverschnitt weiß')
    assert.equal(sa.pressungSortenverschnitt('rose', []), 'Sortenverschnitt Rosé')
    assert.equal(sa.pressungSortenverschnitt('unbekannt', [f('Grüner Veltliner'), f('Riesling')]), 'Sortenverschnitt weiß')
    assert.equal(sa.pressungSortenverschnitt(null, [f('Zweigelt'), f('Blaufränkisch')]), 'Sortenverschnitt rot')
    assert.equal(sa.pressungSortenverschnitt(null, [f('Zweigelt'), f('Grüner Veltliner')]), 'Sortenverschnitt gleichgepresst')
    assert.equal(sa.pressungSortenverschnitt(null, [f('Zweigelt'), f('Phantasiesorte')]), 'Sortenverschnitt')
    for (const n of ['Sortenverschnitt weiß', 'Sortenverschnitt rot', 'Sortenverschnitt gleichgepresst']) assert.ok(bki.bkiRebsorteKuerzel(n), n)
  })

  test('Pressung (Server Action und Vorschau) setzt kein farbloses „Sortenverschnitt“ mehr', () => {
    const a = quelle('src/app/(dashboard)/erntemeldung/actions.ts')
    const p = quelle('src/app/(dashboard)/erntemeldung/[id]/PressungSection.tsx')
    for (const [n, s] of [['actions', a], ['PressungSection', p]]) {
      assert.doesNotMatch(s, /: 'Sortenverschnitt'/, n)
      assert.match(s, /pressungSortenverschnitt\(/, n)
    }
  })

  test('Farbe einer Sorte: Stammtabelle, sonst BKI-Liste (Umzug, Verschnitt, Zukauf)', () => {
    for (const rel of ['src/app/(dashboard)/kellerbuch/umziehen/actions.ts', 'src/lib/kellerbuch/verschnittBuchen.ts', 'src/app/(dashboard)/weinhandel/zukauf/actions.ts']) {
      assert.match(quelle(rel), /weinartAusFarbe\(farbe\.get\([^)]*\) \?\? bkiFarbe\(/, rel)
    }
  })
})

describe('KAN-89 Prüfseite „Rebsorten ohne Kürzel“', nurMitHooks, () => {
  test('ohneKuerzel: nur Werte ohne amtliches Kürzel, gezählt, mit Vorschlag', () => {
    const l = rp.ohneKuerzel(['Zierfandler', 'Gemischer Satz', 'Gemischer Satz', 'Sortenverschnitt', 'Weisser Riesling', null, ' ', 'Sortenverschnitt weiß', 'Gerodet'])
    assert.deepEqual(l.map(x => [x.wert, x.anzahl]), [['Gemischer Satz', 2], ['Gerodet', 1], ['Sortenverschnitt', 1]])
    assert.equal(l[0].vorschlag, 'Gemischter Satz')
    assert.equal(l.find(x => x.wert === 'Sortenverschnitt').vorschlag, null)
    assert.equal(l.find(x => x.wert === 'Gerodet').vorschlag, null)
  })

  test('Sammelkorrektur nur auf amtliche Namen oder leer', () => {
    assert.equal(rp.korrekturZielFehler(''), null)
    assert.equal(rp.korrekturZielFehler('Gemischter Satz'), null)
    assert.match(rp.korrekturZielFehler('Gemischer Satz'), /keine Sorte der BKI-Kürzelliste/)
  })

  test('amtlicheSorten: je Kürzel ein Name, Sortenverschnitte am Ende', () => {
    const s = bki.amtlicheSorten()
    assert.equal(new Set(s.map(x => x.kuerzel)).size, s.length)
    assert.ok(s.some(x => x.kuerzel === 'GV' && x.name === 'Grüner Veltliner'))
    const i = s.findIndex(x => /^Sortenverschnitt/.test(x.name))
    assert.ok(i > 0 && s.slice(i).every(x => /^Sortenverschnitt/.test(x.name)))
  })

  test('Seite, Action und Navigation', () => {
    const a = quelle('src/app/(dashboard)/weingarten/rebsorten/actions.ts')
    assert.match(a, /if \(!canWrite\(membership, t\.modul\)\)/)
    assert.match(a, /\.is\('storniert_am', null\)/)
    assert.match(quelle('src/lib/navigation/index.ts'), /href: '\/weingarten\/rebsorten', label: 'Rebsorten prüfen'/)
  })
})
