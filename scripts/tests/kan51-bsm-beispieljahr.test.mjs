// KAN-51 (10.10.2026): Regressionstest „Beispiel-Wirtschaftsjahr mit bekanntem Ergebnis“ für die Bestandsmeldung aus dem
// Bewegungsjournal – alle Buchungspfade, die eine BSM-Zeile ergeben (Ernte, Zukauf Fass/Most/Flaschen, Zugang durch
// Behandlung, Verschnitt, Füllung, Fass- und Flaschenverkauf In- und Ausland, Verarbeitung, Inventur-Mindermenge), dazu
// Storno-Paare und eine Buchung nach dem Zeitraum. Geprüft wird das bekannte Ergebnis je Buchungsart und die Bilanz je
// Spalte: Anfangsbestand + Zugänge − Abgänge = Bestand zum Stichtag, ohne Differenz.
// Daneben: Dashboard-Hinweis bei Journal-Abweichungen und das Handbuch-Kapitel.
//
// Aufruf:  npm run -s test:csv

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { hooksRegistrieren, laden, nurMitHooks } from './buchung-attrappe.mjs'

hooksRegistrieren()
const quelle = p => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')

const T = 'tenant-1'
const WJ = { von: '2025-08-01', bis: '2026-07-31' }
const GV = { rebsorte: 'Grüner Veltliner', weinart: 'weiss', land_iso: 'AT', jahrgang: 2025 }
let n = 0
const zeile = (beleg, datum, code, liter, x = {}) => ({
  id: `j${++n}`, tenant_id: T, beleg_nr: beleg, pos: n, datum, buchungsart_code: code, bestand: 'offen',
  weinausbau_id: 'A', fuellung_id: null, menge_liter: liter, menge_stk: 0, menge_kg: null, partner_name: null, partner_land: null,
  quelle_tabelle: 'keller_umzuege', quelle_id: `q${n}`, gruppe_id: null, storno_von_id: null, rekonstruiert: false,
  charge_name: 'GV A', fuellung_name: null, flaschengroesse_ml: null, erzeugnis: null, qualitaetsstufe: 'qualitaetswein',
  zusatzbezeichnung: null, charge_status: 'lagerung', hinweis: null, ...GV, ...x,
})
const flasche = (x = {}) => ({ bestand: 'flasche', weinausbau_id: null, fuellung_id: 'F', fuellung_name: 'GV Klassik', flaschengroesse_ml: 750, charge_status: null, ...x })

