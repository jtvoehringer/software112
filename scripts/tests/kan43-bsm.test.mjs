// KAN-43 Etappe 2 (02.10.2026) – Weinbestandsmeldung (BSM) nach Buchungsarten je Meldezeitraum
//
// Aufruf:  npm run -s test:csv   (alle scripts/tests/*.test.mjs)
//
// 1. Zuordnung Bewegung → BSM-Buchungsart (Keller und Flaschen), BSM-Spalte, Meldefarbe, Herkunft.
// 2. Meldezeitraum: Weinwirtschaftsjahr 1.8.–31.7. (Entscheidung Jörgen 02.10.2026), Standard, Parameter, Vortag.
// 3. ladeBsm() mit Beispieldaten: Anfangsbestand (Eröffnung), Ernte, Umzug mit Schwund und Abwertung, Füllung mit
//    Füllverlust, Tank- und Flaschenverkauf AT/Ausland, Storno-Paar, Bruch, Traubenzukauf (kg), Buchung nach dem
//    Zeitraum → Endbestand lt. Rechnung = Stichtagsbestand (keine Differenz).
// 4. Verschnitt mit Spaltenwechsel des vorhandenen Ziel-Weins, Aufwertung als Warnung, Abgleich mit Differenz.
// 5. Register (Parameter, Dateiname nach „bis“), CSV, Druckseite.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { hooksRegistrieren, laden, nurMitHooks, datenbank, ohneMandant } from './buchung-attrappe.mjs'

hooksRegistrieren()

const quelle = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')
const T = 'tenant-1'
const FREMD = 'tenant-2'
const HEUTE = '2026-10-02'
const WJ = { von: '2025-08-01', bis: '2026-07-31' }

// ── 1. Zuordnung ──────────────────────────────────────────────────────────────

