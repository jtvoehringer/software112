// KAN-130 Etappe 3 (02.10.2026): Mostgewicht beim Eröffnungsbestand – Gebinde, Bearbeiten und Anfangsbestand im Datenimport
//
// Aufruf:  node --experimental-strip-types --test scripts/tests/kan130-eroeffnung.test.mjs
//          (läuft auch über npm run test:csv)
//
// Eingabe nur über MostgewichtEingabe (°KMW oder °Oe), die Server Action rechnet selbst (mostgewichtAusFormular,
// mostgewichtSpalten). Beim Bearbeiten wird nur geschrieben, wenn das Formular das Mostgewicht mitschickt.
// Die Qualitätsstufe bleibt, wie gewählt (Rechenregel 6).

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { register } from 'node:module'

// Auflösung der Importe ohne Endung (wie scripts/tests/mostgewicht-eingabe.test.mjs)
register('./ernte.aufloesung.mjs', import.meta.url)
const { mostgewichtAusFormular, mostgewichtSpalten } = await import('../../src/lib/wein/mostgewichtFormular.ts')

const quelle = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')
const formular = (felder) => {
  const fd = new FormData()
  for (const [k, v] of Object.entries(felder)) fd.set(k, v)
  return fd
}
const lesen = (fd) => mostgewichtAusFormular(fd, 'mostgewicht', { altesFeld: 'kmw' })

describe('Formularwerte → Spalten von weinausbau', () => {
  test('84 °Oe → oechsle 84, kmw 17,09, Einheit oechsle (Akzeptanzkriterium)', () => {
    const e = lesen(formular({ mostgewicht_wert: '84', mostgewicht_einheit: 'oechsle' }))
    assert.equal(e.ok, true)
    assert.equal(e.uebermittelt, true)
    assert.deepEqual(mostgewichtSpalten(e.wert, 'kmw'), { kmw: 17.09, oechsle: 84, mostgewicht_einheit: 'oechsle' })
  })
  test('°KMW mit Dezimalkomma bleibt Messwert in °KMW', () => {
    const e = lesen(formular({ mostgewicht_wert: '17,4', mostgewicht_einheit: 'kmw' }))
    assert.equal(e.ok, true)
    const s = mostgewichtSpalten(e.wert, 'kmw')
    assert.equal(s.kmw, 17.4)
    assert.equal(s.mostgewicht_einheit, 'kmw')
    assert.ok(s.oechsle > 80 && s.oechsle < 90)
  })
  test('leer = beide Spalten NULL (Rechenregel 4)', () => {
    const e = lesen(formular({ mostgewicht_wert: '', mostgewicht_einheit: 'oechsle' }))
    assert.equal(e.ok, true)
    assert.equal(e.uebermittelt, true)
    assert.deepEqual(mostgewichtSpalten(e.wert, 'kmw'), { kmw: null, oechsle: null, mostgewicht_einheit: 'kmw' })
  })
  test('Formular ohne Mostgewicht → nicht übermittelt (Bearbeiten lässt den gespeicherten Wert stehen)', () => {
    const e = lesen(formular({ name: 'Rotgipfler' }))
    assert.equal(e.ok, true)
    assert.equal(e.uebermittelt, false)
  })
  test('altes Feld kmw (z. B. aus einem offenen alten Tab) gilt als °KMW-Messung', () => {
    const e = lesen(formular({ kmw: '17.5' }))
    assert.equal(e.ok, true)
    assert.equal(e.wert.kmw, 17.5)
    assert.equal(e.wert.einheit, 'kmw')
  })
  test('ungültige Eingabe → Fehlertext statt Speichern', () => {
    assert.equal(lesen(formular({ mostgewicht_wert: 'abc', mostgewicht_einheit: 'oechsle' })).ok, false)
    assert.equal(lesen(formular({ mostgewicht_wert: '84', mostgewicht_einheit: 'grad' })).ok, false)
  })
})

