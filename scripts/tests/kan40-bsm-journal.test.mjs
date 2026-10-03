// KAN-40 Etappe E2 (03.10.2026) – Weinbestandsmeldung (BSM) aus dem Bewegungsjournal kellerbuch_buchungen
//
// Aufruf:  npm run -s test:csv   (alle scripts/tests/*.test.mjs)
//
// 1. berechneBsmAusJournal: Anfangsbestand aus Zeilen vor „von“ + EROEFF im Zeitraum, Zellen aus den Merkmalen der Zeile,
//    Status Gärung → Most/Sturm, Umstufungspaar Most → Wein als UMST_MOST, Umstufung ohne Zellwechsel entfällt, Umzug mit
//    Spaltenwechsel → AB_ABW/ZU_ABW, Füllung offen → Flasche neutral, INV_MIN → SCHWUND, Verkauf ins Ausland nach
//    partner_land, Storno-Beleg bleibt neutral, Endbestand = Stichtag laut Journal.
// 2. ladeBsm(): ohne journal_ab die Rekonstruktion, mit journal_ab ≤ „bis“ das Journal.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { hooksRegistrieren, laden, nurMitHooks, datenbank } from './buchung-attrappe.mjs'

hooksRegistrieren()

const T = 'tenant-1'
const HEUTE = '2026-10-03'
const WJ = { von: '2025-08-01', bis: '2026-07-31' }
const GV = { rebsorte: 'Grüner Veltliner', weinart: 'weiss', land_iso: 'AT', jahrgang: 2025 }

let n = 0
/** Journalzeile mit Standardmerkmalen (Qualitätswein, weiß, Österreich, offen) */
const zeile = (beleg, datum, code, liter, x = {}) => ({
  id: `j${++n}`, tenant_id: T, beleg_nr: beleg, pos: n, datum, buchungsart_code: code, bestand: 'offen',
  weinausbau_id: 'A', fuellung_id: null, menge_liter: liter, menge_stk: 0, menge_kg: null, partner_name: null, partner_land: null,
  quelle_tabelle: 'keller_umzuege', quelle_id: `q${n}`, gruppe_id: null, storno_von_id: null, rekonstruiert: false,
  charge_name: 'GV A', fuellung_name: null, flaschengroesse_ml: null, erzeugnis: null, qualitaetsstufe: 'qualitaetswein',
  zusatzbezeichnung: null, charge_status: 'lagerung', hinweis: null, ...GV, ...x,
})

