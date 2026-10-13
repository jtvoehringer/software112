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
  assert.match(s, /<div className="h-screen flex flex-col overflow-clip bg-s112-bg">/)
  assert.match(s, /<div className="flex-1 min-h-0 flex overflow-clip">/)
  assert.match(s, /<main id="inhalt"[^>]*overflow-y-auto/)
  // kein overflow-hidden mehr auf den beiden Rahmen um <main>
  const vorMain = s.slice(s.indexOf('return ('), s.indexOf('<main id="inhalt"'))
  assert.doesNotMatch(vorMain, /className="[^"]*\boverflow-hidden\b[^"]*"/)
})

test('Charge: Titel nimmt den Platz, Knöpfe rechts brechen um', () => {
  const s = quelle('src/app/(dashboard)/kellerbuch/weinausbau/[id]/page.tsx')
  assert.match(s, /<div className="min-w-0 sm:flex-1">\n\s+<h1 className="text-2xl font-semibold text-s112-text break-words">\{weinausbau\.name\}<\/h1>/)
  assert.match(s, /<div className="sm:text-right sm:max-w-\[50%\] lg:max-w-\[55%\]">/)
  assert.doesNotMatch(s, /<div className="sm:text-right shrink-0">/)
})
