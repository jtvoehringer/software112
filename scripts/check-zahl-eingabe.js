#!/usr/bin/env node
/**
 * check-zahl-eingabe.js – Wächter „jedes Zahlenfeld mit ausdrücklichem step“ (Sweep 97, 10.10.2026)
 *
 * <input type="number"> ohne step erlaubt im Browser nur ganze Zahlen: „12,5“ bzw. „3,90“ gilt als ungültig, das Formular
 * lässt sich nicht absenden („Bitte gib einen gültigen Wert ein. Die zwei nächstliegenden gültigen Werte sind 12 und 13.“).
 * Befund: Weinexport – Versicherungswert (EUR) und Menge der Position (numeric(…,2), Einheit wählbar) nahmen keine
 * Nachkommastellen an. Damit die Frage „ganze Zahl oder Kommastellen?“ bei jedem Feld beantwortet ist, verlangt der Wächter
 * ein ausdrückliches step: step="1" für ganze Zahlen (Jahrgang, Tage, Anzahl), step="0.01" bzw. "any" für Beträge und Mengen.
 * Gemeldet: <input … type="number" …> (auch type={'number'}) ohne step-Attribut in src/**.tsx, seit KAN-292 auch
 * Platzhalter mit Dezimalpunkt („0.00“ statt „0,00“); seit Sweep 121 Textfelder für Zahlen ohne inputMode (Handy).
 *
 * Aufruf: node scripts/check-zahl-eingabe.js   (Exit 1 bei Funden)
 * Für Tests: require('./check-zahl-eingabe.js') → { pruefeText, pruefeWurzel } ohne Seiteneffekte.
 */
const fs = require('fs')
const path = require('path')

/** Ende des Start-Tags ab i (Klammern und Anführungszeichen beachtet) */
function tagEnde(t, i) {
  let tiefe = 0, q = null
  for (let j = i; j < t.length; j++) {
    const c = t[j]
    if (q) { if (c === q && t[j - 1] !== '\\') q = null; continue }
    if (c === '"' || c === "'" || c === '`') { q = c; continue }
    if (c === '{') tiefe++
    else if (c === '}') tiefe--
    else if (c === '>' && tiefe === 0) return j
  }
  return t.length
}

function pruefeText(text) {
  const funde = []
  let felder = 0
  const re = /<input\b/g
  let m
  while ((m = re.exec(text))) {
    const tag = text.slice(m.index, tagEnde(text, m.index + 6) + 1)
    if (!/\btype=(?:"number"|'number'|\{\s*['"]number['"]\s*\})/.test(tag)) continue
    felder++
    if (/\bstep=/.test(tag)) continue
    funde.push({ zeile: text.slice(0, m.index).split('\n').length, text: 'Zahlenfeld ohne step – Browser lässt nur ganze Zahlen zu; step="1" (ganze Zahl) bzw. step="0.01"/"any" (Kommastellen) angeben' })
  }
  // KAN-292 Rückmeldung (10.10.2026): Platzhalter mit Dezimalpunkt („0.00“, „z.B. 12.90“) – das Feld zeigte im leeren
  // Zustand englisches Zahlenformat. Drei Ziffern nach dem Punkt gelten als Tausenderpunkt („1.250“), x.y.z als Version.
  const ph = /placeholder="([^"]*)"/g
  while ((m = ph.exec(text))) {
    if (/^\d+\.\d+\.\d+$/.test(m[1])) continue
    if (/(^|[^\d.])(0\.\d+|\d+\.(?:\d{1,2}|\d{4,}))(?![\d.])/.test(m[1]))
      funde.push({ zeile: text.slice(0, m.index).split('\n').length, text: `Platzhalter „${m[1]}“ mit Dezimalpunkt – Dezimalkomma verwenden („0,00“)` })
  }
  // Sweep 121: Textfelder für Zahlen ohne inputMode – am Handy erscheint die Buchstabentastatur statt des Ziffernblocks.
  // Erkannt an einem rein numerischen Platzhalter („z.B. 4489781“, „0,00“, „28.500“; nicht Versionen „2.2.0“) oder einer
  // Beschriftung für Mengen/Beträge. Abhilfe: inputMode="decimal" (Kommastellen) bzw. "numeric" (Ziffern-Codes).
  const re2 = /<input\b/g
  while ((m = re2.exec(text))) {
    const tag = text.slice(m.index, tagEnde(text, m.index + 6) + 1)
    if (/\btype=(?:"|'|\{\s*['"])(?!text\b)/.test(tag)) continue          // nur Textfelder (ohne type bzw. type="text")
    if (/\binputMode=/.test(tag) || /\{\s*\.\.\./.test(tag)) continue
    const platz = /placeholder="([^"]*)"/.exec(tag)?.[1] ?? ''
    const zahlPlatz = /^(z\.\s?B\.\s?)?(\d{1,3}(\.\d{3})+(,\d+)?|\d+(,\d+)?)\s*(L|kg|€|%|ha)?$/.test(platz.trim())
    const beschriftung = /aria-label=(?:"([^"]*)"|\{`([^`]*)`\})/.exec(tag)
    const zahlName = /\b(Menge|Alkoholgehalt|Betrag|Preis|Liter|Einkünfte)\b/.test(beschriftung?.[1] ?? beschriftung?.[2] ?? '')
    if (zahlPlatz || zahlName)
      funde.push({ zeile: text.slice(0, m.index).split('\n').length, text: `Textfeld für Zahlen ohne inputMode – am Handy Buchstabentastatur; inputMode="decimal" bzw. "numeric" ergänzen` })
  }
  return { funde, felder }
}

function* dateien(dir) {
  if (!fs.existsSync(dir)) return
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) { if (e.name !== 'node_modules') yield* dateien(p) }
    else if (path.extname(e.name) === '.tsx') yield p
  }
}

function pruefeWurzel(root) {
  const funde = []
  let anzahl = 0, felder = 0
  for (const f of dateien(path.join(root, 'src'))) {
    anzahl++
    const e = pruefeText(fs.readFileSync(f, 'utf8'))
    felder += e.felder
    const r = path.relative(root, f).split(path.sep).join('/')
    for (const x of e.funde) funde.push(`${r}:${x.zeile}  ${x.text}`)
  }
  return { funde, dateien: anzahl, felder }
}

module.exports = { pruefeText, pruefeWurzel }

if (require.main === module) {
  const ROOT = process.env.S112_GUARD_ROOT ? path.resolve(process.env.S112_GUARD_ROOT) : path.resolve(__dirname, '..')
  const e = pruefeWurzel(ROOT)
  if (e.funde.length) {
    console.error(`\n✖ check-zahl-eingabe: ${e.funde.length} Fund(e) an Zahlen-Eingaben:\n`)
    for (const x of e.funde) console.error('  ' + x)
    console.error('\nstep="1" für ganze Zahlen, step="0.01" bzw. step="any" für Kommastellen; Textfelder für Zahlen mit inputMode="decimal" bzw. "numeric".\n')
    process.exit(1)
  }
  console.log(`✓ check-zahl-eingabe: ${e.dateien} Dateien, ${e.felder} Zahlenfelder, alle mit ausdrücklichem step.`)
}
