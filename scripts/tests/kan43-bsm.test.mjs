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
// 6. Nachtrag (Antworten Jörgen 02.10.2026): Pressung zugekaufter Trauben anteilig als ZK_TRAUB (Beleg nur Info in kg,
//    Vorschlag 0,7 l/kg, nicht gepresste Trauben als Hinweis), Most/Sturm als eigene Gruppe mit neutraler Umstufung
//    UMST_MOST, Lieferort (Lieferland → Exportauftrag → Kundenland mit Warnung), negativer Flaschen-Altbestand = SCHWUND.

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
    assert.equal(buchungsartBewegung('behandlung'), 'ZU_BEH')   // KAN-41 Paket 3b: nur Behandlungen mit Volumenzugang haben eine Menge (Menge 0 wird übersprungen)
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
    assert.equal(buchungsartFlasche('anfangsbestand', -30), 'SCHWUND')   // Nachtrag 7: Altbestand (−) ist ein Abgang
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
    // Nachtrag 4: Most/Sturm – Erzeugnis, Stufe (STU/TGT) oder Status Ernte/Gärung der Charge
    assert.equal(sp(a('qualitaetswein', 'MOST')).spalte, 'most_sturm')
    assert.equal(sp(a(null, 'STURM')).spalte, 'most_sturm')
    assert.equal(sp(a('sturm')).spalte, 'most_sturm')
    assert.equal(sp(a('TGT')).spalte, 'most_sturm')
    assert.equal(bsmSpalte({ angabe: a('qualitaetswein'), rebsorte: 'Grüner Veltliner', jahrgang: 2026, status: 'gaerung' }).spalte, 'most_sturm')
    assert.equal(bsmSpalte({ angabe: a('qualitaetswein'), rebsorte: 'Grüner Veltliner', jahrgang: 2026, status: 'ernte' }).spalte, 'most_sturm')
    assert.equal(bsmSpalte({ angabe: a('qualitaetswein'), rebsorte: 'Grüner Veltliner', jahrgang: 2026, status: 'ausbau' }).spalte, 'qualitaetswein')
    assert.equal(bsmSpalte({ angabe: a('qualitaetswein', 'SEKTGU'), rebsorte: null, jahrgang: 2026, status: 'gaerung' }).spalte, 'perl_schaumwein')  // Erzeugnis vor Status
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
    // Nachtrag 1: Beleg nur nachrichtlich (Vorschlag 0,7 l/kg), ungepresst → Hinweis
    assert.ok(d.warnungen.some(w => /die Belege im Zeitraum \(2\.000 kg, Vorschlag ≈ 1\.400,00 l bei 0,7 l\/kg\) stehen nur nachrichtlich/.test(w)), d.warnungen.join('\n'))
    assert.ok(d.warnungen.some(w => /1 Traubenzukauf ist bis 31\.07\.2026 nicht \(vollständig\) gepresst – nur Hinweis, kein Bestand: Zukauf Trauben Grüner Veltliner 2025 \(2\.000 kg\)/.test(w)), d.warnungen.join('\n'))
    assert.match(d.buchungen[0].hinweis, /Vorschlag ≈ 1\.400,00 l \(0,7 l\/kg\), tatsächliche Menge nach Pressung · bis 31\.07\.2026 noch 2\.000 kg nicht gepresst/)
    assert.equal(d.traubenLiter, 0)
    // Nachtrag 5: kein Lieferland, kein Exportauftrag → Land des Kunden mit Warnung
    assert.ok(d.warnungen.some(w => /^3 Verkäufe: Lieferort unbekannt, Land des Kunden verwendet/.test(w)), d.warnungen.join('\n'))
    // nur eigener Betrieb
    assert.deepEqual(ohneMandant(db, T, ['pressung_behaelter', 'pressung_weingaerten', 'verschneidung_quellen']), [])
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

// ── 6. Nachtrag (Antworten Jörgen 02.10.2026) ─────────────────────────────────

const pw = (id, pressungId, datum, kg, zukauf = null, tenant = T) => ({ id, pressung_id: pressungId, trauben_kg: kg, zukauf_posten_id: zukauf, storniert_am: null, pressung: { id: pressungId, datum, tenant_id: tenant, storniert_am: null } })

