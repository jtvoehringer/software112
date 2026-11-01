// Lese erfassen – Pilot-Rückmeldung Gebeshuber 29.09.2026
//
// Aufruf:  npm run -s test:csv   (alle scripts/tests/*.test.mjs)
//
// 1. Eine Ried mit genau einem Weingarten erscheint als EINE Zeile (fett) statt Ried-Kopf und gleichnamigem
//    Weingarten darunter.
// 2. Weingärten ohne Weingarten-Grundstück (nur Acker, Grünland, Brache …) werden gar nicht angeboten.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const ried = await import('../../src/lib/wein/riedAuswahl.ts')
const quelle = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')
const CLIENT = 'src/app/(dashboard)/erntemeldung/[id]/ErnteDetailClient.tsx'

describe('istEinzelRied() und weingartenZusatz()', () => {
  const wg = (id, lage_name) => ({ id, lage_name })

  test('Ried mit genau einem Weingarten ist eine Einzel-Ried, mit zwei nicht', () => {
    const [a, b] = ried.riedGruppen([wg('1', 'UNTERER BADENER WEG'), wg('2', 'SCHWABEN'), wg('3', 'SCHWABEN')])
    assert.equal(a.name, 'SCHWABEN')
    assert.equal(ried.istEinzelRied(a), false)
    assert.equal(ried.istEinzelRied(b), true)
  })

  test('„Ohne Ried-Zuordnung“ ist nie eine Einzel-Ried – auch mit nur einem Weingarten', () => {
    const [g] = ried.riedGruppen([wg('1', null)])
    assert.equal(g.ohneRied, true)
    assert.equal(ried.istEinzelRied(g), false)
  })

  test('Zusatz nur, wenn der Weingarten anders heißt als die Ried (Groß-/Kleinschreibung und Leerzeichen egal)', () => {
    assert.equal(ried.weingartenZusatz('UNTERER BADENER WEG', 'UNTERER BADENER WEG'), null)
    assert.equal(ried.weingartenZusatz('Hausberg I', ' HAUSBERG I '), null)
    assert.equal(ried.weingartenZusatz('SCHWABEN', 'Schwaben oben'), 'Schwaben oben')
  })
})

describe('Verdrahtung in ErnteDetailClient', () => {
  const c = quelle(CLIENT)
  const form = c.slice(c.indexOf('function NeueParzellenForm('), c.indexOf('function ParzellForm('))

  test('nur erntebare Weingärten, Hinweis auf die ausgeblendeten', () => {
    assert.match(form, /weingaerten: alleWeingaerten/)
    // KAN-392: zusätzlich ohne Rieden, deren Grundstücke alle „Ernte abgeschlossen“ haben
    assert.match(form, /const weingaerten = alleWeingaerten\.filter\(w => w\.erntebar && /)
    assert.match(form, /const ausgeblendet = alleWeingaerten\.filter\(w => !w\.erntebar\)\.length/)
    assert.match(form, /ausgeblendet > 0 &&/)
  })

  test('Einzel-Ried: kein eigener Ried-Kopf, Ried-Name fett in der Weingarten-Zeile', () => {
    assert.match(form, /const einzelRied = istEinzelRied\(gruppe\)/)
    assert.match(form, /\{!einzelRied && <label /)
    assert.match(form, /einzelRied\s*\n?\s*\? <span className=\{`text-xs font-semibold/)
  })

  test('Bearbeiten: Einzel-Ried als Option ohne optgroup, nicht erntebare nur, wenn schon gespeichert', () => {
    assert.match(c, /riedGruppen\(weingaerten\.filter\(w => w\.erntebar \|\| w\.id === parzelle\?\.weingarten_id\)\)/)
    assert.match(c, /lagen\.map\(g => istEinzelRied\(g\) \?/)
  })
})
