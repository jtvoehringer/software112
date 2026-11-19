// KAN-429 Nebenbefund (UAT 19.11.2026, Musterhof): Weinpositionen des Exportauftrags waren nicht lesbar.
//
// 1. Formular (Anlage und Bearbeiten): Felder ohne Beschriftung in einer Zeile mit zwölf Spalten – „Menge“ war
//    abgeschnitten, die „6“ (Flaschen je Karton) und der Preis ließen sich nicht deuten; die Pfeile der Menge zählten
//    in Hundertstel-Schritten (im schmalen Feld nicht zu sehen).
// 2. Ansicht: Zahlenspalten ohne Abstand („MengeKartonsLiter“, „4,004.000,00“).
//
// Aufruf:  npm run -s test:csv
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const WURZEL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const quelle = p => readFileSync(path.join(WURZEL, p), 'utf8').replace(/\r\n/g, '\n')
const f = quelle('src/app/(dashboard)/weinexport/neu/WeinexportFormClient.tsx')
const d = quelle('src/app/(dashboard)/weinexport/[id]/WeinexportDetailClient.tsx')

describe('KAN-429 Nebenbefund: Formular der Weinpositionen', () => {
  const block = f.slice(f.indexOf('{positionen.map((pos, i) => {'), f.indexOf('{positionen.length > 0 && ('))
  test('jedes Feld hat eine sichtbare Beschriftung', () => {
    assert.ok(block.length > 0)
    for (const s of ['>Füllung</span>', '>Bezeichnung auf den Dokumenten</span>', '>Menge</span>', '>Einheit</span>',
      "{pos.einheit === 'Kiste' ? 'Flaschen je Kiste' : 'Flaschen je Karton'}", '>Preis je {je} (EUR)</span>', '>Positionswert (EUR)</span>']) assert.ok(block.includes(s), s)
  })
  test('keine Zwölftel-Spalten mehr; Einheiten ausgeschrieben, gespeichert wird weiter das Kürzel', () => {
    assert.ok(!block.includes('grid-cols-12') && !block.includes('<div className="col-span-1">'))
    assert.ok(block.includes("<option key={e} value={e}>{e === 'Fl' ? 'Flaschen' : e === 'Kiste' ? 'Kisten' : 'Hektoliter'}</option>"))
  })
  test('Menge: Pfeile in ganzen Schritten, Kommastellen bleiben erlaubt (step="any")', () => {
    assert.ok(block.includes('<input type="number" step="any" min="0" value={pos.menge}'))
  })
  test('Platzhalter und Namen für die E2E-Tests bleiben', () => {
    for (const s of ['placeholder="Menge"', 'placeholder="€/Einheit"', '<option value="">– Füllung –</option>', 'aria-label={`Flaschen je Karton ${i + 1}`}']) assert.ok(block.includes(s), s)
  })
})

describe('KAN-429 Nebenbefund: Ansicht der Weinpositionen', () => {
  const tab = d.slice(d.indexOf('<h2 className="font-semibold text-s112-text">Weinpositionen</h2>'), d.indexOf('KAN-432: Summen wie in Handelsrechnung'))
  test('Zahlenspalten haben Abstand und brechen nicht um', () => {
    assert.ok(tab.length > 0)
    assert.ok(!/<t[hd] className="p[by]-2 text-right/.test(tab), 'Zahlenspalte ohne Abstand')
    assert.equal((tab.match(/<th className="pb-2 pl-4 text-right whitespace-nowrap">/g) ?? []).length, 6)
  })
  test('Preis und Gesamt sind benannt; schmale Fenster scrollen die Tabelle', () => {
    assert.ok(tab.includes('>Preis je Einheit (EUR)</th>') && tab.includes('>Gesamt (EUR)</th>'))
    assert.ok(tab.includes('<div className="overflow-x-auto">'))
  })
})
