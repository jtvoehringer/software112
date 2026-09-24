#!/usr/bin/env node
/**
 * check-api-zwei-faktor.js (KAN-54, 24.09.2026)
 *
 * Guard gegen API-Routen ohne Zwei-Faktor-Prüfung: Der Proxy (src/proxy.ts)
 * erzwingt die Stufe aal2 nur für Seiten, sein Matcher schließt /api aus. Jeder
 * Route-Handler unter src/app/api muss deshalb selbst
 *
 *     const zweiFaktor = await pruefeZweiFaktor()
 *     if (zweiFaktor) return zweiFaktor
 *
 * aufrufen (src/lib/api/zweiFaktor.ts) – oder ausdrücklich begründet ausgenommen sein.
 *
 * Geprüft wird je exportiertem HTTP-Handler (GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS):
 *
 *  1. ZWEI_FAKTOR_FEHLT – weder der Handler noch eine lokale Funktion, an die er
 *     delegiert (z. B. `return handle(req)`), enthält den Aufruf.
 *  2. ZWEI_FAKTOR_OHNE_ABBRUCH – pruefeZweiFaktor() wird aufgerufen, das Ergebnis aber
 *     nicht unmittelbar danach per `if (x) return x` zurückgegeben.
 *  3. ZWEI_FAKTOR_ZU_SPAET – vor dem Aufruf steht in derselben Funktion schon ein
 *     Datenzugriff (.from(…), .rpc(…), .storage).
 *  4. HANDLER_NICHT_PRUEFBAR – Handler nicht als `export async function GET(…)` geschrieben
 *     (z. B. `export const GET = …` oder `export { x as GET }`) – bitte umschreiben.
 *
 * Ausnahmen (Webhooks, Cron nur mit Secret, OAuth-Rückkehr, CSP-Berichte …): Kommentar
 * `// zwei-faktor-ausnahme: <Grund>` unmittelbar über dem exportierten Handler. Der Grund
 * ist Pflicht (mindestens 15 Zeichen), damit jede Ausnahme im Code begründet bleibt.
 * Routen mit Cron-Secret UND Sitzungszweig sind keine Ausnahme: der Sitzungszweig ruft
 * pruefeZweiFaktor() (siehe z. B. src/app/api/cron/taeglich/route.ts).
 *
 * `node scripts/check-api-zwei-faktor.js --liste` gibt zusätzlich alle Handler mit
 * ihrer Einstufung aus (für Reviews).
 *
 * Läuft als "prebuild" vor jedem "next build" (package.json) und im GitHub-Workflow
 * tenant-isolation-check.yml – ein Fund lässt Build und Deploy fehlschlagen.
 */

const fs = require('fs')
const path = require('path')
const ts = require('typescript')

const ROOT = path.resolve(__dirname, '..')
const API_DIR = path.join(ROOT, 'src', 'app', 'api')
const HTTP_METHODEN = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'])
const PRUEFUNG = 'pruefeZweiFaktor'
const AUSNAHME = /zwei-faktor-ausnahme\s*:\s*(.*)/i
const MIN_GRUND = 15
// Array.from(…), Buffer.from(…) usw. sind keine Datenbankzugriffe
const KEIN_DATENZUGRIFF = new Set(['Array', 'Buffer', 'Object', 'Uint8Array', 'Promise'])

function routeDateien(dir, out = []) {
  if (!fs.existsSync(dir)) return out
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) routeDateien(p, out)
    else if (/^route\.(ts|tsx|js)$/.test(e.name)) out.push(p)
  }
  return out
}

function istExportiert(node) {
  return !!node.modifiers && node.modifiers.some(m => m.kind === ts.SyntaxKind.ExportKeyword)
}

/** Begründung aus einem „zwei-faktor-ausnahme:“-Kommentar direkt über dem Knoten (oder null) */
function ausnahmeGrund(text, node) {
  const kommentare = ts.getLeadingCommentRanges(text, node.getFullStart()) || []
  for (const k of kommentare) {
    const m = AUSNAHME.exec(text.slice(k.pos, k.end))
    if (m) return m[1].replace(/\*\/\s*$/, '').trim()
  }
  return null
}

