// Tests zu KAN-150 F1 (01.10.2026): Bezugszähler der Stammdaten (src/lib/stammdaten/bezugText.ts) und Rückfall
// „Stattdessen deaktivieren?“ (src/lib/stammdaten/loeschDialog.ts) – ohne Datenbank.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

const b = await import('../../src/lib/stammdaten/bezugText.ts')
const d = await import('../../src/lib/stammdaten/loeschDialog.ts')

describe('bezugText – Zähler wie die Meldung der Datenbank', () => {
  test('sortiert nach Bezeichnung, Nullen fallen weg', () => {
    assert.equal(b.bezugsText({ 'Maßnahmen': 48, 'Chargen': 2, 'Pressungen': 0, 'Lese-Einträge': 1 }), '2 Chargen, 1 Lese-Einträge, 48 Maßnahmen')
    assert.equal(b.bezugsText({}), '')
  })
  test('Summe über mehrere Datensätze (Ried aus mehreren Weingärten) und hatBezug', () => {
    const s = b.bezuegeSumme([{ 'Maßnahmen': 2 }, { 'Maßnahmen': 3, 'Chargen': 1 }, {}])
    assert.deepEqual(s, { 'Maßnahmen': 5, 'Chargen': 1 })
    assert.equal(b.hatBezug(s), true)
    assert.equal(b.hatBezug({}), false)
    assert.equal(b.hatBezug({ 'Maßnahmen': 0 }), false)
  })
  test('Meldung nennt Name, Zähler und das Deaktivieren', () => {
    assert.equal(b.bezugsMeldung('Elisabeth Maier', { 'Verkäufe': 2 }, 'der Kontakt'),
      '„Elisabeth Maier“ hat noch 2 Verkäufe – der Kontakt kann nicht gelöscht, aber deaktiviert werden.')
  })
})

describe('loeschenOderDeaktivieren – Dialogablauf', () => {
  const mitDialog = async (antwort, fn) => {
    const meldungen = []
    globalThis.confirm = m => { meldungen.push(['confirm', m]); return antwort }
    globalThis.alert = m => { meldungen.push(['alert', m]) }
    try { return { ergebnis: await fn(), meldungen } } finally { delete globalThis.confirm; delete globalThis.alert }
  }
  test('ohne Bezug: gelöscht, kein Dialog, nicht deaktiviert', async () => {
    let deaktiviert = false
    const r = await mitDialog(true, () => d.loeschenOderDeaktivieren(async () => ({}), async () => { deaktiviert = true }))
    assert.equal(r.ergebnis, 'geloescht')
    assert.deepEqual(r.meldungen, [])
    assert.equal(deaktiviert, false)
  })
  test('mit Bezug und Zustimmung: deaktiviert', async () => {
    let deaktiviert = false
    const r = await mitDialog(true, () => d.loeschenOderDeaktivieren(async () => ({ error: '„X“ hat noch 2 Verkäufe', deaktivierbar: true }), async () => { deaktiviert = true; return {} }))
    assert.equal(r.ergebnis, 'deaktiviert')
    assert.equal(deaktiviert, true)
    assert.match(r.meldungen[0][1], /Stattdessen deaktivieren\?/)
  })
  test('mit Bezug, abgelehnt: nichts geändert; sonstiger Fehler: Meldung', async () => {
    let deaktiviert = false
    const r1 = await mitDialog(false, () => d.loeschenOderDeaktivieren(async () => ({ error: 'x', deaktivierbar: true }), async () => { deaktiviert = true }))
    assert.equal(r1.ergebnis, 'abgebrochen')
    assert.equal(deaktiviert, false)
    const r2 = await mitDialog(true, () => d.loeschenOderDeaktivieren(async () => ({ error: 'Keine Berechtigung' }), async () => { deaktiviert = true }))
    assert.equal(r2.ergebnis, 'fehler')
    assert.deepEqual(r2.meldungen, [['alert', 'Fehler beim Löschen: Keine Berechtigung']])
    assert.equal(deaktiviert, false)
  })
})