function mostTabellen() {
  return {
    weinausbau: [
      // m1: Most (heute noch in Gärung), Pressung 800 l am 10.09.2025; 300 l am 01.11.2025 in die Wein-Charge m2 umgezogen
      { id: 'm1', tenant_id: T, name: 'WR Most', jahrgang: 2025, rebsorte: 'Welschriesling', qualitaetsstufe: 'qualitaetswein', weinart: 'weiss', land_iso: 'AT', menge_liter: 500, status: 'gaerung', aktiv: true, created_at: '2025-09-10T10:00:00Z', behaelter_id: 'b1', behaelter: b1 },
      { id: 'm2', tenant_id: T, name: 'WR Klassik', jahrgang: 2025, rebsorte: 'Welschriesling', qualitaetsstufe: 'qualitaetswein', weinart: 'weiss', land_iso: 'AT', menge_liter: 300, status: 'ausbau', aktiv: true, created_at: '2025-11-01T10:00:00Z', behaelter_id: 'b2', behaelter: b2 },
      // s1: Sturm (Erzeugnis STURM), Pressung 100 l, Charge im Ausbau-Status – das Erzeugnis entscheidet
      { id: 's1', tenant_id: T, name: 'Sturm rot', jahrgang: 2025, rebsorte: 'Zweigelt', qualitaetsstufe: null, erzeugnis: 'STURM', weinart: 'rose', land_iso: 'AT', menge_liter: 100, status: 'ausbau', aktiv: true, created_at: '2025-09-12T10:00:00Z', behaelter_id: 'b3', behaelter: b3 },
    ],
    pressung_behaelter: [
      { id: 'pbm', menge_liter: 800, weinausbau_id: 'm1', behaelter_id: 'b1', notizen: null, storniert_am: null, pressung: pressung('pm', '2025-09-10') },
      { id: 'pbs', menge_liter: 100, weinausbau_id: 's1', behaelter_id: 'b3', notizen: null, storniert_am: null, pressung: pressung('ps', '2025-09-12') },
    ],
    keller_umzuege: [
      { id: 'um1', tenant_id: T, datum: '2025-11-01', menge_liter: 300, brutto_liter: 300, schwund_liter: 0, umzug_typ: 'normal', zeilen_typ: 'quelle', umzug_batch_id: 'bm', von_behaelter_id: 'b1', von_weinausbau_id: 'm1', storniert_am: null, von_behaelter: b1, von_weinausbau: { name: 'WR Most', behaelter: b1 } },
      { id: 'um2', tenant_id: T, datum: '2025-11-01', menge_liter: 300, brutto_liter: null, schwund_liter: 0, umzug_typ: 'normal', zeilen_typ: 'ziel', umzug_batch_id: 'bm', nach_behaelter_id: 'b2', nach_weinausbau_id: 'm2', storniert_am: null, nach_behaelter: b2, nach_weinausbau: { name: 'WR Klassik' } },
    ],
    fuellungen: [], fuellung_bewegungen: [], verkauf_positionen: [], verkaufsposten: [], zukauf_posten: [],
    verschneidung_quellen: [], verschneidungen: [],
  }
}

