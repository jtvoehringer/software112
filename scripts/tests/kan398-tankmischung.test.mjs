// KAN-398 (UAT): Tankmischung – mehrere Pflanzenschutzmittel in einer Spritzbrühe. Je Mittel eine Maßnahme mit
// gemeinsamer tankmischung_id; Eingabe/Prüfung der weiteren Mittel, gemeinsame Felder beim Bearbeiten, Gruppierung und
// gemeinsamer Storno in der Liste (lib/behandlungen/tankmischung.ts, behandlungen/actions.ts, Formular, Liste).
//
// Aufruf:  npm run -s test:csv  (Node ≥ 22.15 wegen module.registerHooks)

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { hooksRegistrieren, laden, nurMitHooks, hooksMoeglich } from './buchung-attrappe.mjs'

hooksRegistrieren()
const WURZEL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const quelle = rel => readFileSync(path.join(WURZEL, rel), 'utf8').replace(/\r\n/g, '\n')
const tm = hooksMoeglich ? await laden('lib/behandlungen/tankmischung.ts') : null

/** FormData-Attrappe mit wiederholten Feldern */
const fd = (zeilen) => ({
  getAll: name => zeilen.map(z => z[name] ?? ''),
})
const zeile = (psm, aufwand, einheit = 'kg_ha') => ({ weitere_psm_id: psm, weitere_aufwandmenge: aufwand, weitere_aufwandmenge_einheit: einheit })

describe('KAN-398 weitere Mittel', nurMitHooks, () => {
  test('aus dem Formular: Dezimalkomma, leere Zeilen zählen nicht', () => {
    assert.deepEqual(tm.weitereMittelAus(fd([zeile('b', '0,6'), zeile('', ''), zeile('c', '2', 'l_ha')])), [
      { psmId: 'b', aufwand: 0.6, einheit: 'kg_ha' },
      { psmId: 'c', aufwand: 2, einheit: 'l_ha' },
    ])
    assert.deepEqual(tm.weitereMittelAus(fd([])), [])
  })
  test('Prüfung: nur Spritzung, erstes Mittel, Mittel und Aufwand je Zeile, kein Mittel doppelt', () => {
    const w = (psmId, aufwand = 1, einheit = 'kg_ha') => ({ psmId, aufwand, einheit })
    assert.equal(tm.tankmischungFehler('spritzung', 'a', []), null)
    assert.equal(tm.tankmischungFehler('spritzung', 'a', [w('b'), w('c')]), null)
    assert.match(tm.tankmischungFehler('duengung', 'a', [w('b')]), /nur bei einer Spritzung/)
    assert.match(tm.tankmischungFehler('spritzung', null, [w('b')]), /erste Mittel/)
    assert.match(tm.tankmischungFehler('spritzung', 'a', [w('')]), /Mittel 2 .*wählen/)
    assert.match(tm.tankmischungFehler('spritzung', 'a', [w('b', null)]), /Mittel 2 .*Aufwandmenge angeben/)
    assert.match(tm.tankmischungFehler('spritzung', 'a', [w('b', 0)]), /größer als 0/)
    assert.match(tm.tankmischungFehler('spritzung', 'a', [w('b', NaN)]), /größer als 0/)
    assert.match(tm.tankmischungFehler('spritzung', 'a', [w('b', 1, 'stk')]), /nicht zulässig/)
    assert.match(tm.tankmischungFehler('spritzung', 'a', [w('a')]), /schon in der Mischung/)
    assert.match(tm.tankmischungFehler('spritzung', 'a', [w('b'), w('b')]), /Mittel 3 .*schon in der Mischung/)
    const viele = Array.from({ length: tm.WEITERE_MITTEL_MAX + 1 }, (_, i) => w(`m${i}`))
    assert.match(tm.tankmischungFehler('spritzung', 'a', viele), /Höchstens/)
  })
})

describe('KAN-398 Bearbeiten und Liste', nurMitHooks, () => {
  test('„Erntefrei ab“ der anderen Mittel wandert mit dem Datum', () => {
    assert.equal(tm.erntefreiVerschoben('2026-07-15', '2026-07-01', '2026-07-03'), '2026-07-17')
    assert.equal(tm.erntefreiVerschoben('2026-03-01', '2026-02-27', '2026-02-26'), '2026-02-28')
    assert.equal(tm.erntefreiVerschoben('2026-07-15', '2026-07-01', '2026-07-01'), '2026-07-15')
    assert.equal(tm.erntefreiVerschoben(null, '2026-07-01', '2026-07-03'), null)
  })
  test('gemeinsame Felder: Anwendung ja, Mittel/Mengen/Rieden nein', () => {
    for (const sp of ['datum', 'uhrzeit_von', 'witterung', 'bbch_stadium', 'durchgefuehrt_von']) assert.ok(tm.GEMEINSAME_SPALTEN.includes(sp), sp)
    for (const sp of ['psm_id', 'aufwandmenge', 'menge_gesamt', 'wasseraufwand_l_ha', 'ernte_fruehesteins']) assert.ok(!tm.GEMEINSAME_SPALTEN.includes(sp), sp)
  })
  test('Gruppierung: Mittel einer Mischung hintereinander, Kennzeichen n/m', () => {
    const l = [{ id: '1', tankmischung_id: 'T' }, { id: '2', tankmischung_id: null }, { id: '3', tankmischung_id: 'T' }, { id: '4', tankmischung_id: 'U' }]
    assert.deepEqual(tm.mischungZusammen(l).map(b => b.id), ['1', '3', '2', '4'])
    const info = tm.mischungsInfo(l)
    assert.deepEqual(info.get('1'), { anzahl: 2, nr: 1, erste: true })
    assert.deepEqual(info.get('3'), { anzahl: 2, nr: 2, erste: false })
    assert.equal(info.get('2'), undefined)
    assert.equal(info.get('4'), undefined, 'eine „Mischung“ mit nur einem Mittel ist keine')
  })
})