describe('KAN-43 BSM: Zuordnung', nurMitHooks, () => {
  test('Keller-Bewegung → Buchungsart', async () => {
    const { buchungsartBewegung } = await laden('lib/behoerden/bsm.ts')
    assert.equal(buchungsartBewegung('pressung'), 'ERNTE')
    assert.equal(buchungsartBewegung('zukauf', { zukaufArt: 'wein' }), 'ZK_FASS')
    assert.equal(buchungsartBewegung('zukauf', { zukaufArt: 'most' }), 'ZK_MOST')
    assert.equal(buchungsartBewegung('verkauf', { kundeAusland: false }), 'VK_FA_AT')
    assert.equal(buchungsartBewegung('verkauf', { kundeAusland: true }), 'VK_FA_AU')
    assert.equal(buchungsartBewegung('schwund'), 'SCHWUND')
    assert.equal(buchungsartBewegung('verschneidung_aus'), 'VS_AB')
    assert.equal(buchungsartBewegung('verschneidung_ein'), 'VS_ZU')
    assert.equal(buchungsartBewegung('umzug_aus'), 'UMZUG')
    assert.equal(buchungsartBewegung('filtration_ein'), 'FILTRAT')
    assert.equal(buchungsartBewegung('abfuellung'), 'FUELLUNG')
    assert.equal(buchungsartBewegung('anfangsbestand'), 'EROEFF')
    assert.equal(buchungsartBewegung('behandlung'), null)
  })

  test('Flaschenbuchung → Buchungsart', async () => {
    const { buchungsartFlasche } = await laden('lib/behoerden/bsm.ts')
    assert.equal(buchungsartFlasche('verkauf', -5, { kundeAusland: false }), 'VK_FL_AT')
    assert.equal(buchungsartFlasche('verkauf_alt', -5, { kundeAusland: true }), 'VK_FL_AU')
    assert.equal(buchungsartFlasche('verkauf_storno', 5, { kundeAusland: true }), 'VK_FL_AU')
    assert.equal(buchungsartFlasche('bruch', -1), 'SCHWUND')
    assert.equal(buchungsartFlasche('eigenverbrauch', -1), 'SCHWUND')
    assert.equal(buchungsartFlasche('inventur', -3), 'SCHWUND')
    assert.equal(buchungsartFlasche('korrektur', 3), 'INV_PLUS')
    assert.equal(buchungsartFlasche('anfangsbestand', 30), 'EROEFF')
    assert.equal(buchungsartFlasche('abfuellung', 100, { mitCharge: true }), 'FUELLUNG')
    assert.equal(buchungsartFlasche('abfuellung', 100, { eroeffnung: true }), 'EROEFF')
    assert.equal(buchungsartFlasche('abfuellung', 100, {}), 'ZK_FLA')
    // jede verwendete Buchungsart steht im Katalog (kat_buchungsart)
    const { KAT_BUCHUNGSART } = await laden('lib/katalog/bki.ts')
    const codes = new Set(KAT_BUCHUNGSART.map(b => b.code))
    for (const c of ['ERNTE', 'ZK_FASS', 'ZK_MOST', 'ZK_TRAUB', 'ZK_FLA', 'VK_FA_AT', 'VK_FA_AU', 'VK_FL_AT', 'VK_FL_AU', 'SCHWUND', 'VS_ZU', 'VS_AB', 'ZU_ABW', 'AB_ABW', 'UMZUG', 'FILTRAT', 'FUELLUNG', 'EROEFF', 'INV_PLUS']) assert.ok(codes.has(c), c)
  })

  test('BSM-Spalte, Farbe, Herkunft', async () => {
    const { bsmSpalte, bsmFarbe, bsmHerkunft } = await laden('lib/behoerden/bsm.ts')
    const a = (stufe, erzeugnis = null, zusatz = null) => ({ stufe, zusatz, erzeugnis })
    const sp = (angabe, rebsorte = 'Grüner Veltliner', jahrgang = 2025) => bsmSpalte({ angabe, rebsorte, jahrgang })
    assert.equal(sp(a('qualitaetswein')).spalte, 'qualitaetswein')
    assert.equal(sp(a('dac')).spalte, 'qualitaetswein')
    assert.equal(sp(a('kabinett')).spalte, 'qualitaetswein')       // Kabinett-Spalte: vorläufig Qualitätswein (KAN-38)
    assert.equal(sp(a('qualitaetswein', null, 'reserve')).spalte, 'qualitaetswein')
    assert.equal(sp(a('spaetlese')).spalte, 'praedikatswein')
    assert.equal(sp(a('landwein')).spalte, 'landwein')
    assert.equal(sp(a('wein')).spalte, 'rebsortenwein')
    assert.equal(sp(a('wein'), null, null).spalte, 'wein')
    assert.equal(sp(a('qualitaetswein', 'SEKTGU')).spalte, 'perl_schaumwein')
    assert.equal(sp(a('wein', 'PETNAT')).spalte, 'perl_schaumwein')
    assert.equal(sp(a(null, 'WEINHALT')).spalte, 'sonstige')
    assert.equal(sp(a('sonstiges')).spalte, 'sonstige')
    assert.deepEqual(sp(a(null)), { spalte: 'rebsortenwein', relevant: true, ohneStufe: true })
    assert.equal(sp(a(null, 'TRAUBSFT')).relevant, false)            // R10: Traubensaft nicht meldepflichtig
    assert.equal(bsmFarbe({ weinart: 'rose', rebsorte: null }), 'R')  // R17: Rosé zählt zu rot
    assert.equal(bsmFarbe({ weinart: 'unbekannt', rebsorte: 'Zweigelt' }), 'R')
    assert.equal(bsmFarbe({ weinart: null, rebsorte: 'Grüner Veltliner' }), 'W')
    assert.equal(bsmFarbe({ weinart: null, rebsorte: 'Hausmarke' }), null)
    assert.deepEqual(bsmHerkunft('AT'), { herkunft: 'AT', unbekannt: false })
    assert.deepEqual(bsmHerkunft('DE'), { herkunft: 'EU', unbekannt: false })
    assert.deepEqual(bsmHerkunft('CH'), { herkunft: 'DRITT', unbekannt: false })
    assert.deepEqual(bsmHerkunft(null), { herkunft: 'AT', unbekannt: true })
  })
})

// ── 2. Meldezeitraum ──────────────────────────────────────────────────────────

