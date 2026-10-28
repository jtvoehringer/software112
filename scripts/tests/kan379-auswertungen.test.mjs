// KAN-379 Teil 2 (27.10.2026) – Stornobeleg in den Auswertungen: Umsatz, offene Posten, BMD-Zähler (lib/verkauf/umsatz),
// Rechnungsjournal (Druck und CSV), BMD-Export als Gutschrift, Rechnungsseite und Suche. Eine Rechnung mit Stornobeleg
// zählt in ihrem Zeitraum aus der Momentaufnahme, der Stornobeleg negativ im Zeitraum seines Datums (wie die UVA,
// DB-Test 86); vor KAN-379 stornierte Rechnungen ohne Stornobeleg zählen wie bisher nicht.
//
// Aufruf:  npm run -s test:csv   (alle scripts/tests/*.test.mjs)

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { register } from 'node:module'
import { readFileSync } from 'node:fs'
import { datenbank } from './buchung-attrappe.mjs'

register('./buchhaltung.aufloesung.mjs', import.meta.url)

const U = await import('../../src/lib/verkauf/umsatz.ts')
const B = await import('../../src/lib/verkauf/rechnungen.ts')
const bmd = await import('../../src/lib/buchhaltung/bmd.ts')
const rj = await import('../../src/lib/behoerden/rechnungsausgang.ts')

const quelle = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const T = 'betrieb-1'

const pos = (preis_brutto, menge, ust_satz, teil = {}) => ({ preis_brutto, menge, rabatt_pct: 0, sonderrabatt_pct: 0, ust_satz, ...teil })
// Momentaufnahme wie s112_stornobeleg_anlegen (Positionen mit Lieferschein)
const moment = [pos(120, 1, 20, { lieferscheinnummer: 'LS-1', lieferdatum: '2026-08-18', name: 'Grüner Veltliner' }),
  pos(11.3, 3, 13, { lieferscheinnummer: 'LS-1', lieferdatum: '2026-08-18', name: 'Zweigelt', rabatt_pct: 10 })]
const basis = { tenant_id: T, aktiv: true, bezahlt: false, bezahlt_am: null, bmd_export_id: null, partner_daten: null, kontakt: null,
  firma: { id: 'f1', name: 'Vinothek Am Eck', land: 'AT' }, storno_positionen: null, storniert_durch: null, storno_von: null, notizen: null }
// Rechnung vom 20.08. (gesperrter Monat), am 05.10. storniert → Stornobeleg ST-2026-0001 vom 05.10.
const original = { ...basis, id: 'r7', datum: '2026-08-20', rechnungsnummer: 'RE-2026-0007', art: 'rechnung', storniert: true,
  storniert_am: '2026-10-05T08:00:00Z', storno_grund: 'Kunde hat falsche Ware erhalten', storniert_durch_id: 's1',
  storniert_durch: { id: 's1', rechnungsnummer: 'ST-2026-0001', datum: '2026-10-05' }, storno_positionen: moment, lieferscheine: [] }
const beleg = { ...basis, id: 's1', datum: '2026-10-05', rechnungsnummer: 'ST-2026-0001', art: 'storno', storniert: false,
  storniert_durch_id: null, notizen: 'Kunde hat falsche Ware erhalten', lieferscheine: [],
  storno_von: { id: 'r7', rechnungsnummer: 'RE-2026-0007', datum: '2026-08-20', storno_positionen: moment } }
// vor KAN-379 storniert (kein Stornobeleg) – zählt nicht
const altfall = { ...basis, id: 'r3', datum: '2026-10-02', rechnungsnummer: 'RE-2026-0003', art: 'rechnung', storniert: true,
  storniert_durch_id: null, storno_positionen: [pos(500, 1, 20)], lieferscheine: [] }
const normal = { ...basis, id: 'r9', datum: '2026-10-10', rechnungsnummer: 'RE-2026-0009', art: 'rechnung', storniert: false, storniert_durch_id: null,
  lieferscheine: [{ id: 'ls-9', lieferscheinnummer: 'LS-9', datum: '2026-10-10', verkauf_positionen: [pos(60, 1, 20)] }] }

