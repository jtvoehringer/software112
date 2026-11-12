// KAN-105 Teil B (4) (08.10.2026), angepasst an KAN-346 (Entscheidung Jörgen 22.10.2026) – Umsatz-Auswertung (/reports)
// wahlweise nach Rechnungs- oder Lieferdatum, beide NETTO und je Position auf Cent über dieselbe Rechnung
// (src/lib/verkauf/umsatz.ts):
//  - Standard „Rechnungsdatum“: Rechnungen (Sammelrechnung als ein Beleg), nicht berechnete Lieferscheine fehlen
//  - „Lieferdatum“ (?basis=lieferung): Lieferscheine nach Lieferdatum, nicht stornierte, auch noch nicht berechnete
//  - Die Belegliste („Belege anzeigen“) zeigt je Basis Rechnungen bzw. Lieferscheine; ihre Summe ergibt den Monatswert.
// Dashboard, Finanzübersicht, Offene Posten und Morgenbericht bleiben fest beim Rechnungsdatum (kan346-374-…).
//
// Aufruf:  npm run -s test:csv   (alle scripts/tests/*.test.mjs; Routen-Teil braucht Node ≥ 22.15)

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
// @ts-expect-error TS5097 – node:test lädt die .ts-Datei direkt
import { umsatzBasis, umsatzBeschriftung } from '../../src/lib/verkauf/umsatzBasis.ts'
import { DOPPEL, hooksRegistrieren, laden, nurMitHooks, hooksMoeglich, datenbank, fehlerBei } from './buchung-attrappe.mjs'

const quelle = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const modul = code => 'data:text/javascript,' + encodeURIComponent(code)
DOPPEL['next/server'] = modul('export class NextResponse { static json(body, init) { return { status: init?.status ?? 200, body } } }; export class NextRequest {}')
DOPPEL['@/lib/api/zweiFaktor'] = modul('export const pruefeZweiFaktor = async () => null')
hooksRegistrieren()
const [monatsRoute, detailRoute] = hooksMoeglich
  ? await Promise.all([laden('app/api/reports/umsatz/route.ts'), laden('app/api/reports/umsatz-detail/route.ts')])
  : []

const T = 'tenant-1'
const pos = (preis_brutto, menge, ust_satz, teil = {}) => ({ preis_brutto, menge, rabatt_pct: 0, sonderrabatt_pct: 0, ust_satz, ...teil })
const ls = (id, datum, positionen, teil = {}) => ({
  id, tenant_id: T, datum, lieferscheinnummer: `L-${id}`, rechnungsnummer: null, rechnung_id: null, aktiv: true, storniert: false,
  bezahlt: false, kontakt: { vorname: 'Anna', nachname: 'Berger' }, firma: null, verkauf_positionen: positionen, ...teil,
})
const rg = (id, datum, lieferscheine, teil = {}) => ({
  id, tenant_id: T, datum, rechnungsnummer: `R-${id}`, aktiv: true, storniert: false, bezahlt: false, bmd_export_id: null,
  kontakt: null, firma: { name: 'Vinothek' }, lieferscheine, ...teil,
})

// Oktober 2026:
//  RA  Rechnung 05.10. über LA (geliefert 28.09.)         113 € zu 13 % → netto 100,00
//  RB  Sammelrechnung 20.10. über LB (18.10.) + LC (19.10.) 120 € zu 20 % → 100,00 und 1,005 € zu 0 % → 1,01 (Cent je Position)
//  LD  Lieferschein 25.10., noch nicht berechnet           24 € × 5 − 10 % zu 20 % → 90,00
//  LE  Lieferschein 26.10. storniert, RS Rechnung storniert, Fremdbetrieb – zählen nie
const LA = ls('la', '2026-09-28', [pos(113, 1, 13)], { rechnung_id: 'ra', rechnungsnummer: 'R-ra' })
const LB = ls('lb', '2026-10-18', [pos(120, 1, 20)], { rechnung_id: 'rb', rechnungsnummer: 'R-rb' })
const LC = ls('lc', '2026-10-19', [pos(1.005, 1, 0)], { rechnung_id: 'rb', rechnungsnummer: 'R-rb' })
const LD = ls('ld', '2026-10-25', [pos(24, 5, 20, { rabatt_pct: 10 })])
const tabellen = () => ({
  rechnungen: [
    rg('ra', '2026-10-05', [LA]),
    rg('rb', '2026-10-20', [LB, LC]),
    rg('rs', '2026-10-10', [], { storniert: true }),
    rg('rf', '2026-10-11', [LB], { tenant_id: 'fremd' }),
  ],
  verkaufsposten: [
    LA, LB, LC, LD,
    ls('le', '2026-10-26', [pos(999, 1, 20)], { storniert: true }),
    ls('lf', '2026-10-27', [pos(999, 1, 20)], { tenant_id: 'fremd' }),
  ],
})

