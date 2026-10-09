#!/usr/bin/env node
/**
 * check-datum.js – Wächter „Kalendertage nie über toISOString() eines lokal gebauten Datums“ (KAN-255, 09.10.2026)
 *
 * toISOString() liefert UTC. Zwei Muster verschieben das Datum deshalb je nach Zeitzone um einen Tag:
 *   1. new Date(jahr, monat, tag …).toISOString()  – ein LOKAL gebautes Datum: im Browser (Wien) ist lokale Mitternacht
 *      in UTC 22 bzw. 23 Uhr des Vortags. Befund: die BMD-Übergabe schlug als Vormonat den 31.08.–29.09. statt
 *      01.09.–30.09. vor. Richtig: lokalerTag(new Date(j, m, t)) aus src/lib/datum/wien.ts.
 *   2. new Date().toISOString().slice(0, 10) (bzw. split('T')[0], substring(0, 10)) – „heute“ in UTC: zwischen 0 und 1 bzw.
 *      2 Uhr Wiener Zeit noch der Vortag (KAN-237). Richtig: heuteWien() bzw. wienTag(zeitpunkt).
 * Nicht gemeldet: new Date(Date.UTC(…)) und Rechnungen auf UTC-Mitternacht ('JJJJ-MM-TTT00:00:00Z') – die sind richtig.
 * Begründete Ausnahme: // datum-ok: <Grund, mind. 15 Zeichen> in derselben Zeile oder bis zu vier Zeilen davor.
 *
 * Aufruf: node scripts/check-datum.js   (Exit 1 bei Funden)
 * Für Tests: require('./check-datum.js') → { pruefeText, pruefeWurzel } ohne Seiteneffekte.
 */
const fs = require('fs')
const path = require('path')
const { ohneKommentare } = require('./check-loeschen.js')

