// UAT-Paket F (Entscheidungen Jörgen 22.10.2026):
//   KAN-350  Behandlungsprotokoll und Änderungsprotokoll (Bildschirm: Journal) am Bildschirm umschaltbar zwischen
//            „Neueste zuerst“ (Vorgabe) und „Chronologisch“ (?sort=neu|alt) – Druck und CSV bleiben chronologisch.
//   KAN-360  Rückverfolgung in jedem Modul an derselben Stelle: Hauptpunkt, letzter Punkt vor den Behördenmeldungen,
//            gleiche Bezeichnung, Stichwörter für Strg K (Rückverfolgung, Rückruf, Rückruf-Liste, RV, Lieferkette).
//   KAN-349  Korrekturdialog am Prüfnummernantrag: „Bezeichnung (Antrag)“ und Hinweis „Die Charge ist nicht änderbar.“
//
// Aufruf:  npm run -s test:csv

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  PROTOKOLL_SORT_LABEL, PROTOKOLL_SORT_VORGABE, andereSortierung, inAnzeigeReihenfolge, protokollSortAus, sortierHref,
} from '../../src/lib/protokoll/sortierung.ts'
import { hooksRegistrieren, laden, nurMitHooks, hooksMoeglich, datenbank, uuid } from './buchung-attrappe.mjs'

hooksRegistrieren()
const WURZEL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const quelle = rel => readFileSync(path.join(WURZEL, rel), 'utf8').replace(/\r\n/g, '\n')
const psm = hooksMoeglich ? await laden('lib/behoerden/psm.ts') : null
const korrektur = hooksMoeglich ? await laden('lib/freeze/korrektur.ts') : null

// ── KAN-350 ──────────────────────────────────────────────────────────────────