describe('KAN-43 BSM: Meldezeitraum', nurMitHooks, () => {
  test('Weinwirtschaftsjahr 1.8.–31.7., Standard = zuletzt abgeschlossenes', async () => {
    const m = await laden('lib/behoerden/bsm.ts')
    assert.equal(m.STANDARD_BSM_ZEITRAUM, 'weinwirtschaftsjahr')
    assert.deepEqual(m.weinwirtschaftsjahr(2025), WJ)
    assert.deepEqual(m.standardBsmZeitraum('2026-10-02'), WJ)
    assert.deepEqual(m.standardBsmZeitraum('2026-08-01'), WJ)
    assert.deepEqual(m.standardBsmZeitraum('2026-07-31'), { von: '2024-08-01', bis: '2025-07-31' })
    assert.deepEqual(m.standardBsmZeitraum('2026-10-02', 'kalenderjahr'), { von: '2025-01-01', bis: '2025-12-31' })
    assert.equal(m.wjBeginnJahr('2026-07-31'), 2025)
    assert.equal(m.wjBeginnJahr('2026-08-01'), 2026)
    assert.equal(m.vortag('2025-08-01'), '2025-07-31')
    assert.equal(m.vortag('2024-03-01'), '2024-02-29')
    assert.equal(m.vortag('2026-01-01'), '2025-12-31')
    assert.equal(m.istWeinwirtschaftsjahr(WJ), true)
    assert.equal(m.istWeinwirtschaftsjahr({ von: '2025-01-01', bis: '2025-12-31' }), false)
    assert.equal(m.bsmKennzeichnung(WJ), 'WJ 2025/26')
    const w = m.bsmSchnellwahlen(HEUTE)
    assert.deepEqual(w[0], { label: 'Weinwirtschaftsjahr 2025/26', ...WJ })
    assert.ok(w.filter(x => x.label.startsWith('Kalenderjahr')).every(x => /\(Auswertung, keine BSM\)/.test(x.label)))
    assert.deepEqual(w.find(x => x.label.startsWith('laufendes')), { label: 'laufendes Weinwirtschaftsjahr 2026/27 bis heute', von: '2026-08-01', bis: HEUTE })
  })

  test('?von=&bis=&art=: Standard, gültig, Fehler', async () => {
    const { bsmParameter } = await laden('lib/behoerden/bsm.ts')
    const { istParameterFehler } = await laden('lib/behoerden/typen.ts')
    const p = q => bsmParameter(new URLSearchParams(q), HEUTE)
    assert.deepEqual(p(''), { ...WJ, arten: [] })
    assert.deepEqual(p('von=2025-01-01&bis=2025-12-31'), { von: '2025-01-01', bis: '2025-12-31', arten: [] })
    assert.deepEqual(p('art=zu_abw,AB_ABW'), { ...WJ, arten: ['ZU_ABW', 'AB_ABW'] })
    for (const q of ['von=2025-08-01', 'bis=2026-07-31', 'von=2026-08-01&bis=2026-07-31', 'von=2026-08-01&bis=2026-10-03', 'von=31.07.2025&bis=2026-07-31', 'art=XYZ']) {
      assert.ok(istParameterFehler(p(q)), q)
    }
    assert.match(p('von=2026-08-01&bis=2026-10-03').fehler, /Zukunft/)
  })
})

// ── 3. Ladefunktion mit Beispieldaten ─────────────────────────────────────────

const pressung = (id, datum, tenant = T) => ({ id, datum, notizen: null, tenant_id: tenant, storniert_am: null })
const b1 = { name: 'T1' }, b2 = { name: 'T2' }, b3 = { name: 'T3' }