const ENDUNGEN = ['.ts', '.tsx']
const AUSNAHME = /datum-ok\b/i
const AUSNAHME_GRUND = /datum-ok\s*:\s*(.*)$/i
const MIN_GRUND = 15
const VORLAUF = 4
const HEUTE_UTC = /new Date\(\s*\)\s*\.toISOString\(\)\s*\.\s*(?:slice\(\s*0\s*,\s*10\s*\)|substring\(\s*0\s*,\s*10\s*\)|split\(\s*(['"])[T ]\1\s*\)\s*\[\s*0\s*\])/g   // ohneKommentare leert Strings: 'T' → ' '

/** Argumentliste ab Index i (s[i] === '(') → [Inhalt, Index nach ')'] */
function argumente(s, i) {
  let tiefe = 0
  for (let j = i; j < s.length; j++) {
    if (s[j] === '(') tiefe++
    else if (s[j] === ')') { tiefe--; if (tiefe === 0) return [s.slice(i + 1, j), j + 1] }
  }
  return [s.slice(i + 1), s.length]
}

/** Komma auf oberster Ebene der Argumente (mehr als ein Argument = lokal gebautes Datum) */
function mehrereArgumente(a) {
  let tiefe = 0
  for (const c of a) {
    if (c === '(' || c === '[' || c === '{') tiefe++
    else if (c === ')' || c === ']' || c === '}') tiefe--
    else if (c === ',' && tiefe === 0) return true
  }
  return false
}

function pruefeText(text) {
  const roh = text.split('\n')
  const code = ohneKommentare(text)
  const funde = []
  let ausnahmen = 0
  const zeileVon = i => code.slice(0, i).split('\n').length
  const melde = (index, meldung) => {
    const zeile = zeileVon(index)
    const marker = roh.slice(Math.max(0, zeile - 1 - VORLAUF), zeile).reverse().find(r => AUSNAHME.test(r))
    if (marker) {
      const grund = (AUSNAHME_GRUND.exec(marker.replace(/\r$/, ''))?.[1] ?? '').replace(/\*\/.*$/, '').trim()
      if (grund.length >= MIN_GRUND) { ausnahmen++; return }
      funde.push({ zeile, text: `„datum-ok“ ohne ausreichende Begründung (mind. ${MIN_GRUND} Zeichen)` })
      return
    }
    funde.push({ zeile, text: meldung })
  }
  // 1) new Date(a, b, …).toISOString()
  const re = /new Date\(/g
  let m
  while ((m = re.exec(code))) {
    const [args, nach] = argumente(code, m.index + m[0].length - 1)
    if (!mehrereArgumente(args) || /Date\.UTC\(/.test(args)) continue
    if (!/^\s*\.toISOString\(\)/.test(code.slice(nach))) continue
    melde(m.index, 'lokal gebautes Datum über toISOString() (UTC) – Tag verschiebt sich je nach Zeitzone; lokalerTag() verwenden')
  }
  // 2) new Date().toISOString().slice(0, 10) u. ä.
  HEUTE_UTC.lastIndex = 0
  while ((m = HEUTE_UTC.exec(code))) melde(m.index, '„heute“ in UTC – bis 1 bzw. 2 Uhr der Vortag; heuteWien() bzw. wienTag() verwenden')
  // 3) Sweep 78: Datum/Uhrzeit formatieren ohne timeZone in Server-Code (Vercel läuft in UTC) – Zeitstempel zeigen die
  //    UTC-Uhrzeit (1–2 h zu früh) und zwischen 0 und 2 Uhr den Vortag. Client-Komponenten laufen im Browser (Wien).
  if (!/^\s*['"]use client['"]/.test(text)) {
    const FORMAT = /\.(toLocaleDateString|toLocaleString|toLocaleTimeString)\(|new Intl\.DateTimeFormat\(/g
    while ((m = FORMAT.exec(code))) {
      const [, nach] = argumente(code, m.index + m[0].length - 1)
      const argsRoh = text.slice(m.index + m[0].length, nach - 1)
      if (/timeZone/.test(argsRoh)) continue
      if (m[1] === 'toLocaleString') {
        // nur Datumswerte – Zahlen (n.toLocaleString('de-DE', { maximumFractionDigits … })) sind nicht gemeint
        const vor = text.slice(Math.max(0, m.index - 70), m.index)
        const datumOpt = /\b(day|month|year|hour|minute|weekday|dateStyle|timeStyle)\b/.test(argsRoh)
        const datumEmpf = /(new Date\([^)]*\)|Date\)|[Dd]atum|zeit|_am\b|_at\b|At\b|stamp|jetzt|heute)\s*\)?\s*$/.test(vor)
        if (!datumOpt && !datumEmpf) continue
      }
      melde(m.index, "Datum/Uhrzeit ohne timeZone in Server-Code (UTC) – { timeZone: 'Europe/Vienna' } ergänzen")
    }
    // 4) Sweep 79: „jetzt“ als new Date() und dann Jahr/Monat/Tag/Stunde über get…() – auf dem UTC-Server am Monats-
    //    bzw. Jahreswechsel bis 1 bzw. 2 Uhr noch der alte Monat/das alte Jahr. Richtig: wienJetzt().
    const GET = 'getFullYear|getMonth|getDate|getHours|getDay'
    const DIREKT = new RegExp('new Date\\(\\s*\\)\\s*\\.\\s*(?:' + GET + ')\\(', 'g')
    while ((m = DIREKT.exec(code))) melde(m.index, '„jetzt“ über new Date().get…() in Server-Code (UTC) – wienJetzt() aus src/lib/datum/wien.ts verwenden')
    const VARIABLE = /(?:const|let)\s+(\w+)\s*=\s*new Date\(\s*\)/g
    while ((m = VARIABLE.exec(code))) {
      if (new RegExp('\\b' + m[1] + '\\s*\\.\\s*(?:' + GET + ')\\(').test(code.slice(m.index))) {
        melde(m.index, `„jetzt“ (${m[1]} = new Date()) über get…() in Server-Code (UTC) – wienJetzt() aus src/lib/datum/wien.ts verwenden`)
      }
    }
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
    console.error(`\n✖ check-datum: ${e.funde.length} Fund(e) – Kalendertag über toISOString() (UTC):\n`)
    for (const x of e.funde) console.error('  ' + x)
    console.error('\nlokalerTag(new Date(j, m, t)), heuteWien() bzw. wienTag() aus src/lib/datum/wien.ts verwenden – oder begründen:')
    console.error('  // datum-ok: <Grund ≥ 15 Zeichen>   (dieselbe Zeile oder bis zu vier Zeilen davor)\n')
    process.exit(1)
  }
  console.log(`✓ check-datum: ${e.dateien} Dateien, keine Kalendertage über toISOString() eines lokalen Datums, keine Datumsanzeige ohne Zeitzone und kein „jetzt“ in UTC im Server-Code, ${e.ausnahmen} begründete Ausnahme(n).`)
}
