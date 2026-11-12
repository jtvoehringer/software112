// KAN-338 (14.10.2026) – Fehler und Bestätigungen als Pop-up: In langen Formularen standen rote Fehler und grüne
// Bestätigungen oben, unten beim „Speichern“ sah man sie nicht. MeldungsPopup zeigt eine neue Meldung, die nach einer
// Aktion außer Sicht erscheint, zusätzlich rechts unten. Wächter check-meldungen: Meldungskästen tragen role.
//
// Aufruf:  npm run -s test:csv   (alle scripts/tests/*.test.mjs)

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { hooksRegistrieren, laden, nurMitHooks } from './buchung-attrappe.mjs'

hooksRegistrieren()
const require = createRequire(import.meta.url)
const ts = require('typescript')
const quelle = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const m = () => laden('lib/ui/meldungen.ts')
const k = (tag, className, role = null, text = 'Bitte ein Ried auswählen.') => ({ tag, className, role, text })

describe('KAN-338: Was ist eine Meldung', nurMitHooks, () => {
  test('Fehler: role="alert" rot/gelb, roter Kasten, Fehlerzeile ohne Kasten', async () => {
    const { meldungsArt } = await m()
    assert.equal(meldungsArt(k('DIV', 'bg-s112-err-bg border text-sm text-s112-err-fg', 'alert')), 'fehler')
    assert.equal(meldungsArt(k('DIV', 'bg-s112-warn-bg border text-s112-warn-fg', 'alert')), 'fehler')
    assert.equal(meldungsArt(k('UL', 'text-sm text-s112-err list-disc', 'alert')), 'fehler')
    assert.equal(meldungsArt(k('DIV', 'p-3 bg-s112-err-bg rounded-xl text-sm')), 'fehler')
    assert.equal(meldungsArt(k('P', 'text-sm text-s112-err-fg')), 'fehler')
  })
  test('Bestätigung nur mit role und grüner Farbe', async () => {
    const { meldungsArt } = await m()
    assert.equal(meldungsArt(k('DIV', 'flex bg-s112-ok-bg border text-s112-ok-fg', 'status', 'Gespeichert.')), 'ok')
    assert.equal(meldungsArt(k('P', 'text-xs text-s112-ok-fg', 'status', 'Gespeichert')), 'ok')
    // grüne Kachel ohne role (Lagerstand) ist keine Bestätigung
    assert.equal(meldungsArt(k('DIV', 'bg-s112-ok-bg rounded-lg p-2', null, '1.200 L')), null)
  })
  test('keine Meldung: Abzeichen, Tabellenzeilen, Feldhinweise, Kennzahlen, role ohne Farbe, leerer Text', async () => {
    const { meldungsArt } = await m()
    assert.equal(meldungsArt(k('SPAN', 'text-xs bg-s112-err-bg text-s112-err-fg rounded-full px-2', null, 'Überfällig')), null)
    assert.equal(meldungsArt(k('TR', 'bg-s112-err-bg', null, 'Zeile 3 fehlerhaft')), null)
    assert.equal(meldungsArt(k('P', 'text-xs text-s112-err-fg', null, 'Ungültige Subdomain')), null)
    assert.equal(meldungsArt(k('DIV', 'text-2xl font-semibold text-s112-err-fg', null, '12')), null)
    assert.equal(meldungsArt(k('DIV', 'rounded-lg border px-4 py-2.5 text-sm bg-s112-bg', 'alert', 'Summe 1.200 L')), null)
    assert.equal(meldungsArt(k('DIV', 'bg-s112-err-bg border', 'alert', '  ')), null)
  })
})

describe('KAN-338: Wann erscheint das Pop-up', nurMitHooks, () => {
  test('nur nach einer Aktion, ohne Seitenwechsel, und nur außer Sicht', async () => {
    const { popupZeigen, AKTION_FENSTER_MS } = await m()
    const basis = { jetzt: 10_000, letzteAktion: 9_000, pfadBeiAktion: '/behandlungen/neu', pfadJetzt: '/behandlungen/neu', sichtbar: false }
    assert.equal(popupZeigen(basis), true)
    assert.equal(popupZeigen({ ...basis, sichtbar: true }), false)                       // sichtbar: kein Pop-up nötig
    assert.equal(popupZeigen({ ...basis, letzteAktion: null }), false)                   // Seitenaufbau ohne Aktion
    assert.equal(popupZeigen({ ...basis, jetzt: 9_000 + AKTION_FENSTER_MS + 1 }), false) // zu lange her
    assert.equal(popupZeigen({ ...basis, pfadJetzt: '/behandlungen' }), false)           // Navigation statt Antwort
  })
  test('vollständig sichtbar und Pop-up-Text', async () => {
    const { vollSichtbar, popupText, MAX_TEXT } = await m()
    assert.equal(vollSichtbar({ top: 10, bottom: 60, height: 50 }, 800), true)
    assert.equal(vollSichtbar({ top: -20, bottom: 30, height: 50 }, 800), false)
    assert.equal(vollSichtbar({ top: 780, bottom: 830, height: 50 }, 800), false)
    assert.equal(vollSichtbar({ top: 0, bottom: 0, height: 0 }, 800), false)
    assert.equal(popupText('  Fehler:\n   Datum  fehlt '), 'Fehler: Datum fehlt')
    assert.equal(popupText('x'.repeat(400)).length, MAX_TEXT)
  })
})