describe('KAN-350: Sortierung der Protokolle am Bildschirm', () => {
  test('Vorgabe neueste zuerst; nur „alt“ und „neu“ gelten', () => {
    assert.equal(PROTOKOLL_SORT_VORGABE, 'neu')
    assert.equal(protokollSortAus('alt'), 'alt')
    assert.equal(protokollSortAus('neu'), 'neu')
    for (const w of [undefined, null, '', 'ALT', 'asc', ['alt', 'neu'], 1]) assert.equal(protokollSortAus(w), 'neu', String(w))
    assert.equal(andereSortierung('neu'), 'alt')
    assert.equal(andereSortierung('alt'), 'neu')
    assert.deepEqual(PROTOKOLL_SORT_LABEL, { neu: 'Neueste zuerst', alt: 'Chronologisch' })
  })

  test('Anzeige-Reihenfolge aus der chronologischen Liste, Eingabe bleibt unverändert', () => {
    const chrono = [{ d: '2026-05-01' }, { d: '2026-06-01' }, { d: '2026-07-01' }]
    assert.deepEqual(inAnzeigeReihenfolge(chrono, 'neu').map(x => x.d), ['2026-07-01', '2026-06-01', '2026-05-01'])
    assert.deepEqual(inAnzeigeReihenfolge(chrono, 'alt').map(x => x.d), ['2026-05-01', '2026-06-01', '2026-07-01'])
    assert.deepEqual(chrono.map(x => x.d), ['2026-05-01', '2026-06-01', '2026-07-01'])
  })

  test('Umschalt-Link behält die übrigen Parameter, Vorgabe nicht in der URL', () => {
    assert.equal(sortierHref('/reports/behandlungsprotokoll', { jahr: 2026, art: 'spritzung' }, 'alt'), '/reports/behandlungsprotokoll?jahr=2026&art=spritzung&sort=alt')
    assert.equal(sortierHref('/reports/behandlungsprotokoll', { jahr: 2026, art: null, sort: 'alt' }, 'neu'), '/reports/behandlungsprotokoll?jahr=2026')
    assert.equal(sortierHref('/dashboard/journal', {}, 'neu'), '/dashboard/journal')
  })

  test('Behandlungsprotokoll: Bildschirm umschaltbar, Druck eigener chronologischer Tabellenkörper, CSV ohne Sortierung', () => {
    const s = quelle('src/app/(dashboard)/reports/(pflicht)/behandlungsprotokoll/page.tsx')
    assert.match(s, /const sort = protokollSortAus\(sortParam\)/)
    assert.match(s, /const anzeige = inAnzeigeReihenfolge\(behandlungen, sort\)/)
    assert.match(s, /<tbody className=\{sort === 'alt' \? undefined : 'print:hidden'\}>\s*\{anzeige\.map\(\(b, i\) => zeile\(b, i\)\)\}/)
    assert.match(s, /<tbody className="hidden print:table-row-group">\s*\{behandlungen\.map\(\(b, i\) => zeile\(b, i\)\)\}/)
    assert.match(s, /<SortierungUmschalter sort=\{sort\} pfad="\/reports\/behandlungsprotokoll"/)
    // Druck und CSV: dieselbe Ladefunktion ohne Sortierparameter
    assert.match(s, /ladePsmAufzeichnung\(supabase, tenantId, \{ jahr: aktJahr, art, ried: null \}\)/)
    assert.match(s, /csvPfad\('psm-aufzeichnung', \{ jahr: aktJahr, art \}\)/)
    assert.doesNotMatch(s, /csvPfad\([^)]*sort/)
  })

  test('Ladefunktion des Behandlungsprotokolls sortiert aufsteigend (Datum, id)', () => {
    const p = quelle('src/lib/behoerden/psm.ts')
    assert.match(p, /alle<R>\(q\.order\('datum'\)\.order\('id'\)\)/)
    assert.doesNotMatch(p.slice(p.indexOf('export async function ladePsmAufzeichnung')), /^\s*sort/m)
  })

  test('ladePsmAufzeichnung liefert Maßnahmen und CSV-Zeilen chronologisch', nurMitHooks, async () => {
    const T = uuid(1)
    const m = (n, datum) => ({ id: uuid(100 + n), tenant_id: T, datum, art: 'sonstiges', storniert_am: null, behandlung_grundstuecke: [] })
    const db = datenbank({ behandlungen: [m(1, '2026-07-10'), m(2, '2026-05-02'), m(3, '2026-06-15'), m(4, '2026-05-02')] })
    const r = await psm.ladePsmAufzeichnung(db, T, { jahr: 2026, art: null, ried: null })
    assert.deepEqual(r.behandlungen.map(b => b.datum), ['2026-05-02', '2026-05-02', '2026-06-15', '2026-07-10'])
    assert.deepEqual(r.behandlungen.slice(0, 2).map(b => b.id), [uuid(102), uuid(104)])
    const tage = r.zeilen.map(z => z.datum)
    assert.deepEqual(tage, [...tage].sort())
  })

  test('Journal (Bildschirm des Änderungsprotokolls): umschaltbar, neueste MAX_ANZEIGE in gewählter Reihenfolge', () => {
    const j = quelle('src/app/(dashboard)/dashboard/journal/page.tsx')
    assert.match(j, /const sort = protokollSortAus\(sp\.sort\)/)
    assert.match(j, /inAnzeigeReihenfolge\(zeilen\.slice\(0, MAX_ANZEIGE\)\.reverse\(\), sort\)/)
    assert.match(j, /<SortierungUmschalter sort=\{sort\} pfad="\/dashboard\/journal"/)
    // Journal-CSV und Änderungsprotokoll-CSV ohne Sortierparameter
    assert.match(j, /const csvHref = `\/api\/export\/journal\?\$\{new URLSearchParams\(filterParameter\(f\)\)\}`/)
    const a = quelle('src/lib/behoerden/aenderungsprotokoll.ts')
    assert.match(a, /\.order\('erstellt_am', \{ ascending: true \}\)\.order\('id', \{ ascending: true \}\)/)
    // Gebinde-Seite verweist auf die Bildschirmansicht
    assert.match(quelle('src/app/(dashboard)/kellerbuch/gebinde/page.tsx'), /<Link href="\/dashboard\/journal"[^>]*>Journal<\/Link> – neueste zuerst, umschaltbar auf chronologisch/)
  })
})

// ── KAN-360 ──────────────────────────────────────────────────────────────────

/** Punkte je Bereich aus src/lib/navigation/index.ts (Quelltext): href, label, child, pflichtmeldung, keywords */
function bereich(key) {
  const nav = quelle('src/lib/navigation/index.ts')
  const rv = nav.match(/export const RV_STICHWORTE = '([^']+)'/)?.[1]
  const start = nav.indexOf(`key: '${key}'`)
  assert.ok(start >= 0, `Bereich ${key} fehlt`)
  const gruppe = nav.slice(start, nav.indexOf("key: '", start + 1))
  return [...gruppe.matchAll(/^\s*\{ href: '([^']+)',\s*label: '([^']+)'(.*)$/gm)].map(m => ({
    href: m[1], label: m[2],
    child: /\bchild: true\b/.test(m[3]),
    pflichtmeldung: /\bpflichtmeldung: true\b/.test(m[3]),
    keywords: (m[3].match(/keywords: [`']([^`']*)[`']/)?.[1] ?? '').replace('${RV_STICHWORTE}', rv ?? ''),
  }))
}

