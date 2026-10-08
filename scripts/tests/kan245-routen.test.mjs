// KAN-245 (09.10.2026): schreibende Route Handler prüfen das Schreibrecht wie die RLS – Kostenrechnung (Auswertungen,
// Rieden oder Kellerbuch), SumUp-Checkout (Warenwirtschaft), CRM-Dokumente (CRM oder Warenwirtschaft). Dabei behoben in
// /api/kostenrechnung: Fehler bei Kostenstellen/-arten und Aufteilungen kamen nie an (Antwort immer ok), Ändern ohne
// getroffene Zeile meldete ok, die Behälter-Aufteilung von Kellerkosten (bh_split) wurde still verworfen.
//
// Aufruf:  npm run -s test:csv   (Node ≥ 22.15 wegen module.registerHooks)

import { test, describe, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { DOPPEL, hooksRegistrieren, laden, nurMitHooks, hooksMoeglich, datenbank } from './buchung-attrappe.mjs'

const modul = code => 'data:text/javascript,' + encodeURIComponent(code)
DOPPEL['next/server'] = modul('export class NextResponse { static json(body, init) { return { status: init?.status ?? 200, body } } }; export class NextRequest {}')
DOPPEL['@/lib/api/zweiFaktor'] = modul('export const pruefeZweiFaktor = async () => null')
DOPPEL['@/lib/auth/modul'] = modul('export const modulKonflikt = async () => null; export const pruefeModul = async () => {}; export const hatModul = async () => true')
DOPPEL['@/lib/auth/seitenBetrieb'] = modul('export const seitenBetriebKonflikt = async () => null; export const pruefeSeitenBetrieb = async () => {}')
DOPPEL['@/lib/auth/sperren'] = modul('export const schreibSperreKonflikt = async () => null; export const pruefeSchreibzugriff = async () => {}')
DOPPEL['@/lib/system/ereignis'] = modul('export const ereignisMelden = async () => {}')
hooksRegistrieren()

const kosten = hooksMoeglich ? await laden('app/api/kostenrechnung/route.ts') : null
const sumup = hooksMoeglich ? await laden('app/api/sumup/checkout/route.ts') : null
const dokument = hooksMoeglich ? await laden('app/api/crm/aktivitaet/[id]/dokument/[dok_id]/route.ts') : null

const T = '00000000-0000-4000-8000-000000000001'
const X = '00000000-0000-4000-8000-0000000000a1'
const B1 = '00000000-0000-4000-8000-0000000000b1', B2 = '00000000-0000-4000-8000-0000000000b2'
const als = (role, schreibmodule = null) => { globalThis.__membership = { tenantId: T, role, schreibmodule } }
const anfrage = body => ({ json: async () => body, nextUrl: { searchParams: new URLSearchParams() } })
function db(tabellen = {}, opt = {}) {
  const d = datenbank({ kosteneintraege: [], kosteneintrag_weingaerten: [], kosteneintrag_behaelter: [], kostenstellen: [], kostenarten: [], sumup_checkouts: [], ...tabellen },
    { rpc: () => ({ data: 'KE-1', error: null }), ...opt })
  globalThis.__serverFake = d
  globalThis.__adminFake = d
  return d
}

beforeEach(() => als('tenant_admin'))

describe('Kostenrechnung: Recht wie RLS', nurMitHooks, () => {
  test('Leser und Mitarbeiter nur mit CRM: 403 vor jedem Zugriff', async () => {
    for (const [rolle, mods] of [['leser', []], ['winzer', ['crm', 'warenwirtschaft']]]) {
      als(rolle, mods)
      const d = db()
      const r = await kosten.POST(anfrage({ action: 'ks_save', name: 'Traktor' }))
      assert.equal(r.status, 403, rolle)
      assert.match(r.body.fehler, /Freigabe Auswertungen, Rieden oder Kellerbuch/)
      assert.deepEqual(d.aufrufe, [], rolle)
    }
  })

  test('Mitarbeiter mit Kellerbuch: Kellerkosten mit Behälter-Aufteilung werden gespeichert (vorher verworfen)', async () => {
    als('winzer', ['kellerbuch'])
    const d = db()
    const r = await kosten.POST(anfrage({ action: 'eintrag', datum: '2026-10-09', betrag: 100, objekt_typ: 'keller',
      wg_split: [], bh_split: [{ behaelter_id: B1, anteil_pct: 60 }, { behaelter_id: B2, anteil_pct: 40 }] }))
    assert.deepEqual(r.body, { ok: true })
    assert.deepEqual(d.tabellen.kosteneintrag_behaelter.map(z => [z.behaelter_id, z.betrag_anteil]), [[B1, 60], [B2, 40]])
    assert.equal(d.tabellen.kosteneintrag_weingaerten.length, 0)
  })
})

describe('Kostenrechnung: Fehler kommen an', nurMitHooks, () => {
  test('Kostenstelle speichern: Datenbankfehler → 500 mit Meldung (vorher ok)', async () => {
    db({}, { vorher: e => e.tabelle === 'kostenstellen' ? { error: { message: 'kaputt' } } : null })
    const r = await kosten.POST(anfrage({ action: 'ks_save', name: 'Traktor' }))
    assert.deepEqual([r.status, r.body.fehler], [500, 'kaputt'])
  })

  test('Kostenart deaktivieren bzw. Eintrag ändern ohne getroffene Zeile → 404', async () => {
    db()
    assert.equal((await kosten.POST(anfrage({ action: 'ka_delete', id: X }))).status, 404)
    assert.equal((await kosten.POST(anfrage({ action: 'aktualisieren', id: X, datum: '2026-10-09', betrag: 5 }))).status, 404)
  })

  test('Name fehlt → 400 ohne Zugriff', async () => {
    const d = db()
    assert.equal((await kosten.POST(anfrage({ action: 'ka_save', name: '  ' }))).status, 400)
    assert.deepEqual(d.aufrufe, [])
  })

  test('neuer Eintrag, Aufteilung scheitert → Eintrag zurückgenommen, Meldung', async () => {
    const d = db({}, { vorher: e => e.tabelle === 'kosteneintrag_weingaerten' && e.art === 'insert' ? { error: { message: 'Ried fremd' } } : null })
    const r = await kosten.POST(anfrage({ action: 'eintrag', datum: '2026-10-09', betrag: 10, objekt_typ: 'weingarten', wg_split: [{ weingarten_id: X }] }))
    assert.equal(r.status, 500)
    assert.match(r.body.fehler, /Ried fremd – nichts gespeichert/)
    assert.equal(d.tabellen.kosteneintraege.length, 0)
  })
})

describe('SumUp-Checkout und CRM-Dokumente: Recht vor Schlüssel bzw. Datei', nurMitHooks, () => {
  test('SumUp ohne Warenwirtschaft: 403, kein Zugriff auf Einstellungen (API-Schlüssel)', async () => {
    als('winzer', ['crm', 'kellerbuch'])
    const d = db()
    const r = await sumup.POST(anfrage({ betrag: 10 }))
    assert.equal(r.status, 403)
    assert.match(r.body.error, /Freigabe Warenwirtschaft/)
    assert.deepEqual(d.aufrufe, [])
  })

  test('Dokument löschen ohne CRM/Warenwirtschaft: 403, Datei bleibt', async () => {
    als('winzer', ['rieden'])
    const d = db({ aktivitaet_dokumente: [{ id: X, tenant_id: T, storage_pfad: 'a/b.pdf' }] })
    d.entfernt = []
    d.storage = { from: () => ({ remove: async p => { d.entfernt.push(...p); return { error: null } } }) }
    d.auth.getSession = async () => ({ data: { session: { user: { id: 'benutzer-1' } } } })
    const r = await dokument.DELETE({}, { params: Promise.resolve({ id: X, dok_id: X }) })
    assert.equal(r.status, 403)
    assert.deepEqual([d.tabellen.aktivitaet_dokumente.length, d.entfernt], [1, []])
  })
})
