// Charakterisierungstests (28.09.2026, STABILITAET.md Stufe 3 Punkt 2) für
// src/lib/verkauf/bestand.ts – Bestandsbuchungen von Verkauf und Storno – samt der
// E&A-Rücknahme über src/lib/ea/verkaufEinnahmen.ts. Sicherheitsnetz vor dem Storno-Umbau
// (KAN-145/148/149): Die Tests halten das HEUTIGE Verhalten fest, auch wo es fragwürdig ist
// (jeweils mit „Befund“ im Testnamen bzw. Kommentar markiert) – nichts davon ist korrigiert.
//
// Abgedeckt:
//   pruefeVerkaufsRechte          Rollen/Module × Flasche/Tank × Verkauf/Storno, Meldungstexte
//   chargeBestandAendern          Abgang/Zugang, Leer-Schwelle, Status/aktiv, Vergleichen und Setzen,
//                                 gleichzeitige Änderung, still gefiltertes UPDATE (RLS), DB-Fehler,
//                                 Gebinde-Trigger (P0001), fremder Mandant, ungültige Menge
//   chargeBuchungZuruecknehmen    exakte Rücknahme bzw. Gegen-Delta nach Zwischenbuchung
//   fuellungBestandAendern        Flaschen über die RPC s112_fuellung_verkauf_buchen (KAN-149 D1): Parameter,
//                                 Zeile in fuellung_bewegungen, ganzzahlig, Überverkauf, Fehlertexte
//   bestandsBuchungenZuruecknehmen / bestandBuchenAllesOderNichts  Reihenfolge, Rücknahme, Texte
//   verkaufspostenStornieren      Normalfall (Flasche + Tank + Traubenverkauf + E&A + CRM), jeder
//                                 Fehlerpfad (was ist danach geschrieben?), Rechte, Mandantenfilter
//
// Aufruf: npm run -s test:csv  (Node ≥ 22.15 wegen module.registerHooks)

