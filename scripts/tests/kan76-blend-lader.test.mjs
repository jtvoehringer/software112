// KAN-76: Lader des Blend-Protokolls (src/lib/wein/blendKomposition.ts) gegen die Supabase-Attrappe –
// Ticket-Fall „Riesling Ried Pfaffenberg“ als Datenbankzeilen: Pressung, Füllung, Umzug aus Stahltank 03 in
// eine Zwischencharge (50 L brutto, 48 L netto) und Verschnitt der Zwischencharge in die Riesling-Charge.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { hooksRegistrieren, laden, nurMitHooks, datenbank } from './buchung-attrappe.mjs'

hooksRegistrieren()

const T = 'tenant-1'
const A = 'charge-riesling', G = 'charge-gv', Z = 'charge-zwischen', F = 'fuellung-ch-2026-012'

function pressung(id, charge, liter, rebsorte, wg, gst, datum) {
  return {
    id: `pb-${id}`, menge_liter: liter, weinausbau_id: charge,
    pressung: {
      id, datum, erstellt_am: `${datum}T10:00:00Z`, tenant_id: T, jahrgang: { jahrgang: 2025 },
      pressung_weingaerten: [{ id: `pw-${id}`, trauben_kg: liter * 1.4, rebsorte, ernte_datum: datum, kmw: 18, zukauf_posten_id: null,
        weingarten: { name: wg }, grundstueck: { gst_nr: gst, katastralgemeinde: '12119' } }],
    },
  }
}

function db(extra = {}) {
  const verschnitt = { id: 'vs-1', tenant_id: T, datum: '2026-09-25', created_at: '2026-09-25T09:00:00Z', ziel_weinausbau_id: A,
    quellen: [{ id: 'vq-1', quell_weinausbau_id: Z, menge_liter: 48 }] }
  return datenbank({
    weinausbau: [
      { id: A, tenant_id: T, name: 'Riesling Ried Pfaffenberg', rebsorte: 'Riesling', jahrgang: 2025, menge_liter: 548, ist_eroeffnungsbestand: false, created_at: '2025-09-28T10:00:00Z' },
      { id: G, tenant_id: T, name: 'GV Sandgrube', rebsorte: 'Grüner Veltliner', jahrgang: 2025, menge_liter: 2950, ist_eroeffnungsbestand: false, created_at: '2025-09-20T10:00:00Z' },
      { id: Z, tenant_id: T, name: 'Zwischencharge', rebsorte: 'Grüner Veltliner', jahrgang: 2025, menge_liter: 0, ist_eroeffnungsbestand: false, created_at: '2026-09-25T08:00:00Z' },
    ],
    pressung_behaelter: [
      pressung('p-rr', A, 5000, 'Riesling', 'Pfaffenberg Riesling', '512/1', '2025-09-28'),
      pressung('p-gv', G, 3000, 'Grüner Veltliner', 'Sandgrube Grüner Veltliner', '1305/1', '2025-09-20'),
    ],
    zukauf_posten: [],
    keller_umzuege: [
      { id: 'ku-1', tenant_id: T, datum: '2026-09-25', erstellt_am: '2026-09-25T08:00:00Z', menge_liter: 48, brutto_liter: 50, schwund_liter: 2,
        umzug_typ: 'umzug', zeilen_typ: null, umzug_batch_id: null, von_weinausbau_id: G, nach_weinausbau_id: Z },
    ],
    verschneidungen: [verschnitt],
    verschneidung_quellen: [{ id: 'vq-1', quell_weinausbau_id: Z, menge_liter: 48, verschneidung: verschnitt }],
    fuellung_chargen: [
      { id: 'fc-1', tenant_id: T, fuellung_id: F, weinausbau_id: A, anteil_liter: 4500,
        fuellung: { id: F, datum: '2026-06-20', erstellt_am: '2026-06-20T10:00:00Z', aktiv: true } },
    ],
    fuellungen: [{ id: F, tenant_id: T, datum: '2026-06-20', erstellt_am: '2026-06-20T10:00:00Z', weinausbau_id: A, aktiv: true, menge_liter_gefuellt: 4500 }],
    verkauf_positionen: [],
    ...extra,
  })
}