test('Server Action: alle Mittel in einem Insert, je Mittel geprüft, Grundstücke für jedes Mittel, gemeinsamer Storno', () => {
  const a = quelle('src/app/(dashboard)/behandlungen/actions.ts')
  assert.match(a, /const tmFehler = tankmischungFehler\(art, psmId, weitere\)/)
  assert.match(a, /for \(const w of weitere\) await pruefeBioSperre\(supabase, tenantId, w\.psmId, null\)/)
  assert.match(a, /mengeGesamt: mengen\.werte\.menge_gesamt, mengeEinheit: mengen\.werte\.menge_einheit,\n\s+wasserLHa: mengen\.werte\.wasseraufwand_l_ha/)
  assert.match(a, /\.insert\(zeilen\.length === 1 \? hauptZeile : zeilen\)\n\s+\.select\('id, psm_id'\)/)
  assert.match(a, /if \(angelegt\.length !== zeilen\.length\) throw new AktionsFehler\(NICHT_GESPEICHERT\)/)
  assert.match(a, /const junctionRows = angelegt\.flatMap\(b =>/)
  assert.match(a, /export async function stornoTankmischung\(tankmischungId: string, grund: string\)/)
  assert.match(a, /\.eq\('tenant_id', tenantId\)\.eq\('tankmischung_id', tankmischungId\)\.is\('storniert_am', null\)/)
  // Bearbeiten übernimmt nur die gemeinsamen Spalten für die übrigen Mittel
  assert.match(a, /GEMEINSAME_SPALTEN\.filter\(sp => sp in neu\)/)
})

test('Formular, Liste und Bearbeiten-Seite verdrahtet', () => {
  const f = quelle('src/app/(dashboard)/behandlungen/neu/NeueBehandlungForm.tsx')
  assert.match(f, /<WeitereMittel psm=\{psm\} erstesPsmId=\{selectedPsmId\}/)
  assert.match(f, /const tmFehler = tankmischungFehler\(art, selectedPsmId \|\| null, weitereMittelAus\(fd\)\)/)
  assert.match(f, /const bioSperre {2}= BIO_SPERRE\.has\(bioStatus\) && \(mittelNichtOeko \|\| weitereNichtOeko\)/)
  const w = quelle('src/app/(dashboard)/behandlungen/neu/WeitereMittel.tsx')
  for (const feld of ['WEITERE_FELDER.psm', 'WEITERE_FELDER.aufwand', 'WEITERE_FELDER.einheit']) assert.ok(w.includes(`name={${feld}}`), feld)
  const c = quelle('src/app/(dashboard)/behandlungen/BehandlungenClient.tsx')
  assert.match(c, /mischungZusammen\(g\)/)
  assert.match(c, /stornoTankmischung\(b\.tankmischung_id!, grund\)/)
  const p = quelle('src/app/(dashboard)/behandlungen/page.tsx')
  assert.match(p, /storno_grund, tankmischung_id, weingarten_id/)
  const e = quelle('src/app/(dashboard)/behandlungen/[id]/edit/page.tsx')
  assert.match(e, /Teil einer Tankmischung mit/)
})

test('Migration: Spalte, nur Spritzung, Index; Schema-Export kennt die Spalte', () => {
  // eingespielt: supabase/migrations/<version>_kan398_tankmischung.sql; vorher der (nicht eingecheckte) Entwurf
  const mig = path.join(WURZEL, 'supabase', 'migrations')
  const kandidaten = [
    ...(existsSync(mig) ? readdirSync(mig).filter(n => n.endsWith('_kan398_tankmischung.sql')).map(n => path.join(mig, n)) : []),
    path.join(WURZEL, 'supabase', 'entwurf', 'kan398_tankmischung.sql'),
  ]
  const datei = kandidaten.find(p => existsSync(p))
  assert.ok(datei, 'Migration kan398_tankmischung fehlt')
  const sql = readFileSync(datei, 'utf8')
  assert.match(sql, /ADD COLUMN tankmischung_id uuid/)
  assert.match(sql, /CHECK \(tankmischung_id IS NULL OR art = 'spritzung'\)/)
  assert.match(sql, /CREATE INDEX behandlungen_tankmischung_idx ON public\.behandlungen \(tenant_id, tankmischung_id\)/)
  const schema = JSON.parse(readFileSync(path.join(WURZEL, 'scripts', 'schema.json'), 'utf8'))
  assert.ok(schema.behandlungen.includes('tankmischung_id'))
})
