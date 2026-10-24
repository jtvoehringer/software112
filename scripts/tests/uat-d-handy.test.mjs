// UAT-Paket D „Handy und Scrollen“ (22.10.2026) – KAN-370/371/341/339/354/372
// 1) App-Rahmen 100dvh statt 100vh: am Handy ragte der Rahmen unter die Browserleiste, das Seitenende war unerreichbar.
// 2) Lesedaten bearbeiten: Formular über der Liste statt als Zeile der ≥ 700 px breiten Tabelle (waagrecht scrollen).
// 3) Dialoge (fixed inset-0) scrollen selbst – Wächter check-dialoge.
// 4) Gebinde: „+ Neue Behandlung“ springt zum Formular; Unterseiten verlinken die Schnellerfassung.
// 5) Meldungs-Pop-up und schwebende Knöpfe verdecken am Handy nicht die fixierte Speichern-Leiste.
//
// Aufruf:  npm run -s test:csv   (alle scripts/tests/*.test.mjs)

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const ts = require('typescript')
const quelle = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const { fundeIn } = require('../check-dialoge.js')
const funde = (code) => fundeIn(code, 'x.tsx', ts)

describe('KAN-370/371/341: App-Rahmen passt in den sichtbaren Bereich', () => {
  test('Höhe 100dvh mit Rückfall 100vh, unten Abstand für die Home-Leiste, <main> scrollt in beide Richtungen', () => {
    const s = quelle('src/components/layout/AppShell.tsx')
    assert.match(s, /<div className="h-screen supports-\[height:100dvh\]:h-dvh relative flex flex-col overflow-clip bg-s112-bg max-md:pb-\[env\(safe-area-inset-bottom\)\]">/)
    assert.match(s, /<main id="inhalt" data-app-rahmen tabIndex=\{-1\} className="relative flex-1 min-w-0 overflow-x-auto overflow-y-auto focus:outline-hidden">/)
    assert.doesNotMatch(s, /className="h-screen flex/)
  })
  test('Verarbeiten: Brotkrumen brechen um statt rechts hinauszuragen', () => {
    const s = quelle('src/app/(dashboard)/kellerbuch/weinausbau/[id]/verarbeiten/page.tsx')
    assert.match(s, /<div className="flex flex-wrap items-center gap-2 text-sm text-s112-muted">/)
  })
})

describe('KAN-339/354/370: Lesedaten bearbeiten über der Liste', () => {
  const s = quelle('src/app/(dashboard)/erntemeldung/[id]/ErnteDetailClient.tsx')
  test('ParzellForm steht weder in einer Tabellenzelle noch in einer Karte, sondern einmal über der Liste', () => {
    const stellen = [...s.matchAll(/<ParzellForm /g)]
    assert.equal(stellen.length, 1, 'genau eine Stelle für das Bearbeiten-Formular')
    const vor = s.slice(0, stellen[0].index)
    assert.ok(vor.lastIndexOf('<table') < vor.lastIndexOf('</table>') || vor.lastIndexOf('<table') === -1, 'Formular nicht in der Tabelle')
    assert.ok(s.indexOf('data-lesedaten-bearbeiten') < s.indexOf('<table'), 'Formular über der Tabelle')
    assert.ok(s.indexOf('data-lesedaten-bearbeiten') < s.indexOf('<LesedatenKarten '), 'Formular über den Karten')
  })
  test('nach dem Öffnen springt die Seite zum Formular', () => {
    assert.match(s, /<div ref=\{editRef\} className="mb-4 scroll-mt-4" data-print="hide" data-lesedaten-bearbeiten>/)
    assert.match(s, /if \(editId\) editRef\.current\?\.scrollIntoView\(\{ block: 'start', behavior: 'smooth' \}\)/)
    assert.match(s, /<ParzellForm key=\{bearbeitet\.id\}/)
  })
})

describe('KAN-341/371: Wächter check-dialoge', () => {
  test('meldet Dialog-Panel ohne Scrollbereich und ohne max-h', () => {
    const f = funde(`const A = () => <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"><div className="bg-white p-6 w-full max-w-md">x</div></div>`)
    assert.equal(f.length, 1)
    assert.match(f[0].grund, /max-h/)
    const g = funde(`const A = () => <div className="fixed inset-0 z-50"><div className="bg-white max-h-[calc(100dvh-2rem)]">x</div></div>`)
    assert.equal(g.length, 1)
    assert.match(g[0].grund, /overflow-y-auto/)
  })
  test('meldet Höhe in vh statt dvh', () => {
    const f = funde(`const A = () => <div className="fixed inset-0"><div className="max-h-[90vh] overflow-y-auto">x</div></div>`)
    assert.equal(f.length, 1)
    assert.match(f[0].grund, /dvh/)
  })
  test('erlaubt: Panel mit max-h + overflow, scrollende Überlagerung, Kopf/Fuß mit scrollender Mitte, Abdunklung, Ausnahme', () => {
    assert.deepEqual(funde(`const A = () => <div className="fixed inset-0 flex"><div {...d} className="bg-white max-h-[calc(100dvh-2rem)] overflow-y-auto">x</div></div>`), [])
    assert.deepEqual(funde(`const A = () => <div className="fixed inset-0 z-90 overflow-y-auto"><div className="max-w-[720px]">x</div></div>`), [])
    assert.deepEqual(funde(`const A = () => <div className="fixed inset-0"><div className="max-h-[calc(100dvh-2rem)] flex flex-col"><header /><div className="overflow-y-auto">x</div></div></div>`), [])
    assert.deepEqual(funde(`const A = () => <div className="fixed inset-0 bg-black/40" onClick={z} />`), [])
    assert.deepEqual(funde(`const A = () => <div className="fixed inset-0 bg-black/40" aria-hidden="true"><span /></div>`), [])
    assert.deepEqual(funde(`const A = () => (\n  // dialog-scroll-ok: Bestätigung mit zwei Zeilen Text, passt immer\n  <div className="fixed inset-0"><div className="p-4">x</div></div>\n)`), [])
    // zu kurzer Grund zählt nicht
    assert.equal(funde(`const A = () => (\n  // dialog-scroll-ok: kurz\n  <div className="fixed inset-0"><div className="p-4">x</div></div>\n)`).length, 1)
  })
  test('bedingtes Panel ({offen && <div …>}) wird geprüft', () => {
    assert.equal(funde(`const A = () => <div className="fixed inset-0">{offen && <div className="p-4">x</div>}</div>`).length, 1)
  })
  test('im prebuild registriert; CRM-Dialoge mit eigenem Scrollbereich', () => {
    assert.match(JSON.parse(quelle('package.json')).scripts.prebuild, /node scripts\/check-dialoge\.js/)
    const crm = quelle('src/app/(dashboard)/crm/CRMUebersichtClient.tsx')
    assert.match(crm, /<div \{\.\.\.dlgView\} className="[^"]*max-h-\[calc\(100dvh-2rem\)\] overflow-y-auto"/)
    assert.match(crm, /<div \{\.\.\.dlgNeu\} className="[^"]*max-h-\[calc\(100dvh-2rem\)\] overflow-y-auto"/)
  })
})

describe('KAN-372: Gebinde – Neue Behandlung und Schnellerfassung', () => {
  test('„+ Neue Behandlung“ und „Bearbeiten“ springen zum Formular', () => {
    const s = quelle('src/app/(dashboard)/kellerbuch/behaelter/[id]/behandlungen/page.tsx')
    assert.match(s, /if \(formOeffnung\) formRef\.current\?\.scrollIntoView\(\{ block: 'start', behavior: 'smooth' \}\)/)
    assert.equal([...s.matchAll(/setShowForm\(true\)\n    setFormOeffnung\(n => n \+ 1\)/g)].length, 2, 'openNeu und openEdit')
    assert.match(s, /<div ref=\{formRef\} className="card p-5 border-s112-teal\/30 border-2 print:hidden scroll-mt-4">/)
  })
  test('Unterseiten verlinken die Schnellerfassung (Gebindeseite)', () => {
    for (const [f, idVar] of [['behandlungen', 'behaelterId'], ['bewegungen', 'id'], ['umzuege', 'id']]) {
      const s = quelle(`src/app/(dashboard)/kellerbuch/behaelter/[id]/${f}/page.tsx`)
      assert.match(s, new RegExp(`<Link href=\\{\`/kellerbuch/behaelter/\\$\\{${idVar}\\}\`\\} data-schnellerfassung[\\s\\S]{0,250}Schnellerfassung\\n`), f)
    }
    assert.match(quelle('src/app/(dashboard)/kellerbuch/behaelter/[id]/page.tsx'), /<Schnellerfassung /)
  })
})

describe('KAN-371: nichts verdeckt am Handy die Speichern-Leiste', () => {
  test('Meldungs-Pop-up unter md oben unter der Kopfleiste, ab md rechts unten', () => {
    const s = quelle('src/components/MeldungsPopup.tsx')
    assert.match(s, /className="fixed top-16 inset-x-4 md:inset-x-auto md:top-auto md:bottom-4 md:right-4 z-\[60\]/)
  })
  test('schwebende Assistent-Knöpfe am Handy über der Leiste', () => {
    assert.match(quelle('src/components/layout/AssistantPanel.tsx'), /fixed bottom-5 right-5 max-sm:bottom-20 z-40/)
    assert.match(quelle('src/components/assistent/AssistentWidget.tsx'), /fixed bottom-5 right-5 max-sm:bottom-20 z-50/)
  })
})

describe('Mobil-Smoke (Playwright, gegen Staging)', () => {
  test('e2e/mobil.spec.ts prüft Kernseiten bei 375 × 812, nur lesend', () => {
    const s = quelle('e2e/mobil.spec.ts')
    assert.match(s, /const HANDY = \{ width: 375, height: 812 \}/)
    assert.match(s, /tag: '@lesend'/)
    assert.match(s, /document\.documentElement\.scrollWidth/)
    for (const p of ['/dashboard', '/behandlungen/neu', '/kellerbuch/umziehen?neu=1', '/weinhandel/verkauf/neu']) assert.ok(s.includes(`'${p}'`), p)
    assert.match(s, /\[data-lesedaten-bearbeiten\]/)
    assert.doesNotMatch(s, /schreibend\(\)/)
  })
})
