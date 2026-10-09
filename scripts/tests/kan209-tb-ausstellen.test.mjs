// KAN-209 (05.10.2026): Transportbescheinigung – Pflichtangaben beim Ausstellen, laufende Nummer, danach fest.
// Matrix KAN-85; DB-Test 37.
//
// Aufruf:  npm run -s test:csv  (Node ≥ 22.15 wegen module.registerHooks)

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { hooksRegistrieren, laden, nurMitHooks, hooksMoeglich } from './buchung-attrappe.mjs'

hooksRegistrieren()
const WURZEL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const quelle = rel => readFileSync(path.join(WURZEL, rel), 'utf8').replace(/\r\n/g, '\n')
const r = hooksMoeglich ? await laden('lib/behoerden/tbPflicht.ts') : null

const POS = { menge_liter: '500', art: 'Weiß', traubensorte: 'Grüner Veltliner', qualitaetsstufe: 'Qualitätswein', jahrgang: '2025', herkunft: 'Kremstal', alkohol_pct: '12,5' }
const VOLL = {
  laufende_nr: '7', jahr: '2026', datum_tag: '05', datum_monat: '10', datum_jahr: '2026', zugmaschine: 'KR-123AB',
  v_name: 'Weingut Muster', v_betriebsnummer: '1234567', e_name: 'Weinhandel X', e_betriebsnummer: '7654321', positionen: [POS],
}

describe('KAN-209 Pflichtangaben', nurMitHooks, () => {
  test('vollständig → keine Fehler; Nummer darf fehlen, wenn sie vergeben wird', () => {
    assert.deepEqual(r.tbPflichtFehler(VOLL), [])
    assert.deepEqual(r.tbPflichtFehler({ ...VOLL, laufende_nr: '' }, { nummerWirdVergeben: true }), [])
    assert.deepEqual(r.tbPflichtFehler({ ...VOLL, laufende_nr: '' }), ['Laufende Nummer'])
  })
  test('Kopf: Datum, Kennzeichen, Versender und Empfänger mit Betriebsnummer', () => {
    const f = r.tbPflichtFehler({ ...VOLL, datum_tag: '31', datum_monat: '02', zugmaschine: ' ', v_betriebsnummer: '', e_name: '', jahr: '26' })
    assert.deepEqual(f, ['Jahr (vierstellig)', 'Datum der Lieferung (TT, MM, JJJJ)', 'Kennzeichen der Zugmaschine', 'Betriebsnummer des Versenders', 'Name des Empfängers'])
  })
  test('KAN-261: Weinhändler als Versender – eigene Betriebsnummer optional, Empfänger-Nummer bleibt Pflicht', () => {
    const ohne = { ...VOLL, v_betriebsnummer: '' }
    assert.deepEqual(r.tbPflichtFehler(ohne, { versenderOhneBetriebsnummer: true }), [])
    assert.deepEqual(r.tbPflichtFehler(ohne), ['Betriebsnummer des Versenders'])
    assert.deepEqual(r.tbPflichtFehler({ ...ohne, e_betriebsnummer: '' }, { versenderOhneBetriebsnummer: true }), ['Betriebsnummer des Empfängers'])
  })
  test('Positionen: mindestens eine; je Position Menge, Farbe, Sorte, Qualität, Jahrgang, Herkunft, Alkohol bzw. Mostgewicht', () => {
    assert.deepEqual(r.tbPflichtFehler({ ...VOLL, positionen: [] }), ['mindestens eine Weinposition'])
    assert.deepEqual(r.tbPflichtFehler({ ...VOLL, positionen: [{ ...POS, menge_liter: '0', herkunft: '', alkohol_pct: '' }] }),
      ['Position 1: Menge, Herkunft, Alkohol bzw. Mostgewicht'])
    assert.deepEqual(r.tbPflichtFehler({ ...VOLL, positionen: [{ ...POS, alkohol_pct: '', kmw: 19.2 }] }), [])
  })
  test('laufende Nummer: nächste des Jahres, Doppelvergabe erkannt', () => {
    assert.equal(r.naechsteTbNummer([]), '1')
    assert.equal(r.naechsteTbNummer(['1', '3', 'x', '2', null]), '4')
    assert.equal(r.tbNummerVergeben(' 3 ', ['1', '3']), true)
    assert.equal(r.tbNummerVergeben('4', ['1', '3']), false)
    assert.equal(r.tbDatumGueltig('29', '02', '2028'), true)
    assert.equal(r.tbDatumGueltig('29', '02', '2027'), false)
  })
})

describe('KAN-209 Verdrahtung', () => {
  test('Server Actions: Speichern nach dem Ausstellen abgelehnt, Ausstellen prüft und vergibt die Nummer', () => {
    const a = quelle('src/app/(dashboard)/weinhandel/verkauf/[id]/transportbescheinigung/actions.ts')
    assert.match(a, /if \(existing\?\.status === 'ausgestellt'\) \{/)
    assert.match(a, /export async function tbAusstellen\(/)
    assert.match(a, /const fehlt = tbPflichtFehler\(daten, \{\s+nummerWirdVergeben: !nummerEingabe,\s+versenderOhneBetriebsnummer:/)   // KAN-261
    assert.match(a, /\.update\(\{ status: 'ausgestellt', aktualisiert_am:/)
    assert.match(a, /await alle<R>\(\(supabase\.from\('transportbescheinigungen'\) as any\)/)
  })
  test('Formular: Ausstellen-Knopf, Entwurf-Vermerk im Druck, fest nach dem Ausstellen; Lader liefert den Status', () => {
    const f = quelle('src/app/(dashboard)/weinhandel/verkauf/[id]/transportbescheinigung/TBFormular.tsx')
    assert.match(f, /await tbAusstellen\(verkaufspostenId, daten\)/)
    assert.match(f, /ENTWURF – noch nicht ausgestellt/)
    assert.match(f, /<fieldset disabled=\{ausgestellt\} className="contents">/)
    assert.match(f, /<GesperrtHinweis grund=\{TB_FREEZE_GRUND\}/)
    assert.match(quelle('src/lib/behoerden/transportbescheinigung.ts'), /status: tb\?\.status === 'ausgestellt' \? 'ausgestellt' : 'entwurf'/)
    assert.match(quelle('src/app/(dashboard)/weinhandel/verkauf/[id]/transportbescheinigung/page.tsx'), /ausgestellt=\{tb\.status === 'ausgestellt'\}/)
  })
  test('Migration: Freeze-Grund wie in tbPflicht.ts, nur Storno erlaubt', () => {
    const fn = readdirSync(path.join(WURZEL, 'supabase/migrations')).find(n => n.endsWith('_kan209_tb_ausstellen.sql'))
    const m = quelle(fn ? path.join('supabase/migrations', fn) : 'supabase/entwurf/kan209_tb_ausstellen.sql')
    const grund = quelle('src/lib/behoerden/tbPflicht.ts').match(/TB_FREEZE_GRUND = '([^']+)'/)[1]
    assert.match(m, new RegExp(`s112_freeze\\('${grund}'`))
    assert.match(m, /'storniert_am,storniert_von,storniert_von_name,storno_grund',\s+'ausgestellt_am'\);/)
    assert.match(m, /REVOKE EXECUTE ON FUNCTION public\.s112_tb_stempel\(\) FROM PUBLIC, anon, authenticated;/)
  })
})
