// KAN-98 (04.10.2026): Prüfnummernantrag – Pflichtangaben vor dem Einreichen, Formatprüfung der Prüfnummer,
// Vorbelegung des Antragsformulars aus der Charge (Farbe, KMW, Qualität, Herkunft), ein offener Antrag je Charge.
//
// Aufruf:  npm run -s test:csv   bzw. node --experimental-strip-types --test scripts/tests/kan98-pn-antrag.test.mjs
// kellerbuch-hooks.mjs löst '@/…' auf (pruefnummernantrag.ts importiert über den Alias).

import { register } from 'node:module'
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

register('./kellerbuch-hooks.mjs', import.meta.url)

const wf = await import('../../src/lib/dac/workflow.ts')
const pna = await import('../../src/lib/behoerden/pruefnummernantrag.ts')

const WURZEL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const quelle = rel => readFileSync(path.join(WURZEL, rel), 'utf8').replace(/\r\n/g, '\n')

const DAC = { bezeichnung: 'GV Ried Hohenberg 2025', weinausbau_id: 'c1', jahrgang: 2025, rebsorte: 'Grüner Veltliner', menge_liter: 1500 }
const FORMULAR = { betriebsnummer: '1234567', name: 'Musterhof', farbe: 'Weiß', lesegradation: '19,5 °KMW', einreichmenge: '1500', qualitaetsstufe: 'Qualitätswein', weinbaugebiet: 'Kamptal' }

describe('KAN-98 Pflichtangaben vor dem Einreichen', () => {
  test('vollständig: keine Fehlliste', () => {
    assert.deepEqual(wf.pnPflichtFehlend(DAC, FORMULAR, true), [])
  })
  test('Formular nicht gespeichert: Hinweis statt Formularfelder', () => {
    assert.deepEqual(wf.pnPflichtFehlend(DAC, FORMULAR, false), ['Antragsformular (Prüfnummernantrag) speichern'])
  })
  test('fehlende Angaben werden alle gelistet', () => {
    const f = wf.pnPflichtFehlend({ bezeichnung: ' ', weinausbau_id: null, jahrgang: null, rebsorte: '', menge_liter: 0 },
      { ...FORMULAR, farbe: '', lesegradation: '', weinbaugebiet: ' ' }, true)
    assert.deepEqual(f, ['Bezeichnung', 'Kellerbuch-Charge', 'Jahrgang', 'Rebsorte', 'Menge (Liter)', 'Farbe', 'Mostgewicht (Lesegradation)', 'Weinbaugebiet (Herkunft)'])
  })
})

describe('KAN-98 Format der Prüfnummer (nur Warnung)', () => {
  test('übliche Schreibweisen ohne Hinweis', () => {
    for (const n of ['N 10716/26', 'N10716/26', 'b 1/24', '', null]) assert.equal(wf.pnFormatHinweis(n), null, String(n))
  })
  test('abweichend: Hinweis', () => {
    for (const n of ['10716-26', 'N 10716/2026', 'N 107 16/26']) assert.match(wf.pnFormatHinweis(n), /entspricht nicht dem üblichen Format/, n)
  })
})

describe('KAN-98 Vorbelegung des Antragsformulars aus der Charge', () => {
  const CFG = { betrieb_name: 'Musterhof', betrieb_betriebsnummer: '1234567', betrieb_ort: 'Langenlois' }
  const CHARGE = { qualitaetsstufe: 'qualitaetswein', zusatzbezeichnung: null, weinart: 'rot', kmw: 19.46, herkunft_code: 'NOE' }
  test('Farbe, Lesegradation, Qualität und Herkunft aus der Charge', () => {
    const f = pna.pnaVorbelegung({ jahrgang: 2025, rebsorte: 'Zweigelt', menge_liter: 1500, dac_region: 'sonstiges' }, CFG, CHARGE)
    assert.equal(f.farbe, 'Rot')
    assert.equal(f.lesegradation, '19,5 °KMW')
    assert.equal(f.qualitaetsstufe, 'Qualitätswein')
    assert.notEqual(f.weinbaugebiet, 'sonstiges')
    assert.notEqual(f.weinbaugebiet, '')
  })
  test('DAC-Antrag: Qualitätsstufe/Weinbaugebiet bleiben die DAC-Region', () => {
    const f = pna.pnaVorbelegung({ jahrgang: 2025, rebsorte: 'Zweigelt', menge_liter: 1500, dac_region: 'carnuntum' }, CFG, CHARGE)
    assert.equal(f.qualitaetsstufe, 'carnuntum')
    assert.equal(f.weinbaugebiet, 'carnuntum')
  })
  test('ohne Charge wie bisher (Weiß, leere Lesegradation)', () => {
    const f = pna.pnaVorbelegung({ jahrgang: 2025, rebsorte: null, menge_liter: null, dac_region: 'sonstiges' }, CFG, null)
    assert.equal(f.farbe, 'Weiß')
    assert.equal(f.lesegradation, '')
  })
  test('farbeAusWeinart', () => {
    assert.equal(pna.farbeAusWeinart('weiss'), 'Weiß')
    assert.equal(pna.farbeAusWeinart('rose'), 'Rosé')
    assert.equal(pna.farbeAusWeinart('unbekannt'), null)
  })
})

describe('KAN-98 Verdrahtung', () => {
  const a = quelle('src/app/(dashboard)/dac/actions.ts')
  test('Einreichen prüft die Pflichtangaben vor der RPC', () => {
    const f = a.slice(a.indexOf('export async function setzeDacStatus'), a.indexOf('/** KAN-98: je Charge höchstens'))
    assert.match(f, /if \(eingabe\.status === 'eingereicht'\) \{[\s\S]*?pnPflichtFehlend\(/)
    assert.ok(f.indexOf('pnPflichtFehlend(') < f.indexOf("'s112_pruefnummernantrag_status_setzen'"))
  })
  test('höchstens ein offener Antrag je Charge (Anlegen, Chargenwechsel, Kopie)', () => {
    assert.equal((a.match(/await keinOffenerAntrag\(/g) ?? []).length, 3)
    assert.match(quelle('src/app/(dashboard)/dac/neu/page.tsx'), /Je Charge ist nur ein offener Antrag möglich/)
  })
  test('Charge-Seite: Badge und Link zum offenen Antrag', () => {
    const c = quelle('src/app/(dashboard)/kellerbuch/weinausbau/[id]/page.tsx')
    assert.match(c, /PN \{pnZugeteilt\.pruefnummer\}/)
    assert.match(c, /href=\{pnOffen \? `\/dac\/\$\{pnOffen\.id\}` : `\/dac\/neu\?charge=\$\{weinausbau\.id\}`\}/)
  })
  test('Neuer Antrag: Sorten absteigend aus der Zusammensetzung (KAN-76)', () => {
    assert.match(quelle('src/app/(dashboard)/dac/neu/page.tsx'), /sortenAnteile\(\(await ladeZusammensetzungCharge\(supabase, tenantId, charge\.id\)\)\.anteile\)/)
  })
})
