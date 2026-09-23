#!/usr/bin/env node
/**
 * check-a11y.js – Barrierefreiheits-Wächter (B9, 23.9.2026)
 *
 * Läuft im prebuild wie check-tenant-isolation.js und check-schema.js und bricht den Build ab bei:
 *  1. LABEL_OHNE_FELD  – <label>Text</label> direkt vor <input|select|textarea>, ohne htmlFor
 *     und ohne aria-label/aria-labelledby/id am Feld (Vorleseprogramm liest nur „Eingabefeld“)
 *  2. SYMBOL_OHNE_NAME – <button> enthält nur ein Symbol (<X />, <Pencil /> …) ohne aria-label/title
 *  3. BILD_OHNE_ALT    – <img> ohne alt
 * Labels mit dynamischem Text ({…}) werden nur als Hinweis gemeldet.
 * Ausnahme je Stelle: Kommentar „a11y-ignore: <Grund>“ in der Zeile davor oder derselben Zeile.
 * Behebt Fälle 1 automatisch: python3 scripts/a11y-labels.py --schreiben
 */
const fs = require('fs')
const path = require('path')

const SRC = path.join(__dirname, '..', 'src')
const IGNORE = /a11y-ignore\s*:/i
const funde = []
let hinweise = 0

function dateien(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) return ['node_modules', '.next'].includes(e.name) ? [] : dateien(p)
    return p.endsWith('.tsx') ? [p] : []
  })
}

function tagEnde(s, i) {
  let tiefe = 0, q = null
  for (let j = i + 1; j < s.length; j++) {
    const c = s[j]
    if (q) { if (c === q && s[j - 1] !== '\\') q = null; continue }
    if ((c === '"' || c === "'" || c === '`') && tiefe > 0) { q = c; continue }
    if (c === '{') tiefe++
    else if (c === '}') tiefe--
    else if (c === '>' && tiefe === 0) return j + 1
  }
  return -1
}

function zeile(s, pos) { return s.slice(0, pos).split('\n').length }
function ignoriert(s, pos) {
  const z = zeile(s, pos), zeilen = s.split('\n')
  return IGNORE.test(zeilen[z - 1] ?? '') || IGNORE.test(zeilen[z - 2] ?? '')
}

for (const f of dateien(SRC)) {
  const s = fs.readFileSync(f, 'utf8')
  const rel = path.relative(path.join(__dirname, '..'), f)

  // 1) Label → Feld
  for (const m of s.matchAll(/<label\b/g)) {
    const a = m.index, e = tagEnde(s, a)
    if (e < 0) continue
    const oeffner = s.slice(a, e)
    if (oeffner.includes('htmlFor') || oeffner.endsWith('/>')) continue
    const z = s.indexOf('</label>', e)
    if (z < 0) continue
    const inhalt = s.slice(e, z)
    if (inhalt.includes('<label') || /<(input|select|textarea)\b/.test(inhalt)) continue
    let k = z + '</label>'.length
    for (;;) {
      const m2 = /^\s*(\{\/\*[\s\S]*?\*\/\})?/.exec(s.slice(k))
      k += m2[0].length
      if (!m2[1]) break
    }
    const feld = /^<(input|select|textarea)\b/.exec(s.slice(k))
    if (!feld) continue
    const fe = tagEnde(s, k)
    const ftag = s.slice(k, fe)
    if (/aria-label(ledby)?=|\bid=|type=["']hidden["']/.test(ftag)) continue
    if (ignoriert(s, k)) continue
    if (/\{/.test(inhalt.replace(/<[^<>{}]+>/g, ''))) { hinweise++; continue }
    funde.push(`${rel}:${zeile(s, k)}  LABEL_OHNE_FELD  <${feld[1]}> ohne Verknüpfung zu „${inhalt.replace(/\s+/g, ' ').trim().slice(0, 40)}“`)
  }

  // 2) Symbol-Schaltflächen ohne Namen
  const btn = /<button\b((?:[^<>{}]|\{(?:[^{}]|\{[^{}]*\})*\})*?)>\s*<([A-Z][A-Za-z0-9]*)\b[^<>]*\/>\s*<\/button>/gs
  for (const m of s.matchAll(btn)) {
    if (/aria-label|title=/.test(m[1]) || ignoriert(s, m.index)) continue
    funde.push(`${rel}:${zeile(s, m.index)}  SYMBOL_OHNE_NAME  <button> nur mit <${m[2]} /> – aria-label ergänzen`)
  }

  // 3) Bilder ohne alt
  for (const m of s.matchAll(/<img\b/g)) {
    const e = tagEnde(s, m.index)
    if (e < 0) continue
    if (/\balt=/.test(s.slice(m.index, e)) || ignoriert(s, m.index)) continue
    funde.push(`${rel}:${zeile(s, m.index)}  BILD_OHNE_ALT  <img> ohne alt-Text`)
  }
}

if (funde.length) {
  console.error(`✗ Barrierefreiheits-Check: ${funde.length} Funde\n` + funde.map(x => '  ' + x).join('\n'))
  console.error('  Tipp: python3 scripts/a11y-labels.py --schreiben verbindet Beschriftungen automatisch.')
  process.exit(1)
}
console.log(`✓ Barrierefreiheits-Check: ${dateien(SRC).length} Dateien geprüft, keine Funde${hinweise ? ` (${hinweise} Beschriftungen mit dynamischem Text nicht geprüft)` : ''}.`)