function umgebung(t = tabellen(), opts) {
  const db = datenbank(t, opts)
  globalThis.__serverFake = db
  globalThis.__membership = { tenantId: T, role: 'tenant_admin', schreibmodule: [] }
  return db
}
const anfrage = (pfad) => ({ nextUrl: new URL(`https://app.test${pfad}`) })
const summe = (posten) => Math.round(posten.reduce((s, p) => s + p.netto * 100, 0)) / 100   // runden-ok: Testprüfung in ganzen Cent

describe('KAN-105/346: Basis der Umsatz-Auswertung', () => {
  test('umsatzBasis: Standard Rechnungsdatum, nur „lieferung“ schaltet um', () => {
    assert.equal(umsatzBasis('lieferung'), 'lieferung')
    assert.equal(umsatzBasis('rechnung'), 'rechnung')
    assert.equal(umsatzBasis(null), 'rechnung')
    assert.equal(umsatzBasis(undefined), 'rechnung')
    assert.equal(umsatzBasis('Lieferung'), 'rechnung')
  })

  test('Beschriftung nennt die Basis', () => {
    assert.equal(umsatzBeschriftung('rechnung'), 'Umsatz netto nach Rechnungsdatum')
    assert.equal(umsatzBeschriftung('lieferung'), 'Umsatz netto nach Lieferdatum')
  })
})

describe('Routen: Monatswert und Belegliste je Basis', nurMitHooks, () => {
  test('Rechnungsdatum (Standard): RA + RB netto, Sammelrechnung ein Beleg, Lieferdatum egal, nicht berechnete fehlen', async () => {
    umgebung()
    const r = await monatsRoute.GET(anfrage('/api/reports/umsatz?monate=2026-09,2026-10'))
    assert.equal(r.status, 200)
    assert.deepEqual(r.body.monate.map(m => [m.von, m.umsatz, m.anzahl]), [['2026-09-01', 0, 0], ['2026-10-01', 201.01, 2]])
    const d = await detailRoute.GET(anfrage('/api/reports/umsatz-detail?von=2026-10-01&bis=2026-10-31'))
    assert.equal(d.status, 200)
    assert.equal(d.body.basis, 'rechnung')
    assert.deepEqual(d.body.posten.map(p => [p.id, p.nummer, p.netto, p.href]).sort(), [
      ['ra', 'R-ra', 100, '/weinhandel/rechnungen/ra'],
      ['rb', 'R-rb', 101.01, '/weinhandel/rechnungen/rb'],
    ])
    assert.equal(summe(d.body.posten), r.body.monate[1].umsatz, 'Summe der Belegliste = Monatswert')
    assert.equal(d.body.posten.length, r.body.monate[1].anzahl)
  })

  test('Lieferdatum: Lieferscheine netto nach Lieferdatum – auch nicht berechnete, ohne stornierte', async () => {
    const db = umgebung()
    const r = await monatsRoute.GET(anfrage('/api/reports/umsatz?monate=2026-09,2026-10&basis=lieferung'))
    assert.equal(r.status, 200)
    assert.deepEqual(r.body.monate.map(m => [m.von, m.umsatz, m.anzahl]), [['2026-09-01', 100, 1], ['2026-10-01', 191.01, 3]])
    const d = await detailRoute.GET(anfrage('/api/reports/umsatz-detail?von=2026-10-01&bis=2026-10-31&basis=lieferung'))
    assert.equal(d.body.basis, 'lieferung')
    assert.deepEqual(d.body.posten.map(p => [p.id, p.nummer, p.netto, p.art, p.href]).sort(), [
      ['lb', 'L-lb', 100, 'lieferschein', '/weinhandel/verkauf/lb'],
      ['lc', 'L-lc', 1.01, 'lieferschein', '/weinhandel/verkauf/lc'],
      ['ld', 'L-ld', 90, 'lieferschein', '/weinhandel/verkauf/ld'],
    ])
    assert.equal(summe(d.body.posten), r.body.monate[1].umsatz, 'Summe der Belegliste = Monatswert')
    const a = db.aufrufe.find(x => x.tabelle === 'verkaufsposten')
    for (const [k, v] of [['tenant_id', T], ['aktiv', true], ['storniert', false]]) {
      assert.ok(a.filter.some(f => f[0] === 'eq' && f[1] === k && f[2] === v), k)
    }
    assert.ok(!db.aufrufe.some(x => x.tabelle === 'rechnungen'), 'Lieferdatum liest keine Rechnungen')
  })

  test('Zeitraum von/bis: je Monat dieselbe Rechnung wie die Belegliste (Lieferdatum)', async () => {
    umgebung()
    const r = await monatsRoute.GET(anfrage('/api/reports/umsatz?von=2026-09&bis=2026-10&basis=lieferung'))
    for (const m of r.body.monate) {
      const d = await detailRoute.GET(anfrage(`/api/reports/umsatz-detail?von=${m.von}&bis=${m.bis}&basis=lieferung`))
      assert.equal(summe(d.body.posten), m.umsatz, m.von)
      assert.equal(d.body.posten.length, m.anzahl, m.von)
    }
  })

  test('Lesefehler → 500 statt still 0 (beide Basen, Monat und Belegliste)', async () => {
    for (const [basis, tabelle] of [['rechnung', 'rechnungen'], ['lieferung', 'verkaufsposten']]) {
      umgebung(tabellen(), { vorher: fehlerBei(tabelle, 'select', { message: 'timeout' }) })
      const r = await monatsRoute.GET(anfrage(`/api/reports/umsatz?monate=2026-10&basis=${basis}`))
      assert.equal(r.status, 500, basis)
      umgebung(tabellen(), { vorher: fehlerBei(tabelle, 'select', { message: 'timeout' }) })
      const d = await detailRoute.GET(anfrage(`/api/reports/umsatz-detail?von=2026-10-01&bis=2026-10-31&basis=${basis}`))
      assert.equal(d.status, 500, basis)
    }
  })
})

