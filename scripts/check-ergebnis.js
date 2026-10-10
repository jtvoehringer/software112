#!/usr/bin/env node
/**
 * check-ergebnis.js – Wächter „Ergebnis einer Server Action nie verwerfen“ (Sweep 107, 10.10.2026)
 *
 * Viele Server Actions melden Fehler über den Rückgabewert ({ error }, { fehler }, { ok: false }) statt zu werfen. Wird das
 * Ergebnis verworfen (`await aktion(…)` als Anweisung, `startTransition(() => { aktion(…) })`), verschwindet der Fehler still –
 * die Seite lädt neu, als hätte alles geklappt. Befund: Monatsabschluss, UVA berechnen bzw. als übermittelt markieren,
 * Dauerauftrag anlegen/deaktivieren, E&A-Kategorie anlegen, Kontoabstimmung.
 * Gemeldet: Aufruf einer importierten Action (exportiert aus einer 'use server'-Datei, die an einer Stelle
 * `return { error|fehler|ok: false` enthält) als Ausdrucksanweisung, auch mit await/void.
 * Richtig: ergebnisPruefen(await aktion(…)) aus src/lib/fehler.ts (wirft AktionsFehler) bzw. das Ergebnis auswerten.
 * Begründete Ausnahme: // ergebnis-ok: <Grund, mind. 15 Zeichen> in derselben Zeile oder bis zu zwei Zeilen davor.
 *
 * Aufruf: node scripts/check-ergebnis.js   (Exit 1 bei Funden)
 * Für Tests: require('./check-ergebnis.js') → { actionsMitRueckgabe, verworfeneAufrufe, pruefeWurzel } ohne Seiteneffekte.
 */
const fs = require('fs')
const path = require('path')
const ts = require('typescript')

const AUSNAHME = /ergebnis-ok\s*:\s*(.*)$/i
const MIN_GRUND = 15

/** Namen exportierter Funktionen einer 'use server'-Datei, die Fehler zurückgeben */
function actionsMitRueckgabe(text) {
  if (!/^\s*['"]use server['"]/m.test(text.slice(0, 400))) return new Set()
  const sf = ts.createSourceFile('x.ts', text, ts.ScriptTarget.Latest, true)
  const out = new Set()
  sf.forEachChild(n => {
    const exp = n.modifiers && n.modifiers.some(m => m.kind === ts.SyntaxKind.ExportKeyword)
    if (exp && ts.isFunctionDeclaration(n) && n.name && n.body && /return \{\s*(error|fehler|ok:\s*false)\b/.test(n.body.getText())) out.add(n.name.text)
  })
  return out
}

/** Zeilen, in denen eine der Actions als Anweisung aufgerufen und ihr Ergebnis verworfen wird */
function verworfeneAufrufe(text, namen, datei = 'x.tsx') {
  const sf = ts.createSourceFile(datei, text, ts.ScriptTarget.Latest, true, datei.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  const zeilen = text.split('\n')
  const funde = []
  let ausnahmen = 0
  function besuch(n) {
    if (ts.isExpressionStatement(n)) {
      let e = n.expression
      if (ts.isAwaitExpression(e)) e = e.expression
      if (ts.isVoidExpression(e)) e = e.expression
      if (ts.isCallExpression(e) && ts.isIdentifier(e.expression) && namen.has(e.expression.text)) {
        const zeile = sf.getLineAndCharacterOfPosition(n.getStart()).line + 1
        const marker = zeilen.slice(Math.max(0, zeile - 3), zeile).reverse().map(r => AUSNAHME.exec(r.replace(/\r$/, ''))).find(Boolean)
        if (marker && marker[1].replace(/\*\/.*$|\}.*$/, '').trim().length >= MIN_GRUND) ausnahmen++
        else funde.push({ zeile, aktion: e.expression.text, text: marker
          ? `„ergebnis-ok“ ohne ausreichende Begründung (mind. ${MIN_GRUND} Zeichen)`
          : `Ergebnis von ${e.expression.text}() verworfen – Fehler ({ error }) gehen still verloren; ergebnisPruefen(await …) bzw. auswerten` })
      }
    }
    ts.forEachChild(n, besuch)
  }
  besuch(sf)
  return { funde, ausnahmen }
}

function* dateien(dir) {
  if (!fs.existsSync(dir)) return
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) { if (e.name !== 'node_modules') yield* dateien(p) }
    else if (/\.tsx?$/.test(e.name)) yield p
  }
}

function aufloesen(root, von, spec) {
  const p = spec.startsWith('@/') ? path.join(root, 'src', spec.slice(2)) : spec.startsWith('.') ? path.resolve(path.dirname(von), spec) : null
  if (!p) return null
  for (const e of ['', '.ts', '.tsx']) if (fs.existsSync(p + e) && fs.statSync(p + e).isFile()) return path.resolve(p + e)
  return null
}

function pruefeWurzel(root) {
  const alle = [...dateien(path.join(root, 'src'))]
  const texte = new Map(alle.map(f => [path.resolve(f), fs.readFileSync(f, 'utf8')]))
  const mitRueckgabe = new Map()
  for (const [f, t] of texte) { const s = actionsMitRueckgabe(t); if (s.size) mitRueckgabe.set(f, s) }
  const funde = []
  let ausnahmen = 0, aufrufer = 0
  for (const [f, t] of texte) {
    const namen = new Set()
    const sf = ts.createSourceFile(f, t, ts.ScriptTarget.Latest, false)
    sf.forEachChild(n => {
      if (ts.isImportDeclaration(n) && n.importClause?.namedBindings && ts.isNamedImports(n.importClause.namedBindings)) {
        const ziel = aufloesen(root, f, n.moduleSpecifier.text)
        const s = ziel && mitRueckgabe.get(ziel)
        if (s) for (const el of n.importClause.namedBindings.elements) if (s.has((el.propertyName ?? el.name).text)) namen.add(el.name.text)
      }
    })
    // Actions derselben Datei (inline 'use server' in Seiten ruft eigene Exporte selten) – nur Importe zählen
    if (!namen.size) continue
    aufrufer++
    const e = verworfeneAufrufe(t, namen, f)
    ausnahmen += e.ausnahmen
    const r = path.relative(root, f).split(path.sep).join('/')
    for (const x of e.funde) funde.push(`${r}:${x.zeile}  ${x.text}`)
  }
  return { funde, actions: [...mitRueckgabe.values()].reduce((s, x) => s + x.size, 0), aufrufer, ausnahmen }
}

module.exports = { actionsMitRueckgabe, verworfeneAufrufe, pruefeWurzel }

if (require.main === module) {
  const ROOT = process.env.S112_GUARD_ROOT ? path.resolve(process.env.S112_GUARD_ROOT) : path.resolve(__dirname, '..')
  const e = pruefeWurzel(ROOT)
  if (e.funde.length) {
    console.error(`\n✖ check-ergebnis: ${e.funde.length} verworfene(s) Ergebnis(se) von Server Actions:\n`)
    for (const x of e.funde) console.error('  ' + x)
    console.error('\nergebnisPruefen(await aktion(…)) aus src/lib/fehler.ts verwenden bzw. das Ergebnis auswerten – oder begründen:')
    console.error('  // ergebnis-ok: <Grund ≥ 15 Zeichen>   (dieselbe Zeile oder bis zu zwei Zeilen davor)\n')
    process.exit(1)
  }
  console.log(`✓ check-ergebnis: ${e.actions} Actions mit Fehler-Rückgabe, ${e.aufrufer} aufrufende Dateien, kein verworfenes Ergebnis, ${e.ausnahmen} begründete Ausnahme(n).`)
}