describe('KAN-338: Baustein, Einbindung und Wächter', () => {
  test('MeldungsPopup im Root-Layout (KAN-359); Fehler bleiben, Bestätigungen verschwinden, Esc schließt, „Zur Meldung“', () => {
    assert.match(quelle('src/app/layout.tsx'), /<MeldungsPopup \/>/)
    assert.doesNotMatch(quelle('src/components/layout/AppShell.tsx'), /<MeldungsPopup \/>/)   // nur eine Stelle
    const p = quelle('src/components/MeldungsPopup.tsx')
    assert.match(p, /new MutationObserver/)
    assert.match(p, /document\.addEventListener\('submit', merke, true\)/)
    assert.match(p, /OK_DAUER_MS/)
    assert.match(p, /e\.key === 'Escape'/)
    assert.match(p, /Zur Meldung/)
    assert.match(p, /aria-live="off"/)
    assert.match(p, /wurzel\.current\?\.contains\(el\)/)   // eigenes Pop-up nie als Meldung
  })
  test('Wächter: Kasten ohne role gemeldet, mit role, Abzeichen, grüne Kachel ohne Rahmen und Ausnahme nicht', () => {
    const { fundeIn } = require('../check-meldungen.js')
    const f = (src) => fundeIn(src, 'x.tsx', ts).map(x => x.rolle)
    assert.deepEqual(f('const a = <div className="bg-s112-err-bg border text-sm">{fehler}</div>'), ['alert'])
    assert.deepEqual(f('const a = <p className="bg-s112-ok-bg border border-s112-ok/30 text-sm">Gespeichert</p>'), ['status'])
    assert.deepEqual(f('const a = <div className={`border ${ok ? "bg-s112-ok-bg" : "bg-s112-err-bg"}`}>{m}</div>'), ['status'])
    assert.deepEqual(f('const a = <div role="alert" className="bg-s112-err-bg border">{fehler}</div>'), [])
    assert.deepEqual(f('const a = <span className="bg-s112-err-bg border rounded-full">Überfällig</span>'), [])
    assert.deepEqual(f('const a = <div className="bg-s112-ok-bg rounded-lg p-2">1.200 L</div>'), [])
    assert.deepEqual(f('// meldung-ausnahme: Listenzeile, rot nur bei negativem Inhalt\nconst a = <div className="bg-s112-err-bg text-sm">x</div>'), [])
  })
  test('im prebuild verdrahtet', () => {
    assert.match(JSON.parse(quelle('package.json')).scripts.prebuild, /node scripts\/check-meldungen\.js/)
  })
})

// KAN-413 (UAT 12.11.2026, Nebenbefund): Der rote Storno-Knopf mit Text (StornoButton mitText, bg-s112-err-bg) galt als
// Fehlerkasten – nach dem Speichern einer Sammelmaßnahme erschien „Es gibt eine Fehlermeldung außer Sicht“.
describe('KAN-413: Bedienelemente sind keine Meldung', nurMitHooks, () => {
  test('roter Knopf und roter Link zählen nicht, der rote Kasten daneben schon', async () => {
    const { meldungsArt } = await laden('lib/ui/meldungen.ts')
    const knopf = 'inline-flex items-center gap-1.5 text-xs font-medium text-s112-err-fg bg-s112-err-bg hover:bg-s112-err/20 border border-s112-err/30 px-2.5 py-1.5 rounded-lg transition-colors'
    assert.equal(meldungsArt({ tag: 'BUTTON', className: knopf, role: null, text: 'Ganze Sammelmaßnahme stornieren' }), null)
    assert.equal(meldungsArt({ tag: 'A', className: 'bg-s112-err-bg text-s112-err-fg px-3 py-2', role: null, text: 'Offene Posten ansehen' }), null)
    assert.equal(meldungsArt({ tag: 'DIV', className: 'bg-s112-err-bg border text-sm text-s112-err-fg rounded-lg px-3 py-2', role: 'alert', text: 'Bitte einen Behandlungstyp wählen.' }), 'fehler')
    assert.equal(meldungsArt({ tag: 'DIV', className: 'bg-s112-err-bg px-3 py-2', role: null, text: 'Speichern fehlgeschlagen' }), 'fehler')
  })
  test('der Knopf des StornoButton trägt genau diese Klassen', () => {
    assert.ok(quelle('src/components/StornoButton.tsx').includes("'inline-flex items-center gap-1.5 text-xs font-medium text-s112-err-fg bg-s112-err-bg hover:bg-s112-err/20 border border-s112-err/30 px-2.5 py-1.5 rounded-lg transition-colors'"))
  })
})
