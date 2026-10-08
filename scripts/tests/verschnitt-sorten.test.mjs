// Sorten-, Jahrgangs- und Herkunftsanteile eines Verschnitts (lib/kellerbuch/verschnittSorten.ts, KAN-93/KAN-110) –
// STABILITAET.md, Lücke 5 (41 % Branches; KAN-250, 09.10.2026). Grundlage für Sortenangabe, Jahrgang und Herkunft der
// Bezeichnung: Anteile aus dem Rechenkern (anteilig an der verschnittenen Menge), sonst Rebsorte/Jahrgang der Charge.
//
// Aufruf:  npm run -s test:csv   (Node ≥ 22.15 wegen module.registerHooks)

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { DOPPEL, hooksRegistrieren, laden, nurMitHooks, hooksMoeglich } from './buchung-attrappe.mjs'

const modul = code => 'data:text/javascript,' + encodeURIComponent(code)
// Rechenkern ersetzt: Zusammensetzung je Charge aus globalThis.__komp (Fehler, wenn als Error hinterlegt)
DOPPEL['@/lib/wein/blendKomposition'] = modul(`export const ladeZusammensetzungCharge = async (_s, _t, id) => {
  const k = globalThis.__komp?.[id]
  if (k instanceof Error) throw k
  return { anteile: k ?? [] }
}`)
hooksRegistrieren()
const vs = hooksMoeglich ? await laden('lib/kellerbuch/verschnittSorten.ts') : null

const T = 't1'
const als = (liste) => Object.fromEntries(liste.map(x => [x.wert, Math.round(x.liter * 1000) / 1000]))
const charge = (id, x = {}) => ({ id, menge_liter: 1000, rebsorte: 'Grüner Veltliner', jahrgang: 2025, herkunft_code: 'NOE', ...x })

describe('verschnittGruppen', nurMitHooks, () => {
  test('Anteile aus dem Rechenkern, anteilig an der verschnittenen Menge (Faktor Liter/Bestand)', async () => {
    globalThis.__komp = { A: [{ rebsorte: 'Grüner Veltliner', jahrgang: 2025, liter: 600 }, { rebsorte: 'Riesling', jahrgang: 2024, liter: 400 }] }
    const r = await vs.verschnittGruppen(null, T, [{ charge: charge('A'), liter: 500 }])
    assert.deepEqual(als(r.sorten), { 'Grüner Veltliner': 300, Riesling: 200 })
    assert.deepEqual(als(r.jahrgaenge), { 2025: 300, 2024: 200 })
  })

  test('Kern unvollständig: der Rest zählt mit Rebsorte und Jahrgang der Charge', async () => {
    globalThis.__komp = { A: [{ rebsorte: 'Riesling', jahrgang: 2024, liter: 250 }] }   // nur 250 von 1000 L bekannt
    const r = await vs.verschnittGruppen(null, T, [{ charge: charge('A'), liter: 400 }])
    assert.deepEqual(als(r.sorten), { Riesling: 100, 'Grüner Veltliner': 300 })
    assert.deepEqual(als(r.jahrgaenge), { 2024: 100, 2025: 300 })
  })

  test('Kern leer oder Ladefehler: alles mit den Angaben der Charge – nie schlechter als vorher', async () => {
    globalThis.__komp = { A: [], B: new Error('Netz') }
    const r = await vs.verschnittGruppen(null, T, [
      { charge: charge('A'), liter: 100 },
      { charge: charge('B', { rebsorte: 'Zweigelt', jahrgang: 2023 }), liter: 50 },
    ])
    assert.deepEqual(als(r.sorten), { 'Grüner Veltliner': 100, Zweigelt: 50 })
    assert.deepEqual(als(r.jahrgaenge), { 2025: 100, 2023: 50 })
  })

  test('ohne Rebsorte bzw. Jahrgang: „unbekannt“; Teile ohne Charge oder mit 0 L zählen nicht', async () => {
    globalThis.__komp = { A: [{ rebsorte: '  ', jahrgang: null, liter: 1000 }] }
    const r = await vs.verschnittGruppen(null, T, [
      { charge: charge('A', { rebsorte: null, jahrgang: null }), liter: 10 },
      { charge: null, liter: 99 },
      { charge: charge('B'), liter: 0 },
    ])
    assert.deepEqual(als(r.sorten), { unbekannt: 10 })
    assert.deepEqual(als(r.jahrgaenge), { unbekannt: 10 })
  })

  test('Herkunft: je Herkunft-Code, Ried und Ort zusammengefasst; ohne Ursprung Ried und Ort unbekannt', async () => {
    globalThis.__komp = { A: [
      { rebsorte: 'GV', jahrgang: 2025, liter: 500, ried: 'Kirchberg', katastralgemeinde: null },
      { rebsorte: 'GV', jahrgang: 2025, liter: 300, ried: 'Kirchberg', katastralgemeinde: null },
    ] }
    const r = await vs.verschnittGruppen(null, T, [{ charge: charge('A'), liter: 1000 }])
    const h = r.herkunft.map(t => [t.code, t.ried, t.ort, Math.round(t.liter)])
    assert.deepEqual(h, [['NOE', 'Kirchberg', null, 800], ['NOE', null, null, 200]])
  })
})