describe('Reports-Seite: Umschalter', () => {
  test('Standard Rechnungsdatum, Basis in allen Abfragen, Überschrift je Basis, Belegliste je Basis', () => {
    const c = quelle('src/app/(dashboard)/reports/ReportsClient.tsx')
    assert.match(c, /useState<UmsatzBasis>\('rechnung'\)/)
    assert.match(c, /\[\['rechnung', 'nach Rechnungsdatum'\], \['lieferung', 'nach Lieferdatum'\]\]/)
    assert.match(c, /fetch\('\/api\/reports\/umsatz\?basis=lieferung'\)/)
    assert.match(c, /&bis=\$\{bisMonat\}&basis=\$\{basis\}/)
    assert.match(c, /\$\{vergleichB\}&basis=\$\{basis\}/)
    assert.match(c, /umsatz-detail\?von=\$\{von\}&bis=\$\{bis\}&basis=\$\{umsatzBasis\}/)
    assert.match(c, /`\$\{umsatzBeschriftung\(umsatzBasis\)\} \(12 Monate\)`/)
    assert.match(c, /\{umsatzBasis === 'lieferung' \? 'Lieferschein' : 'Rechnung'\}/)
    assert.match(c, /\{p\.nummer \?\? '–'\}/)
    // Server liefert die 12 Monate nach Rechnungsdatum (Standard) über die zentrale Funktion
    assert.match(quelle('src/app/(dashboard)/reports/(controlling)/page.tsx'), /ladeUmsatzRechnungen\(supabase, tenantId, von12, bis12\)/)
  })

  test('Dashboard, Finanzübersicht, Offene Posten, Morgenbericht ohne Basis-Wahl (fest Rechnungsdatum)', () => {
    for (const p of ['src/app/(dashboard)/dashboard/_shared/VerkaufCrmSicht.tsx', 'src/lib/finanzen/uebersicht.ts',
      'src/app/(dashboard)/weinhandel/offene-posten/page.tsx', 'src/lib/morgenbericht/pruefungen.ts', 'src/app/(dashboard)/dashboard/_shared/data.ts']) {
      assert.doesNotMatch(quelle(p), /umsatzBasis|ladeUmsatzLieferscheine|ladeUmsatzBelege/, p)
    }
  })
})
