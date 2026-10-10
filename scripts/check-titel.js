#!/usr/bin/env node
/**
 * check-titel.js – Wächter „Jede Seite hat einen eigenen Titel, ohne doppelten Markennamen“ (Sweep 115, 10.10.2026)
 *
 * Das Root-Layout setzt `title.template: '%s | software:112'`. 121 Seiten schrieben selbst „X – software:112“ – im
 * Browser-Tab, im Verlauf und beim Screenreader stand „Rechnung – software:112 | software:112“ (live geprüft an
 * /signup). 36 Seiten hatten gar keinen eigenen Titel: alle Tabs hießen nur „software:112“ (WCAG 2.4.2 Seitentitel).
 *
 *  1. Jede page.tsx mit Inhalt (JSX) exportiert `metadata` bzw. `generateMetadata` – Client-Seiten über ein layout.tsx
 *     im selben Ordner (eine 'use client'-Datei kann keine Metadaten exportieren).
 *  2. Kein Seitentitel unter src/app enthält „software:112“ (außer im Root-Layout) – den Markennamen hängt die Vorlage an.
 * Ausnahme je Seite bzw. Zeile: `// titel-ausnahme: <Grund ≥ 15 Zeichen>`.
 *
 * Aufruf: node scripts/check-titel.js   (Exit 1 bei Funden)
 * Für Tests: require('./check-titel.js') → { pruefe, hatTitel, markeImTitel } ohne Seiteneffekte.
 */
const fs = require('fs')
const path = require('path')

const META = /export\s+(const\s+metadata\b|(async\s+)?function\s+generateMetadata\b)/
const AUSNAHME = /\/\/\s*titel-ausnahme:\s*\S.{13,}/

const zeigtEtwasAn = (t) => /<[A-Za-z>]/.test(t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1'))

/** Seite bzw. layout.tsx im selben Ordner exportiert Metadaten */
function hatTitel(seitenText, layoutText) {
  return META.test(seitenText) || (layoutText != null && META.test(layoutText))
}

/** Zeilen (1-basiert), in denen ein Titel den Markennamen selbst enthält */
function markeImTitel(text) {
  const zeilen = text.split(/\r?\n/)
  const funde = []
  zeilen.forEach((z, i) => {
    if (/\btitle\b\s*:/.test(z) && /software:112/.test(z) && !AUSNAHME.test(z) && !AUSNAHME.test(zeilen[i - 1] ?? '')) funde.push(i + 1)
  })
  return funde
}

function dateien(dir, filter) {
  const aus = []
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) aus.push(...dateien(p, filter))
    else if (filter(e.name)) aus.push(p)
  }
  return aus
}

/** Prüft src/app unter wurzel → { seiten, ohneTitel: [Datei], marke: [Datei:Zeile] } */
function pruefe(wurzel) {
  const app = path.join(wurzel, 'src', 'app')
  const rel = (p) => path.relative(wurzel, p).replace(/\\/g, '/')
  const ohneTitel = [], marke = []
  let seiten = 0
  for (const s of dateien(app, n => n === 'page.tsx')) {
    const t = fs.readFileSync(s, 'utf8')
    if (!zeigtEtwasAn(t) || AUSNAHME.test(t)) continue
    seiten++
    const lay = path.join(path.dirname(s), 'layout.tsx')
    if (!hatTitel(t, fs.existsSync(lay) ? fs.readFileSync(lay, 'utf8') : null)) ohneTitel.push(rel(s))
  }
  const root = path.join(app, 'layout.tsx')
  for (const d of dateien(app, n => /\.(tsx|ts)$/.test(n))) {
    if (d === root) continue
    for (const z of markeImTitel(fs.readFileSync(d, 'utf8'))) marke.push(`${rel(d)}:${z}`)
  }
  return { seiten, ohneTitel, marke }
}

if (require.main === module) {
  const { seiten, ohneTitel, marke } = pruefe(path.join(__dirname, '..'))
  if (ohneTitel.length || marke.length) {
    if (ohneTitel.length) {
      console.error(`✗ check-titel: ${ohneTitel.length} Seite(n) ohne eigenen Titel (export const metadata = { title: '…' }; Client-Seite: layout.tsx daneben):`)
      for (const f of ohneTitel) console.error(`  ${f}`)
    }
    if (marke.length) {
      console.error(`✗ check-titel: ${marke.length} Titel mit „software:112“ – die Vorlage im Root-Layout hängt „| software:112“ selbst an:`)
      for (const f of marke) console.error(`  ${f}`)
    }
    console.error('  Ausnahme: // titel-ausnahme: <Grund>')
    process.exit(1)
  }
  console.log(`✓ check-titel: ${seiten} Seiten mit eigenem Titel, keiner mit doppeltem „software:112“.`)
}

module.exports = { pruefe, hatTitel, markeImTitel }
