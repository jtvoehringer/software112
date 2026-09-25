#!/usr/bin/env node
/**
 * check-behoerden-csv.js – Wächter „Behördenmeldungen immer auch als CSV“ (24.09.2026)
 *
 * Läuft im prebuild neben check-tenant-isolation.js, check-schema.js und check-a11y.js und
 * bricht den Build ab bei:
 *  1. CSV_EIGENBAU      'text/csv', new Blob(…) für eine CSV oder ein BOM (das Zeichen selbst,
 *                       Escape wie im CSV-Baustein, \xEF\xBB\xBF, %EF%BB%BF, fromCharCode(0xFEFF))
 *                       außerhalb von src/lib/csv/** und src/components/CsvExportKnopf.tsx.
 *                       CSV entsteht nur über csvText()/csvDatei() aus src/lib/csv, ausgeliefert
 *                       über die Route /meldungen/<id>/csv bzw. den CsvExportKnopf.
 *                       Ausnahme je Stelle: Zeilenkommentar „// csv-ignore: <Begründung>“ in
 *                       derselben Zeile oder allein in der Zeile davor (ohne Begründung = Fund).
 *                       Übergangsweise geduldete Altfälle stehen in ALTFAELLE (seit KAN-54 leer).
 *  2. MARKER_UNBEKANNT  „// behoerdenmeldung: <id>, <id>“ nennt eine id, die es im Katalog nicht gibt.
 *  3. NICHT_VERDRAHTET  Eine Register-id wird nirgends in src/app bzw. src/components angeboten
 *                       (csvPfad('<id>' …), '/meldungen/<id>/csv' oder meldung="<id>").
 *  4. DRUCKSEITE        druckPfad ohne page.tsx bzw. die Seite trägt keinen Marker für die id.
 *  5. REGISTER          Katalog und Register einer Gruppe haben nicht dieselben ids, eine id ist
 *                       doppelt oder ungültig, oder eine Gruppendatei ist nicht in katalog.ts /
 *                       register.ts eingesammelt (TypeScript prüft nur eingesammelte Gruppen).
 *  6. EINSTIEG          Druckpfad mit [id] ohne Einstiegsseite in lib/behoerden/uebersicht.ts
 *                       (EINSTIEG) bzw. die Einstiegsseite existiert nicht.
 *
 * Ohne Abhängigkeiten (kein TypeScript-Parser): Katalog- und Register-Objekte werden mit einem
 * kleinen Scanner gelesen, der Strings, Template-Literale und Kommentare überspringt.
 * Aufruf: node scripts/check-behoerden-csv.js   (Exit 1 bei Funden)
 */
const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..')
const SRC = path.join(ROOT, 'src')
const BEHOERDEN = path.join(SRC, 'lib', 'behoerden')
const APP = path.join(SRC, 'app')

// Dateien mit eigenem CSV-Code, die (noch) nicht angefasst werden dürfen – Pfad → Begründung.
// Wird eine davon auf lib/csv umgestellt, meldet das Skript den Eintrag als überflüssig.
// Seit KAN-54 (25.09.2026) leer: die Datenexporte unter src/app/api/export/ (kontakte, firmen,
// lager, verkauf, bmd) laufen über csvDatei()/csvAntwort() aus src/lib/csv
// (Zeilenaufbereitung in src/lib/export/datenexporte.ts). Neue Einträge nur übergangsweise.
const ALTFAELLE = {}

// Erlaubte Orte für CSV-Serialisierung und Download
const ERLAUBT_PRAEFIX = ['src/lib/csv/']
const ERLAUBT_DATEI = new Set(['src/components/CsvExportKnopf.tsx'])

const ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const BS = String.fromCharCode(92) // Backslash – so enthält dieses Skript selbst kein BOM-Escape
const BOM_ZEICHEN = String.fromCharCode(0xfeff)
const BOM_MUSTER = [
  new RegExp(BS + BS + 'u' + BS + '{?0*feff' + BS + '}?', 'i'),
  new RegExp(BS + BS + 'xef' + BS + BS + 'xbb' + BS + BS + 'xbf', 'i'),
  /%ef%bb%bf/i,
  /from(?:CharCode|CodePoint)\(\s*(?:0x0*feff|65279)\s*\)/i,
]
const IGNORE = /csv-ignore\b/i
const IGNORE_MIT_GRUND = /csv-ignore\s*:\s*\S.{3,}/i

