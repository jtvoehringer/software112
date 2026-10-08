// KAN-44 Teil 3 (08.10.2026): Weinbuch kennt Zukauf, Fassverkauf, Eröffnungsbestand und alle weiteren Mengenbewegungen –
// ab dem Journalbeginn aus dem Bewegungsjournal (mit „Bestand danach“, Storno als Gegenbuchung), davor bzw. ohne Journal
// aus den Bewegungstabellen. Abgedeckte Journalzeilen (Umzug, Pressung, Verschnitt, Füllung) erscheinen nicht doppelt.
//
// Aufruf:  npm run -s test:csv   (alle scripts/tests/*.test.mjs)

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import * as wb from '../../src/lib/wein/weinbuchBestand.ts'
import { hooksRegistrieren, laden, nurMitHooks, datenbank } from './buchung-attrappe.mjs'

hooksRegistrieren()

const T = 't1'
let n = 0
const jz = (datum, code, liter, extra = {}) => ({
  id: `j${++n}`, tenant_id: T, beleg_nr: n, pos: 1, datum, buchungsart_code: code, bestand: 'offen', weinausbau_id: 'A',
  menge_liter: liter, partner_name: null, partner_land: null, quelle_tabelle: 'zukauf_posten', storno_von_id: null,
  rekonstruiert: false, hinweis: null, ...extra,
})

