// KAN-251 (09.10.2026): Einzelabfragen in Server Actions werten ihren Fehler aus. Ein Datenbankfehler hieß vorher „nicht
// vorhanden“ (null) – mit Folgen. Hier der Wächter scripts/check-einzelabfrage.js und Regressionstests für die zwei
// folgenreichsten Stellen in der E&A (beide ohne den Fix rot):
//   - createEaTransaktion: abzugsfähiger Anteil fiel bei einem Lesefehler still auf 100 % zurück
//   - syncEaEinnahmeFuerVerkauf: Lesefehler hieß „E&A-Modul aus“ → Einnahme still nicht gebucht (ok: true, skipped)
//
// Aufruf:  npm run -s test:csv   (Node ≥ 22.15 wegen module.registerHooks)

import { test, describe, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { DOPPEL, hooksRegistrieren, laden, nurMitHooks, hooksMoeglich, datenbank } from './buchung-attrappe.mjs'

const HIER = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HIER, '..', '..')
const require = createRequire(import.meta.url)
const { pruefeText, pruefeWurzel } = require(path.join(ROOT, 'scripts', 'check-einzelabfrage.js'))

const US = "'use " + "server'"
const M = 'einzelabfrage-ohne-' + 'fehler'
const zeilen = text => pruefeText(text).funde.map(f => f.zeile)

describe('check-einzelabfrage: Erkennung', () => {
  test('ohne error → Fund; mit error bzw. error: name → geprüft; auch mehrzeilig und .single()', () => {
    assert.deepEqual(zeilen(`${US}\nconst { data } = await s.from('t').select('id').eq('id', x).maybeSingle()\n`), [2])
    assert.deepEqual(zeilen(`${US}\nconst { data: t } = await q\n  .eq('a', 1)\n  .single()\nif (t) {}\n`), [2])
    assert.deepEqual(pruefeText(`${US}\nconst { data, error } = await s.from('t').select('id').maybeSingle()\n`), { funde: [], ausnahmen: 0, geprueft: 1 })
    assert.deepEqual(zeilen(`${US}\nconst { data: t, error: tErr } = await (s.from('t') as any)\n  .select('id')\n  .maybeSingle()\n`), [])
    assert.deepEqual(zeilen(`${US}\nlet { data } = await s.from('t').select('id').maybeSingle()\n`), [2])
  })

  test('count, getUser und andere Anweisungen schlagen nicht an; Listen seit KAN-253 als „leere Liste“', () => {
    const liste = pruefeText(`${US}\nconst { data } = await s.from('t').select('id').eq('a', 1)\nconst x = await y.maybeSingle()\n`).funde
    assert.deepEqual(liste.map(f => f.zeile), [2])
    assert.match(liste[0].text, /leere Liste/)
    assert.deepEqual(zeilen(`${US}\nconst { data: { user } } = await supabase.auth.getUser()\nconst { count } = await s.from('t').select('id', { count: 'exact', head: true })\n`), [])
    // error nur in einer verschachtelten Destrukturierung zählt nicht
    assert.deepEqual(zeilen(`${US}\nconst { data: { error } } = await s.from('t').select('x').maybeSingle()\n`), [2])
  })

  test('nur Dateien mit \'use server\' als erster Anweisung (nicht Seiten mit eingebetteter Action), Kommentare davor erlaubt', () => {
    const abfrage = `const { data } = await s.from('t').select('id').maybeSingle()\n`
    assert.deepEqual(zeilen(abfrage), [])
    assert.deepEqual(zeilen(`export default async function Seite() {\n  async function a() { ${US}; }\n  ${abfrage}}\n`), [])
    assert.deepEqual(zeilen(`// Kopf\n/* Block */\n${US}\n${abfrage}`), [4])
    assert.deepEqual(zeilen(`"use server"\n${abfrage}`), [2])
  })

  test('Ausnahme mit Begründung ≥ 15 Zeichen (dieselbe Zeile oder bis zu vier davor); zu kurz → Fund', () => {
    const abfrage = `const { data } = await s.from('t').select('id').maybeSingle()`
    assert.deepEqual(pruefeText(`${US}\n// ${M}: nur der Name für die Meldung\n// eslint-disable-next-line x\n${abfrage}\n`), { funde: [], ausnahmen: 1, geprueft: 0 })
    assert.deepEqual(pruefeText(`${US}\n${abfrage}   // ${M}: nur der Name für die Meldung\n`).ausnahmen, 1)
    assert.match(pruefeText(`${US}\n// ${M}: kurz\n${abfrage}\n`).funde[0].text, /ohne ausreichende Begründung/)
    assert.deepEqual(zeilen(`${US}\n// ${M}: nur der Name für die Meldung\n\n\n\n\n${abfrage}\n`), [7], 'mehr als vier Zeilen davor zählt nicht')
  })

  test('das Projekt ist sauber', () => {
    const e = pruefeWurzel(ROOT)
    assert.deepEqual(e.funde, [])
    assert.ok(e.dateien > 40 && e.geprueft > 100, `${e.dateien} Dateien, ${e.geprueft} geprüft`)
  })
})

