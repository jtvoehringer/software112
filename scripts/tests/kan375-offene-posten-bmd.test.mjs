// KAN-375 (Folge von KAN-346/374, Entscheidung Jörgen 22.10.2026): die letzten zwei Stellen, die noch alt rechneten.
//  1. Reiter „Offene Posten“ in /reports (reports/(controlling)/page.tsx + ReportsClient.tsx) rechnete über Lieferscheine,
//     brutto, ohne Teilzahlungen und mit „Tage offen“ ab Rechnungsdatum – jetzt über ladeOffenePostenListe/offenePostenSumme
//     wie Seite „Offene Posten“, Dashboard, Finanzübersicht und Morgenbericht (Fälligkeit nach Kundenziel).
//  2. Frist „BMD-Übergabe“ im Dashboard zählte Lieferscheine ohne bmd_export_id (auch nicht berechnete) – jetzt Rechnungen
//     ohne BMD-Export über rechnungenOhneBmdExport(), dieselbe Zählung wie die Übergabe in der Finanzübersicht.
//
// Aufruf:  npm run -s test:csv   (alle scripts/tests/*.test.mjs; Node ≥ 22.15 für die Lade-Hooks)

import { test, describe, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { hooksRegistrieren, laden, nurMitHooks, hooksMoeglich, datenbank } from './buchung-attrappe.mjs'
// @ts-expect-error TS5097 – node:test lädt die .ts-Datei direkt
import * as U from '../../src/lib/verkauf/umsatz.ts'

hooksRegistrieren()
const [fin, dash, wien] = hooksMoeglich
  ? await Promise.all([laden('lib/finanzen/uebersicht.ts'), laden('app/(dashboard)/dashboard/_shared/data.ts'), laden('lib/datum/wien.ts')])
  : []

const quelle = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const T = 'tenant-1'
const HEUTE = new Date('2026-11-05T12:00:00.000Z')
const HEUTE_STR = '2026-11-05'
const TZ_VORHER = process.env.TZ

const pos = (preis_brutto, menge, ust_satz) => ({ preis_brutto, menge, rabatt_pct: 0, sonderrabatt_pct: 0, ust_satz })
const ls = (id, datum, positionen) => ({ id, lieferscheinnummer: `L-${id}`, datum, verkauf_positionen: positionen })
const rechnung = (id, datum, lieferscheine, teil = {}) => ({
  id, tenant_id: T, datum, rechnungsnummer: `R-${id}`, aktiv: true, storniert: false, bezahlt: false, bezahlt_am: null,
  bmd_export_id: null, partner_daten: null, kontakt: null, firma: null, lieferscheine, ...teil,
})

// Ein Datenbestand für alle Stellen
const tabellen = () => ({
  tenants: [{ id: T, name: 'Weingut Test' }],
  rechnungen: [
    // brutto 120, Teilzahlung 50 (+ stornierte 70) → offen 70; Ziel 30 → fällig 31.10., am 05.11. 5 Tage überfällig
    rechnung('r1', '2026-10-01', [ls('ls1', '2026-09-28', [pos(120, 1, 20)])],
      { kontakt: { id: 'k1', vorname: 'Anna', nachname: 'Berger', zahlungsziel_tage: 30 } }),
    // Sammelrechnung aus zwei Lieferscheinen 60 + 40 → offen 100; ohne Ziel 14 Tage → fällig 08.11., nicht überfällig
    rechnung('r2', '2026-10-25', [ls('ls2a', '2026-10-10', [pos(60, 1, 20)]), ls('ls2b', '2026-10-20', [pos(20, 2, 13)])],
      { firma: { id: 'f1', name: 'Vinothek', zahlungsziel_tage: null } }),
    // bezahlt und an BMD übergeben
    rechnung('r3', '2026-10-03', [ls('ls3', '2026-10-03', [pos(50, 1, 20)])], { bezahlt: true, bezahlt_am: '2026-10-10', bmd_export_id: 'exp-1' }),
    // storniert – weder offen noch zu übergeben
    rechnung('r4', '2026-10-04', [ls('ls4', '2026-10-04', [pos(999, 1, 20)])], { storniert: true }),
    // Rechnung ohne Lieferscheine (storniert, Lieferscheine wieder frei) – zählt nirgends
    rechnung('r5', '2026-10-05', []),
    // fremder Betrieb
    rechnung('r6', '2026-10-06', [ls('ls6', '2026-10-06', [pos(777, 1, 20)])], { tenant_id: 'fremd' }),
  ],
  // nicht berechneter Lieferschein (rechnung_id null, bezahlt false, ohne BMD-Export): vorher in /reports als offener Posten
  // (5.000 €) und in der Frist „BMD-Übergabe“ als Beleg gezählt
  verkaufsposten: [
    { id: 'ls-x', tenant_id: T, datum: '2026-10-12', rechnungsnummer: null, rechnung_id: null, aktiv: true, storniert: false,
      bezahlt: false, bmd_export_id: null, kontakt: null, firma: null, verkauf_positionen: [pos(5000, 1, 20)] },
  ],
  zahlungen: [
    { id: 'z1', tenant_id: T, rechnung_id: 'r1', betrag: 50, konto_id: null, storniert_am: null },
    { id: 'z2', tenant_id: T, rechnung_id: 'r1', betrag: 70, konto_id: null, storniert_am: '2026-10-20T10:00:00Z' },
  ],
})

async function ctxFuer(db, heute = HEUTE) {
  globalThis.__serverFake = db
  globalThis.__membership = { tenantId: T, role: 'tenant_admin', schreibmodule: [] }
  const ctx = await dash.getCtx()
  const wand = wien.wienJetzt(heute)
  return { ...ctx, heute: wand, heuteStr: dash.toDateStr(wand) }
}

/** Reiter „Offene Posten“ in /reports – genau wie reports/(controlling)/page.tsx (ohne React) */
async function reportsOffene(db) {
  const { data, error } = await U.ladeOffenePostenListe(db, T, HEUTE_STR)
  assert.equal(error, null)
  const offene = data.filter(p => !p.bezahlt)
  return { offene, summe: U.offenePostenSumme(offene) }
}

/** Seite „Offene Posten“ – genau wie weinhandel/offene-posten/page.tsx */
async function seiteOffene(db) {
  const { data } = await U.ladeOffenePostenListe(db, T, HEUTE_STR, { mitBezahlten: true })
  return U.offenePostenSumme(data).summe
}

describe('KAN-375: gleiche offene Posten in /reports, Dashboard, Finanzübersicht und Seite „Offene Posten“', nurMitHooks, () => {
  beforeEach(() => { process.env.TZ = 'UTC' })
  afterEach(() => { if (TZ_VORHER === undefined) delete process.env.TZ; else process.env.TZ = TZ_VORHER })

  test('Regression: Teilzahlung, stornierte Zahlung, nicht berechneter Lieferschein, Sammelrechnung → überall 170,00 €', async () => {
    const r = await reportsOffene(datenbank(tabellen()))
    // vorher im Reiter: Lieferscheine brutto ohne Zahlungen = 120 + 60 + 40 + 5.000 (nicht berechnet) = 5.220 €
    assert.deepEqual(r.summe, { anzahl: 2, summe: 170, ueberfaellig: 1, ueberfaelligSumme: 70, avgAlterTage: 23 })
    assert.equal(await seiteOffene(datenbank(tabellen())), 170)
    const d = await dash.ladeOffenePosten(await ctxFuer(datenbank(tabellen())))
    assert.deepEqual([d.summe, d.anzahl, d.ueberfaellig, d.ueberfaelligSumme], [170, 2, 1, 70])
    const f = await fin.ladeFinanzen(await ctxFuer(datenbank(tabellen())), { art: 'ea', uvaZeitraum: 'monatlich' })
    assert.deepEqual(f.forderungen, { summe: 170, anzahl: 2, ueberfaellig: 1, ueberfaelligSumme: 70 })
  })

  test('Zeilen des Reiters: offener Betrag, Fälligkeit nach Kundenziel, Verzug ab Fälligkeit, Sammelrechnung mit beiden Lieferscheinen', async () => {
    const { offene } = await reportsOffene(datenbank(tabellen()))
    assert.deepEqual(offene.map(p => p.id), ['r1', 'r2'])   // älteste Rechnung zuerst
    const [p1, p2] = offene
    assert.deepEqual([p1.brutto, p1.gezahlt, p1.offen, p1.faelligAm, p1.verzugTage, p1.ueberfaellig], [120, 50, 70, '2026-10-31', 5, true])
    assert.deepEqual([p2.brutto, p2.gezahlt, p2.offen, p2.faelligAm, p2.verzugTage, p2.ueberfaellig], [100, 0, 100, '2026-11-08', 0, false])
    assert.deepEqual(p2.verkaufspostenIds, ['ls2a', 'ls2b'])
    assert.equal(p1.kunde, 'Anna Berger')
    assert.equal(p2.kunde, 'Vinothek')
  })
})

describe('KAN-375: gleiche Anzahl „ohne BMD-Export“ in Dashboard-Frist und Finanzübersicht', nurMitHooks, () => {
  beforeEach(() => { process.env.TZ = 'UTC' })
  afterEach(() => { if (TZ_VORHER === undefined) delete process.env.TZ; else process.env.TZ = TZ_VORHER })

  test('rechnungenOhneBmdExport: nur zählende Rechnungen ohne Export', () => {
    const t = tabellen()
    assert.deepEqual(U.rechnungenOhneBmdExport(t.rechnungen.filter(r => r.tenant_id === T)).map(r => r.id), ['r1', 'r2'])
  })

  test('Regression: Frist „BMD-Übergabe Oktober 2026“ zählt 2 Rechnungen (nicht den Lieferschein), Finanzübersicht ebenso', async () => {
    const db = datenbank(tabellen())
    const fristen = await dash.ladeFristen(await ctxFuer(db), { modulEa: true, doppik: true, uvaZeitraum: 'monatlich' })
    const okt = fristen.find(x => x.key === 'bmd:2026:10')
    assert.ok(okt, 'Frist BMD-Übergabe Oktober 2026 fehlt')
    // vorher: Lieferscheine ohne bmd_export_id nach Lieferdatum – auch der nicht berechnete ls-x, eine Sammelrechnung je
    // Lieferschein mehrfach
    assert.match(okt.statusText, /^2 Belege noch nicht übergeben/)
    assert.ok(!db.aufrufe.some(a => a.tabelle === 'verkaufsposten'), 'Frist liest keine Lieferscheine mehr')
    const r = db.aufrufe.find(a => a.tabelle === 'rechnungen')
    for (const [op, k, v] of [['eq', 'tenant_id', T], ['eq', 'aktiv', true], ['or', 'storniert.eq.false,storniert_durch_id.not.is.null']]) {   // KAN-379: or = mit Stornobeleg
      assert.ok(r.filter.some(f => f[0] === op && f[1] === k && f[2] === v), `${op} ${k}`)
    }
    assert.ok(r.filter.some(f => f[0] === 'is' && f[1] === 'bmd_export_id'))

    const f = await fin.ladeFinanzen(await ctxFuer(datenbank(tabellen())), { art: 'doppik', uvaZeitraum: 'monatlich' })
    assert.equal(f.uebergabe.rechnungenOffen, 2)
  })

  test('Lader: Datenbankfehler kommt zurück (keine stille 0)', async () => {
    const db = datenbank(tabellen(), { vorher: e => (e.tabelle === 'rechnungen' ? { error: { message: 'timeout' } } : null) })
    const { data, error } = await U.ladeRechnungenOhneBmdExport(db, T, '2026-01-01', HEUTE_STR)
    assert.deepEqual(data, [])
    assert.equal(error.message, 'timeout')
  })
})

describe('KAN-375: Verdrahtung', () => {
  test('/reports: Reiter „Offene Posten“ über ladeOffenePostenListe/offenePostenSumme, keine eigene Lieferschein-Abfrage', () => {
    const p = quelle('src/app/(dashboard)/reports/(controlling)/page.tsx')
    assert.match(p, /ladeOffenePostenListe\(supabase, tenantId, heuteWien\(heute\)\)/)
    assert.match(p, /const offeneSumme = offenePostenSumme\(offene\)/)
    assert.match(p, /offeneSumme=\{offeneSumme\}/)
    assert.doesNotMatch(p, /from\('verkaufsposten'\)/)
    const c = quelle('src/app/(dashboard)/reports/ReportsClient.tsx')
    assert.doesNotMatch(c, /function posSum|posSum\(/)
    assert.doesNotMatch(c, /tageSeit\(p\.datum/)
    assert.match(c, /\{eur\(offeneSumme\.summe\)\}/)
    assert.match(c, /\{offeneSumme\.anzahl\}/)
    assert.match(c, /\{faelligText\(p\)\}/)
    assert.match(c, /\{eur\(p\.offen\)\}/)
    assert.match(c, /<Link href=\{offenerPostenHref\(p\)\}/)
    assert.match(c, /header: 'Fällig am'/)
    assert.match(c, /header: 'Tage überfällig'/)
  })

  test('Dashboard-Frist und Finanzübersicht zählen über rechnungenOhneBmdExport', () => {
    const d = quelle('src/app/(dashboard)/dashboard/_shared/data.ts')
    assert.match(d, /ladeRechnungenOhneBmdExport\(ctx\.supabase, ctx\.tenantId, seit, ctx\.heuteStr\)/)
    assert.doesNotMatch(d, /q\('verkaufsposten'\)/)
    const u = quelle('src/lib/verkauf/umsatz.ts')
    assert.match(u, /return \{ data: rechnungenOhneBmdExport\(/)
    const f = quelle('src/lib/finanzen/uebersicht.ts')
    assert.match(f, /rechnungenOffen: rechnungenOhneBmdExport\(vp\)\.length/)
  })
})
