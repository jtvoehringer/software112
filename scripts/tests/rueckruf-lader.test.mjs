// STABILITAET.md „Bibliotheken unter 70 %“: Lader der Rückruf-Liste (lib/behoerden/rueckruf.ts, ladeRueckruf; KAN-109/115).
// Die reine Rechnung (rueckrufZeilen, produktZeilen) prüfen kan109-rueckruf und kan115-traubensaft; hier der Weg durch
// die Datenbank: Start (Pressung, Charge, Füllung), Vorwärtsgraph über Umzüge und Verschnitte (stornierte und fremde
// nicht), Füllungen direkt und über fuellung_chargen, Verkäufe/Tankverkäufe/Export (stornierte Rechnungen nicht),
// Verarbeitungen zu Sonstigen Produkten samt deren Verkäufen, Abgleich-Warnung und Fehler je Abfrage.
//
// Aufruf:  npm run -s test:csv   (Node ≥ 22.15 wegen module.registerHooks)

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { hooksRegistrieren, laden, nurMitHooks, hooksMoeglich, datenbank, hatFilter } from './buchung-attrappe.mjs'

hooksRegistrieren()
const rr = hooksMoeglich ? await laden('lib/behoerden/rueckruf.ts') : null

const T = 't1'
const firma = (name, x = {}) => ({ name, strasse: 'Hauptstraße 1', plz: '2352', ort: 'Gumpoldskirchen', land: 'AT', betrieb_nr: null, ...x })
const posten = (datum, x = {}) => ({ datum, rechnungsnummer: null, storniert: false, partner_daten: null, kontakt: null, firma: null, ...x })

function daten() {
  return {
    pressungen: [{ id: 'P1', tenant_id: T, datum: '2025-09-20', weinbezeichnung: 'Grüner Veltliner' }],
    pressung_behaelter: [
      { id: 'pb1', pressung_id: 'P1', weinausbau_id: 'C1', storniert_am: null },
      { id: 'pb2', pressung_id: 'P1', weinausbau_id: 'C9', storniert_am: '2025-09-21' },
    ],
    keller_umzuege: [
      { id: 'u1', tenant_id: T, von_weinausbau_id: 'C1', nach_weinausbau_id: 'C2', storniert_am: null },
      { id: 'u2', tenant_id: T, von_weinausbau_id: 'C2', nach_weinausbau_id: 'C3', storniert_am: '2025-10-02' },
      { id: 'u3', tenant_id: T, von_weinausbau_id: 'C1', nach_weinausbau_id: 'C1', storniert_am: null },   // Umzug in sich selbst
      { id: 'u4', tenant_id: 'anderer', von_weinausbau_id: 'C1', nach_weinausbau_id: 'CX', storniert_am: null },
    ],
    verschneidung_quellen: [
      { id: 'vq1', quell_weinausbau_id: 'C2', verschneidung: { tenant_id: T, ziel_weinausbau_id: 'C4', storniert_am: null } },
      { id: 'vq2', quell_weinausbau_id: 'C2', verschneidung: { tenant_id: T, ziel_weinausbau_id: 'C8', storniert_am: '2025-11-01' } },
    ],
    weinausbau: ['C1', 'C2', 'C3', 'C4', 'C8', 'C9'].map(id => ({ id, tenant_id: T, name: { C1: 'GV Most', C2: 'GV Tank 2', C4: 'Cuvée Hausberg' }[id] ?? id, chargennummer: id === 'C4' ? 'C-4' : null })),
    fuellung_chargen: [{ id: 'fc1', tenant_id: T, fuellung_id: 'F2', weinausbau_id: 'C2' }],
    fuellungen: [
      { id: 'F1', tenant_id: T, weinausbau_id: 'C4', name: 'Cuvée 2025', chargennummer: 'L1', datum: '2025-11-20', anzahl_flaschen: 100, bestand_flaschen: '50', flaschengroesse_ml: 750, storniert_am: null },
      { id: 'F2', tenant_id: T, weinausbau_id: null, name: 'GV 2025', chargennummer: 'L2', datum: '2025-11-21', anzahl_flaschen: 60, bestand_flaschen: 0, flaschengroesse_ml: 750, storniert_am: null },
      { id: 'F3', tenant_id: T, weinausbau_id: 'C4', name: 'storniert', chargennummer: 'L3', anzahl_flaschen: 10, bestand_flaschen: 10, storniert_am: '2025-11-22' },
    ],
    verkauf_positionen: [
      { id: 'v1', tenant_id: T, fuellung_id: 'F1', weinausbau_id: null, menge: '30', einheit: 'Fl', verkaufsposten: posten('2025-12-01', { rechnungsnummer: 'R-1', firma: firma('Gastro GmbH') }) },
      { id: 'v2', tenant_id: T, fuellung_id: 'F1', weinausbau_id: null, menge: 20, einheit: 'Fl', verkaufsposten: posten('2025-12-02', { storniert: true, firma: firma('Storniert KG') }) },
      { id: 'v3', tenant_id: T, fuellung_id: 'F1', weinausbau_id: null, menge: 10, einheit: 'Fl', verkaufsposten: posten('2025-12-05') },
      { id: 'v4', tenant_id: T, fuellung_id: 'F1', weinausbau_id: null, menge: 5, einheit: 'Fl', verkaufsposten: posten('2025-12-24') },
      { id: 'v5', tenant_id: T, fuellung_id: null, weinausbau_id: 'C2', menge: 200, einheit: 'L', verkaufsposten: posten('2025-10-15', { rechnungsnummer: 'R-T', firma: firma('Weinhandel X', { betrieb_nr: '7654321' }) }) },
      { id: 'v6', tenant_id: T, sonstige_artikel_id: 'A1', menge: 12, einheit: 'Fl', verkaufsposten: posten('2025-10-05', { firma: firma('Hofladen') }) },
      { id: 'v7', tenant_id: T, sonstige_artikel_id: 'A1', menge: 99, einheit: 'Fl', verkaufsposten: posten('2025-09-01', { firma: firma('Vor der Verarbeitung') }) },
      { id: 'vf', tenant_id: 'anderer', fuellung_id: 'F1', menge: 1000, verkaufsposten: posten('2025-12-01', { firma: firma('Fremd') }) },
    ],
    exportauftrag_positionen: [
      { id: 'x1', fullung_id: 'F2', menge: '60', einheit: 'Fl', auftrag: { tenant_id: T, datum: '2026-01-10', referenz: 'EX-1', storniert_am: null, partner_daten: null, kontakt: null, firma: firma('Import Ltd', { land: 'CN', plz: null, ort: 'Shanghai', strasse: null }) } },
      { id: 'x2', fullung_id: 'F2', menge: 5, einheit: 'Fl', auftrag: { tenant_id: T, datum: '2026-01-11', referenz: 'EX-2', storniert_am: '2026-01-12', firma: firma('Storno Ltd') } },
    ],
    keller_verarbeitungen: [
      { id: 'kv1', tenant_id: T, weinausbau_id: 'C2', datum: '2025-10-01', menge_liter: '50', zweck: 'traubensaft', storniert_am: null },
      { id: 'kv2', tenant_id: T, weinausbau_id: 'C2', datum: '2025-10-03', menge_liter: 5, zweck: 'essig', storniert_am: '2025-10-04' },
    ],
    sonstige_artikel_bewegungen: [
      { id: 'z1', tenant_id: T, keller_verarbeitung_id: 'kv1', art: 'verarbeitung', menge: 40, storno_von_id: null, artikel: { id: 'A1', name: 'Traubensaft', einheit: 'Fl' } },
    ],
  }
}

