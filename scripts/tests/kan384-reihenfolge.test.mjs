// KAN-384 (UAT 28.10.2026) – Vorgänge am selben Tag nach Erfassungszeitpunkt sortieren (PR 1: Grundlage, Weinbuch,
// Kellerbuch/Weingarten, Behördenmeldungen, Wächter check-reihenfolge).
//
// Aufruf:  npm run -s test:csv   (alle scripts/tests/*.test.mjs)

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { nachTagUndZeit, vergleicheTagUndZeit } from '../../src/lib/datum/reihenfolge.ts'

const require = createRequire(import.meta.url)
const { pruefeText, DATUMSSPALTEN } = require('../check-reihenfolge.js')
const quelle = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')

describe('KAN-384: nachTagUndZeit', () => {
  // Beispiel aus dem UAT: vier Vorgänge am 28.10.2026, eingesammelt in der Reihenfolge des Codes
  const ereignisse = [
    { titel: 'Analyse', datum: '2026-10-28', zeitpunkt: '2026-10-28T09:40:00.000+00:00' },
    { titel: 'Prüfnummer zugeteilt', datum: '2026-10-28', zeitpunkt: '2026-10-28T09:55:12.120+00:00' },
    { titel: 'Verschneidung', datum: '2026-10-28', zeitpunkt: '2026-10-28T08:10:00.000+00:00' },
    { titel: 'Abstufung', datum: '2026-10-28', zeitpunkt: '2026-10-28T08:30:00.000+00:00' },
    { titel: 'Umzug Vortag', datum: '2026-10-27', zeitpunkt: '2026-10-28T10:00:00.000+00:00' },
  ]
  const schluessel = e => ({ tag: e.datum, zeit: e.zeitpunkt })

  test('aufsteigend: Tag, dann Erfassungszeitpunkt – der Vortag bleibt vorne, auch wenn später erfasst', () => {
    const titel = [...ereignisse].sort(nachTagUndZeit(schluessel)).map(e => e.titel)
    assert.deepEqual(titel, ['Umzug Vortag', 'Verschneidung', 'Abstufung', 'Analyse', 'Prüfnummer zugeteilt'])
  })
  test('absteigend: auch innerhalb des Tages der späteste zuerst', () => {
    const titel = [...ereignisse].sort(nachTagUndZeit(schluessel, 'ab')).map(e => e.titel)
    assert.deepEqual(titel, ['Prüfnummer zugeteilt', 'Analyse', 'Abstufung', 'Verschneidung', 'Umzug Vortag'])
  })
  test('ohne Zeitpunkt am Tagesanfang, gleicher Zeitpunkt nach id, Mikrosekunden zählen', () => {
    assert.ok(vergleicheTagUndZeit({ tag: '2026-10-28', zeit: null }, { tag: '2026-10-28', zeit: '2026-10-28T00:00:01Z' }) < 0)
    assert.ok(vergleicheTagUndZeit({ tag: '2026-10-28', zeit: '2026-10-28T08:00:00Z', id: 'b' }, { tag: '2026-10-28', zeit: '2026-10-28T08:00:00Z', id: 'a' }) > 0)
    assert.ok(vergleicheTagUndZeit({ tag: '2026-10-28', zeit: '2026-10-28T08:00:00.123456+00:00' }, { tag: '2026-10-28', zeit: '2026-10-28T08:00:00.123457+00:00' }) < 0)
    // Zeitstempel als Tag (Storno-Eintrag): verglichen werden die ersten 10 Zeichen
    assert.equal(vergleicheTagUndZeit({ tag: '2026-10-28T23:00:00Z' }, { tag: '2026-10-28' }), 0)
  })
  test('stabil: Einträge ohne Zeitpunkt behalten ihre Reihenfolge', () => {
    const a = [{ n: 1, tag: '2026-10-28' }, { n: 2, tag: '2026-10-28' }, { n: 3, tag: '2026-10-27' }]
    assert.deepEqual(a.sort(nachTagUndZeit(x => ({ tag: x.tag }))).map(x => x.n), [3, 1, 2])
  })
})