// ── Regression: E&A ──────────────────────────────────────────────────────────

const modul = code => 'data:text/javascript,' + encodeURIComponent(code)
DOPPEL['@/lib/auth/seitenBetrieb'] = modul('export const pruefeSeitenBetrieb = async () => {}')
DOPPEL['@/lib/auth/sperren'] = modul('export const pruefeSchreibzugriff = async () => {}')
DOPPEL['@/lib/auth/modul'] = modul('export const pruefeModul = async () => {}')
DOPPEL['next/navigation'] = modul("export const redirect = u => { throw Object.assign(new Error('NEXT_REDIRECT'), { ziel: u }) }")
hooksRegistrieren()
const ea = hooksMoeglich ? await laden('app/(dashboard)/buchhaltung/actions.ts') : null

const T = '00000000-0000-4000-8000-000000000001'
const KAT = '00000000-0000-4000-8000-0000000000c1'
const VP = '00000000-0000-4000-8000-0000000000a1'
const fehlerBei = (tabelle, art = 'select') => e => (e.tabelle === tabelle && e.art === art ? { error: { message: 'Zeitüberschreitung' } } : null)
const formular = f => { const fd = new FormData(); for (const [k, w] of Object.entries(f)) fd.set(k, w); return fd }

beforeEach(() => { globalThis.__membership = { tenantId: T, role: 'tenant_admin', schreibmodule: [] } })

describe('KAN-251: E&A wertet Lesefehler aus', nurMitHooks, () => {
  test('Ausgabe mit Kategorie: Lesefehler beim abzugsfähigen Anteil bricht ab – keine Buchung mit 100 %', async () => {
    const d = datenbank({ ea_kategorien: [{ id: KAT, tenant_id: null, abzugsfaehig_pct: 50 }], ea_transaktionen: [] },
      { vorher: fehlerBei('ea_kategorien'), rpc: () => ({ data: [{ offen: true }], error: null }) })
    globalThis.__serverFake = d
    await assert.rejects(
      ea.createEaTransaktion(formular({ typ: 'ausgabe', datum: '2026-10-08', beschreibung: 'Diesel', betrag_netto: '100', ust_satz: '20', kategorie_id: KAT })),
      /Abzugsfähiger Anteil der Kategorie konnte nicht geladen werden/)
    assert.equal(d.tabellen.ea_transaktionen.length, 0)
  })

  test('Einnahme zum Verkauf: Lesefehler der Einstellungen ist ein Fehler, nicht „E&A-Modul aus“', async () => {
    const d = datenbank({ tenant_einstellungen: [{ tenant_id: T, modul_ea: true }] }, { vorher: fehlerBei('tenant_einstellungen') })
    globalThis.__serverFake = d
    const r = await ea.syncEaEinnahmeFuerVerkauf(VP)
    assert.equal(r.ok, false)
    assert.equal(r.skipped, undefined)
    assert.match(r.error, /Betriebseinstellungen konnten nicht geladen werden/)
  })

  test('E&A-Modul wirklich aus: weiterhin still übersprungen', async () => {
    globalThis.__serverFake = datenbank({ tenant_einstellungen: [{ tenant_id: T, modul_ea: false }] })
    assert.deepEqual(await ea.syncEaEinnahmeFuerVerkauf(VP), { ok: true, skipped: true })
  })
})
