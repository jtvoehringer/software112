// KAN-441 (13.11.2026): E2E-Regressionstests waren seit 11.10.2026 rot. Zwei Befunde waren Fehler der App am Handy
// (die E2E-Tests mobil.spec.ts messen sie im Browser gegen Staging); hier die Gegenprobe am Quelltext, die bei jedem
// verify läuft, damit die beiden Stellen nicht unbemerkt zurückfallen.
//
// Aufruf:  npm run -s test:csv
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const WURZEL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const quelle = p => readFileSync(path.join(WURZEL, p), 'utf8').replace(/\r\n/g, '\n')

describe('KAN-441: Handy-Breite', () => {
  test('Dashboard „Aufgaben & Termine“: feste Tabellenbreite, sonst kürzt truncate nicht', () => {
    const k = quelle('src/app/(dashboard)/dashboard/_widgets/karten.tsx')
    const spalte = k.slice(k.indexOf('function AufgabenSpalte('))
    assert.match(spalte, /<table className="w-full table-fixed">/)
    assert.match(spalte, /<colgroup><col \/><col className="w-\[8\.5rem\]" \/><col className="hidden sm:table-column sm:w-\[6\.5rem\]" \/><\/colgroup>/)
    assert.match(spalte, /<td className="hidden sm:table-cell py-2 pl-2 text-right"><Badge/)
    assert.match(spalte, /truncate\">\{a\.betreff\}/)
  })
  test('Umziehen: Auswahlfelder dürfen schmäler werden als ihr längster Eintrag', () => {
    const u = quelle('src/app/(dashboard)/kellerbuch/umziehen/UmziehenClient.tsx')
    const felder = [...u.matchAll(/<select aria-label="(Quelle \(Gebinde · Charge\)|Ziel-Gebinde)"[\s\S]*?className="([^"]+)"/g)]
    assert.equal(felder.length, 2)
    for (const [, name, klassen] of felder) {
      assert.match(klassen, /\bflex-1 basis-full min-w-0 max-w-full\b/, name)
    }
  })
})

describe('KAN-441: Tests folgen der Oberfläche', () => {
  test('Ungespeicherte Eingaben: eigener Dialog statt Browser-Dialog, mit den Knöpfen der App', () => {
    const s = quelle('src/components/UngespeichertSchutz.tsx')
    assert.match(s, /bestaetigen: 'Verlassen', abbrechen: 'Weiter bearbeiten'/)
    const t = quelle('e2e/ungespeichert.spec.ts')
    assert.match(t, /getByRole\('alertdialog'\)/)
    assert.match(t, /name: 'Weiter bearbeiten'/); assert.match(t, /name: 'Verlassen'/)
    assert.doesNotMatch(t, /page\.once\('dialog'/)
  })
  test('Verkauf, Charge und Lesedaten: Beschriftungen wie in der App', () => {
    assert.match(quelle('src/app/(dashboard)/weinhandel/verkauf/neu/page.tsx'), /aria-label="Interne Notiz"/)
    assert.match(quelle('e2e/verkauf.spec.ts'), /getByLabel\('Interne Notiz'\)/)
    assert.match(quelle('src/app/(dashboard)/kellerbuch/weinausbau/[id]/page.tsx'), /<details id="bearbeiten" open=\{openForm === 'bearbeiten'\}/)
    assert.match(quelle('e2e/kellerbuch.spec.ts'), /\/kellerbuch\/weinausbau\/\$\{charge\}\?form=bearbeiten/)
    assert.match(quelle('e2e/mobil.spec.ts'), /page\.locator\('table'\)\.getByRole\('button', \{ name: 'Bearbeiten', exact: true \}\)\.first\(\)/)
  })
  test('Weinbuch-Sammlung: der Test grenzt nach Jahrgang ein, statt an der 30er-Grenze zu scheitern', () => {
    const t = quelle('e2e/behoerden-csv.spec.ts')
    assert.match(t, /id === 'weinbuch-sammlung'/)
    assert.match(t, /höchstens \\d\+ je Weinbuch-Sammlung/)
    assert.match(quelle('src/lib/behoerden/weinbuch.ts'), /höchstens \$\{WEINBUCH_SAMMLUNG_MAX\} je Weinbuch-Sammlung/)
  })
})
