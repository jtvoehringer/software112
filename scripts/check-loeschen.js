#!/usr/bin/env node
/**
 * check-loeschen.js – Wächter „Löschen prüft, ob wirklich gelöscht wurde“ (KAN-243, 09.10.2026)
 *
 * Ein DELETE, das die RLS nicht zulässt, liefert KEINEN Fehler – PostgREST löscht still 0 Zeilen. Ohne Prüfung meldet
 * die App „gelöscht“, der Datensatz bleibt (Ried als Mitarbeiter, Produkt ohne DELETE-Policy – KAN-242; Kellerplan als
 * Mitarbeiter – KAN-243). Darum muss jedes `.delete()` einer Supabase-Abfrage in src/ die gelöschten Zeilen
 * zurückholen (`.select(…)` in derselben Kette) und auswerten – oder begründet ausgenommen sein:
 *   // loeschen-ohne-pruefung: <Grund, mind. 15 Zeichen>
 * in derselben Zeile oder in einer der vier Zeilen davor (vor dem Anfang der Anweisung). Typische Gründe: Service-Role
 * (keine RLS), Aufräumen abhängiger Zeilen, deren Fehlen nichts bedeutet, „0 Zeilen“ ist fachlich in Ordnung.
 *
 * Erkannt wird `.delete()` ohne Argumente (Map/Set/URLSearchParams.delete(x) haben eins). Die Kette reicht bis zum Ende
 * der Anweisung: Folgezeilen, die mit „.“ beginnen. Kommentare und Strings zählen nicht mit (`// .delete()` im Text).
 *
 * Aufruf: node scripts/check-loeschen.js   (Exit 1 bei Funden)
 * Für Tests: require('./check-loeschen.js') → { pruefeText, pruefeWurzel } ohne Seiteneffekte;
 * S112_GUARD_ROOT prüft ein anderes Projektverzeichnis (scripts/tests/check-loeschen.test.mjs).
 */
const fs = require('fs')
const path = require('path')

const ENDUNGEN = ['.ts', '.tsx']
const AUSNAHME = /loeschen-ohne-pruefung\b/i
const AUSNAHME_GRUND = /loeschen-ohne-pruefung\s*:\s*(.*)$/i
const MIN_GRUND = 15
const VORLAUF = 4

/** Ersetzt Kommentare und String-Inhalte durch Leerzeichen (Zeilen und Längen bleiben) */
function ohneKommentare(s) {
  let out = ''
  let i = 0
  while (i < s.length) {
    const c = s[i], n = s[i + 1]
    if (c === '/' && n === '/') { const e = s.indexOf('\n', i); const ende = e < 0 ? s.length : e; out += ' '.repeat(ende - i); i = ende; continue }
    if (c === '/' && n === '*') { const e = s.indexOf('*/', i + 2); const ende = e < 0 ? s.length : e + 2; out += s.slice(i, ende).replace(/[^\r\n]/g, ' '); i = ende; continue }
    if (c === "'" || c === '"' || c === '`') {
      let j = i + 1
      while (j < s.length && s[j] !== c) { if (s[j] === '\\') j++; else if (c !== '`' && s[j] === '\n') break; j++ }
      out += c + s.slice(i + 1, j).replace(/[^\r\n]/g, ' ') + (j < s.length ? c : '')
      i = j + 1
      continue
    }
    out += c
    i++
  }
  return out
}

/** → { funde: [{ zeile, text }], ausnahmen, geprueft } */
function pruefeText(text) {
  const roh = text.split('\n')
  const code = ohneKommentare(text).split('\n')
  const funde = []
  let ausnahmen = 0, geprueft = 0
  code.forEach((z, idx) => {
    const re = /\.delete\(\s*\)/g
    let m
    while ((m = re.exec(z))) {
      // Kette: Rest der Zeile + Folgezeilen, die mit „.“ beginnen
      let kette = z.slice(m.index + m[0].length)
      for (let k = idx + 1; k < code.length && /^\s*\./.test(code[k]); k++) kette += '\n' + code[k]
      if (/\.select\(/.test(kette)) { geprueft++; continue }
      const marker = roh.slice(Math.max(0, idx - VORLAUF), idx + 1).reverse().find(r => AUSNAHME.test(r))
      if (marker) {
        const grund = (AUSNAHME_GRUND.exec(marker.replace(/\r$/, ''))?.[1] ?? '').replace(/\*\/.*$/, '').trim()
        if (grund.length >= MIN_GRUND) { ausnahmen++; continue }
        funde.push({ zeile: idx + 1, text: `„loeschen-ohne-pruefung“ ohne ausreichende Begründung (mind. ${MIN_GRUND} Zeichen)` })
        continue
      }
      funde.push({ zeile: idx + 1, text: '.delete() ohne .select(…) – RLS löscht still 0 Zeilen, die App meldete trotzdem Erfolg' })
    }
  })
  return { funde, ausnahmen, geprueft }
}

function dateien(dir) {
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) return ['node_modules', '.next'].includes(e.name) ? [] : dateien(p)
    return ENDUNGEN.some(x => e.name.endsWith(x)) && !/\.test\.tsx?$/.test(e.name) ? [p] : []
  })
}

function pruefeWurzel(root) {
  const funde = []
  let anzahl = 0, ausnahmen = 0, geprueft = 0
  for (const f of dateien(path.join(root, 'src'))) {
    anzahl++
    const e = pruefeText(fs.readFileSync(f, 'utf8'))
    ausnahmen += e.ausnahmen
    geprueft += e.geprueft
    const r = path.relative(root, f).split(path.sep).join('/')
    for (const x of e.funde) funde.push(`${r}:${x.zeile}  ${x.text}`)
  }
  return { funde, dateien: anzahl, ausnahmen, geprueft }
}

module.exports = { pruefeText, pruefeWurzel, ohneKommentare }

if (require.main === module) {
  const ROOT = process.env.S112_GUARD_ROOT ? path.resolve(process.env.S112_GUARD_ROOT) : path.resolve(__dirname, '..')
  const e = pruefeWurzel(ROOT)
  if (e.funde.length) {
    console.error(`\n✖ check-loeschen: ${e.funde.length} Fund(e) – Löschen ohne Prüfung der gelöschten Zeilen (KAN-243):\n`)
    for (const x of e.funde) console.error('  ' + x)
    console.error('\nGelöschte Zeilen zurückholen (.select(\'id\')) und 0 Zeilen als Fehler melden – oder begründen:')
    console.error('  // loeschen-ohne-pruefung: <Grund ≥ 15 Zeichen>   (dieselbe Zeile oder bis zu vier Zeilen davor)\n')
    process.exit(1)
  }
  console.log(`✓ check-loeschen: ${e.dateien} Dateien, ${e.geprueft} Löschungen mit Zeilenprüfung, ${e.ausnahmen} begründete Ausnahme(n).`)
}
