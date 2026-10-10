#!/usr/bin/env node
/**
 * check-a11y.js – Barrierefreiheits-Wächter (B9, 23.9.2026)
 *
 * Läuft im prebuild wie check-tenant-isolation.js und check-schema.js und bricht den Build ab bei:
 *  1. LABEL_OHNE_FELD  – <label>Text</label> direkt vor <input|select|textarea>, ohne htmlFor
 *     und ohne aria-label/aria-labelledby/id am Feld (Vorleseprogramm liest nur „Eingabefeld“)
 *  2. SYMBOL_OHNE_NAME – <button>, <a> oder <Link> enthält nur Symbole (<X />, <Pencil /> …) ohne aria-label/title
 *     (Sweep 105: über den TypeScript-Syntaxbaum statt Textmuster – vorher fielen Links und Knöpfe mit verschachteltem
 *     onClick-Template durch: Jahr-Pfeile im Anlagenverzeichnis, Löschen in der Kostenrechnung)
 *  3. BILD_OHNE_ALT    – <img> ohne alt
 *  4. KLICK_OHNE_TASTATUR – onClick auf <div>, <tr>, <th> … ohne Tastaturbedienung (Sweep 116, WCAG 2.1.1): nur mit der
 *     Maus erreichbar. Abhilfe {...tastaturBedienbar(aktion)} aus @/lib/ui/tastatur; Überlagerungen zum Schließen
 *     („fixed inset-0“) und reines stopPropagation() sind ausgenommen, Komfortflächen mit Link/Knopf darin per a11y-ignore.
 *  5. FOKUS_UNSICHTBAR – <input|select|textarea> mit „focus:ring“ in der Klasse, aber ohne Ringbreite (Sweep 117, WCAG
 *     2.4.7): globals.css lässt den Fokusrahmen dann weg, der Ring ist 0 px – beim Tabben nicht zu sehen.
 * Labels mit dynamischem Text ({…}) werden nur als Hinweis gemeldet.
 * Ausnahme je Stelle: Kommentar „a11y-ignore: <Grund>“ in der Zeile davor oder derselben Zeile.
 * Behebt Fälle 1 automatisch: python3 scripts/a11y-labels.py --schreiben
 */
const fs = require('fs')
const path = require('path')
const ts = require('typescript')

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

/** Knöpfe/Links, deren Inhalt nur aus Symbol-Komponenten besteht (Großbuchstabe, ohne Kinder), ohne aria-label/title.
 *  Liefert die Zeilen samt Symbolnamen. Spread-Attribute ({...p}) gelten als benannt. */