describe('Server Actions (gebinde-actions.ts)', () => {
  const A = quelle('src/app/(dashboard)/kellerbuch/gebinde-actions.ts')
  const anlegen = A.slice(A.indexOf('async function insertEroeffnungsbestand'), A.indexOf('export async function createEroeffnungsbestand('))
  const bearbeiten = A.slice(A.indexOf('async function eroeffnungsbestandSpeichern'), A.indexOf('export async function updateEroeffnungsbestand'))
  test('kein rohes parseFloat des kmw-Felds mehr', () => {
    assert.doesNotMatch(A, /kmw:\s+parseFloat\(dezimal\(formData\.get\('kmw'\)/)
  })
  test('Anlegen: Mostgewicht geprüft vor der Transaktionsnummer, alle drei Spalten geschrieben', () => {
    const pruefung = anlegen.indexOf("mostgewichtAusFormular(formData, 'mostgewicht', { altesFeld: 'kmw' })")
    assert.ok(pruefung > 0)
    assert.ok(pruefung < anlegen.indexOf('get_next_transaktionsnr'))
    assert.match(anlegen, /if \(!mostgewicht\.ok\) return mostgewicht\.fehler/)
    assert.match(anlegen, /\.\.\.mostgewichtSpalten\(mostgewicht\.wert, 'kmw'\)/)
  })
  test('Bearbeiten: nur bei uebermittelt, Fehler als AktionsFehler', () => {
    assert.match(bearbeiten, /if \(!mostgewicht\.ok\) throw new AktionsFehler\(mostgewicht\.fehler\)/)
    assert.match(bearbeiten, /\.\.\.\(mostgewicht\.uebermittelt \? mostgewichtSpalten\(mostgewicht\.wert, 'kmw'\) : \{\}\)/)
  })
  test('Qualitätsstufe wird nicht aus dem Mostgewicht abgeleitet (Rechenregel 6)', () => {
    assert.doesNotMatch(anlegen + bearbeiten, /kmwZuQualitaet|qualitaetAusKmw/)
  })
})

describe('Formulare', () => {
  const formulare = {
    'Gebinde › Eröffnungsbestand': 'src/app/(dashboard)/kellerbuch/gebinde/page.tsx',
    'Eröffnungsbestand bearbeiten': 'src/app/(dashboard)/kellerbuch/eroeffnungsbestand/[id]/edit/page.tsx',
    'Datenimport › Anfangsbestand': 'src/app/(dashboard)/admin/import/ImportClient.tsx',
  }
  for (const [titel, pfad] of Object.entries(formulare)) {
    test(`${titel}: MostgewichtEingabe statt kmw-Feld`, () => {
      const q = quelle(pfad)
      assert.match(q, /<MostgewichtEingabe name="mostgewicht"/)
      assert.doesNotMatch(q, /name="kmw"/)
    })
  }
  test('Bearbeiten öffnet mit gespeichertem Messwert und Einheit', () => {
    const q = quelle(formulare['Eröffnungsbestand bearbeiten'])
    assert.match(q, /select\('id, name, jahrgang, kmw, oechsle, mostgewicht_einheit,/)
    assert.match(q, /startwert=\{\{ kmw: eintrag\.kmw, oechsle: eintrag\.oechsle, einheit: eintrag\.mostgewicht_einheit \}\}/)
  })
  test('Liste zeigt das Mostgewicht in der bevorzugten Einheit', () => {
    const q = quelle(formulare['Gebinde › Eröffnungsbestand'])
    assert.match(q, /select\('id, name, jahrgang, kmw, oechsle, mostgewicht_einheit,/)
    assert.match(q, /<MostgewichtAnzeige wert=\{\{ kmw: e\.kmw, oechsle: e\.oechsle, einheit: e\.mostgewicht_einheit \}\} nurBevorzugt \/>/)
  })
})

test('SQL-Importskript: Hinweis auf die Einheit im Kopf', () => {
  const kopf = quelle('supabase/import_gebeshuber_chargen.sql').split(/\r?\n/).slice(0, 8).join('\n')
  assert.match(kopf, /KAN-130/)
  assert.match(kopf, /mostgewicht_einheit \(Standard 'kmw'/)
})
