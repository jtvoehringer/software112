#!/usr/bin/env node
/**
 * check-textlaenge.js – Wächter „Formularfelder mit maxLength wie die Datenbankgrenze“ (Sweep 98, 10.10.2026)
 *
 * Spalten mit Längengrenze (varchar(n) bzw. CHECK length(…) <= n) stehen in scripts/text-grenzen.json mit ihren
 * Formularfeldern. Ohne maxLength am Feld scheitert eine zu lange Eingabe erst beim Speichern – im Weinexport sogar mit
 * dem rohen Datenbankfehler „value too long for type character varying(30)“ (EORI-Nummer), weil die Route nicht prüfte.
 * Gemeldet: ein eingetragenes Feld fehlt in seiner Datei, hat kein maxLength oder ein maxLength über der Grenze.
 * maxLength={KONSTANTE} gilt als gesetzt (der Wert steht dann in der Prüffunktion des Servers).
 * Neue Grenze in der Datenbank → scripts/text-grenzen.sql ausführen und die Spalte in text-grenzen.json eintragen.
 *
 * Aufruf: node scripts/check-textlaenge.js   (Exit 1 bei Funden)
 * Für Tests: require('./check-textlaenge.js') → { pruefeFeld, pruefeWurzel } ohne Seiteneffekte.
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

/** Prüft das Feld (input/textarea), dessen Start-Tag `feld` enthält. null = in Ordnung, sonst die Meldung. */
function pruefeFeld(text, feld, max) {
  const re = /<(input|textarea)\b/g
  let m, gefunden = 0
  const fehler = []
  while ((m = re.exec(text))) {
    const tag = text.slice(m.index, tagEnde(text, m.index + 6) + 1)
    if (!tag.includes(feld)) continue
    gefunden++
    const zeile = text.slice(0, m.index).split('\n').length
    const ml = /\bmaxLength=(?:\{\s*([^}]+?)\s*\}|"(\d+)")/.exec(tag)
    if (!ml) { fehler.push(`Zeile ${zeile}: kein maxLength (Grenze ${max})`); continue }
    const wert = ml[2] ?? ml[1]
    if (/^\d+$/.test(wert) && Number(wert) > max) fehler.push(`Zeile ${zeile}: maxLength ${wert} über der Grenze ${max}`)
  }
  if (!gefunden) return `Feld ${feld} nicht gefunden – text-grenzen.json nachziehen`
  return fehler.length ? fehler.join('; ') : null
}

function pruefeWurzel(root) {
  const liste = JSON.parse(fs.readFileSync(path.join(root, 'scripts', 'text-grenzen.json'), 'utf8'))
  const funde = []
  let felder = 0
  for (const s of liste.spalten) {
    for (const f of s.felder) {
      felder++
      const p = path.join(root, f.datei)
      if (!fs.existsSync(p)) { funde.push(`${f.datei}  (${s.spalte}) Datei fehlt – text-grenzen.json nachziehen`); continue }
      const e = pruefeFeld(fs.readFileSync(p, 'utf8'), f.feld, s.max)
      if (e) funde.push(`${f.datei}  ${s.spalte}: ${e}`)
    }
  }
  return { funde, spalten: liste.spalten.length, felder, ohneFormular: Object.keys(liste.ohne_formular ?? {}).length }
}

module.exports = { pruefeFeld, pruefeWurzel }

if (require.main === module) {
  const ROOT = process.env.S112_GUARD_ROOT ? path.resolve(process.env.S112_GUARD_ROOT) : path.resolve(__dirname, '..')
  const e = pruefeWurzel(ROOT)
  if (e.funde.length) {
    console.error(`\n✖ check-textlaenge: ${e.funde.length} Fund(e) – Formularfeld ohne passendes maxLength:\n`)
    for (const x of e.funde) console.error('  ' + x)
    console.error('\nmaxLength={<Grenze der Datenbank>} am Feld setzen (Liste: scripts/text-grenzen.json).\n')
    process.exit(1)
  }
  console.log(`✓ check-textlaenge: ${e.spalten} Spalten mit Längengrenze, ${e.felder} Formularfelder mit maxLength, ${e.ohneFormular} ohne Freitextfeld begründet.`)
}
