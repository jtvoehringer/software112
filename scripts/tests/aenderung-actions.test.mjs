// Ändern meldet nur, was wirklich geändert ist (KAN-248, 09.10.2026): Ein UPDATE, das die RLS nicht zulässt oder dessen
// Zeile fehlt (inzwischen gelöscht, anderer Betrieb), ändert still 0 Zeilen. Vorher meldete die App „gespeichert“ –
// jetzt NICHT_GESPEICHERT. Der Wächter scripts/check-loeschen.js hält das für neue .update()-Stellen fest.
//
// Aufruf:  npm run -s test:csv   (Node ≥ 22.15 wegen module.registerHooks)

import { test, describe, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { DOPPEL, hooksRegistrieren, laden, nurMitHooks, hooksMoeglich, datenbank } from './buchung-attrappe.mjs'

const modul = code => 'data:text/javascript,' + encodeURIComponent(code)
DOPPEL['@/lib/auth/seitenBetrieb'] = modul('export const pruefeSeitenBetrieb = async () => {}; export const seitenBetriebFehler = async () => null')
DOPPEL['@/lib/auth/sperren'] = modul('export const pruefeSchreibzugriff = async () => {}; export const schreibSperreFehler = async () => null')
DOPPEL['@/lib/auth/modul'] = modul('export const pruefeModul = async () => {}; export const hatModul = async () => true')
DOPPEL['next/navigation'] = modul("export const redirect = u => { throw Object.assign(new Error('NEXT_REDIRECT'), { ziel: u }) }")
hooksRegistrieren()

const lade = rel => hooksMoeglich ? laden(`${rel}.ts`) : null
const crm = await lade('app/(dashboard)/crm/actions')
const lager = await lade('app/(dashboard)/behandlungen/lager/actions')
const fristen = await lade('app/(dashboard)/dashboard/fristen/actions')
const { NICHT_GESPEICHERT } = hooksMoeglich ? await lade('lib/fehler') : {}

const T = '00000000-0000-4000-8000-000000000001'
const X = '00000000-0000-4000-8000-0000000000a1'
const formular = (f = {}) => { const fd = new FormData(); for (const [k, w] of Object.entries(f)) fd.set(k, w); return fd }
// rlsAendern: false → die RLS lässt das UPDATE nicht zu (0 Zeilen, kein Fehler – wie PostgREST)
const db = (tabellen, rlsAendern = true) => {
  const d = datenbank(tabellen, { rls: e => rlsAendern || e.art !== 'update', rpc: () => ({ data: null, error: null }) })
  globalThis.__serverFake = d
  return d
}

beforeEach(() => { globalThis.__membership = { tenantId: T, role: 'tenant_admin', schreibmodule: null } })

describe('Ändern: 0 Zeilen → „Nicht gespeichert“ statt Erfolg', nurMitHooks, () => {
  test('Firma bearbeiten (CRM): mit Recht gespeichert, still abgelehnt → Meldung, Name bleibt', async () => {
    let d = db({ firmen: [{ id: X, tenant_id: T, name: 'Alt' }] })
    assert.deepEqual(await crm.updateFirma(X, formular({ name: 'Neu' })), {})
    assert.equal(d.tabellen.firmen[0].name, 'Neu')
    d = db({ firmen: [{ id: X, tenant_id: T, name: 'Alt' }] }, false)
    assert.deepEqual(await crm.updateFirma(X, formular({ name: 'Neu' })), { error: NICHT_GESPEICHERT })
    assert.equal(d.tabellen.firmen[0].name, 'Alt')
  })

  test('Aktivität erledigt setzen: fehlende Zeile (inzwischen gelöscht) → Meldung', async () => {
    db({ aktivitaeten: [] })
    await assert.rejects(crm.toggleAktivitaetErledigt(X, true), e => e.message === NICHT_GESPEICHERT)
  })

  test('Pflanzenschutzmittel deaktivieren und Frist wiedereröffnen: still abgelehnt → Meldung', async () => {
    db({ pflanzenschutzmittel: [{ id: X, tenant_id: T, aktiv: true }], fristen: [{ id: X, tenant_id: T, status: 'erledigt' }] }, false)
    await assert.rejects(lager.deactivatePSM(X), e => e.message === NICHT_GESPEICHERT)
    await assert.rejects(fristen.fristWiedereroeffnen(X), e => e.message === NICHT_GESPEICHERT)
  })
})
