#!/usr/bin/env node
/**
 * check-werfen.js – Wächter „Fehler im Server-Code als AktionsFehler werfen“ (Sweep 108, 10.10.2026)
 *
 * Next.js ersetzt in Produktion den Text jedes Fehlers aus Server Actions und dem Aufbau von Server Components durch
 * „An error occurred in the Server Components render …“. Nur die Eigenschaft `digest` kommt unverändert an – darüber
 * transportiert AktionsFehler (src/lib/fehler.ts) die Meldung, fehlerText() liest sie aus. Befund: 225 Stellen in 106
 * Dateien warfen new Error(…), darunter geladen()/gezaehlt() (Ladefehler auf Hunderten Seiten) und alle Lader der
 * Behördenmeldungen – die Fehlerseite zeigte in Produktion nur „Unbekannter Fehler“, das Fehlerprotokoll ebenso.
 * Gemeldet: `throw new Error(` in Dateien unter src/ ohne 'use client'.
 * Richtig: throw new AktionsFehler(…) (Unterklasse von Error – catch und instanceof Error bleiben gleich).
 * Begründete Ausnahme: // werfen-ok: <Grund, mind. 15 Zeichen> in derselben Zeile oder bis zu zwei Zeilen davor.
 *
 * Aufruf: node scripts/check-werfen.js   (Exit 1 bei Funden)
 * Für Tests: require('./check-werfen.js') → { pruefeText, pruefeWurzel } ohne Seiteneffekte.
 */
const fs = require('fs')
const path = require('path')
const { ohneKommentare } = require('./check-loeschen.js')

const AUSNAHME = /werfen-ok\s*:\s*(.*)$/i
const MIN_GRUND = 15

function pruefeText(text) {
  if (/^\s*['"]use client['"]/m.test(text.slice(0, 300))) return { funde: [], ausnahmen: 0, client: true }
  const code = ohneKommentare(text)
  const zeilen = text.split('\n')
  const funde = []
  let ausnahmen = 0, m
  const re = /\bthrow\s+new\s+Error\s*\(/g
  while ((m = re.exec(code))) {
    const zeile = code.slice(0, m.index).split('\n').length
    const marker = zeilen.slice(Math.max(0, zeile - 3), zeile).reverse().map(r => AUSNAHME.exec(r.replace(/\r$/, ''))).find(Boolean)
    if (marker && marker[1].trim().length >= MIN_GRUND) { ausnahmen++; continue }
    funde.push({ zeile, text: marker
      ? `„werfen-ok“ ohne ausreichende Begründung (mind. ${MIN_GRUND} Zeichen)`
      : 'throw new Error(…) im Server-Code – Next.js blendet den Text in Produktion aus; throw new AktionsFehler(…) aus src/lib/fehler.ts' })
  }
  return { funde, ausnahmen, client: false }
}

function* dateien(dir) {
  if (!fs.existsSync(dir)) return
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) { if (e.name !== 'node_modules') yield* dateien(p) }
    else if (/\.tsx?$/.test(e.name)) yield p
  }
}

function pruefeWurzel(root) {
  const funde = []
  let server = 0, ausnahmen = 0
  for (const f of dateien(path.join(root, 'src'))) {
    const r = path.relative(root, f).split(path.sep).join('/')
    if (r === 'src/lib/fehler.ts') continue   // definiert AktionsFehler selbst
    const e = pruefeText(fs.readFileSync(f, 'utf8'))
    if (e.client) continue
    server++; ausnahmen += e.ausnahmen
    for (const x of e.funde) funde.push(`${r}:${x.zeile}  ${x.text}`)
  }
  return { funde, server, ausnahmen }
}

module.exports = { pruefeText, pruefeWurzel }

if (require.main === module) {
  const ROOT = process.env.S112_GUARD_ROOT ? path.resolve(process.env.S112_GUARD_ROOT) : path.resolve(__dirname, '..')
  const e = pruefeWurzel(ROOT)
  if (e.funde.length) {
    console.error(`\n✖ check-werfen: ${e.funde.length} Fund(e) – new Error im Server-Code (Text in Produktion ausgeblendet):\n`)
    for (const x of e.funde) console.error('  ' + x)
    console.error('\nthrow new AktionsFehler(…) aus src/lib/fehler.ts verwenden – oder begründen:')
    console.error('  // werfen-ok: <Grund ≥ 15 Zeichen>   (dieselbe Zeile oder bis zu zwei Zeilen davor)\n')
    process.exit(1)
  }
  console.log(`✓ check-werfen: ${e.server} Server-Dateien, kein new Error (Meldungen kommen über AktionsFehler an), ${e.ausnahmen} begründete Ausnahme(n).`)
}
