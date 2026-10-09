#!/usr/bin/env node
/**
 * check-laden.js – Wächter „Ladezustände immer zurücksetzen, Antworten nie verwerfen“ (Sweep 82, 09.10.2026)
 *
 * In Client-Komponenten ('use client', .tsx):
 *   1. setXyzLaden(true) / setSaving(true) / setSending(true) … und danach ein await im selben Block ohne try/finally:
 *      wirft der Aufruf (Netzwerkfehler, Server-Fehler, HTML statt JSON bei einem Timeout), bleibt der Knopf für immer
 *      gesperrt bzw. die Ladeanzeige dreht. Richtig: setX(true); try { … } finally { setX(false) } – bei Bedarf mit catch
 *      und Meldung (fehlerText aus src/lib/fehler.ts). Ein await in startTransition(async …) zählt nicht (eigener Ablauf).
 *   2. await fetch(…) als eigene Anweisung (Antwort verworfen): Befund CRM-Antwort-Mail – scheiterte das Senden, wurde der
 *      Text trotzdem gelöscht und das Fenster geschlossen. Richtig: const res = await fetch(…); if (!res.ok) …
 * Begründete Ausnahme: // laden-ok: <Grund, mind. 15 Zeichen> in derselben Zeile oder bis zu vier Zeilen davor.
 *
 * Aufruf: node scripts/check-laden.js   (Exit 1 bei Funden)
 * Für Tests: require('./check-laden.js') → { pruefeText, pruefeWurzel } ohne Seiteneffekte.
 */
const fs = require('fs')
const path = require('path')
const { ohneKommentare } = require('./check-loeschen.js')

const AUSNAHME = /laden-ok\b/i
const AUSNAHME_GRUND = /laden-ok\s*:\s*(.*)$/i
const MIN_GRUND = 15
const VORLAUF = 4
const LADE = /^set\w*(laden|loading|saving|sending|laeuft|uploading|speichern|moving|hinzu|ignoriere|busy|pending)$/i

/** Umschließender Block { … } um idx → [auf, zu] (Indizes der Klammern) */
function block(c, idx) {
  let t = 0, auf = -1
  for (let i = idx - 1; i >= 0; i--) {
    if (c[i] === '}') t++
    else if (c[i] === '{') { if (t === 0) { auf = i; break } t-- }
  }
  if (auf < 0) return null
  t = 0
  for (let i = auf; i < c.length; i++) { if (c[i] === '{') t++; else if (c[i] === '}') { t--; if (t === 0) return [auf, i] } }
  return null
}

function pruefeText(text) {
  if (!/^\s*['"]use client['"]/.test(text)) return { funde: [], ausnahmen: 0 }
  const roh = text.split('\n')
  const code = ohneKommentare(text)
  const funde = []
  let ausnahmen = 0
  const melde = (index, meldung) => {
    const zeile = code.slice(0, index).split('\n').length
    const marker = roh.slice(Math.max(0, zeile - 1 - VORLAUF), zeile).reverse().find(r => AUSNAHME.test(r))
    if (marker) {
      const grund = (AUSNAHME_GRUND.exec(marker.replace(/\r$/, ''))?.[1] ?? '').replace(/\*\/.*$/, '').trim()
      if (grund.length >= MIN_GRUND) { ausnahmen++; return }
      funde.push({ zeile, text: `„laden-ok“ ohne ausreichende Begründung (mind. ${MIN_GRUND} Zeichen)` })
      return
    }
    funde.push({ zeile, text: meldung })
  }
  // 1) Ladezustand ohne try/finally
  const re = /\b(set[A-Z]\w*)\(\s*true\s*\)/g
  let m
  while ((m = re.exec(code))) {
    if (!LADE.test(m[1])) continue
    const b = block(code, m.index)
    if (!b) continue
    const rest = code.slice(m.index, b[1])
    if (!/\bawait\b/.test(rest)) continue
    if (/\btry\s*\{/.test(rest) || /\bfinally\b/.test(rest) || /startTransition\(/.test(rest)) continue
    melde(m.index, `${m[1]}(true) vor await ohne try/finally – wirft der Aufruf, bleibt der Ladezustand hängen`)
  }
  // 2) await fetch(…) als eigene Anweisung (Antwort verworfen)
  const rf = /(^|[;{}\n])(\s*)await\s+fetch\(/g
  while ((m = rf.exec(code))) melde(m.index + m[1].length + m[2].length, 'await fetch(…) ohne Auswertung der Antwort – Fehler bleiben unbemerkt (res.ok prüfen)')
  return { funde, ausnahmen }
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
    console.error(`\n✖ check-laden: ${e.funde.length} Fund(e) – Ladezustand ohne try/finally bzw. verworfene fetch-Antwort:\n`)
    for (const x of e.funde) console.error('  ' + x)
    console.error('\nsetX(true); try { … } finally { setX(false) } bzw. const res = await fetch(…); if (!res.ok) … – oder begründen:')
    console.error('  // laden-ok: <Grund ≥ 15 Zeichen>   (dieselbe Zeile oder bis zu vier Zeilen davor)\n')
    process.exit(1)
  }
  console.log(`✓ check-laden: ${e.dateien} Client-Dateien, keine hängenden Ladezustände und keine verworfenen fetch-Antworten, ${e.ausnahmen} begründete Ausnahme(n).`)
}
