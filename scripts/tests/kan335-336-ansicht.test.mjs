// KAN-335/336 (UAT 13.10.2026): Ansicht nach „Speichern“ durcheinander (Charge, Ried).
// 1) Next.js scrollt nach router.replace mit scrollIntoView – das scrollte auch den App-Rahmen (overflow-hidden ist per
//    Programm scrollbar): Kopfleiste und Reiter verschwanden, unten blieb ein leerer Streifen. Rahmen jetzt overflow-clip.
// 2) Charge: Knopfspalte rechts war shrink-0 ohne Breitengrenze – Titel brach Wort für Wort um, waagrechte Scrollleiste.
//
// Aufruf:  npm run -s test:csv   (alle scripts/tests/*.test.mjs)

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const quelle = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')

test('App-Rahmen ist nicht scrollbar (overflow-clip), gescrollt wird nur im Inhalt', () => {
  const s = quelle('src/components/layout/AppShell.tsx')
  // KAN-370/371: Höhe 100dvh (Rückfall 100vh), Rahmen bleibt overflow-clip
  assert.match(s, /<div className="h-screen supports-\[height:100dvh\]:h-dvh flex flex-col overflow-clip bg-s112-bg[^"]*">/)
  assert.match(s, /<div className="flex-1 min-h-0 flex overflow-clip">/)
  assert.match(s, /<main id="inhalt"[^>]*overflow-y-auto/)
  // kein overflow-hidden mehr auf den beiden Rahmen um <main>
  const vorMain = s.slice(s.indexOf('return ('), s.indexOf('<main id="inhalt"'))
  assert.doesNotMatch(vorMain, /className="[^"]*\boverflow-hidden\b[^"]*"/)
})

test('Nachbesserung: Dokument scrollt nicht, Bleiben ohne Next.js-Scroll, Bestätigung scrollt nur <main>', () => {
  const css = quelle('src/app/globals.css')
  assert.match(css, /@media screen \{\n  html:has\(main#inhalt\) \{\n    height: 100%;\n    overflow: hidden;\n  \}\n  html:has\(main#inhalt\) body \{\n    height: 100%;\n    overflow: clip;\n  \}/)
  // Druck hebt die Sperre auf (Mehrseitendruck)
  assert.match(css, /@media print \{[\s\S]*html, body \{\n    height: auto !important;\n    overflow: visible !important;/)
  for (const f of ['src/components/kellerbuch/WeinausbauForm.tsx', 'src/components/weingarten/WeingartenForm.tsx', 'src/components/kellerbuch/BehaelterForm.tsx',
    'src/components/dac/DacForm.tsx', 'src/app/(dashboard)/buchhaltung/anlagen/AnlageForm.tsx']) {
    const s = quelle(f)
    assert.match(s, /router\.replace\(hierBleiben\(\), \{ scroll: false \}\)/, f)
    assert.doesNotMatch(s, /router\.replace\(hierBleiben\(\)\)/, f)
  }
  assert.match(quelle('src/components/layout/ZurueckLeiste.tsx'), /if \(erledigt\) document\.getElementById\('inhalt'\)\?\.scrollTo\(\{ top: 0 \}\)/)
})

test('Dialoge (Gebinde, Kellerplan) haben einen eigenen Scrollbereich', () => {
  for (const f of ['src/components/kellerbuch/GebindeClient.tsx', 'src/components/kellerbuch/KellerplanEditModal.tsx',
    'src/app/(dashboard)/kellerbuch/kellerplan/[id]/KellerplanBuchen.tsx', 'src/app/(dashboard)/kellerbuch/kellerplan/[id]/KellerplanEditor.tsx'])
    assert.match(quelle(f), /rounded-xl shadow-xl p-6 w-full max-w-(md|sm) max-h-\[calc\(100dvh-2rem\)\] overflow-y-auto"/, f)
})

test('Charge: Titel nimmt den Platz, Knöpfe rechts brechen um', () => {
  const s = quelle('src/app/(dashboard)/kellerbuch/weinausbau/[id]/page.tsx')
  assert.match(s, /<div className="min-w-0 sm:flex-1">\n\s+<h1 className="text-2xl font-semibold text-s112-text break-words">\{weinausbau\.name\}<\/h1>/)
  assert.match(s, /<div className="sm:text-right sm:max-w-\[50%\] lg:max-w-\[55%\]">/)
  assert.doesNotMatch(s, /<div className="sm:text-right shrink-0">/)
})
