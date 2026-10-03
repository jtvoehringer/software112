// KAN-130 Etappe 3 (01.10.2026): Mostgewicht beim Zukauf (neu, bearbeiten) und Weitergabe an die Charge
//
// Aufruf:  node --experimental-strip-types --test scripts/tests/kan130-zukauf.test.mjs
//          (läuft auch über npm run test:csv)
//
// Eingabe nur über MostgewichtEingabe; die Action rechnet selbst (mostgewichtAusFormular → mostgewichtSpalten)
// und gibt Messwert samt Einheit an die Zielcharge weiter (createZukaufCharge, chargeStammdaten in updateZukauf).
// Beim Bearbeiten schreibt nur ein übermitteltes Feld; chargeStammdaten greift nur ohne Folgebuchungen.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { register } from 'node:module'

// relative Importe ohne Endung (./mostgewicht) auflösen – wie mostgewicht-eingabe.test.mjs
register('./ernte.aufloesung.mjs', import.meta.url)

const { mostgewichtAusFormular, mostgewichtSpalten, mostgewichtAusGespeichert } = await import('../../src/lib/wein/mostgewichtFormular.ts')

const quelle = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')
const fd = (felder) => {
  const f = new FormData()
  for (const [k, v] of Object.entries(felder)) f.set(k, v)
  return f
}

describe('Formularwerte → Spalten von zukauf_posten bzw. weinausbau', () => {
  test('84 °Oe → oechsle 84,0, kmw 17,09, Einheit oechsle (Akzeptanz)', () => {
    const e = mostgewichtAusFormular(fd({ mostgewicht_wert: '84', mostgewicht_einheit: 'oechsle' }), 'mostgewicht', { altesFeld: 'kmw' })
    assert.equal(e.ok, true)
    assert.equal(e.uebermittelt, true)
    assert.deepEqual(mostgewichtSpalten(e.wert, 'kmw'), { kmw: 17.09, oechsle: 84, mostgewicht_einheit: 'oechsle' })
  })
  test('leeres Feld löscht beide Werte (Rechenregel 4)', () => {
    const e = mostgewichtAusFormular(fd({ mostgewicht_wert: '', mostgewicht_einheit: 'kmw' }), 'mostgewicht', { altesFeld: 'kmw' })
    assert.equal(e.ok, true)
    assert.equal(e.uebermittelt, true)
    assert.deepEqual(mostgewichtSpalten(e.wert, 'kmw'), { kmw: null, oechsle: null, mostgewicht_einheit: 'kmw' })
  })
  test('ohne Feld (Art Wein): nicht übermittelt – Bearbeiten lässt das Gespeicherte stehen', () => {
    const e = mostgewichtAusFormular(fd({ art: 'wein' }), 'mostgewicht', { altesFeld: 'kmw' })
    assert.deepEqual(e, { ok: true, wert: null, uebermittelt: false })
  })
  test('altes Feld kmw gilt übergangsweise als °KMW', () => {
    const e = mostgewichtAusFormular(fd({ kmw: '19,5' }), 'mostgewicht', { altesFeld: 'kmw' })
    assert.equal(e.ok, true)
    assert.equal(e.wert.kmw, 19.5)
    assert.equal(e.wert.einheit, 'kmw')
  })
  test('ungültige Eingabe wird abgelehnt', () => {
    assert.equal(mostgewichtAusFormular(fd({ mostgewicht_wert: 'abc', mostgewicht_einheit: 'oechsle' }), 'mostgewicht').ok, false)
  })
  test('neue Charge beim Bearbeiten ohne Feld: gespeicherter Messwert samt Einheit, nichts neu gerechnet', () => {
    assert.deepEqual(mostgewichtAusGespeichert({ kmw: '17.09', oechsle: '84.0', einheit: 'oechsle' }), { kmw: 17.09, oechsle: 84, einheit: 'oechsle' })
    assert.equal(mostgewichtAusGespeichert({ kmw: null, oechsle: null, einheit: 'kmw' }), null)
  })
})

