#!/usr/bin/env node
/**
 * check-links.js – Wächter „keine toten internen Links“ (Sweep 104, 10.10.2026)
 *
 * Feste interne Pfade in href=, router.push/replace, redirect() und location.href müssen auf eine Route unter src/app
 * zeigen (page.tsx bzw. route.ts; Routengruppen (…) zählen nicht, [param] passt auf jedes Segment). Ein umbenannter oder
 * entfernter Pfad führt sonst still auf „Seite nicht gefunden“. Befund: /signup verlinkte auf /agb und /datenschutz, die
 * es nicht gibt (KAN-300). Pfade mit Platzhalter (`/crm/kontakte/${id}`) prüft der Wächter über ihren festen Anfang.
 * Nicht geprüft: /api/…, Dateien (…pdf, …png), externe Adressen.
 * Begründete Ausnahme: // link-ok: <Grund, mind. 15 Zeichen> in derselben Zeile oder bis zu zwei Zeilen davor.
 *
 * Aufruf: node scripts/check-links.js   (Exit 1 bei Funden)
 * Für Tests: require('./check-links.js') → { routenAus, pruefeText, pruefeWurzel } ohne Seiteneffekte.
 */
const fs = require('fs')
const path = require('path')

const AUSNAHME = /link-ok\s*:\s*(.*)$/i
const MIN_GRUND = 15
const AUFRUF = /(?:href=|href:\s*|push\(|replace\(|redirect\(|permanentRedirect\(|location\.href\s*=\s*)\s*\{?\s*(['"`])(\/[^'"`?#\s]*)/g

function* dateien(dir, endung) {
  if (!fs.existsSync(dir)) return
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) { if (e.name !== 'node_modules') yield* dateien(p, endung) }
    else if (endung.test(e.name)) yield p
  }
}

/** Routen als Segmentlisten aus den Dateipfaden (relativ zu src/app) */
function routenAus(relPfade) {
  return relPfade
    .filter(p => /(^|\/)(page|route)\.(tsx|ts|js)$/.test(p))
    .map(p => p.split('/').slice(0, -1).filter(s => s && !/^\(.*\)$/.test(s) && !s.startsWith('@')))
}

const dyn = s => /^\[/.test(s)
function passtGenau(routen, segs) {
  return routen.some(r => {
    if (r.length && /^\[\[?\.\.\./.test(r[r.length - 1]) && segs.length >= r.length - 1) return r.slice(0, -1).every((x, i) => x === segs[i] || dyn(x))
    return r.length === segs.length && r.every((x, i) => x === segs[i] || dyn(x))
  })
}
function passtPraefix(routen, segs) {
  return routen.some(r => r.length >= segs.length && segs.every((s, i) => r[i] === s || dyn(r[i])))
}

function pruefeText(text, routen) {
  const zeilen = text.split('\n')
  const funde = []
  let pfade = 0, ausnahmen = 0
  let m
  AUFRUF.lastIndex = 0
  while ((m = AUFRUF.exec(text))) {
    let p = m[2]
    const platz = m[1] === '`' && p.includes('${')
    if (platz) p = p.slice(0, p.indexOf('${'))
    if (p.startsWith('/api/') || p === '/api' || p.startsWith('//') || /\.(pdf|png|jpe?g|svg|ico|webmanifest|html|js|csv|xlsx|txt|xml)$/.test(p)) continue
    let segs = p.split('/').filter(Boolean)
    if (platz && !p.endsWith('/')) segs = segs.slice(0, -1)   // „/crm/${typ}“: angefangenes Segment weglassen
    if (!segs.length) continue
    pfade++
    if (platz ? passtPraefix(routen, segs) : passtGenau(routen, segs)) continue
    const zeile = text.slice(0, m.index).split('\n').length
    const marker = zeilen.slice(Math.max(0, zeile - 3), zeile).reverse().map(r => AUSNAHME.exec(r.replace(/\r$/, ''))).find(Boolean)
    if (marker && marker[1].replace(/\*\/.*$|\}.*$/, '').trim().length >= MIN_GRUND) { ausnahmen++; continue }
    funde.push({ zeile, text: marker
      ? `„link-ok“ ohne ausreichende Begründung (mind. ${MIN_GRUND} Zeichen)`
      : `Link auf ${platz ? m[2] : p} – keine Seite unter src/app (Pfad prüfen bzw. Seite anlegen)` })
  }
  return { funde, pfade, ausnahmen }
}

function pruefeWurzel(root) {
  const app = path.join(root, 'src', 'app')
  const routen = routenAus([...dateien(app, /\.(tsx|ts|js)$/)].map(f => path.relative(app, f).split(path.sep).join('/')))
  const funde = []
  let anzahl = 0, pfade = 0, ausnahmen = 0
  for (const f of dateien(path.join(root, 'src'), /\.(tsx|ts)$/)) {
    anzahl++
    const e = pruefeText(fs.readFileSync(f, 'utf8'), routen)
    pfade += e.pfade; ausnahmen += e.ausnahmen
    const r = path.relative(root, f).split(path.sep).join('/')
    for (const x of e.funde) funde.push(`${r}:${x.zeile}  ${x.text}`)
  }
  return { funde, dateien: anzahl, routen: routen.length, pfade, ausnahmen }
}

module.exports = { routenAus, pruefeText, pruefeWurzel }

if (require.main === module) {
  const ROOT = process.env.S112_GUARD_ROOT ? path.resolve(process.env.S112_GUARD_ROOT) : path.resolve(__dirname, '..')
  const e = pruefeWurzel(ROOT)
  if (e.funde.length) {
    console.error(`\n✖ check-links: ${e.funde.length} toter Link/tote Links:\n`)
    for (const x of e.funde) console.error('  ' + x)
    console.error('\nPfad korrigieren bzw. Seite anlegen – oder begründen:')
    console.error('  // link-ok: <Grund ≥ 15 Zeichen>   (dieselbe Zeile oder bis zu zwei Zeilen davor)\n')
    process.exit(1)
  }
  console.log(`✓ check-links: ${e.dateien} Dateien, ${e.pfade} interne Pfade gegen ${e.routen} Routen geprüft, ${e.ausnahmen} begründete Ausnahme(n).`)
}
