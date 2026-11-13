#!/usr/bin/env node
// Wächter „Lesebereich je Seite“ (KAN-456, 13.11.2026) – prebuild und CI.
//
// Mitarbeiter mit Profil („Vertrieb“, „Extern“) lesen nur ihre Lesebereiche. Die Daten sperrt die Datenbank; damit
// niemand auf einer leeren Liste oder Fehlerseite landet, hat jede Seite unter src/app/(dashboard)
//   • eine Regel in src/lib/navigation/seitenBereich.ts (Pfad → Bereich, längster Pfad gewinnt) und
//   • – außer im Bereich „allgemein“ – einen Guard `await requireLesen('<bereich>')` mit genau diesem Bereich:
//     in der Seite selbst oder in einem layout.tsx darüber (das nächste Layout mit Guard zählt).
// Der Build bricht ab bei: Seite ohne Regel, Seite ohne Guard, Guard mit anderem Bereich als die Regel, Guard über
// einer Seite im Bereich „allgemein“, unbekanntem Bereich, Regel ohne Seite darunter.
// Aufruf: node scripts/check-lesebereich-seiten.js [--liste]

const fs = require('fs')
const path = require('path')

const GUARD = /await requireLesen\('([a-z]+)'\)/

/** Regeln aus dem Quelltext von seitenBereich.ts: [[pfad, bereich]] */
function regelnAus(quelle) {
  const block = /export const SEITEN_BEREICH[^=]*=\s*\[([\s\S]*?)\n\]/.exec(quelle)
  if (!block) return []
  return [...block[1].matchAll(/^\s*\['([^']+)',\s*'([a-z]+)'\]/gm)].map(m => [m[1], m[2]])
}

function regelFuer(regeln, pfad) {
  let treffer = null
  for (const r of regeln) {
    if (pfad !== r[0] && !pfad.startsWith(r[0] + '/')) continue
    if (!treffer || r[0].length > treffer[0].length) treffer = r
  }
  return treffer
}

/** Verzeichnisse mit page.tsx unter basis, relativ mit '/' ('' = basis selbst) */
function seiten(basis, dir = basis, liste = []) {
  if (!fs.existsSync(dir)) return liste
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) seiten(basis, p, liste)
    else if (e.name === 'page.tsx') liste.push(path.relative(basis, dir).split(path.sep).join('/'))
  }
  return liste.sort()
}

/** Adresse einer Seite: Routen-Gruppen „(name)“ fallen weg */
function adresse(verzeichnis) {
  return '/' + verzeichnis.split('/').filter(t => t && !/^\(.*\)$/.test(t)).join('/')
}

/**
 * Guard einer Seite: erst page.tsx, dann die layout.tsx vom Verzeichnis aufwärts (ohne das Wurzel-Layout).
 * lies(relPfad) → Quelltext oder null.
 */
function guardFuer(verzeichnis, lies) {
  const seite = lies((verzeichnis ? verzeichnis + '/' : '') + 'page.tsx') ?? ''
  const inSeite = GUARD.exec(seite)
  if (inSeite) return { bereich: inSeite[1], ort: 'page.tsx' }
  const teile = verzeichnis ? verzeichnis.split('/') : []
  for (let n = teile.length; n >= 1; n--) {
    const rel = teile.slice(0, n).join('/') + '/layout.tsx'
    const m = GUARD.exec(lies(rel) ?? '')
    if (m) return { bereich: m[1], ort: rel }
  }
  return null
}

function pruefe(regeln, verzeichnisse, lies, bereiche) {
  const fehler = []
  const benutzt = new Set()
  for (const [p, b] of regeln) if (!bereiche.includes(b)) fehler.push(`Regel „${p}“: unbekannter Bereich „${b}“`)
  if (new Set(regeln.map(r => r[0])).size !== regeln.length) fehler.push('seitenBereich.ts: ein Pfad steht doppelt in der Liste')
  for (const v of verzeichnisse) {
    const url = adresse(v)
    const regel = regelFuer(regeln, url)
    if (!regel) { fehler.push(`${url}: Seite ohne Regel in src/lib/navigation/seitenBereich.ts`); continue }
    benutzt.add(regel[0])
    const guard = guardFuer(v, lies)
    if (regel[1] === 'allgemein') {
      if (guard) fehler.push(`${url}: Bereich „allgemein“, aber Guard requireLesen('${guard.bereich}') in ${guard.ort}`)
      continue
    }
    if (!guard) fehler.push(`${url}: Bereich „${regel[1]}“ ohne Guard – await requireLesen('${regel[1]}') in page.tsx oder einem layout.tsx darüber`)
    else if (guard.bereich !== regel[1]) fehler.push(`${url}: Regel nennt „${regel[1]}“, der Guard in ${guard.ort} prüft „${guard.bereich}“`)
  }
  for (const [p] of regeln) if (!benutzt.has(p)) fehler.push(`Regel „${p}“: keine Seite darunter (Pfad geändert oder gelöscht?)`)
  return fehler
}

module.exports = { pruefe, regelnAus, regelFuer, seiten, adresse, guardFuer }

if (require.main === module) {
  const wurzel = path.resolve(__dirname, '..')
  const basis = path.join(wurzel, 'src', 'app', '(dashboard)')
  const regeln = regelnAus(fs.readFileSync(path.join(wurzel, 'src', 'lib', 'navigation', 'seitenBereich.ts'), 'utf8'))
  const bereiche = Object.keys(JSON.parse(fs.readFileSync(path.join(wurzel, 'scripts', 'lesebereiche.json'), 'utf8')).bereiche)
  const lies = rel => { const p = path.join(basis, rel); return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null }
  const verzeichnisse = seiten(basis)
  if (process.argv.includes('--liste')) {
    for (const v of verzeichnisse) {
      const g = guardFuer(v, lies)
      console.log(`${(regelFuer(regeln, adresse(v))?.[1] ?? '?').padEnd(15)} ${adresse(v).padEnd(52)} ${g ? g.ort : ''}`)
    }
  }
  const fehler = pruefe(regeln, verzeichnisse, lies, bereiche)
  if (fehler.length) {
    console.error(`✗ check-lesebereich-seiten: ${fehler.length} Befund(e)`)
    for (const f of fehler) console.error(`  ${f}`)
    process.exit(1)
  }
  console.log(`✓ check-lesebereich-seiten: ${verzeichnisse.length} Seiten, ${regeln.length} Regeln, jede Seite außerhalb von „allgemein“ mit Guard.`)
}