import { test, describe, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import {
  hooksRegistrieren, laden, nurMitHooks, hooksMoeglich, datenbank, uuid,
  schreibzugriffe, zugriffe, hatFilter, ohneMandant, zeile, fehlerBei,
} from './buchung-attrappe.mjs'

hooksRegistrieren()
const b = hooksMoeglich ? await laden('lib/verkauf/bestand.ts') : null

const T = 'tenant-1'
const FREMD = 'tenant-2'
const C1 = uuid(101)
const C2 = uuid(102)
const F1 = uuid(201)
const F2 = uuid(202)
const VP = uuid(301)

const charge = (id, teil) => ({ id, tenant_id: T, name: 'Grüner Veltliner 2025', menge_liter: 100, aktiv: true, status: 'ausbau', ...teil })
const fuellung = (id, teil) => ({ id, tenant_id: T, name: 'Rosé 2025 0,75', bestand_flaschen: 120, aktualisiert_am: null, ...teil })
const admin = { tenantId: T, role: 'tenant_admin', schreibmodule: [] }
const winzer = (...m) => ({ tenantId: T, role: 'winzer', schreibmodule: m })

async function fehlerVon(p) {
  try { await p } catch (e) { return e }
  assert.fail('Fehler erwartet')
}

// ── KAN-149 D1: Flaschen über die RPC s112_fuellung_verkauf_buchen ───────────────────────────────────────────

const RPC_FLASCHEN = 'rpc:s112_fuellung_verkauf_buchen'
const G = 'Kunde hat storniert'
const K = { postenId: VP, datum: '2026-09-30' }

/** Nachbildung der RPC auf der Attrappe (ohne Sperre): Bestand und Zeile in fuellung_bewegungen wie die Datenbank */
function flaschenRpc(tabellen, name, a) {
  // KAN-149 D2b: Zahlungsstorno (Erstattung) – kennzeichnet die Zahlung; die Gegenbuchung ihrer Einnahmen macht die DB
  if (name === 's112_zahlung_stornieren') {
    const z = (tabellen.zahlungen ?? []).find(x => x.id === a.p_zahlung_id && x.tenant_id === a.p_tenant_id)
    if (!z) return { data: null, error: { code: 'P0002', message: 'Zahlung nicht gefunden – bitte die Seite neu laden.' } }
    Object.assign(z, { storniert_am: '2026-09-30T10:00:00Z', storno_grund: a.p_grund, erstattet_am: a.p_datum })
    return { data: 0, error: null }
  }
  if (name !== 's112_fuellung_verkauf_buchen') return { data: null, error: { message: `rpc ${name} nicht nachgebildet` } }
  const f = (tabellen.fuellungen ?? []).find(x => x.id === a.p_fuellung_id && x.tenant_id === a.p_tenant_id)
  if (!f) return { data: null, error: { code: 'P0002', message: 'Füllung nicht gefunden – bitte Seite neu laden' } }
  const alt = Number(f.bestand_flaschen ?? 0)
  const neu = alt + a.p_menge_stk
  if (neu < 0) return { data: null, error: { code: '22023', message: `„${f.name}“: nur noch ${alt} Flaschen verfügbar, ${-a.p_menge_stk} angefragt.` } }
  f.bestand_flaschen = neu
  ;(tabellen.fuellung_bewegungen ??= []).push({
    fuellung_id: f.id, tenant_id: a.p_tenant_id, datum: a.p_datum, art: a.p_menge_stk < 0 ? 'verkauf' : 'verkauf_storno',
    menge_stk: a.p_menge_stk, bestand_vorher: alt, bestand_nachher: neu, grund: a.p_grund ?? null, verkaufsposten_id: a.p_verkaufsposten_id,
  })
  return { data: neu, error: null }
}

/** Attrappe mit Flaschen-RPC; `rpcFehler(nr)` liefert für den n-ten RPC-Aufruf einen Datenbankfehler */
function mitFlaschenRpc(t, opt = {}) {
  const { rpcFehler, ...rest } = opt
  let nr = 0
  const db = datenbank(t, { ...rest, rpc: (name, a) => {
    nr++
    const f = rpcFehler?.(nr)
    return f ? { data: null, error: f } : flaschenRpc(db.tabellen, name, a)
  } })
  return db
}

/** Schreibzugriffe samt RPC-Aufrufen in Reihenfolge */
const ablauf = db => db.aufrufe.filter(a => a.art !== 'select').map(a => (a.art === 'rpc' ? a.tabelle : `${a.art} ${a.tabelle}`))

// ── Rechte ────────────────────────────────────────────────────────────────────

describe('pruefeVerkaufsRechte – Rechte vor dem ersten Schreibzugriff', nurMitHooks, () => {
  const pruefe = (m, o) => b.pruefeVerkaufsRechte(m, { tank: false, flasche: false, vorgang: 'verkauf', ...o })

  test('Betriebs-Manager und Plattform-Admin dürfen alles', () => {
    for (const role of ['tenant_admin', 'system_admin']) {
      pruefe({ tenantId: T, role, schreibmodule: [] }, { tank: true, flasche: true })
      pruefe({ tenantId: T, role, schreibmodule: [] }, { tank: true, flasche: true, vorgang: 'storno' })
    }
  })

  test('Mitarbeiter ohne Warenwirtschaft: Verkauf und Storno abgelehnt, Storno nennt die Rechnung', () => {
    assert.throws(() => pruefe(winzer('kellerbuch'), {}), { name: 'AktionsFehler', message: 'Keine Berechtigung für Verkäufe – dafür ist die Freigabe Warenwirtschaft nötig.' })
    assert.throws(() => pruefe(winzer('kellerbuch'), { vorgang: 'storno', rechnungsnummer: 'RE-2026-007' }), {
      message: 'Die Rechnung RE-2026-007 kann nur von einem Betriebs-Manager oder einem Mitarbeiter mit Freigabe Warenwirtschaft storniert werden (Warenwirtschaft › Verkauf). Es wurde nichts geändert.',
    })
    assert.throws(() => pruefe(winzer(), { vorgang: 'storno', rechnungsnummer: null }), { message: /^Der Verkauf kann nur von einem Betriebs-Manager/ })
  })

  test('Leser wird immer abgelehnt', () => {
    assert.throws(() => pruefe({ tenantId: T, role: 'leser', schreibmodule: [] }, {}), { message: /Freigabe Warenwirtschaft/ })
  })

  test('Warenwirtschaft genügt für Flaschen (die Flaschen-Prüfung ist dadurch nie allein ausschlaggebend)', () => {
    pruefe(winzer('warenwirtschaft'), { flasche: true })
    pruefe(winzer('warenwirtschaft'), { flasche: true, vorgang: 'storno' })
  })

  test('Tank braucht zusätzlich Kellerbuch oder Rieden – eigene Texte für Verkauf und Storno', () => {
    assert.throws(() => pruefe(winzer('warenwirtschaft'), { tank: true }), { message: /^Ein Tankverkauf bucht die Liter von der Kellerbuch-Charge ab/ })
    assert.throws(() => pruefe(winzer('warenwirtschaft'), { tank: true, vorgang: 'storno', rechnungsnummer: 'RE-1' }), {
      message: /^Die Rechnung RE-1 enthält offenen Wein \(Tank\): Beim Storno werden die Liter auf die Kellerbuch-Charge zurückgebucht.*Es wurde nichts geändert\.$/,
    })
    pruefe(winzer('warenwirtschaft', 'kellerbuch'), { tank: true })
    pruefe(winzer('warenwirtschaft', 'rieden'), { tank: true, vorgang: 'storno' })
  })
})

// ── Charge ────────────────────────────────────────────────────────────────────

describe('chargeBestandAendern – Liter einer Kellerbuch-Charge', nurMitHooks, () => {
  test('Abgang: liest mit Mandantenfilter, schreibt per Vergleichen und Setzen, liefert die Buchung', async () => {
    const db = datenbank({ weinausbau: [charge(C1)] })
    const r = await b.chargeBestandAendern(db, T, C1, -30)
    assert.deepEqual(r, {
      id: C1, name: 'Grüner Veltliner 2025', delta: -30,
      vorher: { menge_liter: 100, aktiv: true, status: 'ausbau' },
      nachher: { menge_liter: 70, aktiv: true, status: 'ausbau' },
    })
    assert.deepEqual(zugriffe(db), ['select weinausbau', 'update weinausbau'])
    const u = db.aufrufe[1]
    assert.deepEqual(u.werte, { menge_liter: 70 })
    assert.ok(hatFilter(u, 'eq', 'id', C1) && hatFilter(u, 'eq', 'tenant_id', T))
    assert.ok(hatFilter(u, 'gte', 'menge_liter', 100 - 1e-9) && hatFilter(u, 'lte', 'menge_liter', 100 + 1e-9))
    assert.equal(zeile(db, 'weinausbau', C1).menge_liter, 70)
    assert.deepEqual(ohneMandant(db, T), [])
  })

  test('Abgang auf genau 0: Charge wird abgeschlossen und inaktiv', async () => {
    const db = datenbank({ weinausbau: [charge(C1, { menge_liter: 30 })] })
    const r = await b.chargeBestandAendern(db, T, C1, -30)
    assert.deepEqual(db.aufrufe[1].werte, { menge_liter: 0, aktiv: false, status: 'abgeschlossen' })
    assert.deepEqual(r.nachher, { menge_liter: 0, aktiv: false, status: 'abgeschlossen' })
  })

  test('Abgang lässt einen Rest unter 0,005 L: Rest wird ohne Meldung auf 0 gesetzt und die Charge abgeschlossen', async () => {
    const db = datenbank({ weinausbau: [charge(C1, { menge_liter: 30.004 })] })
    await b.chargeBestandAendern(db, T, C1, -30)
    assert.deepEqual(db.aufrufe[1].werte, { menge_liter: 0, aktiv: false, status: 'abgeschlossen' })
  })

  test('Gleitkomma-Rauschen (0,3 − 0,30000000000000004) gilt als 0, nicht als negativ', async () => {
    const db = datenbank({ weinausbau: [charge(C1, { menge_liter: 0.3 })] })
    await b.chargeBestandAendern(db, T, C1, -(0.1 + 0.2))
    assert.equal(zeile(db, 'weinausbau', C1).menge_liter, 0)
  })

  test('mehr als vorhanden: Fehler mit Mengen, kein UPDATE', async () => {
    const db = datenbank({ weinausbau: [charge(C1, { menge_liter: 10 })] })
    const e = await fehlerVon(b.chargeBestandAendern(db, T, C1, -10.01))
    assert.equal(e.message, '„Grüner Veltliner 2025“: nur noch 10 L verfügbar, 10,01 L angefragt.')
    assert.deepEqual(schreibzugriffe(db), [])
  })

  test('Rückbuchung auf eine abgeschlossene Charge: wieder aktiv, Status „ausbau“', async () => {
    const db = datenbank({ weinausbau: [charge(C1, { menge_liter: 0, aktiv: false, status: 'abgeschlossen' })] })
    const r = await b.chargeBestandAendern(db, T, C1, 50)
    assert.deepEqual(db.aufrufe[1].werte, { menge_liter: 50, aktiv: true, status: 'ausbau' })
    assert.deepEqual(r.vorher, { menge_liter: 0, aktiv: false, status: 'abgeschlossen' })
    assert.deepEqual(r.nachher, { menge_liter: 50, aktiv: true, status: 'ausbau' })
  })

  test('Rückbuchung auf eine inaktive Charge mit anderem Status: nur aktiv, Status bleibt', async () => {
    const db = datenbank({ weinausbau: [charge(C1, { menge_liter: 0, aktiv: false, status: 'gaerung' })] })
    await b.chargeBestandAendern(db, T, C1, 5)
    assert.deepEqual(db.aufrufe[1].werte, { menge_liter: 5, aktiv: true })
  })

  test('Befund: Zugang unter 0,005 L auf eine leere Charge wird als 0 L gespeichert (Liter verschwinden still)', async () => {
    const db = datenbank({ weinausbau: [charge(C1, { menge_liter: 0, aktiv: false, status: 'abgeschlossen' })] })
    const r = await b.chargeBestandAendern(db, T, C1, 0.004)
    assert.deepEqual(db.aufrufe[1].werte, { menge_liter: 0 })
    assert.equal(r.delta, 0.004, 'die Buchung meldet trotzdem +0,004 L')
    assert.deepEqual(r.nachher, { menge_liter: 0, aktiv: false, status: 'abgeschlossen' })
  })

  test('Bestand NULL zählt als 0 und wird per IS NULL verglichen', async () => {
    const db = datenbank({ weinausbau: [charge(C1, { menge_liter: null })] })
    const r = await b.chargeBestandAendern(db, T, C1, 12.5)
    assert.ok(hatFilter(db.aufrufe[1], 'is', 'menge_liter', null))
    assert.equal(zeile(db, 'weinausbau', C1).menge_liter, 12.5)
    assert.equal(r.vorher.menge_liter, null)
  })

  test('Liter als Text aus der DB (numeric) werden gerechnet, vorher bleibt der Rohwert', async () => {
    const db = datenbank({ weinausbau: [charge(C1, { menge_liter: '100.50' })] })
    const r = await b.chargeBestandAendern(db, T, C1, -0.5)
    assert.equal(r.vorher.menge_liter, '100.50')
    assert.equal(zeile(db, 'weinausbau', C1).menge_liter, 100)
  })

  test('ungültige Menge (NaN, Infinity): Fehler ohne Datenbankzugriff', async () => {
    for (const d of [NaN, Infinity]) {
      const db = datenbank({ weinausbau: [charge(C1)] })
      const e = await fehlerVon(b.chargeBestandAendern(db, T, C1, d))
      assert.equal(e.message, 'Ungültige Literangabe für die Bestandsbuchung')
      assert.deepEqual(db.aufrufe, [])
    }
  })

  test('Charge eines anderen Mandanten wird nicht gefunden und nicht geändert', async () => {
    const db = datenbank({ weinausbau: [charge(C1, { tenant_id: FREMD })] })
    const e = await fehlerVon(b.chargeBestandAendern(db, T, C1, -1))
    assert.equal(e.message, 'Kellerbuch-Charge nicht gefunden – bitte Seite neu laden.')
    assert.equal(zeile(db, 'weinausbau', C1).menge_liter, 100)
  })

  test('Lesefehler: Meldung mit Kontext, kein UPDATE', async () => {
    const db = datenbank({ weinausbau: [charge(C1)] }, { vorher: fehlerBei('weinausbau', 'select', { message: 'timeout' }) })
    const e = await fehlerVon(b.chargeBestandAendern(db, T, C1, -1))
    assert.equal(e.message, 'Bestand der Charge konnte nicht gelesen werden: timeout')
    assert.deepEqual(schreibzugriffe(db), [])
  })

  test('Schreibfehler: Meldung mit Chargenname', async () => {
    const db = datenbank({ weinausbau: [charge(C1)] }, { vorher: fehlerBei('weinausbau', 'update', { message: 'boom' }) })
    const e = await fehlerVon(b.chargeBestandAendern(db, T, C1, -1))
    assert.equal(e.message, 'Bestand der Charge „Grüner Veltliner 2025“ konnte nicht gespeichert werden: boom')
    assert.equal(zeile(db, 'weinausbau', C1).menge_liter, 100)
  })

  test('Gebinde-Trigger (P0001) beim Reaktivieren: Meldung ab „Gebinde …“ mit Handlungshinweis', async () => {
    const db = datenbank({ weinausbau: [charge(C1, { menge_liter: 0, aktiv: false, status: 'abgeschlossen' })] }, {
      vorher: fehlerBei('weinausbau', 'update', { code: 'P0001', message: 'weinausbau_gebinde_pruefen: Gebinde „T3“ ist durch Weingut Nachbar belegt.' }),
    })
    const e = await fehlerVon(b.chargeBestandAendern(db, T, C1, 20))
    assert.equal(e.message, 'Charge „Grüner Veltliner 2025“: Gebinde „T3“ ist durch Weingut Nachbar belegt. Bitte das Gebinde freimachen bzw. Support kontaktieren')
  })

  test('gleichzeitiger Verkauf zwischen Lesen und Schreiben: neu lesen und vom neuen Stand abbuchen', async () => {
    let n = 0
    const db = datenbank({ weinausbau: [charge(C1)] }, {
      vorher: (e, t) => { if (e.art === 'update' && ++n === 1) t.weinausbau[0].menge_liter = 80 },
    })
    const r = await b.chargeBestandAendern(db, T, C1, -30)
    assert.deepEqual(zugriffe(db), ['select weinausbau', 'update weinausbau', 'select weinausbau', 'update weinausbau'])
    assert.deepEqual(db.aufrufe[1].getroffen, [], 'erstes UPDATE trifft nichts')
    assert.equal(zeile(db, 'weinausbau', C1).menge_liter, 50)
    assert.equal(r.vorher.menge_liter, 80)
  })

  test('still gefiltertes UPDATE (RLS) bei unverändertem Bestand: Meldung „Schreibberechtigung“', async () => {
    const db = datenbank({ weinausbau: [charge(C1)] }, { rls: e => e.art !== 'update' })
    const e = await fehlerVon(b.chargeBestandAendern(db, T, C1, -1))
    assert.equal(e.message, 'Der Bestand der Charge „Grüner Veltliner 2025“ konnte nicht geändert werden – vermutlich fehlt die Schreibberechtigung für das Kellerbuch')
    assert.deepEqual(zugriffe(db), ['select weinausbau', 'update weinausbau', 'select weinausbau'])
  })

  test('Bestand ändert sich bei jedem Versuch: nach 4 Versuchen Abbruch', async () => {
    const db = datenbank({ weinausbau: [charge(C1)] }, { vorher: (e, t) => { if (e.art === 'update') t.weinausbau[0].menge_liter += 1 } })
    const e = await fehlerVon(b.chargeBestandAendern(db, T, C1, -1))
    assert.equal(e.message, 'Der Bestand der Charge wurde gleichzeitig mehrfach geändert – bitte erneut versuchen.')
    assert.equal(db.aufrufe.length, 8)
    assert.equal(zeile(db, 'weinausbau', C1).menge_liter, 104, 'nur die fremden Änderungen')
  })
})

describe('chargeBuchungZuruecknehmen – Rücknahme einer Chargen-Buchung', nurMitHooks, () => {
  test('unveränderter Stand: Menge, aktiv und Status exakt zurück (Vergleich gegen den Stand danach)', async () => {
    const db = datenbank({ weinausbau: [charge(C1, { menge_liter: 30 })] })
    const buchung = await b.chargeBestandAendern(db, T, C1, -30)
    await b.chargeBuchungZuruecknehmen(db, T, buchung)
    const u = db.aufrufe.at(-1)
    assert.deepEqual(u.werte, { menge_liter: 30, aktiv: true, status: 'ausbau' })
    assert.ok(hatFilter(u, 'gte', 'menge_liter', -1e-9) && hatFilter(u, 'lte', 'menge_liter', 1e-9))
    assert.deepEqual(zeile(db, 'weinausbau', C1), charge(C1, { menge_liter: 30 }))
    assert.deepEqual(ohneMandant(db, T), [])
  })

  test('Zwischenbuchung: nur das Gegen-Delta wird gebucht (Status folgt dem neuen Bestand)', async () => {
    const db = datenbank({ weinausbau: [charge(C1)] })
    const buchung = await b.chargeBestandAendern(db, T, C1, -30)
    zeile(db, 'weinausbau', C1).menge_liter = 60 // danach 10 L anderweitig verkauft
    await b.chargeBuchungZuruecknehmen(db, T, buchung)
    assert.equal(zeile(db, 'weinausbau', C1).menge_liter, 90)
    assert.deepEqual(zugriffe(db).slice(2), ['update weinausbau', 'select weinausbau', 'update weinausbau'])
  })

  test('Fehler beim Zurücksetzen: Meldung mit Chargenname', async () => {
    const db = datenbank({ weinausbau: [charge(C1)] }, { vorher: fehlerBei('weinausbau', 'update', { message: 'weg' }, 2) })
    const buchung = await b.chargeBestandAendern(db, T, C1, -30)
    const e = await fehlerVon(b.chargeBuchungZuruecknehmen(db, T, buchung))
    assert.equal(e.message, 'Charge „Grüner Veltliner 2025“ konnte nicht zurückgesetzt werden: weg')
  })
})

// ── Füllung ───────────────────────────────────────────────────────────────────

describe('fuellungBestandAendern – Flaschenbestand über die RPC (KAN-149 D1)', nurMitHooks, () => {
  test('Verkauf: RPC mit Mandant, Füllung, Beleg, Menge, Tag und Grund; Zeile mit Bestand vorher/nachher; kein direktes UPDATE', async () => {
    const db = mitFlaschenRpc({ fuellungen: [fuellung(F1)] })
    const neu = await b.fuellungBestandAendern(db, T, F1, -12, K)
    assert.equal(neu, 108)
    assert.deepEqual(ablauf(db), [RPC_FLASCHEN])
    assert.deepEqual(db.aufrufe[0].werte, {
      p_tenant_id: T, p_fuellung_id: F1, p_verkaufsposten_id: VP, p_menge_stk: -12, p_datum: '2026-09-30', p_grund: null,
    })
    assert.deepEqual(db.tabellen.fuellung_bewegungen.map(z => [z.art, z.menge_stk, z.bestand_vorher, z.bestand_nachher, z.verkaufsposten_id]),
      [['verkauf', -12, 120, 108, VP]])
    assert.ok(!ablauf(db).includes('update fuellungen'), 'kein direktes UPDATE mehr')
  })

  test('nur ganze Stück – sonst Fehler ohne Datenbankzugriff', async () => {
    const db = mitFlaschenRpc({ fuellungen: [fuellung(F1)] })
    const e = await fehlerVon(b.fuellungBestandAendern(db, T, F1, 1.5, K))
    assert.equal(e.message, 'Flaschen können nur in ganzen Stück gebucht werden.')
    assert.deepEqual(db.aufrufe, [])
  })

  test('mehr als vorhanden: Meldung der Datenbank, nichts gebucht', async () => {
    const db = mitFlaschenRpc({ fuellungen: [fuellung(F1, { bestand_flaschen: 5 })] })
    const e = await fehlerVon(b.fuellungBestandAendern(db, T, F1, -6, K))
    assert.equal(e.message, '„Rosé 2025 0,75“: nur noch 5 Flaschen verfügbar, 6 angefragt.')
    assert.equal(zeile(db, 'fuellungen', F1).bestand_flaschen, 5)
    assert.equal(db.tabellen.fuellung_bewegungen, undefined)
  })

  test('Storno-Rückbuchung (positiv) mit Grund; Bestand NULL zählt als 0', async () => {
    const db = mitFlaschenRpc({ fuellungen: [fuellung(F1, { bestand_flaschen: null })] })
    assert.equal(await b.fuellungBestandAendern(db, T, F1, 6, { ...K, grund: G }), 6)
    assert.deepEqual(db.tabellen.fuellung_bewegungen.map(z => [z.art, z.menge_stk, z.grund]), [['verkauf_storno', 6, G]])
  })

  test('fremder Mandant bzw. Datenbankfehler: Meldung durchgereicht bzw. mit Kontext', async () => {
    let e = await fehlerVon(b.fuellungBestandAendern(mitFlaschenRpc({ fuellungen: [fuellung(F1, { tenant_id: FREMD })] }), T, F1, -1, K))
    assert.equal(e.message, 'Füllung nicht gefunden – bitte Seite neu laden')
    e = await fehlerVon(b.fuellungBestandAendern(mitFlaschenRpc({ fuellungen: [fuellung(F1)] }, { rpcFehler: () => ({ message: 'y' }) }), T, F1, -1, K))
    assert.equal(e.message, 'Flaschenbestand konnte nicht gebucht werden: y')
    e = await fehlerVon(b.fuellungBestandAendern(mitFlaschenRpc({ fuellungen: [fuellung(F1)] }, { rpcFehler: () => ({ code: '42501', message: 'Keine Schreibberechtigung für den Flaschenbestand in diesem Betrieb' }) }), T, F1, -1, K))
    assert.equal(e.message, 'Keine Schreibberechtigung für den Flaschenbestand in diesem Betrieb')
  })
})

// ── Mehrere Buchungen ─────────────────────────────────────────────────────────

describe('bestandBuchenAllesOderNichts und bestandsBuchungenZuruecknehmen', nurMitHooks, () => {
  const tabellen = () => ({
    weinausbau: [charge(C1), charge(C2, { name: 'Zweigelt 2024', menge_liter: 50 })],
    fuellungen: [fuellung(F1), fuellung(F2, { name: 'Sekt', bestand_flaschen: 10 })],
  })

  test('erst alle Flaschen, dann alle Chargen; 0 Stück und Liter unter 0,0005 werden übersprungen', async () => {
    const db = mitFlaschenRpc(tabellen())
    const r = await b.bestandBuchenAllesOderNichts(db, T,
      new Map([[C1, -20], [C2, 0.0004]]),
      new Map([[F1, -6], [F2, 0]]), K)
    assert.deepEqual(ablauf(db), [RPC_FLASCHEN, 'update weinausbau'])
    assert.deepEqual(r.map(x => x.art), ['flasche', 'charge'])
    assert.deepEqual(r[0], { art: 'flasche', fuellungId: F1, stueck: -6, kontext: K })
    assert.equal(r[1].buchung.id, C1)
    assert.equal(zeile(db, 'fuellungen', F1).bestand_flaschen, 114)
    assert.equal(zeile(db, 'weinausbau', C1).menge_liter, 80)
    assert.equal(zeile(db, 'weinausbau', C2).menge_liter, 50)
  })

  test('zweite Charge reicht nicht: alles in umgekehrter Reihenfolge zurück, Meldung mit Punkt', async () => {
    const db = mitFlaschenRpc(tabellen())
    const e = await fehlerVon(b.bestandBuchenAllesOderNichts(db, T, new Map([[C1, -20], [C2, -60]]), new Map([[F1, -6]]), K))
    assert.equal(e.message, '„Zweigelt 2024“: nur noch 50 L verfügbar, 60 L angefragt.')
    assert.deepEqual(ablauf(db), [RPC_FLASCHEN, 'update weinausbau', 'update weinausbau', RPC_FLASCHEN])
    assert.deepEqual(db.tabellen.weinausbau.map(c => c.menge_liter), [100, 50])
    assert.equal(zeile(db, 'fuellungen', F1).bestand_flaschen, 120)
    // KAN-149 D1: die Rücknahme ist eine Gegenzeile (Bestandskette vollständig)
    assert.deepEqual(db.tabellen.fuellung_bewegungen.map(z => [z.art, z.menge_stk, z.grund]),
      [['verkauf', -6, null], ['verkauf_storno', 6, 'Rücknahme: Buchung nicht abgeschlossen']])
  })

  test('Rücknahme scheitert auch: „Achtung“-Meldung mit den offenen Punkten', async () => {
    // 1. RPC (Abgang) ok, 2. update weinausbau C1 → Fehler, Rücknahme der Flaschen → 2. RPC Fehler
    const db = mitFlaschenRpc(tabellen(), {
      vorher: fehlerBei('weinausbau', 'update', { message: 'Charge kaputt' }),
      rpcFehler: nr => (nr === 2 ? { message: 'Lager kaputt' } : null),
    })
    const e = await fehlerVon(b.bestandBuchenAllesOderNichts(db, T, new Map([[C1, -20]]), new Map([[F1, -6]]), K))
    assert.equal(e.message, 'Bestand der Charge „Grüner Veltliner 2025“ konnte nicht gespeichert werden: Charge kaputt. Achtung: Bereits gebuchte Bestände konnten nicht zurückgesetzt werden (Flaschenbestand konnte nicht gebucht werden: Lager kaputt) – bitte Bestand prüfen und Support kontaktieren.')
    assert.equal(zeile(db, 'fuellungen', F1).bestand_flaschen, 114, 'Abgang bleibt stehen')
  })

  test('bestandsBuchungenZuruecknehmen: umgekehrte Reihenfolge, sammelt Fehler und macht weiter', async () => {
    const db = mitFlaschenRpc(tabellen())
    const buchungen = await b.bestandBuchenAllesOderNichts(db, T, new Map([[C1, -20]]), new Map([[F1, -6], [F2, -2]]), K)
    zeile(db, 'fuellungen', F2).tenant_id = FREMD // F2 nicht mehr sichtbar → Rücknahme scheitert
    const fehler = await b.bestandsBuchungenZuruecknehmen(db, T, buchungen)
    assert.deepEqual(fehler, ['Füllung nicht gefunden – bitte Seite neu laden'])
    assert.deepEqual(ablauf(db).slice(3), ['update weinausbau', RPC_FLASCHEN, RPC_FLASCHEN])
    assert.equal(zeile(db, 'weinausbau', C1).menge_liter, 100)
    assert.equal(zeile(db, 'fuellungen', F1).bestand_flaschen, 120)
    assert.equal(zeile(db, 'fuellungen', F2).bestand_flaschen, 8)
  })
})

// ── Storno ────────────────────────────────────────────────────────────────────

describe('verkaufspostenStornieren – Verkauf zurücknehmen', nurMitHooks, () => {
  const TV1 = uuid(401), TV2 = uuid(402), TV3 = uuid(403)
  const posten = teil => ({ id: VP, tenant_id: T, rechnungsnummer: 'RE-2026-001', storniert: false, storniert_am: null, ...teil })
  const pos = (teil) => ({ tenant_id: T, verkaufsposten_id: VP, name: 'Position', typ: 'flasche', fuellung_id: null, weinausbau_id: null, menge: 0, traubenverkauf_id: null, ...teil })
  const eaZeile = (id, teil) => ({ id, tenant_id: T, typ: 'einnahme', verkaufsposten_id: VP, import_quelle: 'verkauf', is_locked: false, ...teil })

  const vollerPosten = () => ({
    verkaufsposten: [posten(), posten({ id: uuid(399), rechnungsnummer: 'RE-2026-002' })],
    verkauf_positionen: [
      pos({ id: 'p1', fuellung_id: F1, menge: 6 }),
      pos({ id: 'p2', fuellung_id: F1, menge: 6 }),
      pos({ id: 'p3', typ: 'tank', weinausbau_id: C1, menge: 100 }),
      pos({ id: 'p4', typ: 'traube', traubenverkauf_id: TV1, menge: 500 }),
      pos({ id: 'p5', fuellung_id: F2, menge: 1, verkaufsposten_id: uuid(399) }),
    ],
    traubenverkauf: [
      { id: TV1, tenant_id: T, verkaufsposten_id: null },
      { id: TV2, tenant_id: T, verkaufsposten_id: VP },
      { id: TV3, tenant_id: FREMD, verkaufsposten_id: VP },
    ],
    fuellungen: [fuellung(F1, { bestand_flaschen: 0 }), fuellung(F2, { bestand_flaschen: 3 })],
    weinausbau: [charge(C1, { menge_liter: 0, aktiv: false, status: 'abgeschlossen' })],
    ea_transaktionen: [eaZeile('ea-offen'), eaZeile('ea-gesperrt', { is_locked: true }), eaZeile('ea-manuell', { import_quelle: 'manuell' })],
    aktivitaeten: [
      { id: 'akt-1', tenant_id: T, beschreibung: `Verkaufsposten: ${VP}`, betreff: 'Verkauf RE-2026-001' },
      { id: 'akt-2', tenant_id: FREMD, beschreibung: `Verkaufsposten: ${VP}`, betreff: 'fremd' },
    ],
  })

  /** Server- und Service-Role-Client teilen sich eine Attrappe: ein Protokoll für alle Schreibzugriffe */
  const neueDb = (t, opt) => {
    const db = mitFlaschenRpc(t, opt)
    globalThis.__adminFake = db
    globalThis.__serverFake = db
    return db
  }
  beforeEach(() => { globalThis.__membership = admin })

  test('Normalfall: Flaschen und Liter zurück, storniert, Traubenverkäufe storniert, E&A unverändert, CRM markiert', async () => {
    const db = neueDb(vollerPosten())
    await b.verkaufspostenStornieren(db, T, VP, G)
    assert.deepEqual(ablauf(db), [
      RPC_FLASCHEN, 'update weinausbau', 'update verkaufsposten',
      'update traubenverkauf', 'update aktivitaeten',
    ])
    // KAN-149 D1: Rückbuchung als Zeile mit Beleg und Grund, Kennzeichen mit Grund
    assert.deepEqual(db.tabellen.fuellung_bewegungen.map(z => [z.art, z.menge_stk, z.grund, z.verkaufsposten_id]),
      [['verkauf_storno', 12, G, VP]])
    assert.equal(db.aufrufe.find(a => a.art === 'update' && a.tabelle === 'verkaufsposten').werte.storno_grund, G)
    assert.equal(zeile(db, 'fuellungen', F1).bestand_flaschen, 12, 'zwei Positionen derselben Füllung summiert')
    assert.equal(zeile(db, 'fuellungen', F2).bestand_flaschen, 3, 'Position eines anderen Postens unberührt')
    assert.deepEqual(
      (({ menge_liter, aktiv, status }) => ({ menge_liter, aktiv, status }))(zeile(db, 'weinausbau', C1)),
      { menge_liter: 100, aktiv: true, status: 'ausbau' })
    const p = zeile(db, 'verkaufsposten', VP)
    assert.equal(p.storniert, true)
    assert.match(p.storniert_am, /^\d{4}-\d\d-\d\dT/)
    assert.equal(zeile(db, 'verkaufsposten', uuid(399)).storniert, false)
    // KAN-148: Traubenverkäufe bleiben, storniert mit Grund – der fremde bleibt unberührt
    assert.deepEqual(db.tabellen.traubenverkauf.map(t => t.id).sort(), [TV1, TV2, TV3].sort())
    for (const id of [TV1, TV2]) {
      assert.match(zeile(db, 'traubenverkauf', id).storniert_am ?? '', /^\d{4}-\d\d-\d\dT/, `${id} storniert`)
      assert.equal(zeile(db, 'traubenverkauf', id).storno_grund, `Rechnung RE-2026-001 storniert: ${G}`)
    }
    assert.equal(zeile(db, 'traubenverkauf', TV3).storniert_am ?? null, null)
    const tvStorno = db.aufrufe.find(a => a.art === 'update' && a.tabelle === 'traubenverkauf')
    assert.deepEqual(tvStorno.filter.find(f => f[0] === 'in'), ['in', 'id', [TV2, TV1]], 'erst über verkaufsposten_id, dann über die Position')
    assert.ok(hatFilter(tvStorno, 'is', 'storniert_am', null), 'nur noch nicht stornierte')
    // KAN-149 D2b: ohne Erstattung bleiben die Einnahmen (Geld ist eingegangen) – kein Löschen mehr
    assert.deepEqual(db.tabellen.ea_transaktionen.map(r => r.id), ['ea-offen', 'ea-gesperrt', 'ea-manuell'])
    assert.equal(zeile(db, 'aktivitaeten', 'akt-1').betreff, 'Verkauf RE-2026-001 · STORNIERT')
    assert.equal(zeile(db, 'aktivitaeten', 'akt-2').betreff, 'fremd')
    assert.deepEqual(ohneMandant(db, T), [])
    const setzen = db.aufrufe.find(a => a.art === 'update' && a.tabelle === 'verkaufsposten')
    assert.ok(hatFilter(setzen, 'eq', 'storniert', false), 'Kennzeichen nur bei storniert = false')
  })

  test('Befund: ohne Rechnungsnummer lautet der CRM-Betreff „Verkauf  · STORNIERT“ (doppeltes Leerzeichen)', async () => {
    const t = vollerPosten()
    t.verkaufsposten[0].rechnungsnummer = null
    const db = neueDb(t)
    await b.verkaufspostenStornieren(db, T, VP, G)
    assert.equal(zeile(db, 'aktivitaeten', 'akt-1').betreff, 'Verkauf  · STORNIERT')
  })

  test('Grund fehlt oder ist zu kurz (KAN-149 D1): Meldung, nichts gelesen oder geschrieben', async () => {
    for (const grund of [undefined, '', 'zu kurz']) {
      const db = neueDb(vollerPosten())
      const e = await fehlerVon(b.verkaufspostenStornieren(db, T, VP, grund))
      assert.equal(e.message, 'Bitte einen Grund für den Storno angeben (mindestens 10 Zeichen).')
      assert.deepEqual(db.aufrufe, [])
    }
  })

  test('bereits storniert: Fehler, nichts geschrieben', async () => {
    const t = vollerPosten()
    t.verkaufsposten[0].storniert = true
    const db = neueDb(t)
    const e = await fehlerVon(b.verkaufspostenStornieren(db, T, VP, G))
    assert.equal(e.message, 'Dieser Verkauf ist bereits storniert – der Bestand wurde schon zurückgebucht.')
    assert.deepEqual(schreibzugriffe(db), [])
  })

  test('Posten eines anderen Mandanten: „nicht gefunden“, nichts geschrieben', async () => {
    const t = vollerPosten()
    t.verkaufsposten[0].tenant_id = FREMD
    const db = neueDb(t)
    const e = await fehlerVon(b.verkaufspostenStornieren(db, T, VP, G))
    assert.equal(e.message, 'Verkauf nicht gefunden – bitte Seite neu laden.')
    assert.deepEqual(schreibzugriffe(db), [])
  })

  test('Lesefehler bei Posten, Positionen oder Traubenverkäufen: Abbruch vor dem ersten Schreibzugriff', async () => {
    const faelle = [
      ['verkaufsposten', 'Verkauf konnte nicht geladen werden: x'],
      ['verkauf_positionen', 'Positionen des Verkaufs konnten nicht geladen werden: x'],
      ['traubenverkauf', 'Traubenverkäufe des Verkaufs konnten nicht geladen werden: x'],
    ]
    for (const [tabelle, meldung] of faelle) {
      const db = neueDb(vollerPosten(), { vorher: fehlerBei(tabelle, 'select', { message: 'x' }) })
      const e = await fehlerVon(b.verkaufspostenStornieren(db, T, VP, G))
      assert.equal(e.message, meldung)
      assert.deepEqual(schreibzugriffe(db), [], tabelle)
    }
  })

  test('keine oder fremde Mitgliedschaft: „Kein aktiver Mandant“, nichts geschrieben', async () => {
    for (const m of [null, { ...admin, tenantId: FREMD }]) {
      globalThis.__membership = m
      const db = neueDb(vollerPosten())
      const e = await fehlerVon(b.verkaufspostenStornieren(db, T, VP, G))
      assert.equal(e.message, 'Kein aktiver Mandant gefunden')
      assert.deepEqual(schreibzugriffe(db), [])
    }
  })

  test('Mitarbeiter ohne Kellerbuch bei Tankposition: Rechte-Meldung mit Rechnungsnummer, nichts geschrieben', async () => {
    globalThis.__membership = winzer('warenwirtschaft')
    const db = neueDb(vollerPosten())
    const e = await fehlerVon(b.verkaufspostenStornieren(db, T, VP, G))
    assert.match(e.message, /^Die Rechnung RE-2026-001 enthält offenen Wein \(Tank\)/)
    assert.deepEqual(schreibzugriffe(db), [])
  })

  test('Mitarbeiter mit Warenwirtschaft, nur Flaschen: darf stornieren', async () => {
    globalThis.__membership = winzer('warenwirtschaft')
    const t = vollerPosten()
    t.verkauf_positionen = t.verkauf_positionen.filter(p => p.typ === 'flasche')
    const db = neueDb(t)
    await b.verkaufspostenStornieren(db, T, VP, G)
    assert.equal(zeile(db, 'verkaufsposten', VP).storniert, true)
  })

  test('Positionen ohne Bestandsbezug (Flasche ohne Füllung, Tank aus Zukauf/Pressung) werden nicht zurückgebucht', async () => {
    const t = vollerPosten()
    t.verkauf_positionen = [pos({ id: 'q1', menge: 12 }), pos({ id: 'q2', typ: 'tank', menge: 300 })]
    t.traubenverkauf = []
    t.ea_transaktionen = []
    const db = neueDb(t)
    await b.verkaufspostenStornieren(db, T, VP, G)
    assert.deepEqual(ablauf(db), ['update verkaufsposten', 'update aktivitaeten'])
  })

  test('Flaschenmenge mit Nachkommastellen (ältere Positionen) wird kaufmännisch gerundet', async () => {
    const t = vollerPosten()
    t.verkauf_positionen = [pos({ id: 'q1', fuellung_id: F1, menge: 2.6 }), pos({ id: 'q2', fuellung_id: F1, menge: '1.4' })]
    const db = neueDb(t)
    await b.verkaufspostenStornieren(db, T, VP, G)
    assert.equal(zeile(db, 'fuellungen', F1).bestand_flaschen, 4, 'round(2,6) + round(1,4) = 3 + 1')
  })

  test('Rückbuchung scheitert am Gebinde: Flaschen zurückgenommen, Posten nicht storniert', async () => {
    const db = neueDb(vollerPosten(), {
      vorher: fehlerBei('weinausbau', 'update', { code: 'P0001', message: 'Gebinde „T3“ ist durch Weingut Nachbar belegt.' }),
    })
    const e = await fehlerVon(b.verkaufspostenStornieren(db, T, VP, G))
    assert.equal(e.message, 'Der Verkauf konnte nicht storniert werden – der Bestand ließ sich nicht zurückbuchen: Charge „Grüner Veltliner 2025“: Gebinde „T3“ ist durch Weingut Nachbar belegt. Bitte das Gebinde freimachen bzw. Support kontaktieren. Es wurde nichts geändert.')
    assert.deepEqual(ablauf(db), [RPC_FLASCHEN, 'update weinausbau', RPC_FLASCHEN])
    assert.equal(zeile(db, 'fuellungen', F1).bestand_flaschen, 0)
    assert.equal(zeile(db, 'verkaufsposten', VP).storniert, false)
    assert.equal(db.tabellen.traubenverkauf.length, 3)
    assert.equal(db.tabellen.ea_transaktionen.length, 3)
  })

  test('Kennzeichen setzen scheitert (DB-Fehler): Rückbuchung zurückgenommen, „nichts geändert“', async () => {
    const db = neueDb(vollerPosten(), { vorher: fehlerBei('verkaufsposten', 'update', { message: 'boom' }) })
    const e = await fehlerVon(b.verkaufspostenStornieren(db, T, VP, G))
    assert.equal(e.message, 'Storno fehlgeschlagen (verkaufsposten): boom. Es wurde nichts geändert.')
    assert.deepEqual(ablauf(db), [RPC_FLASCHEN, 'update weinausbau', 'update verkaufsposten', 'update weinausbau', RPC_FLASCHEN])
    assert.equal(zeile(db, 'fuellungen', F1).bestand_flaschen, 0)
    assert.deepEqual(
      (({ menge_liter, aktiv, status }) => ({ menge_liter, aktiv, status }))(zeile(db, 'weinausbau', C1)),
      { menge_liter: 0, aktiv: false, status: 'abgeschlossen' })
  })

  test('gleichzeitiger Storno (zweiter Tab): Meldung „soeben bereits storniert“, eigene Rückbuchung zurückgenommen', async () => {
    const db = neueDb(vollerPosten(), {
      vorher: (e, t) => { if (e.tabelle === 'verkaufsposten' && e.art === 'update') t.verkaufsposten[0].storniert = true },
    })
    const e = await fehlerVon(b.verkaufspostenStornieren(db, T, VP, G))
    assert.equal(e.message, 'Dieser Verkauf wurde soeben bereits storniert – bitte Seite neu laden. Es wurde nichts geändert.')
    assert.equal(zeile(db, 'fuellungen', F1).bestand_flaschen, 0)
    assert.equal(zeile(db, 'weinausbau', C1).menge_liter, 0)
  })

  test('Kennzeichen still gefiltert (RLS): Meldung „Schreibberechtigung für Verkäufe“', async () => {
    const db = neueDb(vollerPosten(), { rls: (e, r) => !(e.tabelle === 'verkaufsposten' && e.art === 'update') || r.id !== VP })
    const e = await fehlerVon(b.verkaufspostenStornieren(db, T, VP, G))
    assert.equal(e.message, 'Der Verkauf konnte nicht storniert werden – vermutlich fehlt die Schreibberechtigung für Verkäufe. Es wurde nichts geändert.')
  })

  test('Kennzeichen scheitert und die Rücknahme auch: „Achtung“-Meldung', async () => {
    const db = neueDb(vollerPosten(), {
      vorher: fehlerBei('verkaufsposten', 'update', { message: 'boom' }),
      rpcFehler: nr => (nr === 2 ? { message: 'Lager weg' } : null),
    })
    const e = await fehlerVon(b.verkaufspostenStornieren(db, T, VP, G))
    assert.equal(e.message, 'Storno fehlgeschlagen (verkaufsposten): boom. Achtung: Der bereits zurückgebuchte Bestand konnte nicht zurückgesetzt werden (Flaschenbestand konnte nicht gebucht werden: Lager weg) – bitte Bestand prüfen und Support kontaktieren.')
    assert.equal(zeile(db, 'fuellungen', F1).bestand_flaschen, 12, 'Flaschen bleiben zurückgebucht, obwohl nicht storniert')
    assert.equal(zeile(db, 'verkaufsposten', VP).storniert, false)
  })

  test('Traubenverkauf-Storno scheitert: Rechnungsstorno bleibt, E&A und CRM laufen weiter, Sammelmeldung am Ende', async () => {
    const db = neueDb(vollerPosten(), { vorher: fehlerBei('traubenverkauf', 'update', { message: 'fk' }) })
    const e = await fehlerVon(b.verkaufspostenStornieren(db, T, VP, G))
    assert.equal(e.message, 'Der Verkauf ist storniert und der Bestand zurückgebucht, aber: Traubenverkauf (BKI) konnte nicht storniert werden: fk.')
    assert.equal(zeile(db, 'verkaufsposten', VP).storniert, true)
    assert.deepEqual(db.tabellen.ea_transaktionen.map(r => r.id), ['ea-offen', 'ea-gesperrt', 'ea-manuell'])
    assert.equal(zeile(db, 'aktivitaeten', 'akt-1').betreff, 'Verkauf RE-2026-001 · STORNIERT')
  })

  test('Traubenverkauf nur teilweise storniert (RLS) und Zahlungen nicht lesbar (Erstattung): beide Punkte, mit „ · “ verbunden', async () => {
    const db = neueDb(vollerPosten(), {
      rls: (e, r) => !(e.tabelle === 'traubenverkauf' && e.art === 'update' && r.id === TV1),
      vorher: fehlerBei('zahlungen', 'select', { message: 'timeout' }),
    })
    const e = await fehlerVon(b.verkaufspostenStornieren(db, T, VP, G, { erstattetAm: '2026-09-30' }))
    assert.equal(e.message, 'Der Verkauf ist storniert und der Bestand zurückgebucht, aber: Traubenverkauf (BKI) konnte nicht storniert werden – keine Schreibberechtigung. Bitte unter Warenwirtschaft › Traubenverkauf stornieren · Zahlungen des Verkaufs konnten nicht geladen werden: timeout.')
    assert.equal(zeile(db, 'traubenverkauf', TV1).storniert_am ?? null, null)
    assert.match(zeile(db, 'traubenverkauf', TV2).storniert_am ?? '', /^\d{4}-/)
  })

  test('ohne Traubenverkäufe: kein Traubenverkauf-Storno', async () => {
    const t = vollerPosten()
    t.verkauf_positionen = t.verkauf_positionen.filter(p => p.typ !== 'traube')
    t.traubenverkauf = []
    const db = neueDb(t)
    await b.verkaufspostenStornieren(db, T, VP, G)
    assert.ok(!schreibzugriffe(db).includes('update traubenverkauf'))
    assert.equal(zeile(db, 'verkaufsposten', VP).storniert, true)
  })

  // KAN-149 D2b (Ticket Frage 1): ohne Erstattung bleiben Zahlungen und Einnahmen stehen; mit Erstattung werden die
  // gültigen Zahlungen am Erstattungstag storniert (RPC s112_zahlung_stornieren bucht ihre Einnahmen gegen).
  test('ohne Erstattung: Zahlungen und E&A-Einnahmen bleiben unverändert', async () => {
    const t = vollerPosten()
    t.zahlungen = [{ id: 'za-1', tenant_id: T, verkaufsposten_id: VP, betrag: 50, storniert_am: null }]
    const db = neueDb(t)
    await b.verkaufspostenStornieren(db, T, VP, G)
    assert.equal(zeile(db, 'zahlungen', 'za-1').storniert_am, null)
    assert.ok(!db.aufrufe.some(a => a.art === 'rpc' && a.tabelle === 'rpc:s112_zahlung_stornieren'))
    assert.ok(!db.aufrufe.some(a => a.tabelle === 'ea_transaktionen' && a.art !== 'select'))
  })

  test('mit Erstattung: gültige Zahlungen des Postens am Erstattungstag storniert – mit Grund, stornierte und fremde nicht', async () => {
    const t = vollerPosten()
    t.zahlungen = [
      { id: 'za-1', tenant_id: T, verkaufsposten_id: VP, betrag: 50, storniert_am: null },
      { id: 'za-2', tenant_id: T, verkaufsposten_id: VP, betrag: 20, storniert_am: '2026-09-01T08:00:00Z' },
      { id: 'za-3', tenant_id: T, verkaufsposten_id: uuid(399), betrag: 10, storniert_am: null },
      { id: 'za-4', tenant_id: FREMD, verkaufsposten_id: VP, betrag: 10, storniert_am: null },
    ]
    const db = neueDb(t)
    await b.verkaufspostenStornieren(db, T, VP, G, { erstattetAm: '2026-09-30' })
    const rpcs = db.aufrufe.filter(a => a.tabelle === 'rpc:s112_zahlung_stornieren').map(a => a.werte)
    assert.deepEqual(rpcs, [{ p_tenant_id: T, p_zahlung_id: 'za-1', p_grund: `Erstattung – ${G}`, p_datum: '2026-09-30' }])
    assert.equal(zeile(db, 'zahlungen', 'za-3').storniert_am, null)
  })

  test('CRM-Fehler ist nicht kritisch: nur Konsolenmeldung, kein Fehler', async (t) => {
    const log = t.mock.method(console, 'error', () => {})
    const db = neueDb(vollerPosten(), { vorher: fehlerBei('aktivitaeten', 'update', { message: 'crm weg' }) })
    await b.verkaufspostenStornieren(db, T, VP, G)
    assert.equal(log.mock.callCount(), 1)
    assert.deepEqual(log.mock.calls[0].arguments, ['verkaufspostenStornieren – CRM-Aktivität:', 'crm weg'])
    assert.equal(zeile(db, 'verkaufsposten', VP).storniert, true)
  })
})
