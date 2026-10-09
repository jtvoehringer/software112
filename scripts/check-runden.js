#!/usr/bin/env node
/**
 * check-runden.js – Wächter „Kommastellen nie über Math.round(x * 10^n) / 10^n“ (Sweep 76, 09.10.2026)
 *
 * Math.round rechnet im Binärformat: 1,005 · 100 = 100,4999… → 1,00 statt 1,01 (ebenso 0,285, 2,675, 5,025) und rundet
 * negative halbe Werte Richtung +∞ (−0,125 → −0,12). Auch der Zuschlag Number.EPSILON hilft nicht (2,135 → 2,13).
 * Postgres rundet numeric kaufmännisch und exakt – Rechnungs-, Zahlungs- und BMD-Beträge der App wichen um einen Cent
 * von der Datenbank ab. Richtig: rund(x, stellen) bzw. rund2/rund3 aus src/lib/zahl/runden.ts (über runden() aus lib/csv).
 * Gemeldet: Math.round(<Ausdruck mit *>) / <10, 100, …, 10 ** n, Math.pow(10, n) oder Bezeichner>.
 * Nicht gemeldet: Math.round(x) ohne Division (ganze Einheiten, Cent-Zähler) – dort gibt es keine Nachkommastelle.
 * Begründete Ausnahme: // runden-ok: <Grund, mind. 15 Zeichen> in derselben Zeile oder bis zu vier Zeilen davor.
 *
 * Aufruf: node scripts/check-runden.js   (Exit 1 bei Funden)
 * Für Tests: require('./check-runden.js') → { pruefeText, pruefeWurzel } ohne Seiteneffekte.
 */
const fs = require('fs')
const path = require('path')
const { ohneKommentare } = require('./check-loeschen.js')

