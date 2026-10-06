// KAN-44 Teil 1 (06.10.2026) – BKI-Blätter „Lagerstand zum Datum“ und „Lagerbewegungen“ aus dem Bewegungsjournal
//
// Aufruf:  npm run -s test:csv   (alle scripts/tests/*.test.mjs)
//
// 1. berechneLagerstand: Summe je Posten bis zum Stichtag, Merkmale der letzten Zeile (Umstufung wirkt), Storno-Paar
//    hebt sich auf, Flaschen etikettiert/unetikettiert, leere und negative Posten fallen weg.
// 2. berechneLagerbewegungen: Anfangsmenge chronologisch (auch bei nachträglich erfasstem Beleg), BSM-Buchungsart,
//    Käufer/Verkäufer, Storno-Hinweis.
// 3. Spaltenzahl wie die BKI-Blätter (A–AI = 35, A–AW = 49), Verdrahtung Katalog/Register/Seite.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { hooksRegistrieren, laden, nurMitHooks, datenbank } from './buchung-attrappe.mjs'

hooksRegistrieren()

const quelle = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')

let n = 0
const zeile = (beleg, datum, code, liter, x = {}) => ({
  id: `j${++n}`, beleg_nr: beleg, pos: 1, datum, buchungsart_code: code, bestand: 'offen',
  weinausbau_id: 'A', fuellung_id: null, behaelter_id: 'T1', menge_liter: liter, menge_stk: 0,
  partner_name: null, partner_land: null, quelle_tabelle: 'keller_umzuege', storno_von_id: null,
  charge_name: 'GV A', fuellung_name: null, flaschengroesse_ml: null, erzeugnis: null, qualitaetsstufe: 'qualitaetswein',
  zusatzbezeichnung: null, weinart: 'weiss', herkunft_code: 'kremstal_ortswein', land_iso: 'AT', rebsorte: 'Grüner Veltliner',
  jahrgang: 2025, hinweis: null, ...x,
})
const flasche = (beleg, datum, code, stk, x = {}) => zeile(beleg, datum, code, stk * 0.75, {
  bestand: 'flasche', weinausbau_id: null, fuellung_id: 'F', behaelter_id: null, menge_stk: stk,
  fuellung_name: 'GV Ried 2025', flaschengroesse_ml: 750, ...x,
})

const stamm = () => ({
  chargen: new Map([['A', { id: 'A', kmw: 19.48, chargennummer: 'L25-01' }]]),
  fuellungen: new Map([['F', { id: 'F', weinausbau_id: 'A', pruefnummer: 'N 1234/26', chargennummer: 'L25-F1', flaschengroesse_ml: 750, anzahl_unetikettiert: 40 }]]),
  behaelter: new Map([['T1', { name: 'Tank 1', volumen_liter: 3000 }]]),
  etikettierungen: [
    { fuellung_id: 'F', datum: '2026-03-10', menge_stk: 10, storniert_am: null },
    { fuellung_id: 'F', datum: '2026-05-01', menge_stk: 20, storniert_am: null },   // nach dem Stichtag
  ],
})

function journal() {
  n = 0
  return [
    zeile(1, '2025-10-01', 'ERNTE', 2000, { quelle_tabelle: 'pressung_behaelter' }),
    zeile(2, '2026-02-01', 'FUELLUNG', -75),
    flasche(2, '2026-02-01', 'FUELLUNG', 100),
    flasche(3, '2026-03-01', 'VK_FL_AU', -20, { partner_name: 'Weinhaus Berlin', partner_land: 'DE', quelle_tabelle: 'verkauf_positionen' }),
    zeile(4, '2026-03-05', 'SCHWUND', -5),
    { ...zeile(5, '2026-03-06', 'SCHWUND', 5), storno_von_id: 'j5' },   // Storno des Schwunds (Gegenbuchung)
    // Umstufungspaar: Qualitätswein → Landwein
    zeile(6, '2026-03-20', 'AB_ABW', -1920),
    zeile(6, '2026-03-20', 'ZU_ABW', 1920, { qualitaetsstufe: 'landwein', herkunft_code: 'weinland' }),
    // nachträglich erfasster Zukauf (Beleg 9, Datum vor Beleg 4)
    zeile(9, '2026-03-02', 'ZK_FASS', 100, { partner_name: 'Weingut Muster', partner_land: 'AT', quelle_tabelle: 'zukauf_posten' }),
    zeile(10, '2026-04-10', 'VK_FA_AT', -100, { partner_name: 'Kunde AT', partner_land: 'AT' }),
  ]
}