function tabellen() {
  return {
    weinausbau: [
      // GV: Ernte 1000 l (20.09.2025), Füllung 404 l → 400 Fl. à 1 l (01.03.2026), Tankverkauf DE 100 l (01.05.2026),
      // Tankverkauf AT 50 l am 10.01.2026 – am 10.02.2026 storniert, Tankverkauf AT 50 l am 15.08.2026 (nach dem WJ) → heute 446
      { id: 'w1', tenant_id: T, name: 'GV 25', jahrgang: 2025, rebsorte: 'Grüner Veltliner', qualitaetsstufe: 'qualitaetswein', weinart: 'weiss', land_iso: 'AT', menge_liter: 446, status: 'lagerung', aktiv: true, created_at: '2025-09-20T10:00:00Z', behaelter_id: 'b1', behaelter: b1 },
      // ZW Kabinett: Eröffnungsbestand 500 l (01.07.2025), Umzug 300 l brutto / 295 l netto in neue Landwein-Charge (01.02.2026) → heute 200
      { id: 'w2', tenant_id: T, name: 'ZW Kabinett', jahrgang: 2024, rebsorte: 'Zweigelt', qualitaetsstufe: 'kabinett', weinart: 'rot', land_iso: 'AT', menge_liter: 200, status: 'lagerung', aktiv: true, ist_eroeffnungsbestand: true, anfangsbestand_liter: 500, created_at: '2025-06-30T22:00:00Z', behaelter_id: 'b2', behaelter: b2 },
      { id: 'w3', tenant_id: T, name: 'ZW Landwein', jahrgang: 2024, rebsorte: 'Zweigelt', qualitaetsstufe: 'landwein', weinart: 'rot', land_iso: 'AT', menge_liter: 295, status: 'lagerung', aktiv: true, created_at: '2026-02-01T09:00:00Z', behaelter_id: 'b3', behaelter: b3 },
      { id: 'w9', tenant_id: FREMD, name: 'Fremd', jahrgang: 2025, menge_liter: 999, status: 'lagerung', aktiv: true, created_at: '2025-09-01T10:00:00Z' },
    ],
    pressung_behaelter: [
      { id: 'pb1', menge_liter: 1000, weinausbau_id: 'w1', behaelter_id: 'b1', notizen: null, storniert_am: null, pressung: pressung('p1', '2025-09-20') },
      { id: 'pb9', menge_liter: 999, weinausbau_id: 'w9', behaelter_id: 'b9', notizen: null, storniert_am: null, pressung: pressung('p9', '2025-09-01', FREMD) },
    ],
    keller_umzuege: [
      { id: 'u1', tenant_id: T, datum: '2026-02-01', menge_liter: 300, brutto_liter: 300, schwund_liter: 5, umzug_typ: 'normal', zeilen_typ: 'quelle', umzug_batch_id: 'batch1', von_behaelter_id: 'b2', von_weinausbau_id: 'w2', nach_behaelter_id: null, nach_weinausbau_id: null, storniert_am: null, qualitaet_vorher: 'kabinett', qualitaet_nachher: 'kabinett', von_behaelter: b2, von_weinausbau: { name: 'ZW Kabinett', jahrgang: 2024, behaelter: b2 } },
      { id: 'u2', tenant_id: T, datum: '2026-02-01', menge_liter: 295, brutto_liter: null, schwund_liter: 0, umzug_typ: 'normal', zeilen_typ: 'ziel', umzug_batch_id: 'batch1', von_behaelter_id: null, von_weinausbau_id: null, nach_behaelter_id: 'b3', nach_weinausbau_id: 'w3', storniert_am: null, qualitaet_vorher: null, qualitaet_nachher: null, nach_behaelter: b3, nach_weinausbau: { name: 'ZW Landwein' } },
    ],
    fuellungen: [
      // 400 Fl. à 1 l; Verkauf 100 (alt, Kontakt AT) am 01.06.2026, Bruch 10 am 10.07.2026 → heute 290
      { id: 'f1', tenant_id: T, datum: '2026-03-01', name: 'GV Klassik', jahrgang: 2025, rebsorte: 'Grüner Veltliner', qualitaet: 'qualitaetswein', land_iso: 'AT', aktiv: true, bestand_flaschen: 290, anzahl_flaschen: 400, menge_liter_gefuellt: 404, flaschengroesse_ml: 1000, weinausbau_id: 'w1', storniert_am: null, weinausbau: { weinart: 'weiss' } },
      { id: 'f9', tenant_id: FREMD, datum: '2026-01-01', name: 'Fremd', aktiv: true, bestand_flaschen: 99, anzahl_flaschen: 99, flaschengroesse_ml: 750, weinausbau_id: 'w9', storniert_am: null },
    ],
    fuellung_bewegungen: [
      { id: 'fb1', tenant_id: T, fuellung_id: 'f1', datum: '2026-07-10', art: 'bruch', menge_stk: -10, verkaufsposten_id: null },
    ],
    verkauf_positionen: [
      { id: 'vf1', tenant_id: T, typ: 'flasche', menge: 100, fuellung_id: 'f1', weinausbau_id: null, verkaufsposten_id: 'vp1', verkaufsposten: { datum: '2026-06-01', storniert: false, storniert_am: null } },
      { id: 'vt1', tenant_id: T, typ: 'tank', menge: 100, fuellung_id: null, weinausbau_id: 'w1', verkaufsposten_id: 'vp2', verkaufsposten: { datum: '2026-05-01', storniert: false, storniert_am: null, rechnungsnummer: 'R-2', firma: { name: 'Weinhaus München' } } },
      { id: 'vt2', tenant_id: T, typ: 'tank', menge: 50, fuellung_id: null, weinausbau_id: 'w1', verkaufsposten_id: 'vp3', verkaufsposten: { datum: '2026-01-10', storniert: true, storniert_am: '2026-02-10T10:00:00Z', rechnungsnummer: 'R-3' } },
      { id: 'vt3', tenant_id: T, typ: 'tank', menge: 50, fuellung_id: null, weinausbau_id: 'w1', verkaufsposten_id: 'vp4', verkaufsposten: { datum: '2026-08-15', storniert: false, storniert_am: null, rechnungsnummer: 'R-4' } },
    ],
    verkaufsposten: [
      { id: 'vp1', tenant_id: T, datum: '2026-06-01', rechnungsnummer: 'R-1', partner_daten: null, kontakt: { vorname: 'Anna', nachname: 'Huber', land: 'AT' }, firma: null },
      { id: 'vp2', tenant_id: T, datum: '2026-05-01', rechnungsnummer: 'R-2', partner_daten: null, kontakt: null, firma: { name: 'Weinhaus München', land: 'DE' } },
      { id: 'vp3', tenant_id: T, datum: '2026-01-10', rechnungsnummer: 'R-3', partner_daten: null, kontakt: null, firma: { name: 'Heuriger Wien', land: 'Österreich' } },
      { id: 'vp4', tenant_id: T, datum: '2026-08-15', rechnungsnummer: 'R-4', partner_daten: null, kontakt: null, firma: { name: 'Heuriger Wien', land: 'AT' } },
      { id: 'vp9', tenant_id: FREMD, datum: '2026-01-10', rechnungsnummer: 'X', partner_daten: null },
    ],
    zukauf_posten: [
      { id: 'z1', tenant_id: T, datum: '2025-09-15', art: 'trauben', einheit: 'kg', menge: 2000, ziel_weinausbau_id: null, aktiv: true, rebsorte: 'Grüner Veltliner', jahrgang: 2025, weinart: 'weiss', qualitaetsstufe: 'qualitaetswein', land_iso: 'AT' },
    ],
    verschneidung_quellen: [],
    verschneidungen: [],
  }
}