describe('KAN-379: Stornobeleg als Beleg (alsBeleg, zaehltMitBetrag)', () => {
  test('Stornobeleg = Positionen des Originals mit negativer Menge, betragsgleich', () => {
    const s = B.alsBeleg(beleg)
    assert.deepEqual(s.verkauf_positionen.map(p => p.menge), [-1, -3])
    assert.deepEqual(s.verkaufsposten_ids, [])
    const o = B.alsBeleg(original)
    assert.equal(U.rechnungBrutto(o), 150.51)   // 120 + 11,3·3·0,9 = 30,51
    assert.equal(U.rechnungBrutto(s), -150.51)
    assert.equal(U.rechnungNetto(s), -U.rechnungNetto(o))
    // ohne Einbettung storno_von (Leser vergisst STORNO_FELDER) kein Phantasiebetrag
    assert.deepEqual(B.alsBeleg({ ...beleg, storno_von: null }).verkauf_positionen, [])
  })
  test('zaehltMitBetrag: Original mit Stornobeleg und Stornobeleg ja, Altfall und inaktiv nein', () => {
    assert.equal(B.zaehltMitBetrag(original), true)
    assert.equal(B.zaehltMitBetrag(beleg), true)
    assert.equal(B.zaehltMitBetrag(altfall), false)
    assert.equal(B.zaehltMitBetrag({ ...beleg, aktiv: false }), false)
    assert.equal(B.zaehltMitBetrag(normal), true)
    // Hotfix 28.10.2026: über die Spalte (verwiesene Zeile) – „rechnungen!storno_von_id“ wäre auf derselben Tabelle die
    // Gegenrichtung (Liste) und machte jeden Stornobeleg zu 0 € (UAT: ST-2026-0002 „zu Rechnung vom –“)
    assert.match(B.STORNO_FELDER, /storno_von:storno_von_id\(id, rechnungsnummer, datum, storno_positionen\)/)
    assert.match(B.STORNO_FELDER, /storniert_durch:storniert_durch_id\(id, rechnungsnummer, datum\)/)
    assert.doesNotMatch(B.STORNO_FELDER, /rechnungen!/)
  })
})