function symbolOhneName(s, datei = 'x.tsx') {
  const sf = ts.createSourceFile(datei, s, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const out = []
  function besuch(n) {
    if (ts.isJsxElement(n) && ['button', 'a', 'Link'].includes(n.openingElement.tagName.getText())) {
      const kinder = n.children.filter(c => !(ts.isJsxText(c) && !c.getText().trim()))
      const nurSymbol = kinder.length > 0 && kinder.every(c => ts.isJsxSelfClosingElement(c) && /^[A-Z]/.test(c.tagName.getText()))
      const attr = n.openingElement.attributes.properties
      const benannt = attr.some(p => ts.isJsxSpreadAttribute(p) || ['aria-label', 'aria-labelledby', 'title'].includes(p.name.getText()))
      if (nurSymbol && !benannt) out.push({ pos: n.getStart(), tag: n.openingElement.tagName.getText(), symbol: kinder[0].tagName.getText() })
    }
    ts.forEachChild(n, besuch)
  }
  besuch(sf)
  return out
}

/** Sweep 116: onClick auf einem nicht-interaktiven Element (div, tr, th …) ohne Tastaturbedienung – nur mit der Maus
 *  erreichbar (WCAG 2.1.1). In Ordnung: onKeyDown/onKeyUp, {...tastaturBedienbar(…)}, Überlagerungen zum Schließen
 *  (className mit „fixed inset-0“ bzw. aria-hidden) und reines e.stopPropagation(). */
const NICHT_INTERAKTIV = new Set(['div', 'span', 'tr', 'td', 'th', 'li', 'p', 'section', 'article', 'img', 'ul', 'ol',
  'table', 'tbody', 'thead', 'header', 'footer', 'main', 'aside', 'nav', 'form', 'label', 'svg', 'g', 'h1', 'h2', 'h3', 'h4', 'dl', 'dt', 'dd'])
function klickOhneTastatur(s, datei = 'x.tsx') {
  const sf = ts.createSourceFile(datei, s, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const out = []
  function besuch(n) {
    if ((ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) && NICHT_INTERAKTIV.has(n.tagName.getText())) {
      const props = n.attributes.properties
      const attr = (name) => props.find(p => ts.isJsxAttribute(p) && p.name.getText() === name)
      const klick = attr('onClick')
      if (klick) {
        const tastatur = ['onKeyDown', 'onKeyUp', 'onKeyPress'].some(attr)
          || props.some(p => ts.isJsxSpreadAttribute(p) && /tastaturBedienbar\(/.test(p.getText()))
        const cls = attr('className')?.getText() ?? ''
        const ueberlagerung = /fixed inset-0/.test(cls) || /aria-hidden=(\{true\}|"true")/.test(attr('aria-hidden')?.getText() ?? '')
        const nurStopp = /^onClick=\{\s*\(?\s*\w+\s*\)?\s*=>\s*\w+\.stopPropagation\(\)\s*\}$/.test(klick.getText().replace(/\s+/g, ' ').trim())
        if (!tastatur && !ueberlagerung && !nurStopp) out.push({ pos: n.getStart(), tag: n.tagName.getText() })
      }
    }
    ts.forEachChild(n, besuch)
  }
  besuch(sf)
  return out
}

/** Sweep 117: Eingabefeld mit „focus:ring“ in der Klasse, aber ohne Ringbreite – globals.css nimmt solche Felder vom
 *  Fokusrahmen aus (eigener Ring), der Ring selbst ist aber 0 px breit: beim Tabben unsichtbar (WCAG 2.4.7). */
function fokusUnsichtbar(s, datei = 'x.tsx') {
  const sf = ts.createSourceFile(datei, s, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const out = []
  function besuch(n) {
    if ((ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) && ['input', 'select', 'textarea'].includes(n.tagName.getText())) {
      const cls = n.attributes.properties.find(p => ts.isJsxAttribute(p) && p.name.getText() === 'className')
      const t = cls?.initializer?.getText() ?? ''
      const breite = /focus:ring(?![-\w])|focus:ring-(\d|\[)/.test(t.replace(/focus:ring-0\b/g, ''))
      if (t.includes('focus:ring') && !breite) out.push({ pos: n.getStart(), tag: n.tagName.getText() })
    }
    ts.forEachChild(n, besuch)
  }
  besuch(sf)
  return out
}

module.exports = { symbolOhneName, klickOhneTastatur, fokusUnsichtbar }
if (require.main !== module) return

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
  for (const b of symbolOhneName(s, f)) {
    if (ignoriert(s, b.pos)) continue
    funde.push(`${rel}:${zeile(s, b.pos)}  SYMBOL_OHNE_NAME  <${b.tag}> nur mit <${b.symbol} /> – aria-label ergänzen`)
  }

  // 4) Klickflächen ohne Tastaturbedienung (Sweep 116)
  for (const k of klickOhneTastatur(s, f)) {
    if (ignoriert(s, k.pos)) continue
    funde.push(`${rel}:${zeile(s, k.pos)}  KLICK_OHNE_TASTATUR  <${k.tag} onClick> nur mit der Maus bedienbar – {...tastaturBedienbar(…)} aus @/lib/ui/tastatur ergänzen`)
  }

  // 5) Fokusring ohne Breite (Sweep 117)
  for (const k of fokusUnsichtbar(s, f)) {
    if (ignoriert(s, k.pos)) continue
    funde.push(`${rel}:${zeile(s, k.pos)}  FOKUS_UNSICHTBAR  <${k.tag}> mit focus:ring-Farbe, aber ohne Breite – focus:ring-2 ergänzen`)
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
