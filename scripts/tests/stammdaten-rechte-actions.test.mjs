// Server Actions Betriebsmittel-Lager, Rieden (Lagen), eigene Weinbaugebiete, Rabattgruppen, Sonstige Produkte und
// Maßnahmen (STABILITAET.md, Lücke 4; KAN-242, 08.10.2026): jede schreibende Action prüft das Schreibrecht vorab wie
// die RLS der Tabelle (modul_insert/_update/_delete) – vorher bekam ein Leser oder Mitarbeiter ohne Freigabe eine
// technische Fehlermeldung. Dabei behoben: Löschen meldete „gelöscht“, obwohl die RLS still 0 Zeilen löschte
// (Ried als Mitarbeiter, Produkt ohne DELETE-Policy).
//
// Aufruf:  npm run -s test:csv   (Node ≥ 22.15 wegen module.registerHooks)

import { test, describe, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { DOPPEL, hooksRegistrieren, laden, nurMitHooks, hooksMoeglich, datenbank } from './buchung-attrappe.mjs'

const modul = code => 'data:text/javascript,' + encodeURIComponent(code)
DOPPEL['@/lib/auth/seitenBetrieb'] = modul('export const pruefeSeitenBetrieb = async () => {}; export const seitenBetriebFehler = async () => null')
DOPPEL['@/lib/auth/sperren'] = modul('export const pruefeSchreibzugriff = async () => {}; export const schreibSperreFehler = async () => null')
DOPPEL['@/lib/auth/modul'] = modul('export const pruefeModul = async () => {}; export const hatModul = async () => false')
hooksRegistrieren()

const lade = rel => hooksMoeglich ? laden(`app/(dashboard)/${rel}/actions.ts`) : null
const lager = await lade('behandlungen/lager')
const lagen = await lade('lagen')
const gebiete = await lade('weinbaugebiete')
const rabatt = await lade('weinhandel/rabattgruppen')
const produkte = await lade('weinhandel/sonstige-artikel')
const massnahmen = await lade('behandlungen')

const T = '00000000-0000-4000-8000-000000000001'
const X = '00000000-0000-4000-8000-0000000000a1'
const formular = (f = {}) => { const fd = new FormData(); for (const [k, w] of Object.entries(f)) fd.set(k, w); return fd }
const als = (role, schreibmodule = []) => { globalThis.__membership = { tenantId: T, role, schreibmodule } }
const db = (t = {}, opt = {}) => datenbank({
  lagen: [], weingarten: [], weinbaugebiete_custom: [], rabattgruppen: [], sonstige_artikel: [],
  pflanzenschutzmittel: [], duengemittel: [], saetze_massnahmen: [], psm_lager_bewegungen: [], behandlungen: [], ...t,
}, { rpc: () => ({ data: null, error: null }), ...opt })
// Ergebnis einer Action: Wurf oder { error } → Meldung, sonst ''
const meldung = async p => { try { const r = await p; return r?.error ?? '' } catch (e) { return e.message } }

beforeEach(() => als('tenant_admin'))

// Je Datei: Modul der RLS und alle schreibenden Actions (Aufruf mit minimalen Argumenten)
const FAELLE = [
  { name: 'Betriebsmittel-Lager', modul: 'rieden', text: /Freigabe Rieden/, actions: () => [
    lager.upsertLagerBewegung(formular()), lager.stornoLagerBewegung(X, 'Falsch erfasst bei Inventur'),
    lager.loescheLagerBewegung(X, 'Falsch erfasst bei Inventur'), lager.upsertDuengerBewegung(formular()),
    lager.stornoDuengerBewegung(X, 'Falsch erfasst bei Inventur'), lager.loescheDuengerBewegung(X, 'Falsch erfasst bei Inventur'),
    lager.upsertPSM(formular()), lager.deactivatePSM(X), lager.upsertDuengemittel(formular()), lager.deactivateDuengemittel(X),
    lager.upsertSatzMassnahme(formular()), lager.deactivateSatzMassnahme(X),
  ] },
  { name: 'Rieden (Lagen)', modul: 'rieden', text: /Freigabe Rieden/, actions: () => [
    lagen.createLage(formular({ name: 'Kirchberg' })), lagen.updateLage(X, formular({ name: 'Kirchberg' })),
    lagen.deleteLage(X), lagen.assignWeingartenToLage(X, null),
  ] },
  { name: 'Eigene Weinbaugebiete', modul: 'rieden', text: /Freigabe Rieden/, actions: () => [
    gebiete.createCustomWeinbaugebiet('Wagram-Ost'), gebiete.deaktiviereCustomWeinbaugebiet(X),
  ] },
  { name: 'Rabattgruppen', modul: 'warenwirtschaft', text: /Freigabe Warenwirtschaft/, actions: () => [
    rabatt.createRabattgruppe(formular({ name: 'Gastro' })), rabatt.updateRabattgruppe(X, formular({ name: 'Gastro' })), rabatt.deleteRabattgruppe(X),
  ] },
  { name: 'Sonstige Produkte', modul: 'warenwirtschaft', text: /Freigabe Warenwirtschaft/, actions: () => [
    produkte.upsertSonstigesArtikel(formular({ id: '', name: 'Traubensaft' })), produkte.toggleAktivSonstigesArtikel(X, false),
    produkte.deleteSonstigesArtikel(X), produkte.produktEinstellungenSpeichern(formular({ id: X })),
    produkte.produktBuchen(formular({ artikel_id: X })), produkte.produktBuchungStornieren(X, X, 'Falsch erfasst bei Inventur'),
  ] },
  { name: 'Maßnahmen', modul: 'rieden', text: /Freigabe Rieden/, actions: () => [
    massnahmen.createBehandlung(formular()), massnahmen.updateBehandlung(X, formular()),
    massnahmen.stornoBehandlung(X, 'Falsch erfasst bei Inventur'), massnahmen.loescheBehandlung(X, 'Falsch erfasst bei Inventur'),
  ] },
]

describe('Schreibrecht vorab wie RLS (KAN-242)', nurMitHooks, () => {
  for (const f of FAELLE) {
    test(`${f.name}: Leser und Mitarbeiter ohne Freigabe ${f.modul} – verständliche Meldung, kein Datenbankzugriff`, async () => {
      const andere = f.modul === 'rieden' ? ['kellerbuch', 'warenwirtschaft', 'crm', 'ea'] : ['rieden', 'kellerbuch', 'crm', 'ea']
      for (const [rolle, mods] of [['leser', []], ['winzer', andere]]) {
        als(rolle, mods)
        const d = db(); globalThis.__serverFake = d
        const meldungen = []
        for (const p of f.actions()) meldungen.push(await meldung(p))
        for (const m of meldungen) assert.match(m, f.text, `${rolle}: ${m}`)
        assert.deepEqual(d.aufrufe, [], `${rolle}: kein Datenbankzugriff`)
      }
    })
  }

  test('mit Freigabe: Mitarbeiter legt an (Ried, Weinbaugebiet, Rabattgruppe, Produkt, PSM deaktivieren)', async () => {
    als('winzer', ['rieden'])
    let d = db(); globalThis.__serverFake = d
    await lagen.createLage(formular({ name: 'Kirchberg' }))
    assert.deepEqual(await gebiete.createCustomWeinbaugebiet('Wagram-Ost'), { id: d.tabellen.weinbaugebiete_custom[0].id, name: 'Wagram-Ost' })
    d.tabellen.pflanzenschutzmittel.push({ id: X, tenant_id: T, aktiv: true })
    await lager.deactivatePSM(X)
    assert.deepEqual([d.tabellen.lagen[0].name, d.tabellen.pflanzenschutzmittel[0].aktiv], ['Kirchberg', false])
    als('winzer', ['warenwirtschaft'])
    d = db(); globalThis.__serverFake = d
    await rabatt.createRabattgruppe(formular({ name: 'Gastro', rabatt_pct: '7,5' }))
    await produkte.upsertSonstigesArtikel(formular({ id: '', name: 'Traubensaft', einheit: '', default_preis: '4,50' }))
    assert.deepEqual([d.tabellen.rabattgruppen[0].rabatt_pct, d.tabellen.sonstige_artikel[0].default_preis, d.tabellen.sonstige_artikel[0].einheit], [7.5, 4.5, 'Stk'])
  })
})

describe('Löschen meldet nur, was wirklich gelöscht ist (KAN-242)', nurMitHooks, () => {
  test('Ried löschen: nur Betriebsleitung (Policy „lagen: admin can delete“) – Mitarbeiter mit Freigabe bekommt eine Meldung statt „gelöscht“', async () => {
    als('winzer', ['rieden'])
    const d = db({ lagen: [{ id: X, tenant_id: T, name: 'Kirchberg' }] }); globalThis.__serverFake = d
    assert.deepEqual(await lagen.deleteLage(X), { error: 'Eine Ried löschen darf nur die Betriebsleitung.' })
    assert.deepEqual(d.aufrufe, [])
    als('tenant_admin')
    assert.deepEqual(await lagen.deleteLage(X), {})
    assert.equal(d.tabellen.lagen.length, 0)
  })

  test('RLS filtert still (0 Zeilen): Ried, Rabattgruppe und Produkt melden einen Fehler statt Erfolg', async () => {
    const zeilen = { lagen: [{ id: X, tenant_id: T }], rabattgruppen: [{ id: X, tenant_id: T }], sonstige_artikel: [{ id: X, tenant_id: T }] }
    const d = db(zeilen, { rls: e => e.art !== 'delete' }); globalThis.__serverFake = d
    assert.match((await lagen.deleteLage(X)).error, /Ried wurde nicht gelöscht/)
    await assert.rejects(rabatt.deleteRabattgruppe(X), /Rabattgruppe wurde nicht gelöscht/)
    assert.match((await produkte.deleteSonstigesArtikel(X)).error, /Produkt wurde nicht gelöscht .* bitte deaktivieren/)
    assert.deepEqual([d.tabellen.lagen.length, d.tabellen.rabattgruppen.length, d.tabellen.sonstige_artikel.length], [1, 1, 1])
  })

  test('Produkt mit Bewegungen (FK 23503): Hinweis „deaktivieren“ bleibt', async () => {
    const d = db({ sonstige_artikel: [{ id: X, tenant_id: T }] }, { vorher: e => e.art === 'delete' ? { error: { code: '23503', message: 'fk' } } : null })
    globalThis.__serverFake = d
    assert.match((await produkte.deleteSonstigesArtikel(X)).error, /Lagerbewegungen oder Verkäufe .* bitte deaktivieren/)
  })
})