describe('KAN-360: Rückverfolgung einheitlich vor den Behördenmeldungen', () => {
  for (const [key, href] of [['rieden', '/weingarten/rueckverfolgung'], ['kellerbuch', '/kellerbuch/rueckverfolgung']]) {
    test(`${key}: Hauptpunkt „Rückverfolgung“, letzter Punkt vor den Behördenmeldungen`, () => {
      const items = bereich(key)
      const i = items.findIndex(x => x.href === href)
      assert.ok(i >= 0, `${href} fehlt`)
      assert.equal(items[i].label, 'Rückverfolgung')
      assert.equal(items[i].child, false, 'kein Unterpunkt')
      assert.ok(items.slice(i + 1).every(x => x.pflichtmeldung), `nach der Rückverfolgung nur Behördenmeldungen: ${items.slice(i + 1).map(x => x.label)}`)
      // davor steht ein Punkt, der keine Behördenmeldung ist (keine Meldung „überspringt“ die Rückverfolgung am Ende)
      assert.equal(items[i - 1].pflichtmeldung, false)
    })
  }

  test('Kellerbuch: Besondere Konten · Rückverfolgung · Weinbuch-Sammlung · Bestandsmeldung (BSM)', () => {
    const k = bereich('kellerbuch').map(x => x.label)
    const i = k.indexOf('Rückverfolgung')
    assert.deepEqual(k.slice(i - 1), ['Besondere Konten', 'Rückverfolgung', 'Weinbuch-Sammlung', 'Bestandsmeldung (BSM)'])
  })

  test('Stichwörter für Strg K in beiden Modulen', () => {
    for (const key of ['rieden', 'kellerbuch']) {
      const rv = bereich(key).find(x => x.label === 'Rückverfolgung')
      for (const w of ['rückverfolgung', 'rückruf', 'rückruf-liste', 'rv', 'lieferkette']) {
        assert.ok(rv.keywords.split(/\s+/).includes(w), `${key}: Stichwort ${w} fehlt (${rv.keywords})`)
      }
    }
  })

  test('Befehlspalette sucht in den Stichwörtern der Navigation', () => {
    const p = quelle('src/components/CommandPalette.tsx')
    assert.match(p, /keywords: `\$\{g\.label\} \$\{i\.keywords \?\? ''\}`/)
  })
})

// ── KAN-349 ──────────────────────────────────────────────────────────────────

describe('KAN-349: Korrekturdialog am Prüfnummernantrag', nurMitHooks, () => {
  const { KORREKTUR_FELDER, KORREKTUR_ZUSATZ, korrekturAenderungen } = korrektur ?? {}
  test('Feld heißt „Bezeichnung (Antrag)“, keine Charge unter den Feldern', () => {
    const f = KORREKTUR_FELDER.dac_antrag
    assert.equal(f.find(x => x.spalte === 'bezeichnung').label, 'Bezeichnung (Antrag)')
    assert.ok(!f.some(x => /charge|weinausbau/i.test(x.spalte)))
  })

  test('Hinweis „Die Charge ist nicht änderbar.“ nur beim Prüfnummernantrag', () => {
    assert.equal(KORREKTUR_ZUSATZ.dac_antrag, 'Die Charge ist nicht änderbar.')
    assert.deepEqual(Object.keys(KORREKTUR_ZUSATZ), ['dac_antrag'])
  })

  test('der Dialog zeigt den Zusatzhinweis der Tabelle', () => {
    const k = quelle('src/components/FreezeKorrektur.tsx')
    assert.match(k, /\{KORREKTUR_ZUSATZ\[tabelle\] && <p[^>]*>\{KORREKTUR_ZUSATZ\[tabelle\]\}<\/p>\}/)
  })

  test('Pflichtmeldung nennt die neue Bezeichnung', () => {
    const e = korrekturAenderungen('dac_antrag', { bezeichnung: 'Grüner Veltliner' }, { bezeichnung: ' ' }, '2026-10-22')
    assert.equal(e.fehler, 'Bezeichnung (Antrag) darf nicht leer sein.')
  })
})
