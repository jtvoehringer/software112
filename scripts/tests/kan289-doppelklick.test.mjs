// Sweep 94 (KAN-289, 10.10.2026): kein Doppelklick auf schreibende Formulare.
// Ein Absende-Knopf (type="submit") eines Formulars mit Aktion (action={…} bzw. onSubmit={…}) muss während des Absendens
// gesperrt sein – sonst legt ein zweiter Klick dieselbe E&A-Buchung, Zahlung, Umbuchung, denselben Eröffnungsbestand
// usw. doppelt an. Lösung: <SendenKnopf> (src/components/ui/SendenKnopf.tsx, useFormStatus) bzw. disabled={…}.
// Reine Such- und Filterformulare (method="get") sind ausgenommen.
//
// Aufruf:  npm run -s test:csv

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src')

function dateien(dir) {
  const out = []
  for (const n of readdirSync(dir)) {
    const p = path.join(dir, n)
    if (statSync(p).isDirectory()) out.push(...dateien(p))
    else if (n.endsWith('.tsx')) out.push(p)
  }
  return out
}

/** Absende-Knöpfe schreibender Formulare ohne Sperre */
export function ungesperrteKnoepfe(text) {
  const funde = []
  const re = /<button\b([^>]*?)type=["']submit["']([^>]*?)>/gs
  let m
  while ((m = re.exec(text))) {
    if (/disabled\s*=/.test(m[1] + m[2])) continue
    const formStart = text.slice(0, m.index).lastIndexOf('<form')
    const formTag = formStart >= 0 ? text.slice(formStart, text.indexOf('>', formStart) + 1) : ''
    if (/method=["']get["']/i.test(formTag)) continue
    if (formStart >= 0 && !/action=\{|onSubmit=\{/.test(formTag)) continue
    funde.push(text.slice(0, m.index).split('\n').length)
  }
  return funde
}

test('Erkennung: ungesperrt → Fund; disabled, SendenKnopf und GET-Formular → kein Fund', () => {
  assert.deepEqual(ungesperrteKnoepfe(`<form action={speichern}>\n  <button type="submit">Speichern</button>\n</form>`), [2])
  assert.deepEqual(ungesperrteKnoepfe(`<form onSubmit={senden}>\n  <button type="submit" disabled={laeuft}>OK</button>\n</form>`), [])
  assert.deepEqual(ungesperrteKnoepfe(`<form action={speichern}>\n  <SendenKnopf>Speichern</SendenKnopf>\n</form>`), [])
  assert.deepEqual(ungesperrteKnoepfe(`<form method="get">\n  <button type="submit">Anzeigen</button>\n</form>`), [])
})

test('Projekt: jeder Absende-Knopf eines schreibenden Formulars ist gesperrt', () => {
  const funde = []
  let knoepfe = 0
  for (const f of dateien(SRC)) {
    const t = readFileSync(f, 'utf8').replace(/\r\n/g, '\n')
    knoepfe += (t.match(/type=["']submit["']|<SendenKnopf\b/g) ?? []).length
    for (const z of ungesperrteKnoepfe(t)) funde.push(`${path.relative(SRC, f)}:${z}`)
  }
  assert.ok(knoepfe > 100, `zu wenige Absende-Knöpfe gefunden (${knoepfe}) – Muster prüfen`)
  assert.deepEqual(funde, [], 'Absende-Knopf ohne Sperre – <SendenKnopf> bzw. disabled={…} verwenden')
})

test("'use client' steht am Dateianfang (sonst ist die Datei keine Client-Komponente – Befund beim Umbau)", () => {
  const falsch = []
  for (const f of dateien(SRC)) {
    const t = readFileSync(f, 'utf8').replace(/^﻿/, '')
    const pos = t.search(/^(['"])use client\1;?\s*$/m)
    if (pos < 0) continue
    const davor = t.slice(0, pos).replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, '').trim()
    if (davor) falsch.push(path.relative(SRC, f))
  }
  assert.deepEqual(falsch, [])
})

test('SendenKnopf sperrt über useFormStatus', () => {
  const k = readFileSync(path.join(SRC, 'components/ui/SendenKnopf.tsx'), 'utf8')
  assert.match(k, /const \{ pending \} = useFormStatus\(\)/)
  assert.match(k, /disabled=\{pending \|\| disabled\}/)
  assert.match(readFileSync(path.join(SRC, 'app/(dashboard)/buchhaltung/neu/page.tsx'), 'utf8'), /<SendenKnopf\b/)
})
