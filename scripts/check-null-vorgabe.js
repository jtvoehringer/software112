#!/usr/bin/env node
/**
 * check-null-vorgabe.js – Wächter „eine eingegebene 0 bleibt 0“ (Sweep 85, 10.10.2026)
 *
 * parseFloat(…) || 13, parseInt(…) || null, Number(…) || 10 ersetzen nicht nur leere oder ungültige Eingaben, sondern
 * auch die Zahl 0: Standard-USt 0 % (Kleinunternehmer) wurde 13 %, eine Verkaufsposition mit 0 % (Export) bekam den
 * Standardsatz, 0 Skontotage wurden 10, „0 Tage Wartezeit“ eines Pflanzenschutzmittels wurde „unbekannt“, 0 % Stickstoff
 * eines PK-Düngers fehlte in der Bilanz. Richtig: zahlAus(x) bzw. ganzzahlAus(x) aus src/lib/format.ts (leer/ungültig →
 * null, 0 bleibt 0), mit Vorgabe: zahlAus(x) ?? 13. (Vorbild: ustSatzAus, KAN-240.)
 * Gemeldet: parseFloat( … ) / parseInt( … ) / Number( … ), direkt gefolgt von „||“ und einer anderen Vorgabe als 0 oder ''.
 * Begründete Ausnahme (0 ist dort ungültig, z. B. Port, Jahr, Stellenzahl): // null-vorgabe-ok: <Grund, mind. 15 Zeichen>
 * in derselben Zeile oder bis zu vier Zeilen davor.
 *
 * Aufruf: node scripts/check-null-vorgabe.js   (Exit 1 bei Funden)
 * Für Tests: require('./check-null-vorgabe.js') → { pruefeText, pruefeWurzel } ohne Seiteneffekte.
 */
const fs = require('fs')
const path = require('path')
const { ohneKommentare } = require('./check-loeschen.js')

const ENDUNGEN = ['.ts', '.tsx']
const AUSNAHME = /null-vorgabe-ok\b/i
const AUSNAHME_GRUND = /null-vorgabe-ok\s*:\s*(.*)$/i
const MIN_GRUND = 15
const VORLAUF = 4
// „|| <Vorgabe>“, die nicht 0 bzw. leerer String ist (|| 0 ändert an einer 0 nichts)
const VORGABE = /^\s*\|\|(?!=)(?!\s*(?:0(?![\d.xXeE_])|''|""|``))/

/** Argumentliste ab Index i (s[i] === '(') → Index nach der schließenden Klammer */
function ende(s, i) {
  let tiefe = 0
  for (let j = i; j < s.length; j++) {
    if (s[j] === '(') tiefe++
    else if (s[j] === ')') { tiefe--; if (tiefe === 0) return j + 1 }
  }
  return s.length
}

function pruefeText(text) {
  const roh = text.split('\n')
  const code = ohneKommentare(text)
  const funde = []
  let ausnahmen = 0
  const re = /(?<![\w$.])(parseFloat|parseInt|Number)\(/g
  let m
  while ((m = re.exec(code))) {
    const nach = ende(code, m.index + m[0].length - 1)
    if (!VORGABE.test(code.slice(nach, nach + 40))) continue
    // rechter Teil eines Vergleichs (x !== Number(y) || …): Wahrheitswert, keine Vorgabe
    if (/(?:[=!]==?|[<>]=?)\s*$/.test(code.slice(Math.max(0, m.index - 6), m.index))) continue
    const zeile = code.slice(0, m.index).split('\n').length
    const marker = roh.slice(Math.max(0, zeile - 1 - VORLAUF), zeile).reverse().find(r => AUSNAHME.test(r))
    if (marker) {
      const grund = (AUSNAHME_GRUND.exec(marker.replace(/\r$/, ''))?.[1] ?? '').replace(/\*\/.*$/, '').trim()
      if (grund.length >= MIN_GRUND) { ausnahmen++; continue }
      funde.push({ zeile, text: `„null-vorgabe-ok“ ohne ausreichende Begründung (mind. ${MIN_GRUND} Zeichen)` })
      continue
    }
    funde.push({ zeile, text: `${m[1]}(…) || Vorgabe macht aus einer eingegebenen 0 die Vorgabe – zahlAus/ganzzahlAus (src/lib/format.ts) mit ?? verwenden` })
  }
  return { funde, ausnahmen }
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
    console.error(`✗ check-null-vorgabe: ${e.funde.length} Stelle(n), an denen eine eingegebene 0 zur Vorgabe wird:`)
    for (const f of e.funde) console.error('  ' + f)
    process.exit(1)
  }
  console.log(`✓ check-null-vorgabe: ${e.dateien} Dateien, keine Zahl-Eingabe mit „|| Vorgabe“, die eine 0 verschluckt, ${e.ausnahmen} begründete Ausnahme(n).`)
}