/** Aufrufe `pruefeZweiFaktor()`, Datenzugriffe und Aufrufe lokaler Funktionen in einem Funktionsrumpf (inkl. Callbacks) */
function sammle(rumpf) {
  const pruefungen = []
  const zugriffe = []
  const lokaleAufrufe = []
  function besuche(n) {
    if (ts.isCallExpression(n)) {
      const f = n.expression
      if (ts.isIdentifier(f)) {
        if (f.text === PRUEFUNG) pruefungen.push(n)
        else lokaleAufrufe.push(f.text)
      } else if (ts.isPropertyAccessExpression(f) && (f.name.text === 'from' || f.name.text === 'rpc')
        && !(ts.isIdentifier(f.expression) && KEIN_DATENZUGRIFF.has(f.expression.text))) {
        zugriffe.push(n)
      }
    }
    if (ts.isPropertyAccessExpression(n) && n.name.text === 'storage') zugriffe.push(n)
    ts.forEachChild(n, besuche)
  }
  besuche(rumpf)
  return { pruefungen, zugriffe, lokaleAufrufe }
}

/** `const x = await pruefeZweiFaktor()` gefolgt von `if (x) return x`? */
function mitAbbruch(aufruf) {
  const warte = aufruf.parent
  if (!warte || !ts.isAwaitExpression(warte)) return false
  const dekl = warte.parent
  if (!dekl || !ts.isVariableDeclaration(dekl) || !ts.isIdentifier(dekl.name)) return false
  const name = dekl.name.text
  const anweisung = dekl.parent && dekl.parent.parent
  if (!anweisung || !ts.isVariableStatement(anweisung)) return false
  const block = anweisung.parent
  if (!block || !block.statements) return false
  const i = block.statements.indexOf(anweisung)
  const naechste = block.statements[i + 1]
  if (!naechste || !ts.isIfStatement(naechste)) return false
  if (!ts.isIdentifier(naechste.expression) || naechste.expression.text !== name) return false
  let dann = naechste.thenStatement
  if (ts.isBlock(dann) && dann.statements.length === 1) dann = dann.statements[0]
  return ts.isReturnStatement(dann) && !!dann.expression && ts.isIdentifier(dann.expression) && dann.expression.text === name
}

