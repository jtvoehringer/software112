#!/usr/bin/env node
/**
 * check-zahl-locale.js – Wächter „Zahlen nie mit 'de-AT' formatieren“ (Sweep 95, 10.10.2026)
 *
 * Die Locale 'de-AT' gruppiert Zahlen in Browser und Node mit einem geschützten Leerzeichen: 1234567.5 → „1 234 567,5“.
 * Die CD-Vorgabe ist der Tausenderpunkt („1.234.567,5“) – deshalb formatiert src/lib/format.ts alle Zahlen mit
 * ZAHL_LOCALE ('de-DE'). Befund: 15 Stellen (Betriebsmittel-Lager, Grundstückskosten, CRM-Gemeinschaft, E-Label,
 * Meldungen zu Liter/kg/Prozent im Kellerbuch und in der Lese) formatierten trotzdem mit 'de-AT'. Datumsangaben
 * bleiben bei 'de-AT' (Monatsnamen wie „Jänner“).
 * Gemeldet: <Ausdruck>.toLocaleString('de-AT'[, Optionen]) – außer der Ausdruck ist new Date(…) oder die Optionen
 * enthalten Datumsfelder (timeZone, dateStyle, month, …) – sowie new Intl.NumberFormat('de-AT').
 * Richtig: fmtZahl/fmtEur/fmtProzent bzw. toLocaleString(ZAHL_LOCALE, …) aus src/lib/format.ts.
 * Sweep 96 (10.10.2026): Anzeige über x.toFixed(n) liefert einen Dezimalpunkt („0.1234 ha“, „72.5 %“, „1.5 MB“) – in
 * Erntemeldung, Pressung, Grundstücken, Reports, Kostenrechnung und Nachrichten. Gemeldet in src/app und src/components:
 * .toFixed(n) mit n ≠ 0, außer direkt gefolgt von .replace('.', ','); als Zahl weiterverwendet meldet es check-runden.
 * Richtig: fmtNum(x, n) / fmtHa / fmtKoord. Technische Werte (Schlüssel, URL) mit // zahl-locale-ok: <Grund>.
 * Begründete Ausnahme (z. B. ein Date in einer Variablen): // zahl-locale-ok: <Grund, mind. 15 Zeichen> in derselben
 * Zeile oder bis zu vier Zeilen davor.
 *
 * Aufruf: node scripts/check-zahl-locale.js   (Exit 1 bei Funden)
 * Für Tests: require('./check-zahl-locale.js') → { pruefeText, pruefeWurzel } ohne Seiteneffekte.
 */
const fs = require('fs')
const path = require('path')
const { ohneKommentare } = require('./check-loeschen.js')

const ENDUNGEN = ['.ts', '.tsx']
const AUSNAHME = /zahl-locale-ok\b/i
const AUSNAHME_GRUND = /zahl-locale-ok\s*:\s*(.*)$/i
const MIN_GRUND = 15
const VORLAUF = 4
const DATUMSFELDER = /\b(timeZone|dateStyle|timeStyle|year|month|day|weekday|hour|minute|second|era|hour12|hourCycle)\s*:/
const DE_AT = /^\s*['"`]de-AT['"`]/

/** Argumentliste ab Index i (s[i] === '(') → [Inhalt, Index nach ')'] */
function argumente(s, i) {
  let tiefe = 0
  for (let j = i; j < s.length; j++) {
    if (s[j] === '(' || s[j] === '{' || s[j] === '[') tiefe++
    else if (s[j] === ')' || s[j] === '}' || s[j] === ']') { tiefe--; if (tiefe === 0) return [s.slice(i + 1, j), j + 1] }
  }
  return [s.slice(i + 1), s.length]
}

/** Empfänger von „.toLocaleString“ bei idx (Bezeichner-, Member- und Klammerketten rückwärts) */
function empfaenger(code, idx) {
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
    if (/[\w$]/.test(code[i] ?? '')) {
      while (i >= 0 && /[\w$]/.test(code[i])) i--
      if (code[i] === '.' || (code[i] === '?' && code[i + 1] === '.')) { i -= code[i] === '.' && code[i - 1] === '?' ? 2 : 1; continue }
      // „new Date(…)“: Schlüsselwort new vor dem Bezeichner mitnehmen
      const davor = code.slice(Math.max(0, i - 3), i + 1)
      if (/new\s$/.test(davor)) i -= 4
    }
    break
  }
  return code.slice(i + 1, idx).trim()
}

