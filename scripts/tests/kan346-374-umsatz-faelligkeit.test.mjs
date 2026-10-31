// KAN-346/347/348 und KAN-374 (Entscheidungen Jörgen 22.10.2026)
//  - Umsatz ist NETTO NACH RECHNUNGSDATUM wie die UVA – eine zentrale Funktion (src/lib/verkauf/umsatz.ts) für Dashboard,
//    Umsatz-Auswertung und Finanzübersicht; je Position auf Cent gerundet; nur Rechnungen (nicht berechnete Lieferscheine
//    nicht), stornierte nicht. Offene Posten nur aus Rechnungen, abzüglich nicht stornierter Zahlungen (Teilzahlungen).
//  - KAN-348: Belege der Umsatz-Auswertung über einen sichtbaren Knopf, Fehler sichtbar (role="alert"), Route wertet den
//    Lesefehler aus.
//  - KAN-374: überfällig ab FÄLLIGKEIT = Rechnungsdatum + Kundenziel (Kontakt, sonst Firma, sonst 14 Tage), reine
//    Datumsrechnung, „heute“ als Wiener Kalendertag (src/lib/verkauf/faelligkeit.ts).
// Die Umschaltung Rechnungs-/Lieferdatum der Umsatz-Auswertung prüft kan105e-reports-basis.test.mjs.
//
// Aufruf:  npm run -s test:csv   (alle scripts/tests/*.test.mjs)