function beispieljahr() {
  n = 0
  return [
    zeile(1, '2025-07-10', 'ERNTE', 5000, { quelle_tabelle: 'pressung_behaelter' }),                                  // vor dem Zeitraum → Anfangsbestand
    zeile(2, '2025-09-25', 'ERNTE', 3000, { weinausbau_id: 'B', charge_name: 'GV B', quelle_tabelle: 'pressung_behaelter' }),
    zeile(3, '2025-10-05', 'ZK_FASS', 1000, { weinausbau_id: 'C', charge_name: 'Zukauf C', partner_name: 'Winzer X', partner_land: 'AT', quelle_tabelle: 'zukauf_posten' }),
    zeile(4, '2025-10-06', 'ZK_MOST', 500, { weinausbau_id: 'D', charge_name: 'Most D', partner_name: 'Winzer Y', partner_land: 'AT', quelle_tabelle: 'zukauf_posten' }),
    zeile(5, '2025-10-07', 'ZK_FLA', 300, flasche({ menge_stk: 400, partner_name: 'Winzer Z', partner_land: 'AT', quelle_tabelle: 'zukauf_posten' })),
    zeile(6, '2025-11-02', 'ZU_BEH', 50, { quelle_tabelle: 'keller_behandlungen' }),
    // Verschnitt B + C → A (gleiche Spalte Qualitätswein: Abgang und Zugang gleichen sich aus)
    zeile(7, '2025-12-01', 'VS_AB', -400, { weinausbau_id: 'B', charge_name: 'GV B', quelle_tabelle: 'verschneidungen' }),
    zeile(7, '2025-12-01', 'VS_AB', -200, { weinausbau_id: 'C', charge_name: 'Zukauf C', quelle_tabelle: 'verschneidungen' }),
    zeile(7, '2025-12-01', 'VS_ZU', 600, { quelle_tabelle: 'verschneidungen' }),
    // Füllung offen → Flasche (neutral)
    zeile(8, '2026-02-01', 'FUELLUNG', -1500, { quelle_tabelle: 'fuellungen' }),
    zeile(8, '2026-02-01', 'FUELLUNG', 1500, flasche({ menge_stk: 2000, quelle_tabelle: 'fuellungen' })),
    zeile(9, '2026-03-01', 'VK_FA_AT', -800, { weinausbau_id: 'B', charge_name: 'GV B', partner_name: 'Heuriger W', partner_land: 'AT', quelle_tabelle: 'verkauf_positionen' }),
    zeile(10, '2026-03-02', 'VK_FA_AU', -200, { weinausbau_id: 'C', charge_name: 'Zukauf C', partner_name: 'Weinhandel Müller', partner_land: 'DE', quelle_tabelle: 'verkauf_positionen' }),
    zeile(11, '2026-04-01', 'VK_FL_AT', -750, flasche({ menge_stk: -1000, partner_name: 'Kunde Wien', partner_land: 'AT', quelle_tabelle: 'verkauf_positionen' })),
    zeile(12, '2026-04-02', 'VK_FL_AU', -150, flasche({ menge_stk: -200, partner_name: 'Shop München', partner_land: 'DE', quelle_tabelle: 'verkauf_positionen' })),
    zeile(13, '2026-05-01', 'AB_VERAR', -100, { quelle_tabelle: 'verarbeitungen' }),
    zeile(14, '2026-06-30', 'INV_MIN', -20, { quelle_tabelle: 'weinausbau_bestand' }),
    // Verkauf mit Storno (Gegenbuchung am selben Tag): neutral
    zeile(15, '2026-07-01', 'VK_FA_AT', -90, { partner_name: 'Storniert', partner_land: 'AT', quelle_tabelle: 'verkauf_positionen', quelle_id: 'v15' }),
    zeile(16, '2026-07-01', 'VK_FA_AT', 90, { partner_name: 'Storniert', partner_land: 'AT', quelle_tabelle: 'verkauf_positionen', quelle_id: 'v15', storno_von_id: 'j19' }),
    // nach dem Zeitraum
    zeile(17, '2026-08-03', 'VK_FA_AT', -60, { partner_land: 'AT', quelle_tabelle: 'verkauf_positionen' }),
  ]
}

const ZUSATZ = { verkaufsposten: new Map(), traubenZukauf: [], pressungWeingaerten: [] }
const summe = (d, pos, teil = 'gesamt', h = 'AT') => d.summen.find(s => s.position === pos && s.teil === teil && s.herkunft === h)
const liter = (d, pos) => d.summen.filter(s => s.position === pos && s.teil === 'gesamt').reduce((x, s) => x + s.summeLiter, 0)

