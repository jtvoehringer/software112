// KAN-397 (Epic KAN-391): Zukauf – „Gesamtpreis (€)“ und „Preis / Einheit (€)“ sind gekoppelte Eingaben wie °KMW/°Oe;
// das zuletzt bearbeitete Feld zählt, das andere wird gerechnet (lib/zukauf/preis.ts, beide Formulare).
//
// Aufruf:  npm run -s test:csv

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
// @ts-expect-error TS5097 – node:test lädt die .ts-Datei direkt
import { preisFelder } from '../../src/lib/zukauf/preis.ts'

const quelle = p => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')

describe('preisFelder', () => {
  test('Abnahme: 1.000 l zu 2,35 → 2.350,00; Gesamt 2.400 → 2,40; Menge 1.200 → Gesamt bleibt, 2,00', () => {
    assert.deepEqual(preisFelder('1000', '', '2.35', 'einheit'), { gesamt: '2350.00', einheit: '2.35' })
    assert.deepEqual(preisFelder('1000', '2400', '2.35', 'gesamt'), { gesamt: '2400', einheit: '2.40' })
    assert.deepEqual(preisFelder('1200', '2400', '2.40', 'gesamt'), { gesamt: '2400', einheit: '2.00' })
  })
  test('Menge ändert bei Quelle „Einheit“ den Gesamtpreis', () => {
    assert.equal(preisFelder('1200', '2350.00', '2.35', 'einheit').gesamt, '2820.00')
  })
  test('kaufmännisch auf Cent, Preis je Einheit höchstens 4 Stellen', () => {
    assert.equal(preisFelder('3', '', '0.335', 'einheit').gesamt, '1.01')       // 1,005 → 1,01 (nicht 1,00)
    assert.equal(preisFelder('3', '10', '', 'gesamt').einheit, '3.3333')
    assert.equal(preisFelder('8', '10', '', 'gesamt').einheit, '1.25')
  })
  test('ohne Menge oder Eingabe bleibt das gerechnete Feld leer', () => {
    assert.deepEqual(preisFelder('', '', '2.35', 'einheit'), { gesamt: '', einheit: '2.35' })
    assert.deepEqual(preisFelder('0', '100', '', 'gesamt'), { gesamt: '100', einheit: '' })
    assert.deepEqual(preisFelder('10', '', '', 'gesamt'), { gesamt: '', einheit: '' })
  })
})

test('beide Formulare: Preis je Einheit eingebbar, gekoppelt über preisFelder', () => {
  for (const p of ['src/app/(dashboard)/weinhandel/zukauf/neu/page.tsx', 'src/app/(dashboard)/weinhandel/zukauf/[id]/edit/ZukaufEditForm.tsx']) {
    const f = quelle(p)
    assert.match(f, /import \{ preisFelder, type PreisQuelle \} from '@\/lib\/zukauf\/preis'/, p)
    assert.match(f, /aria-label=\{`Preis \/ \$\{einheit\} \(€\)`\} type="number" value=\{preisEinheit\} onChange=\{e => preisAendern\(menge, preisGesamt, e\.target\.value, 'einheit'\)\}/, p)
    assert.match(f, /value=\{preisGesamt\} onChange=\{e => preisAendern\(menge, e\.target\.value, preisEinheit, 'gesamt'\)\}/, p)
    assert.match(f, /setMenge\(e\.target\.value\); preisAendern\(e\.target\.value, preisGesamt, preisEinheit, preisQuelle\)/, p)
  }
})
