#!/usr/bin/env node
/**
 * check-einzelabfrage.js – Wächter „Einzelabfragen in Server Actions werten ihren Fehler aus“ (Sweep 68, 09.10.2026)
 *
 * `const { data } = await supabase.from(…)….maybeSingle()` ohne `error` macht aus einem Datenbankfehler ein „nicht
 * vorhanden“ (null). In Server Actions folgt darauf eine Entscheidung: Befunde waren u. a. ein abzugsfähiger Anteil, der
 * still auf 100 % zurückfiel, eine Einnahmenbuchung, die als „E&A-Modul aus“ übersprungen wurde, ein zweiter Stripe-Kunde
 * und doppelt angelegte Typen. Darum muss in jeder Datei mit 'use server' eine Anweisung
 *   const { … } = await ….maybeSingle()   bzw.   ….single()
 * auch `error` übernehmen (const { data, error: e } = …) – oder begründet ausgenommen sein:
 *   // einzelabfrage-ohne-fehler: <Grund, mind. 15 Zeichen>
 * in derselben Zeile oder in einer der vier Zeilen davor.
 *
 * KAN-252 (09.10.2026): dasselbe für alle Route-Handler (route.ts) – Webhooks antworteten bei einem Lesefehler mit
 * 2xx/4xx, der Anbieter (Stripe, SumUp, M365) stellte das Ereignis dann nicht erneut zu. Dort bei einem Fehler 500.
 *
 * Aufruf: node scripts/check-einzelabfrage.js   (Exit 1 bei Funden)
 * Für Tests: require('./check-einzelabfrage.js') → { pruefeText, pruefeWurzel } ohne Seiteneffekte;
 * S112_GUARD_ROOT prüft ein anderes Projektverzeichnis (scripts/tests/check-einzelabfrage.test.mjs).
 */
const fs = require('fs')
const path = require('path')
const { ohneKommentare } = require('./check-loeschen.js')

