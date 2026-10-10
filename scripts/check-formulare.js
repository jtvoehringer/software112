#!/usr/bin/env node
/**
 * check-formulare.js – Wächter „Lange Formulare sind vor dem Verlust ungespeicherter Eingaben geschützt“ (Sweep 119)
 *
 * Wer in einem langen Formular versehentlich einen Menüpunkt anklickt, die Seite neu lädt oder den Tab schließt, verlor
 * bisher alle Eingaben ohne Rückfrage. UngespeichertSchutz (Root-Layout, src/lib/ui/ungespeichert.ts) fragt nach – für
 * Formulare mit dem Attribut data-ungespeichert. Gemeldet wird jedes <form> mit mindestens SCHWELLE Eingabefeldern
 * (input außer hidden/submit, select, textarea) ohne dieses Attribut. Such- und Filterformulare (method="get") sind
 * ausgenommen. Ausnahme je Formular: `{/* ungespeichert-ausnahme: <Grund ≥ 15 Zeichen> *\/}` bzw. `// …` davor.
 *
 * Aufruf: node scripts/check-formulare.js   (Exit 1 bei Funden)
 * Für Tests: require('./check-formulare.js') → { langeFormulare, SCHWELLE } ohne Seiteneffekte.
 */
const fs = require('fs')
const path = require('path')
const ts = require('typescript')

const SCHWELLE = 8
const AUSNAHME = /ungespeichert-ausnahme:\s*\S.{13,}/

/** Formulare einer Datei: [{ pos, ende, felder, geschuetzt, get, tagEnde }] (tagEnde = Ende des Tag-Namens „form“) */
function formulare(s, datei = 'x.tsx') {
  const sf = ts.createSourceFile(datei, s, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const out = []
  ;(function besuch(n) {
    if (ts.isJsxElement(n) && n.openingElement.tagName.getText() === 'form') {
      let felder = 0
      ;(function zaehle(k) {
        if ((ts.isJsxOpeningElement(k) || ts.isJsxSelfClosingElement(k)) && ['input', 'select', 'textarea'].includes(k.tagName.getText())) {
          const typ = k.attributes.properties.find(p => ts.isJsxAttribute(p) && p.name.getText() === 'type')
          if (!typ || !/["'](hidden|submit|button|reset)["']/.test(typ.getText())) felder++
        }
        ts.forEachChild(k, zaehle)
      })(n)
      const attr = n.openingElement.attributes.properties
      const geschuetzt = attr.some(p => ts.isJsxAttribute(p) && p.name.getText() === 'data-ungespeichert')
      const get = attr.some(p => ts.isJsxAttribute(p) && p.name.getText() === 'method' && /get/i.test(p.getText()))
      out.push({ pos: n.getStart(), felder, geschuetzt, get, tagEnde: n.openingElement.tagName.getEnd() })
    }
    ts.forEachChild(n, besuch)
  })(sf)
  return out
}

/** Lange, ungeschützte Formulare einer Datei (ohne Ausnahme-Kommentar in den zwei Zeilen davor) */
function langeFormulare(s, datei = 'x.tsx') {
  const zeilen = s.split('\n')
  return formulare(s, datei).filter(f => {
    if (f.geschuetzt || f.get || f.felder < SCHWELLE) return false
    const z = s.slice(0, f.pos).split('\n').length
    return !AUSNAHME.test(zeilen[z - 1] ?? '') && !AUSNAHME.test(zeilen[z - 2] ?? '') && !AUSNAHME.test(zeilen[z - 3] ?? '')
  }).map(f => ({ ...f, zeile: s.slice(0, f.pos).split('\n').length }))
}

function dateien(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) return e.name === 'node_modules' ? [] : dateien(p)
    return p.endsWith('.tsx') ? [p] : []
  })
}

module.exports = { formulare, langeFormulare, SCHWELLE }
if (require.main !== module) return

const wurzel = path.join(__dirname, '..')
let geschuetzt = 0
const funde = []
for (const d of dateien(path.join(wurzel, 'src'))) {
  const s = fs.readFileSync(d, 'utf8')
  geschuetzt += formulare(s, d).filter(f => f.geschuetzt).length
  for (const f of langeFormulare(s, d)) funde.push(`${path.relative(wurzel, d).replace(/\\/g, '/')}:${f.zeile}  <form> mit ${f.felder} Feldern ohne data-ungespeichert`)
}
if (funde.length) {
  console.error(`✗ check-formulare: ${funde.length} lange(s) Formular(e) ohne Schutz vor dem Verlust ungespeicherter Eingaben:`)
  for (const f of funde) console.error('  ' + f)
  console.error('  <form data-ungespeichert …> ergänzen (Rückfrage über UngespeichertSchutz). Ausnahme: ungespeichert-ausnahme: <Grund>')
  process.exit(1)
}
console.log(`✓ check-formulare: ${geschuetzt} Formulare mit Schutz vor dem Verlust ungespeicherter Eingaben, kein langes ohne.`)
