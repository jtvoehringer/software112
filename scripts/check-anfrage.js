#!/usr/bin/env node
/**
 * check-anfrage.js – Wächter „Inhalt einer Anfrage nie ungeschützt lesen“ (Sweep 103, 10.10.2026)
 *
 * req.json() / req.formData() werfen bei leerem oder kaputtem Inhalt (abgebrochener Upload, falscher Content-Type).
 * Außerhalb eines try antwortet Next.js dann mit einer HTML-Fehlerseite (500) – der Client scheitert an res.json()
 * („Unexpected token <“) statt eine Meldung zu zeigen. Befund: 8 Route-Handler (Belege- und Dokument-Upload, Füllungsbilder,
 * Kostenrechnung, Profil, Release-Notes, SumUp-Kasse, Visitenkarte).
 * Gemeldet in src/app/**\/route.ts: <req|request>.json() bzw. .formData() außerhalb eines try-Blocks und ohne .catch(…).
 * Richtig: jsonBody(req) / formBody(req) aus src/lib/api/body.ts (null → ungueltigeAnfrage()).
 * Begründete Ausnahme: // anfrage-ok: <Grund, mind. 15 Zeichen> in derselben Zeile oder bis zu zwei Zeilen davor.
 *
 * Aufruf: node scripts/check-anfrage.js   (Exit 1 bei Funden)
 * Für Tests: require('./check-anfrage.js') → { pruefeText, pruefeWurzel } ohne Seiteneffekte.
 */
const fs = require('fs')
const path = require('path')
const ts = require('typescript')

const AUSNAHME = /anfrage-ok\s*:\s*(.*)$/i
const MIN_GRUND = 15

function pruefeText(text, datei = 'route.ts') {
  const sf = ts.createSourceFile(datei, text, ts.ScriptTarget.Latest, true)
  const zeilen = text.split('\n')
  const funde = []
  let stellen = 0, ausnahmen = 0
  function besuch(n, imTry) {
    if (ts.isTryStatement(n)) {
      besuch(n.tryBlock, true)
      if (n.catchClause) besuch(n.catchClause, imTry)
      if (n.finallyBlock) besuch(n.finallyBlock, imTry)
      return
    }
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && ['json', 'formData'].includes(n.expression.name.text)
      && ts.isIdentifier(n.expression.expression) && /^(req|request)$/.test(n.expression.expression.text)) {
      stellen++
      const p = n.parent
      const mitCatch = ts.isPropertyAccessExpression(p) && p.name.text === 'catch'
      if (!imTry && !mitCatch) {
        const zeile = sf.getLineAndCharacterOfPosition(n.getStart()).line + 1
        const marker = zeilen.slice(Math.max(0, zeile - 3), zeile).reverse().map(r => AUSNAHME.exec(r.replace(/\r$/, ''))).find(Boolean)
        if (marker && marker[1].trim().length >= MIN_GRUND) ausnahmen++
        else funde.push({ zeile, text: marker
          ? `„anfrage-ok“ ohne ausreichende Begründung (mind. ${MIN_GRUND} Zeichen)`
          : `${n.getText()} ungeschützt – bei leerem/kaputtem Inhalt HTML-500; jsonBody(req)/formBody(req) aus src/lib/api/body.ts verwenden` })
      }
    }
    ts.forEachChild(n, c => besuch(c, imTry))
  }
  besuch(sf, false)
  return { funde, stellen, ausnahmen }
}

function* routen(dir) {
  if (!fs.existsSync(dir)) return
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) yield* routen(p)
    else if (e.name === 'route.ts') yield p
  }
}

function pruefeWurzel(root) {
  const funde = []
  let dateien = 0, stellen = 0, ausnahmen = 0
  for (const f of routen(path.join(root, 'src', 'app'))) {
    dateien++
    const e = pruefeText(fs.readFileSync(f, 'utf8'), f)
    stellen += e.stellen; ausnahmen += e.ausnahmen
    const r = path.relative(root, f).split(path.sep).join('/')
    for (const x of e.funde) funde.push(`${r}:${x.zeile}  ${x.text}`)
  }
  return { funde, dateien, stellen, ausnahmen }
}

module.exports = { pruefeText, pruefeWurzel }

if (require.main === module) {
  const ROOT = process.env.S112_GUARD_ROOT ? path.resolve(process.env.S112_GUARD_ROOT) : path.resolve(__dirname, '..')
  const e = pruefeWurzel(ROOT)
  if (e.funde.length) {
    console.error(`\n✖ check-anfrage: ${e.funde.length} Fund(e) – Inhalt der Anfrage ungeschützt gelesen:\n`)
    for (const x of e.funde) console.error('  ' + x)
    console.error('\njsonBody(req) bzw. formBody(req) aus src/lib/api/body.ts verwenden (null → ungueltigeAnfrage()) – oder begründen:')
    console.error('  // anfrage-ok: <Grund ≥ 15 Zeichen>   (dieselbe Zeile oder bis zu zwei Zeilen davor)\n')
    process.exit(1)
  }
  console.log(`✓ check-anfrage: ${e.dateien} Route-Dateien, ${e.stellen} Lesestellen von json()/formData(), alle geschützt, ${e.ausnahmen} begründete Ausnahme(n).`)
}
