#!/usr/bin/env node
/**
 * check-rueckfragen.js – Wächter „keine Browser-Dialoge“ (KAN-359, 22.10.2026)
 *
 * UAT (Paul): Meldungen erschienen an verschiedenen Orten und in verschiedener Form. Entscheidung Jörgen 22.10.2026
 * (Konzept docs/Meldungskonzept.md): Rückfragen über den eigenen Dialog (`await rueckfrage({ … })` aus
 * src/lib/ui/rueckfrage.ts, RueckfrageDialog im Root-Layout), Fehler am Formular bzw. Feld (role="alert"), Erfolg als
 * Pop-up (zeigeErfolg / <ErfolgsMeldung>). Die Browser-Dialoge sind nicht gestaltbar, am Handy klein, sperren die Seite
 * und werden je Browser anders angesagt.
 *
 * Gemeldet wird in src/ (.ts/.tsx) jeder Aufruf von window.confirm/alert/prompt (auch über globalThis/self) und von
 * confirm(…), alert(…), prompt(…) als globaler Funktion – nicht als Methode (`x.alert(`) oder Teil eines Namens
 * (`onAlert(`). Kommentare und Text in Anführungszeichen zählen nicht (ohneKommentare() aus check-loeschen.js).
 * Ausnahme je Stelle: `// rueckfrage-ok: <Grund ≥ 15 Zeichen>` in derselben Zeile oder bis zu zwei Zeilen davor.
 *
 * Aufruf: node scripts/check-rueckfragen.js   (Exit 1 bei Funden)
 * Für Tests: require('./check-rueckfragen.js') → { fundeIn } ohne Seiteneffekte.
 */
const fs = require('fs')
const path = require('path')
const { ohneKommentare } = require('./check-loeschen.js')

const AUSNAHME = /rueckfrage-ok:(.*)$/
const MIN_GRUND = 15
const VORLAUF = 2
// global: nicht nach „.“, Buchstabe, Ziffer, _ oder $ (Methode bzw. Teil eines Namens); über window/globalThis/self
const MUSTER = /(?:\b(?:window|globalThis|self)\s*\.\s*|(?<![.\w$]))(confirm|alert|prompt)\s*\(/g

/** Funde einer Datei: [{ zeile, art, text }] */
function fundeIn(quelltext) {
  const roh = quelltext.split('\n')
  const code = ohneKommentare(quelltext).split('\n')
  const funde = []
  code.forEach((z, idx) => {
    MUSTER.lastIndex = 0
    let m
    while ((m = MUSTER.exec(z))) {
      // Deklaration einer eigenen Funktion dieses Namens ist kein Aufruf
      if (/\bfunction\s*$/.test(z.slice(0, m.index))) continue
      const marker = roh.slice(Math.max(0, idx - VORLAUF), idx + 1).reverse().find(r => AUSNAHME.test(r))
      if (marker) {
        const grund = (AUSNAHME.exec(marker.replace(/\r$/, ''))?.[1] ?? '').replace(/\*\/.*$/, '').replace(/\}\s*$/, '').trim()
        if (grund.length >= MIN_GRUND) continue
        funde.push({ zeile: idx + 1, art: m[1], text: `„rueckfrage-ok“ ohne ausreichende Begründung (mind. ${MIN_GRUND} Zeichen)` })
        continue
      }
      const ersatz = m[1] === 'confirm' ? 'await rueckfrage({ titel, text, bestaetigen, gefaehrlich })'
        : m[1] === 'alert' ? 'Fehler als Meldung am Formular (role="alert"), Erfolg mit zeigeErfolg()'
          : 'Eingabefeld im Formular bzw. eigener Dialog'
      funde.push({ zeile: idx + 1, art: m[1], text: `${m[1]}() – Browser-Dialog; stattdessen ${ersatz}` })
    }
  })
  return funde
}

module.exports = { fundeIn }
if (require.main !== module) return

const wurzel = path.join(__dirname, '..')
const dateien = []
;(function lauf(d) {
  for (const n of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, n.name)
    if (n.isDirectory()) { if (n.name !== 'node_modules') lauf(p) } else if (/\.(ts|tsx)$/.test(n.name) && !n.name.endsWith('.d.ts')) dateien.push(p)
  }
})(path.join(wurzel, 'src'))

const ausgabe = []
for (const d of dateien) {
  const s = fs.readFileSync(d, 'utf8')
  if (!/confirm|alert|prompt/.test(s)) continue
  for (const f of fundeIn(s)) ausgabe.push(`${path.relative(wurzel, d).replace(/\\/g, '/')}:${f.zeile}  ${f.text}`)
}
if (ausgabe.length) {
  console.error(`✗ check-rueckfragen: ${ausgabe.length} Browser-Dialog(e) (KAN-359):`)
  for (const a of ausgabe) console.error('  ' + a)
  console.error('  Konzept: docs/Meldungskonzept.md. Ausnahme: // rueckfrage-ok: <Grund ≥ 15 Zeichen>')
  process.exit(1)
}
console.log(`✓ check-rueckfragen: keine Browser-Dialoge (confirm/alert/prompt) in ${dateien.length} Dateien.`)
