// Sweep 88 (KAN-280, 10.10.2026): Abbau der Altfälle aus KAN-278 – Pflanzenschutz (Lager, Maßnahme anlegen/bearbeiten),
// Buchhaltung (Beleg, Konten, Kontoabstimmung, Daueraufträge, Anlagen) und Verkaufsbeleg werten jeden Lesefehler aus
// (geladen → Fehlergrenze), statt falscher Bestände/Salden oder „E&A-Modul aus“ zu zeigen.
//
// Aufruf:  npm run -s test:csv

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const HIER = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(HIER, '..', '..')
const require = createRequire(import.meta.url)
const { pruefeText } = require(path.join(HIER, '..', 'check-einzelabfrage.js'))
const quelle = p => readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n')
const D = 'src/app/(dashboard)/'
const DATEIEN = [
  'behandlungen/lager/page.tsx', 'behandlungen/[id]/edit/page.tsx', 'behandlungen/neu/page.tsx', 'buchhaltung/belege/[id]/page.tsx',
  'konten/[id]/abstimmung/page.tsx', 'konten/page.tsx', 'buchhaltung/dauerauftraege/page.tsx', 'weinhandel/verkauf/[id]/page.tsx',
  'buchhaltung/anlagen/daten.ts',
].map(f => D + f)

describe('KAN-280: Pflanzenschutz, Buchhaltung, Verkaufsbeleg ohne Altfall', () => {
  test('keine Abfrage ohne Fehlerauswertung, kein Ausgangswert mehr', () => {
    const baseline = JSON.parse(quelle('scripts/einzelabfrage-baseline.json'))
    for (const f of DATEIEN) {
      assert.deepEqual(pruefeText(quelle(f), { route: true }).funde, [], f)
      assert.equal(baseline[f], undefined, f)
    }
  })

  test('Konten-Saldo: alle vier Bewegungsarten über geladen(), Abschluss vor dem Zeilenkommentar', () => {
    const k = quelle(D + 'konten/page.tsx')
    assert.equal((k.match(/geladen\(await \(supabase\.from\('(zahlungen|ea_transaktionen|konto_umbuchungen)'\)/g) ?? []).length, 4)
    assert.match(k, /\.is\('storniert_am', null\), 'Zahlungen'\)   \/\/ KAN-149 D2b/)
  })

  test('PSM-Lager: Bewegungen aller drei Lager über geladen() mit deutscher Bezeichnung', () => {
    const l = quelle(D + 'behandlungen/lager/page.tsx')
    for (const was of ['PSM-Lagerbewegungen', 'Düngemittel-Lagerbewegungen', 'Betriebsmittel-Lagerbewegungen', 'Pflanzenschutzmittel']) assert.ok(l.includes(`'${was}')`), was)
    assert.doesNotMatch(l, /'Daten \(/)
  })

  test('geladen() behält den Typ des data-Felds (any bleibt any)', () => {
    assert.match(quelle('src/lib/supabase/geladen.ts'), /export function geladen<E extends Ergebnis>\(res: E, was: string\): E\['data'\]/)
  })
})
