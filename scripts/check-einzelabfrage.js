#!/usr/bin/env node
/**
 * check-einzelabfrage.js – Wächter „Abfragen in Server Actions und Routen werten ihren Fehler aus“ (Sweep 68, 09.10.2026)
 *
 * `const { data } = await supabase.from(…)….maybeSingle()` ohne `error` macht aus einem Datenbankfehler ein „nicht
 * vorhanden“ (null). In Server Actions folgt darauf eine Entscheidung: Befunde waren u. a. ein abzugsfähiger Anteil, der
 * still auf 100 % zurückfiel, eine Einnahmenbuchung, die als „E&A-Modul aus“ übersprungen wurde, ein zweiter Stripe-Kunde
 * und doppelt angelegte Typen (KAN-251). Darum muss in jeder Datei mit 'use server' eine Anweisung
 *   const { … } = await ….maybeSingle()   bzw.   ….single()
 * auch `error` übernehmen (const { data, error: e } = …) – oder begründet ausgenommen sein:
 *   // einzelabfrage-ohne-fehler: <Grund, mind. 15 Zeichen>
 * in derselben Zeile oder in einer der vier Zeilen davor.
 *
 * KAN-252 (09.10.2026): dasselbe für alle Route-Handler (route.ts) – Webhooks antworteten bei einem Lesefehler mit
 * 2xx/4xx, der Anbieter (Stripe, SumUp, M365) stellte das Ereignis dann nicht erneut zu. Dort bei einem Fehler 500.
 *
 * Sweep 70 (09.10.2026): dasselbe für Listenabfragen – `const { data } = await ….from(…)….eq(…)`, alle(…), inBloecken(…),
 * .rpc(…), Storage – und für die Elemente von `const [{ data: a }, …] = await Promise.all([…])`. Ohne error wird aus einem
 * Datenbankfehler eine leere Liste: unvollständiger BMD-Export, Dokumente ohne Positionen, falsche Summen.
 * Ausnahme: // abfrage-ohne-fehler: <Grund, mind. 15 Zeichen> (einzelabfrage-ohne-fehler gilt ebenso).
 * Nicht erfasst: supabase.auth.* (Benutzer null = nicht angemeldet), Stripe (wirft selbst), fetch/res.json(), Graph.
 *
 * KAN-254 (09.10.2026): auch alle Dateien unter src/lib – Befunde: Benutzerlimit bei Lesefehler „unbegrenzt“, Rechnungssumme
 * zu klein (Zahlungen, E&A), PSM-Meldung mit Standardfrist, Absender-Index 60 s leer zwischengespeichert, Weinbuch ohne
 * Ziel-Gebinde. Fail-closed-Stellen (Rolle, Modul: Fehler = Ablehnung) sind begründet ausgenommen.
 *
 * Aufruf: node scripts/check-einzelabfrage.js   (Exit 1 bei Funden)
 * Für Tests: require('./check-einzelabfrage.js') → { pruefeText, pruefeWurzel } ohne Seiteneffekte;
 * S112_GUARD_ROOT prüft ein anderes Projektverzeichnis (scripts/tests/kan251-einzelabfrage.test.mjs).
 */
const fs = require('fs')
const path = require('path')
const { ohneKommentare } = require('./check-loeschen.js')