describe('Server Actions (Quelltext)', () => {
  const A = quelle('src/app/(dashboard)/weinhandel/zukauf/actions.ts')
  test('Formular wird über mostgewichtAusFormular gelesen, kein parseFloat auf kmw mehr', () => {
    assert.match(A, /mostgewichtAusFormular\(formData, 'mostgewicht', \{ altesFeld: 'kmw' \}\)/)
    assert.match(A, /if \(!mg\.ok\) throw new AktionsFehler\(mg\.fehler\)/)
    assert.doesNotMatch(A, /formData\.get\('kmw'\)/)
    assert.doesNotMatch(A, /kmw:\s+f\.kmw/)
  })
  test('createZukaufCharge schreibt °KMW, °Oe und Einheit in die Charge', () => {
    const fn = A.slice(A.indexOf('async function createZukaufCharge'), A.indexOf('async function chargeAendern'))
    assert.match(fn, /mostgewicht: Mostgewicht \| null/)
    assert.match(fn, /\.\.\.mostgewichtSpalten\(mostgewicht, 'kmw'\)/)
  })
  test('alle Aufrufe von createZukaufCharge geben das Mostgewicht mit', () => {
    const aufrufe = A.split('await createZukaufCharge(').slice(1)
    // KAN-193: createZukauf legt die Charge über die RPC s112_zukauf_buchen an (zukaufChargeSpalten)
    assert.equal(aufrufe.length, 2)
    // KAN-186: danach das Ursprungsland (f.landIso)
    assert.match(aufrufe[0], /^[^)]*mostgewichtCharge, f\.landIso,\s*\)/)       // updateZukauf: Gebinde gewechselt
    assert.match(aufrufe[1], /^[^)]*mostgewichtCharge, f\.landIso,\s*\)/)       // updateZukauf: nachträglich ein Gebinde
    const spalten = A.slice(A.indexOf('function zukaufChargeSpalten'), A.indexOf('export type ZukaufVerschnitt'))
    assert.match(spalten, /\.\.\.chargeStammdaten\(f\),\s*\.\.\.mostgewichtSpalten\(f\.mostgewicht, 'kmw'\)/)
  })
  test('createZukauf speichert Messwert samt Einheit in zukauf_posten', () => {
    const fn = A.slice(A.indexOf('export async function createZukauf'), A.indexOf('export async function updateZukauf'))
    assert.match(fn, /\.\.\.mostgewichtSpalten\(f\.mostgewicht, 'kmw'\)/)
  })
  test('updateZukauf schreibt das Mostgewicht nur, wenn es übermittelt wurde', () => {
    const fn = A.slice(A.indexOf('export async function updateZukauf'), A.indexOf('export async function deleteZukauf'))
    assert.match(fn, /\.\.\.\(f\.mostgewichtUebermittelt \? mostgewichtSpalten\(f\.mostgewicht, 'kmw'\) : \{\}\)/)
    assert.match(fn, /mostgewichtAusGespeichert\(\{ kmw: a\.kmw, oechsle: a\.oechsle, einheit: a\.mostgewicht_einheit \}\)/)
  })
  test('chargeStammdaten gleicht das Mostgewicht an (nur übermittelt) und nur ohne Folgebuchungen', () => {
    const fn = A.slice(A.indexOf('function chargeStammdaten'), A.indexOf('export async function createZukauf'))
    assert.match(fn, /\.\.\.\(f\.mostgewichtUebermittelt \? mostgewichtSpalten\(f\.mostgewicht, 'kmw'\) : \{\}\)/)
    const upd = A.slice(A.indexOf('export async function updateZukauf'), A.indexOf('export async function deleteZukauf'))
    const folge = upd.indexOf('if (folge.length > 0)')
    const stamm = upd.indexOf('chargeStammdaten(f)')
    assert.ok(folge > 0 && stamm > folge, 'chargeStammdaten erst im Zweig ohne Folgebuchungen')
    assert.equal(upd.split('chargeStammdaten(f)').length - 1, 1)
  })
  test('Rückbau stellt das Mostgewicht der Charge samt Einheit wieder her', () => {
    assert.match(A, /kmw: c\.kmw, oechsle: c\.oechsle, mostgewicht_einheit: c\.mostgewicht_einheit/)
    assert.match(A, /qualitaetsstufe, zusatzbezeichnung, erzeugnis, land_iso, kmw, oechsle, mostgewicht_einheit'\)/)   // KAN-186
  })
  test('Qualitätsstufe wird nicht aus dem Mostgewicht abgeleitet (Rechenregel 6)', () => {
    assert.doesNotMatch(A, /kmwZuQualitaet|qualitaetAusKmw/)
  })
})

describe('Formulare', () => {
  const NEU = quelle('src/app/(dashboard)/weinhandel/zukauf/neu/page.tsx')
  const EDIT = quelle('src/app/(dashboard)/weinhandel/zukauf/[id]/edit/ZukaufEditForm.tsx')
  const EDIT_PAGE = quelle('src/app/(dashboard)/weinhandel/zukauf/[id]/edit/page.tsx')
  test('beide Formulare nutzen MostgewichtEingabe statt eines °KMW-Felds', () => {
    for (const f of [NEU, EDIT]) {
      assert.match(f, /import MostgewichtEingabe from '@\/components\/wein\/MostgewichtEingabe'/)
      assert.doesNotMatch(f, /aria-label="°KMW"/)
      assert.doesNotMatch(f, /fd\.set\('kmw'/)
      assert.match(f, /for \(const feld of \['mostgewicht_wert', 'mostgewicht_einheit', 'zusatzbezeichnung', 'erzeugnis'\]\)/)   // KAN-186
    }
    // KAN-80 Nachtrag (02.10.2026): Mostgewicht ist bei Trauben und Most Pflicht
    assert.match(NEU, /<MostgewichtEingabe name="mostgewicht" required \/>/)
    assert.match(EDIT, /<MostgewichtEingabe name="mostgewicht" startwert=\{initial\.mostgewicht\} required \/>/)
  })
  test('Bearbeiten lädt °KMW, °Oe und Einheit als Startwert', () => {
    assert.match(EDIT_PAGE, /kmw, oechsle, mostgewicht_einheit/)
    assert.match(EDIT_PAGE, /einheit: z\.mostgewicht_einheit/)
  })
})
