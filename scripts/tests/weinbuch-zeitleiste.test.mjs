// Zeitleiste der Charge (buildWeinbuch, lib/wein/weinbuch.ts) – Umzüge, Schwund und Kellerbehandlungen
// (STABILITAET.md, Lücke 5: weinbuch.ts unter 70 % Branches; KAN-250, 09.10.2026):
//  - Umzug: Ziel-Gebinde aus der Ziel-Zeile derselben Buchung (umzug_batch_id), Liter brutto vor netto, Schwund-Vermerk
//  - Schwund: eigener Eintrag mit Gebinde, Menge schwund_liter vor brutto vor netto
//  - Kellerbehandlung: Typname vor Snapshot vor „Kellerbehandlung“, Menge mit Einheit, Ist-Volumen; storniert gekennzeichnet
//
// Aufruf:  npm run -s test:csv   (Node ≥ 22.15 wegen module.registerHooks)

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { hooksRegistrieren, laden, nurMitHooks, datenbank } from './buchung-attrappe.mjs'

hooksRegistrieren()
const T = 't1'

const charge = { id: 'A', tenant_id: T, name: 'GV Ried Kirchberg', jahrgang: 2025, rebsorte: 'Grüner Veltliner', qualitaetsstufe: null, status: 'ausbau', menge_liter: 900, behaelter_id: null, behaelter: null, ist_eroeffnungsbestand: false, created_at: '2025-09-20T08:00:00Z' }
const umzug = (x) => ({ tenant_id: T, von_weinausbau_id: 'A', zeilen_typ: 'quelle', umzug_typ: 'umzug', notizen: null, storniert_am: null, von_behaelter: { name: 'Tank 1' }, nach_behaelter: null, ...x })

function daten() {
  return {
    weinausbau: [charge],
    tenant_einstellungen: [{ tenant_id: T, journal_ab: null }],
    keller_umzuege: [
      // Umzug Tank 1 → Tank 4: das Ziel steht nur an der Ziel-Zeile derselben Buchung
      umzug({ id: 'u1', datum: '2025-11-02', umzug_batch_id: 'b1', menge_liter: 495, brutto_liter: 500, schwund_liter: 5 }),
      { id: 'u1z', tenant_id: T, von_weinausbau_id: 'X', zeilen_typ: 'ziel', umzug_batch_id: 'b1', datum: '2025-11-02', nach_behaelter: { name: 'Tank 4' } },
      // Umzug ohne bekanntes Ziel
      umzug({ id: 'u2', datum: '2025-12-01', umzug_batch_id: 'b2', menge_liter: 100, brutto_liter: null, schwund_liter: null }),
      // Schwund-Buchung
      umzug({ id: 'u3', datum: '2026-01-15', umzug_typ: 'schwund', umzug_batch_id: null, schwund_liter: 3.5, nach_behaelter: { name: 'Tank 4' }, notizen: 'Verdunstung' }),
      umzug({ id: 'u4', datum: '2026-02-01', umzug_typ: 'schwund', umzug_batch_id: null, schwund_liter: null, brutto_liter: null, menge_liter: 2, nach_behaelter: null }),
    ],
    keller_behandlungen: [
      { id: 'k1', tenant_id: T, weinausbau_id: 'A', datum: '2025-10-10', typ: { name: 'Schwefelung' }, typ_name_snapshot: 'Alt', menge: 25, einheit: 'g', volumen_liter_ist: 900, notizen: 'nach Gärung', storniert_am: null },
      { id: 'k2', tenant_id: T, weinausbau_id: 'A', datum: '2025-10-12', typ: null, typ_name_snapshot: 'Bentonit', menge: null, einheit: null, volumen_liter_ist: null, notizen: null, storniert_am: '2025-10-13T08:00:00Z', storno_grund: 'Doppelt erfasst', storniert_von_name: 'Karin' },
      { id: 'k3', tenant_id: T, weinausbau_id: 'A', datum: '2025-10-14', typ: null, typ_name_snapshot: null, menge: 1, einheit: null, volumen_liter_ist: null, notizen: null, storniert_am: null },
    ],
  }
}

describe('Zeitleiste der Charge: Umzug, Schwund, Kellerbehandlung', nurMitHooks, () => {
  test('Umzug: Ziel über die Buchung, brutto vor netto, Schwund-Vermerk; ohne Ziel „?“', async () => {
    const { buildWeinbuch } = await laden('lib/wein/weinbuch.ts')
    const w = await buildWeinbuch(datenbank(daten()), 'A', T)
    const um = w.events.filter(e => e.typ === 'umzug')
    assert.deepEqual(um.map(e => [e.datum, e.titel, e.details]), [
      ['2025-11-02', 'Tank 1 → Tank 4', ['500 L', 'Schwund: 5 L']],
      ['2025-12-01', 'Tank 1 → ?', ['100 L']],
    ])
  })

  test('Schwund: eigener Eintrag mit Gebinde und Notiz; Menge schwund vor brutto vor netto; ohne Gebinde nur „Schwund“', async () => {
    const { buildWeinbuch } = await laden('lib/wein/weinbuch.ts')
    const w = await buildWeinbuch(datenbank(daten()), 'A', T)
    const sw = w.events.filter(e => e.typ === 'schwund')
    assert.deepEqual(sw.map(e => [e.datum, e.titel, e.details]), [
      ['2026-01-15', 'Schwund – Tank 4', ['3,5 L Schwund', 'Verdunstung']],
      ['2026-02-01', 'Schwund', ['2 L Schwund']],
    ])
  })

  test('Kellerbehandlung: Typname vor Snapshot vor Ersatz, Menge mit Einheit, Ist-Volumen, Storno gekennzeichnet', async () => {
    const { buildWeinbuch } = await laden('lib/wein/weinbuch.ts')
    const w = await buildWeinbuch(datenbank(daten()), 'A', T)
    const kb = w.events.filter(e => e.typ === 'kellerbehandlung')
    assert.equal(kb[0].titel, 'Schwefelung')
    assert.deepEqual(kb[0].details, ['25 g', 'Volumen Ist: 900 L', 'nach Gärung'])
    assert.equal(kb.find(e => e.titel.endsWith('Bentonit') && e.badge === 'storniert')?.datum, '2025-10-12')
    assert.ok(kb.some(e => e.badge === 'Storno' && e.details.includes('Grund: Doppelt erfasst')), JSON.stringify(kb.map(e => [e.titel, e.badge])))
    // ohne Typ und ohne Snapshot: Ersatzname; Menge ohne Einheit wird nicht angezeigt
    assert.deepEqual(kb.find(e => e.datum === '2025-10-14')?.titel, 'Kellerbehandlung')
    assert.deepEqual(kb.find(e => e.datum === '2025-10-14')?.details, [])
  })
})