describe('KAN-76 Lader', nurMitHooks, () => {
  test('Charge: 91,2 % Pfaffenberg Riesling GST 512/1, 8,8 % Sandgrube GV GST 1305/1 – über Umzug und Zwischencharge', async () => {
    const b = await laden('lib/wein/blendKomposition.ts')
    const z = await b.ladeZusammensetzungCharge(db(), T, A)
    assert.deepEqual(z.anteile.map(a => [a.weingarten_name, a.gst_nr, a.anteil_pct]),
      [['Pfaffenberg Riesling', '512/1', 91.2], ['Sandgrube Grüner Veltliner', '1305/1', 8.8]])
    assert.ok(!z.anteile.some(a => a.typ === 'unbekannt'))
    assert.deepEqual(z.warnungen, [])
  })

  test('Füllung CH-2026-012: 100 % Pfaffenberg Riesling (vor dem Verschnitt abgefüllt)', async () => {
    const b = await laden('lib/wein/blendKomposition.ts')
    const z = await b.ladeZusammensetzungFuellung(db(), T, F)
    assert.deepEqual(z.anteile.map(a => [a.weingarten_name, a.anteil_pct]), [['Pfaffenberg Riesling', 100]])
  })

  test('Stichtag vor dem Verschnitt; Bestand ≠ Saldo als Warnung; fremder Betrieb bleibt außen vor', async () => {
    const b = await laden('lib/wein/blendKomposition.ts')
    assert.deepEqual((await b.ladeZusammensetzungCharge(db(), T, A, '2026-09-24')).anteile.map(a => a.anteil_pct), [100])
    const abweichend = db()
    abweichend.tabellen.weinausbau[0].menge_liter = 600
    assert.match((await b.ladeZusammensetzungCharge(abweichend, T, A)).warnungen.join(' '), /Bestand laut Kellerbuch 600 L, Saldo der Bewegungen 548 L/)
    const fremd = db()
    fremd.tabellen.pressung_behaelter.push(pressung('p-fremd', A, 1000, 'Zweigelt', 'Fremd', '1/1', '2025-09-29'))
    fremd.tabellen.pressung_behaelter.at(-1).pressung.tenant_id = 'anderer-betrieb'
    assert.deepEqual((await b.ladeZusammensetzungCharge(fremd, T, A)).anteile.map(a => a.anteil_pct), [91.2, 8.8])
  })

  test('n:m-Umzug (Batch) wird als eine Bewegung aus allen Quellen in alle Ziele gerechnet', async () => {
    const b = await laden('lib/wein/blendKomposition.ts')
    const d = db({
      keller_umzuege: [
        { id: 'q1', tenant_id: T, datum: '2026-01-10', erstellt_am: '2026-01-10T08:00:00Z', menge_liter: 1000, umzug_typ: 'umzug', zeilen_typ: 'quelle', umzug_batch_id: 'b1', von_weinausbau_id: A, nach_weinausbau_id: null },
        { id: 'q2', tenant_id: T, datum: '2026-01-10', erstellt_am: '2026-01-10T08:00:00Z', menge_liter: 1000, umzug_typ: 'umzug', zeilen_typ: 'quelle', umzug_batch_id: 'b1', von_weinausbau_id: G, nach_weinausbau_id: null },
        { id: 'z1', tenant_id: T, datum: '2026-01-10', erstellt_am: '2026-01-10T08:00:01Z', menge_liter: 1980, umzug_typ: 'umzug', zeilen_typ: 'ziel', umzug_batch_id: 'b1', von_weinausbau_id: null, nach_weinausbau_id: 'cuvee' },
      ],
      verschneidungen: [], verschneidung_quellen: [], fuellung_chargen: [], fuellungen: [],
    })
    d.tabellen.weinausbau.push({ id: 'cuvee', tenant_id: T, name: 'Cuvée', menge_liter: 1980, ist_eroeffnungsbestand: false, created_at: '2026-01-10T08:00:00Z' })
    const z = await b.ladeZusammensetzungCharge(d, T, 'cuvee')
    assert.deepEqual(z.anteile.map(a => [a.rebsorte, a.anteil_pct]).sort((x, y) => x[0].localeCompare(y[0])), [['Grüner Veltliner', 50], ['Riesling', 50]])
    assert.deepEqual(z.warnungen, [])
  })
})
