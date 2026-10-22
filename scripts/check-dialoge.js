#!/usr/bin/env node
/**
 * check-dialoge.js – Wächter „Dialoge scrollen selbst“ (KAN-341/371, 22.10.2026)
 *
 * Seit KAN-335/336 scrollt das Dokument nicht mehr, nur noch <main id="inhalt">. Ein Dialog über `fixed inset-0`
 * liegt außerhalb dieses Scrollbereichs: Ist er höher als der sichtbare Bereich (Handy, Bildschirmtastatur), war sein
 * unterer Teil samt „Speichern“ unerreichbar. Jede Überlagerung `fixed inset-0` mit Inhalt braucht deshalb einen
 * eigenen Scrollbereich – entweder die Überlagerung selbst (`overflow-y-auto`/`overflow-auto`) oder das erste
 * Element darin (das Dialog-Panel) mit `max-h-…` und `overflow-y-auto` (bzw. einem Nachfahren mit `overflow-y-auto`,
 * z. B. Kopf/Fuß fest, Mitte scrollt). Die Höhe am Handy nicht in `vh` begrenzen (größer als der sichtbare Bereich,
 * wenn die Browserleiste eingeblendet ist), sondern in `dvh`, z. B. `max-h-[calc(100dvh-2rem)]`.
 * Reine Abdunklungen (selbstschließend oder aria-hidden) sind ausgenommen.
 * Ausnahme je Element: `// dialog-scroll-ok: <Grund ≥ 15 Zeichen>` bzw. `{/* dialog-scroll-ok: … *\/}` in den zwei
 * Zeilen davor oder in derselben Zeile.
 *
 * Aufruf: node scripts/check-dialoge.js   (Exit 1 bei Funden)
 * Für Tests: require('./check-dialoge.js') → { fundeIn } ohne Seiteneffekte.
 */
const fs = require('fs')
const path = require('path')

const AUSNAHME = /dialog-scroll-ok:\s*\S.{13,}/

function klassen(knoten, ts) {
  const attr = knoten.attributes.properties
  const cn = attr.find(p => ts.isJsxAttribute(p) && p.name.getText() === 'className')
  if (!cn || !cn.initializer) return new Set()
  return new Set(cn.initializer.getText().replace(/[`'"{}$():?]/g, ' ').split(/\s+/).filter(Boolean))
}
// Klassen mit Klammerausdruck (max-h-[calc(100dvh-2rem)]) – roh aus dem className-Text
function klassenText(knoten, ts) {
  const cn = knoten.attributes.properties.find(p => ts.isJsxAttribute(p) && p.name.getText() === 'className')
  return cn?.initializer ? cn.initializer.getText() : ''
}
const scrollt = k => k.has('overflow-y-auto') || k.has('overflow-auto') || k.has('overflow-y-scroll')
const hatMaxH = text => /(^|[\s"'`])max-h-/.test(text)
// max-h in vh (nicht dvh/svh) – am Handy höher als der sichtbare Bereich
const vhHoehe = text => /max-h-\[[^\]]*\d(?<![ds])vh/.test(text) || /max-h-screen\b/.test(text)

function oeffnend(el, ts) {
  if (ts.isJsxElement(el)) return el.openingElement
  if (ts.isJsxSelfClosingElement(el)) return el
  return null
}
function kinder(el, ts) {
  if (!ts.isJsxElement(el)) return []
  const r = []
  for (const c of el.children) {
    if (ts.isJsxElement(c) || ts.isJsxSelfClosingElement(c)) r.push(c)
    else if (ts.isJsxExpression(c) && c.expression) {
      // {bedingung && <div …>} bzw. {x ? <a/> : <b/>}
      ;(function such(n) {
        if (ts.isJsxElement(n) || ts.isJsxSelfClosingElement(n)) { r.push(n); return }
        if (ts.isJsxFragment(n)) return
        ts.forEachChild(n, such)
      })(c.expression)
    }
  }
  return r
}
function nachfahreScrollt(el, ts) {
  let gefunden = false
  ;(function such(n) {
    if (gefunden) return
    if (ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) { if (scrollt(klassen(n, ts))) { gefunden = true; return } }
    ts.forEachChild(n, such)
  })(el)
  return gefunden
}

/** Funde einer Datei: [{ zeile, grund }] */
function fundeIn(quelltext, datei, ts) {
  const sf = ts.createSourceFile(datei, quelltext, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const zeilen = quelltext.split('\n')
  const funde = []
  const melde = (knoten, grund) => {
    const z = sf.getLineAndCharacterOfPosition(knoten.getStart()).line
    if ([z, z - 1, z - 2].some(i => AUSNAHME.test(zeilen[i] ?? ''))) return
    funde.push({ zeile: z + 1, grund })
  }
  ;(function besuch(k) {
    if (ts.isJsxElement(k) || ts.isJsxSelfClosingElement(k)) {
      const auf = oeffnend(k, ts)
      const kl = klassen(auf, ts)
      const abdunklung = ts.isJsxSelfClosingElement(k) || auf.attributes.properties.some(p => ts.isJsxAttribute(p) && p.name.getText() === 'aria-hidden')
      if (kl.has('fixed') && kl.has('inset-0') && !abdunklung) {
        if (scrollt(kl)) {
          if (vhHoehe(klassenText(auf, ts))) melde(auf, 'Höhe in vh statt dvh')
        } else {
          const panel = kinder(k, ts)[0]
          if (!panel) melde(auf, 'Überlagerung ohne Scrollbereich')
          else {
            const pAuf = oeffnend(panel, ts)
            const pText = klassenText(pAuf, ts)
            if (!hatMaxH(pText)) melde(auf, 'Dialog-Panel ohne max-h-[calc(100dvh-2rem)]')
            else if (!scrollt(klassen(pAuf, ts)) && !nachfahreScrollt(panel, ts)) melde(auf, 'Dialog-Panel ohne overflow-y-auto')
            else if (vhHoehe(pText)) melde(auf, 'Höhe in vh statt dvh')
          }
        }
      }
    }
    ts.forEachChild(k, besuch)
  })(sf)
  return funde
}

module.exports = { fundeIn }
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
let geprueft = 0
for (const d of dateien) {
  const s = fs.readFileSync(d, 'utf8')
  if (!s.includes('inset-0')) continue
  geprueft++
  for (const f of fundeIn(s, d, ts)) ausgabe.push(`${path.relative(wurzel, d).replace(/\\/g, '/')}:${f.zeile}  ${f.grund}`)
}
if (ausgabe.length) {
  console.error(`✗ check-dialoge: ${ausgabe.length} Dialog(e) ohne eigenen Scrollbereich (KAN-341/371):`)
  for (const a of ausgabe) console.error('  ' + a)
  console.error('  Dialog-Panel mit max-h-[calc(100dvh-2rem)] overflow-y-auto versehen (oder die Überlagerung mit overflow-y-auto).')
  console.error('  Ausnahme: dialog-scroll-ok: <Grund ≥ 15 Zeichen>')
  process.exit(1)
}
console.log(`✓ check-dialoge: Dialoge in ${geprueft} Dateien mit eigenem Scrollbereich.`)