describe('KAN-51: Beispiel-Wirtschaftsjahr der Bestandsmeldung', nurMitHooks, () => {
  test('bekanntes Ergebnis je Buchungsart', async () => {
    const { berechneBsmAusJournal } = await laden('lib/behoerden/bsm.ts')
    const d = berechneBsmAusJournal(beispieljahr(), ZUSATZ, WJ, '2026-10-10', { journalAb: '2025-07-01', abweichungen: 0 })
    assert.equal(d.quelle, 'journal')
    const soll = { ANFANG: 5000, ERNTE: 3000, ZK_FASS: 1000, ZK_MOST: 500, ZK_FLA: 300, ZU_BEH: 50, VK_FA_AT: 800, VK_FA_AU: 200, VK_FL_AT: 750, VK_FL_AU: 150, AB_VERAR: 100, SCHWUND: 20 }
    for (const [pos, l] of Object.entries(soll)) assert.equal(Math.round(liter(d, pos) * 100) / 100, l, pos)   // runden-ok: Testvergleich auf Cent, keine Ausgabe
    // Verschnitt in derselben Spalte: Zu- und Abgang heben sich auf
    assert.equal(Math.round((liter(d, 'VS_ZU') - liter(d, 'VS_AB')) * 100) / 100, 0)   // runden-ok: Testvergleich auf Cent, keine Ausgabe
    // Storno-Paar und Buchung nach dem Zeitraum zählen nicht
    assert.ok(!d.buchungen.some(b => b.datum > WJ.bis))
  })

  test('Bilanz je Spalte: Anfang + Zugänge − Abgänge = Stichtag, keine Differenz', async () => {
    const { berechneBsmAusJournal } = await laden('lib/behoerden/bsm.ts')
    const d = berechneBsmAusJournal(beispieljahr(), ZUSATZ, WJ, '2026-10-10', { journalAb: '2025-07-01', abweichungen: 0 })
    const stichtag = summe(d, 'STICHTAG'), ende = summe(d, 'ENDE')
    assert.equal(stichtag.summeLiter, 5000 + 3000 + 1000 + 500 + 300 + 50 - 800 - 200 - 750 - 150 - 100 - 20)
    assert.deepEqual(ende.werte, stichtag.werte)
    for (const h of d.herkuenfte) {
      const zeilen = d.summen.filter(s => s.herkunft === h && s.teil === 'gesamt')
      for (const sp of d.spalten) {
        const v = pos => zeilen.filter(s => pos(s)).reduce((x, s) => x + (s.werte[sp] ?? 0), 0)
        const rechnung = v(s => s.position === 'ANFANG') + v(s => s.abschnitt === 'Zugang') - v(s => s.abschnitt === 'Abgang') + v(s => s.abschnitt === 'Umstufung')
        const ist = v(s => s.position === 'STICHTAG')
        assert.ok(Math.abs(rechnung - ist) < 0.005, `${h}/${sp}: ${rechnung} ≠ ${ist}`)
      }
    }
    assert.ok(!d.summen.some(s => s.position === 'DIFFERENZ' && Math.abs(s.summeLiter) > 0.004))
    assert.equal(summe(d, 'STICHTAG', 'davon Flasche').summeLiter, 300 + 1500 - 750 - 150)
  })
})

describe('KAN-51: Konsistenzhinweis und Dokumentation', () => {
  test('Dashboard Kellerbuch meldet Journal-Abweichungen (journal_konsistenz) mit Link zum Journal', () => {
    const p = quelle('src/app/(dashboard)/dashboard/kellerbuch/page.tsx')
    assert.match(p, /journalAbweichungenAnzahl\(ctx\.supabase, ctx\.tenantId\)/)
    assert.match(p, /abweichungen !== null && abweichungen > 0[\s\S]{0,400}href="\/kellerbuch\/journal"/)
    const j = quelle('src/lib/kellerbuch/journal.ts')
    assert.match(j, /export async function journalAbweichungenAnzahl[\s\S]{0,300}if \(!\(await ladeJournalBeginn\(supabase, tenantId\)\)\) return null/)
  })

  test('Handbuch-Kapitel und FAQ zur BKI-Schnittstelle', () => {
    const h = quelle('src/app/(dashboard)/hilfe/handbuch/page.tsx')
    assert.match(h, /id: 'bki', icon: FileSpreadsheet, titel: 'Bestandsmeldung & BKI-Schnittstelle'/)
    for (const t of ['Gesamtexport als XLSX mit Prüfbericht', 'Rückverfolgung (RV zum Eingang und zum Ausgang)', 'Verkauf, Einkauf und TBS-Aufstellung']) assert.ok(h.includes(t), t)
    assert.ok((quelle('src/app/(dashboard)/hilfe/faq/page.tsx').match(/kategorie: 'BKI-Schnittstelle'/g) ?? []).length >= 5)
  })
})