function pruefeText(text, opts = {}) {
  const roh = text.split('\n')
  const code = ohneKommentare(text)
  const funde = []
  let ausnahmen = 0

  const re = /\.toLocaleString\(/g
  let m
  while ((m = re.exec(code))) {
    const auf = m.index + m[0].length - 1
    if (!DE_AT.test(text.slice(auf + 1, auf + 12))) continue
    const [args] = argumente(code, auf)
    if (DATUMSFELDER.test(args)) continue
    if (/^new\s+Date\b/.test(empfaenger(code, m.index))) continue
    melde(m.index, "Zahl mit 'de-AT' formatiert (Leerzeichen statt Tausenderpunkt: „1 234,5“) – ZAHL_LOCALE bzw. fmtZahl/fmtEur aus src/lib/format.ts verwenden")
  }
  const nf = /\bIntl\.NumberFormat\(/g
  while ((m = nf.exec(code))) {
    const auf = m.index + m[0].length - 1
    if (DE_AT.test(text.slice(auf + 1, auf + 12))) melde(m.index, "Intl.NumberFormat('de-AT') gruppiert mit Leerzeichen – ZAHL_LOCALE aus src/lib/format.ts verwenden")
  }
  if (opts.anzeige) {
    const tf = /\.toFixed\(/g
    while ((m = tf.exec(code))) {
      const auf = m.index + m[0].length - 1
      const [args, nach] = argumente(code, auf)
      if (/^\s*0\s*$/.test(args)) continue
      if (/^\s*\.replace\(\s*['"]\.['"]\s*,\s*['"],['"]\s*\)/.test(text.slice(nach, nach + 30))) continue
      melde(m.index, 'Anzeige über toFixed() zeigt einen Dezimalpunkt („0.1234 ha“) – fmtNum(x, n) / fmtHa aus src/lib/format.ts verwenden')
    }
  }
  return { funde, ausnahmen }

  function melde(index, meldung) {
    const zeile = code.slice(0, index).split('\n').length
    const marker = roh.slice(Math.max(0, zeile - 1 - VORLAUF), zeile).reverse().find(r => AUSNAHME.test(r))
    if (marker) {
      const grund = (AUSNAHME_GRUND.exec(marker.replace(/\r$/, ''))?.[1] ?? '').replace(/\*\/.*$/, '').trim()
      if (grund.length >= MIN_GRUND) { ausnahmen++; return }
      funde.push({ zeile, text: `„zahl-locale-ok“ ohne ausreichende Begründung (mind. ${MIN_GRUND} Zeichen)` })
      return
    }
    funde.push({ zeile, text: meldung })
  }
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
    const r = path.relative(root, f).split(path.sep).join('/')
    const e = pruefeText(fs.readFileSync(f, 'utf8'), { anzeige: /^src\/(app|components)\//.test(r) })
    ausnahmen += e.ausnahmen
    for (const x of e.funde) funde.push(`${r}:${x.zeile}  ${x.text}`)
  }
  return { funde, dateien: anzahl, ausnahmen }
}

module.exports = { pruefeText, pruefeWurzel }

if (require.main === module) {
  const ROOT = process.env.S112_GUARD_ROOT ? path.resolve(process.env.S112_GUARD_ROOT) : path.resolve(__dirname, '..')
  const e = pruefeWurzel(ROOT)
  if (e.funde.length) {
    console.error(`\n✖ check-zahl-locale: ${e.funde.length} Fund(e) – Zahlenanzeige ohne Tausenderpunkt bzw. Dezimalkomma:\n`)
    for (const x of e.funde) console.error('  ' + x)
    console.error("\nZAHL_LOCALE ('de-DE', Tausenderpunkt) bzw. fmtNum/fmtZahl/fmtEur/fmtHa aus src/lib/format.ts verwenden – oder begründen:")
    console.error('  // zahl-locale-ok: <Grund ≥ 15 Zeichen>   (dieselbe Zeile oder bis zu vier Zeilen davor)\n')
    process.exit(1)
  }
  console.log(`✓ check-zahl-locale: ${e.dateien} Dateien, keine Zahl mit 'de-AT' formatiert und keine Anzeige über toFixed() mit Dezimalpunkt, ${e.ausnahmen} begründete Ausnahme(n).`)
}