function journal() {
  n = 0
  return [
    // vor dem Zeitraum: Ernte 2024 (Anfangsbestand)
    zeile(1, '2025-07-10', 'ERNTE', 1000, { quelle_tabelle: 'pressung_behaelter' }),
    // Ernte 2025 in Gärung → Most/Sturm
    zeile(2, '2025-09-20', 'ERNTE', 2000, { weinausbau_id: 'C', charge_name: 'GV C', qualitaetsstufe: null, charge_status: 'gaerung', quelle_tabelle: 'pressung_behaelter' }),
    // Status Gärung → Ausbau: Umstufungspaar der Datenbank → UMST_MOST
    zeile(3, '2025-11-15', 'AB_ABW', -2000, { weinausbau_id: 'C', charge_name: 'GV C', qualitaetsstufe: null, charge_status: 'gaerung', quelle_tabelle: 'weinausbau_merkmale' }),
    zeile(3, '2025-11-15', 'ZU_ABW', 2000, { weinausbau_id: 'C', charge_name: 'GV C', qualitaetsstufe: 'qualitaetswein', charge_status: 'ausbau', quelle_tabelle: 'weinausbau_merkmale' }),
    // Kabinett → Qualitätswein: gleiche Spalte, entfällt
    zeile(4, '2025-12-01', 'AB_ABW', -1000, { qualitaetsstufe: 'kabinett', quelle_tabelle: 'weinausbau_merkmale' }),
    zeile(4, '2025-12-01', 'ZU_ABW', 1000, { quelle_tabelle: 'weinausbau_merkmale' }),
    // Umzug A (Qualitätswein) → D (Landwein): Spaltenwechsel → AB_ABW/ZU_ABW
    zeile(5, '2026-01-10', 'UMZUG', -300, {}),
    zeile(5, '2026-01-10', 'UMZUG', 300, { weinausbau_id: 'D', charge_name: 'GV D', qualitaetsstufe: 'landwein' }),
    // Füllung: offen −750, Flasche +1000 Stk à 750 ml (gleiche Spalte, neutral)
    zeile(6, '2026-02-01', 'FUELLUNG', -750, { weinausbau_id: 'C', charge_name: 'GV C', quelle_tabelle: 'fuellungen', charge_status: 'ausbau' }),
    zeile(6, '2026-02-01', 'FUELLUNG', 750, { bestand: 'flasche', weinausbau_id: null, fuellung_id: 'F', fuellung_name: 'GV Klassik', menge_stk: 1000, flaschengroesse_ml: 750, quelle_tabelle: 'fuellungen', charge_status: null }),
    // Tankverkauf nach Deutschland
    zeile(7, '2026-03-01', 'VK_FA_AU', -100, { partner_name: 'Weinhandel Müller', partner_land: 'DE', quelle_tabelle: 'verkauf_positionen' }),
    // Abgleich: Inventur-Mindermenge
    zeile(8, '2026-04-01', 'INV_MIN', -10, { quelle_tabelle: 'weinausbau_bestand' }),
    // Umzug mit Gegenbuchung (Storno): bleibt neutral, Saldo 0
    zeile(9, '2026-05-01', 'UMZUG', -50, { quelle_id: 'u9' }),
    zeile(9, '2026-05-01', 'UMZUG', 50, { weinausbau_id: 'D', charge_name: 'GV D', qualitaetsstufe: 'landwein', quelle_id: 'u9' }),
    // nach dem Zeitraum
    zeile(11, '2026-08-05', 'VK_FA_AT', -40, {}),
  ]
}
/** Gegenbuchungen zu Beleg 9 (am selben Tag) */
function mitStorno(z) {
  const b9 = z.filter(r => r.beleg_nr === 9)
  return [...z, ...b9.map((r, i) => ({ ...r, id: `s${i}`, beleg_nr: 10, pos: 100 + i, menge_liter: -r.menge_liter, storno_von_id: r.id }))]
}

const summe = (d, pos, teil = 'gesamt', h = 'AT') => d.summen.find(s => s.position === pos && s.teil === teil && s.herkunft === h)

