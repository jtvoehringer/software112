// KAN-200/201 (06.10.2026) – Prüfnummer je Charge in Weinbuch und Rückverfolgung (pruefnummer_chargen, KAN-99)
//
// Aufruf:  npm run -s test:csv   (alle scripts/tests/*.test.mjs)
//
// 1. pruefnummerVerlauf.ts: nur Anträge mit Nummer und ohne Storno; Stand am Tag (nur Zugeteilt gilt, Ende exklusiv),
//    übernommen mit Herkunfts-Charge, erloschen mit Vorgang; Weinbuch-Ereignisse „übernommen“ und „erloschen“.
// 2. Rückverfolgung: Spalte „Prüfnummer (Tank)“ am Abfülltag, Weitergabe am Umzugstag.
// 3. Verdrahtung: Weinbuch lädt den Verlauf, Kopf und CSV, Rückverfolgung lädt Verlauf und Weitergaben.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { hooksRegistrieren, laden, nurMitHooks } from './buchung-attrappe.mjs'

hooksRegistrieren()
const quelle = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')

const zeile = (x = {}) => ({
  id: 'pc1', dac_antrag_id: 'A1', weinausbau_id: 'C2', gueltig_ab: '2026-03-01', gueltig_bis: null, ende_grund: null,
  quelle_weinausbau_id: 'C1', quelle_vorgang: 'keller_umzuege:u1', quelle: { name: 'GV Alt' },
  antrag: { pruefnummer: 'N 1234/26', status: 'genehmigt', storniert_am: null }, ...x,
})

describe('KAN-200/201: Verlauf der Prüfnummer je Charge', nurMitHooks, () => {
  test('zuPnVerlauf: ohne Nummer bzw. storniert → null', async () => {
    const { zuPnVerlauf } = await laden('lib/kellerbuch/pruefnummerVerlauf.ts')
    assert.equal(zuPnVerlauf(zeile({ antrag: { pruefnummer: '', status: 'eingereicht' } })), null)
    assert.equal(zuPnVerlauf(zeile({ antrag: { pruefnummer: 'N 1/26', status: 'genehmigt', storniert_am: '2026-03-02T10:00:00Z' } })), null)
    const v = zuPnVerlauf(zeile())
    assert.deepEqual([v.chargeId, v.pruefnummer, v.quelleChargeName, v.gueltigAb], ['C2', 'N 1234/26', 'GV Alt', '2026-03-01'])
  })
  test('pnStandAm: übernommen gilt ab dem Umzug, erlischt am Ende (exklusiv), nur Zugeteilt', async () => {
    const { zuPnVerlauf, pnStandAm, pnStandText } = await laden('lib/kellerbuch/pruefnummerVerlauf.ts')
    const v = [zuPnVerlauf(zeile({ gueltig_bis: '2026-05-10', ende_grund: 'verschnitt' }))]
    assert.equal(pnStandAm(v, '2026-02-28'), null)
    assert.equal(pnStandText(pnStandAm(v, '2026-03-01')), 'N 1234/26 (übernommen aus „GV Alt“)')
    assert.equal(pnStandText(pnStandAm(v, '2026-05-10')), 'N 1234/26 – für den Tankbestand erloschen am 10.05.2026 (Verschnitt)')
    assert.equal(pnStandText(pnStandAm(v)), 'N 1234/26 – für den Tankbestand erloschen am 10.05.2026 (Verschnitt)')
    // eigener Antrag (ohne Quelle), nur eingereicht: keine gültige Nummer
    const eigen = [zuPnVerlauf(zeile({ quelle_weinausbau_id: null, quelle_vorgang: null, quelle: null, antrag: { pruefnummer: 'N 9/26', status: 'eingereicht' } }))]
    assert.equal(pnStandAm(eigen, '2026-04-01'), null)
    const zugeteilt = [zuPnVerlauf(zeile({ quelle_weinausbau_id: null, quelle_vorgang: null, quelle: null }))]
    assert.equal(pnStandText(pnStandAm(zugeteilt)), 'N 1234/26')
  })
  test('pnVerlaufEreignisse: Übernahme am Umzugstag, Ende mit Vorgang und Flaschenhinweis', async () => {
    const { zuPnVerlauf, pnVerlaufEreignisse } = await laden('lib/kellerbuch/pruefnummerVerlauf.ts')
    const ev = pnVerlaufEreignisse([zuPnVerlauf(zeile({ gueltig_bis: '2026-05-10', ende_grund: 'verschnitt' }))])
    assert.deepEqual(ev.map(e => [e.datum, e.titel, e.badge]), [
      ['2026-03-01', 'Prüfnummer N 1234/26 übernommen aus Charge „GV Alt“', 'übernommen'],
      ['2026-05-10', 'Prüfnummer N 1234/26 für den Tankbestand erloschen', 'erloschen'],
    ])
    assert.deepEqual(ev[1].details, ['am 10.05.2026', 'durch: Verschnitt', 'bereits abgefüllte Flaschen behalten die Nummer'])
    // eigener Antrag: kein „übernommen“ (steht als DAC-Eintrag im Weinbuch); Entzug: kein Flaschenhinweis
    const entzug = pnVerlaufEreignisse([zuPnVerlauf(zeile({ quelle_vorgang: null, gueltig_bis: '2026-06-01', ende_grund: 'entzogen' }))])
    assert.equal(entzug.length, 1)
    assert.deepEqual(entzug[0].details, ['am 01.06.2026', 'durch: Prüfnummer entzogen'])
  })
  test('Rückverfolgung: Prüfnummer (Tank) am Abfülltag als letzte CSV-Spalte, Weitergabe am Umzugstag', async () => {
    const { zuPnVerlauf } = await laden('lib/kellerbuch/pruefnummerVerlauf.ts')
    const rueck = await laden('lib/behoerden/rueckverfolgung.ts')
    const { csvText } = await laden('lib/csv/index.ts')
    const kette = {
      weinausbau: { name: 'GV Neu', jahrgang: 2025 }, pressungen: [], lesen: [], analysen: [], umzuege: [],
      pnVerlauf: [zuPnVerlauf(zeile({ gueltig_bis: '2026-05-10', ende_grund: 'verschnitt' }))],
      pnWeitergaben: [{ datum: '2026-04-02', pruefnummer: 'N 1234/26', zielCharge: 'GV Teil' }],
    }
    const ketten = [{ fuellung: { id: 'f1', name: 'GV', datum: '2026-04-15' }, zuordnung: 'direkt', chargen: [{ weinausbauId: 'C2', anteilLiter: null, kette }] }]
    const z = rueck.rueckverfolgungZeilen(ketten)
    assert.equal(z[0].pruefnummerTank, 'N 1234/26 (übernommen aus „GV Alt“)')
    const zeilen = csvText(z, rueck.SPALTEN_RUECKVERFOLGUNG).split('\r\n')
    assert.match(zeilen[0], /;Prüfnummer \(Tank\)$/)
    assert.match(zeilen[1], /;N 1234\/26 \(übernommen aus „GV Alt“\)$/)
    assert.equal(rueck.pnWeitergabeText(kette, '2026-04-02'), 'Prüfnummer N 1234/26 weitergegeben an „GV Teil“')
    assert.equal(rueck.pnWeitergabeText(kette, '2026-04-03'), null)
    // Abfüllung nach dem Verschnitt: erloschen
    assert.match(rueck.pruefnummerTank(kette, '2026-05-11'), /erloschen am 10\.05\.2026 \(Verschnitt\)/)
  })
})

