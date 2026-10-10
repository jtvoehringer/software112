#!/usr/bin/env node
/**
 * check-fehlertext.js – Wächter „Datenbankfehler nie roh an den Benutzer“ (Sweep 99, 10.10.2026)
 *
 * 43 Server Actions und API-Routen gaben die Rohmeldung der Datenbank zurück ({ error: error.message } bzw.
 * NextResponse.json({ fehler: error.message })) – der Benutzer sah „duplicate key value violates unique constraint …“,
 * „value too long for type character varying(30)“ oder „invalid input syntax for type date: """. dbFehlerText()
 * (src/lib/fehler.ts) übersetzt diese Standardfehler seit Sweep 99 und reicht deutsche Meldungen aus RPCs und Triggern
 * unverändert durch.
 * Gemeldet in src/app und src/components: { error: X.message } / { fehler: X.message } sowie setXyz(X.message) und
 * setXyz(`…${X.message}…`) für X = error, err, e oder …Err/…Error. Zeilen mit instanceof (eigene Fehlerklassen mit
 * deutscher Meldung, z. B. JsmFehler) sind ausgenommen.
 * Richtig: dbFehlerText(X) bzw. dbFehlerText(X, 'Speichern fehlgeschlagen'); geworfene AktionsFehler übersetzt fehlerText()
 * im Client ohnehin. Begründete Ausnahme: // fehlertext-ok: <Grund, mind. 15 Zeichen> in derselben Zeile oder bis zu
 * zwei Zeilen davor (z. B. Supabase-Auth-Meldungen).
 *
 * Aufruf: node scripts/check-fehlertext.js   (Exit 1 bei Funden)
 * Für Tests: require('./check-fehlertext.js') → { pruefeText, pruefeWurzel } ohne Seiteneffekte.
 */
const fs = require('fs')
const path = require('path')

const VAR = '(?:error|err|e|[a-zA-Z]+Err(?:or)?)'
const MUSTER = [
  new RegExp(`\\b(?:error|fehler):\\s*${VAR}\\.message\\b`),
  new RegExp(`\\bset[A-Z]\\w*\\(\\s*${VAR}\\.message\\s*\\)`),
  new RegExp(`\\bset[A-Z]\\w*\\([^;]*\\$\\{\\s*${VAR}\\.message\\s*\\}`),
]
const AUSNAHME = /fehlertext-ok\s*:\s*(.*)$/i
const MIN_GRUND = 15

function pruefeText(text) {
  const zeilen = text.split('\n')
  const funde = []
  let ausnahmen = 0
  zeilen.forEach((z, i) => {
    const code = z.replace(/\/\/.*$/, '')
    if (/instanceof/.test(code) || !MUSTER.some(m => m.test(code))) return
    const marker = zeilen.slice(Math.max(0, i - 2), i + 1).reverse().map(r => AUSNAHME.exec(r.replace(/\r$/, ''))).find(Boolean)
    if (marker) {
      if (marker[1].trim().length >= MIN_GRUND) { ausnahmen++; return }
      funde.push({ zeile: i + 1, text: `„fehlertext-ok“ ohne ausreichende Begründung (mind. ${MIN_GRUND} Zeichen)` })
      return
    }
    funde.push({ zeile: i + 1, text: 'Rohmeldung der Datenbank an den Benutzer – dbFehlerText(…) aus src/lib/fehler.ts verwenden' })
  })
  return { funde, ausnahmen }
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
  let anzahl = 0, ausnahmen = 0
  for (const teil of ['src/app', 'src/components']) {
    for (const f of dateien(path.join(root, teil))) {
      anzahl++
      const e = pruefeText(fs.readFileSync(f, 'utf8'))
      ausnahmen += e.ausnahmen
      const r = path.relative(root, f).split(path.sep).join('/')
      for (const x of e.funde) funde.push(`${r}:${x.zeile}  ${x.text}`)
    }
  }
  return { funde, dateien: anzahl, ausnahmen }
}

module.exports = { pruefeText, pruefeWurzel }

if (require.main === module) {
  const ROOT = process.env.S112_GUARD_ROOT ? path.resolve(process.env.S112_GUARD_ROOT) : path.resolve(__dirname, '..')
  const e = pruefeWurzel(ROOT)
  if (e.funde.length) {
    console.error(`\n✖ check-fehlertext: ${e.funde.length} Fund(e) – Rohmeldung der Datenbank an den Benutzer:\n`)
    for (const x of e.funde) console.error('  ' + x)
    console.error("\ndbFehlerText(error[, 'Kontext']) aus src/lib/fehler.ts verwenden – oder begründen:")
    console.error('  // fehlertext-ok: <Grund ≥ 15 Zeichen>   (dieselbe Zeile oder bis zu zwei Zeilen davor)\n')
    process.exit(1)
  }
  console.log(`✓ check-fehlertext: ${e.dateien} Dateien, keine Rohmeldung der Datenbank an den Benutzer, ${e.ausnahmen} begründete Ausnahme(n).`)
}