const ENDUNGEN = ['.ts', '.tsx']
const AUSNAHME = /einzelabfrage-ohne-fehler\b/i
const AUSNAHME_GRUND = /einzelabfrage-ohne-fehler\s*:\s*(.*)$/i
const MIN_GRUND = 15
const VORLAUF = 4
// nur Dateien, die als Ganzes Server Actions sind ('use server' als erste Anweisung) – nicht Seiten mit eingebetteter Action
const istActionDatei = text => /^(['"])use server\1/.test(
  text.replace(/^﻿/, '').replace(/^(?:\s+|\/\/[^\n]*|\/\*[\s\S]*?\*\/)*/, ''))

/** Ende der Anweisung ab Index i im Code (Klammern gezählt; weiter, solange die nächste Zeile mit „.“ beginnt) */
function anweisungsEnde(s, i) {
  let tiefe = 0
  for (; i < s.length; i++) {
    const c = s[i]
    if (c === '(' || c === '[' || c === '{') tiefe++
    else if (c === ')' || c === ']' || c === '}') tiefe--
    else if (c === '\n' && tiefe <= 0) {
      let j = i + 1
      while (j < s.length && /[ \t\r]/.test(s[j])) j++
      if (s[j] !== '.') return i
    }
  }
  return s.length
}

/** Destrukturierung `{ … }` ab Index i (s[i] === '{') → [Inhalt, Index nach '}'] mit verschachtelten Klammern */
function klammerInhalt(s, i) {
  let tiefe = 0
  for (let j = i; j < s.length; j++) {
    if (s[j] === '{') tiefe++
    else if (s[j] === '}') { tiefe--; if (tiefe === 0) return [s.slice(i + 1, j), j + 1] }
  }
  return [s.slice(i + 1), s.length]
}

/** → { funde: [{ zeile, text }], ausnahmen, geprueft }; route = Route-Handler (route.ts, KAN-252) */
function pruefeText(text, { route = false } = {}) {
  const funde = []
  let ausnahmen = 0, geprueft = 0
  if (!route && !istActionDatei(text)) return { funde, ausnahmen, geprueft }
  const roh = text.split('\n')
  const code = ohneKommentare(text)
  const re = /\b(?:const|let)\s+\{/g
  let m
  while ((m = re.exec(code))) {
    const [inhalt, nach] = klammerInhalt(code, m.index + m[0].length - 1)
    const rest = code.slice(nach)
    const zuweisung = /^\s*(?::[^=]*)?=\s*await\b/.exec(rest)
    if (!zuweisung) continue
    const start = nach + zuweisung[0].length
    const anweisung = code.slice(start, anweisungsEnde(code, start))
    if (!/\.(maybeSingle|single)\(\s*\)\s*$/.test(anweisung.trim())) continue
    const zeile = code.slice(0, m.index).split('\n').length
    // oberste Ebene der Destrukturierung: error bzw. error: name
    if (/(^|,)\s*error\b/.test(inhalt.replace(/\{[^{}]*\}/g, ''))) { geprueft++; continue }
    const marker = roh.slice(Math.max(0, zeile - 1 - VORLAUF), zeile).reverse().find(r => AUSNAHME.test(r))
    if (marker) {
      const grund = (AUSNAHME_GRUND.exec(marker.replace(/\r$/, ''))?.[1] ?? '').replace(/\*\/.*$/, '').trim()
      if (grund.length >= MIN_GRUND) { ausnahmen++; continue }
      funde.push({ zeile, text: `„einzelabfrage-ohne-fehler“ ohne ausreichende Begründung (mind. ${MIN_GRUND} Zeichen)` })
      continue
    }
    funde.push({ zeile, text: 'Einzelabfrage (.maybeSingle()/.single()) ohne error – ein Datenbankfehler hieße „nicht vorhanden“' })
  }
  return { funde, ausnahmen, geprueft }
}

function* dateien(dir) {
  if (!fs.existsSync(dir)) return
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) { if (e.name !== 'node_modules') yield* dateien(p) }
    else if (ENDUNGEN.includes(path.extname(e.name))) yield p
  }
}

function pruefeWurzel(root) {
  const funde = []
  let anzahl = 0, ausnahmen = 0, geprueft = 0
  for (const f of dateien(path.join(root, 'src'))) {
    const t = fs.readFileSync(f, 'utf8')
    const route = path.basename(f) === 'route.ts'
    if (!route && !istActionDatei(t)) continue
    anzahl++
    const e = pruefeText(t, { route })
    ausnahmen += e.ausnahmen
    geprueft += e.geprueft
    const r = path.relative(root, f).split(path.sep).join('/')
    for (const x of e.funde) funde.push(`${r}:${x.zeile}  ${x.text}`)
  }
  return { funde, dateien: anzahl, ausnahmen, geprueft }
}

module.exports = { pruefeText, pruefeWurzel }

if (require.main === module) {
  const ROOT = process.env.S112_GUARD_ROOT ? path.resolve(process.env.S112_GUARD_ROOT) : path.resolve(__dirname, '..')
  const e = pruefeWurzel(ROOT)
  if (e.funde.length) {
    console.error(`\n✖ check-einzelabfrage: ${e.funde.length} Fund(e) – Einzelabfrage in einer Server Action ohne Fehlerprüfung:\n`)
    for (const x of e.funde) console.error('  ' + x)
    console.error('\n`error` mit übernehmen und auswerten (const { data, error: e } = … ; if (e) …) – oder begründen:')
    console.error('  // einzelabfrage-ohne-fehler: <Grund ≥ 15 Zeichen>   (dieselbe Zeile oder bis zu vier Zeilen davor)\n')
    process.exit(1)
  }
  console.log(`✓ check-einzelabfrage: ${e.dateien} Server-Action- und Route-Dateien, ${e.geprueft} Einzelabfragen mit Fehlerprüfung, ${e.ausnahmen} begründete Ausnahme(n).`)
}
