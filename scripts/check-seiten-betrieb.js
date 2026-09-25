#!/usr/bin/env node
/**
 * check-seiten-betrieb.js (KAN-30, 25.09.2026)
 *
 * Guard gegen Server Actions ohne Betriebs-Prüfung: Der aktive Betrieb steht browserweit im
 * Cookie. Wechselt ein Tab den Betrieb, dürfen Actions eines anderen, veralteten Tabs nicht in
 * den neuen Betrieb schreiben. Der Betriebs-Wächter schickt dazu den Betrieb der Seite im Header
 * x-s112-seiten-betrieb mit; geprüft wird er in src/lib/auth/seitenBetrieb.ts:
 *
 *     await pruefeSeitenBetrieb(membership.tenantId)            // wirft AktionsFehler
 *     const f = await seitenBetriebFehler(membership.tenantId)  // für { error } / { ok: false, fehler }
 *     if (f) return { error: f }
 *
 * Jede 'use server'-Datei unter src/app/(dashboard) muss eine der beiden Prüfungen aufrufen
 * (üblich: im Kontext-Helfer direkt nach getCurrentMembership()) – oder begründet ausgenommen
 * sein (Plattform-Admin, Ziel-Betrieb als Parameter …):
 *
 *     // seiten-betrieb-ausnahme: <Grund, mindestens 15 Zeichen>
 *
 * Funde:
 *  1. SEITEN_BETRIEB_FEHLT     – weder Prüfung noch Ausnahme-Kommentar in der Datei.
 *  2. AUSNAHME_OHNE_GRUND      – Ausnahme-Kommentar ohne ausreichende Begründung.
 *  3. PRUEFUNG_NACH_RECHTEN    – in derselben Funktion steht canWrite/canAdmin/canManageUsers VOR
 *     der Prüfung: ein veralteter Tab bekäme dann die Rechte-Meldung des NEUEN Betriebs
 *     („Keine Berechtigung …“) statt des Hinweises auf den Betriebswechsel.
 *
 * Läuft als "prebuild" vor jedem "next build" (package.json) und im GitHub-Workflow
 * tenant-isolation-check.yml – ein Fund lässt Build und Deploy fehlschlagen.
 */

const fs = require('fs')
const path = require('path')
const ts = require('typescript')

const ROOT = path.resolve(__dirname, '..')
const DASHBOARD_DIR = path.join(ROOT, 'src', 'app', '(dashboard)')
const PRUEFUNGEN = new Set(['pruefeSeitenBetrieb', 'seitenBetriebFehler'])
const RECHTE = new Set(['canWrite', 'canAdmin', 'canManageUsers'])
const AUSNAHME = /seiten-betrieb-ausnahme\s*:\s*(.*)/i
const MIN_GRUND = 15

function dateien(dir, out = []) {
  if (!fs.existsSync(dir)) return out
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) dateien(p, out)
    else if (/\.(ts|tsx)$/.test(e.name)) out.push(p)
  }
  return out
}

/** Datei beginnt mit der Direktive 'use server'? (Kommentare davor sind erlaubt) */
function istServerActionDatei(sf) {
  const erste = sf.statements[0]
  return !!erste && ts.isExpressionStatement(erste) && ts.isStringLiteral(erste.expression) && erste.expression.text === 'use server'
}

function aufgerufenerName(n) {
  const f = n.expression
  if (ts.isIdentifier(f)) return f.text
  if (ts.isPropertyAccessExpression(f)) return f.name.text
  return null
}

function istFunktion(n) {
  return ts.isFunctionDeclaration(n) || ts.isFunctionExpression(n) || ts.isArrowFunction(n) || ts.isMethodDeclaration(n)
}

