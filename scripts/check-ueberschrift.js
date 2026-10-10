#!/usr/bin/env node
/**
 * check-ueberschrift.js – Wächter „Jede Seite hat eine Hauptüberschrift (h1)“ (Sweep 114, 10.10.2026)
 *
 * Screenreader springen über die Überschriften durch eine Seite; ohne h1 fehlt der Einstieg (WCAG 2.4.6/1.3.1,
 * axe „page-has-heading-one“). Fund im ersten E2E-Lauf (KAN-309): Das Behandlungsprotokoll hatte nur einen fett
 * gesetzten Absatz als Titel. Der Smoke-Test sieht aber nur die Seiten der Navigation – 10 weitere Seiten (Login,
 * Nachrichten, Rechnung, DAC-Etikett, Blend-Protokolle, AMA, BSM, Cu- und Nährstoffbilanz) hatten ebenfalls keine.
 *
 * Geprüft wird jede page.tsx unter src/app, die etwas anzeigt (JSX): sie selbst oder eine der Dateien, die sie (bis zu
 * drei Ebenen tief, ohne src/lib) importiert, muss ein <h1> enthalten. Reine Weiterleitungen (kein JSX) sind ausgenommen.
 * Ohne sichtbaren Titel: <h1 className="sr-only">…</h1>. Ausnahme je Seite: `// ueberschrift-ausnahme: <Grund ≥ 15 Zeichen>`.
 *
 * Aufruf: node scripts/check-ueberschrift.js   (Exit 1 bei Funden)
 * Für Tests: require('./check-ueberschrift.js') → { hatH1, zeigtEtwasAn, pruefeSeiten } ohne Seiteneffekte.
 */
const fs = require('fs')
const path = require('path')

const H1 = /<h1[\s>]/
const AUSNAHME = /\/\/\s*ueberschrift-ausnahme:\s*\S.{13,}/

/** Import-Pfad (relativ oder @/) auflösen → Datei oder null */
function aufloesen(src, von, spec) {
  let basis
  if (spec.startsWith('@/')) basis = path.join(src, spec.slice(2))
  else if (spec.startsWith('.')) basis = path.resolve(path.dirname(von), spec)
  else return null
  for (const k of ['', '.tsx', '.ts', '/index.tsx', '/index.ts']) {
    const p = basis + k
    if (fs.existsSync(p) && fs.statSync(p).isFile()) return p
  }
  return null
}

/** true, wenn die Datei oder eine importierte (bis tiefe Ebenen, ohne src/lib) ein <h1> enthält */
function hatH1(src, datei, tiefe = 3, besucht = new Set(), lesen = (p) => fs.readFileSync(p, 'utf8')) {
  if (besucht.has(datei)) return false
  besucht.add(datei)
  const t = lesen(datei)
  if (H1.test(t)) return true
  if (tiefe === 0) return false
  for (const m of t.matchAll(/(?:import|export)\s[^'"]*?from\s+['"]([^'"]+)['"]/g)) {
    const p = aufloesen(src, datei, m[1])
    if (!p || /[\\/]src[\\/]lib[\\/]/.test(p)) continue
    if (hatH1(src, p, tiefe - 1, besucht, lesen)) return true
  }
  return false
}

/** Zeigt die Seite etwas an (JSX)? Reine Weiterleitungen (redirect/notFound ohne JSX) nicht. */
function zeigtEtwasAn(text) {
  const ohneKommentare = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
  return /<[A-Za-z>]/.test(ohneKommentare)
}

function seiten(dir) {
  const aus = []
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) aus.push(...seiten(p))
    else if (e.name === 'page.tsx') aus.push(p)
  }
  return aus
}

/** Alle Seiten unter src/app prüfen → { geprueft, funde: [Datei] } */
function pruefeSeiten(wurzel) {
  const src = path.join(wurzel, 'src')
  const funde = []
  let geprueft = 0
  for (const s of seiten(path.join(src, 'app'))) {
    const t = fs.readFileSync(s, 'utf8')
    if (!zeigtEtwasAn(t) || AUSNAHME.test(t)) continue
    geprueft++
    if (!hatH1(src, s)) funde.push(path.relative(wurzel, s).replace(/\\/g, '/'))
  }
  return { geprueft, funde }
}

if (require.main === module) {
  const { geprueft, funde } = pruefeSeiten(path.join(__dirname, '..'))
  if (funde.length) {
    console.error(`✗ check-ueberschrift: ${funde.length} Seite(n) ohne Hauptüberschrift (h1):`)
    for (const f of funde) console.error(`  ${f}`)
    console.error('  Titel als <h1> auszeichnen (ohne sichtbaren Titel: <h1 className="sr-only">…</h1>). Ausnahme: // ueberschrift-ausnahme: <Grund>')
    process.exit(1)
  }
  console.log(`✓ check-ueberschrift: ${geprueft} Seiten mit Inhalt, alle mit Hauptüberschrift (h1).`)
}

module.exports = { hatH1, zeigtEtwasAn, pruefeSeiten, aufloesen }
