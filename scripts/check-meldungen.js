#!/usr/bin/env node
/**
 * check-meldungen.js – Wächter „Meldungskästen sind gekennzeichnet“ (KAN-338, 14.10.2026)
 *
 * Rote Fehlerkästen (bg-s112-err-bg) und grüne Bestätigungskästen (bg-s112-ok-bg) tragen role="alert" bzw.
 * role="status". Damit lesen Vorleseprogramme sie vor, und MeldungsPopup zeigt eine neue Meldung zusätzlich als
 * Pop-up, wenn sie nach einer Aktion außer Sicht erscheint (lange Formulare: Fehler oben, „Speichern“ unten).
 * Gemeldet wird jedes div/p/section mit einem dieser Hintergründe, das kein Abzeichen ist (rounded-full) und wie ein
 * Kasten aussieht (rot: border oder text-sm; grün: border – grüne Flächen ohne Rahmen sind meist Kennzahl-Kacheln),
 * aber kein role-Attribut hat. Ausnahme je Element: `// meldung-ausnahme: <Grund ≥ 15 Zeichen>` bzw.
 * `{/* meldung-ausnahme: … *\/}` in den zwei Zeilen davor.
 *
 * Aufruf: node scripts/check-meldungen.js   (Exit 1 bei Funden)
 * Für Tests: require('./check-meldungen.js') → { kastenRolle, fundeIn } ohne Seiteneffekte.
 */
const fs = require('fs')
const path = require('path')

const AUSNAHME = /meldung-ausnahme:\s*\S.{13,}/
const KASTEN_TAGS = new Set(['div', 'p', 'section'])

/** Rolle, die ein Meldungskasten tragen muss ({ rolle, hatRole }), oder null, wenn das Element kein Kasten ist */
function kastenRolle(knoten, ts) {
  const tag = knoten.tagName.getText()
  if (!KASTEN_TAGS.has(tag)) return null
  const attr = knoten.attributes.properties
  const cn = attr.find(p => ts.isJsxAttribute(p) && p.name.getText() === 'className')
  if (!cn || !cn.initializer) return null
  const tokens = new Set(cn.initializer.getText().replace(/[`'"{}$():?]/g, ' ').split(/\s+/).filter(Boolean))
  const rot = tokens.has('bg-s112-err-bg')
  const gruen = tokens.has('bg-s112-ok-bg')
  if (!rot && !gruen) return null
  if (tokens.has('rounded-full')) return null
  const istKasten = (rot && (tokens.has('border') || tokens.has('text-sm'))) || (gruen && tokens.has('border'))
  if (!istKasten) return null
  const hatRole = attr.some(p => ts.isJsxAttribute(p) && p.name.getText() === 'role')
  return { rolle: rot && !gruen ? 'alert' : 'status', hatRole }
}

/** Funde einer Datei: [{ zeile, rolle }] – Kästen ohne role und ohne Ausnahme */
function fundeIn(quelltext, datei, ts) {
  const sf = ts.createSourceFile(datei, quelltext, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const zeilen = quelltext.split('\n')
  const funde = []
  ;(function besuch(k) {
    if (ts.isJsxOpeningElement(k) || ts.isJsxSelfClosingElement(k)) {
      const r = kastenRolle(k, ts)
      if (r && !r.hatRole) {
        const z = sf.getLineAndCharacterOfPosition(k.getStart()).line
        if (!AUSNAHME.test(zeilen[z] ?? '') && !AUSNAHME.test(zeilen[z - 1] ?? '') && !AUSNAHME.test(zeilen[z - 2] ?? '')) funde.push({ zeile: z + 1, rolle: r.rolle })
      }
    }
    ts.forEachChild(k, besuch)
  })(sf)
  return funde
}

module.exports = { kastenRolle, fundeIn }
if (require.main !== module) return

const ts = require('typescript')
const wurzel = path.join(__dirname, '..')
const dateien = []
;(function lauf(d) {
  for (const n of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, n.name)
    if (n.isDirectory()) { if (n.name !== 'node_modules') lauf(p) } else if (n.name.endsWith('.tsx')) dateien.push(p)
  }
})(path.join(wurzel, 'src'))

const ausgabe = []
let gekennzeichnet = 0
for (const d of dateien) {
  if (d.endsWith('MeldungsPopup.tsx')) continue   // das Pop-up selbst ist keine Meldung im Seitenfluss
  const s = fs.readFileSync(d, 'utf8')
  for (const f of fundeIn(s, d, ts)) ausgabe.push(`${path.relative(wurzel, d).replace(/\\/g, '/')}:${f.zeile}  Meldungskasten ohne role="${f.rolle}"`)
  const sf = ts.createSourceFile(d, s, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  ;(function besuch(k) {
    if ((ts.isJsxOpeningElement(k) || ts.isJsxSelfClosingElement(k)) && kastenRolle(k, ts)?.hatRole) gekennzeichnet++
    ts.forEachChild(k, besuch)
  })(sf)
}
if (ausgabe.length) {
  console.error(`✗ check-meldungen: ${ausgabe.length} Meldungskasten/-kästen ohne role (KAN-338):`)
  for (const a of ausgabe) console.error('  ' + a)
  console.error('  role="alert" (Fehler) bzw. role="status" (Bestätigung) ergänzen – sonst kein Pop-up und kein Vorlesen. Ausnahme: meldung-ausnahme: <Grund>')
  process.exit(1)
}
console.log(`✓ check-meldungen: ${gekennzeichnet} Meldungskästen mit role="alert"/"status" (Pop-up und Vorlesen).`)