describe('KAN-379: Umsatz, offene Posten, BMD-Zähler', () => {
  test('Umsatz je Monat: Original im August, Stornobeleg negativ im Oktober (wie die UVA); Altfall zählt nicht', () => {
    const belege = [original, beleg, altfall, normal].map(B.alsBeleg)
    const m = U.umsatzJeMonat(belege, ['2026-08', '2026-10'])
    const netto = U.rechnungNetto(B.alsBeleg(original))
    assert.equal(netto, 127)   // 100 + 27 (30,51 / 1,13)
    assert.deepEqual(m.get('2026-08'), { umsatz: 127, anzahl: 1 })
    assert.deepEqual(m.get('2026-10'), { umsatz: -77, anzahl: 2 })   // 50 − 127
    // im selben Zeitraum heben sich Original und Stornobeleg auf
    assert.equal(U.umsatzNetto([original, beleg].map(B.alsBeleg)), 0)
  })
  test('Lader: nicht storniert oder storniert mit Stornobeleg, Stornobeleg mit der Momentaufnahme des Originals', async () => {
    const db = datenbank({ rechnungen: [original, beleg, altfall, normal, { ...normal, id: 'fremd', tenant_id: 'x' }] })
    const { data, error } = await U.ladeUmsatzRechnungen(db, T, '2026-08-01', '2026-10-31')
    assert.equal(error, null)
    assert.deepEqual(data.map(r => r.id).sort(), ['r7', 'r9', 's1'])
    assert.equal(U.umsatzNetto(data), 50)
    assert.match(U.UMSATZ_RECHNUNG_SELECT, /storno_positionen, art, storniert_durch_id, storno_von:storno_von_id/)
  })
  test('Belegliste der Umsatz-Auswertung: Stornobeleg gekennzeichnet (nicht „Offen“), Betrag negativ', () => {
    const z = U.umsatzBelegZeile(B.alsBeleg(beleg), 'rechnung')
    assert.equal(z.stornobeleg, true)
    assert.equal(z.netto, -127)
    assert.equal(z.href, '/weinhandel/rechnungen/s1')
    assert.equal(U.umsatzBelegZeile(B.alsBeleg(normal), 'rechnung').stornobeleg, false)
    assert.match(quelle('src/app/(dashboard)/reports/ReportsClient.tsx'), /\{p\.stornobeleg \? <span className="text-s112-muted">Stornobeleg<\/span>/)
  })
  test('offene Posten: ein Stornobeleg ist kein offener Posten', async () => {
    const db = datenbank({ rechnungen: [original, beleg, normal], zahlungen: [] })
    const { data, error } = await U.ladeOffenePostenListe(db, T, '2026-10-20')
    assert.equal(error, null)
    assert.deepEqual(data.map(p => p.id), ['r9'])
    assert.match(quelle('src/lib/verkauf/umsatz.ts'), /\.filter\(r => r\.art !== 'storno'\)   \/\/ KAN-379: ein Stornobeleg ist kein offener Posten/)
  })
  test('BMD-Zähler: Stornobeleg und noch nicht übergebene Rechnung mit Stornobeleg sind offen, Altfall nicht', async () => {
    assert.deepEqual(U.rechnungenOhneBmdExport([original, beleg, altfall, normal]).map(r => r.id), ['r7', 's1', 'r9'])
    assert.deepEqual(U.rechnungenOhneBmdExport([{ ...original, bmd_export_id: 'p1' }, beleg]).map(r => r.id), ['s1'])
    const db = datenbank({ rechnungen: [original, beleg, altfall, normal] })
    const { data } = await U.ladeRechnungenOhneBmdExport(db, T, '2026-08-01', '2026-10-31')
    assert.deepEqual(data.map(r => r.id).sort(), ['r7', 'r9', 's1'])
  })
})

describe('KAN-379: Rechnungsjournal', () => {
  test('Stornobeleg: negative Beträge, „Storno zu“; Original: „Storniert durch“, beide in der Summe', () => {
    const { zeile: s } = rj.rechnungsjournalZeile(B.alsBeleg(beleg))
    const { zeile: o } = rj.rechnungsjournalZeile(B.alsBeleg(original))
    assert.equal(s.brutto, -150.51)
    assert.equal(s.netto20, -100)
    assert.equal(s.ust13, -o.ust13)
    assert.equal(s.stornoZu, 'RE-2026-0007')
    assert.equal(s.stornoGrund, 'Kunde hat falsche Ware erhalten')
    assert.equal(s.storniert, false)
    assert.equal(o.storniertDurch, 'ST-2026-0001')
    assert.equal(o.brutto, 150.51)
    assert.equal(rj.zaehltInJournalSumme(s), true)
    assert.equal(rj.zaehltInJournalSumme(o), true)
    assert.equal(rj.zaehltInJournalSumme(rj.rechnungsjournalZeile(B.alsBeleg(altfall)).zeile), false)
    const koepfe = rj.SPALTEN_RECHNUNGSJOURNAL.map(c => c.kopf)
    assert.deepEqual(koepfe.slice(koepfe.indexOf('Storno-Grund'), koepfe.indexOf('Bezahlt')), ['Storno-Grund', 'Storniert durch', 'Storno zu'])
  })
  test('ladeRechnungsjournal: Stornobeleg mit eigener Nummer, Hinweise zu Stornobeleg und Altfall', async () => {
    const db = datenbank({ rechnungen: [original, beleg, altfall, normal], exportauftraege: [] })
    const { zeilen, warnungen } = await rj.ladeRechnungsjournal(db, T, { von: '2026-08-01', bis: '2026-10-31' })
    assert.deepEqual(zeilen.map(z => z.rechnungsnummer), ['RE-2026-0007', 'RE-2026-0003', 'ST-2026-0001', 'RE-2026-0009'])
    const summe = zeilen.filter(rj.zaehltInJournalSumme).reduce((a, z) => a + z.brutto, 0)
    assert.equal(Math.abs(summe - 60) < 1e-9, true)   // Original und Stornobeleg heben sich auf, Altfall nicht gezählt
    assert.ok(warnungen.some(w => /1 Rechnung ist ohne Stornobeleg storniert/.test(w)))
    assert.ok(warnungen.some(w => /Stornos mit Stornobeleg: 1 stornierte Rechnung und 1 Stornobeleg/.test(w)))
    // Nummernkreis ST eigen geprüft – keine Lückenmeldung RE↔ST
    assert.ok(!warnungen.some(w => /ST-2026/.test(w)))
  })
  test('Druckseite: Summe mit zaehltInJournalSumme, Verweise je Zeile', () => {
    const s = quelle('src/app/(dashboard)/buchhaltung/rechnungsjournal/page.tsx')
    assert.match(s, /const gueltig = zeilen\.filter\(zaehltInJournalSumme\)/)
    assert.match(s, /z\.storniertDurch \? ` durch \$\{z\.storniertDurch\}` : ''/)
    assert.match(s, /Storno zu \{z\.stornoZu\}/)
    assert.doesNotMatch(s, /zeilen\.filter\(z => !z\.storniert\)/)
  })
})

describe('KAN-379: BMD-Export als Gutschrift', () => {
  test('Kopf: Stornobeleg mit eigener Nummer, Fremdbeleg = Original, Text „Storno … zu RE …“', () => {
    assert.deepEqual(bmd.bmdRechnungKopf(beleg, 'Vinothek Am Eck'),
      { belegnr: 'ST-2026-0001', extbelegnr: 'RE-2026-0007', text: 'Vinothek Am Eck Storno ST-2026-0001 zu RE RE-2026-0007', gutschrift: true })
    assert.deepEqual(bmd.bmdRechnungKopf(normal, 'Vinothek Am Eck'),
      { belegnr: 'RE-2026-0009', extbelegnr: '', text: 'Vinothek Am Eck RE RE-2026-0009', gutschrift: false })
  })
  test('negative Beträge im Buchungsstapel mit Minus und Dezimalkomma', () => {
    const z = { satzart: '0', konto: '200001', gkonto: '4000', belegnr: 'ST-2026-0001', belegdatum: '05.10.2026', buchdatum: '05.10.2026',
      buchsymbol: 'AR', buchcode: '1', prozent: 20, steuercode: '1', betrag: -120, steuer: -20, text: 'Storno', kost: '',
      extbelegnr: 'RE-2026-0007', nettodatum: '05.10.2026', skontopz: 0, dokument: '' }
    const zeile = bmd.bmdCsv([z]).split('\r\n')[1]
    assert.match(zeile, /;20;1;-120,00;-20,00;Storno;;RE-2026-0007;05\.10\.2026;0;$/)
  })
  test('Route: Stornobelege und Rechnungen mit Stornobeleg, Kopf aus bmdRechnungKopf, ohne Skonto bei Gutschrift', () => {
    const r = quelle('src/app/api/export/bmd/route.ts')
    assert.match(r, /\.eq\('tenant_id', tenantId\)\.eq\('aktiv', true\)\.or\(STORNIERT_ZAEHLT\)/)
    assert.match(r, /const posten = roh\.filter\(zaehltMitBetrag\)\.map\(alsBeleg\)/)
    assert.match(r, /\$\{STORNO_FELDER\}/)
    assert.match(r, /text: kopf\.text, kost: '', extbelegnr: kopf\.extbelegnr,/)
    assert.match(r, /skontopz: !kopf\.gutschrift && p\.skonto_aktiv/)
  })
})

describe('KAN-379: Rechnungsseite und Suche', () => {
  test('Rechnungsseite: Stornorechnung mit Verweis, ohne Zahlungsteil; Original verweist auf den Stornobeleg', () => {
    const s = quelle('src/app/(dashboard)/weinhandel/rechnungen/[id]/page.tsx')
    assert.match(s, /\{storno \? 'STORNORECHNUNG' : 'RECHNUNG'\}/)
    assert.match(s, /zu Rechnung \{original\.rechnungsnummer\} vom \{d\(original\.datum\)\}/)
    assert.match(s, /\{!storno && <div className="mt-8/)
    assert.match(s, /Stornobeleg <Link href=\{`\/weinhandel\/rechnungen\/\$\{stornoDurch\.id\}`\}/)
    assert.match(s, /\$\{STORNO_FELDER\}/)
  })
  test('Suche: Stornobeleg als solcher, ohne „offen“', () => {
    const s = quelle('src/app/api/global-search/route.ts')
    assert.match(s, /\.select\('id, rechnungsnummer, datum, bezahlt, storniert, art'\)/)
    assert.match(s, /r\.art === 'storno' \? 'Stornobeleg' : 'Rechnung'/)
  })
})
