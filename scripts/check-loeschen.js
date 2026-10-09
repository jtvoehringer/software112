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
 * KAN-248 (09.10.2026): dieselbe Regel für .update() einer Supabase-Kette – ein UPDATE, das die RLS nicht zulässt oder
 * dessen Zeile fehlt, ändert still 0 Zeilen, die App meldete „gespeichert“. Als geprüft gilt: .select(…) in der Kette (auch
 * nach mehrzeiligen Argumenten), { count: 'exact' } oder let q = ….update(…) mit q.select(…) in den 15 Zeilen danach.
 * Ausgenommen ist die Service-Role (Variable mit „admin“ im Namen, createSupabaseAdminClient() direkt) – dort gibt es keine
 * RLS. Begründete Ausnahme: // aenderung-ohne-pruefung: <Grund, mind. 15 Zeichen> in der .update(-Zeile bzw. bis zu vier
 * Zeilen vor dem .from(. Meldung für den Fall 0 Zeilen: NICHT_GESPEICHERT aus src/lib/fehler.ts.
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
// KAN-248: dasselbe für .update() – ein UPDATE, das die RLS nicht zulässt (oder dessen Zeile fehlt), ändert still 0 Zeilen
const AUSNAHME_U = /aenderung-ohne-pruefung\b/i
const AUSNAHME_U_GRUND = /aenderung-ohne-pruefung\s*:\s*(.*)$/i
// Service-Role: keine RLS – ausgenommen (Variable mit „admin“ im Namen bzw. createSupabaseAdminClient() direkt)
const SERVICE_ROLE = /\b\w*[aA]dmin\w*\s*\.from\(|createSupabaseAdminClient\(\)\s*\.from\(/
// .from( einer Supabase-Abfrage – nicht Buffer.from/Array.from
const FROM = /(?<!Buffer|Array)\.from\(/
const VORLAUF = 4

/** Ersetzt Kommentare und String-Inhalte durch Leerzeichen (Zeilen und Längen bleiben). Ausdrücke in `${…}` eines
 *  Template-Strings bleiben Code (Sweep 76: vorher wurden sie mit geleert – alle Wächter übersahen z. B.
 *  `${Math.round(x * 100) / 100}` oder `${new Date().toISOString().slice(0, 10)}` in Template-Strings). */
function ohneKommentare(s) {
  return codeTeil(s, 0, false)[0]
}

const leer = z => (z === '\n' || z === '\r' ? z : ' ')

/** Code ab i; imAusdruck: endet vor der schließenden „}“ eines `${…}` → [Ausgabe, Index der „}“ bzw. Textende] */
function codeTeil(s, i, imAusdruck) {
  let out = ''
  let tiefe = 0
  while (i < s.length) {
    const c = s[i], n = s[i + 1]
    if (c === '/' && n === '/') { const e = s.indexOf('\n', i); const ende = e < 0 ? s.length : e; out += ' '.repeat(ende - i); i = ende; continue }
    if (c === '/' && n === '*') { const e = s.indexOf('*/', i + 2); const ende = e < 0 ? s.length : e + 2; out += s.slice(i, ende).replace(/[^\r\n]/g, ' '); i = ende; continue }
    if (c === "'" || c === '"') {
      let j = i + 1
      while (j < s.length && s[j] !== c) { if (s[j] === '\\') j++; else if (s[j] === '\n') break; j++ }
      // nicht geschlossen (Zeilenende, z. B. ein Apostroph in einer Regex): Zeilenumbruch NICHT verschlucken – sonst
      // verschieben sich alle folgenden Zeilennummern gegenüber dem Original (KAN-248)
      const geschlossen = j < s.length && s[j] === c
      out += c + s.slice(i + 1, j).replace(/[^\r\n]/g, ' ') + (geschlossen ? c : '')
      i = geschlossen ? j + 1 : j
      continue
    }
    if (c === '`') {
      out += c
      let j = i + 1
      while (j < s.length && s[j] !== '`') {
        if (s[j] === '\\') { out += leer(s[j]) + (j + 1 < s.length ? leer(s[j + 1]) : ''); j += 2; continue }
        if (s[j] === '$' && s[j + 1] === '{') {
          const [ausdruck, k] = codeTeil(s, j + 2, true)
          out += '${' + ausdruck + (k < s.length ? '}' : '')
          j = k + 1
          continue
        }
        out += leer(s[j])
        j++
      }
      if (j < s.length) out += '`'
      i = j + 1
      continue
    }
    if (imAusdruck) {
      if (c === '{') tiefe++
      else if (c === '}') { if (tiefe === 0) return [out, i]; tiefe-- }
    }
    out += c
    i++
  }
  return [out, i]
}

/** Text der Methodenkette ab code[idx][pos] (".update(") bis zum Ende der Anweisung: Klammern werden gezählt, danach
 *  geht es weiter, solange das nächste Zeichen (nach Leerraum) ein „.“ ist – so zählen mehrzeilige Argumente mit. */
function kettenText(code, roh, idx, pos) {
  const s = code.slice(idx).join('\n').slice(pos)
  let i = 0, tiefe = 0
  for (;;) {
    while (i < s.length && s[i] !== '(') i++          // Methodenname bis zur Klammer
    if (i >= s.length) break
    tiefe = 0
    for (; i < s.length; i++) {
      if (s[i] === '(') tiefe++
      else if (s[i] === ')') { tiefe--; if (tiefe === 0) { i++; break } }
    }
    let j = i
    while (j < s.length && /\s/.test(s[j])) j++
    if (s[j] !== '.') break
    i = j + 1
  }
  // Inhalt aus dem Originaltext (gleiche Länge): im Code sind Strings geleert – count: 'exact' stünde dort nicht
  return roh.slice(idx).join('\n').slice(pos).slice(0, i)
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
  // ── .update() einer Supabase-Kette (KAN-248) ──
  code.forEach((z, idx) => {
    const pos = z.indexOf('.update(')
    if (pos < 0) return
    // .from( in derselben Zeile davor oder in Vorzeilen der Kette (die mit „.“ beginnen); sonst keine Supabase-Kette
    let fromZeile = -1
    const davor = z.slice(0, pos)
    if (FROM.test(davor)) fromZeile = idx
    else if (davor.trim() === '') {
      for (let k = idx - 1; k >= 0 && k > idx - 8; k--) {
        if (FROM.test(code[k])) { fromZeile = k; break }
        if (!/^\s*\./.test(code[k])) break
      }
    }
    if (fromZeile < 0) return
    if (SERVICE_ROLE.test(code.slice(Math.max(0, fromZeile - 1), idx + 1).join('\n'))) return
    if (/\.select\(|count:\s*'exact'/.test(kettenText(code, roh, idx, pos))) { geprueft++; return }
    // let q = (….from(…)).update(…) … await q.select('id') – Prüfung über die Variable (Vergleichen und Setzen)
    const variable = /(?:let|const)\s+(\w+)\s*=/.exec(code[fromZeile])?.[1]
    if (variable && new RegExp(`\\b${variable}\\s*\\.select\\(`).test(code.slice(idx + 1, idx + 16).join('\n'))) { geprueft++; return }
    const marker = roh.slice(Math.max(0, fromZeile - VORLAUF), idx + 1).reverse().find(r => AUSNAHME_U.test(r))
    if (marker) {
      const grund = (AUSNAHME_U_GRUND.exec(marker.replace(/\r$/, ''))?.[1] ?? '').replace(/\*\/.*$/, '').trim()
      if (grund.length >= MIN_GRUND) { ausnahmen++; return }
      funde.push({ zeile: idx + 1, text: `„aenderung-ohne-pruefung“ ohne ausreichende Begründung (mind. ${MIN_GRUND} Zeichen)` })
      return
    }
    funde.push({ zeile: idx + 1, text: '.update() ohne .select(…) – RLS ändert still 0 Zeilen, die App meldete trotzdem „gespeichert“' })
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
    console.error('  // loeschen-ohne-pruefung: <Grund ≥ 15 Zeichen> bzw. // aenderung-ohne-pruefung: <Grund ≥ 15 Zeichen>')
    console.error('  (dieselbe Zeile oder bis zu vier Zeilen davor; Meldung bei 0 Zeilen: NICHT_GESPEICHERT aus src/lib/fehler.ts)\n')
    process.exit(1)
  }
  console.log(`✓ check-loeschen: ${e.dateien} Dateien, ${e.geprueft} Löschungen und Änderungen mit Zeilenprüfung, ${e.ausnahmen} begründete Ausnahme(n).`)
}