const ENDUNGEN = ['.ts', '.tsx']
const AUSNAHME = /(?:einzel)?abfrage-ohne-fehler\b/i
const AUSNAHME_GRUND = /(?:einzel)?abfrage-ohne-fehler\s*:\s*(.*)$/i
const MIN_GRUND = 15
const VORLAUF = 4
// Ergebnisse ohne Supabase-Fehlerobjekt bzw. Aufrufe, die selbst werfen
const KEINE_ABFRAGE = /\.auth\b|\bstripe\b|\bfetch\(|\.json\(\)|\bgraph(?:Get|Post)\b/
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

/** oberste Ebene einer Destrukturierung (verschachtelte { … } entfernt) */
const oben = inhalt => inhalt.replace(/\{[^{}]*\}/g, '')
const hat = (inhalt, schluessel) => new RegExp(`(^|,)\\s*${schluessel}\\b`).test(oben(inhalt))

/** → { funde: [{ zeile, text }], ausnahmen, geprueft }; route = Route-Handler (route.ts, KAN-252) */
function pruefeText(text, { route = false } = {}) {
  const funde = []
  let ausnahmen = 0, geprueft = 0
  if (!route && !istActionDatei(text)) return { funde, ausnahmen, geprueft }
  const roh = text.split('\n')
  const code = ohneKommentare(text)
  const zeileVon = i => code.slice(0, i).split('\n').length

  /** eine Destrukturierung { … } prüfen; art = 'einzel' | 'liste' */
  const pruefe = (inhalt, zeile, art) => {
    if (hat(inhalt, 'error')) { geprueft++; return }
    const marker = roh.slice(Math.max(0, zeile - 1 - VORLAUF), zeile).reverse().find(r => AUSNAHME.test(r))
    if (marker) {
      const grund = (AUSNAHME_GRUND.exec(marker.replace(/\r$/, ''))?.[1] ?? '').replace(/\*\/.*$/, '').trim()
      if (grund.length >= MIN_GRUND) { ausnahmen++; return }
      funde.push({ zeile, text: `„abfrage-ohne-fehler“ ohne ausreichende Begründung (mind. ${MIN_GRUND} Zeichen)` })
      return
    }
    funde.push({ zeile, text: art === 'einzel'
      ? 'Einzelabfrage (.maybeSingle()/.single()) ohne error – ein Datenbankfehler hieße „nicht vorhanden“'
      : 'Abfrage ohne error – ein Datenbankfehler hieße „leere Liste“' })
  }

  // 1) const { … } = await <Abfrage>
  const re = /\b(?:const|let)\s+\{/g
  let m
  while ((m = re.exec(code))) {
    const [inhalt, nach] = klammerInhalt(code, m.index + m[0].length - 1)
    const zuweisung = /^\s*(?::[^=]*)?=\s*await\b/.exec(code.slice(nach))
    if (!zuweisung) continue
    const start = nach + zuweisung[0].length
    const anweisung = code.slice(start, anweisungsEnde(code, start)).trim()
    if (/\.(maybeSingle|single)\(\s*\)$/.test(anweisung)) { pruefe(inhalt, zeileVon(m.index), 'einzel'); continue }
    // Liste: data auf oberster Ebene, kein Promise.* (eigener Zweig unten), kein Aufruf ohne Supabase-Fehlerobjekt
    if (!hat(inhalt, 'data') || /^Promise\./.test(anweisung) || KEINE_ABFRAGE.test(anweisung)) continue
    pruefe(inhalt, zeileVon(m.index), 'liste')
  }

  // 2) const [{ data: a }, { data: b }] = await Promise.all([ … ]) – jedes Element mit data braucht error
  const reA = /\b(?:const|let)\s+\[/g
  while ((m = reA.exec(code))) {
    const auf = m.index + m[0].length - 1
    let tiefe = 0, j = auf
    for (; j < code.length; j++) {
      if (code[j] === '[') tiefe++
      else if (code[j] === ']') { tiefe--; if (tiefe === 0) break }
    }
    if (!/^\s*=\s*await\s+Promise\.all\b/.test(code.slice(j + 1))) continue
    const liste = code.slice(auf + 1, j)
    for (let k = 0; k < liste.length; k++) {
      if (liste[k] !== '{') continue
      const [inhalt, nach] = klammerInhalt(liste, k)
      // data: { user } u. ä. kommt nur aus supabase.auth.* (ohne Supabase-Fehlerobjekt im Sinn dieser Regel)
      if (hat(inhalt, 'data') && !/(^|,)\s*data\s*:\s*\{/.test(inhalt)) pruefe(inhalt, zeileVon(auf + 1 + k), 'liste')
      k = nach - 1
    }
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
    // KAN-254: Bibliotheken (src/lib) ebenso – dort liegen Rechte, Benutzerlimit, Rechnungssumme, Meldungs-Lader
    const route = path.basename(f) === 'route.ts' || path.relative(path.join(root, 'src', 'lib'), f).split(path.sep)[0] !== '..'
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
    console.error(`\n✖ check-einzelabfrage: ${e.funde.length} Fund(e) – Abfrage in einer Server Action bzw. Route ohne Fehlerprüfung:\n`)
    for (const x of e.funde) console.error('  ' + x)
    console.error('\n`error` mit übernehmen und auswerten (const { data, error: e } = … ; if (e) …) – oder begründen:')
    console.error('  // abfrage-ohne-fehler: <Grund ≥ 15 Zeichen>   (dieselbe Zeile oder bis zu vier Zeilen davor)\n')
    process.exit(1)
  }
  console.log(`✓ check-einzelabfrage: ${e.dateien} Server-Action-, Route- und Bibliotheksdateien, ${e.geprueft} Abfragen mit Fehlerprüfung, ${e.ausnahmen} begründete Ausnahme(n).`)
}
