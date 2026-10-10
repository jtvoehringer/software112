// Sweep 107 (10.10.2026): Fehler von Server Actions kommen an.
// Befund 1: Monatsabschluss, UVA berechnen bzw. als übermittelt markieren, Dauerauftrag anlegen/deaktivieren, E&A-Kategorie
//   anlegen und die Kontoabstimmung verwarfen das Ergebnis ({ error }) – „Keine Berechtigung“, „bereits übermittelt
//   (gesperrt)“ oder „USt-Satz ungültig“ verschwanden still. Jetzt ergebnisPruefen() bzw. Auswertung; Wächter check-ergebnis.
// Befund 2: 134 Fehler-Rückgaben gaben die Rohmeldung der Datenbank in Cast- bzw. Template-Schreibweise weiter
//   ((error as R).message, `…: ${err.message}`) – check-fehlertext erkannte das nicht. Jetzt dbFehlerText().
//
// Aufruf:  npm run -s test:csv

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { ergebnisPruefen } from '../../src/lib/fehler.ts'

const HIER = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(HIER, '..', '..')
const require = createRequire(import.meta.url)
const erg = require(path.join(HIER, '..', 'check-ergebnis.js'))
const ft = require(path.join(HIER, '..', 'check-fehlertext.js'))
const quelle = d => readFileSync(path.join(ROOT, d), 'utf8')

describe('ergebnisPruefen', () => {
  test('Erfolg wird durchgereicht', () => {
    assert.deepEqual(ergebnisPruefen({ ok: true }), { ok: true })
    assert.equal(ergebnisPruefen(undefined), undefined)
  })
  test('Fehler werden als AktionsFehler geworfen', () => {
    assert.throws(() => ergebnisPruefen({ error: 'Bereits übermittelt' }), e => e.name === 'AktionsFehler' && e.message === 'Bereits übermittelt')
    assert.throws(() => ergebnisPruefen({ ok: false, fehler: 'Keine Berechtigung' }), /Keine Berechtigung/)
    assert.throws(() => ergebnisPruefen({ ok: false }), /fehlgeschlagen/)
  })
})

describe('check-ergebnis', () => {
  const action = "'use server'\nexport async function schliesse(j) { if (!j) return { ok: false, error: 'x' }; return { ok: true } }\nexport async function ohne() { return 1 }"
  test('Actions mit Fehler-Rückgabe erkennen', () => {
    assert.deepEqual([...erg.actionsMitRueckgabe(action)], ['schliesse'])
  })
  test('verworfenes Ergebnis → Fund; ausgewertet → kein Fund', () => {
    const namen = new Set(['schliesse'])
    const z = t => erg.verworfeneAufrufe(t, namen).funde.map(f => f.zeile)
    assert.deepEqual(z('async function h() {\n  await schliesse(1)\n}'), [2])
    assert.deepEqual(z('startTransition(() => { schliesse(1) })'), [1])
    assert.deepEqual(z('const r = await schliesse(1)'), [])
    assert.deepEqual(z('ergebnisPruefen(await schliesse(1))'), [])
    assert.deepEqual(z('// ergebnis-ok: Fehler zeigt der Aufrufer über das Ereignisprotokoll\nawait schliesse(1)'), [])
  })
  test('Projekt ohne Fund; Buchhaltung prüft das Ergebnis', () => {
    assert.deepEqual(erg.pruefeWurzel(ROOT).funde, [])
    assert.match(quelle('src/app/(dashboard)/buchhaltung/monatsabschluss/page.tsx'), /ergebnisPruefen\(await schliesseEaMonat\(j, monat\)\)/)
    assert.match(quelle('src/app/(dashboard)/buchhaltung/uva/page.tsx'), /ergebnisPruefen\(await markiereUvaAlsUebermittelt\(uvaId\)\)/)
    const pkg = JSON.parse(quelle('package.json'))
    assert.match(pkg.scripts.prebuild, /check-ergebnis\.js/)
  })
})

describe('check-fehlertext: Cast- und Template-Schreibweise', () => {
  const z = t => ft.pruefeText(t).funde.map(f => f.zeile)
  test('Erkennung', () => {
    assert.deepEqual(z('  if (error) return { error: (error as R).message }'), [1])
    assert.deepEqual(z('  return NextResponse.json({ fehler: `Daten konnten nicht geladen werden: ${dataErr.message}` })'), [1])
    assert.deepEqual(z('  return { error: `Paket: ${(e as R).message}` }'), [1])
    assert.deepEqual(z('  return { error: `Stripe-Fehler: ${(err as Error).message}` }'), [])   // Stripe-Text, kein DB-Fehler
    assert.deepEqual(z('  return { error: `Daten: ${dbFehlerText(dataErr)}` }'), [])
  })
})