describe('KAN-43 BSM: Nachtrag 02.10.2026', nurMitHooks, () => {
  test('1. Pressung mit zugekauften Trauben: Most anteilig nach kg auf ERNTE und ZK_TRAUB, Beleg nur Info', async () => {
    const { ladeBsm, bsmJournal, TRAUBEN_LITER_JE_KG_VORSCHLAG } = await laden('lib/behoerden/bsm.ts')
    assert.equal(TRAUBEN_LITER_JE_KG_VORSCHLAG, 0.7)
    const t = tabellen()
    // Pressung p1 (1000 l): 1200 kg eigene + 800 kg aus dem Zukauf z1 (2000 kg) → 40 % = 400 l Zukauf Trauben
    t.pressung_weingaerten = [pw('pw1', 'p1', '2025-09-20', 1200), pw('pw2', 'p1', '2025-09-20', 800, 'z1'), pw('pw9', 'p9', '2025-09-01', 999, 'z9', FREMD)]
    const db = datenbank(t, { rpc: RPC })
    const d = await ladeBsm(db, T, WJ, { heute: HEUTE })
    const kurz = d.buchungen.filter(b => b.datum <= '2025-09-20').map(b => [b.datum, b.code, b.spalte, b.liter, b.kg])
    assert.deepEqual(kurz, [
      ['2025-09-15', 'ZK_TRAUB', 'qualitaetswein', 0, 2000],   // Beleg: nur Info in kg
      ['2025-09-20', 'ERNTE', 'qualitaetswein', 600, null],
      ['2025-09-20', 'ZK_TRAUB', 'qualitaetswein', 400, null],
    ])
    assert.match(d.buchungen[1].hinweis, /800 von 2\.000 kg \(40,0 %\)/)
    assert.match(d.buchungen[0].hinweis, /bis 31\.07\.2026 noch 1\.200 kg nicht gepresst/)
    assert.equal(d.traubenLiter, 400)
    const S = d.summen
    assert.equal(zelle(S, 'ERNTE').werte.qualitaetswein, 600)
    assert.equal(zelle(S, 'ZK_TRAUB').werte.qualitaetswein, 400)
    assert.match(zelle(S, 'ZK_TRAUB').bezeichnung, /Most aus der Pressung in l \(Beleg 2\.000 kg, nur nachrichtlich\)/)
    assert.deepEqual(zelle(S, 'ENDE').werte, zelle(S, 'STICHTAG').werte)          // nichts doppelt
    assert.equal(zelle(S, 'DIFFERENZ').summeLiter, 0)
    assert.ok(d.warnungen.some(w => /mit 400,00 l; die Belege im Zeitraum \(2\.000 kg/.test(w)), d.warnungen.join('\n'))
    assert.ok(d.warnungen.some(w => /Zukauf Trauben Grüner Veltliner 2025 \(1\.200 kg\)/.test(w)), d.warnungen.join('\n'))
    assert.equal(bsmJournal(d, ['ZK_TRAUB']).length, 2)
    assert.deepEqual(ohneMandant(db, T, ['pressung_behaelter', 'pressung_weingaerten', 'verschneidung_quellen']), [])
    // ganz gepresst → kein Hinweis; nur Zukauf-Trauben in der Pressung → alles ZK_TRAUB
    t.pressung_weingaerten = [pw('pw2', 'p1', '2025-09-20', 2000, 'z1')]
    const d2 = await ladeBsm(datenbank(t, { rpc: RPC }), T, WJ, { heute: HEUTE })
    assert.deepEqual(d2.buchungen.filter(b => b.datum === '2025-09-20').map(b => [b.code, b.liter]), [['ZK_TRAUB', 1000]])
    assert.ok(!d2.warnungen.some(w => /nicht \(vollständig\) gepresst/.test(w)), d2.warnungen.join('\n'))
    assert.equal(zelle(d2.summen, 'DIFFERENZ').summeLiter, 0)
  })

  test('1b. KAN-41: Pressung mit zugekaufter Maische → Anteil auf ZK_MAISC, Beleg nur Info in kg', async () => {
    const { ladeBsm, bsmJournal, BSM_ZUORDNUNG } = await laden('lib/behoerden/bsm.ts')
    assert.ok(BSM_ZUORDNUNG.some(z => z.code === 'ZK_MAISC'))
    const t = tabellen()
    t.zukauf_posten = [...t.zukauf_posten, { id: 'zm', tenant_id: T, datum: '2025-09-16', art: 'maische', einheit: 'kg', menge: 300, ziel_weinausbau_id: null, aktiv: true, rebsorte: 'Grüner Veltliner', jahrgang: 2025, weinart: 'weiss', qualitaetsstufe: 'qualitaetswein', land_iso: 'AT' }]
    // Pressung p1 (1000 l): 1200 kg eigene + 500 kg Trauben z1 + 300 kg Maische zm → 40 % Zukauf = 400 l, davon 3/8 Maische
    t.pressung_weingaerten = [pw('pw1', 'p1', '2025-09-20', 1200), pw('pw2', 'p1', '2025-09-20', 500, 'z1'), pw('pw3', 'p1', '2025-09-20', 300, 'zm')]
    const d = await ladeBsm(datenbank(t, { rpc: RPC }), T, WJ, { heute: HEUTE })
    assert.deepEqual(d.buchungen.filter(b => b.datum <= '2025-09-20').map(b => [b.datum, b.code, b.liter, b.kg]), [
      ['2025-09-15', 'ZK_TRAUB', 0, 2000],
      ['2025-09-16', 'ZK_MAISC', 0, 300],      // Beleg Maische: nur Info in kg
      ['2025-09-20', 'ERNTE', 600, null],
      ['2025-09-20', 'ZK_TRAUB', 250, null],
      ['2025-09-20', 'ZK_MAISC', 150, null],
    ])
    assert.match(d.buchungen[1].vorgang, /^Zukauf Maische Grüner Veltliner 2025$/)
    assert.match(d.buchungen[2].hinweis, /zugekauften Trauben und Maische: 800 von 2\.000 kg/)
    assert.deepEqual([d.traubenKg, d.traubenLiter, d.maischeKg, d.maischeLiter], [2000, 250, 300, 150])
    const S = d.summen
    assert.equal(zelle(S, 'ZK_MAISC').werte.qualitaetswein, 150)
    assert.match(zelle(S, 'ZK_MAISC').bezeichnung, /Most aus der Pressung in l \(Beleg 300 kg, nur nachrichtlich\)/)
    assert.deepEqual(zelle(S, 'ENDE').werte, zelle(S, 'STICHTAG').werte)
    assert.equal(zelle(S, 'DIFFERENZ').summeLiter, 0)
    assert.ok(d.warnungen.some(w => /Zukauf Maische: gezählt ist der Most .* mit 150,00 l; die Belege im Zeitraum \(300 kg\)/.test(w)), d.warnungen.join('\n'))
    assert.equal(bsmJournal(d, ['ZK_MAISC']).length, 2)
    // nur Maische in der Pressung → alles ZK_MAISC
    t.pressung_weingaerten = [pw('pw3', 'p1', '2025-09-20', 300, 'zm')]
    const d2 = await ladeBsm(datenbank(t, { rpc: RPC }), T, WJ, { heute: HEUTE })
    assert.deepEqual(d2.buchungen.filter(b => b.datum === '2025-09-20').map(b => [b.code, b.liter]), [['ZK_MAISC', 1000]])
    assert.equal(zelle(d2.summen, 'DIFFERENZ').summeLiter, 0)
  })

  test('1c. KAN-41 Paket 2b: Flaschenzukauf (Handelsware) → ZK_FLA ohne Prüfwarnung; Füllung ohne Charge und Zukauf warnt weiter', async () => {
    const { ladeBsm, BSM_ZUORDNUNG, HANDELSWARE_HINWEIS } = await laden('lib/behoerden/bsm.ts')
    assert.ok(BSM_ZUORDNUNG.some(z => z.code === 'ZK_FLA' && /Handelsware/.test(z.vorgang)))
    const handel = { id: 'fz', tenant_id: T, datum: '2026-04-01', name: 'Handel GV', jahrgang: 2025, rebsorte: 'Grüner Veltliner', qualitaet: 'qualitaetswein', land_iso: 'AT', weinart: 'weiss', aktiv: true, bestand_flaschen: 120, anzahl_flaschen: 120, menge_liter_gefuellt: null, flaschengroesse_ml: 750, weinausbau_id: null, zukauf_posten_id: 'zf', storniert_am: null }
    const t = tabellen()
    t.fuellungen = [...t.fuellungen, handel]
    const d = await ladeBsm(datenbank(t, { rpc: RPC }), T, WJ, { heute: HEUTE })
    const zk = d.buchungen.filter(b => b.code === 'ZK_FLA')
    assert.deepEqual(zk.map(b => [b.datum, b.liter, b.fuellung]), [['2026-04-01', 90, 'Handel GV']])
    assert.ok(zk[0].hinweis.includes(HANDELSWARE_HINWEIS), zk[0].hinweis)
    assert.ok(!d.warnungen.some(w => /als „Zukauf Flaschen“ gezählt – bitte prüfen/.test(w)), d.warnungen.join('\n'))
    assert.deepEqual(zelle(d.summen, 'ENDE').werte, zelle(d.summen, 'STICHTAG').werte)
    assert.equal(zelle(d.summen, 'DIFFERENZ').summeLiter, 0)
    // Altfall (E5): Füllung ohne Charge und ohne Zukauf bleibt Rückfall ZK_FLA mit Prüfwarnung
    t.fuellungen = [...t.fuellungen.filter(f => f.id !== 'fz'), { ...handel, id: 'fa', name: 'Ohne Bezug', zukauf_posten_id: null }]
    const d2 = await ladeBsm(datenbank(t, { rpc: RPC }), T, WJ, { heute: HEUTE })
    assert.match(d2.buchungen.find(b => b.code === 'ZK_FLA').hinweis, /als Flaschenzukauf gezählt, prüfen/)
    assert.ok(d2.warnungen.some(w => /1 Flaschenzugang ohne Charge .* bitte prüfen/.test(w)), d2.warnungen.join('\n'))
  })

  test('1d. KAN-41 Paket 3a: Verarbeitung → AB_VERAR (Abgang), stornierte Verarbeitung mit Gegenbuchung', async () => {
    const { ladeBsm, BSM_ZUORDNUNG } = await laden('lib/behoerden/bsm.ts')
    assert.ok(BSM_ZUORDNUNG.some(z => z.code === 'AB_VERAR'))
    const t = tabellen()
    // 60 l GV zu Traubensaft am 01.04.2026 → heute 386 l; dazu eine am 02.04. gebuchte und am 03.04. stornierte Verarbeitung
    t.weinausbau = t.weinausbau.map(w => w.id === 'w1' ? { ...w, menge_liter: 386 } : w)
    t.keller_verarbeitungen = [
      { id: 'kv1', tenant_id: T, weinausbau_id: 'w1', datum: '2026-04-01', menge_liter: 60, zweck: 'traubensaft', notizen: null, storniert_am: null },
      { id: 'kv2', tenant_id: T, weinausbau_id: 'w1', datum: '2026-04-02', menge_liter: 10, zweck: 'essig', notizen: null, storniert_am: '2026-04-03T08:00:00Z', storno_grund: 'S112TEST falsch' },
      { id: 'kv9', tenant_id: FREMD, weinausbau_id: 'w9', datum: '2026-04-01', menge_liter: 5, zweck: 'essig', notizen: null, storniert_am: null },
    ]
    const d = await ladeBsm(datenbank(t, { rpc: RPC }), T, WJ, { heute: HEUTE })
    const v = d.buchungen.filter(b => b.code === 'AB_VERAR')
    assert.deepEqual(v.map(b => [b.datum, b.liter]), [['2026-04-01', -60], ['2026-04-02', -10], ['2026-04-03', 10]])
    assert.match(v[0].vorgang, /Verarbeitung zu Traubensaft/)
    assert.equal(zelle(d.summen, 'AB_VERAR').summeLiter, 60)   // Abgänge stehen in der Summentabelle positiv
    assert.deepEqual(zelle(d.summen, 'ENDE').werte, zelle(d.summen, 'STICHTAG').werte)
    assert.equal(zelle(d.summen, 'DIFFERENZ').summeLiter, 0)
  })

  test('1e. KAN-41 Paket 3b: Behandlung mit Volumenzugang → ZU_BEH, ohne Zugang keine Buchung', async () => {
    const { ladeBsm, BSM_ZUORDNUNG } = await laden('lib/behoerden/bsm.ts')
    assert.ok(BSM_ZUORDNUNG.some(z => z.code === 'ZU_BEH'))
    const t = tabellen()
    // Süßreserve 20 l am 05.04.2026 → heute 466 l (die Ladefunktion holt nur Behandlungen mit Zugang)
    t.weinausbau = t.weinausbau.map(w => w.id === 'w1' ? { ...w, menge_liter: 466 } : w)
    t.keller_behandlungen = [
      { id: 'kb1', tenant_id: T, weinausbau_id: 'w1', datum: '2026-04-05', menge: 20, einheit: 'l', typ_name_snapshot: 'Süßreserve', zugang_liter: 20, storniert_am: null },
      { id: 'kb9', tenant_id: FREMD, weinausbau_id: 'w9', datum: '2026-04-05', menge: 5, einheit: 'l', typ_name_snapshot: 'Süßreserve', zugang_liter: 5, storniert_am: null },
    ]
    const d = await ladeBsm(datenbank(t, { rpc: RPC }), T, WJ, { heute: HEUTE })
    assert.deepEqual(d.buchungen.filter(b => b.code === 'ZU_BEH').map(b => [b.datum, b.liter]), [['2026-04-05', 20]])
    assert.equal(zelle(d.summen, 'ZU_BEH').summeLiter, 20)
    assert.deepEqual(zelle(d.summen, 'ENDE').werte, zelle(d.summen, 'STICHTAG').werte)
    assert.equal(zelle(d.summen, 'DIFFERENZ').summeLiter, 0)
  })

  test('1f. KAN-41 Paket 3c: Traubenverkauf nur nachrichtlich in kg (TRAUBVK), ohne Liter und ohne stornierte', async () => {
    const { ladeBsm, BSM_ZUORDNUNG } = await laden('lib/behoerden/bsm.ts')
    assert.ok(BSM_ZUORDNUNG.some(z => z.code === 'TRAUBVK (Info)'))
    const t = tabellen()
    t.traubenverkauf = [
      { id: 'tv1', tenant_id: T, datum: '2025-09-25', menge_kg: 1500, qualitaetsstufe: 'qualitaetswein', liefernummer: 'L-1', storniert_am: null,
        weingarten: { rebsorte: 'Grüner Veltliner' }, jahrgang: { jahrgang: 2025 }, firma: { name: 'Weingut Nachbar' }, verkaufsposten: null },
      { id: 'tv2', tenant_id: T, datum: '2025-09-26', menge_kg: 999, qualitaetsstufe: 'qualitaetswein', storniert_am: '2025-09-27T08:00:00Z',
        weingarten: { rebsorte: 'Grüner Veltliner' }, jahrgang: { jahrgang: 2025 } },
      { id: 'tv9', tenant_id: FREMD, datum: '2025-09-25', menge_kg: 500, qualitaetsstufe: 'qualitaetswein', storniert_am: null },
    ]
    const d = await ladeBsm(datenbank(t, { rpc: RPC }), T, WJ, { heute: HEUTE })
    const tv = d.buchungen.filter(b => b.code === 'TRAUBVK')
    assert.deepEqual(tv.map(b => [b.datum, b.liter, b.kg, b.gegenstelle, b.beleg]), [['2025-09-25', 0, 1500, 'Weingut Nachbar', 'L-1']])
    assert.ok(d.warnungen.some(w => /Traubenverkauf im Zeitraum: 1\.500 kg – nur nachrichtlich/.test(w)), d.warnungen.join('\n'))
    assert.equal(zelle(d.summen, 'DIFFERENZ').summeLiter, 0)
  })

  test('1g. KAN-118/119: Produktion → Abgang AB_VERAR in der Weinspalte, Zugang ZU_PROD in „Perlwein und Schaumwein“ bzw. „Sonstige“', async () => {
    const { ladeBsm, bsmJournal } = await laden('lib/behoerden/bsm.ts')
    const t = tabellen()
    // Spritzer: 200 l GV (Qualitätswein) + 100 l Wasser → 300 l weinhaltiges Getränk (05.04.2026), GV heute 246 l
    // Perlwein: 100 l ZW Kabinett → 100 l Perlwein (06.04.2026), ZW Kabinett heute 100 l
    t.weinausbau = [
      ...t.weinausbau.map(w => w.id === 'w1' ? { ...w, menge_liter: 246 } : w.id === 'w2' ? { ...w, menge_liter: 100 } : w),
      { id: 'w4', tenant_id: T, name: 'Spritzer 26', jahrgang: 2025, rebsorte: 'Grüner Veltliner', qualitaetsstufe: null, erzeugnis: 'WEINHALT', weinart: 'weiss', land_iso: 'AT', menge_liter: 300, status: 'ausbau', aktiv: true, created_at: '2026-04-05T08:00:00Z', behaelter_id: 'b4', behaelter: { name: 'T4' } },
      { id: 'w5', tenant_id: T, name: 'ZW Perlwein', jahrgang: 2024, rebsorte: 'Zweigelt', qualitaetsstufe: 'kabinett', erzeugnis: 'PERLWEIN', weinart: 'rot', land_iso: 'AT', menge_liter: 100, status: 'ausbau', aktiv: true, created_at: '2026-04-06T08:00:00Z', behaelter_id: 'b5', behaelter: { name: 'T5' } },
    ]
    const prod = (id, datum, art, erzeugnis, ziel, zielName, wein, ziel_menge, eingaenge) => ({
      id, tenant_id: T, datum, art, erzeugnis, ziel_menge, wein_liter: wein, notizen: null, ziel_weinausbau_id: ziel, storniert_am: null, eingaenge,
      _ziel: { name: zielName },
    })
    const p1 = prod('pr1', '2026-04-05', 'spritzer', 'WEINHALT', 'w4', 'Spritzer 26', 200, 300, [
      { art: 'wein', menge: 200, einheit: 'l', bezeichnung: null, weinausbau_id: 'w1', quelle: { name: 'GV 25' } },
      { art: 'wasser', menge: 100, einheit: 'l', bezeichnung: null, weinausbau_id: null, quelle: null },
    ])
    const p2 = prod('pr2', '2026-04-06', 'perlwein', 'PERLWEIN', 'w5', 'ZW Perlwein', 100, 100, [
      { art: 'wein', menge: 100, einheit: 'l', bezeichnung: null, weinausbau_id: 'w2', quelle: { name: 'ZW Kabinett' } },
    ])
    const kopf = p => ({ id: p.id, datum: p.datum, art: p.art, erzeugnis: p.erzeugnis, notizen: null, storniert_am: null, ziel: p._ziel })
    t.produktionen = [p1, p2].map(({ _ziel, ...p }) => p)
    t.produktion_eingaenge = [
      { id: 'pe1', tenant_id: T, art: 'wein', menge: 200, weinausbau_id: 'w1', produktion: kopf(p1) },
      { id: 'pe2', tenant_id: T, art: 'wein', menge: 100, weinausbau_id: 'w2', produktion: kopf(p2) },
    ]
    const d = await ladeBsm(datenbank(t, { rpc: RPC }), T, WJ, { heute: HEUTE })
    const S = d.summen
    // Abgang in der Spalte der Quelle (Wein), Zugang in der Spalte des neuen Erzeugnisses
    assert.equal(zelle(S, 'AB_VERAR').werte.qualitaetswein, 300)   // 200 l GV + 100 l ZW Kabinett (Kabinett = Qualitätswein)
    assert.equal(zelle(S, 'ZU_PROD').werte.sonstige, 300)          // Spritzer = weinhaltiges Getränk inkl. 100 l Wasser
    assert.equal(zelle(S, 'ZU_PROD').werte.perl_schaumwein, 100)
    assert.equal(zelle(S, 'ZU_PROD').werte.qualitaetswein ?? 0, 0)
    assert.deepEqual(zelle(S, 'ENDE').werte, zelle(S, 'STICHTAG').werte)
    assert.equal(zelle(S, 'DIFFERENZ').summeLiter, 0)
    assert.equal(bsmJournal(d, ['ZU_PROD']).length, 2)
  })

  test('4. Most/Sturm: eigene Gruppe, Übergang Most → Wein als neutrale Umstufung (keine Abwertung)', async () => {
    const { ladeBsm, bsmJournal, bsmParameter, BSM_SPALTEN, buchungsartLabel } = await laden('lib/behoerden/bsm.ts')
    assert.deepEqual(BSM_SPALTEN.map(s => s.key).slice(0, 2), ['most_sturm', 'wein'])
    const d = await ladeBsm(datenbank(mostTabellen(), { rpc: RPC }), T, WJ, { heute: HEUTE })
    assert.deepEqual(d.buchungen.map(b => [b.datum, b.code, b.spalte, b.farbe, b.liter]), [
      ['2025-09-10', 'ERNTE', 'most_sturm', 'W', 800],
      ['2025-09-12', 'ERNTE', 'most_sturm', 'R', 100],          // Sturm aus Rosé: Erzeugnis STURM, Rosé = rot
      ['2025-11-01', 'UMST_MOST', 'most_sturm', 'W', -300],
      ['2025-11-01', 'UMST_MOST', 'qualitaetswein', 'W', 300],
    ])
    const S = d.summen
    const u = zelle(S, 'UMST_MOST')
    assert.deepEqual([u.abschnitt, u.werte.most_sturm, u.werte.qualitaetswein, u.summeLiter], ['Umstufung', -300, 300, 0])
    assert.equal(zelle(S, 'ENDE').werte.most_sturm, 600)
    assert.deepEqual(zelle(S, 'ENDE').werte, zelle(S, 'STICHTAG').werte)
    assert.equal(zelle(S, 'DIFFERENZ').summeLiter, 0)
    assert.ok(!S.some(z => z.position === 'AB_ABW' && z.summeLiter !== 0))
    assert.ok(!d.warnungen.some(w => /Aufwertung|Saldo 0|nicht gleich|Abgleich/.test(w)), d.warnungen.join('\n'))
    assert.equal(bsmJournal(d, ['UMST_MOST']).length, 2)
    assert.equal(buchungsartLabel('UMST_MOST'), 'Umstufung Most/Sturm → Wein (neutral, keine Abwertung)')
    assert.deepEqual(bsmParameter(new URLSearchParams('art=umst_most'), HEUTE), { ...WJ, arten: ['UMST_MOST'] })
  })

  test('5. Lieferort: Lieferland → Exportauftrag → Land des Kunden (Warnung); Spalte lieferland darf fehlen', async () => {
    const { ladeBsm, fehlendeSpalte } = await laden('lib/behoerden/bsm.ts')
    const t = tabellen()
    const vp = id => t.verkaufsposten.find(v => v.id === id)
    vp('vp2').lieferland = 'AT'                      // Kunde in Deutschland, geliefert nach Österreich → Inland
    vp('vp1').kontakt_id = 'k1'                      // Kunde in Österreich, Exportauftrag in die Schweiz am selben Tag
    vp('vp3').firma_id = 'fi3'
    t.exportauftraege = [
      { id: 'e1', tenant_id: T, referenz: 'EX-1', datum: '2026-05-20', lieferdatum: '2026-06-01', destination_land: 'CH', kontakt_id: 'k1', firma_id: null, aktiv: true, storniert_am: null },
      { id: 'e2', tenant_id: T, referenz: 'EX-2', datum: '2026-01-10', lieferdatum: null, destination_land: 'DE', kontakt_id: null, firma_id: 'fi3', aktiv: true, storniert_am: '2026-01-11T08:00:00Z' },  // storniert → zählt nicht
      { id: 'e9', tenant_id: FREMD, referenz: 'X', datum: '2026-06-01', destination_land: 'US', kontakt_id: 'k1', aktiv: true, storniert_am: null },
    ]
    const d = await ladeBsm(datenbank(t, { rpc: RPC }), T, WJ, { heute: HEUTE })
    const codes = d.buchungen.filter(b => /^VK_/.test(b.code)).map(b => [b.datum, b.code, b.gegenstelle])
    assert.deepEqual(codes, [
      ['2026-01-10', 'VK_FA_AT', 'Österreich (Land des Kunden)'],
      ['2026-02-10', 'VK_FA_AT', 'Österreich (Land des Kunden)'],
      ['2026-05-01', 'VK_FA_AT', 'Weinhaus München · Österreich'],
      ['2026-06-01', 'VK_FL_AU', 'Anna Huber · Schweiz (Bestimmungsland lt. Exportauftrag EX-1)'],
    ])
    assert.ok(d.warnungen.some(w => /^1 Verkauf: Lieferort unbekannt, Land des Kunden verwendet – /.test(w)), d.warnungen.join('\n'))
    assert.equal(zelle(d.summen, 'DIFFERENZ').summeLiter, 0)
    // ohne Spalte lieferland (Migration offen): zweiter Versuch ohne die Spalte, Fallback mit Hinweis
    assert.equal(fehlendeSpalte({ code: '42703', message: 'column verkaufsposten.lieferland does not exist' }, 'lieferland'), true)
    assert.equal(fehlendeSpalte({ code: '42501', message: 'permission denied' }, 'lieferland'), false)
    const ohne = datenbank(tabellen(), {
      rpc: RPC,
      vorher: e => (e.tabelle === 'verkaufsposten' && /lieferland/.test(e.spalten ?? '') ? { error: { code: '42703', message: 'column verkaufsposten.lieferland does not exist' } } : null),
    })
    const d2 = await ladeBsm(ohne, T, WJ, { heute: HEUTE })
    assert.ok(d2.warnungen.some(w => /^3 Verkäufe: Lieferort unbekannt, Land des Kunden verwendet \(Lieferland am Verkauf wird noch nicht erfasst\)/.test(w)), d2.warnungen.join('\n'))
    assert.equal(d2.buchungen.filter(b => b.code === 'VK_FA_AU').length, 1)
  })

  test('7. Negativer Flaschen-Altbestand ist ein Abgang (SCHWUND), keine Eröffnung', async () => {
    const { ladeBsm } = await laden('lib/behoerden/bsm.ts')
    const t = tabellen()
    // 30 Fl. à 1 l Altbestand-Korrektur (−) am 20.07.2026 → heute 260 Fl.
    t.fuellung_bewegungen.push({ id: 'fb2', tenant_id: T, fuellung_id: 'f1', datum: '2026-07-20', art: 'anfangsbestand', menge_stk: -30, verkaufsposten_id: null })
    t.fuellungen[0].bestand_flaschen = 260
    const d = await ladeBsm(datenbank(t, { rpc: RPC }), T, WJ, { heute: HEUTE })
    const b = d.buchungen.find(x => x.datum === '2026-07-20')
    assert.deepEqual([b.code, b.liter, b.gebinde], ['SCHWUND', -30, 'flasche'])
    assert.match(b.hinweis, /Altbestand-Korrektur \(−\): Abgang, als Eigenverbrauch\/Schwund gezählt/)
    assert.equal(zelle(d.summen, 'ANFANG').werte.qualitaetswein, 500)        // Anfangsbestand unverändert
    assert.equal(zelle(d.summen, 'SCHWUND').werte.qualitaetswein, 49)        // 19 + 30
    assert.equal(zelle(d.summen, 'DIFFERENZ').summeLiter, 0)
    assert.ok(d.warnungen.some(w => /^1 Flaschenbuchung „Anfangsbestand \(Altbestand, ±\)“ mit negativer Menge \(zusammen 30,00 l\) ist als Abgang Eigenverbrauch\/Schwund gezählt/.test(w)), d.warnungen.join('\n'))
    assert.ok(!d.warnungen.some(w => /Eröffnungsbuchung/.test(w)))
  })

  test('2./3. Kabinett bleibt Qualitätswein, Rosé zählt zu rot (bestätigt, im Code dokumentiert)', async () => {
    const bsm = quelle('src/lib/behoerden/bsm.ts')
    assert.match(bsm, /Kabinett bleibt vorläufig in der Spalte Qualitätswein \(bestätigt Jörgen 02\.10\.2026, bis BKI-Antwort KAN-38 Frage 12\)/)
    assert.match(bsm, /Rosé zählt zu rot – auch in den BSM-Spalten \(bestätigt Jörgen 02\.10\.2026/)
    const { bsmSpalte, bsmFarbe } = await laden('lib/behoerden/bsm.ts')
    assert.equal(bsmSpalte({ angabe: { stufe: 'kabinett', zusatz: null, erzeugnis: null }, rebsorte: 'Zweigelt', jahrgang: 2025 }).spalte, 'qualitaetswein')
    assert.equal(bsmFarbe({ weinart: 'rose', rebsorte: 'Grüner Veltliner' }), 'R')
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
    assert.equal(zeilen[0], 'Zeitraum von;Zeitraum bis;Herkunft;Abschnitt;Kürzel;Position;Teil;Most/Sturm (l);Wein (l);Rebsortenwein (l);Landwein (l);Qualitätswein (l);Prädikatswein (l);Perlwein und Schaumwein (l);Sonstige Erzeugnisse (l);ohne Zuordnung (l);Summe (l);Summe (hl)'.replace(/^/, '﻿'))
    assert.equal(zeilen[1], '01.08.2025;31.07.2026;Österreich;Bestand;ANFANG;Anfangsbestand (Ende 31.07.2025, inkl. Eröffnungsbestand im Zeitraum);gesamt;0,00;0,00;0,00;0,00;500,00;0,00;0,00;0,00;0,00;500,00;5,000')
    const jz = csv.csvText(bsmJournal(d, ['VK_FA_AU']), SPALTEN_BSM_JOURNAL).split('\r\n')
    assert.equal(jz.length, 3)
    assert.match(jz[1], /^01\.05\.2026;VK_FA_AU;Fassverkauf ins Ausland;Qualitätswein;weiß;Österreich;offen \(Fass\/Tank\);;100,00;-1,000;;Tank-Verkauf;GV 25;;Weinhaus München · Deutschland \(Land des Kunden\);R-2;;/)
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
