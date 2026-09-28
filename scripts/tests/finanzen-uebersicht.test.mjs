// Charakterisierungstests (28.09.2026, STABILITAET.md Stufe 3 Punkt 2) für
// src/lib/finanzen/uebersicht.ts – Finanzübersicht „Wo stehe ich?“ (/buchhaltung/uebersicht,
// Dashboard-Kachel, SVS-Vorschlag). Hält das HEUTIGE Verhalten fest, fragwürdige Stellen sind mit
// „Befund“ markiert und nicht korrigiert.
//
// Abgedeckt: laufendes Jahr gegen Vorjahr bis zum Stichtag, Monatsverlauf, AfA-Buchungen und
// Anlagenkäufe (Kontenklasse 0), Kategorien-Rangliste, Umsatz aus Rechnungen (netto, Rabatte,
// ohne Storno/inaktiv), Forderungen und Überfälligkeit, Liquidität aus Konten (Zahlungen,
// E&A-Buchungen aller Jahre, Umbuchungen), UVA-Stand monatlich/quartalsweise samt Fälligkeit,
// Monatsabschluss, Belege, Doppik-Übergabe, abgelaufenes Jahr, Mandantenfilter (über getCtx),
// Verhalten bei Datenbankfehlern und die Zeitzonen-Abhängigkeit der Fälligkeit.
//
// Aufruf: npm run -s test:csv  (Node ≥ 22.15 wegen module.registerHooks)