function pruefeDatei(datei) {
  const text = fs.readFileSync(datei, 'utf8')
  const sf = ts.createSourceFile(datei, text, ts.ScriptTarget.Latest, true, datei.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  const rel = path.relative(ROOT, datei).replace(/\\/g, '/')
  const funde = []
  const handler = []

  // Lokale Funktionen der Datei (für Delegation wie `return handle(req)`)
  const lokal = new Map()
  for (const st of sf.statements) {
    if (ts.isFunctionDeclaration(st) && st.name && st.body) lokal.set(st.name.text, st)
    if (ts.isVariableStatement(st)) {
      for (const d of st.declarationList.declarations) {
        if (ts.isIdentifier(d.name) && d.initializer && (ts.isArrowFunction(d.initializer) || ts.isFunctionExpression(d.initializer))) {
          lokal.set(d.name.text, d.initializer)
        }
      }
    }
  }

  const zeile = n => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1

  /** Sucht die Prüfung im Rumpf von fn oder (transitiv) in lokal aufgerufenen Funktionen */
  function findePruefung(fn, besucht) {
    if (!fn.body) return null
    const { pruefungen, zugriffe, lokaleAufrufe } = sammle(fn.body)
    if (pruefungen.length > 0) return { fn, pruefung: pruefungen[0], zugriffe }
    for (const name of lokaleAufrufe) {
      const ziel = lokal.get(name)
      if (!ziel || besucht.has(name)) continue
      besucht.add(name)
      const r = findePruefung(ziel, besucht)
      if (r) return r
    }
    return null
  }

  for (const st of sf.statements) {
    // export async function GET(…) { … }
    if (ts.isFunctionDeclaration(st) && st.name && HTTP_METHODEN.has(st.name.text) && istExportiert(st)) {
      const methode = st.name.text
      const grund = ausnahmeGrund(text, st)
      if (grund !== null) {
        if (grund.length < MIN_GRUND) {
          funde.push({ typ: 'AUSNAHME_OHNE_GRUND', zeile: zeile(st), meldung: `${methode}: „zwei-faktor-ausnahme:“ braucht eine Begründung (mind. ${MIN_GRUND} Zeichen).` })
        }
        handler.push({ datei: rel, methode, art: 'Ausnahme', grund })
        continue
      }
      const r = findePruefung(st, new Set())
      if (!r) {
        funde.push({ typ: 'ZWEI_FAKTOR_FEHLT', zeile: zeile(st), meldung: `${methode} ruft ${PRUEFUNG}() nicht auf (auch nicht in einer lokal aufgerufenen Funktion).` })
        handler.push({ datei: rel, methode, art: 'FEHLT' })
        continue
      }
      if (!mitAbbruch(r.pruefung)) {
        funde.push({ typ: 'ZWEI_FAKTOR_OHNE_ABBRUCH', zeile: zeile(r.pruefung), meldung: `${methode}: Ergebnis von ${PRUEFUNG}() muss direkt mit „const x = await ${PRUEFUNG}(); if (x) return x“ zurückgegeben werden.` })
      }
      const frueher = r.zugriffe.filter(z => z.getStart(sf) < r.pruefung.getStart(sf))
      if (frueher.length > 0) {
        funde.push({ typ: 'ZWEI_FAKTOR_ZU_SPAET', zeile: zeile(frueher[0]), meldung: `${methode}: Datenzugriff vor ${PRUEFUNG}() – die Prüfung muss vorher laufen.` })
      }
      handler.push({ datei: rel, methode, art: r.fn === st ? 'geprüft' : 'geprüft (delegiert)' })
      continue
    }

    // export const GET = … / export { x as GET } – für den Guard nicht auswertbar
    if (ts.isVariableStatement(st) && istExportiert(st)) {
      for (const d of st.declarationList.declarations) {
        if (ts.isIdentifier(d.name) && HTTP_METHODEN.has(d.name.text) && ausnahmeGrund(text, st) === null) {
          funde.push({ typ: 'HANDLER_NICHT_PRUEFBAR', zeile: zeile(st), meldung: `${d.name.text} als Variable exportiert – bitte als „export async function ${d.name.text}(…)“ schreiben.` })
        }
      }
    }
    if (ts.isExportDeclaration(st) && st.exportClause && ts.isNamedExports(st.exportClause)) {
      for (const el of st.exportClause.elements) {
        if (HTTP_METHODEN.has(el.name.text)) {
          funde.push({ typ: 'HANDLER_NICHT_PRUEFBAR', zeile: zeile(st), meldung: `${el.name.text} per „export { … }“ exportiert – bitte als „export async function ${el.name.text}(…)“ schreiben.` })
        }
      }
    }
  }

  return { funde: funde.map(f => ({ ...f, datei: rel })), handler }
}

function main() {
  const dateien = routeDateien(API_DIR)
  if (dateien.length === 0) {
    console.error(`Keine Route-Handler unter ${API_DIR} gefunden.`)
    process.exit(2)
  }
  let funde = []
  let handler = []
  for (const d of dateien) {
    try {
      const r = pruefeDatei(d)
      funde = funde.concat(r.funde)
      handler = handler.concat(r.handler)
    } catch (err) {
      console.error(`Fehler beim Parsen von ${d}: ${err.message}`)
      process.exitCode = 2
    }
  }

  if (process.argv.includes('--liste')) {
    for (const h of handler) console.log(`${h.art.padEnd(20)} ${h.methode.padEnd(7)} ${h.datei}${h.grund ? `  – ${h.grund}` : ''}`)
    console.log('')
  }

  const ausnahmen = handler.filter(h => h.art === 'Ausnahme').length
  if (funde.length === 0) {
    console.log(`✓ API-Zwei-Faktor-Check: ${handler.length} Handler in ${dateien.length} Routen geprüft, ${handler.length - ausnahmen} mit Prüfung, ${ausnahmen} begründete Ausnahmen.`)
    return
  }

  console.error(`\n✗ API-Zwei-Faktor-Check: ${funde.length} Fund(e) in ${dateien.length} Routen:\n`)
  for (const f of funde) {
    console.error(`  ${f.datei}:${f.zeile}  [${f.typ}]`)
    console.error(`    ${f.meldung}`)
  }
  console.error(`\nJeder benutzergebundene Handler beginnt mit:`)
  console.error(`    const zweiFaktor = await ${PRUEFUNG}()   // import { ${PRUEFUNG} } from '@/lib/api/zweiFaktor'`)
  console.error(`    if (zweiFaktor) return zweiFaktor`)
  console.error(`Handler ohne Benutzersitzung (Webhook mit Signatur, Cron nur mit Secret …): Kommentar`)
  console.error(`"// zwei-faktor-ausnahme: <Grund>" direkt über dem exportierten Handler.\n`)
  process.exit(1)
}

main()
