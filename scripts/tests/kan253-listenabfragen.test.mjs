// KAN-253 (09.10.2026): Listenabfragen in Server Actions und Routen werten ihren Fehler aus – ohne error wurde aus einem
// Datenbankfehler eine leere Liste. Hier der Wächter (Listen, Promise.all, Ausnahmen) und eine Regression mit Folgen:
// „als bezahlt markieren“ buchte bei einem Lesefehler der bisherigen Zahlungen die volle Zahlung ein zweites Mal
// (ohne den Fix rot).
//
// Aufruf:  npm run -s test:csv   (Node ≥ 22.15 wegen module.registerHooks)

import { test, describe, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { DOPPEL, hooksRegistrieren, laden, nurMitHooks, hooksMoeglich, datenbank } from './buchung-attrappe.mjs'

const HIER = path.dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)
const { pruefeText } = require(path.join(HIER, '..', 'check-einzelabfrage.js'))

const US = "'use " + "server'"
const M = 'abfrage-ohne-' + 'fehler'
const funde = t => pruefeText(`${US}\n${t}`).funde.map(f => [f.zeile, /leere Liste/.test(f.text) ? 'L' : /Zählabfrage/.test(f.text) ? 'Z' : 'E'])

describe('check-einzelabfrage: Listen und Promise.all', () => {
  test('Liste ohne error → Fund; mit error → geprüft; alle()/inBloecken()/rpc/Abfrage-Variable ebenso', () => {
    assert.deepEqual(funde(`const { data } = await s.from('t').select('id').eq('a', 1)\n`), [[2, 'L']])
    assert.deepEqual(funde(`const { data, error } = await s.from('t').select('id')\n`), [])
    assert.deepEqual(funde(`const { data: x } = await alle(q.order('id'))\n`), [[2, 'L']])
    assert.deepEqual(funde(`const { data: x } = await inBloecken(ids, b => alle(q.in('id', b).order('id')))\n`), [[2, 'L']])
    assert.deepEqual(funde(`const { data: n } = await (s.rpc as any)('get_next_nr', { p: 1 })\n`), [[2, 'L']])
    assert.deepEqual(funde(`const { data } = await q.order('a').limit(5)\n`), [[2, 'L']])
    assert.deepEqual(funde(`const { data } = await s.storage.from('b').list('x')\n`), [[2, 'L']])
  })

  test('kein Supabase-Fehlerobjekt: auth, Stripe, fetch/json, Graph; { count } seit KAN-282 als Zählabfrage', () => {
    assert.deepEqual(funde(`const { data: { user } } = await supabase.auth.getUser()\nconst { data: { user: u } } = await (supabase.auth as any).getUser()\n`), [])
    assert.deepEqual(funde(`const { data } = await stripe.invoices.list({ customer: c })\nconst { data } = await (await fetch(u)).json()\nconst { value } = await graphGet(t, '/me')\n`), [])
    assert.deepEqual(funde(`const { count } = await s.from('t').select('id', { count: 'exact', head: true })\n`), [[2, 'Z']])
  })

  test('Promise.all: jedes Element mit data braucht error – je Element ein Fund, Zeile des Elements', () => {
    const t = `const [\n  { data: a },\n  { data: b, error: bErr },\n  { count },\n] = await Promise.all([x, y, z])\n`
    assert.deepEqual(funde(t), [[3, 'L'], [5, 'Z']])   // { count } seit Sweep 90 (KAN-282) ebenfalls
    assert.deepEqual(funde(`const [{ data: a }, { data: b }] = await Promise.all([x, y])\n`), [[2, 'L'], [2, 'L']])
    assert.deepEqual(funde(`const [a, b] = await Promise.all([x, y])\nconst [{ data: c }] = await Promise.allSettled([x])\n`), [], 'nur Destrukturierung mit data aus Promise.all')
  })

  test('Ausnahme „abfrage-ohne-fehler“ (einzelabfrage-ohne-fehler gilt ebenso), Begründung ≥ 15 Zeichen', () => {
    assert.deepEqual(pruefeText(`${US}\n// ${M}: nur ein Hinweis, nichts wird gesperrt\nconst { data } = await s.from('t').select('id')\n`).ausnahmen, 1)
    assert.deepEqual(pruefeText(`${US}\n// einzel${M}: nur ein Hinweis, nichts wird gesperrt\nconst { data } = await s.from('t').select('id')\n`).ausnahmen, 1)
    assert.match(pruefeText(`${US}\n// ${M}: kurz\nconst { data } = await s.from('t').select('id')\n`).funde[0].text, /ohne ausreichende Begründung/)
  })
})

// ── Regression: Verkauf „als bezahlt markieren“ ──────────────────────────────

const modul = code => 'data:text/javascript,' + encodeURIComponent(code)
DOPPEL['@/lib/auth/seitenBetrieb'] = modul('export const pruefeSeitenBetrieb = async () => {}')
DOPPEL['@/lib/auth/sperren'] = modul('export const pruefeSchreibzugriff = async () => {}')
DOPPEL['@/app/(dashboard)/buchhaltung/actions'] = modul('export const syncEaEinnahmeFuerVerkauf = async () => ({ ok: true })')
hooksRegistrieren()
const v = hooksMoeglich ? await laden('app/(dashboard)/weinhandel/verkauf/actions.ts') : null

const T = '00000000-0000-4000-8000-000000000001'
const P1 = '00000000-0000-4000-8000-0000000000b1'
const daten = () => ({
  verkaufsposten: [{ id: P1, tenant_id: T, rechnungsnummer: 'RE-1', storniert: false, bezahlt: false, rechnung_id: null }],
  verkauf_positionen: [{ id: 'vp1', tenant_id: T, verkaufsposten_id: P1, preis_brutto: 12, menge: 10, rabatt_pct: 0, sonderrabatt_pct: 0 }],
  zahlungen: [{ id: 'z1', tenant_id: T, verkaufsposten_id: P1, betrag: 120, storniert_am: null }],
})

beforeEach(() => { globalThis.__membership = { tenantId: T, role: 'tenant_admin', schreibmodule: [] } })

describe('KAN-253: als bezahlt markieren liest die bisherigen Zahlungen sicher', nurMitHooks, () => {
  test('Lesefehler der Zahlungen → Abbruch, keine zweite Zahlung', async () => {
    const d = datenbank(daten(), { vorher: e => (e.tabelle === 'zahlungen' && e.art === 'select' ? { error: { message: 'Zeitüberschreitung' } } : null) })
    globalThis.__serverFake = d
    await assert.rejects(v.markiereAlsBezahlt(P1), /Bisherige Zahlungen konnten nicht geladen werden/)
    assert.equal(d.tabellen.zahlungen.length, 1, 'keine zweite Zahlung')
  })

  test('ohne Fehler: voll bezahlt → keine weitere Zahlung', async () => {
    const d = datenbank(daten())
    globalThis.__serverFake = d
    await v.markiereAlsBezahlt(P1)
    assert.equal(d.tabellen.zahlungen.length, 1)
  })
})