const RPC = () => ({ data: [], error: null })
const zelle = (summen, position, teil = 'gesamt', h = 'AT') => summen.find(z => z.herkunft === h && z.position === position && z.teil === teil)

describe('KAN-43 BSM: ladeBsm()', nurMitHooks, () => {
  test('WJ 2025/26: Anfang + Zugänge − Abgänge = Endbestand = Stichtagsbestand', async () => {
    const { ladeBsm } = await laden('lib/behoerden/bsm.ts')
    const db = datenbank(tabellen(), { rpc: RPC })
    const d = await ladeBsm(db, T, WJ, { heute: HEUTE })
    assert.equal(d.anfangAm, '2025-07-31')
    const kurz = d.buchungen.map(b => [b.datum, b.code, b.spalte, b.farbe, b.gebinde, b.liter])
    assert.deepEqual(kurz, [
      ['2025-09-15', 'ZK_TRAUB', 'qualitaetswein', 'W', 'offen', 0],
      ['2025-09-20', 'ERNTE', 'qualitaetswein', 'W', 'offen', 1000],
      ['2026-01-10', 'VK_FA_AT', 'qualitaetswein', 'W', 'offen', -50],
      ['2026-02-01', 'AB_ABW', 'qualitaetswein', 'R', 'offen', -295],     // Kabinett → Landwein: Spaltenwechsel
      ['2026-02-01', 'SCHWUND', 'qualitaetswein', 'R', 'offen', -5],      // Umzugsschwund
      ['2026-02-01', 'ZU_ABW', 'landwein', 'R', 'offen', 295],
      ['2026-02-10', 'VK_FA_AT', 'qualitaetswein', 'W', 'offen', 50],     // Storno-Gegenbuchung
      ['2026-03-01', 'FUELLUNG', 'qualitaetswein', 'W', 'offen', -400],
      ['2026-03-01', 'SCHWUND', 'qualitaetswein', 'W', 'offen', -4],      // Füllverlust
      ['2026-03-01', 'FUELLUNG', 'qualitaetswein', 'W', 'flasche', 400],
      ['2026-05-01', 'VK_FA_AU', 'qualitaetswein', 'W', 'offen', -100],   // Kunde in Deutschland
      ['2026-06-01', 'VK_FL_AT', 'qualitaetswein', 'W', 'flasche', -100], // 100 Fl. × 1 l
      ['2026-07-10', 'SCHWUND', 'qualitaetswein', 'W', 'flasche', -10],   // Bruch
    ])
    assert.equal(d.buchungen[0].kg, 2000)
    assert.equal(d.traubenKg, 2000)
    // Summentabelle (Abgänge positiv)
    const S = d.summen
    assert.equal(zelle(S, 'ANFANG').werte.qualitaetswein, 500)              // Eröffnungsbestand vor dem WJ
    assert.equal(zelle(S, 'ANFANG', 'davon rot (inkl. Rosé)').werte.qualitaetswein, 500)
    assert.equal(zelle(S, 'ANFANG', 'davon weiß').summeLiter, 0)            // R17: „davon weiß“ auch bei 0
    assert.equal(zelle(S, 'ERNTE').werte.qualitaetswein, 1000)
    assert.equal(zelle(S, 'ZU_ABW').werte.landwein, 295)
    assert.equal(zelle(S, 'AB_ABW').werte.qualitaetswein, 295)
    assert.equal(zelle(S, 'AB_ABW', 'davon rot (inkl. Rosé)').werte.qualitaetswein, 295)
    assert.equal(zelle(S, 'VK_FA_AT').summeLiter, 0)                        // Storno hebt den Verkauf auf
    assert.equal(zelle(S, 'VK_FA_AU').werte.qualitaetswein, 100)
    assert.equal(zelle(S, 'VK_FL_AT').werte.qualitaetswein, 100)
    assert.equal(zelle(S, 'SCHWUND').werte.qualitaetswein, 19)
    assert.ok(!S.some(z => z.position === 'NEUTRAL'))                       // Füllung offen → Flasche gleicht sich aus
    const ende = zelle(S, 'ENDE'), stichtag = zelle(S, 'STICHTAG')
    assert.deepEqual([ende.werte.qualitaetswein, ende.werte.landwein], [986, 295])
    assert.deepEqual(ende.werte, stichtag.werte)
    assert.equal(zelle(S, 'STICHTAG', 'davon Flasche').werte.qualitaetswein, 290)
    assert.equal(zelle(S, 'STICHTAG', 'davon offen (Fass/Tank)').werte.qualitaetswein, 696)  // 496 GV + 200 ZW
    assert.equal(zelle(S, 'DIFFERENZ').summeLiter, 0)
    assert.equal(ende.summeHl, 12.81)
    assert.deepEqual(d.herkuenfte, ['AT'])
    assert.ok(!d.spalten.includes('ohne'))
    // Plausibilität
    assert.ok(!d.warnungen.some(w => /Abgleich|nicht gleich|Aufwertung|negativ/i.test(w)), d.warnungen.join('\n'))
    assert.ok(d.warnungen.some(w => /Zukauf Trauben 2\.000 kg: Umrechnung kg → l ist offen/.test(w)), d.warnungen.join('\n'))
    // nur eigener Betrieb
    assert.deepEqual(ohneMandant(db, T, ['pressung_behaelter', 'verschneidung_quellen']), [])
  })

  test('Kalenderjahr als Auswertung: Warnung, Anfangsbestand am 31.12.', async () => {
    const { ladeBsm } = await laden('lib/behoerden/bsm.ts')
    const d = await ladeBsm(datenbank(tabellen(), { rpc: RPC }), T, { von: '2026-01-01', bis: '2026-09-30' }, { heute: HEUTE })
    assert.equal(d.anfangAm, '2025-12-31')
    assert.match(d.warnungen[0], /kein Weinwirtschaftsjahr/)
    assert.equal(zelle(d.summen, 'ANFANG').werte.qualitaetswein, 1500)      // 1000 GV + 500 ZW
    assert.equal(zelle(d.summen, 'VK_FA_AT').werte.qualitaetswein, 50)      // Verkauf 15.08.2026 (Storno-Paar hebt sich auf)
    assert.equal(zelle(d.summen, 'DIFFERENZ').summeLiter, 0)
  })

  test('Abgleich: heutiger Bestand ohne Buchung → Differenz als Warnung', async () => {
    const { ladeBsm } = await laden('lib/behoerden/bsm.ts')
    const t = tabellen()
    t.weinausbau[2].menge_liter = 305      // 10 l mehr als die Buchungen erklären (Beginn im Zeitraum)
    const d = await ladeBsm(datenbank(t, { rpc: RPC }), T, WJ, { heute: HEUTE })
    assert.equal(zelle(d.summen, 'DIFFERENZ').werte.landwein, 10)
    assert.ok(d.warnungen.some(w => /Abgleich: Österreich · Landwein · rot \(inkl\. Rosé\) · offen \(Fass\/Tank\) – Bestand zum 31\.07\.2026 weicht um 10,00 l/.test(w)), d.warnungen.join('\n'))
  })
})