describe('KAN-44: Lagerstand zum Datum', nurMitHooks, () => {
  test('Bestand je Posten, Merkmale der letzten Zeile, Etikett-Aufteilung', async () => {
    const { berechneLagerstand } = await laden('lib/behoerden/lagerstand.ts')
    const { zeilen, warnungen } = berechneLagerstand(journal(), stamm(), '2026-03-31')
    assert.deepEqual(warnungen, [])
    const offen = zeilen.filter(z => z.gebindeArt === 'offen')
    assert.equal(offen.length, 1)
    // 2000 − 75 + 100 − 5 + 5 (Storno) − 1920 + 1920 = 2025
    assert.equal(offen[0].liter, 2025)
    assert.equal(offen[0].qualitaet, 'LDW')            // nach der Umstufung
    assert.equal(offen[0].erzeugnis, 'WEINGGA')
    assert.equal(offen[0].herkunft, 'WLXX')
    assert.equal(offen[0].herkunftGga, 'Weinland')
    assert.equal(offen[0].gebinde, 'Tank 1')
    assert.equal(offen[0].nennvolumen, 3000)
    assert.equal(offen[0].kmw, 19.4)                  // abgerundet, nicht 19,5
    assert.equal(offen[0].sorte, 'GV')
    assert.equal(offen[0].farbe, 'W')
    // 80 Flaschen; 40 unetikettiert − 10 etikettiert bis zum Stichtag = 30 ohne Etikett
    const fl = zeilen.filter(z => z.gebindeArt === 'Flasche')
    assert.deepEqual(fl.map(z => [z.etikett, z.stk, z.liter]), [['etikettiert', 50, 37.5], ['unetikettiert', 30, 22.5]])
    assert.equal(fl[0].pruefnummer, 'N 1234/26')
    assert.equal(fl[0].nennvolumen, 0.75)
    assert.equal(fl[0].qualitaet, 'QUW')
    assert.equal(fl[0].herkunftStufe, 'Ortswein')
    assert.equal(fl[0].herkunftGu, 'Kremstal')
  })
  test('Stichtag vor allen Buchungen: leer; verkaufter Posten fällt weg; negativ → Hinweis', async () => {
    const { berechneLagerstand } = await laden('lib/behoerden/lagerstand.ts')
    assert.equal(berechneLagerstand(journal(), stamm(), '2025-09-30').zeilen.length, 0)
    n = 0
    const j = [zeile(1, '2026-01-01', 'ZK_FASS', 100), zeile(2, '2026-01-02', 'VK_FA_AT', -100), zeile(3, '2026-01-03', 'SCHWUND', -5, { weinausbau_id: 'B', charge_name: 'Rest' })]
    const e = berechneLagerstand(j, stamm(), '2026-01-31')
    assert.equal(e.zeilen.length, 0)
    assert.match(e.warnungen[0], /Negativer Bestand am Stichtag.*Rest/)
  })
  test('Erzeugnis: Spalte, Ausland, Stufe', async () => {
    const { erzeugnisCode } = await laden('lib/behoerden/lagerstand.ts')
    assert.equal(erzeugnisCode({ erzeugnis: 'MOST', qualitaetsstufe: 'qualitaetswein' }), 'MOST')
    assert.equal(erzeugnisCode({ land_iso: 'IT' }), 'EUWEIN')
    assert.equal(erzeugnisCode({ land_iso: 'ZA' }), 'DRITTLD')
    assert.equal(erzeugnisCode({ land_iso: 'AT', qualitaetsstufe: 'spaetlese' }), 'WEINGU')
    assert.equal(erzeugnisCode({ qualitaetsstufe: 'wein' }), 'WEIN')
    assert.equal(erzeugnisCode({ qualitaetsstufe: 'wein', rebsorte: 'Zweigelt' }), 'WEINSORT')
    assert.equal(erzeugnisCode({ qualitaetsstufe: 'sonstiges' }), null)
  })
  test('Stichtag-Parameter: Standard heute, keine Zukunft', async () => {
    const { lagerstandStichtag } = await laden('lib/behoerden/lagerstand.ts')
    const sp = (o) => new URLSearchParams(o)
    assert.deepEqual(lagerstandStichtag(sp({}), '2026-10-06'), { stichtag: '2026-10-06' })
    assert.deepEqual(lagerstandStichtag(sp({ stichtag: '2026-07-31' }), '2026-10-06'), { stichtag: '2026-07-31' })
    assert.match(lagerstandStichtag(sp({ stichtag: '2026-10-07' }), '2026-10-06').fehler, /Zukunft/)
    assert.match(lagerstandStichtag(sp({ stichtag: '31.07.2026' }), '2026-10-06').fehler, /JJJJ-MM-TT/)
  })
})