import { test, describe, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
// @ts-expect-error TS5097 – node:test lädt die .ts-Datei direkt
import { zahlungszielTage, faelligAm, verzugTage, faelligkeit, faelligText, ZAHLUNGSZIEL_STANDARD_TAGE } from '../../src/lib/verkauf/faelligkeit.ts'
// @ts-expect-error TS5097 – node:test lädt die .ts-Datei direkt
import * as U from '../../src/lib/verkauf/umsatz.ts'
// @ts-expect-error TS5097 – node:test lädt die .ts-Datei direkt
import { heuteWien, tagPlus } from '../../src/lib/datum/wien.ts'
import { datenbank } from './buchung-attrappe.mjs'

const quelle = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const T = 'tenant-1'
const TZ_VORHER = process.env.TZ
afterEach(() => { if (TZ_VORHER === undefined) delete process.env.TZ; else process.env.TZ = TZ_VORHER })

const pos = (preis_brutto, menge, ust_satz, teil = {}) => ({ preis_brutto, menge, rabatt_pct: 0, sonderrabatt_pct: 0, ust_satz, ...teil })
const rechnung = (id, datum, positionen, teil = {}) => ({
  id, tenant_id: T, datum, rechnungsnummer: `R-${id}`, art: 'rechnung', storniert_durch_id: null, aktiv: true, storniert: false, bezahlt: false, bezahlt_am: null, bmd_export_id: null,
  partner_daten: null, kontakt: null, firma: null,
  lieferscheine: [{ id: `ls-${id}`, lieferscheinnummer: `L-${id}`, datum, verkauf_positionen: positionen }],
  ...teil,
})

// ── KAN-374: Fälligkeit und Verzug ───────────────────────────────────────────
describe('KAN-374: Fälligkeit ab Kundenziel', () => {
  test('Regression: Rechnung 01.10., Ziel 30, heute 05.11. → 5 Tage überfällig; Ziel fehlt → 14 Tage', () => {
    const mitZiel = faelligkeit({ datum: '2026-10-01', kontakt: { zahlungsziel_tage: 30 } }, '2026-11-05')
    assert.deepEqual(mitZiel, { zielTage: 30, faelligAm: '2026-10-31', verzugTage: 5, ueberfaellig: true })
    const ohneZiel = faelligkeit({ datum: '2026-10-01' }, '2026-11-05')
    assert.equal(ZAHLUNGSZIEL_STANDARD_TAGE, 14)
    assert.deepEqual(ohneZiel, { zielTage: 14, faelligAm: '2026-10-15', verzugTage: 21, ueberfaellig: true })
    // vorher: pauschal 30 Tage nach dem Rechnungsdatum → am 05.11. 35 Tage alt, „5 überfällig“ nur zufällig gleich
  })

  test('Zahlungsziel wie die Rechnung: Kontakt vor Firma, 0 = bei Erhalt, sonst 14', () => {
    assert.equal(zahlungszielTage({ kontakt: { zahlungsziel_tage: 30 }, firma: { zahlungsziel_tage: 60 } }), 30)
    assert.equal(zahlungszielTage({ kontakt: { zahlungsziel_tage: null }, firma: { zahlungsziel_tage: 60 } }), 60)
    assert.equal(zahlungszielTage({ kontakt: null, firma: { zahlungsziel_tage: '45' } }), 45)
    assert.equal(zahlungszielTage({ kontakt: { zahlungsziel_tage: 0 } }), 0)
    assert.equal(zahlungszielTage({ kontakt: { zahlungsziel_tage: -3 } }), 14)
    assert.equal(zahlungszielTage({ kontakt: { zahlungsziel_tage: 'x' } }), 14)
    assert.equal(zahlungszielTage({}), 14)
    assert.equal(zahlungszielTage(null), 14)
  })

  test('Fälligkeit über Monats-, Jahreswechsel und Schalttag (reine Datumsrechnung)', () => {
    assert.equal(faelligAm('2026-01-31', 1), '2026-02-01')
    assert.equal(faelligAm('2026-10-17', 14), '2026-10-31')
    assert.equal(faelligAm('2026-10-18', 14), '2026-11-01')
    assert.equal(faelligAm('2026-12-20', 14), '2027-01-03')
    assert.equal(faelligAm('2028-02-15', 14), '2028-02-29')
    assert.equal(faelligAm('2026-03-20', 14), '2026-04-03')   // über die Sommerzeit-Umstellung (29.03.)
    assert.equal(faelligAm('2026-10-01', 0), '2026-10-01')
  })

  test('Verzug: am Fälligkeitstag 0, am Tag danach 1, über den Monatswechsel weiter gezählt', () => {
    assert.equal(verzugTage('2026-10-31', '2026-10-30'), 0)
    assert.equal(verzugTage('2026-10-31', '2026-10-31'), 0)
    assert.equal(verzugTage('2026-10-31', '2026-11-01'), 1)
    assert.equal(verzugTage('2026-10-31', '2026-12-01'), 31)
    assert.equal(verzugTage('2026-12-31', '2027-01-02'), 2)
  })

  test('„heute“ als Wiener Kalendertag: 05.11. 00:30 Wien (04.11. 23:30 UTC) zählt schon 5 Tage – auch auf einem UTC-Server', () => {
    for (const zone of ['UTC', 'Europe/Vienna']) {
      process.env.TZ = zone
      const heute = heuteWien(new Date('2026-11-04T23:30:00.000Z'))
      assert.equal(heute, '2026-11-05', zone)
      assert.equal(faelligkeit({ datum: '2026-10-01', kontakt: { zahlungsziel_tage: 30 } }, heute).verzugTage, 5, zone)
    }
  })

  test('tagPlus: Kalendertage vor und zurück', () => {
    assert.equal(tagPlus('2026-03-01', -1), '2026-02-28')
    assert.equal(tagPlus('2026-01-05', -90), '2025-10-07')
    assert.equal(tagPlus('2026-10-25', 1), '2026-10-26')   // Ende der Sommerzeit
  })

  test('Anzeige „fällig am … · X Tage überfällig“', () => {
    assert.equal(faelligText({ faelligAm: '2026-10-31', verzugTage: 5 }), 'fällig am 31.10.2026 · 5 Tage überfällig')
    assert.equal(faelligText({ faelligAm: '2026-10-31', verzugTage: 1 }), 'fällig am 31.10.2026 · 1 Tag überfällig')
    assert.equal(faelligText({ faelligAm: '2026-10-31', verzugTage: 0 }), 'fällig am 31.10.2026')
  })
})

// ── KAN-346: Umsatz netto nach Rechnungsdatum ────────────────────────────────
describe('KAN-346: Umsatz netto nach Rechnungsdatum', () => {
  test('gemischte Steuersätze 0/13/20 %, Rabatte, fehlender Satz = 13 %', () => {
    const r = rechnung('r1', '2026-10-05', [
      pos(11.3, 10, 13),                                   // brutto 113,00 → netto 100,00
      pos(24, 5, 20, { rabatt_pct: 10 }),                  // brutto 108,00 → netto 90,00
      pos(10, 1, 0),                                       // brutto 10,00 → netto 10,00
      pos(11.3, 1, null),                                  // ohne Satz: 13 % → netto 10,00
      pos(null, 3, 20),                                    // ohne Preis: 0
    ])
    assert.equal(U.positionNetto(pos(11.3, 10, 13)), 100)
    assert.equal(U.positionNetto(pos(24, 5, 20, { rabatt_pct: 10 })), 90)
    assert.equal(U.positionNetto(pos(10, 1, 0)), 10)
    assert.equal(U.rechnungNetto(r), 210)
    assert.equal(U.rechnungBrutto(r), 242.3)
    assert.equal(U.umsatzNetto([r]), 210)
  })

  test('Cent-Rundung je Position (kaufmännisch wie positionBrutto), nicht erst auf die Summe', () => {
    // 1,005 € brutto zu 0 %: je Position 1,01 (binär gerundet wären es 1,00); drei Positionen 3,03 – auf die Summe
    // gerundet wären es 3,02 (3,015 binär)
    const r = rechnung('r2', '2026-10-05', [pos(1.005, 1, 0), pos(1.005, 1, 0), pos(1.005, 1, 0)])
    assert.equal(U.positionNetto(pos(1.005, 1, 0)), 1.01)
    assert.equal(U.rechnungNetto(r), 3.03)
    // 0,99 brutto zu 20 % → 0,825 netto → 0,83 je Position; zwei Positionen 1,66 (Summe ungerundet 1,65)
    assert.equal(U.rechnungNetto(rechnung('r3', '2026-10-05', [pos(0.99, 1, 20), pos(0.99, 1, 20)])), 1.66)
  })

  test('nicht berechnete Lieferscheine, stornierte und inaktive Rechnungen zählen nicht', () => {
    const ok = rechnung('a', '2026-10-01', [pos(120, 1, 20)])
    const storno = rechnung('b', '2026-10-02', [pos(1200, 1, 20)], { storniert: true })
    const inaktiv = rechnung('c', '2026-10-03', [pos(1200, 1, 20)], { aktiv: false })
    const ohneLieferschein = rechnung('d', '2026-10-04', [], { lieferscheine: [] })   // storniert, Lieferscheine wieder frei
    assert.equal(U.zaehltAlsUmsatz(ok), true)
    assert.equal(U.zaehltAlsUmsatz(storno), false)
    assert.equal(U.zaehltAlsUmsatz(inaktiv), false)
    assert.equal(U.zaehltAlsUmsatz(ohneLieferschein), false)
    assert.equal(U.umsatzNetto([ok, storno, inaktiv, ohneLieferschein]), 100)
  })

  test('je Monat nach Rechnungsdatum (nicht nach Lieferdatum)', () => {
    const r = rechnung('m1', '2026-11-02', [pos(120, 1, 20)])
    r.lieferscheine[0].datum = '2026-10-28'   // geliefert im Oktober, verrechnet im November
    const m = U.umsatzJeMonat([r, rechnung('m2', '2026-10-15', [pos(113, 1, 13)])], ['2026-10', '2026-11'])
    assert.deepEqual(m.get('2026-10'), { umsatz: 100, anzahl: 1 })
    assert.deepEqual(m.get('2026-11'), { umsatz: 100, anzahl: 1 })
  })

  test('Lader: nur Rechnungen des Betriebs, aktiv, nicht storniert, im Zeitraum – Lieferscheine ohne Rechnung fehlen', async () => {
    const db = datenbank({
      rechnungen: [
        rechnung('r1', '2026-10-05', [pos(113, 1, 13)]),
        rechnung('r2', '2026-10-31', [pos(120, 1, 20)]),
        rechnung('r3', '2026-11-01', [pos(120, 1, 20)]),
        rechnung('r4', '2026-10-06', [pos(999, 1, 20)], { storniert: true }),
        rechnung('r5', '2026-10-07', [pos(999, 1, 20)], { tenant_id: 'fremd' }),
      ],
      // nicht berechneter Lieferschein (rechnung_id null) – nie Umsatz
      verkaufsposten: [{ id: 'ls-x', tenant_id: T, datum: '2026-10-10', rechnung_id: null, aktiv: true, storniert: false, verkauf_positionen: [pos(5000, 1, 20)] }],
    })
    const { data, error } = await U.ladeUmsatzRechnungen(db, T, '2026-10-01', '2026-10-31')
    assert.equal(error, null)
    assert.deepEqual(data.map(r => r.id).sort(), ['r1', 'r2'])
    assert.equal(U.umsatzNetto(data), 200)
    const a = db.aufrufe.find(x => x.tabelle === 'rechnungen')
    // KAN-379: nicht storniert ODER storniert mit Stornobeleg (Gegenbuchung im Zeitraum des Stornobelegs)
    assert.ok(a.filter.some(f => f[0] === 'or' && f[1] === 'storniert.eq.false,storniert_durch_id.not.is.null'), 'or storniert')
    for (const [op, k, v] of [['eq', 'tenant_id', T], ['eq', 'aktiv', true]]) {
      assert.ok(a.filter.some(f => f[0] === op && f[1] === k && f[2] === v), `${op} ${k}`)
    }
    assert.ok(!db.aufrufe.some(x => x.tabelle === 'verkaufsposten'))
  })

  test('Lader: Datenbankfehler kommt zurück (keine stille 0)', async () => {
    const db = datenbank({ rechnungen: [rechnung('r1', '2026-10-05', [pos(113, 1, 13)])] }, {
      vorher: e => (e.tabelle === 'rechnungen' ? { error: { message: 'timeout' } } : null),
    })
    const { data, error } = await U.ladeUmsatzRechnungen(db, T, '2026-10-01', '2026-10-31')
    assert.deepEqual(data, [])
    assert.equal(error.message, 'timeout')
  })
})

// ── KAN-346/374: offene Posten ───────────────────────────────────────────────
describe('KAN-346/374: offene Posten aus Rechnungen, nach Teilzahlungen, Verzug ab Fälligkeit', () => {
  const tabellen = () => ({
    rechnungen: [
      // brutto 120, Teilzahlung 50 (+ stornierte 70) → offen 70; Kunde Ziel 30 → fällig 31.10.
      rechnung('t1', '2026-10-01', [pos(120, 1, 20)], { kontakt: { id: 'k1', vorname: 'Anna', nachname: 'Berger', zahlungsziel_tage: 30 } }),
      // Firma ohne Kontakt, Ziel 60 → fällig 30.11. – nicht überfällig
      rechnung('t2', '2026-10-01', [pos(240, 1, 20)], { firma: { id: 'f1', name: 'Vinothek', zahlungsziel_tage: 60 } }),
      // Momentaufnahme: beim Rechnen galt Ziel 7 (live inzwischen 30) → fällig 08.10.
      rechnung('t3', '2026-10-01', [pos(10, 1, 20)], {
        kontakt: { id: 'k2', vorname: 'Max', nachname: 'Huber', zahlungsziel_tage: 30 },
        partner_daten: { kontakt: { vorname: 'Max', nachname: 'Huber', zahlungsziel_tage: 7 }, firma: null },
      }),
      rechnung('t4', '2026-09-01', [pos(50, 1, 20)], { bezahlt: true, bezahlt_am: '2026-09-10' }),
      rechnung('t5', '2026-09-01', [pos(80, 1, 20)], { storniert: true }),
      rechnung('t6', '2026-09-01', [pos(80, 1, 20)], { tenant_id: 'fremd' }),
    ],
    zahlungen: [
      { id: 'z1', tenant_id: T, rechnung_id: 't1', betrag: 50, storniert_am: null },
      { id: 'z2', tenant_id: T, rechnung_id: 't1', betrag: 70, storniert_am: '2026-10-20T10:00:00Z' },
      { id: 'z3', tenant_id: 'fremd', rechnung_id: 't1', betrag: 999, storniert_am: null },
    ],
  })

  test('Teilzahlung mindert den offenen Posten, stornierte Zahlung nicht; Fälligkeit nach Kundenziel und Momentaufnahme', async () => {
    const db = datenbank(tabellen())
    const { data, error } = await U.ladeOffenePostenListe(db, T, '2026-11-05')
    assert.equal(error, null)
    const p = Object.fromEntries(data.map(x => [x.id, x]))
    assert.deepEqual(Object.keys(p).sort(), ['t1', 't2', 't3'])
    assert.deepEqual([p.t1.brutto, p.t1.gezahlt, p.t1.offen], [120, 50, 70])
    assert.deepEqual([p.t1.faelligAm, p.t1.verzugTage, p.t1.ueberfaellig, p.t1.kunde], ['2026-10-31', 5, true, 'Anna Berger'])
    assert.deepEqual([p.t2.faelligAm, p.t2.verzugTage, p.t2.ueberfaellig, p.t2.kunde], ['2026-11-30', 0, false, 'Vinothek'])
    assert.deepEqual([p.t3.zielTage, p.t3.faelligAm, p.t3.verzugTage], [7, '2026-10-08', 28])
    assert.equal(p.t1.alterTage, 35)   // Rechnungsalter bleibt getrennt vom Verzug
    assert.deepEqual(U.offenePostenSumme(data), { anzahl: 3, summe: 320, ueberfaellig: 2, ueberfaelligSumme: 80, avgAlterTage: 35 })
    const z = db.aufrufe.find(x => x.tabelle === 'zahlungen')
    assert.ok(z.filter.some(f => f[0] === 'eq' && f[1] === 'tenant_id' && f[2] === T))
    assert.ok(z.filter.some(f => f[0] === 'is' && f[1] === 'storniert_am'))
  })

  test('mitBezahlten: bezahlte Rechnungen kommen mit (offen 0), stornierte nie', async () => {
    const { data } = await U.ladeOffenePostenListe(datenbank(tabellen()), T, '2026-11-05', { mitBezahlten: true })
    const t4 = data.find(x => x.id === 't4')
    assert.deepEqual([t4.bezahlt, t4.offen, t4.ueberfaellig && !t4.bezahlt ? 'x' : '-'], [true, 0, '-'])
    assert.ok(!data.some(x => x.id === 't5'))
    assert.equal(U.offenePostenSumme(data).anzahl, 3)
  })

  test('Fehler beim Laden der Zahlungen bricht ab (keine Teilmenge)', async () => {
    const db = datenbank(tabellen(), { vorher: e => (e.tabelle === 'zahlungen' ? { error: { message: 'kaputt' } } : null) })
    const { data, error } = await U.ladeOffenePostenListe(db, T, '2026-11-05')
    assert.deepEqual(data, [])
    assert.equal(error.message, 'kaputt')
  })
})

// ── Verdrahtung: alle Stellen nutzen die zentralen Funktionen ────────────────
describe('Verdrahtung', () => {
  test('Dashboard: ladeOffenePosten über ladeOffenePostenListe, kein posSum/ZAHLUNGSZIEL_TAGE mehr', () => {
    const d = quelle('src/app/(dashboard)/dashboard/_shared/data.ts')
    assert.match(d, /await ladeOffenePostenListe\(ctx\.supabase, ctx\.tenantId, ctx\.heuteStr\)/)
    assert.match(d, /offenePostenSumme\(liste\)/)
    assert.doesNotMatch(d, /export function posSum|ZAHLUNGSZIEL_TAGE/)
    assert.match(quelle('src/app/(dashboard)/dashboard/_widgets/kacheln.tsx'), /Ø \$\{offen\.avgAlterTage\} Tage seit Rechnung/)
  })

  test('Verkaufs-Dashboard: Umsatzreihe zentral und beschriftet, überfällige Rechnungen nach Verzug', () => {
    const v = quelle('src/app/(dashboard)/dashboard/verkauf/page.tsx')
    assert.match(v, /ladeUmsatzRechnungen\(supabase, tenantId, absatzVon, absatzBis\)/)
    assert.match(v, /umsatzJeMonat\(umsatzRechnungen \?\? \[\], monate\)/)
    assert.match(v, /\{UMSATZ_BESCHRIFTUNG\}<\/h2>/)
    assert.match(v, /ladeOffenePosten\(ctx\)/)
    assert.match(v, /\.filter\(p => p\.ueberfaellig\)\n\s+\.sort\(\(a, b\) => b\.verzugTage - a\.verzugTage\)/)
    assert.match(v, /title=\{faelligText\(v\)\}/)
    assert.doesNotMatch(v, /ZAHLUNGSZIEL_TAGE|function posSum|tageSeit/)
  })

  test('Umsatz-Auswertung: Route und Belegliste über die zentrale Funktion, Fehler ausgewertet', () => {
    const u = quelle('src/app/api/reports/umsatz/route.ts')
    assert.match(u, /const \{ data, error \} = await ladeUmsatzBelege\(supabase, tenantId, von, bis, basis\)/)
    assert.match(u, /umsatz: umsatzNetto\(data\)/)
    assert.match(u, /if \(fehler\) return NextResponse\.json\(\{ fehler: dbFehlerText\(fehler, 'Umsatz konnte nicht geladen werden'\) \}, \{ status: 500 \}\)/)
    assert.doesNotMatch(u, /from\('verkaufsposten'\)/)   // Lieferscheine nur über ladeUmsatzBelege
    const d = quelle('src/app/api/reports/umsatz-detail/route.ts')
    assert.match(d, /await ladeUmsatzBelege\(supabase, tenantId, von, bis, basis\)/)
    assert.match(d, /if \(error\) return NextResponse\.json\(\{ fehler: dbFehlerText\(error, 'Belege konnten nicht geladen werden'\) \}, \{ status: 500 \}\)/)
    assert.match(d, /posten: data\.map\(r => umsatzBelegZeile\(r, basis\)\)/)
    assert.doesNotMatch(d, /from\('verkaufsposten'\)/)
    const s = quelle('src/app/(dashboard)/reports/(controlling)/page.tsx')
    assert.match(s, /ladeUmsatzRechnungen\(supabase, tenantId, von12, bis12\)/)
    assert.match(s, /umsatzJeMonat\(\(umsatzRaw \?\? \[\]\) as R\[\]/)
  })

  test('KAN-348: Belege über sichtbaren Knopf, res.ok ausgewertet, Fehler mit role="alert", Ladezustand im finally', () => {
    const c = quelle('src/app/(dashboard)/reports/ReportsClient.tsx')
    assert.match(c, /'Belege ausblenden ▲' : 'Belege anzeigen ▼'/)
    assert.match(c, /aria-expanded=\{umsatzExpand === m\.monat\}/)
    const drill = c.slice(c.indexOf('async function toggleUmsatzDrill'), c.indexOf('// ── CSV-Exports'))
    assert.match(drill, /if \(!res\.ok\) \{ setMonatFehler\(/)
    assert.match(drill, /\} finally \{\n\s+setMonatLoading\(false\)\n\s+\}/)
    assert.doesNotMatch(drill, /catch \{ \/\* silent \*\/ \}/)
    assert.match(c, /<div role="alert" className="[^"]*">\{monatFehler\}<\/div>/)
    assert.match(c, /\{eur\(Number\(p\.netto\) \|\| 0\)\}/)
    // Überschrift und Umschaltung je Basis: kan105e-reports-basis.test.mjs
  })

  test('Finanzübersicht: Umsatz über ladeUmsatzRechnungen/umsatzNetto, Kachel beschriftet, Forderungen über ladeOffenePosten', () => {
    const f = quelle('src/lib/finanzen/uebersicht.ts')
    assert.match(f, /ladeUmsatzRechnungen\(ctx\.supabase, ctx\.tenantId, von, bis\)/)
    assert.match(f, /umsatz: \{ ytd: umsatzNetto\(vpJahr\), vj: umsatzNetto\(vpVj\) \}/)
    assert.match(f, /ladeOffenePosten\(ctx\),/)
    assert.doesNotMatch(f, /function nettoUmsatz|q\('verkaufsposten'\)/)
    assert.match(quelle('src/app/(dashboard)/buchhaltung/uebersicht/page.tsx'), /<Tile label=\{UMSATZ_BESCHRIFTUNG\}/)
  })

  test('Offene Posten: Seite über ladeOffenePostenListe (Wiener Tag), Anzeige „fällig am …“ im Client', () => {
    const p = quelle('src/app/(dashboard)/weinhandel/offene-posten/page.tsx')
    assert.match(p, /ladeOffenePostenListe\(supabase, tenantId, heuteWien\(\), \{ mitBezahlten: true \}\)/)
    assert.match(p, /faelligAm:       p\.faelligAm,/)
    assert.match(p, /summeOffen = offenePostenSumme\(liste \?\? \[\]\)\.summe/)
    assert.doesNotMatch(p, /ZAHLUNGSZIEL_TAGE/)
    const c = quelle('src/app/(dashboard)/weinhandel/offene-posten/OffenePostenClient.tsx')
    assert.match(c, /faelligText\(\{ faelligAm: p\.faelligAm, verzugTage: p\.tageUeberfaellig \}\)/)
  })

  test('Morgenbericht: offene Posten zentral, Tagesgrenzen über tagPlus statt Millisekunden/toISOString', () => {
    const m = quelle('src/lib/morgenbericht/pruefungen.ts')
    assert.match(m, /ladeOffenePosten\(ctx\),/)
    assert.match(m, /const ueberf = offenePosten\.liste\.filter\(p => p\.ueberfaellig\)/)
    assert.match(m, /const seit90 = tagPlus\(ctx\.heuteStr, -90\)/)
    assert.doesNotMatch(m, /toISOString\(\)\.slice\(0, 10\)/)
    assert.doesNotMatch(m, /ZAHLUNGSZIEL_TAGE|posSum/)
  })
})