describe('KAN-384: Weinbuch', () => {
  const w = quelle('src/lib/wein/weinbuch.ts')
  test('sortiert nach Tag und Zeitpunkt, Storno-Einträge zum Zeitpunkt des Stornos', () => {
    assert.match(w, /events\.sort\(nachTagUndZeit\(ev => \(\{ tag: ev\.datum, zeit: ev\.zeitpunkt \?\? /)
    assert.doesNotMatch(w, /events\.sort\(\(a, b\) => a\.datum\.localeCompare\(b\.datum\)\)/)
    assert.match(w, /datum: tag\(st\.am\),\n\s+zeitpunkt: st\.am,/)
  })
  test('jeder Vorgang trägt seinen Erfassungszeitpunkt', () => {
    for (const [typ, quelle] of [['pressung', 'p.erstellt_am'], ['schwund', 'u.erstellt_am'], ['umzug', 'u.erstellt_am'],
      ['kellerbehandlung', 'kb.created_at'], ['analyse', 'a.created_at'], ['fuellung', 'f.erstellt_am'], ['umstufung', 'u.erstellt_am']]) {
      assert.match(w, new RegExp(`zeitpunkt: ${quelle.replace('.', '\\.')} \\?\\? null,\\n\\s+typ: '${typ}'`), typ)
    }
    assert.match(w, /zeitpunkt: v\.created_at \?\? null,\n\s+typ: 'verschneidung',\n\s+titel: 'Verschneidung – eingehend'/)
    assert.match(w, /zeitpunkt: dacZeit\.get\(dac\.id\) \?\? dac\.created_at \?\? null,/)
    const b = quelle('src/lib/wein/weinbuchBestand.ts')
    assert.match(b, /zeitpunkt: z\.erstellt_am \?\? null,\n\s+typ: mengenTyp\(/)
    assert.match(b, /WB_JOURNAL_SPALTEN = '[^']*, erstellt_am'/)
  })
})

describe('KAN-384: Behördenmeldungen', () => {
  test('Bewegungsbuch: Tag, Zeitpunkt; Gegenbuchung zum Zeitpunkt des Stornos', () => {
    const b = quelle('src/lib/behoerden/bewegungsbuch.ts')
    assert.match(b, /bewegungen\.sort\(nachTagUndZeit\(b => \(\{ tag: b\.datum, zeit: b\.zeitpunkt \}\)\)\)/)
    assert.equal((b.match(/zeitpunkt: zeitpunktVon\(/g) ?? []).length, 17)
    assert.match(b, /datum: b\.storno\.am,\n\s+zeitpunkt: b\.storno\.zeit \?\? null,/)
  })
  test('PSM-Aufzeichnung und Cu-Bilanz: Datum, Startzeit, Erfassung, id', () => {
    const p = quelle('src/lib/behoerden/psm.ts')
    assert.match(p, /export function massnahmenReihenfolge\(/)
    assert.match(p, /\.sort\(massnahmenReihenfolge\)/)
    assert.match(quelle('src/lib/behoerden/cu.ts'), /\[\.\.\.behandlungen\]\.sort\(massnahmenReihenfolge\)/)
  })
})

describe('KAN-384: Wächter check-reihenfolge', () => {
  test('meldet eine Datumsspalte ohne zweiten Schlüssel', () => {
    const r = pruefeText("const x = await supabase.from('keller_umzuege').select('id').order('datum', { ascending: false })\n")
    assert.equal(r.funde.length, 1)
    assert.match(r.funde[0].text, /\.order\('datum'\) ohne zweiten Schlüssel/)
  })
  test('zweiter Schlüssel, Zeitstempel-Spalte und begründete Ausnahme sind in Ordnung', () => {
    assert.equal(pruefeText(".order('datum', { ascending: false })\n  .order('erstellt_am', { ascending: false })").funde.length, 0)
    assert.equal(pruefeText(".order('erstellt_am', { ascending: false })").funde.length, 0)
    assert.equal(pruefeText("// reihenfolge-ok: höchstens eine Zeile je Tag (Abschluss)\n.order('datum')").funde.length, 0)
    assert.equal(pruefeText("// reihenfolge-ok: kurz\n.order('datum')").funde.length, 1)
    assert.equal(pruefeText("// .order('datum') im Kommentar").funde.length, 0)
  })
  test('Datumsspalten aus dem Schema, Wächter im prebuild', () => {
    for (const s of ['datum', 'analyse_datum', 'eingereicht_am', 'gueltig_ab']) assert.ok(DATUMSSPALTEN.has(s), s)
    assert.ok(!DATUMSSPALTEN.has('erstellt_am'))
    assert.match(quelle('package.json'), /node scripts\/check-reihenfolge\.js/)
  })
})

// KAN-384 PR 2: CRM, Verkauf, Buchhaltung, Dashboard, API – keine Altfälle mehr, Termine nach Uhrzeit
describe('KAN-384 PR 2', () => {
  test('keine Altfälle mehr – jede Datumssortierung hat einen zweiten Schlüssel', () => {
    const { ALTFAELLE: alt, pruefeWurzel } = require('../check-reihenfolge.js')
    assert.equal(alt.size, 0)
    const e = pruefeWurzel(new URL('../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
    assert.deepEqual(e.funde, [])
  })
  test('vergleicheTermine: Tag, ganztägig zuerst, dann Startzeit, dann id', async () => {
    const { vergleicheTermine } = await import('../../src/lib/datum/reihenfolge.ts')
    const t = [
      { id: 'c', datum: '2026-10-28', uhrzeit_von: '14:00:00' },
      { id: 'b', datum: '2026-10-28', uhrzeit_von: '09:30:00' },
      { id: 'd', datum: '2026-10-27', uhrzeit_von: '18:00:00' },
      { id: 'a', datum: '2026-10-28', ganztags: true, uhrzeit_von: '08:00:00' },
    ]
    assert.deepEqual(t.sort(vergleicheTermine).map(x => x.id), ['d', 'a', 'b', 'c'])
  })
  test('Aktivitäten nach Datum, Uhrzeit, Erfassung; Kalender und Kontenabstimmung im Code', () => {
    assert.match(quelle('src/app/(dashboard)/crm/kontakte/[id]/page.tsx'),
      /\.order\('datum', \{ ascending: false \}\)\.order\('uhrzeit_von', \{ ascending: false, nullsFirst: false \}\)\.order\('erstellt_am', \{ ascending: false \}\)\.order\('id', \{ ascending: false \}\)/)
    assert.match(quelle('src/app/(dashboard)/dashboard/_shared/data.ts'),
      /\.order\('datum', \{ ascending: true \}\)\.order\('uhrzeit_von', \{ ascending: true, nullsFirst: true \}\)\.order\('erstellt_am'\)\.order\('id'\)/)
    assert.match(quelle('src/app/(dashboard)/crm/page.tsx'), /\]\.sort\(vergleicheTermine\)/)
    assert.match(quelle('src/app/(dashboard)/crm/CRMUebersichtClient.tsx'), /\.sort\(vergleicheTermine\),/)
    const k = quelle('src/app/(dashboard)/konten/[id]/abstimmung/page.tsx')
    assert.match(k, /bewegungen\.sort\(nachTagUndZeit\(b => \(\{ tag: b\.datum, zeit: b\.zeitpunkt, id: b\.id \}\)\)\)/)
    assert.match(k, /gegen\.map\(g => \(\{ \.\.\.g, zeitpunkt: z\.storniert_am \?\? null \}\)\)/)
  })
})

// KAN-384 UAT 28.10.2026: Datum im Weinbuch immer rechts, langer Titel bricht um (kein flex-wrap im Kopf der Karte)
describe('KAN-384: Weinbuch-Karte', () => {
  test('Datum rechts, Text davor bricht um', () => {
    const t = quelle('src/app/(dashboard)/kellerbuch/weinausbau/[id]/buch/WeinbuchTimeline.tsx')
    assert.match(t, /<div className="flex items-start justify-between gap-2">\n\s+<div className="min-w-0 flex-1">/)
    assert.match(t, /tabular-nums shrink-0 whitespace-nowrap">\n\s+\{fmtDate\(ev\.datum\)\}/)
  })
})