describe('KAN-44 Teil 3: Mengenbewegungen im Weinbuch (rein)', () => {
  test('abgedeckt: Umzug, Pressung, Verschnitt, Füllung; Merkmalsänderung nur am Tag einer Abstufung', () => {
    const tage = new Set(['2026-03-01'])
    for (const q of ['keller_umzuege', 'pressung_behaelter', 'verschneidung_quellen']) {
      assert.equal(wb.journalZeileAbgedeckt({ quelle_tabelle: q, buchungsart_code: 'UMZUG', datum: '2026-01-01' }, tage), true)
    }
    assert.equal(wb.journalZeileAbgedeckt({ quelle_tabelle: 'fuellungen', buchungsart_code: 'FUELLUNG', datum: '2026-01-01' }, tage), true)
    assert.equal(wb.journalZeileAbgedeckt({ quelle_tabelle: 'fuellungen', buchungsart_code: 'LNSKT_ZU', datum: '2026-01-01' }, tage), false)
    assert.equal(wb.journalZeileAbgedeckt({ quelle_tabelle: 'weinausbau_merkmale', buchungsart_code: 'AB_ABW', datum: '2026-03-01' }, tage), true)
    assert.equal(wb.journalZeileAbgedeckt({ quelle_tabelle: 'weinausbau_merkmale', buchungsart_code: 'AB_ABW', datum: '2026-03-02' }, tage), false)
    for (const q of ['zukauf_posten', 'verkauf_positionen', 'journal_eroeffnen', 'weinausbau', 'weinausbau_bestand', 'keller_verarbeitungen', 'produktionen', 'lohnversektungen', 'neue_tabelle']) {
      assert.equal(wb.journalZeileAbgedeckt({ quelle_tabelle: q, buchungsart_code: 'X', datum: '2026-01-01' }, tage), false, q)
    }
  })

  test('Einträge mit Vorzeichen, Partner, Saldo danach (auch über abgedeckte Zeilen) und Storno', () => {
    n = 0
    const zeilen = [
      jz('2026-01-10', 'EROEFF', 1000, { quelle_tabelle: 'journal_eroeffnen' }),
      jz('2026-02-01', 'UMZUG', 0, { quelle_tabelle: 'keller_umzuege' }),
      jz('2026-02-05', 'SCHWUND', -10, { quelle_tabelle: 'keller_umzuege' }),
      jz('2026-03-01', 'VK_FA_AU', -300, { quelle_tabelle: 'verkauf_positionen', partner_name: 'Weinhandel Bayern', partner_land: 'DE' }),
      jz('2026-03-04', 'VK_FA_AU', 300, { quelle_tabelle: 'verkauf_positionen', partner_name: 'Weinhandel Bayern', partner_land: 'DE', storno_von_id: 'j4' }),
      jz('2026-03-05', 'INV_MIN', -2.5, { quelle_tabelle: 'weinausbau_bestand' }),
    ]
    const ev = wb.journalEreignisse(zeilen, { abstufungTage: new Set(), journalBeginn: '2026-01-10' })
    assert.deepEqual(ev.map(e => [e.datum, e.typ, e.titel, e.badge]), [
      ['2026-01-10', 'eroeffnung', 'Übertrag bei Eröffnung des Bewegungsjournals', undefined],
      ['2026-03-01', 'verkauf', 'Fassverkauf ins Ausland', 'storniert'],
      ['2026-03-04', 'verkauf', 'Storno: Fassverkauf ins Ausland', 'Storno'],
      ['2026-03-05', 'bestand', 'Inventurdifferenz Mindermenge', undefined],
    ])
    assert.ok(ev[0].details.includes('Bestand am Journalbeginn 10.01.2026'), ev[0].details.join(' | '))
    assert.ok(ev[1].details.includes('Menge: −300 L'))
    assert.ok(ev[1].details.includes('an Weinhandel Bayern (DE)'))
    assert.ok(ev[1].details.includes('Bestand danach (Bewegungsjournal): 690 L'), ev[1].details.join(' | '))   // 1000 − 10 − 300
    assert.ok(ev[2].details.includes('Menge: +300 L'))
    assert.ok(ev[3].details.includes('Bestand danach (Bewegungsjournal): 987,5 L'), ev[3].details.join(' | '))
    assert.equal(wb.journalSaldo(zeilen), 987.5)
    // Katalog-Bezeichnung hat Vorrang, unbekannter Code bleibt sichtbar
    assert.equal(wb.journalEreignisse([jz('2026-04-01', 'NEU_X', 5, { quelle_tabelle: 'neue_tabelle' })], { abstufungTage: new Set(), journalBeginn: null })[0].titel, 'NEU_X')
    assert.equal(wb.journalEreignisse([jz('2026-04-01', 'INV_MIN', -1, { quelle_tabelle: 'x' })], { abstufungTage: new Set(), journalBeginn: null, text: { INV_MIN: 'Mindermenge' } })[0].titel, 'Mindermenge')
  })

  test('Reihenfolge nach Datum, dann Beleg und Position', () => {
    const z = [{ datum: '2026-02-01', beleg_nr: 1, pos: 1 }, { datum: '2026-01-01', beleg_nr: 5, pos: 2 }, { datum: '2026-01-01', beleg_nr: 5, pos: 1 }]
    assert.deepEqual(wb.journalSortiert(z).map(x => `${x.datum}/${x.beleg_nr}/${x.pos}`), ['2026-01-01/5/1', '2026-01-01/5/2', '2026-02-01/1/1'])
  })

  test('Abweichung Journal ↔ Bestand ab mehr als 0,5 L', () => {
    assert.equal(wb.journalAbweichungHinweis(100, 100.4), null)
    assert.match(wb.journalAbweichungHinweis(100, 120) ?? '', /Bewegungsjournal \(100 L\) weicht vom Bestand der Charge \(120 L\) ab/)
  })

  test('vor dem Journal: Tabellen; ab dem Journalbeginn: Journal; ohne Journal: immer Tabellen', () => {
    assert.equal(wb.vorJournal('2026-01-09', '2026-01-10'), true)
    assert.equal(wb.vorJournal('2026-01-10', '2026-01-10'), false)
    assert.equal(wb.vorJournal('2030-01-01', null), true)
    assert.equal(wb.vorJournal(null, null), false)
  })

  test('Einträge aus den Tabellen: Zukauf, Fassverkauf, Eröffnungsbestand', () => {
    const zk = wb.zukaufEreignis({ datum: '2025-10-05', art: 'wein', menge: 300, einheit: 'l', rebsorte: 'Grüner Veltliner', jahrgang: 2025, aktiv: true, lieferant_firma: { name: 'Winzerhof Berger' } })
    assert.deepEqual([zk.datum, zk.typ, zk.titel], ['2025-10-05', 'zukauf', 'Zukauf Fasswein'])
    assert.ok(zk.details.includes('von Winzerhof Berger'))
    assert.equal(wb.zukaufEreignis({ datum: '2025-10-05', art: 'wein', aktiv: false }), null)   // vor KAN-145 gelöscht
    const fv = wb.fassverkaufEreignis({ menge: 250, verkaufsposten: { datum: '2025-12-01', rechnungsnummer: 'R-7', kontakt: { vorname: 'Eva', nachname: 'Huber' } } })
    assert.deepEqual([fv.datum, fv.typ, fv.titel], ['2025-12-01', 'verkauf', 'Fassverkauf'])
    assert.deepEqual(fv.details, ['Menge: −250 L', 'an Eva Huber', 'Rechnung R-7'])
    const er = wb.eroeffnungEreignis({ ist_eroeffnungsbestand: true, created_at: '2025-08-01T08:00:00Z', anfangsbestand_liter: 800, menge_liter: 500 })
    assert.deepEqual([er.datum, er.typ, er.details[0]], ['2025-08-01', 'eroeffnung', 'Menge: +800 L'])
    assert.equal(wb.eroeffnungEreignis({ ist_eroeffnungsbestand: false, created_at: '2025-08-01T08:00:00Z', menge_liter: 500 }), null)
  })
})