const ENDUNGEN = ['.ts', '.tsx']
const AUSNAHME = /runden-ok\b/i
const AUSNAHME_GRUND = /runden-ok\s*:\s*(.*)$/i
const MIN_GRUND = 15
const VORLAUF = 4
const TEILER = /^\s*\/\s*(?:10+\b|\(?\s*10\s*\*\*|Math\.pow\(\s*10\b|[A-Za-z_$][\w$]*\b(?!\s*\())/

/** Argumentliste ab Index i (s[i] === '(') → [Inhalt, Index nach ')'] */
function argumente(s, i) {
  let tiefe = 0
  for (let j = i; j < s.length; j++) {
    if (s[j] === '(') tiefe++
    else if (s[j] === ')') { tiefe--; if (tiefe === 0) return [s.slice(i + 1, j), j + 1] }
  }
  return [s.slice(i + 1), s.length]
}

function pruefeText(text) {
  const roh = text.split('\n')
  const code = ohneKommentare(text)
  const funde = []
  let ausnahmen = 0
  const re = /Math\.round\(/g
  let m
  while ((m = re.exec(code))) {
    const [args, nach] = argumente(code, m.index + m[0].length - 1)
    if (!/\*/.test(args) || !TEILER.test(code.slice(nach))) continue
    const zeile = code.slice(0, m.index).split('\n').length
    const marker = roh.slice(Math.max(0, zeile - 1 - VORLAUF), zeile).reverse().find(r => AUSNAHME.test(r))
    if (marker) {
      const grund = (AUSNAHME_GRUND.exec(marker.replace(/\r$/, ''))?.[1] ?? '').replace(/\*\/.*$/, '').trim()
      if (grund.length >= MIN_GRUND) { ausnahmen++; continue }
      funde.push({ zeile, text: `„runden-ok“ ohne ausreichende Begründung (mind. ${MIN_GRUND} Zeichen)` })
      continue
    }
    funde.push({ zeile, text: 'Math.round(x * 10^n) / 10^n rundet binär (1,005 → 1,00) – rund(x, n) aus src/lib/zahl/runden.ts verwenden' })
  }
  // Sweep 77: toFixed als Rundung – Number(x.toFixed(n)), parseFloat(x.toFixed(n)), +(x).toFixed(n): ebenso binär
  const tf = /\.toFixed\(/g
  while ((m = tf.exec(code))) {
    const [, nach] = argumente(code, m.index + m[0].length - 1)
    if (!alsZahl(code, m.index, nach)) continue
    melde(m.index, 'toFixed() als Rundung (Ergebnis wieder als Zahl) rundet binär (1,005 → 1,00) – rund(x, n) aus src/lib/zahl/runden.ts verwenden')
  }
  return { funde, ausnahmen }

  function melde(index, meldung) {
    const zeile = code.slice(0, index).split('\n').length
    const marker = roh.slice(Math.max(0, zeile - 1 - VORLAUF), zeile).reverse().find(r => AUSNAHME.test(r))
    if (marker) {
      const grund = (AUSNAHME_GRUND.exec(marker.replace(/\r$/, ''))?.[1] ?? '').replace(/\*\/.*$/, '').trim()
      if (grund.length >= MIN_GRUND) { ausnahmen++; return }
      funde.push({ zeile, text: `„runden-ok“ ohne ausreichende Begründung (mind. ${MIN_GRUND} Zeichen)` })
      return
    }
    funde.push({ zeile, text: meldung })
  }
}

/** Wird das Ergebnis von „….toFixed(n)“ (Aufruf bei idx, Ende bei nach) wieder zur Zahl? – unmittelbar umschlossen von
 *  Number( … ) bzw. parseFloat( … ) oder als +( … ) bzw. +x.toFixed(n). Die Klammer muss direkt nach dem Aufruf enden. */
function alsZahl(code, idx, nach) {
  let j = nach
  while (/\s/.test(code[j] ?? '')) j++
  // Beginn des Ausdrucks vor „.toFixed“ suchen: Bezeichner/Klammerausdruck rückwärts
  let i = idx - 1
  for (;;) {
    while (i >= 0 && /\s/.test(code[i])) i--
    if (code[i] === ')' || code[i] === ']') {
      const zu = code[i], auf = zu === ')' ? '(' : '['
      let t = 0
      for (; i >= 0; i--) { if (code[i] === zu) t++; else if (code[i] === auf) { t--; if (t === 0) break } }
      i--
      continue
    }
    if (/[\w$]/.test(code[i] ?? '')) { while (i >= 0 && /[\w$]/.test(code[i])) i--; if (code[i] === '.' || (code[i] === '?' && code[i + 1] === '.')) { i--; continue } }
    break
  }
  // i zeigt auf das Zeichen vor dem Ausdruck
  let k = i
  while (k >= 0 && /\s/.test(code[k])) k--
  // unäres + (davor kein Operand – auch kein String-Ende: ' · ' + x.toFixed(2) ist Verkettung)
  const OPERAND_ENDE = /[\w)\]$'"`]/
  if (code[k] === '+' && !OPERAND_ENDE.test(code.slice(0, k).trimEnd().slice(-1) || '')) return true   // +x.toFixed(n)
  if (code[k] === '(' && code[j] === ')') {
    let v = k - 1
    while (v >= 0 && /\s/.test(code[v])) v--
    const vorher = code.slice(Math.max(0, v - 10), v + 1)
    if (/(?:\bNumber|\bparseFloat)$/.test(vorher)) return true
    if (code[v] === '+' && !OPERAND_ENDE.test(code.slice(0, v).trimEnd().slice(-1) || '')) return true   // +( x.toFixed(n) )
  }
  return false
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
  let anzahl = 0, ausnahmen = 0
  for (const f of dateien(path.join(root, 'src'))) {
    anzahl++
    const e = pruefeText(fs.readFileSync(f, 'utf8'))
    ausnahmen += e.ausnahmen
    const r = path.relative(root, f).split(path.sep).join('/')
    for (const x of e.funde) funde.push(`${r}:${x.zeile}  ${x.text}`)
  }
  return { funde, dateien: anzahl, ausnahmen }
}

module.exports = { pruefeText, pruefeWurzel }

if (require.main === module) {
  const ROOT = process.env.S112_GUARD_ROOT ? path.resolve(process.env.S112_GUARD_ROOT) : path.resolve(__dirname, '..')
  const e = pruefeWurzel(ROOT)
  if (e.funde.length) {
    console.error(`\n✖ check-runden: ${e.funde.length} Fund(e) – Kommastellen über Math.round(x * 10^n) / 10^n:\n`)
    for (const x of e.funde) console.error('  ' + x)
    console.error('\nrund(x, stellen) bzw. rund2/rund3 aus src/lib/zahl/runden.ts verwenden – oder begründen:')
    console.error('  // runden-ok: <Grund ≥ 15 Zeichen>   (dieselbe Zeile oder bis zu vier Zeilen davor)\n')
    process.exit(1)
  }
  console.log(`✓ check-runden: ${e.dateien} Dateien, keine Kommastellen über Math.round(x * 10^n) / 10^n oder toFixed() als Rundung, ${e.ausnahmen} begründete Ausnahme(n).`)
}
