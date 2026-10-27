// Sweep 114 (10.10.2026): Jede Seite hat eine Hauptüberschrift (h1).
// Befund: Der erste E2E-Lauf (KAN-309) fand das Behandlungsprotokoll ohne Überschrift; der Smoke-Test sieht aber nur
// die Seiten der Navigation. Statisch fehlte das h1 auf 10 weiteren Seiten. Wächter scripts/check-ueberschrift.js (prebuild).
//
// Aufruf:  npm run -s test:csv

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const HIER = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(HIER, '..', '..')
const require = createRequire(import.meta.url)
const { zeigtEtwasAn, pruefeSeiten } = require(path.join(HIER, '..', 'check-ueberschrift.js'))
const lies = (p) => readFileSync(path.join(ROOT, p), 'utf8')

describe('Sweep 114: Hauptüberschriften', () => {
  test('die 10 Seiten ohne h1 haben jetzt eine (Titel ausgezeichnet bzw. sr-only)', () => {
    const R = 'src/app/(dashboard)/reports/(pflicht)/'
    const erwartet = {
      'src/app/(auth)/login/page.tsx': '>Anmelden</h1>',
      'src/app/(dashboard)/nachrichten/page.tsx': '<h1 className="sr-only">Nachrichten</h1>',
      'src/app/(dashboard)/dac/[id]/etikett/page.tsx': '<h1 className="sr-only">Weinetikett {dac.bezeichnung}</h1>',
      'src/app/(dashboard)/weinhandel/rechnungen/[id]/page.tsx': "<h1 className=\"text-3xl font-semibold\">{storno ? 'STORNORECHNUNG' : 'RECHNUNG'}</h1>",
      'src/app/(dashboard)/kellerbuch/fuellung/[id]/blend-protokoll/page.tsx': 'Blend-Protokoll\n            </h1>',
      'src/app/(dashboard)/kellerbuch/weinausbau/[id]/blend-protokoll/page.tsx': 'Blend-Protokoll\n            </h1>',
      [R + 'ama/page.tsx']: '>AMA Weinerntemeldung</h1>',
      [R + 'bestandsmeldung-bsm/page.tsx']: '>Weinbestandsmeldung nach Buchungsarten</h1>',
      [R + 'cu-bilanz/page.tsx']: '>Kupfer-Bilanz (Cu-Bilanz)</h1>',
      [R + 'naehrstoffbilanz/page.tsx']: '>Nährstoffbilanz (Stickstoff/Phosphor)</h1>',
      [R + 'behandlungsprotokoll/page.tsx']: '>Weinbauliches Behandlungsprotokoll</h1>',
    }
    for (const [datei, h1] of Object.entries(erwartet)) assert.ok(lies(datei).replace(/\r\n/g, '\n').includes(h1), `${datei}: ${h1}`)
  })

  test('Weiterleitungen ohne JSX zählen nicht als Seite mit Inhalt', () => {
    assert.equal(zeigtEtwasAn("import { redirect } from 'next/navigation'\nexport default function P() { redirect('/x') } // <Kommentar>"), false)
    assert.equal(zeigtEtwasAn('export default function P() { return <div>Hallo</div> }'), true)
    assert.equal(zeigtEtwasAn('export default function P() { return <>x</> }'), true)
  })

  test('Wächter: meldet eine Seite ohne h1, findet ein h1 in einer importierten Komponente, beachtet die Ausnahme', () => {
    const w = mkdtempSync(path.join(tmpdir(), 's114-'))
    const app = path.join(w, 'src', 'app')
    for (const d of ['ohne', 'mit', 'import', 'weiter', 'ausnahme']) mkdirSync(path.join(app, d), { recursive: true })
    writeFileSync(path.join(app, 'ohne', 'page.tsx'), 'export default function P() { return <p className="text-lg">Titel</p> }')
    writeFileSync(path.join(app, 'mit', 'page.tsx'), 'export default function P() { return <h1>Titel</h1> }')
    writeFileSync(path.join(app, 'import', 'Kopf.tsx'), 'export default function K() { return <h1 className="sr-only">Titel</h1> }')
    writeFileSync(path.join(app, 'import', 'page.tsx'), "import Kopf from './Kopf'\nexport default function P() { return <Kopf /> }")
    writeFileSync(path.join(app, 'weiter', 'page.tsx'), "import { redirect } from 'next/navigation'\nexport default function P() { redirect('/mit') }")
    writeFileSync(path.join(app, 'ausnahme', 'page.tsx'), '// ueberschrift-ausnahme: reine Druckvorlage ohne Seitenrahmen\nexport default function P() { return <p>x</p> }')
    const { geprueft, funde } = pruefeSeiten(w)
    assert.equal(geprueft, 3)
    assert.deepEqual(funde, ['src/app/ohne/page.tsx'])
  })

  test('der echte Quellbaum ist sauber und der Wächter läuft im prebuild', () => {
    assert.deepEqual(pruefeSeiten(ROOT).funde, [])
    assert.match(JSON.parse(lies('package.json')).scripts.prebuild, /node scripts\/check-ueberschrift\.js/)
  })
})