function daten({ journalAb = null, menge = 500 } = {}) {
  n = 0
  return {
    weinausbau: [{ id: 'A', tenant_id: T, name: 'GV Altbestand', jahrgang: 2024, rebsorte: 'Grüner Veltliner', qualitaetsstufe: null, status: 'ausbau', menge_liter: menge, behaelter_id: null, behaelter: null, ist_eroeffnungsbestand: true, anfangsbestand_liter: 800, created_at: '2025-08-01T08:00:00Z' }],
    tenant_einstellungen: [{ tenant_id: T, journal_ab: journalAb }],
    zukauf_posten: [
      { id: 'zk-vor', tenant_id: T, datum: '2025-10-05', art: 'wein', menge: 300, einheit: 'l', rebsorte: 'Grüner Veltliner', jahrgang: 2024, ziel_weinausbau_id: 'A', aktiv: true, lieferant_firma: { name: 'Winzerhof Berger', betrieb_nr: '7654321' }, lieferant_kontakt: null },
      { id: 'zk-nach', tenant_id: T, datum: '2026-02-01', art: 'most', menge: 100, einheit: 'l', ziel_weinausbau_id: 'A', aktiv: true, lieferant_firma: { name: 'Weinbau Gruber' }, lieferant_kontakt: null },
    ],
    verkauf_positionen: [
      { id: 'vp1', tenant_id: T, typ: 'tank', weinausbau_id: 'A', menge: 400, verkaufsposten: { datum: '2025-12-01', rechnungsnummer: 'R-7', aktiv: true, storniert_am: '2025-12-03T09:00:00Z', storno_grund: 'Falscher Kunde', storniert_von_name: 'Karin', firma: { name: 'Kellerei Nord' }, kontakt: null } },
      { id: 'vp2', tenant_id: T, typ: 'tank', weinausbau_id: 'A', menge: 200, verkaufsposten: { datum: '2026-03-01', aktiv: true, firma: { name: 'Kellerei Süd' }, kontakt: null } },
    ],
    kellerbuch_buchungen: journalAb ? [
      jz('2026-01-10', 'EROEFF', 600, { quelle_tabelle: 'journal_eroeffnen' }),
      jz('2026-02-01', 'ZK_MOST', 100, { partner_name: 'Weinbau Gruber', partner_land: 'AT' }),
      jz('2026-03-01', 'VK_FA_AT', -200, { quelle_tabelle: 'verkauf_positionen', partner_name: 'Kellerei Süd', partner_land: 'AT' }),
      jz('2026-03-02', 'SCHWUND', -5, { quelle_tabelle: 'keller_umzuege' }),
    ] : [],
  }
}

