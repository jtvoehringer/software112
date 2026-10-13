#!/usr/bin/env node
/**
 * check-zurueck.js – Wächter „Formulare haben einen Weg zurück, Speichern springt nicht aus dem Bereich“
 * (KAN-333/KAN-334, 13.10.2026)
 *
 * Regel ZURUECK (KAN-333): Jede Formularseite unter einem Pfadsegment neu, edit oder bearbeiten bietet „Abbrechen“ bzw.
 *   „Zurück“ über AbbrechenKnopf oder zurueckZiel (dorthin, woher man kam – KAN-224), geprüft in der Seite und den
 *   Komponenten, die sie importiert (zwei Ebenen). Seiten ohne Formular (nur Weiterleitung) zählen nicht.
 * Regel BLEIBEN (KAN-334): Ein Formular auf einer Detailseite (…/[id]/page.tsx), das nach dem Speichern
 *   zielNachVorgang aufruft, muss beim Bearbeiten auf der Seite bleiben (hierBleiben) – sonst springt es zur vorherigen
 *   Seite, z. B. zum Dashboard oder Kellerplan.
 * Ausnahme je Datei (Seite bzw. Komponente): `// zurueck-ausnahme: <Grund ≥ 15 Zeichen>`.
 *
 * Aufruf: node scripts/check-zurueck.js   (Exit 1 bei Funden)
 * Für Tests: require('./check-zurueck.js') → { pruefeZurueck, pruefeBleiben, istFormularSeite } ohne Seiteneffekte.
 */
const fs = require('fs')
const path = require('path')

const AUSNAHME = /zurueck-ausnahme:\s*\S.{13,}/
const FORMULAR = /<form\b|onSubmit=|type="submit"/
const ZURUECK = /\bAbbrechenKnopf\b|\bzurueckZiel\(/
const FORMULAR_SEGMENTE = new Set(['neu', 'edit', 'bearbeiten'])

/** Seite liegt unter einem Segment neu/edit/bearbeiten (Pfad mit „/“) */
function istFormularSeite(rel) {
  return rel.endsWith('/page.tsx') && rel.split('/').slice(0, -1).some(s => FORMULAR_SEGMENTE.has(s))
}

/** Detailseite: …/[id]/page.tsx bzw. …/[xyz]/page.tsx */
function istDetailSeite(rel) {
  return /\/\[[^\]/]+\]\/page\.tsx$/.test(rel)
}

/**
 * ZURUECK: quellen = Inhalte von Seite und importierten Komponenten. Fund (true), wenn ein Formular vorkommt, aber kein
 * AbbrechenKnopf/zurueckZiel und keine Ausnahme.
 */
function pruefeZurueck(quellen) {
  const alles = quellen.join('\n')
  if (!FORMULAR.test(alles)) return false
  return !ZURUECK.test(alles) && !AUSNAHME.test(alles)
}

/** BLEIBEN: Komponente einer Detailseite ruft zielNachVorgang ohne hierBleiben und ohne Ausnahme auf */
function pruefeBleiben(quelle) {
  return /\bzielNachVorgang\(/.test(quelle) && !/\bhierBleiben\(/.test(quelle) && !AUSNAHME.test(quelle)
}

module.exports = { pruefeZurueck, pruefeBleiben, istFormularSeite, istDetailSeite }
if (require.main !== module) return

const wurzel = path.join(__dirname, '..')
const src = path.join(wurzel, 'src')
const rel = (p) => path.relative(wurzel, p).replace(/\\/g, '/')

function dateien(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) return e.name === 'node_modules' ? [] : dateien(p)
    return e.name === 'page.tsx' ? [p] : []
  })
}

/** Lokale Importe (relativ oder @/) einer Datei, aufgelöst auf vorhandene .tsx/.ts-Dateien */
function importe(datei, s) {
  const out = []
  for (const m of s.matchAll(/from\s+['"]((?:\.{1,2}\/|@\/)[^'"]+)['"]/g)) {
    const basis = m[1].startsWith('@/') ? path.join(src, m[1].slice(2)) : path.resolve(path.dirname(datei), m[1])
    for (const k of [basis, `${basis}.tsx`, `${basis}.ts`, path.join(basis, 'index.tsx'), path.join(basis, 'index.ts')]) {
      if (fs.existsSync(k) && fs.statSync(k).isFile()) { out.push(k); break }
    }
  }
  return out
}

/** Seite plus importierte Dateien bis `tiefe` Ebenen (ohne src/lib – dort sind keine Formulare) */
function umfeld(datei, tiefe) {
  const gesehen = new Map()
  const besuch = (d, t) => {
    if (gesehen.has(d)) return
    const s = fs.readFileSync(d, 'utf8')
    gesehen.set(d, s)
    if (t === 0) return
    for (const i of importe(d, s)) if (!rel(i).startsWith('src/lib/')) besuch(i, t - 1)
  }
  besuch(datei, tiefe)
  return gesehen
}

const funde = []
let mitZurueck = 0
const bleibenGeprueft = new Set()
for (const seite of dateien(path.join(src, 'app'))) {
  const r = rel(seite)
  if (istFormularSeite(r)) {
    const u = umfeld(seite, 2)
    if (pruefeZurueck([...u.values()])) funde.push(`${r}  ZURUECK: Formular ohne „Abbrechen“/„Zurück“ (AbbrechenKnopf bzw. zurueckZiel)`)
    else if (FORMULAR.test([...u.values()].join('\n'))) mitZurueck++
  }
  if (istDetailSeite(r)) {
    for (const [d, s] of umfeld(seite, 1)) {
      if (d === seite || bleibenGeprueft.has(d)) continue
      bleibenGeprueft.add(d)
      if (pruefeBleiben(s)) funde.push(`${rel(d)}  BLEIBEN: auf der Detailseite ${r} – nach dem Speichern zielNachVorgang ohne hierBleiben`)
    }
  }
}
if (funde.length) {
  console.error(`✗ check-zurueck: ${funde.length} Fund(e):`)
  for (const f of funde) console.error('  ' + f)
  console.error('  ZURUECK: <AbbrechenKnopf standard="/liste" /> neben „Speichern“. BLEIBEN: beim Bearbeiten router.replace(hierBleiben()).')
  console.error('  Ausnahme je Datei: // zurueck-ausnahme: <Grund ≥ 15 Zeichen>')
  process.exit(1)
}
console.log(`✓ check-zurueck: ${mitZurueck} Formularseiten mit „Abbrechen“/„Zurück“, Detailseiten bleiben nach dem Speichern.`)