describe('KAN-40 E2: BSM aus dem Bewegungsjournal', nurMitHooks, () => {
  test('Zellen, Umstufungen, Abwertung und Bestände', async () => {
    const { berechneBsmAusJournal } = await laden('lib/behoerden/bsm.ts')
    const d = berechneBsmAusJournal(mitStorno(journal()), { verkaufsposten: new Map(), traubenZukauf: [], pressungWeingaerten: [] }, WJ, HEUTE, { journalAb: '2025-07-01', abweichungen: 0 })
    assert.equal(d.quelle, 'journal')
    // Anfangsbestand: Ernte 2024 (1000 l Qualitätswein)
    assert.equal(summe(d, 'ANFANG').werte.qualitaetswein, 1000)
    assert.equal(summe(d, 'ANFANG').summeLiter, 1000)
    // Ernte 2025 in Gärung → Most/Sturm; Umstufung Most → Wein neutral
    assert.equal(summe(d, 'ERNTE').werte.most_sturm, 2000)
    const umst = d.buchungen.filter(b => b.code === 'UMST_MOST')
    assert.equal(umst.length, 2)
    assert.equal(umst.reduce((s, b) => s + b.liter, 0), 0)
    // Kabinett → Qualitätswein entfällt (gleiche Spalte); Umzug QW → Landwein = Abwertung 300 l
    assert.equal(d.buchungen.filter(b => b.code === 'AB_ABW').reduce((s, b) => s + b.liter, 0), -300)
    assert.equal(d.buchungen.filter(b => b.code === 'ZU_ABW').reduce((s, b) => s + b.liter, 0), 300)
    assert.equal(summe(d, 'ZU_ABW').werte.landwein, 300)
    // Verkauf ins Ausland nach partner_land, INV_MIN als Schwund
    assert.equal(summe(d, 'VK_FA_AU').werte.qualitaetswein, 100)
    assert.equal(summe(d, 'SCHWUND').werte.qualitaetswein, 10)
    assert.ok(d.buchungen.some(b => b.code === 'VK_FA_AU' && /Deutschland/.test(b.gegenstelle ?? '')))
    // Storno-Beleg und Füllung bleiben neutral, Saldo 0
    assert.ok(d.buchungen.filter(b => b.beleg?.startsWith('J 9/') || b.beleg?.startsWith('J 10/')).every(b => b.code === 'UMZUG'))
    // Endbestand = Stichtag (laut Journal), keine Differenz; Buchung nach dem Zeitraum nicht enthalten
    const ende = summe(d, 'ENDE'), stichtag = summe(d, 'STICHTAG')
    assert.deepEqual(ende.werte, stichtag.werte)
    assert.equal(stichtag.summeLiter, 1000 + 2000 - 100 - 10)
    assert.equal(stichtag.werte.landwein, 300)
    assert.equal(summe(d, 'STICHTAG', 'davon Flasche').summeLiter, 750)
    assert.ok(!d.summen.some(s => s.position === 'DIFFERENZ' && Math.abs(s.summeLiter) > 0.004))
    assert.match(stichtag.bezeichnung, /laut Bewegungsjournal/)
    assert.ok(d.warnungen.some(w => w.startsWith('Rechengrundlage: Bewegungsjournal (ab 01.07.2025)')))
    assert.ok(!d.warnungen.some(w => /Aufwertung/.test(w)))
  })

  test('Journalbeginn im Zeitraum und heutige Abweichungen werden gemeldet', async () => {
    const { berechneBsmAusJournal } = await laden('lib/behoerden/bsm.ts')
    const d = berechneBsmAusJournal(journal().filter(r => r.datum >= '2026-01-01'), { verkaufsposten: new Map(), traubenZukauf: [], pressungWeingaerten: [] }, WJ, HEUTE, { journalAb: '2026-01-01', abweichungen: 2 })
    assert.ok(d.warnungen.some(w => /beginnt am 01\.01\.2026, nach dem Beginn des Zeitraums/.test(w)))
    assert.ok(d.warnungen.some(w => /weicht heute bei 2 Posten vom Bestand ab/.test(w)))
  })

  test('ladeBsm: Journal nur mit journal_ab bis zum Zeitraumende', async () => {
    const { ladeBsm } = await laden('lib/behoerden/bsm.ts')
    const tabellen = (ab) => ({
      tenant_einstellungen: [{ tenant_id: T, journal_ab: ab }],
      kellerbuch_buchungen: journal(),
      weinausbau: [], fuellungen: [], keller_umzuege: [], verkaufsposten: [], zukauf_posten: [], pressung_weingaerten: [], exportauftraege: [],
    })
    const mit = await ladeBsm(datenbank(tabellen('2025-07-01'), { rpc: () => ({ data: [], error: null }) }), T, WJ, { heute: HEUTE })
    assert.equal(mit.quelle, 'journal')
    assert.equal(mit.summen.find(s => s.position === 'ANFANG' && s.teil === 'gesamt').summeLiter, 1000)
    const spaeter = await ladeBsm(datenbank(tabellen('2026-08-01'), { rpc: () => ({ data: [], error: null }) }), T, WJ, { heute: HEUTE })
    assert.equal(spaeter.quelle, 'rekonstruktion')
    const ohne = await ladeBsm(datenbank(tabellen(null), { rpc: () => ({ data: [], error: null }) }), T, WJ, { heute: HEUTE })
    assert.equal(ohne.quelle, 'rekonstruktion')
  })
})