const funde = []
const hinweise = []
let ausnahmen = 0

const rel = f => path.relative(ROOT, f).split(path.sep).join('/')

function dateien(dir, endungen) {
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) return ['node_modules', '.next'].includes(e.name) ? [] : dateien(p, endungen)
    return endungen.some(x => p.endsWith(x)) ? [p] : []
  })
}

// ── Mini-Scanner für Objekt-Literale ───────────────────────────────────────────

/** Ist s[i] Beginn eines Kommentars/Strings/Templates, Index danach – sonst -1 */
function ueberspringe(s, i) {
  const c = s[i], n = s[i + 1]
  if (c === '/' && n === '/') { const e = s.indexOf('\n', i); return e < 0 ? s.length : e + 1 }
  if (c === '/' && n === '*') { const e = s.indexOf('*/', i + 2); return e < 0 ? s.length : e + 2 }
  if (c === '"' || c === "'") {
    for (let j = i + 1; j < s.length; j++) {
      if (s[j] === BS) { j++; continue }
      if (s[j] === c || s[j] === '\n') return j + 1
    }
    return s.length
  }
  if (c === '`') {
    for (let j = i + 1; j < s.length; j++) {
      if (s[j] === BS) { j++; continue }
      if (s[j] === '`') return j + 1
      if (s[j] === '$' && s[j + 1] === '{') j = klammerEnde(s, j + 1) - 1
    }
    return s.length
  }
  return -1
}

/** i zeigt auf ( [ { – Index nach der passenden schließenden Klammer */
function klammerEnde(s, i) {
  const paar = { '(': ')', '[': ']', '{': '}' }
  const stapel = [paar[s[i]]]
  let j = i + 1
  while (j < s.length && stapel.length) {
    const u = ueberspringe(s, j)
    if (u >= 0) { j = u; continue }
    const c = s[j]
    if (paar[c]) stapel.push(paar[c])
    else if (c === stapel[stapel.length - 1]) stapel.pop()
    j++
  }
  return j
}

/** Einträge des Objekt-Literals, das bei s[start] === '{' beginnt: [{ schluessel, wert }].
 *  Ein Komma in Typargumenten (definiereMeldung<A, B>(…)) beendet den Wert nicht: folgt auf
 *  den vermeintlichen Schlüssel weder ':' noch ',' bzw. '(', gehört der Text zum vorigen Wert. */
function objektEintraege(s, start) {
  const out = []
  const ende = klammerEnde(s, start) - 1
  let i = start + 1
  const leer = () => {
    for (;;) {
      while (i < ende && /\s/.test(s[i])) i++
      if (s[i] === '/' && (s[i + 1] === '/' || s[i + 1] === '*')) { i = ueberspringe(s, i); continue }
      return
    }
  }
  const wertBis = () => {
    while (i < ende && s[i] !== ',') {
      const u = ueberspringe(s, i)
      if (u >= 0) { i = u; continue }
      if ('([{'.includes(s[i])) { i = klammerEnde(s, i); continue }
      i++
    }
  }
  while (i < ende) {
    leer()
    if (i >= ende) break
    const anfang = i
    let schluessel = null
    if (s.startsWith('...', i)) {
      i += 3
    } else if (s[i] === '"' || s[i] === "'") {
      const e = ueberspringe(s, i)
      schluessel = s.slice(i + 1, e - 1)
      i = e
    } else {
      const m = /^[A-Za-z_$][\w$]*/.exec(s.slice(i, i + 200))
      if (m) { schluessel = m[0]; i += m[0].length }
    }
    leer()
    const istEigenschaft = schluessel !== null && (s[i] === ':' || s[i] === ',' || s[i] === '(' || i >= ende)
    if (schluessel !== null && !istEigenschaft) {
      // Fortsetzung des vorigen Werts (Komma in Typargumenten o. Ä.)
      i = anfang
      wertBis()
      if (out.length) out[out.length - 1].wert += ',' + s.slice(anfang, i)
      i++
      continue
    }
    if (s[i] === ':') i++
    const wertStart = i
    wertBis()
    if (schluessel !== null) out.push({ schluessel, wert: s.slice(wertStart, i) })
    i++ // Komma
  }
  return out
}

function zeileVon(s, pos) { return s.slice(0, pos).split('\n').length }

// ── Katalog und Register lesen ─────────────────────────────────────────────────

