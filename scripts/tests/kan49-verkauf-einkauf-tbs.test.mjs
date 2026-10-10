// KAN-49 (10.10.2026): BKI-Blätter „Verkauf im Zeitraum“, „Einkauf im Zeitraum“ (Journal, gefiltert auf VK_* bzw. ZK_*,
// optional je Qualitätsstufe) und „TBS-Aufstellung“ (ausgestellte Transportbescheinigungen + TBS-Nummern der Lieferanten).
// Annahmen V1–V3 im Kopf von src/lib/behoerden/bki-verkauf-einkauf.ts.
//
// Aufruf:  npm run -s test:csv

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { hooksRegistrieren, laden, nurMitHooks, hooksMoeglich } from './buchung-attrappe.mjs'

hooksRegistrieren()
const ve = hooksMoeglich ? await laden('lib/behoerden/bki-verkauf-einkauf.ts') : null
const bs = hooksMoeglich ? await laden('lib/behoerden/bki-schnittstelle.ts') : null
const reg = hooksMoeglich ? await laden('lib/behoerden/register.ts') : null
const quelle = p => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')

describe('Verkauf und Einkauf im Zeitraum', nurMitHooks, () => {
  const z = (code, stufe = 'QUW', liter = -100) => ({ buchungsartBsm: code, qualitaet: stufe, buchungLiter: liter, buchungStk: null, kaeufer: 'K', verkaeufer: 'V' })

  test('Filter auf die Buchungsarten der Richtung und optional die Qualitätsstufe', () => {
    const alle = [z('VK_FL_AT'), z('VK_FA_AU', 'LDW'), z('ZK_FASS', 'QUW', 500), z('ERNTE', 'QUW', 800), z(null)]
    assert.deepEqual(ve.filterBewegungen(alle, ve.VERKAUF_CODES, null).map(x => x.buchungsartBsm), ['VK_FL_AT', 'VK_FA_AU'])
    assert.deepEqual(ve.filterBewegungen(alle, ve.VERKAUF_CODES, 'LDW').map(x => x.buchungsartBsm), ['VK_FA_AU'])
    assert.deepEqual(ve.filterBewegungen(alle, ve.EINKAUF_CODES, null).map(x => x.buchungsartBsm), ['ZK_FASS'])
  })

  test('Spalten wie die Spezifikation: IST-Menge als Betrag, nur die Partei der Richtung (V1)', () => {
    const v = ve.SPALTEN_VERKAUF_IM_ZEITRAUM.map(s => s.kopf), e = ve.SPALTEN_EINKAUF_IM_ZEITRAUM.map(s => s.kopf)
    for (const k of ['IST-Menge in St.', 'IST-Menge in lt.', 'Buchungsart BSM', 'Buchungsart']) { assert.ok(v.includes(k), k); assert.ok(e.includes(k), k) }
    assert.ok(v.includes('Betrieb Käufer') && v.includes('Adresse Käufer') && !v.includes('Name Verkäufer') && !v.includes('Anfangsmenge in lt.'))
    assert.ok(e.includes('Betrieb Verkäufer') && e.includes('Adresse Verkäufer') && !e.includes('Name Käufer'))
    const ist = ve.SPALTEN_VERKAUF_IM_ZEITRAUM.find(s => s.kopf === 'IST-Menge in lt.')
    assert.equal(ist.wert({ ...z('VK_FL_AT'), buchungLiter: -37.5 }), 37.5)
  })

  test('Parameter: Zeitraum und Stufe prüfen', () => {
    assert.deepEqual(ve.zeitraumStufeAus(new URLSearchParams('von=2026-01-01&bis=2026-09-30&stufe=quw')), { von: '2026-01-01', bis: '2026-09-30', stufe: 'QUW' })
    assert.match(ve.zeitraumStufeAus(new URLSearchParams('von=2026-10-01&bis=2026-09-30')).fehler, /Zeitraum ist ungültig/)
    assert.match(ve.zeitraumStufeAus(new URLSearchParams('stufe=Qualitätswein')).fehler, /Unbekannte Qualitätsstufe/)
  })
})

describe('TBS-Aufstellung', nurMitHooks, () => {
  test('bis zu drei Sorten als BKI-Kürzel (V2)', () => {
    assert.deepEqual(ve.dreiSorten('Grüner Veltliner (GV), Welschriesling'), ['GV', 'WR', null])
    assert.deepEqual(ve.dreiSorten(''), [null, null, null])
    assert.deepEqual(ve.dreiSorten('Zweigelt / Blaufränkisch / Merlot / Syrah'), ['ZW', 'BF', 'ME'])
  })

  test('Ausgang aus der Transportbescheinigung, Eingang aus dem Zukauf mit TBS-Nummer des Lieferanten', () => {
    const a = ve.tbsAusgang({ lieferdatum: '2026-10-02', verkaufsdatum: '2026-10-01', rechnungsnummer: 'R-17', laufendeNr: '0042', jahr: '2026', traubensorte: 'Grüner Veltliner (GV)', jahrgang: '2025', menge: 1200, einheit: 'l', qualitaetsstufe: 'qualitaetswein', vName: 'Weingut A', vVorname: '', eName: 'Kellerei', eVorname: 'Max' })
    assert.deepEqual([a.richtung, a.datum, a.beleg, a.tbsNummer, a.sorten[0], a.qualitaet, a.versender, a.empfaenger], ['Ausgang', '2026-10-02', 'R-17', '0042/2026', 'GV', 'QUW', 'Weingut A', 'Kellerei Max'])
    const e = ve.tbsEingang({ datum: '2026-09-15', eingangsrechnungsnummer: 'ER-3', tbs_nummer_lieferant: '777', tbs_jahr_lieferant: 2026, rebsorte: 'Zweigelt', jahrgang: 2026, menge: 800, einheit: 'kg', qualitaetsstufe: null, lieferant_firma: { name: 'Winzer B' } }, 'Weingut Test')
    assert.deepEqual([e.richtung, e.tbsNummer, e.sorten[0], e.menge, e.versender, e.empfaenger], ['Eingang', '777/2026', 'ZW', 800, 'Winzer B', 'Weingut Test'])
  })
})

describe('Gesamtexport und Verdrahtung', nurMitHooks, () => {
  test('alle 15 Blätter umgesetzt – nichts fehlt mehr', () => {
    assert.deepEqual(bs.BKI_BLAETTER.filter(b => !b.meldung).map(b => b.blatt), [])
    for (const id of ['bki-verkauf', 'bki-einkauf', 'bki-tbs']) {
      assert.ok(reg.meldungFinden(id), id)
      assert.equal(bs.parameterFuer(id, { von: '2026-08-01', bis: '2026-09-30', stichtag: '2026-09-30' }).toString(), 'von=2026-08-01&bis=2026-09-30')
    }
  })

  test('Seite mit Marker und CSV, Reiter', () => {
    const p = quelle('src/app/(dashboard)/kellerbuch/bki-verkehr/page.tsx')
    assert.match(p, /^\/\/ behoerdenmeldung: bki-verkauf, bki-einkauf, bki-tbs\n/)
    for (const id of ['bki-verkauf', 'bki-einkauf', 'bki-tbs']) assert.match(p, new RegExp(`csvPfad\\('${id}', param\\)`))
    assert.match(quelle('src/app/(dashboard)/kellerbuch/_behoerden/LagerTabs.tsx'), /href: '\/kellerbuch\/bki-verkehr'/)
  })
})