function pruefeDatei(datei) {
  const text = fs.readFileSync(datei, 'utf8')
  const sf = ts.createSourceFile(datei, text, ts.ScriptTarget.Latest, true, datei.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  if (!istServerActionDatei(sf)) return null
  const rel = path.relative(ROOT, datei).replace(/\\/g, '/')
  const zeile = n => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1
  const funde = []

  // Aufrufe je umschließender Funktion sammeln (für die Reihenfolge-Regel)
  const prueefAufrufe = []
  const jeFunktion = new Map()   // Funktionsknoten → { pruefungen: [], rechte: [] }
  function besuche(n, fn) {
    const aktuell = istFunktion(n) ? n : fn
    if (ts.isCallExpression(n)) {
      const name = aufgerufenerName(n)
      if (name && (PRUEFUNGEN.has(name) || RECHTE.has(name)) && aktuell) {
        if (!jeFunktion.has(aktuell)) jeFunktion.set(aktuell, { pruefungen: [], rechte: [] })
        const eintrag = jeFunktion.get(aktuell)
        if (PRUEFUNGEN.has(name)) { eintrag.pruefungen.push(n); prueefAufrufe.push(n) }
        else eintrag.rechte.push(n)
      } else if (name && PRUEFUNGEN.has(name)) {
        prueefAufrufe.push(n)
      }
    }
    ts.forEachChild(n, k => besuche(k, aktuell))
  }
  besuche(sf, null)

  const m = AUSNAHME.exec(text)
  const grund = m ? m[1].replace(/\*\/\s*$/, '').trim() : null
  if (grund !== null && grund.length < MIN_GRUND) {
    funde.push({ typ: 'AUSNAHME_OHNE_GRUND', zeile: text.slice(0, m.index).split('\n').length, meldung: `„seiten-betrieb-ausnahme:“ braucht eine Begründung (mind. ${MIN_GRUND} Zeichen).` })
  }
  if (prueefAufrufe.length === 0 && grund === null) {
    funde.push({ typ: 'SEITEN_BETRIEB_FEHLT', zeile: 1, meldung: 'Server-Action-Datei ruft weder pruefeSeitenBetrieb() noch seitenBetriebFehler() auf (und hat keinen „seiten-betrieb-ausnahme:“-Kommentar).' })
  }

  for (const { pruefungen, rechte } of jeFunktion.values()) {
    if (pruefungen.length === 0 || rechte.length === 0) continue
    const erstePruefung = Math.min(...pruefungen.map(p => p.getStart(sf)))
    const frueh = rechte.filter(r => r.getStart(sf) < erstePruefung)
    if (frueh.length > 0) {
      funde.push({ typ: 'PRUEFUNG_NACH_RECHTEN', zeile: zeile(frueh[0]), meldung: `${aufgerufenerName(frueh[0])}() steht vor der Betriebs-Prüfung – ein veralteter Tab bekäme die Rechte-Meldung des neuen Betriebs. Prüfung direkt nach getCurrentMembership() aufrufen.` })
    }
  }

  return { rel, funde: funde.map(f => ({ ...f, datei: rel })), art: prueefAufrufe.length > 0 ? 'geprüft' : 'Ausnahme', grund }
}

function main() {
  const liste = dateien(DASHBOARD_DIR)
  if (liste.length === 0) {
    console.error(`Keine Dateien unter ${DASHBOARD_DIR} gefunden.`)
    process.exit(2)
  }
  let funde = []
  const ergebnisse = []
  for (const d of liste) {
    try {
      const r = pruefeDatei(d)
      if (!r) continue
      ergebnisse.push(r)
      funde = funde.concat(r.funde)
    } catch (err) {
      console.error(`Fehler beim Parsen von ${d}: ${err.message}`)
      process.exitCode = 2
    }
  }

  if (process.argv.includes('--liste')) {
    for (const r of ergebnisse) console.log(`${r.art.padEnd(10)} ${r.rel}${r.art === 'Ausnahme' && r.grund ? `  – ${r.grund}` : ''}`)
    console.log('')
  }

  const ausnahmen = ergebnisse.filter(r => r.art === 'Ausnahme').length
  if (funde.length === 0) {
    console.log(`✓ Seiten-Betrieb-Check (KAN-30): ${ergebnisse.length} Server-Action-Dateien geprüft, ${ergebnisse.length - ausnahmen} mit Betriebs-Prüfung, ${ausnahmen} begründete Ausnahmen.`)
    return
  }

  console.error(`\n✗ Seiten-Betrieb-Check (KAN-30): ${funde.length} Fund(e):\n`)
  for (const f of funde) {
    console.error(`  ${f.datei}:${f.zeile}  [${f.typ}]`)
    console.error(`    ${f.meldung}`)
  }
  console.error(`\nIm Kontext-Helfer direkt nach getCurrentMembership() (vor canWrite/canAdmin):`)
  console.error(`    await pruefeSeitenBetrieb(membership.tenantId)   // import { pruefeSeitenBetrieb } from '@/lib/auth/seitenBetrieb'`)
  console.error(`Actions ohne Bezug zum aktiven Betrieb (Plattform-Admin, Ziel-Betrieb als Parameter): Kommentar`)
  console.error(`"// seiten-betrieb-ausnahme: <Grund>" in der Datei.\n`)
  process.exit(1)
}

main()