const kurz = z => [z.art, z.produkt, z.abnehmer, z.menge, z.einheit]

describe('Rückruf-Liste laden (ladeRueckruf)', nurMitHooks, () => {
  test('ab Pressung: Graph über Umzug und Verschnitt, alle Abgänge mit Abnehmer, Abgleich und Warnungen', async () => {
    const db = datenbank(daten())
    const r = await rr.ladeRueckruf(db, T, { art: 'pressung', id: 'P1' })
    assert.deepEqual(r.start, { art: 'pressung', name: 'Pressung Grüner Veltliner 20.09.2025' })
    assert.deepEqual(r.chargen.map(c => c.id).sort(), ['C1', 'C2', 'C4'], 'nicht: stornierte Mostzeile, stornierter Umzug/Verschnitt, fremder Betrieb')
    const zeilen = r.zeilen.map(kurz)
    assert.deepEqual(zeilen.filter(z => z[0] === 'Verkauf'), [['Verkauf', 'Cuvée 2025', 'Gastro GmbH', 30, 'Fl']])
    assert.deepEqual(zeilen.filter(z => z[0] === 'Endverbraucher (summiert)'), [['Endverbraucher (summiert)', 'Cuvée 2025', 'Endverbraucher', 15, 'Fl']])
    assert.equal(r.zeilen.find(z => z.art === 'Endverbraucher (summiert)' && z.los === 'L1').datum, '2025-12-05 – 2025-12-24')
    assert.deepEqual(zeilen.filter(z => z[0] === 'Tankverkauf'), [['Tankverkauf', 'GV Tank 2', 'Weinhandel X', 200, 'L']])
    assert.equal(r.zeilen.find(z => z.art === 'Tankverkauf').betriebNr, '7654321')
    assert.deepEqual(zeilen.filter(z => z[0] === 'Export'), [['Export', 'GV 2025', 'Import Ltd', 60, 'Fl']])
    assert.equal(r.zeilen.find(z => z.art === 'Export').adresse, 'Shanghai, CN')
    assert.deepEqual(zeilen.filter(z => z[0] === 'Verarbeitung'), [['Verarbeitung', 'Traubensaft (aus GV Tank 2)', 'Eigener Betrieb', 40, 'Fl']])
    assert.deepEqual(zeilen.filter(z => z[0] === 'Verkauf Produkt'), [['Verkauf Produkt', 'Traubensaft', 'Hofladen', 12, 'Fl']])
    assert.ok(!zeilen.some(z => /Storniert KG|Storno Ltd|Fremd|Vor der Verarbeitung/.test(z[2])))
    assert.deepEqual(r.abgleich.map(a => [a.los, a.abgefuellt, a.verkauft, a.exportiert, a.bestand, a.differenz]), [['L1', 100, 45, 0, 50, 5], ['L2', 60, 0, 60, 0, 0]])
    assert.ok(r.warnungen.some(w => /^Cuvée 2025 \(Los L1\): abgefüllt 100, verkauft 45, exportiert 0, Bestand 50 – Differenz 5/.test(w)))
    assert.ok(r.warnungen.some(w => /Sonstige Produkte .* kein Los/.test(w)))
    assert.ok(!r.warnungen.some(w => /GV 2025/.test(w)), 'stimmige Füllung ohne Warnung')
    for (const tab of ['keller_umzuege', 'weinausbau', 'fuellung_chargen', 'fuellungen', 'verkauf_positionen', 'keller_verarbeitungen', 'sonstige_artikel_bewegungen']) {
      assert.ok(db.aufrufe.filter(a => a.tabelle === tab).every(a => hatFilter(a, 'eq', 'tenant_id', T)), tab)
    }
    assert.ok(db.aufrufe.filter(a => a.tabelle === 'exportauftrag_positionen').every(a => hatFilter(a, 'eq', 'auftrag.tenant_id', T)))
  })

  test('ab Charge bzw. Füllung: nur der Graph ab dort; Füllung bringt ihre Charge mit', async () => {
    const c = await rr.ladeRueckruf(datenbank(daten()), T, { art: 'charge', id: 'C2' })
    assert.equal(c.start.name, 'GV Tank 2')
    assert.deepEqual(c.chargen.map(x => x.id).sort(), ['C2', 'C4'])
    const f = await rr.ladeRueckruf(datenbank(daten()), T, { art: 'fuellung', id: 'F1' })
    assert.equal(f.start.name, 'Cuvée 2025 (Los L1)')
    assert.deepEqual(f.chargen.map(x => x.id), ['C4'])
    assert.deepEqual(f.abgleich.map(a => a.los), ['L1'], 'stornierte Füllung F3 derselben Charge fehlt')
    assert.ok(!f.zeilen.some(z => z.art === 'Verarbeitung' || z.art === 'Tankverkauf'))
  })

  test('Start nicht im Betrieb → null', async () => {
    const d = daten()
    d.pressungen.push({ id: 'PF', tenant_id: 'anderer', datum: null })
    for (const start of [{ art: 'pressung', id: 'PF' }, { art: 'charge', id: 'gibt-es-nicht' }, { art: 'fuellung', id: 'gibt-es-nicht' }]) {
      assert.equal(await rr.ladeRueckruf(datenbank(d), T, start), null, start.art)
    }
  })

  test('Datenbankfehler je Abfrage werfen mit Klartext (keine Teilliste)', async () => {
    const faelle = [
      // Regression (Sweep 67): ein Fehler beim Laden des Starts hieß bisher „nicht gefunden“ (null)
      ['pressungen', 1, 'Pressung', { art: 'pressung', id: 'P1' }],
      ['weinausbau', 1, 'Charge', { art: 'charge', id: 'C1' }],
      ['fuellungen', 1, 'Füllung', { art: 'fuellung', id: 'F1' }],
      ['pressung_behaelter', 1, 'Mostzeilen der Pressung', { art: 'pressung', id: 'P1' }],
      ['fuellung_chargen', 1, 'Chargen der Füllung', { art: 'fuellung', id: 'F1' }],
      ['keller_umzuege', 1, 'Umzüge'], ['verschneidung_quellen', 1, 'Verschnitte'], ['weinausbau', 2, 'Chargen'],
      ['fuellung_chargen', 1, 'Füllungen der Chargen'], ['fuellungen', 1, 'Füllungen'], ['fuellungen', 2, 'Füllungen'],
      ['verkauf_positionen', 1, 'Verkäufe'], ['verkauf_positionen', 2, 'Tankverkäufe'], ['exportauftrag_positionen', 1, 'Export'],
      ['keller_verarbeitungen', 1, 'Verarbeitungen'], ['sonstige_artikel_bewegungen', 1, 'Lagerzugänge der Verarbeitungen'],
      ['verkauf_positionen', 3, 'Verkäufe der Sonstigen Produkte'],
    ]
    for (const [tab, nr, was, start = { art: 'charge', id: 'C1' }] of faelle) {
      let n = 0
      const db = datenbank(daten(), { vorher: e => (e.tabelle === tab && e.art === 'select' && ++n === nr ? { error: { message: 'kaputt' } } : null) })
      await assert.rejects(rr.ladeRueckruf(db, T, start), new RegExp(`Rückruf-Liste: ${was} konnte nicht geladen werden \\(kaputt\\)`), `${tab} #${nr}`)
    }
  })
})
