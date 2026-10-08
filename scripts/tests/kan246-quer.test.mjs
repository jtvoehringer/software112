// KAN-246 (09.10.2026): Querschnitt „Fehler, die nie ankommen“ – Schreibzugriffe, deren Ergebnis verworfen bzw. nur
// protokolliert wurde, während die Antwort Erfolg meldete:
//  - BMD-Übergabe: Protokoll bzw. Markierung „übergeben“ gescheitert → Seite meldete „im Protokoll vermerkt“, beim
//    nächsten Export mit „nur neue“ kamen dieselben Belege doppelt nach BMD
//  - Weinexport: Positionen gescheitert → Auftrag ohne Positionen, Antwort ok
//
// Aufruf:  npm run -s test:csv   (Node ≥ 22.15 wegen module.registerHooks)

import { test, describe, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { DOPPEL, hooksRegistrieren, laden, nurMitHooks, hooksMoeglich, datenbank } from './buchung-attrappe.mjs'

const modul = code => 'data:text/javascript,' + encodeURIComponent(code)
DOPPEL['next/server'] = modul(`
  export class NextResponse {
    constructor(body, init) { this.body = body; this.status = init?.status ?? 200; this.headers = new Headers(init?.headers ?? {}) }
    static json(body, init) { const r = new NextResponse(body, init); return r }
  }
  export class NextRequest {}`)
DOPPEL['@/lib/api/zweiFaktor'] = modul('export const pruefeZweiFaktor = async () => null')
DOPPEL['@/lib/auth/modul'] = modul('export const modulKonflikt = async () => null; export const hatModul = async () => true; export const pruefeModul = async () => {}')
DOPPEL['@/lib/auth/seitenBetrieb'] = modul('export const seitenBetriebKonflikt = async () => null')
DOPPEL['@/lib/auth/sperren'] = modul('export const schreibSperreKonflikt = async () => null; export const schreibSperre = async () => null')
DOPPEL['@/lib/system/ereignis'] = modul('export const ereignisMelden = async e => { (globalThis.__ereignisse ??= []).push(e) }')
hooksRegistrieren()

const bmd = hooksMoeglich ? await laden('app/api/export/bmd/route.ts') : null
const weinexport = hooksMoeglich ? await laden('app/api/weinexport/route.ts') : null

const T = '00000000-0000-4000-8000-000000000001'
const E1 = '00000000-0000-4000-8000-0000000000e1'
const anfrage = (params, body) => ({ nextUrl: { searchParams: new URLSearchParams(params) }, json: async () => body })
function db(tabellen, vorher = () => null) {
  const d = datenbank(tabellen, { vorher, rpc: () => ({ data: 'EX-2026-1', error: null }) })
  globalThis.__serverFake = d
  globalThis.__adminFake = d
  return d
}
const ausgabe = () => ({
  id: E1, tenant_id: T, typ: 'ausgabe', datum: '2026-09-15', beschreibung: 'Flaschen', betrag_brutto: 120, betrag_netto: 100,
  ust_satz: 20, ust_betrag: 20, bank_ref: null, bmd_export_id: null, storno_von_id: null,
  kategorie: { name: 'Material', konto_nr: '5000' }, firma: null, ea_belege: [],
})
const PARAMS = { art: 'eingangsbelege', von: '2026-09-01', bis: '2026-09-30', nurNeue: '1', protokollieren: '1' }

beforeEach(() => {
  globalThis.__membership = { tenantId: T, role: 'tenant_admin', schreibmodule: null }
  globalThis.__ereignisse = []
})

describe('BMD-Übergabe: Protokoll und Markierung', nurMitHooks, () => {
  test('alles gut: protokolliert, Beleg markiert, keine Fehler-Kopfzeile', async () => {
    const d = db({ ea_transaktionen: [ausgabe()], buchhaltung_export_protokoll: [], buchhaltung_kontenmapping: [] })
    const r = await bmd.GET(anfrage(PARAMS))
    assert.equal(r.status, 200)
    assert.equal(r.headers.get('X-BMD-Protokolliert'), '1')
    assert.equal(r.headers.get('X-BMD-Markierung-Fehler'), null)
    assert.ok(d.tabellen.ea_transaktionen[0].bmd_export_id)
  })

  test('Markierung scheitert → Fehler-Kopfzeile (vorher nur protokolliert, Seite meldete Erfolg)', async () => {
    db({ ea_transaktionen: [ausgabe()], buchhaltung_export_protokoll: [], buchhaltung_kontenmapping: [] },
      e => e.tabelle === 'ea_transaktionen' && e.art === 'update' ? { error: { message: 'gesperrt' } } : null)
    const r = await bmd.GET(anfrage(PARAMS))
    assert.equal(r.status, 200)   // die Datei kommt trotzdem
    assert.match(decodeURIComponent(r.headers.get('X-BMD-Markierung-Fehler') ?? ''), /E&A-Buchungen: gesperrt/)
  })

  test('Protokoll scheitert → nicht „protokolliert“ und Fehler-Kopfzeile, nichts markiert', async () => {
    const d = db({ ea_transaktionen: [ausgabe()], buchhaltung_export_protokoll: [], buchhaltung_kontenmapping: [] },
      e => e.tabelle === 'buchhaltung_export_protokoll' && e.art === 'insert' ? { error: { message: 'RLS' } } : null)
    const r = await bmd.GET(anfrage(PARAMS))
    assert.equal(r.headers.get('X-BMD-Protokolliert'), '0')
    assert.match(decodeURIComponent(r.headers.get('X-BMD-Markierung-Fehler') ?? ''), /Protokoll: RLS/)
    assert.equal(d.tabellen.ea_transaktionen[0].bmd_export_id, null)
  })
})

describe('Weinexport: Positionen gescheitert → kein „ok“', nurMitHooks, () => {
  test('Fehler mit Auftrags-ID statt ok', async () => {
    globalThis.__membership = { tenantId: T, role: 'winzer', schreibmodule: ['warenwirtschaft'] }
    db({ exportauftraege: [], exportauftrag_positionen: [], export_dokumente: [] },
      e => e.tabelle === 'exportauftrag_positionen' ? { error: { message: 'Füllung fremd' } } : null)
    const r = await weinexport.POST(anfrage({}, { datum: '2026-10-09', positionen: [{ beschreibung: 'GV', menge: '6' }] }))
    assert.equal(r.status, 500)
    assert.match(r.body.fehler, /Positionen konnten aber nicht gespeichert werden: Füllung fremd/)
    assert.ok(r.body.id)
  })
})
