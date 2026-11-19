// KAN-481 (UAT 19.11.2026, Musterhof): Maische ansetzen und abpressen – die Gebinde-Auswahlen zeigten den Inhalt nicht.
//
// 1. „Gebinde der Maische“ zeigte nur Name und Größe; belegte Gebinde lehnte erst die Datenbank ab („Im gewählten
//    Gebinde liegt Wein. Eine Maische braucht ein leeres Gebinde.“) – man musste ein leeres Gebinde erraten.
// 2. Beim Abpressen bekam das Formular den Inhalt der Gebinde nicht (behaelterMitCharge={undefined}): jedes Gebinde
//    erschien als „leer | frei <Fassungsvermögen>“. Befund: „Holzfass 2 (600 l) · leer | frei 600 L“, tatsächlich 580 l
//    belegt – die Datenbank lehnte zu Recht ab („frei 20 l“).
//
// Aufruf:  npm run -s test:csv
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { gebindeOption } from '../../src/lib/keller/gebindeAnzeige.ts'

const WURZEL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const p = readFileSync(path.join(WURZEL, 'src/app/(dashboard)/erntemeldung/[id]/PressungSection.tsx'), 'utf8').replace(/\r\n/g, '\n')

describe('KAN-481: Gebinde-Auswahl mit Inhalt', () => {
  test('Anzeige wie im Befund: mit Inhalt „580 L … | frei 20 L“, ohne „leer | frei 600 L“', () => {
    const mit = gebindeOption({ name: 'Holzfass 2 (600 l)', inhaltLiter: 580, volumenLiter: 600, chargen: ['St. Laurent Reserve'] })
    assert.match(mit, /^Holzfass 2 \(600 l\) · 580 L St\. Laurent Reserve \| frei 20 L$/)
    assert.match(gebindeOption({ name: 'Holzfass 2 (600 l)', inhaltLiter: 0, volumenLiter: 600 }), /· leer \| frei 600 L$/)
  })
  test('Abpressen: das Formular bekommt den Inhalt der Gebinde; beim Bearbeiten bleibt es ohne', () => {
    assert.ok(p.includes('behaelterMitCharge={abpressenId === p.id ? behaelterMitCharge : undefined} maischeGebinde={maischeGebinde}'))
    assert.ok(!p.includes('behaelterMitCharge={undefined}'))
  })
  test('Abpressen in ein Gebinde mit Wein: dieselbe Verschnitt-Rückfrage wie bei der Direktpressung', () => {
    assert.ok(p.includes('if ((!pressung || abpressen) && behaelterMitCharge && result.neu.length > 0) {'))
  })
})

describe('KAN-481: Gebinde der Maische', () => {
  const auswahl = p.slice(p.indexOf('<select aria-label="Gebinde der Maische"'), p.indexOf('Eine Maische braucht ein leeres Gebinde – Gebinde mit Wein'))
  test('zeigt Inhalt und Chargen; Gebinde mit Wein oder einer anderen Maische sind nicht wählbar', () => {
    assert.ok(auswahl.length > 0)
    for (const s of ['const inhalt = gebindeInhalt(b.id)', 'const m = fremdeMaische(b.id)', 'const belegt = inhalt > 0.005 || !!m', '<option key={b.id} value={b.id} disabled={belegt}>',
      'gebindeOption({ name: b.name, inhaltLiter: inhalt, volumenLiter: b.volumen_liter ?? null']) assert.ok(auswahl.includes(s), s)
  })
  test('offene Maischen des Jahrgangs kommen aus den Pressungen (ohne stornierte); die eigene zählt nicht als fremd', () => {
    assert.ok(p.includes('.filter(p => !p.storno && p.maische?.offen && p.maische.behaelter_id)'))
    assert.ok(p.includes('const fremdeMaische = (id: string) => (id !== pressung?.maische?.behaelter_id ? maischeGebinde?.[id] ?? null : null)'))
  })
  test('Most-Gebinde: ein Gebinde mit fremder offener Maische ist gekennzeichnet und gesperrt', () => {
    assert.ok(p.includes('<option key={b.id} value={b.id} disabled={!!m && row.behaelter_id !== b.id}>'))
    assert.ok(p.includes('{m ? ` · Maische ${m} – belegt` : \'\'}</option>'))
  })
})