import { test, describe, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { hooksRegistrieren, laden, nurMitHooks, hooksMoeglich, datenbank, ohneMandant, fehlerBei } from './buchung-attrappe.mjs'

hooksRegistrieren()
const [fin, dash] = hooksMoeglich
  ? await Promise.all([laden('lib/finanzen/uebersicht.ts'), laden('app/(dashboard)/dashboard/_shared/data.ts')])
  : []

const T = 'tenant-1'
const FREMD = 'tenant-2'
const HEUTE = new Date('2026-09-28T12:00:00.000Z')
const TZ_VORHER = process.env.TZ

const kat = (name, konto_nr) => ({ name, konto_nr })
const tx = (id, datum, typ, netto, teil) => ({
  id, tenant_id: T, datum, typ, betrag_netto: netto, betrag_brutto: null, kategorie_id: `kat-${id}`, konto_id: null,
  bmd_export_id: null, anlage_id: null, kategorie: kat('Sonstiges', 7800), ...teil,
})
const vpos = (preis_brutto, menge, ust_satz, teil) => ({ preis_brutto, menge, rabatt_pct: 0, sonderrabatt_pct: 0, ust_satz, ...teil })
const vp = (id, datum, positionen, teil) => ({ id, tenant_id: T, datum, bezahlt: false, aktiv: true, storniert: false, bmd_export_id: null, verkauf_positionen: positionen, ...teil })

const tabellen = () => ({
  tenants: [{ id: T, name: 'Weingut Test' }],
  ea_transaktionen: [
    tx('t1', '2026-01-15', 'einnahme', 1000, { kategorie: kat('Weinverkauf', 4000), betrag_brutto: 1130, konto_id: 'k1' }),
    tx('t2', '2026-02-10', 'ausgabe', 300, { kategorie: kat('Material', 7000), betrag_brutto: 360, konto_id: 'k2', bmd_export_id: 'exp-1' }),
    tx('t3', '2026-10-05', 'einnahme', 999, { kategorie: kat('Weinverkauf', 4000) }),                    // nach dem Stichtag
    tx('t4', '2025-03-01', 'einnahme', 800, { kategorie: kat('Weinverkauf', 4000) }),
    tx('t5', '2025-11-20', 'ausgabe', 200, { kategorie: kat('Material', 7000) }),                         // Vorjahr nach Stichtag
    tx('t6', '2026-06-30', 'ausgabe', 50, { anlage_id: 'anl-1', kategorie: kat('Abschreibung (AfA)', 7010) }),
    tx('t7', '2026-04-01', 'ausgabe', 2000, { kategorie: kat('Traktor', '0620') }),                        // Anlagenkauf
    tx('t8', '2026-05-05', 'einnahme', 40, { kategorie_id: null, kategorie: null }),
    tx('t9', '2026-05-06', 'ausgabe', 15, { kategorie_id: null, kategorie: null }),
    tx('t10', '2026-03-03', 'einnahme', 5000, { tenant_id: FREMD, konto_id: 'k1', betrag_brutto: 5000 }),
    tx('t11', '2024-12-31', 'einnahme', 7, { betrag_brutto: 7, konto_id: 'k1' }),                          // vor dem Zeitraum, zählt nur für Konten
    tx('t12', '2025-06-01', 'ausgabe', 500, { kategorie: kat('Betriebsausstattung', '0400') }),            // Anlagenkauf Vorjahr
    tx('t13', '2020-01-01', 'ausgabe', 10, { betrag_brutto: 10, konto_id: 'k1' }),
  ],
  verkaufsposten: [
    vp('vp1', '2026-03-01', [vpos(11.3, 10, 13)]),                                                     // netto 100, brutto 113, überfällig
    vp('vp2', '2026-09-20', [vpos(24, 5, 20, { rabatt_pct: 10 })]),                                    // brutto 108, netto 90
    vp('vp3', '2026-05-01', [vpos(120, 1, 20)], { bezahlt: true, bmd_export_id: 'x' }),                // netto 100
    vp('vp4', '2026-04-01', [vpos(1000, 1, 20)], { storniert: true }),
    vp('vp5', '2026-04-02', [vpos(1000, 1, 20)], { aktiv: false }),
    vp('vp6', '2025-02-01', [vpos(110, 1, 10)]),                                                       // Vorjahr, netto 100, überfällig
    vp('vp7', '2026-10-01', [vpos(10, 1, 0)]),                                                         // nach dem Stichtag
    vp('vp8', '2026-03-01', [vpos(1000, 1, 20)], { tenant_id: FREMD }),
    vp('vp9', '2024-06-01', [vpos(500, 1, 20)]),                                                       // alte offene Rechnung
  ],
  konten: [
    { id: 'k1', tenant_id: T, name: 'Bank', typ: 'bank', eroeffnungssaldo: 1000, sortierung: 1, aktiv: true },
    { id: 'k2', tenant_id: T, name: 'Kassa', typ: null, eroeffnungssaldo: '200', sortierung: 2, aktiv: true },
    { id: 'k3', tenant_id: T, name: 'Altkonto', typ: 'bank', eroeffnungssaldo: 5000, sortierung: 3, aktiv: false },
    { id: 'kf', tenant_id: FREMD, name: 'Fremd', typ: 'bank', eroeffnungssaldo: 9999, sortierung: 0, aktiv: true },
  ],
  zahlungen: [
    { id: 'z1', tenant_id: T, betrag: 300, konto_id: 'k1' },
    { id: 'z2', tenant_id: T, betrag: 50, konto_id: null },
    { id: 'z3', tenant_id: T, betrag: 70, konto_id: 'k3' },
    { id: 'z4', tenant_id: FREMD, betrag: 1, konto_id: 'k1' },
  ],
  konto_umbuchungen: [{ id: 'u1', tenant_id: T, betrag: 100, von_konto_id: 'k1', nach_konto_id: 'k2' }],
  ea_uva: [{ id: 'uva1', tenant_id: T, jahr: 2026, zeitraum: '08', zahllast: '1234.5', gesperrt: true }],
  ea_monatsabschluss: [1, 2, 3, 4, 5, 6].map(m => ({ id: `ma${m}`, tenant_id: T, jahr: 2026, monat: m }))
    .concat([{ id: 'ma-vj', tenant_id: T, jahr: 2025, monat: 12 }, { id: 'ma-f', tenant_id: FREMD, jahr: 2026, monat: 8 }]),
  ea_belege: [
    { id: 'b1', tenant_id: T, status: 'erkannt' }, { id: 'b2', tenant_id: T, status: 'erkannt' },
    { id: 'b3', tenant_id: T, status: 'gebucht' }, { id: 'b4', tenant_id: FREMD, status: 'erkannt' },
  ],
  buchhaltung_export_protokoll: [
    { id: 'e1', tenant_id: T, art: 'rechnungen', erstellt_am: '2026-08-01T10:00:00Z', anzahl: 12 },
    { id: 'e2', tenant_id: T, art: 'belege', erstellt_am: '2026-09-01T10:00:00Z', anzahl: '7' },
    { id: 'e3', tenant_id: FREMD, art: 'belege', erstellt_am: '2026-09-27T10:00:00Z', anzahl: 1 },
  ],
  ea_anlagen: [{
    id: 'anl-1', tenant_id: T, name: 'Traktor', gruppe: null, konto_nr: '0620', anschaffung_am: '2026-04-01', ak_netto: '10000',
    nutzungsdauer_jahre: 5, methode: 'linear', degressiv_satz: null, restwert: null, abgang_am: null, veraeusserungserloes: null, transaktion_id: null,
  }],
})

async function ctxFuer(db, heute = HEUTE) {
  globalThis.__serverFake = db
  globalThis.__membership = { tenantId: T, role: 'tenant_admin', schreibmodule: [] }
  const ctx = await dash.getCtx()
  return { ...ctx, heute, heuteStr: dash.toDateStr(heute) }
}

async function lade(opts = {}, t = tabellen(), dbOpt) {
  const db = datenbank(t, dbOpt)
  const ctx = await ctxFuer(db, opts.heute)
  const r = await fin.ladeFinanzen(ctx, { art: 'ea', uvaZeitraum: 'monatlich', ...opts, heute: undefined })
  return { db, r }
}

describe('ladeFinanzen – Finanzübersicht', nurMitHooks, () => {
  beforeEach(() => { process.env.TZ = 'UTC' })
  afterEach(() => { if (TZ_VORHER === undefined) delete process.env.TZ; else process.env.TZ = TZ_VORHER })

  test('laufendes Jahr: Stichtag heute, Vorjahr bis zum gleichen Tag, AfA getrennt, Fremddaten nicht', async () => {
    const { r } = await lade()
    assert.equal(r.art, 'ea')
    assert.equal(r.jahr, 2026)
    assert.equal(r.stichtag, '2026-09-28')
    assert.deepEqual(r.ytd, { einnahmen: 1040, ausgaben: 2315, ergebnis: -1275, einnahmenVj: 800, ausgabenVj: 500, ergebnisVj: 300 })
    assert.deepEqual(r.gesamtVj, { einnahmen: 800, ausgaben: 700, ergebnis: 100 })
    const m = Object.fromEntries(r.monate.filter(x => x.einnahmen || x.ausgaben || x.einnahmenVj || x.ausgabenVj).map(x => [x.monat, [x.einnahmen, x.ausgaben, x.einnahmenVj, x.ausgabenVj]]))
    assert.deepEqual(m, { 1: [1000, 0, 0, 0], 2: [0, 300, 0, 0], 3: [0, 0, 800, 0], 4: [0, 2000, 0, 0], 5: [40, 15, 0, 0], 6: [0, 0, 0, 500], 11: [0, 0, 0, 200] })
    assert.equal(r.monate.length, 12)
    assert.deepEqual(r.belege, { zuBuchen: 2, ohneKategorie: 2, buchungenJahr: 5 })
  })

  test('Befund: Buchungen ohne Kategorie landen in EINEM Topf „–“ – Einnahmen und Ausgaben werden addiert, Typ vom ersten Treffer', async () => {
    const { r } = await lade()
    assert.deepEqual(r.kategorien.einnahmen, [
      { name: 'Weinverkauf', betrag: 1000, vj: 800 },
      { name: '–', betrag: 55, vj: 0 },  // 40 € Einnahme + 15 € Ausgabe
    ])
    assert.deepEqual(r.kategorien.ausgaben, [
      { name: 'Traktor', betrag: 2000, vj: 0 },
      { name: 'Material', betrag: 300, vj: 0 },
      { name: 'Betriebsausstattung', betrag: 0, vj: 500 },
    ])
  })

  test('Kategorien-Rangliste: höchstens 6 je Typ, absteigend nach laufendem Jahr', async () => {
    const t = tabellen()
    t.ea_transaktionen = Array.from({ length: 8 }, (_, i) => tx(`k${i}`, '2026-03-01', 'ausgabe', 10 * (i + 1), { kategorie: kat(`Kat ${i}`, 7000) }))
    const { r } = await lade({}, t)
    assert.deepEqual(r.kategorien.ausgaben.map(k => k.name), ['Kat 7', 'Kat 6', 'Kat 5', 'Kat 4', 'Kat 3', 'Kat 2'])
    assert.deepEqual(r.kategorien.einnahmen, [])
  })

  test('Anlagevermögen: AfA-Buchung, Anlagenkäufe, Buchwert und steuerliches Ergebnis', async () => {
    const { r } = await lade()
    assert.deepEqual(r.anlagen, {
      imVerzeichnis: 1, anzahlAktiv: 1, buchwert: 10000, // Buchwert bleibt im Anschaffungsjahr bis 31.12. konstant
      anschaffungskosten: 10000, kumulierteAfa: 2000,
      afaJahr: 2000, afaGebuchtJahr: 50, afaVj: 0, // afaJahr = Plan-AfA des ganzen Jahres, nicht anteilig
      anlagenkaeufeJahr: 2000, anlagenkaeufeVj: 500,
      ergebnisNachAfa: -1275, ergebnisNachAfaVj: 800, ergebnisNachAfaVjGesamt: 600,
      offeneKaeufe: 1,
    })
    const t = tabellen()
    t.ea_anlagen[0].transaktion_id = 't7'
    assert.equal((await lade({}, t)).r.anlagen.offeneKaeufe, 0, 'mit der Anlage verknüpfter Kauf ist nicht offen')
  })

  test('Umsatz aus Rechnungen: netto nach Rabatt, ohne Storno/inaktiv/fremd, bis zum Stichtag', async () => {
    const { r } = await lade()
    assert.equal(Math.round(r.umsatz.ytd * 100) / 100, 290)
    assert.equal(Math.round(r.umsatz.vj * 100) / 100, 100)
  })

  test('Forderungen: offene Rechnungen brutto; überfällig nach 30 Tagen; Befund: nur Rechnungen ab 1.1. des Vorjahres, auch nach dem Stichtag datierte', async () => {
    const { r } = await lade()
    assert.equal(r.forderungen.anzahl, 4, 'vp1, vp2, vp6, vp7 – die offene Rechnung vp9 aus 2024 fehlt')
    assert.equal(Math.round(r.forderungen.summe * 100) / 100, 341)
    assert.equal(r.forderungen.ueberfaellig, 2)
    assert.equal(Math.round(r.forderungen.ueberfaelligSumme * 100) / 100, 223)
  })

  test('Liquidität: Eröffnungssaldo + Zahlungen + E&A-Buchungen aller Jahre (brutto, Vorzeichen) ± Umbuchungen, nur aktive Konten', async () => {
    const { r } = await lade()
    assert.deepEqual(r.liquiditaet, {
      summe: 2267,
      konten: [
        // 1000 Eröffnung + 300 Zahlung + 1130 Einnahme 2026 + 7 Einnahme 2024 − 10 Ausgabe 2020 − 100 Umbuchung
        { id: 'k1', name: 'Bank', typ: 'bank', saldo: 2327 },
        // '200' (Text) Eröffnung − 360 Ausgabe + 100 Umbuchung
        { id: 'k2', name: 'Kassa', typ: '', saldo: -60 },
      ],
    })
  })

  test('UVA monatlich: letzter abgeschlossener Monat, Status aus ea_uva, Fälligkeit 15. des Zweitfolgemonats', async () => {
    const { r } = await lade()
    assert.deepEqual(r.uva, { label: 'Aug 2026', status: 'uebermittelt', zahllast: 1234.5, faelligAm: '2026-10-15' })
    const t = tabellen()
    t.ea_uva[0].gesperrt = false
    assert.equal((await lade({}, t)).r.uva.status, 'entwurf')
  })

  test('UVA quartalsweise: letztes abgeschlossenes Quartal; fehlt der Eintrag: „fehlt“ ohne Zahllast', async () => {
    const { r } = await lade({ uvaZeitraum: 'quartalsweise' })
    assert.deepEqual(r.uva, { label: 'Q2 2026', status: 'fehlt', zahllast: null, faelligAm: '2026-08-15' })
    const jan = await lade({ uvaZeitraum: 'quartalsweise', heute: new Date('2026-01-10T12:00:00Z') })
    assert.deepEqual(jan.r.uva, { label: 'Q4 2025', status: 'fehlt', zahllast: null, faelligAm: '2026-02-15' })
    const janM = await lade({ heute: new Date('2026-01-10T12:00:00Z') })
    assert.deepEqual(janM.r.uva, { label: 'Dez 2025', status: 'fehlt', zahllast: null, faelligAm: '2026-02-15' })
  })

  test('Befund: Fälligkeit hängt von der Zeitzone des Servers ab (toISOString) – in Wien der 14. statt des 15.', async () => {
    process.env.TZ = 'Europe/Vienna'
    const { r } = await lade()
    assert.equal(r.uva.faelligAm, '2026-10-14')
  })

  test('Monatsabschluss: letzter Abschluss und offene abgelaufene Monate des Jahres', async () => {
    const { r } = await lade()
    assert.deepEqual(r.monatsabschluss, { letzter: '2026-06', offeneMonate: 2 })
  })

  test('abgelaufenes Jahr: Stichtag 31.12., 12 Monate, UVA-Periode Nov bzw. Q3', async () => {
    const { r } = await lade({ jahr: 2025 })
    assert.equal(r.stichtag, '2025-12-31')
    assert.deepEqual(r.ytd, { einnahmen: 800, ausgaben: 700, ergebnis: 100, einnahmenVj: 7, ausgabenVj: 0, ergebnisVj: 7 })
    assert.deepEqual(r.monatsabschluss, { letzter: '2026-06', offeneMonate: 11 })
    assert.deepEqual(r.uva, { label: 'Nov 2025', status: 'fehlt', zahllast: null, faelligAm: '2026-01-15' })
    assert.equal(Math.round(r.umsatz.ytd * 100) / 100, 100)
    const q = await lade({ jahr: 2025, uvaZeitraum: 'quartalsweise' })
    assert.equal(q.r.uva.label, 'Q3 2025')
    assert.equal(q.r.uva.faelligAm, '2025-11-15')
  })

  test('E&A: keine Übergabe; Doppik: offene Rechnungen/Belege ohne BMD-Export und letzter Export', async () => {
    assert.equal((await lade()).r.uebergabe, null)
    const { r } = await lade({ art: 'doppik' })
    assert.equal(r.art, 'doppik')
    // Befund: gezählt wird über beide Jahre (ab 1.1. Vorjahr, auch nach dem Stichtag), nicht nur das laufende Jahr
    assert.deepEqual(r.uebergabe, { rechnungenOffen: 4, belegeOffen: 5, letzte: { art: 'belege', erstelltAm: '2026-09-01T10:00:00Z', anzahl: 7 } })
  })

  test('Mandantenfilter: jede Abfrage außer dem Namen des Betriebs trägt tenant_id', async () => {
    const { db } = await lade({ art: 'doppik' })
    assert.deepEqual(ohneMandant(db, T), ['select tenants'])
    const tenants = db.aufrufe.find(a => a.tabelle === 'tenants')
    assert.ok(tenants.filter.some(f => f[0] === 'eq' && f[1] === 'id' && f[2] === T))
    const verkauf = db.aufrufe.find(a => a.tabelle === 'verkaufsposten')
    for (const [k, v] of [['aktiv', true], ['storniert', false]]) assert.ok(verkauf.filter.some(f => f[0] === 'eq' && f[1] === k && f[2] === v), k)
  })

  test('leere Datenbank: alles 0 bzw. leer, UVA „fehlt“, alle abgelaufenen Monate offen', async () => {
    const { r } = await lade({}, { tenants: [{ id: T, name: 'Leer' }] })
    assert.deepEqual(r.ytd, { einnahmen: 0, ausgaben: 0, ergebnis: 0, einnahmenVj: 0, ausgabenVj: 0, ergebnisVj: 0 })
    assert.deepEqual(r.liquiditaet, { summe: 0, konten: [] })
    assert.deepEqual(r.forderungen, { summe: 0, anzahl: 0, ueberfaellig: 0, ueberfaelligSumme: 0 })
    assert.deepEqual(r.monatsabschluss, { letzter: null, offeneMonate: 8 })
    assert.equal(r.uva.status, 'fehlt')
    assert.equal(r.anlagen.buchwert, 0)
  })

  test('Befund: Datenbankfehler werden verschluckt – die Übersicht zeigt dann 0 statt einer Fehlermeldung', async () => {
    const { r } = await lade({}, tabellen(), { vorher: fehlerBei('konten', 'select', { message: 'timeout' }) })
    assert.deepEqual(r.liquiditaet, { summe: 0, konten: [] })
    const ea = await lade({}, tabellen(), { vorher: fehlerBei('ea_transaktionen', 'select', { message: 'timeout' }) })
    assert.equal(ea.r.ytd.einnahmen, 0)
    assert.equal(ea.r.belege.buchungenJahr, 0)
  })

  test('monatLabel: Kurzname, sonst die Zahl', () => {
    assert.equal(fin.monatLabel(1), 'Jän')
    assert.equal(fin.monatLabel(12), 'Dez')
    assert.equal(fin.monatLabel(13), '13')
  })
})