// ── 4. Verschnitt, Aufwertung ─────────────────────────────────────────────────

function verschnittTabellen() {
  return {
    weinausbau: [
      // w5 war Qualitätswein (Ernte 1000 l), seit dem Verschnitt mit w6 (Landwein 200 l) am 01.10.2025 Landwein 1200 l
      { id: 'w5', tenant_id: T, name: 'WR Cuvée', jahrgang: 2025, rebsorte: 'Welschriesling', qualitaetsstufe: 'landwein', weinart: 'weiss', land_iso: 'AT', menge_liter: 1200, status: 'lagerung', aktiv: true, created_at: '2025-09-01T10:00:00Z', behaelter_id: 'b1', behaelter: b1 },
      { id: 'w6', tenant_id: T, name: 'WR Landwein', jahrgang: 2025, rebsorte: 'Welschriesling', qualitaetsstufe: 'landwein', weinart: 'weiss', land_iso: 'AT', menge_liter: 0, status: 'abgeschlossen', aktiv: false, created_at: '2025-09-02T10:00:00Z', behaelter_id: 'b2', behaelter: b2 },
      // w7 Landwein rot 100 l → Umzug in eine neue Qualitätswein-Charge w8 (Aufwertung)
      { id: 'w7', tenant_id: T, name: 'BF Landwein', jahrgang: 2025, rebsorte: 'Blaufränkisch', qualitaetsstufe: 'landwein', weinart: 'rot', land_iso: 'AT', menge_liter: 0, status: 'abgeschlossen', aktiv: false, created_at: '2025-09-05T10:00:00Z', behaelter_id: 'b3', behaelter: b3 },
      { id: 'w8', tenant_id: T, name: 'BF Qualität', jahrgang: 2025, rebsorte: 'Blaufränkisch', qualitaetsstufe: 'qualitaetswein', weinart: 'rot', land_iso: 'AT', menge_liter: 100, status: 'lagerung', aktiv: true, created_at: '2025-11-01T10:00:00Z', behaelter_id: 'b2', behaelter: b2 },
    ],
    pressung_behaelter: [
      { id: 'pb5', menge_liter: 1000, weinausbau_id: 'w5', behaelter_id: 'b1', notizen: null, storniert_am: null, pressung: pressung('p5', '2025-09-01') },
      { id: 'pb6', menge_liter: 200, weinausbau_id: 'w6', behaelter_id: 'b2', notizen: null, storniert_am: null, pressung: pressung('p6', '2025-09-02') },
      { id: 'pb7', menge_liter: 100, weinausbau_id: 'w7', behaelter_id: 'b3', notizen: null, storniert_am: null, pressung: pressung('p7', '2025-09-05') },
    ],
    keller_umzuege: [
      { id: 'u7', tenant_id: T, datum: '2025-11-01', menge_liter: 100, brutto_liter: 100, schwund_liter: 0, umzug_typ: 'normal', zeilen_typ: 'quelle', umzug_batch_id: 'batch7', von_behaelter_id: 'b3', von_weinausbau_id: 'w7', storniert_am: null, von_behaelter: b3, von_weinausbau: { name: 'BF Landwein', behaelter: b3 } },
      { id: 'u8', tenant_id: T, datum: '2025-11-01', menge_liter: 100, brutto_liter: null, schwund_liter: 0, umzug_typ: 'normal', zeilen_typ: 'ziel', umzug_batch_id: 'batch7', nach_behaelter_id: 'b2', nach_weinausbau_id: 'w8', storniert_am: null, nach_behaelter: b2, nach_weinausbau: { name: 'BF Qualität' } },
    ],
    fuellungen: [], fuellung_bewegungen: [], verkauf_positionen: [], verkaufsposten: [], zukauf_posten: [],
    verschneidung_quellen: [
      { id: 'vq1', menge_liter: 200, quell_weinausbau_id: 'w6', verschneidung: { datum: '2025-10-01', notizen: null, tenant_id: T, storniert_am: null, ziel: { name: 'WR Cuvée', behaelter: b1 } } },
    ],
    verschneidungen: [
      { id: 'v1', tenant_id: T, datum: '2025-10-01', notizen: null, ziel_weinausbau_id: 'w5', storniert_am: null, ziel_qualitaet_vorher: 'qualitaetswein', ziel_zusatz_vorher: null, ziel_erzeugnis_vorher: null, quellen: [{ menge_liter: 200, quelle: { name: 'WR Landwein', behaelter: b2 } }] },
    ],
  }
}