describe('KAN-44 Teil 3: buildWeinbuch', nurMitHooks, () => {
  test('ohne Journal: Eröffnungsbestand, Zukauf und Fassverkauf aus den Tabellen, Storno gekennzeichnet', async () => {
    const { buildWeinbuch } = await laden('lib/wein/weinbuch.ts')
    const w = await buildWeinbuch(datenbank(daten()), 'A', T)
    const m = w.events.filter(e => ['eroeffnung', 'zukauf', 'verkauf'].includes(e.typ))
    assert.deepEqual(m.map(e => [e.datum, e.typ, e.titel, e.badge]), [
      ['2025-08-01', 'eroeffnung', 'Eröffnungsbestand', undefined],
      ['2025-10-05', 'zukauf', 'Zukauf Fasswein', undefined],
      ['2025-12-01', 'verkauf', 'Fassverkauf', 'storniert'],
      ['2025-12-03', 'verkauf', 'Storno: Fassverkauf', 'Storno'],
      ['2026-02-01', 'zukauf', 'Zukauf Most', undefined],
      ['2026-03-01', 'verkauf', 'Fassverkauf', undefined],
    ])
    assert.ok(m[3].details.includes('Grund: Falscher Kunde'))
    assert.ok(!w.warnungen.some(x => x.includes('Bewegungsjournal')))
  })

  test('mit Journal: davor aus den Tabellen, ab Journalbeginn aus dem Journal – ohne Dubletten, mit Saldo und Abweichung', async () => {
    const { buildWeinbuch } = await laden('lib/wein/weinbuch.ts')
    const w = await buildWeinbuch(datenbank(daten({ journalAb: '2026-01-10', menge: 495 })), 'A', T)
    const m = w.events.filter(e => ['eroeffnung', 'zukauf', 'verkauf', 'bestand'].includes(e.typ) && e.badge !== 'Storno')
    assert.deepEqual(m.map(e => [e.datum, e.titel]), [
      ['2025-08-01', 'Eröffnungsbestand'],
      ['2025-10-05', 'Zukauf Fasswein'],
      ['2025-12-01', 'Fassverkauf'],
      ['2026-01-10', 'Übertrag bei Eröffnung des Bewegungsjournals'],
      ['2026-02-01', 'Zukauf Most'],
      ['2026-03-01', 'Fassverkauf in Österreich'],
    ])
    assert.ok(m[5].details.includes('Bestand danach (Bewegungsjournal): 500 L'), m[5].details.join(' | '))
    assert.ok(!w.events.some(e => e.titel === 'Eigenverbrauch / Schwund'), 'Schwund kommt aus keller_umzuege, nicht doppelt')
    assert.ok(!w.warnungen.some(x => x.includes('weicht vom Bestand')), w.warnungen.join(' / '))   // 600 + 100 − 200 − 5 = 495 = Bestand
  })

  test('mit Journal: Hinweis, wenn der Journal-Saldo vom Bestand abweicht; Sammlung lädt den Journalbeginn einmal', async () => {
    const { buildWeinbuch } = await laden('lib/wein/weinbuch.ts')
    const w = await buildWeinbuch(datenbank(daten({ journalAb: '2026-01-10', menge: 520 })), 'A', T)
    assert.ok(w.warnungen.some(x => /Bewegungsjournal \(495 L\) weicht vom Bestand der Charge \(520 L\) ab/.test(x)), w.warnungen.join(' / '))
    const s = readFileSync(new URL('../../src/lib/behoerden/weinbuch.ts', import.meta.url), 'utf8')
    assert.match(s, /const journalBeginn = await ladeJournalBeginn\(supabase, tenantId\)/)
    assert.match(s, /buildWeinbuch\(supabase, c\.id, tenantId, \{ journalBeginn \}\)/)
  })

  test('Ende: leere Charge endet auch mit einem Fassverkauf', async () => {
    const { buildWeinbuch } = await laden('lib/wein/weinbuch.ts')
    const d = daten({ menge: 0 })
    d.weinanalysen = [{ tenant_id: T, weinausbau_id: 'A', analyse_datum: '2026-04-01', labor: 'nach dem Verkauf' }]
    const w = await buildWeinbuch(datenbank(d), 'A', T)
    assert.equal(w.abgeschlossenAm, '2026-03-01')
    assert.ok(!w.events.some(e => e.titel === 'Analyse – nach dem Verkauf'))
  })
})
