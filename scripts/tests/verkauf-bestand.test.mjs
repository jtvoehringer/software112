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
//   fuellungBestandAendern        Flaschen: ganzzahlig, negativ, null-Bestand, RLS, Fehler
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
      message: 'Die Rechnung RE-2026-007 kann nur von einem Betriebs-Manager oder einem Mitarbeiter mit Freigabe Warenwirtschaft storniert werden (Weinhandel › Verkauf). Es wurde nichts geändert.',
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

describe('fuellungBestandAendern – Flaschenbestand', nurMitHooks, () => {
  test('Abgang: Vergleich auf den gelesenen Bestand, aktualisiert_am gesetzt, liefert neuen Bestand', async () => {
    const db = datenbank({ fuellungen: [fuellung(F1)] })
    const neu = await b.fuellungBestandAendern(db, T, F1, -12)
    assert.equal(neu, 108)
    const u = db.aufrufe[1]
    assert.equal(u.werte.bestand_flaschen, 108)
    assert.match(u.werte.aktualisiert_am, /^\d{4}-\d\d-\d\dT/)
    assert.ok(hatFilter(u, 'eq', 'bestand_flaschen', 120) && hatFilter(u, 'eq', 'tenant_id', T) && hatFilter(u, 'eq', 'id', F1))
    assert.deepEqual(ohneMandant(db, T), [])
  })

  test('nur ganze Stück – sonst Fehler ohne Datenbankzugriff', async () => {
    const db = datenbank({ fuellungen: [fuellung(F1)] })
    const e = await fehlerVon(b.fuellungBestandAendern(db, T, F1, 1.5))
    assert.equal(e.message, 'Flaschen können nur in ganzen Stück gebucht werden.')
    assert.deepEqual(db.aufrufe, [])
  })

  test('mehr als vorhanden: Fehler, kein UPDATE', async () => {
    const db = datenbank({ fuellungen: [fuellung(F1, { bestand_flaschen: 5 })] })
    const e = await fehlerVon(b.fuellungBestandAendern(db, T, F1, -6))
    assert.equal(e.message, '„Rosé 2025 0,75“: nur noch 5 Flaschen verfügbar, 6 angefragt.')
    assert.deepEqual(schreibzugriffe(db), [])
  })

  test('Bestand NULL zählt als 0 (IS NULL-Vergleich); Delta 0 schreibt trotzdem', async () => {
    const db = datenbank({ fuellungen: [fuellung(F1, { bestand_flaschen: null })] })
    assert.equal(await b.fuellungBestandAendern(db, T, F1, 6), 6)
    assert.ok(hatFilter(db.aufrufe[1], 'is', 'bestand_flaschen', null))
    const db2 = datenbank({ fuellungen: [fuellung(F1)] })
    assert.equal(await b.fuellungBestandAendern(db2, T, F1, 0), 120)
    assert.deepEqual(schreibzugriffe(db2), ['update fuellungen'])
  })

  test('nicht gefunden, fremder Mandant, Lese- und Schreibfehler', async () => {
    let e = await fehlerVon(b.fuellungBestandAendern(datenbank({ fuellungen: [fuellung(F1, { tenant_id: FREMD })] }), T, F1, -1))
    assert.equal(e.message, 'Füllung nicht gefunden – bitte Seite neu laden.')
    e = await fehlerVon(b.fuellungBestandAendern(datenbank({ fuellungen: [fuellung(F1)] }, { vorher: fehlerBei('fuellungen', 'select', { message: 'x' }) }), T, F1, -1))
    assert.equal(e.message, 'Flaschenbestand konnte nicht gelesen werden: x')
    e = await fehlerVon(b.fuellungBestandAendern(datenbank({ fuellungen: [fuellung(F1)] }, { vorher: fehlerBei('fuellungen', 'update', { message: 'y' }) }), T, F1, -1))
    assert.equal(e.message, 'Flaschenbestand von „Rosé 2025 0,75“ konnte nicht gespeichert werden: y')
  })

  test('still gefiltertes UPDATE: Meldung „Schreibberechtigung für das Lager“; ständige Änderung: Abbruch nach 4 Versuchen', async () => {
    let e = await fehlerVon(b.fuellungBestandAendern(datenbank({ fuellungen: [fuellung(F1)] }, { rls: a => a.art !== 'update' }), T, F1, -1))
    assert.equal(e.message, 'Der Flaschenbestand von „Rosé 2025 0,75“ konnte nicht geändert werden – vermutlich fehlt die Schreibberechtigung für das Lager')
    const db = datenbank({ fuellungen: [fuellung(F1)] }, { vorher: (a, t) => { if (a.art === 'update') t.fuellungen[0].bestand_flaschen += 1 } })
    e = await fehlerVon(b.fuellungBestandAendern(db, T, F1, -1))
    assert.equal(e.message, 'Der Flaschenbestand wurde gleichzeitig mehrfach geändert – bitte erneut versuchen.')
    assert.equal(db.aufrufe.length, 8)
  })
})