const gruppenDateien = d => (fs.existsSync(d) ? fs.readdirSync(d).filter(f => f.endsWith('.ts')).sort() : [])
const katalogGruppen = gruppenDateien(path.join(BEHOERDEN, 'katalog'))
const registerGruppen = gruppenDateien(path.join(BEHOERDEN, 'register'))

/** id → { gruppe, druckPfad, datei } */
const katalog = new Map()
const registerIds = new Set()

for (const g of katalogGruppen) {
  const f = path.join(BEHOERDEN, 'katalog', g)
  const s = fs.readFileSync(f, 'utf8')
  const m = /export const (KATALOG_[A-Z_]+)\s*=\s*katalogGruppe\(\s*['"]([a-z]+)['"]\s*,\s*\{/.exec(s)
  if (!m) { funde.push(`${rel(f)}  REGISTER  kein „export const KATALOG_… = katalogGruppe('<gruppe>', { … })“ gefunden`); continue }
  if (`${m[2]}.ts` !== g) funde.push(`${rel(f)}:${zeileVon(s, m.index)}  REGISTER  Gruppe „${m[2]}“ passt nicht zum Dateinamen`)
  for (const { schluessel, wert } of objektEintraege(s, m.index + m[0].length - 1)) {
    if (!ID_RE.test(schluessel)) funde.push(`${rel(f)}  REGISTER  ungültige id „${schluessel}“ (nur a–z, 0–9, Bindestrich)`)
    if (katalog.has(schluessel)) funde.push(`${rel(f)}  REGISTER  id „${schluessel}“ doppelt (auch in ${katalog.get(schluessel).datei})`)
    const dp = /druckPfad\s*:\s*(['"])(.*?)\1/.exec(wert)
    katalog.set(schluessel, { gruppe: m[2], druckPfad: dp ? dp[2] : null, datei: rel(f) })
  }
  pruefeEingesammelt('katalog.ts', m[1], g)
}

for (const g of registerGruppen) {
  const f = path.join(BEHOERDEN, 'register', g)
  const s = fs.readFileSync(f, 'utf8')
  const m = /export const (MELDUNGEN_[A-Z_]+)\s*=\s*\{/.exec(s)
  if (!m) { funde.push(`${rel(f)}  REGISTER  kein „export const MELDUNGEN_… = { … }“ gefunden`); continue }
  const ids = objektEintraege(s, m.index + m[0].length - 1).map(e => e.schluessel)
  for (const id of ids) registerIds.add(id)
  const imKatalog = [...katalog].filter(([, e]) => `${e.gruppe}.ts` === g).map(([id]) => id)
  for (const id of ids) if (!imKatalog.includes(id)) funde.push(`${rel(f)}  REGISTER  „${id}“ steht nicht in katalog/${g}`)
  for (const id of imKatalog) if (!ids.includes(id)) funde.push(`${rel(f)}  REGISTER  „${id}“ aus katalog/${g} fehlt im Register`)
  pruefeEingesammelt('register.ts', m[1], g)
}

for (const g of katalogGruppen) if (!registerGruppen.includes(g)) funde.push(`src/lib/behoerden/register/${g}  REGISTER  Gruppendatei fehlt (Katalog vorhanden)`)
for (const g of registerGruppen) if (!katalogGruppen.includes(g)) funde.push(`src/lib/behoerden/katalog/${g}  REGISTER  Gruppendatei fehlt (Register vorhanden)`)

function pruefeEingesammelt(sammler, name, g) {
  const f = path.join(BEHOERDEN, sammler)
  const s = fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : ''
  const ordner = sammler === 'katalog.ts' ? 'katalog' : 'register'
  const importiert = new RegExp(`import\\s*\\{[^}]*\\b${name}\\b[^}]*\\}\\s*from\\s*['"]\\./${ordner}/${g.replace(/\.ts$/, '')}['"]`).test(s)
  const verteilt = new RegExp(`\\.\\.\\.${name}\\b`).test(s)
  if (!importiert || !verteilt) funde.push(`src/lib/behoerden/${sammler}  REGISTER  ${name} aus ${ordner}/${g} ist nicht eingesammelt (Import + „...${name}“)`)
  if (sammler === 'katalog.ts') {
    const liste = /GRUPPEN_KATALOGE[^=]*=\s*\[([^\]]*)\]/.exec(s)
    if (!liste || !new RegExp(`\\b${name}\\b`).test(liste[1])) funde.push(`src/lib/behoerden/katalog.ts  REGISTER  ${name} fehlt in GRUPPEN_KATALOGE (sonst keine Dublettenprüfung und nicht in KATALOG_LISTE)`)
  }
}

// ── Seiten (Route → Datei) ─────────────────────────────────────────────────────

const normRoute = r => r.replace(/\[[^\]]+\]/g, '[]').replace(/\/+$/, '') || '/'
const seiten = new Map()
for (const f of dateien(APP, ['page.tsx', 'page.ts', 'page.jsx', 'page.js'])) {
  const teile = path.relative(APP, path.dirname(f)).split(path.sep).filter(t => t && !/^\(.*\)$/.test(t))
  const route = normRoute('/' + teile.join('/'))
  if (!seiten.has(route)) seiten.set(route, [])
  seiten.get(route).push(f)
}

// ── Quelltext durchgehen ───────────────────────────────────────────────────────

const MARKER_RE = /^\s*\/\/\s*behoerdenmeldung:\s*(.*)$/
const markerJeDatei = new Map() // Datei → Set(ids)
const verdrahtet = new Map()    // id → erste Fundstelle
const VERDRAHTUNG = [
  /csvPfad\(\s*(['"`])([a-z0-9-]+)\1/g,
  /(['"`])\/meldungen\/([a-z0-9-]+)\/csv/g,
  /\bmeldung=\{?\s*(['"`])([a-z0-9-]+)\1/g,
]
const kommentarZeile = z => /^\s*(\/\/|\/\*|\*|\{\s*\/\*)/.test(z)
const altfallGesehen = new Set()

for (const f of dateien(SRC, ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'])) {
  const r = rel(f)
  const s = fs.readFileSync(f, 'utf8')
  const zeilen = s.split(/\r?\n/)
  const csvErlaubt = ERLAUBT_DATEI.has(r) || ERLAUBT_PRAEFIX.some(p => r.startsWith(p))
  const imCodeBereich = r.startsWith('src/app/') || r.startsWith('src/components/')

  zeilen.forEach((z, i) => {
    const nr = i + 1

    // 2) Marker
    const mk = MARKER_RE.exec(z)
    if (mk) {
      const ids = mk[1].split(/[\s,]+/).filter(Boolean)
      if (ids.length === 0) funde.push(`${r}:${nr}  MARKER_UNBEKANNT  Marker ohne id`)
      for (const id of ids) {
        if (!katalog.has(id)) funde.push(`${r}:${nr}  MARKER_UNBEKANNT  „${id}“ ist keine registrierte Behördenmeldung`)
        if (!markerJeDatei.has(f)) markerJeDatei.set(f, new Set())
        markerJeDatei.get(f).add(id)
      }
    }

    // 3) Verdrahtung (nur Code-Zeilen in Seiten und Komponenten)
    if (imCodeBereich && !kommentarZeile(z)) {
      for (const re of VERDRAHTUNG) {
        for (const m of z.matchAll(re)) if (!verdrahtet.has(m[2])) verdrahtet.set(m[2], `${r}:${nr}`)
      }
    }

    // 1) CSV-Eigenbau
    if (csvErlaubt) return
    const gruende = []
    if (/text\/csv/.test(z)) gruende.push("'text/csv'")   // MIME-Typ (klein) – nicht „Aus Text/CSV“ in Hilfetexten
    if (z.includes(BOM_ZEICHEN) || BOM_MUSTER.some(re => re.test(z))) gruende.push('BOM-Literal')
    if (/\bnew\s+Blob\s*\(/.test(z)) {
      const umfeld = zeilen.slice(Math.max(0, i - 3), i + 4).join('\n')
      if (/csv/i.test(umfeld) || umfeld.includes(BOM_ZEICHEN) || BOM_MUSTER.some(re => re.test(umfeld))) gruende.push('new Blob für CSV')
    }
    if (gruende.length === 0) return
    if (ALTFAELLE[r]) { altfallGesehen.add(r); return }
    const vorher = zeilen[i - 1] ?? ''
    const kommentar = IGNORE.test(z) ? z : (IGNORE.test(vorher) && kommentarZeile(vorher) ? vorher : null)
    if (kommentar !== null) {
      if (IGNORE_MIT_GRUND.test(kommentar)) { ausnahmen++; return }
      funde.push(`${r}:${nr}  CSV_EIGENBAU  „csv-ignore“ ohne Begründung (Schreibweise: // csv-ignore: <Grund>)`)
      return
    }
    funde.push(`${r}:${nr}  CSV_EIGENBAU  ${gruende.join(', ')} – CSV nur über csvText() aus src/lib/csv und CsvExportKnopf bzw. /meldungen/<id>/csv`)
  })
}

for (const r of Object.keys(ALTFAELLE)) {
  if (!altfallGesehen.has(r)) hinweise.push(`${r}  ALTFALL  enthält keinen CSV-Eigenbau mehr (bzw. existiert nicht) – Eintrag in ALTFAELLE entfernen`)
}

// 3) Jede Register-id angeboten
for (const id of registerIds) {
  if (!verdrahtet.has(id)) funde.push(`src/lib/behoerden/register  NICHT_VERDRAHTET  „${id}“ wird nirgends als /meldungen/${id}/csv angeboten (CsvExportKnopf href={csvPfad('${id}', …)} auf der Druckseite)`)
}

// 4) Druckseite mit Marker
for (const [id, e] of katalog) {
  if (!e.druckPfad) { hinweise.push(`${e.datei}  DRUCKSEITE  „${id}“ hat keinen druckPfad`); continue }
  const kandidaten = seiten.get(normRoute(e.druckPfad)) ?? []
  if (kandidaten.length === 0) { funde.push(`${e.datei}  DRUCKSEITE  druckPfad „${e.druckPfad}“ von „${id}“ hat keine page.tsx unter src/app`); continue }
  if (!kandidaten.some(f => markerJeDatei.get(f)?.has(id))) {
    funde.push(`${rel(kandidaten[0])}  DRUCKSEITE  Marker „// behoerdenmeldung: ${id}“ fehlt (druckPfad von „${id}“)`)
  }
}

// 6) Einstiegsseiten der Übersicht
const uebersichtDatei = path.join(BEHOERDEN, 'uebersicht.ts')
if (fs.existsSync(uebersichtDatei)) {
  const s = fs.readFileSync(uebersichtDatei, 'utf8')
  const m = /export const EINSTIEG\b[^=]*=\s*\{/.exec(s)
  const einstieg = new Map()
  if (!m) funde.push(`${rel(uebersichtDatei)}  EINSTIEG  „export const EINSTIEG … = { … }“ nicht gefunden`)
  else {
    for (const { schluessel, wert } of objektEintraege(s, m.index + m[0].length - 1)) {
      const p = /pfad\s*:\s*(['"])(.*?)\1/.exec(wert)
      einstieg.set(normRoute(schluessel), p ? p[2] : null)
      if (!p || !seiten.has(normRoute(p[2]))) funde.push(`${rel(uebersichtDatei)}  EINSTIEG  Einstiegsseite „${p ? p[2] : '?'}“ für „${schluessel}“ existiert nicht`)
    }
  }
  for (const [id, e] of katalog) {
    if (e.druckPfad && e.druckPfad.includes('[') && !einstieg.has(normRoute(e.druckPfad))) {
      funde.push(`${rel(uebersichtDatei)}  EINSTIEG  druckPfad „${e.druckPfad}“ von „${id}“ braucht eine Auswahlseite in EINSTIEG`)
    }
  }
}

// ── Ergebnis ───────────────────────────────────────────────────────────────────

for (const h of hinweise) console.log(`  Hinweis: ${h}`)
if (funde.length) {
  console.error(`\n✖ check-behoerden-csv: ${funde.length} Fund(e) – Behördenmeldungen immer auch als CSV (CLAUDE.md, Konventionen):\n`)
  for (const x of funde) console.error('  ' + x)
  console.error('\nCSV nur über src/lib/csv (csvText/csvDatei), Ausgabe über /meldungen/<id>/csv und CsvExportKnopf.')
  console.error('Begründete Ausnahme je Zeile: // csv-ignore: <Grund>\n')
  process.exit(1)
}
const altfallText = altfallGesehen.size ? `, ${altfallGesehen.size} Altfall/Altfälle (ALTFAELLE)` : ''
console.log(`✓ check-behoerden-csv: ${katalog.size} Meldungen in ${katalogGruppen.length} Gruppen, alle mit CSV-Route, Druckseite und Marker; ${ausnahmen} begründete Ausnahme(n)${altfallText}.`)