describe('KAN-44: Lagerbewegungen', nurMitHooks, () => {
  test('Anfangsmenge chronologisch, BSM-Buchungsart, Käufer/Verkäufer, Storno', async () => {
    const { berechneLagerbewegungen } = await laden('lib/behoerden/lagerstand.ts')
    const { zeilen } = berechneLagerbewegungen(journal(), stamm(), { von: '2026-03-01', bis: '2026-03-31' })
    assert.deepEqual(zeilen.map(z => z.beleg), ['3/1', '9/1', '4/1', '5/1', '6/1', '6/1'])
    const vk = zeilen[0]
    assert.deepEqual([vk.anfangStk, vk.buchungStk, vk.anfangLiter, vk.buchungLiter], [100, -20, 75, -15])
    assert.equal(vk.buchungsartBsm, 'VK_FL_AU')
    assert.equal(vk.kaeufer, 'Weinhaus Berlin')
    assert.equal(vk.kaeuferAdresse, 'Deutschland')
    assert.equal(vk.verkaeufer, null)
    assert.equal(vk.chargenNr, 'L25-F1')
    const zk = zeilen[1]
    // vor dem Zukauf (2.3.): 2000 − 75 = 1925 – der später erfasste Beleg zählt nach Datum
    assert.equal(zk.anfangLiter, 1925)
    assert.equal(zk.verkaeufer, 'Weingut Muster')
    assert.equal(zk.chargenNr, 'L25-01')
    assert.equal(zeilen[2].anfangLiter, 2025)
    assert.match(zeilen[2].anmerkung, /storniert/)
    assert.equal(zeilen[3].anmerkung, 'Storno-Gegenbuchung')
    assert.equal(zeilen[4].buchungsartBsm, 'AB_ABW')
  })
  test('neutrale Vorgänge ohne BSM-Code, INV_MIN → SCHWUND', async () => {
    const { bsmBuchungsart } = await laden('lib/behoerden/lagerstand.ts')
    assert.equal(bsmBuchungsart('UMZUG'), null)
    assert.equal(bsmBuchungsart('FUELLUNG'), null)
    assert.equal(bsmBuchungsart('INV_MIN'), 'SCHWUND')
    assert.equal(bsmBuchungsart('ZU_BEH'), 'ZU_BEH')
  })
  test('ladeLagerbewegungen: ohne Journal leer mit Hinweis, sonst Zeitraum vor Journalbeginn → Hinweis', async () => {
    const { ladeLagerbewegungen, ladeLagerstand } = await laden('lib/behoerden/lagerstand.ts')
    const tabellen = (ab) => ({
      tenant_einstellungen: [{ tenant_id: 't', journal_ab: ab }],
      kellerbuch_buchungen: journal().map(z => ({ ...z, tenant_id: 't' })),
      weinausbau: [{ id: 'A', tenant_id: 't', kmw: 19.48, chargennummer: 'L25-01' }],
      fuellungen: [{ id: 'F', tenant_id: 't', weinausbau_id: 'A', anzahl_unetikettiert: 0 }],
      fuellung_etikettierungen: [],
    })
    const rpc = () => ({ data: [{ id: 'T1', tenant_id: 't', name: 'Tank 1', volumen_liter: 3000 }], error: null })
    const ohne = await ladeLagerbewegungen(datenbank(tabellen(null), { rpc }), 't', { von: null, bis: null })
    assert.equal(ohne.zeilen.length, 0)
    assert.match(ohne.warnungen[0], /noch nicht eröffnet/)
    const mit = await ladeLagerbewegungen(datenbank(tabellen('2026-01-01'), { rpc }), 't', { von: '2025-10-01', bis: '2026-03-31' })
    assert.match(mit.warnungen[0], /beginnt am 01\.01\.2026/)
    assert.equal(mit.zeilen.length, 9)
    const st = await ladeLagerstand(datenbank(tabellen('2025-10-01'), { rpc }), 't', { stichtag: '2026-03-31' })
    assert.deepEqual(st.warnungen, [])
    assert.equal(st.zeilen.find(z => z.gebindeArt === 'offen').gebinde, 'Tank 1')
  })
})

describe('KAN-44: Spalten und Verdrahtung', nurMitHooks, () => {
  test('Spaltenzahl wie die BKI-Blätter', async () => {
    const { SPALTEN_LAGERSTAND, SPALTEN_LAGERBEWEGUNGEN } = await laden('lib/behoerden/lagerstand.ts')
    assert.equal(SPALTEN_LAGERSTAND.length, 35)
    assert.equal(SPALTEN_LAGERBEWEGUNGEN.length, 49)
    assert.equal(SPALTEN_LAGERSTAND[19].kopf, 'offener Wein / Flasche')
    assert.equal(SPALTEN_LAGERBEWEGUNGEN.at(-6).kopf, 'Anmerkungen')
  })
  test('Katalog, Register und Seiten', () => {
    assert.match(quelle('src/lib/behoerden/katalog/kellerbuch.ts'), /'bki-lagerstand': \{[\s\S]{0,200}druckPfad: '\/kellerbuch\/lagerstand'/)
    assert.match(quelle('src/lib/behoerden/register/kellerbuch.ts'), /'bki-lagerbewegungen': definiereMeldung\(KATALOG_KELLERBUCH\['bki-lagerbewegungen'\]/)
    assert.match(quelle('src/app/(dashboard)/kellerbuch/lagerstand/page.tsx'), /^\/\/ behoerdenmeldung: bki-lagerstand\n/)
    assert.match(quelle('src/app/(dashboard)/kellerbuch/lagerbewegungen/page.tsx'), /csvPfad\('bki-lagerbewegungen', \{ von, bis \}\)/)
  })
})