describe('KAN-43 BSM: Verschnitt und Aufwertung', nurMitHooks, () => {
  test('Verschnitt: VS_AB/VS_ZU, vorhandener Ziel-Wein per Abwertungspaar; Aufwertung als Warnung', async () => {
    const { ladeBsm, bsmJournal } = await laden('lib/behoerden/bsm.ts')
    const d = await ladeBsm(datenbank(verschnittTabellen(), { rpc: RPC }), T, WJ, { heute: HEUTE })
    const kurz = d.buchungen.map(b => [b.datum, b.code, b.spalte, b.liter])
    assert.deepEqual(kurz, [
      ['2025-09-01', 'ERNTE', 'qualitaetswein', 1000],   // Momentaufnahme: vor dem Verschnitt Qualitätswein
      ['2025-09-02', 'ERNTE', 'landwein', 200],
      ['2025-09-05', 'ERNTE', 'landwein', 100],
      ['2025-10-01', 'VS_AB', 'landwein', -200],
      ['2025-10-01', 'VS_ZU', 'landwein', 200],
      ['2025-10-01', 'AB_ABW', 'qualitaetswein', -1000],
      ['2025-10-01', 'ZU_ABW', 'landwein', 1000],
      ['2025-11-01', 'AB_ABW', 'landwein', -100],
      ['2025-11-01', 'ZU_ABW', 'qualitaetswein', 100],
    ])
    const ende = zelle(d.summen, 'ENDE')
    assert.deepEqual(ende.werte, zelle(d.summen, 'STICHTAG').werte)
    assert.deepEqual([ende.werte.landwein, ende.werte.qualitaetswein], [1200, 100])
    assert.ok(d.warnungen.some(w => /1 Vorgang führt Wein in eine höhere BSM-Spalte \(Aufwertung ist nicht zulässig\)/.test(w)), d.warnungen.join('\n'))
    assert.ok(!d.warnungen.some(w => /nicht gleich/.test(w)))              // Σ ZU_ABW = Σ AB_ABW
    // Kontrolljournal mit Filter „nur Abwertung“
    const j = bsmJournal(d, ['ZU_ABW', 'AB_ABW'])
    assert.equal(j.length, 4)
    assert.deepEqual(j.map(z => [z.code, z.zugang, z.abgang]), [['AB_ABW', null, 1000], ['ZU_ABW', 1000, null], ['AB_ABW', null, 100], ['ZU_ABW', 100, null]])
  })
})

