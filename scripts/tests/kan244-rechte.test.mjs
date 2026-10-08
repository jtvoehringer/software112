// KAN-244 (09.10.2026): Schreibrecht vorab wie RLS/RPC auch in CRM, Erntemeldung/Lese und Eröffnungsbestand – und
// Rechteprüfungen in Server Actions und Route Handlern nur mit der Mitgliedschaft, nie mit dem Rollennamen allein.
//
// canWrite('winzer', modul) liest die Schreibmodule aus einem Request-Speicher (React cache()). Außerhalb des
// React-Renderns – in Route Handlern und Server Actions – ist cache() kein Request-Cache: der Speicher ist bei jedem
// Aufruf leer und canWrite(rolle) ließ jeden Mitarbeiter durch (z. B. Rechnung per Route senden ohne Warenwirtschaft).
//
// Aufruf:  npm run -s test:csv   (Node ≥ 22.15 wegen module.registerHooks)

import { test, describe, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { DOPPEL, hooksRegistrieren, laden, nurMitHooks, hooksMoeglich, datenbank, SRC } from './buchung-attrappe.mjs'

const modul = code => 'data:text/javascript,' + encodeURIComponent(code)
DOPPEL['@/lib/auth/seitenBetrieb'] = modul('export const pruefeSeitenBetrieb = async () => {}; export const seitenBetriebFehler = async () => null')
DOPPEL['@/lib/auth/sperren'] = modul('export const pruefeSchreibzugriff = async () => {}; export const schreibSperreFehler = async () => null')
DOPPEL['@/lib/auth/modul'] = modul('export const pruefeModul = async () => {}; export const hatModul = async () => true')
DOPPEL['next/navigation'] = modul("export const redirect = u => { throw Object.assign(new Error('NEXT_REDIRECT'), { ziel: u }) }")
// .tsx (React-Komponenten) lädt node:test nicht – nur die Liste wird gebraucht (über lib/behoerden/flaechenverzeichnis)
DOPPEL['@/lib/wein/grundstueckStatus'] = modul('export const NUTZART_OPTIONS = []; export const STATUS_OPTIONS = []; export const NutzungBadge = () => null; export const StatusBadge = () => null')
hooksRegistrieren()

const lade = rel => hooksMoeglich ? laden(`app/(dashboard)/${rel}.ts`) : null
const crm = await lade('crm/actions')
const ernte = await lade('erntemeldung/actions')
const gebinde = await lade('kellerbuch/gebinde-actions')

const T = '00000000-0000-4000-8000-000000000001'
const X = '00000000-0000-4000-8000-0000000000a1'
const als = (role, schreibmodule = null) => { globalThis.__membership = { tenantId: T, role, schreibmodule } }
const fd = (f = {}) => { const d = new FormData(); for (const [k, w] of Object.entries(f)) d.set(k, w); return d }
const leer = () => { const d = datenbank({}, { rpc: () => ({ data: null, error: null }) }); globalThis.__serverFake = d; return d }
// Wurf oder { error } – je nach Action
const meldung = async p => { try { const r = await p; return r?.error ?? '' } catch (e) { return e.message } }

beforeEach(() => als('tenant_admin'))

describe('CRM: Freigabe CRM, Aktivitäten CRM oder Warenwirtschaft', nurMitHooks, () => {
  const crmActions = () => [() => crm.createKontakt(fd({ nachname: 'Huber' })), () => crm.updateFirma(X, fd({ name: 'Gastro' })),
    () => crm.createPipelineEintrag(fd({ titel: 'Angebot' })), () => crm.deletePipelineEintrag(X), () => crm.dubletteIgnorieren('k1|k2')]
  const aktivitaeten = () => [() => crm.createAktivitaet(fd({ titel: 'Anruf' })), () => crm.deleteAktivitaet(X), () => crm.toggleAktivitaetErledigt(X, true)]

  test('Leser und Mitarbeiter ohne CRM: Meldung vor jedem Datenbankzugriff', async () => {
    for (const [rolle, mods] of [['leser', []], ['winzer', ['kellerbuch', 'rieden']]]) {
      als(rolle, mods)
      const d = leer()
      for (const f of crmActions()) assert.match(await meldung(f()), /Freigabe CRM nötig/, rolle)
      for (const f of aktivitaeten()) assert.match(await meldung(f()), /Freigabe CRM oder Warenwirtschaft/, rolle)
      assert.deepEqual(d.aufrufe, [], rolle)
    }
  })

  test('Warenwirtschaft ohne CRM: Aktivitäten ja (Verkaufsnotizen), Kontakte nein', async () => {
    als('winzer', ['warenwirtschaft'])
    leer()
    assert.doesNotMatch(await meldung(crm.createAktivitaet(fd({ titel: 'Anruf' }))), /Freigabe/)
    assert.match(await meldung(crm.createKontakt(fd({ nachname: 'Huber' }))), /Freigabe CRM nötig/)
  })
})

describe('Erntemeldung/Lese: Rieden oder Kellerbuch, Traubenverkauf Rieden oder Warenwirtschaft, AMA Rieden', nurMitHooks, () => {
  test('ohne passende Freigabe: Meldung mit den nötigen Modulen, kein Datenbankzugriff', async () => {
    als('winzer', ['crm', 'ea'])
    const d = leer()
    assert.match(await meldung(ernte.createJahrgang(fd({ jahrgang: '2026' }))), /Freigabe Rieden oder Kellerbuch nötig/)
    assert.match(await meldung(ernte.stornoErnteParzelle(X, X, 'Falsch erfasst bei der Lese')), /Freigabe Rieden oder Kellerbuch nötig/)
    assert.match(await meldung(ernte.createTraubenverkauf(fd())), /Freigabe Rieden oder Warenwirtschaft nötig/)
    assert.match(await meldung(ernte.amaStatusSetzen(X, 'eingereicht')), /Freigabe Rieden nötig/)
    assert.deepEqual(d.aufrufe, [])
  })

  test('Kellerbuch ohne Rieden: AMA-Meldung abgelehnt (RPC verlangt Rieden), Lese erlaubt', async () => {
    als('winzer', ['kellerbuch'])
    leer()
    assert.match(await meldung(ernte.createOrUpdateAMAMeldung(X, fd())), /Freigabe Rieden nötig/)
    assert.doesNotMatch(await meldung(ernte.createJahrgang(fd({ jahrgang: '2026' }))), /Freigabe/)
  })

  test('Jahrgang löschen nur Betriebsleitung – vorab, ohne Prüfabfragen', async () => {
    als('winzer', ['rieden', 'kellerbuch'])
    const d = leer()
    assert.match(await meldung(ernte.deleteJahrgang(X)), /Einen Jahrgang löschen dürfen nur Betriebsleiter/)
    assert.deepEqual(d.aufrufe, [])
  })
})

describe('Eröffnungsbestand aus Import: Kellerbuch oder Rieden', nurMitHooks, () => {
  test('Mitarbeiter mit CRM: Meldung, kein Zugriff', async () => {
    als('winzer', ['crm'])
    const d = leer()
    assert.match(await meldung(gebinde.createEroeffnungsbestandVonImport(fd())), /Keine Schreibberechtigung für das Kellerbuch/)
    assert.deepEqual(d.aufrufe, [])
  })
})

describe('Rechteprüfung in Actions und Routen nur mit der Mitgliedschaft', () => {
  function dateien(dir, out = []) {
    for (const f of readdirSync(dir)) {
      const p = path.join(dir, f)
      if (statSync(p).isDirectory()) dateien(p, out)
      else if (/\.tsx?$/.test(f)) out.push(p)
    }
    return out
  }
  test('kein canWrite/canSeeAuswertungen(<…>.role bzw. role) in Server-Action-Dateien und Route Handlern', () => {
    const funde = []
    for (const p of dateien(SRC)) {
      const s = readFileSync(p, 'utf8')
      const istAction = /^\s*'use server'/m.test(s.slice(0, 400))
      if (!istAction && !/[\\/]route\.ts$/.test(p)) continue
      s.split('\n').forEach((z, i) => {
        if (/can(Write|SeeAuswertungen)\(\s*([a-zA-Z_]+\.)?(role|rolle)\s*[,)]/.test(z)) funde.push(`${path.relative(SRC, p)}:${i + 1}`)
      })
    }
    assert.deepEqual(funde, [], 'canWrite(membership, …) statt canWrite(membership.role, …) – der Rollenname allein kennt die Module nicht')
  })
})
