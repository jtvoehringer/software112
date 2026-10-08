// Löschen meldet nur, was wirklich gelöscht ist (KAN-243, 09.10.2026): Ein DELETE, das die RLS nicht zulässt, löscht still
// 0 Zeilen. Vorher meldete die App trotzdem Erfolg – Kellerplan als Mitarbeiter (Weiterleitung, Plan blieb), Beleg
// verwerfen (Datei schon entfernt, Zeile blieb) u. a. Der Wächter scripts/check-loeschen.js hält das für neue Stellen fest.
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

const lade = rel => hooksMoeglich ? laden(`app/(dashboard)/${rel}/actions.ts`) : null
const plan = await lade('kellerbuch/kellerplan')
const keller = await lade('kellerbuch')
const ea = await lade('buchhaltung')
const crm = await lade('crm')
const fristen = await lade('dashboard/fristen')
const wg = await lade('weingarten')

const T = '00000000-0000-4000-8000-000000000001'
const X = '00000000-0000-4000-8000-0000000000a1'
const als = (role, schreibmodule = null) => { globalThis.__membership = { tenantId: T, role, schreibmodule } }
const zeile = (extra = {}) => ({ id: X, tenant_id: T, ...extra })
// rlsLoeschen: false → die RLS lässt das DELETE nicht zu (0 Zeilen, kein Fehler – wie PostgREST)
function db(tabellen, { rlsLoeschen = true } = {}) {
  const d = datenbank(tabellen, { rls: e => rlsLoeschen || e.art !== 'delete', rpc: () => ({ data: [{ offen: true }], error: null }) })
  d.entfernt = []
  d.storage = { from: () => ({ remove: async pfade => { d.entfernt.push(...pfade); return { error: null } } }) }
  globalThis.__serverFake = d
  return d
}
const NICHT = /nicht gelöscht \(nicht gefunden oder keine Berechtigung\)/

beforeEach(() => als('tenant_admin'))

describe('Kellerplan und Gebinde: Löschen nur Betriebsleitung (wie Policy)', nurMitHooks, () => {
  test('Mitarbeiter mit Freigabe Kellerbuch: klare Meldung statt Weiterleitung, nichts gelöscht', async () => {
    als('winzer', ['kellerbuch'])
    const d = db({ kellerplaene: [zeile()], behaelter: [zeile()] })
    await assert.rejects(plan.deleteKellerplan(X), /Einen Kellerplan löschen darf nur die Betriebsleitung/)
    assert.match((await keller.deleteBehaelter(X)).error, /Ein Gebinde löschen darf nur die Betriebsleitung/)
    assert.deepEqual(d.aufrufe, [])
  })

  test('Betriebsleitung: Kellerplan weg und Weiterleitung; lehnt die RLS still ab → Fehler statt Weiterleitung', async () => {
    let d = db({ kellerplaene: [zeile()] })
    await assert.rejects(plan.deleteKellerplan(X), e => e.ziel === '/kellerbuch/kellerplan')
    assert.equal(d.tabellen.kellerplaene.length, 0)
    d = db({ kellerplaene: [zeile()] }, { rlsLoeschen: false })
    await assert.rejects(plan.deleteKellerplan(X), NICHT)
    assert.equal(d.tabellen.kellerplaene.length, 1)
  })
})

describe('Beleg verwerfen: Datei erst nach der Zeile entfernen', nurMitHooks, () => {
  test('RLS lehnt still ab → Fehler, die Datei bleibt', async () => {
    const d = db({ ea_belege: [zeile({ status: 'erkannt', storage_pfad: 'b/1.pdf' })] }, { rlsLoeschen: false })
    await assert.rejects(ea.verwerfeBeleg(X), /Der Beleg wurde nicht gelöscht/)
    assert.deepEqual([d.tabellen.ea_belege.length, d.entfernt], [1, []])
  })

  test('mit Recht: Zeile und Datei weg, danach Weiterleitung', async () => {
    const d = db({ ea_belege: [zeile({ status: 'erkannt', storage_pfad: 'b/1.pdf' })] })
    await assert.rejects(ea.verwerfeBeleg(X), e => e.ziel === '/buchhaltung/belege')
    assert.deepEqual([d.tabellen.ea_belege.length, d.entfernt], [0, ['b/1.pdf']])
  })
})

describe('weitere Löschungen melden still abgelehntes Löschen (0 Zeilen) als Fehler', nurMitHooks, () => {
  test('Aktivität, Pipeline-Eintrag, Frist', async () => {
    db({ aktivitaeten: [zeile()], pipeline_eintraege: [zeile()], fristen: [zeile()] }, { rlsLoeschen: false })
    await assert.rejects(crm.deleteAktivitaet(X), /Die Aktivität wurde nicht gelöscht/)
    await assert.rejects(crm.deletePipelineEintrag(X), /Der Eintrag wurde nicht gelöscht/)
    await assert.rejects(fristen.fristLoeschen(X), /Die Frist wurde nicht gelöscht/)
  })

  test('Ried mit mehreren Datensätzen: weniger gelöschte als übergebene → Fehler', async () => {
    const Y = '00000000-0000-4000-8000-0000000000a2'
    db({ weingarten: [zeile()], grundstuecke: [] })
    const r = await wg.deleteRied([X, Y])   // Y gibt es (in diesem Betrieb) nicht
    assert.match(r.error ?? '', /nicht \(vollständig\) gelöscht/)
  })
})