// ── 5. Register, CSV, Druckseite ──────────────────────────────────────────────

describe('KAN-43 BSM: Register, CSV und Druckseite', nurMitHooks, () => {
  test('Register: Parameter, BKI-Dateiname nach „bis“, CSV mit gerundeten Werten', async () => {
    const { MELDUNGEN_ERNTE } = await laden('lib/behoerden/register/ernte.ts')
    const { meldungsDateiname } = await laden('lib/behoerden/dateiname.ts')
    const { ladeBsm, SPALTEN_BSM, SPALTEN_BSM_JOURNAL, bsmJournal } = await laden('lib/behoerden/bsm.ts')
    const csv = await laden('lib/csv/index.ts')
    const B = { name: 'Weingut Muster', betriebsnummer: '9988776' }
    const m = MELDUNGEN_ERNTE.bsm
    assert.equal(m.zugriff, 'betriebsleitung')
    assert.equal(m.druckPfad, '/reports/bestandsmeldung-bsm')
    assert.equal(meldungsDateiname(m, { ...WJ, arten: [] }, B, HEUTE).dateiname.ascii, '9988776_2026_Bestandsmeldung-BSM_von_20250801_bis_20260731.csv')
    const j = MELDUNGEN_ERNTE['bsm-kontrolljournal']
    assert.deepEqual(j.parameter(new URLSearchParams('von=2025-08-01&bis=2026-07-31&art=ZU_ABW,AB_ABW')), { ...WJ, arten: ['ZU_ABW', 'AB_ABW'] })
    const d = await ladeBsm(datenbank(tabellen(), { rpc: RPC }), T, WJ, { heute: HEUTE })
    const zeilen = csv.csvText(d.summen, SPALTEN_BSM).split('\r\n')
    assert.equal(zeilen[0], 'Zeitraum von;Zeitraum bis;Herkunft;Abschnitt;Kürzel;Position;Teil;Wein (l);Rebsortenwein (l);Landwein (l);Qualitätswein (l);Prädikatswein (l);Perlwein und Schaumwein (l);Sonstige Erzeugnisse (l);ohne Zuordnung (l);Summe (l);Summe (hl)'.replace(/^/, '﻿'))
    assert.equal(zeilen[1], '01.08.2025;31.07.2026;Österreich;Bestand;ANFANG;Anfangsbestand (Ende 31.07.2025, inkl. Eröffnungsbestand im Zeitraum);gesamt;0,00;0,00;0,00;500,00;0,00;0,00;0,00;0,00;500,00;5,000')
    const jz = csv.csvText(bsmJournal(d, ['VK_FA_AU']), SPALTEN_BSM_JOURNAL).split('\r\n')
    assert.equal(jz.length, 3)
    assert.match(jz[1], /^01\.05\.2026;VK_FA_AU;Fassverkauf ins Ausland;Qualitätswein;weiß;Österreich;offen \(Fass\/Tank\);;100,00;-1,000;;Tank-Verkauf;GV 25;;Weinhaus München · Deutschland;R-2;;/)
    // Leermeldung: nur Kopfzeile (ohne Daten trotzdem alle Positionen der Summentabelle – Journal leer)
    const leer = await ladeBsm(datenbank({}, { rpc: RPC }), T, WJ, { heute: HEUTE })
    assert.equal(csv.csvDatei(bsmJournal(leer), SPALTEN_BSM_JOURNAL).zeilen, 0)
  })

  test('Druckseite: Marker, Zeitraum-Felder, Schnellwahl, CSV-Knöpfe, Navigation', () => {
    const seite = quelle('src/app/(dashboard)/reports/(pflicht)/bestandsmeldung-bsm/page.tsx')
    assert.match(seite, /^\/\/ behoerdenmeldung: bsm, bsm-kontrolljournal/)
    assert.match(seite, /type="date" name="von"/)
    assert.match(seite, /type="date" name="bis"/)
    assert.match(seite, /bsmSchnellwahlen\(heute\)/)
    assert.match(seite, /ladeBsm\(supabase, tenantId, zeitraum, \{ heute \}\)/)
    assert.match(seite, /csvPfad\('bsm', zeitraumParam\)/)
    assert.match(seite, /csvPfad\('bsm-kontrolljournal', \{ \.\.\.zeitraumParam, art:/)
    const nav = quelle('src/lib/navigation/index.ts')
    assert.match(nav, /href: '\/reports\/bestandsmeldung-bsm'.*pflichtmeldung: true/)
    const bsm = quelle('src/lib/behoerden/bsm.ts')
    assert.match(bsm, /Entscheidung Jörgen 02\.10\.2026: BSM = 1\.8\.–31\.7\./)
  })
})