// ── Mehrere Buchungen ─────────────────────────────────────────────────────────

describe('bestandBuchenAllesOderNichts und bestandsBuchungenZuruecknehmen', nurMitHooks, () => {
  const tabellen = () => ({
    weinausbau: [charge(C1), charge(C2, { name: 'Zweigelt 2024', menge_liter: 50 })],
    fuellungen: [fuellung(F1), fuellung(F2, { name: 'Sekt', bestand_flaschen: 10 })],
  })

  test('erst alle Flaschen, dann alle Chargen; 0 Stück und Liter unter 0,0005 werden übersprungen', async () => {
    const db = datenbank(tabellen())
    const r = await b.bestandBuchenAllesOderNichts(db, T,
      new Map([[C1, -20], [C2, 0.0004]]),
      new Map([[F1, -6], [F2, 0]]))
    assert.deepEqual(schreibzugriffe(db), ['update fuellungen', 'update weinausbau'])
    assert.deepEqual(r.map(x => x.art), ['flasche', 'charge'])
    assert.deepEqual(r[0], { art: 'flasche', fuellungId: F1, stueck: -6 })
    assert.equal(r[1].buchung.id, C1)
    assert.equal(zeile(db, 'fuellungen', F1).bestand_flaschen, 114)
    assert.equal(zeile(db, 'weinausbau', C1).menge_liter, 80)
    assert.equal(zeile(db, 'weinausbau', C2).menge_liter, 50)
  })

  test('zweite Charge reicht nicht: alles in umgekehrter Reihenfolge zurück, Meldung mit Punkt', async () => {
    const db = datenbank(tabellen())
    const e = await fehlerVon(b.bestandBuchenAllesOderNichts(db, T, new Map([[C1, -20], [C2, -60]]), new Map([[F1, -6]])))
    assert.equal(e.message, '„Zweigelt 2024“: nur noch 50 L verfügbar, 60 L angefragt.')
    assert.deepEqual(schreibzugriffe(db), ['update fuellungen', 'update weinausbau', 'update weinausbau', 'update fuellungen'])
    assert.deepEqual(db.tabellen.weinausbau.map(c => c.menge_liter), [100, 50])
    assert.equal(zeile(db, 'fuellungen', F1).bestand_flaschen, 120)
  })

  test('Rücknahme scheitert auch: „Achtung“-Meldung mit den offenen Punkten', async () => {
    // 1. update fuellungen (Abgang) ok, 2. update weinausbau C1 → Fehler, Rücknahme der Flaschen → 2. update fuellungen Fehler
    const f1 = fehlerBei('weinausbau', 'update', { message: 'Charge kaputt' })
    const f2 = fehlerBei('fuellungen', 'update', { message: 'Lager kaputt' }, 2)
    const db = datenbank(tabellen(), { vorher: (e, t) => f1(e, t) ?? f2(e, t) })
    const e = await fehlerVon(b.bestandBuchenAllesOderNichts(db, T, new Map([[C1, -20]]), new Map([[F1, -6]])))
    assert.equal(e.message, 'Bestand der Charge „Grüner Veltliner 2025“ konnte nicht gespeichert werden: Charge kaputt. Achtung: Bereits gebuchte Bestände konnten nicht zurückgesetzt werden (Flaschenbestand von „Rosé 2025 0,75“ konnte nicht gespeichert werden: Lager kaputt) – bitte Bestand prüfen und Support kontaktieren.')
    assert.equal(zeile(db, 'fuellungen', F1).bestand_flaschen, 114, 'Abgang bleibt stehen')
  })

  test('bestandsBuchungenZuruecknehmen: umgekehrte Reihenfolge, sammelt Fehler und macht weiter', async () => {
    const db = datenbank(tabellen())
    const buchungen = await b.bestandBuchenAllesOderNichts(db, T, new Map([[C1, -20]]), new Map([[F1, -6], [F2, -2]]))
    zeile(db, 'fuellungen', F2).tenant_id = FREMD // F2 nicht mehr sichtbar → Rücknahme scheitert
    const fehler = await b.bestandsBuchungenZuruecknehmen(db, T, buchungen)
    assert.deepEqual(fehler, ['Füllung nicht gefunden – bitte Seite neu laden'])
    assert.deepEqual(schreibzugriffe(db).slice(3), ['update weinausbau', 'update fuellungen'])
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
    const db = datenbank(t, opt)
    globalThis.__adminFake = db
    globalThis.__serverFake = db
    return db
  }
  beforeEach(() => { globalThis.__membership = admin })

  test('Normalfall: Flaschen und Liter zurück, storniert, Traubenverkäufe und offene E&A-Einnahme weg, CRM markiert', async () => {
    const db = neueDb(vollerPosten())
    await b.verkaufspostenStornieren(db, T, VP)
    assert.deepEqual(schreibzugriffe(db), [
      'update fuellungen', 'update weinausbau', 'update verkaufsposten',
      'update traubenverkauf', 'delete ea_transaktionen', 'update aktivitaeten',
    ])
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
      assert.equal(zeile(db, 'traubenverkauf', id).storno_grund, 'Rechnung RE-2026-001 storniert')
    }
    assert.equal(zeile(db, 'traubenverkauf', TV3).storniert_am ?? null, null)
    const tvStorno = db.aufrufe.find(a => a.art === 'update' && a.tabelle === 'traubenverkauf')
    assert.deepEqual(tvStorno.filter.find(f => f[0] === 'in'), ['in', 'id', [TV2, TV1]], 'erst über verkaufsposten_id, dann über die Position')
    assert.ok(hatFilter(tvStorno, 'is', 'storniert_am', null), 'nur noch nicht stornierte')
    assert.deepEqual(db.tabellen.ea_transaktionen.map(r => r.id), ['ea-gesperrt', 'ea-manuell'],
      'Befund (KAN-149): gesperrte Einnahme bleibt ohne Meldung stehen – eigener Test unten')
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
    await b.verkaufspostenStornieren(db, T, VP)
    assert.equal(zeile(db, 'aktivitaeten', 'akt-1').betreff, 'Verkauf  · STORNIERT')
  })

  test('bereits storniert: Fehler, nichts geschrieben', async () => {
    const t = vollerPosten()
    t.verkaufsposten[0].storniert = true
    const db = neueDb(t)
    const e = await fehlerVon(b.verkaufspostenStornieren(db, T, VP))
    assert.equal(e.message, 'Dieser Verkauf ist bereits storniert – der Bestand wurde schon zurückgebucht.')
    assert.deepEqual(schreibzugriffe(db), [])
  })

  test('Posten eines anderen Mandanten: „nicht gefunden“, nichts geschrieben', async () => {
    const t = vollerPosten()
    t.verkaufsposten[0].tenant_id = FREMD
    const db = neueDb(t)
    const e = await fehlerVon(b.verkaufspostenStornieren(db, T, VP))
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
      const e = await fehlerVon(b.verkaufspostenStornieren(db, T, VP))
      assert.equal(e.message, meldung)
      assert.deepEqual(schreibzugriffe(db), [], tabelle)
    }
  })

  test('keine oder fremde Mitgliedschaft: „Kein aktiver Mandant“, nichts geschrieben', async () => {
    for (const m of [null, { ...admin, tenantId: FREMD }]) {
      globalThis.__membership = m
      const db = neueDb(vollerPosten())
      const e = await fehlerVon(b.verkaufspostenStornieren(db, T, VP))
      assert.equal(e.message, 'Kein aktiver Mandant gefunden')
      assert.deepEqual(schreibzugriffe(db), [])
    }
  })

  test('Mitarbeiter ohne Kellerbuch bei Tankposition: Rechte-Meldung mit Rechnungsnummer, nichts geschrieben', async () => {
    globalThis.__membership = winzer('warenwirtschaft')
    const db = neueDb(vollerPosten())
    const e = await fehlerVon(b.verkaufspostenStornieren(db, T, VP))
    assert.match(e.message, /^Die Rechnung RE-2026-001 enthält offenen Wein \(Tank\)/)
    assert.deepEqual(schreibzugriffe(db), [])
  })

  test('Mitarbeiter mit Warenwirtschaft, nur Flaschen: darf stornieren', async () => {
    globalThis.__membership = winzer('warenwirtschaft')
    const t = vollerPosten()
    t.verkauf_positionen = t.verkauf_positionen.filter(p => p.typ === 'flasche')
    const db = neueDb(t)
    await b.verkaufspostenStornieren(db, T, VP)
    assert.equal(zeile(db, 'verkaufsposten', VP).storniert, true)
  })

  test('Positionen ohne Bestandsbezug (Flasche ohne Füllung, Tank aus Zukauf/Pressung) werden nicht zurückgebucht', async () => {
    const t = vollerPosten()
    t.verkauf_positionen = [pos({ id: 'q1', menge: 12 }), pos({ id: 'q2', typ: 'tank', menge: 300 })]
    t.traubenverkauf = []
    t.ea_transaktionen = []
    const db = neueDb(t)
    await b.verkaufspostenStornieren(db, T, VP)
    assert.deepEqual(schreibzugriffe(db), ['update verkaufsposten', 'update aktivitaeten'])
  })

  test('Flaschenmenge mit Nachkommastellen (ältere Positionen) wird kaufmännisch gerundet', async () => {
    const t = vollerPosten()
    t.verkauf_positionen = [pos({ id: 'q1', fuellung_id: F1, menge: 2.6 }), pos({ id: 'q2', fuellung_id: F1, menge: '1.4' })]
    const db = neueDb(t)
    await b.verkaufspostenStornieren(db, T, VP)
    assert.equal(zeile(db, 'fuellungen', F1).bestand_flaschen, 4, 'round(2,6) + round(1,4) = 3 + 1')
  })

  test('Rückbuchung scheitert am Gebinde: Flaschen zurückgenommen, Posten nicht storniert', async () => {
    const db = neueDb(vollerPosten(), {
      vorher: fehlerBei('weinausbau', 'update', { code: 'P0001', message: 'Gebinde „T3“ ist durch Weingut Nachbar belegt.' }),
    })
    const e = await fehlerVon(b.verkaufspostenStornieren(db, T, VP))
    assert.equal(e.message, 'Der Verkauf konnte nicht storniert werden – der Bestand ließ sich nicht zurückbuchen: Charge „Grüner Veltliner 2025“: Gebinde „T3“ ist durch Weingut Nachbar belegt. Bitte das Gebinde freimachen bzw. Support kontaktieren. Es wurde nichts geändert.')
    assert.deepEqual(schreibzugriffe(db), ['update fuellungen', 'update weinausbau', 'update fuellungen'])
    assert.equal(zeile(db, 'fuellungen', F1).bestand_flaschen, 0)
    assert.equal(zeile(db, 'verkaufsposten', VP).storniert, false)
    assert.equal(db.tabellen.traubenverkauf.length, 3)
    assert.equal(db.tabellen.ea_transaktionen.length, 3)
  })

  test('Kennzeichen setzen scheitert (DB-Fehler): Rückbuchung zurückgenommen, „nichts geändert“', async () => {
    const db = neueDb(vollerPosten(), { vorher: fehlerBei('verkaufsposten', 'update', { message: 'boom' }) })
    const e = await fehlerVon(b.verkaufspostenStornieren(db, T, VP))
    assert.equal(e.message, 'Storno fehlgeschlagen (verkaufsposten): boom. Es wurde nichts geändert.')
    assert.deepEqual(schreibzugriffe(db), ['update fuellungen', 'update weinausbau', 'update verkaufsposten', 'update weinausbau', 'update fuellungen'])
    assert.equal(zeile(db, 'fuellungen', F1).bestand_flaschen, 0)
    assert.deepEqual(
      (({ menge_liter, aktiv, status }) => ({ menge_liter, aktiv, status }))(zeile(db, 'weinausbau', C1)),
      { menge_liter: 0, aktiv: false, status: 'abgeschlossen' })
  })

  test('gleichzeitiger Storno (zweiter Tab): Meldung „soeben bereits storniert“, eigene Rückbuchung zurückgenommen', async () => {
    const db = neueDb(vollerPosten(), {
      vorher: (e, t) => { if (e.tabelle === 'verkaufsposten' && e.art === 'update') t.verkaufsposten[0].storniert = true },
    })
    const e = await fehlerVon(b.verkaufspostenStornieren(db, T, VP))
    assert.equal(e.message, 'Dieser Verkauf wurde soeben bereits storniert – bitte Seite neu laden. Es wurde nichts geändert.')
    assert.equal(zeile(db, 'fuellungen', F1).bestand_flaschen, 0)
    assert.equal(zeile(db, 'weinausbau', C1).menge_liter, 0)
  })

  test('Kennzeichen still gefiltert (RLS): Meldung „Schreibberechtigung für Verkäufe“', async () => {
    const db = neueDb(vollerPosten(), { rls: (e, r) => !(e.tabelle === 'verkaufsposten' && e.art === 'update') || r.id !== VP })
    const e = await fehlerVon(b.verkaufspostenStornieren(db, T, VP))
    assert.equal(e.message, 'Der Verkauf konnte nicht storniert werden – vermutlich fehlt die Schreibberechtigung für Verkäufe. Es wurde nichts geändert.')
  })

  test('Kennzeichen scheitert und die Rücknahme auch: „Achtung“-Meldung', async () => {
    const f1 = fehlerBei('verkaufsposten', 'update', { message: 'boom' })
    const f2 = fehlerBei('fuellungen', 'update', { message: 'Lager weg' }, 2)
    const db = neueDb(vollerPosten(), { vorher: (e, t) => f1(e, t) ?? f2(e, t) })
    const e = await fehlerVon(b.verkaufspostenStornieren(db, T, VP))
    assert.equal(e.message, 'Storno fehlgeschlagen (verkaufsposten): boom. Achtung: Der bereits zurückgebuchte Bestand konnte nicht zurückgesetzt werden (Flaschenbestand von „Rosé 2025 0,75“ konnte nicht gespeichert werden: Lager weg) – bitte Bestand prüfen und Support kontaktieren.')
    assert.equal(zeile(db, 'fuellungen', F1).bestand_flaschen, 12, 'Flaschen bleiben zurückgebucht, obwohl nicht storniert')
    assert.equal(zeile(db, 'verkaufsposten', VP).storniert, false)
  })

  test('Traubenverkauf-Storno scheitert: Rechnungsstorno bleibt, E&A und CRM laufen weiter, Sammelmeldung am Ende', async () => {
    const db = neueDb(vollerPosten(), { vorher: fehlerBei('traubenverkauf', 'update', { message: 'fk' }) })
    const e = await fehlerVon(b.verkaufspostenStornieren(db, T, VP))
    assert.equal(e.message, 'Der Verkauf ist storniert und der Bestand zurückgebucht, aber: Traubenverkauf (BKI) konnte nicht storniert werden: fk.')
    assert.equal(zeile(db, 'verkaufsposten', VP).storniert, true)
    assert.deepEqual(db.tabellen.ea_transaktionen.map(r => r.id), ['ea-gesperrt', 'ea-manuell'],
      'Befund (KAN-149): die gesperrte Einnahme fehlt auch in der Sammelmeldung')
    assert.equal(zeile(db, 'aktivitaeten', 'akt-1').betreff, 'Verkauf RE-2026-001 · STORNIERT')
  })

  test('Traubenverkauf nur teilweise storniert (RLS) und E&A-Lesefehler: beide Punkte, mit „ · “ verbunden', async () => {
    const db = neueDb(vollerPosten(), {
      rls: (e, r) => !(e.tabelle === 'traubenverkauf' && e.art === 'update' && r.id === TV1),
      vorher: fehlerBei('ea_transaktionen', 'select', { message: 'timeout' }),
    })
    const e = await fehlerVon(b.verkaufspostenStornieren(db, T, VP))
    assert.equal(e.message, 'Der Verkauf ist storniert und der Bestand zurückgebucht, aber: Traubenverkauf (BKI) konnte nicht storniert werden – keine Schreibberechtigung. Bitte unter Weinhandel › Traubenverkauf stornieren · E&A-Einnahmen des Verkaufs konnten nicht geladen werden: timeout – bitte in der E&A-Rechnung prüfen, sonst stimmt die UVA nicht.')
    assert.equal(zeile(db, 'traubenverkauf', TV1).storniert_am ?? null, null)
    assert.match(zeile(db, 'traubenverkauf', TV2).storniert_am ?? '', /^\d{4}-/)
  })

  test('ohne Traubenverkäufe: kein Traubenverkauf-Storno', async () => {
    const t = vollerPosten()
    t.verkauf_positionen = t.verkauf_positionen.filter(p => p.typ !== 'traube')
    t.traubenverkauf = []
    const db = neueDb(t)
    await b.verkaufspostenStornieren(db, T, VP)
    assert.ok(!schreibzugriffe(db).includes('update traubenverkauf'))
    assert.equal(zeile(db, 'verkaufsposten', VP).storniert, true)
  })

  // Befund: verkaufspostenStornieren wertet `gesperrt: true` aus ersetzeVerkaufsEinnahmen nicht
  // aus (bestand.ts, Block 4a) – kein Punkt in `probleme`, kein Hinweis in der Storno-Abfrage.
  // Die E&A bzw. die schon übermittelte UVA ist danach zu hoch. Der Storno-Umbau KAN-149 soll
  // hier eine Gegenbuchung anlegen: Dann ändert sich dieser Test bewusst.
  test('Befund: gesperrte E&A-Einnahme (übermittelte UVA) bleibt nach dem Storno ohne Meldung stehen – Gegenbuchung offen (KAN-149)', async () => {
    const db = neueDb(vollerPosten())
    await b.verkaufspostenStornieren(db, T, VP) // löst keinen Fehler aus, also keine Meldung
    assert.equal(zeile(db, 'verkaufsposten', VP).storniert, true)
    assert.ok(zeile(db, 'ea_transaktionen', 'ea-gesperrt'), 'gesperrte Einnahme bleibt stehen')
    const eaSchreib = db.aufrufe.filter(a => a.tabelle === 'ea_transaktionen' && a.art !== 'select')
    assert.deepEqual(eaSchreib.map(a => [a.art, a.getroffen]), [['delete', ['ea-offen']]], 'nur die offene entfernt, keine Gegenbuchung')

    // nur gesperrte Einnahmen: gar kein E&A-Schreibzugriff, ebenfalls ohne Meldung
    const t = vollerPosten()
    t.ea_transaktionen = [{ ...t.ea_transaktionen[1] }]
    const db2 = neueDb(t)
    await b.verkaufspostenStornieren(db2, T, VP)
    assert.deepEqual(db2.tabellen.ea_transaktionen.map(r => r.id), ['ea-gesperrt'])
    assert.ok(!schreibzugriffe(db2).some(z => z.endsWith(' ea_transaktionen')))
  })

  test('CRM-Fehler ist nicht kritisch: nur Konsolenmeldung, kein Fehler', async (t) => {
    const log = t.mock.method(console, 'error', () => {})
    const db = neueDb(vollerPosten(), { vorher: fehlerBei('aktivitaeten', 'update', { message: 'crm weg' }) })
    await b.verkaufspostenStornieren(db, T, VP)
    assert.equal(log.mock.callCount(), 1)
    assert.deepEqual(log.mock.calls[0].arguments, ['verkaufspostenStornieren – CRM-Aktivität:', 'crm weg'])
    assert.equal(zeile(db, 'verkaufsposten', VP).storniert, true)
  })
})
