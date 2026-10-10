// Sweep 119 (10.10.2026): Schutz vor dem Verlust ungespeicherter Eingaben.
// Befund: In keinem der 170 Formulare gab es eine Rückfrage – wer in einem langen Formular (Maßnahme 27 Felder, Kontakt
// 27, Zukauf 26, Verkauf 25 …) einen Menüpunkt anklickte, neu lud oder den Tab schloss, verlor alle Eingaben.
// UngespeichertSchutz (Root-Layout) fragt bei Formularen mit data-ungespeichert nach; 42 Formulare ab 8 Feldern
// angemeldet, Wächter scripts/check-formulare.js. E2E: e2e/ungespeichert.spec.ts.
//
// Aufruf:  npm run -s test:csv

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { verlaesstSeite, offeneAenderungen, schutzFormular, MELDUNG } from '../../src/lib/ui/ungespeichert.ts'

const HIER = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(HIER, '..', '..')
const require = createRequire(import.meta.url)
const { langeFormulare, formulare, SCHWELLE } = require(path.join(HIER, '..', 'check-formulare.js'))
const lies = (p) => readFileSync(path.join(ROOT, p), 'utf8')

const klick = (x = {}) => ({ defaultPrevented: false, button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...x })
const link = (href, attrs = {}) => ({ target: attrs.target ?? '', href: new URL(href, 'https://s112.test/buchhaltung/neu').href,
  getAttribute: (n) => n === 'href' ? href : attrs[n] ?? null, hasAttribute: (n) => n in attrs })
const HIER_URL = 'https://s112.test/buchhaltung/neu'

describe('verlaesstSeite', () => {
  test('Menüpunkt bzw. andere Seite: ja', () => {
    assert.equal(verlaesstSeite(klick(), link('/dashboard'), HIER_URL), true)
    assert.equal(verlaesstSeite(klick(), link('/buchhaltung/neu?typ=ausgabe'), HIER_URL), true)
    assert.equal(verlaesstSeite(klick(), link('https://andere.example/x'), HIER_URL), true)
  })
  test('nicht: neuer Tab, Strg/Mitte-Klick, Download, Anker, mailto, dieselbe Seite, bereits verhindert', () => {
    assert.equal(verlaesstSeite(klick(), link('/x', { target: '_blank' }), HIER_URL), false)
    assert.equal(verlaesstSeite(klick({ ctrlKey: true }), link('/x'), HIER_URL), false)
    assert.equal(verlaesstSeite(klick({ button: 1 }), link('/x'), HIER_URL), false)
    assert.equal(verlaesstSeite(klick(), link('/beleg.pdf', { download: '' }), HIER_URL), false)
    assert.equal(verlaesstSeite(klick(), link('#abschnitt'), HIER_URL), false)
    assert.equal(verlaesstSeite(klick(), link('mailto:a@b.at'), HIER_URL), false)
    assert.equal(verlaesstSeite(klick(), link('/buchhaltung/neu'), HIER_URL), false)
    assert.equal(verlaesstSeite(klick({ defaultPrevented: true }), link('/x'), HIER_URL), false)
  })
})

describe('Formular-Zustand', () => {
  test('schutzFormular über closest, offeneAenderungen ohne das Formular des Links', () => {
    const form = { contains: (n) => n === 'abbrechen-link' }
    assert.equal(schutzFormular({ closest: (s) => s === 'form[data-ungespeichert]' ? form : null }), form)
    assert.equal(schutzFormular(null), null)
    const doc = { querySelectorAll: (s) => s === 'form[data-ungespeichert][data-geaendert]' ? [form] : [] }
    assert.deepEqual(offeneAenderungen(doc), [form])
    assert.deepEqual(offeneAenderungen(doc, 'abbrechen-link'), [], '„Abbrechen“ im Formular selbst fragt nicht')
    assert.deepEqual(offeneAenderungen(doc, 'menue-link'), [form])
    assert.match(MELDUNG, /Ungespeicherte Eingaben gehen verloren/)
  })
  test('im Root-Layout eingebunden; Absenden und Zurücksetzen machen das Formular wieder sauber', () => {
    assert.match(lies('src/app/layout.tsx'), /<UngespeichertSchutz \/>/)
    const k = lies('src/components/UngespeichertSchutz.tsx')
    assert.match(k, /addEventListener\('submit', sauber, true\)/)
    assert.match(k, /addEventListener\('reset', sauber, true\)/)
    assert.match(k, /window\.addEventListener\('beforeunload', vorDemVerlassen\)/)
    assert.match(k, /addEventListener\('click', linkKlick, true\)/)
  })
})

describe('check-formulare', () => {
  const formular = (n, attr = '') => `const x = (<form${attr} onSubmit={s}>${'<input />'.repeat(n)}<input type="hidden" /><button type="submit" /></form>)`
  test(`ab ${SCHWELLE} Feldern ohne data-ungespeichert gemeldet; versteckte Felder zählen nicht`, () => {
    assert.equal(formulare(formular(SCHWELLE))[0].felder, SCHWELLE)
    assert.equal(langeFormulare(formular(SCHWELLE)).length, 1)
    assert.equal(langeFormulare(formular(SCHWELLE - 1)).length, 0)
  })
  test('in Ordnung: angemeldet, Such-/Filterformular (GET), Ausnahme mit Grund', () => {
    assert.equal(langeFormulare(formular(10, ' data-ungespeichert')).length, 0)
    assert.equal(langeFormulare(formular(10, ' method="get"')).length, 0)
    assert.equal(langeFormulare('// ungespeichert-ausnahme: speichert jede Änderung sofort\n' + formular(10)).length, 0)
  })
  test('die großen Formulare sind angemeldet', () => {
    for (const d of ['src/app/(dashboard)/behandlungen/neu/NeueBehandlungForm.tsx', 'src/app/(dashboard)/weinhandel/verkauf/neu/page.tsx',
      'src/app/(dashboard)/weinhandel/zukauf/neu/page.tsx', 'src/app/(dashboard)/crm/kontakte/KontakteClient.tsx', 'src/app/(dashboard)/buchhaltung/neu/page.tsx']) {
      assert.match(lies(d), /<form data-ungespeichert\b/, d)
      assert.deepEqual(langeFormulare(lies(d), d), [], d)
    }
    assert.match(JSON.parse(lies('package.json')).scripts.prebuild, /node scripts\/check-formulare\.js/)
  })
})
