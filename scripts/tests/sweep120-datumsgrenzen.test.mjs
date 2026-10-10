// Sweep 120 (10.10.2026): Datumsfelder bieten nur an, was der Server annimmt.
// Befund: 87 der 112 Datumsfelder haben keine Grenze. Bei drei Abläufen lehnt der Server Tage ab, die das Feld anbot –
// die Ablehnung kam erst nach dem Absenden:
//  - Eröffnungsbestand-Stichtag (Gebinde, Datenimport ×2): 01.01.2000 bis 31.12. des Folgejahres
//  - BKI-Schnittstelle: Von, Bis und „Lagerstand zum“ nicht in der Zukunft (bkiZeitraumAus)
//  - Sekt-Tirage: nicht in der Zukunft (tirageAusFormular)
// Die übrigen Felder sind Planungstermine (Zukunft richtig) oder Ereignisse, bei denen auch der Server die Zukunft
// erlaubt (Frage an Jörgen in KAN-317).
//
// Aufruf:  npm run -s test:csv

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { eroeffnungsStichtagFehler, eroeffnungsStichtagGrenzen } from '../../src/lib/kellerbuch/eroeffnungsStichtag.ts'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const lies = (p) => readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n')

describe('Eröffnungsbestand-Stichtag: Feld und Server mit denselben Grenzen', () => {
  test('Grenzen: 01.01.2000 bis 31.12. des Folgejahres', () => {
    assert.deepEqual(eroeffnungsStichtagGrenzen('2026-10-10'), { min: '2000-01-01', max: '2027-12-31' })
  })
  test('Server nimmt genau die Grenzen an und lehnt den Tag davor bzw. danach ab', () => {
    const heute = '2026-10-10'
    const { min, max } = eroeffnungsStichtagGrenzen(heute)
    assert.equal(eroeffnungsStichtagFehler(min, heute), null)
    assert.equal(eroeffnungsStichtagFehler(max, heute), null)
    assert.match(eroeffnungsStichtagFehler('1999-12-31', heute), /vor dem Jahr 2000/)
    assert.match(eroeffnungsStichtagFehler('2028-01-01', heute), /zu weit in der Zukunft – höchstens bis 31\.12\.2027/)
  })
  test('alle drei Stichtag-Felder setzen die Grenzen', () => {
    assert.match(lies('src/app/(dashboard)/kellerbuch/gebinde/page.tsx'), /name="stichtag" type="date" required \{\.\.\.eroeffnungsStichtagGrenzen\(wienHeute\(\)\)\}/)
    assert.match(lies('src/app/(dashboard)/admin/import/ImportClient.tsx'), /name="stichtag" type="date" required \{\.\.\.eroeffnungsStichtagGrenzen\(wienHeute\(\)\)\}/)
    assert.match(lies('src/app/(dashboard)/admin/import/EroeffnungImport.tsx'), /type="date" value=\{stichtag\} required \{\.\.\.eroeffnungsStichtagGrenzen\(wienHeute\(\)\)\}/)
  })
})

describe('Zukunft ausgeschlossen, wo der Server sie ablehnt', () => {
  test('BKI-Schnittstelle: Von, Bis, Stichtag mit max heute; Server lehnt Zukunft ab', () => {
    const seite = lies('src/app/(dashboard)/kellerbuch/bki-schnittstelle/page.tsx')
    for (const name of ['von', 'bis', 'stichtag']) assert.match(seite, new RegExp(`name="${name}" max=\\{heute\\}`), name)
    assert.match(lies('src/lib/behoerden/bki-schnittstelle-laden.ts'), /if \(bis > heute \|\| stichtag > heute\) return parameterFehler/)
  })
  test('Sekt-Tirage: max heute; Server lehnt Zukunft ab', () => {
    assert.match(lies('src/components/wein/SektTirageFelder.tsx'), /name="tirage_datum" type="date" max=\{wienHeute\(\)\}/)
    assert.match(lies('src/lib/wein/sekt.ts'), /if \(tirage > heute\) return \{ fehler: 'Das Datum der Tirage liegt in der Zukunft\.' \}/)
  })
})
