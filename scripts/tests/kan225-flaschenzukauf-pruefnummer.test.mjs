// KAN-225 (07.10.2026) – Flaschenzukauf: Prüfnummernpflicht ab Qualitätswein, keine Pflicht darunter (Landwein/Wein).
// Vorgabe Jörgen (Kommentare KAN-41/KAN-199): Wein und Landwein haben keine Prüfnummer; ab Qualitätswein Pflicht. Dieselbe
// Regel beim Anlegen und – neu – beim Bearbeiten (die Prüfnummer bleibt änderbar, darf ab Qualitätswein aber nicht leer
// werden), dazu Beschriftung/Pflichtfeld in beiden Formularen.
//
// Aufruf:  npm run -s test:csv   (alle scripts/tests/*.test.mjs)

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { register } from 'node:module'

register('./ernte.aufloesung.mjs', import.meta.url)

const w = await import('../../src/lib/zukauf/ware.ts')
const { pruefnummerLabel } = await import('../../src/lib/zukauf/pruefnummerLabel.ts')
const quelle = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const Z = 'src/app/(dashboard)/weinhandel/zukauf'

describe('KAN-225: Regel', () => {
  test('Pflicht ab Qualitätswein (inkl. Prädikat, DAC, Reserve, Sekt g.U.), nicht für Wein, Landwein, Perlwein', () => {
    const pf = (qualitaetsstufe, extra = {}) => w.flaschenPruefnummerPflicht({ qualitaetsstufe, ...extra })
    for (const q of ['qualitaetswein', 'kabinett', 'spaetlese', 'ausbruch', 'trockenbeerenauslese', 'dac']) assert.equal(pf(q), true, q)
    for (const q of ['wein', 'landwein', 'perlwein', null]) assert.equal(pf(q), false, String(q))
    assert.equal(pf('qualitaetswein', { zusatzbezeichnung: 'reserve' }), true)
    assert.equal(pf('wein', { erzeugnis: 'SEKTGU' }), true)
  })
  test('Fehlermeldung nur bei Pflicht ohne Nummer; Leerzeichen zählen nicht', () => {
    assert.match(w.flaschenPruefnummerFehler({ qualitaetsstufe: 'qualitaetswein' }, '  '), /Wein und Landwein brauchen keine/)
    assert.equal(w.flaschenPruefnummerFehler({ qualitaetsstufe: 'qualitaetswein' }, 'N 1234/26'), null)
    assert.equal(w.flaschenPruefnummerFehler({ qualitaetsstufe: 'landwein' }, null), null)
    assert.equal(w.flaschenPruefnummerFehler({ qualitaetsstufe: 'wein' }, ''), null)
  })
  test('Beschriftung: Pflicht (*), keine (Wein/Landwein), Fasswein optional', () => {
    assert.equal(pruefnummerLabel('flaschen', 'qualitaetswein'), 'Staatl. Prüfnummer des Erzeugers *')
    assert.equal(pruefnummerLabel('flaschen', 'landwein'), 'Staatl. Prüfnummer des Erzeugers (keine – Wein/Landwein)')
    assert.equal(pruefnummerLabel('flaschen', ''), 'Staatl. Prüfnummer des Erzeugers (Pflicht ab Qualitätswein)')
    assert.equal(pruefnummerLabel('flaschen', 'wein', { erzeugnis: 'SEKTGU' }), 'Staatl. Prüfnummer des Erzeugers *')
    assert.equal(pruefnummerLabel('wein', 'qualitaetswein'), 'Staatl. Prüfnummer (optional)')
  })
})

describe('KAN-225: Verdrahtung', () => {
  test('Bearbeiten: Prüfnummer gegen die gespeicherten Merkmale geprüft', () => {
    assert.match(quelle(`${Z}/actions.ts`), /merkmaleFest = true\n\s+\/\/ KAN-225[^\n]*\n\s+const pnFehler = flaschenPruefnummerFehler\(\{ qualitaetsstufe: a\.qualitaetsstufe/)
  })
  test('Formulare: Beschriftung und Pflichtfeld je Qualitätsstufe, in Neuanlage und Bearbeiten gleich', () => {
    for (const f of [`${Z}/neu/page.tsx`, `${Z}/[id]/edit/ZukaufEditForm.tsx`]) {
      const s = quelle(f)
      assert.match(s, /\{pruefnummerLabel\(art, qualitaet/, f)
      assert.match(s, /required=\{istFlaschenArt\(art\) && flaschenPruefnummerPflicht\(/, f)
    }
  })
})