describe('KAN-200/201: Verdrahtung', () => {
  test('Weinbuch: Verlauf geladen, Ereignisse als DAC-Eintrag, Kopf und CSV-Spalte', () => {
    const w = quelle('src/lib/wein/weinbuch.ts')
    assert.match(w, /const verlauf = \(await ladePnVerlauf\(supabase, tenantId, \[id\]\)\)\.get\(id\) \?\? \[\]/)
    assert.match(w, /for \(const e of pnVerlaufEreignisse\(verlauf\)\) events\.push\(\{ \.\.\.e, typ: 'dac' \}\)/)
    assert.match(quelle('src/lib/behoerden/weinbuch.ts'), /kopf: 'Prüfnummer der Charge \(aktuell\)'/)
    assert.match(quelle('src/app/(dashboard)/kellerbuch/weinausbau/[id]/buch/page.tsx'), /Prüfnummer: \{wa\.pruefnummer\}/)
  })
  test('Rückverfolgung: Verlauf und Weitergaben je Charge, ohne stornierte Anträge', () => {
    const r = quelle('src/lib/behoerden/rueckverfolgung.ts')
    assert.match(r, /ladePnVerlauf\(supabase, tenantId, \[wId\]\)/)
    assert.match(r, /\.eq\('quelle_weinausbau_id', wId\)/)
    assert.match(r, /!\(w\.antrag as R \| null\)\?\.storniert_am/)
    assert.match(quelle('src/app/(dashboard)/kellerbuch/rueckverfolgung/page.tsx'), /<InfoRow label="Prüfnummer \(Tank\)" value=\{pruefnummerTank\(pn, abfuelldatum\)\} \/>/)
  })
})
