#!/usr/bin/env node
/**
 * check-schreibsperre.js (KAN-5, 25.09.2026)
 *
 * Guard für den Nur-Lesen-Modus: Ist das Abo eines Betriebs gesperrt, darf er alles ansehen,
 * drucken und exportieren, aber nichts speichern (lib/auth/sperren.ts, Regeln in
 * lib/abo/regeln.ts). Durchgesetzt wird das serverseitig – dieses Skript verlangt die Prüfung
 * überall, wo geschrieben werden kann:
 *
 *  A) Server Actions – jede exportierte Funktion jeder 'use server'-Datei unter src/app muss
 *     (direkt oder über eine lokale Hilfsfunktion, üblich: den Kontext-Helfer) aufrufen:
 *
 *         await pruefeSchreibzugriff(membership)                  // wirft AktionsFehler
 *         const f = await schreibSperreFehler(membership)         // für { error } / { ok: false, fehler }
 *         if (f) return { error: f }
 *
 *  B) Route-Handler – jeder exportierte POST/PUT/PATCH/DELETE-Handler unter src/app:
 *
 *         const gesperrt = await schreibSperreKonflikt(membership)   // 403 JSON
 *         if (gesperrt) return gesperrt
 *
 *     (GET-Handler dürfen die Prüfung ebenfalls aufrufen, z. B. bei Kosten – Pflicht ist sie dort
 *     nicht: Exporte und Druck bleiben im Nur-Lesen-Modus ausdrücklich erlaubt.)
 *
 *  C) GET-Handler, die nebenbei schreiben (.insert/.update/.upsert/.delete/.upload/.remove,
 *     direkt oder über einen lokalen Helfer – z. B. Mail öffnen → Aktivität, BMD-Nummern):
 *     müssen schreibSperre()/schreibSperreKonflikt() fragen (und im Nur-Lesen-Modus das
 *     Schreiben weglassen) oder eine begründete Ausnahme haben.
 *
 *  D) Server Actions mit 'use server' IN der Funktion (Inline-Actions in page.tsx u. ä.): wie A –
 *     außer sie leiten nur an eine Action weiter (kein eigener Schreibzugriff, kein KI-Aufruf).
 *
 * Ausnahmen mit Begründung (mindestens 15 Zeichen):
 *   - je Funktion/Handler: Kommentar  // schreibsperre-ausnahme: <Grund>  direkt darüber
 *     (reine Lese-Actions, Zugriff entziehen, Webhooks, Cron, Profil …)
 *   - je Datei:            Kommentar  // schreibsperre-ausnahme-datei: <Grund>
 *     (Plattform-Admin, Registrierung, Betrieb wechseln …) – nur im Dateikopf (vor der ersten
 *     Anweisung nach 'use server'), sonst zählt er nicht.
 *
 * Funde:
 *  1. SCHREIBSPERRE_FEHLT        – weder Prüfung (auch nicht über lokale Helfer) noch Ausnahme.
 *  2. AUSNAHME_OHNE_GRUND        – Ausnahme-Kommentar ohne ausreichende Begründung.
 *  3. SCHREIBSPERRE_OHNE_ABBRUCH – Ergebnis nicht ausgewertet (pruefeSchreibzugriff nicht als
 *     eigene await-Anweisung; schreibSperreFehler/-Konflikt ohne unmittelbar folgendes
 *     „if (x) return …“).
 *  4. SCHREIBSPERRE_ZU_SPAET      – vor der Prüfung steht schon ein schreibender Zugriff
 *     (.insert/.update/.upsert/.delete/.rpc/.upload/.remove) oder ein KI-Aufruf (new Anthropic) –
 *     in der prüfenden Funktion ODER, bei Delegation an einen Helfer, in der exportierten
 *     Funktion vor dem Aufruf des Helfers.
 *  5. SCHREIBSPERRE_VOR_BETRIEB   – in derselben Funktion folgt die Betriebs-Prüfung (KAN-30)
 *     erst NACH der Schreibsperre: ein veralteter Tab bekäme sonst die Abo-Meldung des NEUEN
 *     Betriebs statt des Hinweises auf den Betriebswechsel.
 *  6. HANDLER_NICHT_PRUEFBAR      – Handler nicht als „export async function POST(…)“ geschrieben.
 *  7. SCHREIBENDER_GET            – GET-Handler schreibt, ohne die Schreibsperre zu fragen (C).
 *  8. AUSNAHME_DATEI_ZU_SPAET     – „schreibsperre-ausnahme-datei:“ steht nicht im Dateikopf.
 *
 * `node scripts/check-schreibsperre.js --liste` gibt alle Actions und Handler mit Einstufung aus.
 * Läuft als "prebuild" vor jedem "next build" (package.json) und im GitHub-Workflow
 * tenant-isolation-check.yml – ein Fund lässt Build und Deploy fehlschlagen.
 */

const fs = require('fs')
const path = require('path')
const ts = require('typescript')

// S112_GUARD_ROOT: anderes Projektverzeichnis prüfen (nur für die Tests in scripts/tests/abo-nurlesen.test.mjs)
const ROOT = process.env.S112_GUARD_ROOT ? path.resolve(process.env.S112_GUARD_ROOT) : path.resolve(__dirname, '..')
const APP_DIR = path.join(ROOT, 'src', 'app')
const AKTION_PRUEFUNGEN = new Set(['pruefeSchreibzugriff', 'schreibSperreFehler'])
const ROUTE_PRUEFUNG = 'schreibSperreKonflikt'
const BETRIEBS_PRUEFUNGEN = new Set(['pruefeSeitenBetrieb', 'seitenBetriebFehler', 'seitenBetriebKonflikt'])
const HTTP_METHODEN = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'])
const HTTP_SCHREIBEND = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])
const SCHREIB_AUFRUFE = new Set(['insert', 'update', 'upsert', 'delete', 'rpc', 'upload', 'remove'])
// GET-Handler: .rpc zählt nicht (lesende RPCs sind dort üblich; schreibende RPCs sperrt die Datenbank)
const GET_SCHREIB_AUFRUFE = new Set(['insert', 'update', 'upsert', 'delete', 'upload', 'remove'])
const GET_PRUEFUNGEN = new Set(['schreibSperre', 'schreibSperreKonflikt'])
const AUSNAHME = /schreibsperre-ausnahme\s*:\s*(.*)/i
const AUSNAHME_DATEI = /schreibsperre-ausnahme-datei\s*:\s*(.*)/i
const MIN_GRUND = 15

function dateien(dir, filter, out = []) {
  if (!fs.existsSync(dir)) return out
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) dateien(p, filter, out)
    else if (filter(e.name)) out.push(p)
  }
  return out
}

function grundAus(m) {
  return m ? m[1].replace(/\*\/\s*$/, '').trim() : null
}

function istExportiert(node) {
  return !!node.modifiers && node.modifiers.some(m => m.kind === ts.SyntaxKind.ExportKeyword)
}

function istFunktion(n) {
  return ts.isFunctionDeclaration(n) || ts.isFunctionExpression(n) || ts.isArrowFunction(n) || ts.isMethodDeclaration(n)
}

/** Datei beginnt mit der Direktive 'use server'? (Kommentare davor sind erlaubt) */
function istServerActionDatei(sf) {
  const erste = sf.statements[0]
  return !!erste && ts.isExpressionStatement(erste) && ts.isStringLiteral(erste.expression) && erste.expression.text === 'use server'
}

/** Begründung aus einem „schreibsperre-ausnahme:“-Kommentar direkt über dem Knoten (oder null) */
function ausnahmeGrund(text, node) {
  const kommentare = ts.getLeadingCommentRanges(text, node.getFullStart()) || []
  for (const k of kommentare) {
    const kommentar = text.slice(k.pos, k.end)
    if (AUSNAHME_DATEI.test(kommentar)) continue
    const m = AUSNAHME.exec(kommentar)
    if (m) return grundAus(m)
  }
  return null
}

function aufgerufenerName(n) {
  const f = n.expression
  if (ts.isIdentifier(f)) return f.text
  if (ts.isPropertyAccessExpression(f)) return f.name.text
  return null
}

/** Top-level-Funktionen der Datei: Name → Funktionsknoten (für Delegation an Helfer) */
function lokaleFunktionen(sf) {
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
  return lokal
}

/** Prüfaufrufe, Aufrufe lokaler Funktionen, Schreibzugriffe und Betriebs-Prüfungen in einem Rumpf (ohne verschachtelte Funktionen der Datei-Ebene) */
function sammle(rumpf, pruefNamen, schreibAufrufe = SCHREIB_AUFRUFE) {
  const pruefungen = []
  const lokaleAufrufe = []
  const lokaleAufrufKnoten = []
  const schreiben = []
  const betrieb = []
  function besuche(n) {
    if (ts.isCallExpression(n)) {
      const f = n.expression
      if (ts.isIdentifier(f)) {
        if (pruefNamen.has(f.text)) pruefungen.push(n)
        else if (BETRIEBS_PRUEFUNGEN.has(f.text)) betrieb.push(n)
        else { lokaleAufrufe.push(f.text); lokaleAufrufKnoten.push(n) }
      } else if (ts.isPropertyAccessExpression(f) && schreibAufrufe.has(f.name.text)) {
        schreiben.push(n)
      }
    }
    if (ts.isNewExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === 'Anthropic') schreiben.push(n)
    ts.forEachChild(n, besuche)
  }
  besuche(rumpf)
  return { pruefungen, lokaleAufrufe, lokaleAufrufKnoten, schreiben, betrieb }
}

/** Schreibt fn (oder ein lokal aufgerufener Helfer) etwas? → erster Schreibknoten, sonst null */
function findeSchreiben(fn, lokal, schreibAufrufe, besucht = new Set()) {
  if (!fn.body) return null
  const s = sammle(fn.body, new Set(), schreibAufrufe)
  if (s.schreiben.length > 0) return s.schreiben[0]
  for (const name of s.lokaleAufrufe) {
    const ziel = lokal.get(name)
    if (!ziel || besucht.has(name)) continue
    besucht.add(name)
    const r = findeSchreiben(ziel, lokal, schreibAufrufe, besucht)
    if (r) return r
  }
  return null
}

/** Prüfung in fn oder (transitiv) in lokal aufgerufenen Funktionen suchen */
function findePruefung(fn, lokal, pruefNamen, besucht) {
  if (!fn.body) return null
  const s = sammle(fn.body, pruefNamen)
  if (s.pruefungen.length > 0) return { fn, pruefung: s.pruefungen[0], ...s }
  for (const name of s.lokaleAufrufe) {
    const ziel = lokal.get(name)
    if (!ziel || besucht.has(name)) continue
    besucht.add(name)
    const r = findePruefung(ziel, lokal, pruefNamen, besucht)
    if (r) return r
  }
  return null
}

/** Anweisung, in der der Aufruf steht, samt umgebendem Block */
function anweisungImBlock(aufruf) {
  let n = aufruf
  while (n.parent && !ts.isBlock(n.parent) && !ts.isSourceFile(n.parent)) n = n.parent
  return n.parent && ts.isBlock(n.parent) ? { anweisung: n, block: n.parent } : null
}

function istReturn(st) {
  if (!st) return false
  if (ts.isReturnStatement(st)) return true
  return ts.isBlock(st) && st.statements.length > 0 && ts.isReturnStatement(st.statements[0])
}

function enthaeltBezeichner(n, name) {
  let gefunden = false
  function besuche(k) {
    if (gefunden) return
    if (ts.isIdentifier(k) && k.text === name) { gefunden = true; return }
    ts.forEachChild(k, besuche)
  }
  besuche(n)
  return gefunden
}

/** Wird das Ergebnis der Prüfung ausgewertet? */
function mitAbbruch(aufruf) {
  const name = aufgerufenerName(aufruf)
  const warte = aufruf.parent
  if (!warte || !ts.isAwaitExpression(warte)) return false
  if (name === 'pruefeSchreibzugriff') return ts.isExpressionStatement(warte.parent)
  // const x = await schreibSperreFehler(…) / schreibSperreKonflikt(…)  +  if (x…) return …
  const dekl = warte.parent
  if (!dekl || !ts.isVariableDeclaration(dekl) || !ts.isIdentifier(dekl.name)) return false
  const variable = dekl.name.text
  const ort = anweisungImBlock(aufruf)
  if (!ort) return false
  const i = ort.block.statements.indexOf(ort.anweisung)
  const naechste = ort.block.statements[i + 1]
  if (!naechste || !ts.isIfStatement(naechste) || !enthaeltBezeichner(naechste.expression, variable)) return false
  if (name === ROUTE_PRUEFUNG) {
    // Route-Handler: exakt „if (x) return x“ wie bei pruefeZweiFaktor()
    let dann = naechste.thenStatement
    if (ts.isBlock(dann) && dann.statements.length === 1) dann = dann.statements[0]
    return ts.isReturnStatement(dann) && !!dann.expression && ts.isIdentifier(dann.expression) && dann.expression.text === variable
  }
  return istReturn(naechste.thenStatement)
}

function reihenfolgeFunde(sf, r, bezeichnung, aufrufer, lokal, pruefNamen) {
  const funde = []
  const zeile = n => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1
  const pos = r.pruefung.getStart(sf)
  const frueh = r.schreiben.filter(z => z.getStart(sf) < pos)
  if (frueh.length > 0) {
    funde.push({ typ: 'SCHREIBSPERRE_ZU_SPAET', zeile: zeile(frueh[0]), meldung: `${bezeichnung}: schreibender Zugriff bzw. KI-Aufruf vor der Schreibsperre – die Prüfung muss vorher laufen.` })
  }
  // Delegation: prüft ein Helfer, darf die exportierte Funktion VOR dessen Aufruf nichts schreiben
  if (aufrufer && aufrufer !== r.fn && aufrufer.body) {
    const s = sammle(aufrufer.body, pruefNamen)
    const helfer = s.lokaleAufrufKnoten.find(k => {
      const ziel = lokal.get(k.expression.text)
      return ziel && findePruefung(ziel, lokal, pruefNamen, new Set([k.expression.text]))
    })
    if (helfer) {
      const vorHelfer = s.schreiben.filter(z => z.getStart(sf) < helfer.getStart(sf))
      if (vorHelfer.length > 0) {
        funde.push({ typ: 'SCHREIBSPERRE_ZU_SPAET', zeile: zeile(vorHelfer[0]), meldung: `${bezeichnung}: schreibender Zugriff bzw. KI-Aufruf vor dem Aufruf von ${helfer.expression.text}() – dort läuft erst die Schreibsperre.` })
      }
    }
  }
  const betriebDanach = r.betrieb.filter(b => b.getStart(sf) > pos)
  if (betriebDanach.length > 0) {
    funde.push({ typ: 'SCHREIBSPERRE_VOR_BETRIEB', zeile: zeile(betriebDanach[0]), meldung: `${bezeichnung}: Betriebs-Prüfung (KAN-30) erst nach der Schreibsperre – zuerst den Betrieb prüfen, dann die Schreibsperre.` })
  }
  if (!mitAbbruch(r.pruefung)) {
    const n = aufgerufenerName(r.pruefung)
    funde.push({
      typ: 'SCHREIBSPERRE_OHNE_ABBRUCH', zeile: zeile(r.pruefung),
      meldung: n === 'pruefeSchreibzugriff'
        ? `${bezeichnung}: „await pruefeSchreibzugriff(…)“ muss als eigene Anweisung stehen.`
        : `${bezeichnung}: Ergebnis von ${n}() muss direkt mit „const x = await ${n}(…); if (x) return …“ ausgewertet werden.`,
    })
  }
  return funde
}

// ── A) Server Actions ────────────────────────────────────────────────────────

function pruefeActionDatei(datei) {
  const text = fs.readFileSync(datei, 'utf8')
  const sf = ts.createSourceFile(datei, text, ts.ScriptTarget.Latest, true, datei.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  if (!istServerActionDatei(sf)) return null
  const rel = path.relative(ROOT, datei).replace(/\\/g, '/')
  const zeile = n => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1
  const funde = []
  const eintraege = []

  const md = AUSNAHME_DATEI.exec(text)
  if (md) {
    // nur im Dateikopf gültig – ein Kommentar irgendwo in der Datei darf nicht alle Actions freistellen
    const kopfEnde = sf.statements[1] ? sf.statements[1].getStart(sf) : text.length
    if (md.index > kopfEnde) {
      funde.push({ typ: 'AUSNAHME_DATEI_ZU_SPAET', zeile: text.slice(0, md.index).split('\n').length, meldung: `„schreibsperre-ausnahme-datei:“ gilt nur im Dateikopf (vor der ersten Anweisung nach 'use server') – bitte dorthin verschieben oder je Funktion begründen.` })
      return { funde: funde.map(f => ({ ...f, datei: rel })), eintraege }
    }
    const grund = grundAus(md)
    if (grund.length < MIN_GRUND) {
      funde.push({ typ: 'AUSNAHME_OHNE_GRUND', zeile: text.slice(0, md.index).split('\n').length, meldung: `„schreibsperre-ausnahme-datei:“ braucht eine Begründung (mind. ${MIN_GRUND} Zeichen).` })
    }
    eintraege.push({ datei: rel, name: '(ganze Datei)', art: 'Ausnahme', grund })
    return { funde: funde.map(f => ({ ...f, datei: rel })), eintraege }
  }

  const lokal = lokaleFunktionen(sf)
  const exporte = []
  for (const st of sf.statements) {
    if (ts.isFunctionDeclaration(st) && st.name && st.body && istExportiert(st)) exporte.push({ name: st.name.text, fn: st, knoten: st })
    if (ts.isVariableStatement(st) && istExportiert(st)) {
      for (const d of st.declarationList.declarations) {
        if (ts.isIdentifier(d.name) && d.initializer && (ts.isArrowFunction(d.initializer) || ts.isFunctionExpression(d.initializer))) {
          exporte.push({ name: d.name.text, fn: d.initializer, knoten: st })
        }
      }
    }
  }

  for (const { name, fn, knoten } of exporte) {
    const grund = ausnahmeGrund(text, knoten)
    if (grund !== null) {
      if (grund.length < MIN_GRUND) {
        funde.push({ typ: 'AUSNAHME_OHNE_GRUND', zeile: zeile(knoten), meldung: `${name}: „schreibsperre-ausnahme:“ braucht eine Begründung (mind. ${MIN_GRUND} Zeichen).` })
      }
      eintraege.push({ datei: rel, name, art: 'Ausnahme', grund })
      continue
    }
    const r = findePruefung(fn, lokal, AKTION_PRUEFUNGEN, new Set())
    if (!r) {
      funde.push({ typ: 'SCHREIBSPERRE_FEHLT', zeile: zeile(knoten), meldung: `${name}() ruft weder pruefeSchreibzugriff() noch schreibSperreFehler() auf (auch nicht über einen lokalen Helfer) und hat keinen „schreibsperre-ausnahme:“-Kommentar.` })
      eintraege.push({ datei: rel, name, art: 'FEHLT' })
      continue
    }
    funde.push(...reihenfolgeFunde(sf, r, `${name}()`, fn, lokal, AKTION_PRUEFUNGEN))
    eintraege.push({ datei: rel, name, art: r.fn === fn ? 'geprüft' : 'geprüft (Helfer)' })
  }
  return { funde: funde.map(f => ({ ...f, datei: rel })), eintraege }
}

// ── B) Route-Handler ─────────────────────────────────────────────────────────

function pruefeRouteDatei(datei) {
  const text = fs.readFileSync(datei, 'utf8')
  const sf = ts.createSourceFile(datei, text, ts.ScriptTarget.Latest, true, datei.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  const rel = path.relative(ROOT, datei).replace(/\\/g, '/')
  const zeile = n => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1
  const funde = []
  const eintraege = []
  const lokal = lokaleFunktionen(sf)
  const pruefNamen = new Set([ROUTE_PRUEFUNG])

  for (const st of sf.statements) {
    if (ts.isFunctionDeclaration(st) && st.name && HTTP_METHODEN.has(st.name.text) && istExportiert(st)) {
      const methode = st.name.text
      const grund = ausnahmeGrund(text, st)
      const r = findePruefung(st, lokal, pruefNamen, new Set())
      if (!HTTP_SCHREIBEND.has(methode)) {
        // Lesende Handler: Prüfung freiwillig (z. B. Kosten) – wenn vorhanden, richtig verwendet
        if (r && r.fn === st) funde.push(...reihenfolgeFunde(sf, r, methode, st, lokal, pruefNamen))
        if (r) { eintraege.push({ datei: rel, name: methode, art: 'geprüft (lesend)' }); continue }
        // C) GET schreibt nebenbei? → Schreibsperre fragen oder begründen
        const schreibt = findeSchreiben(st, lokal, GET_SCHREIB_AUFRUFE)
        if (!schreibt) continue
        if (grund !== null) {
          if (grund.length < MIN_GRUND) {
            funde.push({ typ: 'AUSNAHME_OHNE_GRUND', zeile: zeile(st), meldung: `${methode}: „schreibsperre-ausnahme:“ braucht eine Begründung (mind. ${MIN_GRUND} Zeichen).` })
          }
          eintraege.push({ datei: rel, name: methode, art: 'Ausnahme (GET schreibt)', grund })
          continue
        }
        if (findePruefung(st, lokal, GET_PRUEFUNGEN, new Set())) {
          eintraege.push({ datei: rel, name: methode, art: 'geprüft (GET schreibt)' })
          continue
        }
        funde.push({ typ: 'SCHREIBENDER_GET', zeile: zeile(schreibt), meldung: `${methode} schreibt (auch im Nur-Lesen-Modus), fragt aber weder schreibSperre() noch schreibSperreKonflikt() – das Schreiben im Nur-Lesen-Modus weglassen oder „schreibsperre-ausnahme:“ begründen.` })
        eintraege.push({ datei: rel, name: methode, art: 'FEHLT (GET schreibt)' })
        continue
      }
      if (grund !== null) {
        if (grund.length < MIN_GRUND) {
          funde.push({ typ: 'AUSNAHME_OHNE_GRUND', zeile: zeile(st), meldung: `${methode}: „schreibsperre-ausnahme:“ braucht eine Begründung (mind. ${MIN_GRUND} Zeichen).` })
        }
        eintraege.push({ datei: rel, name: methode, art: 'Ausnahme', grund })
        continue
      }
      if (!r) {
        funde.push({ typ: 'SCHREIBSPERRE_FEHLT', zeile: zeile(st), meldung: `${methode} ruft ${ROUTE_PRUEFUNG}() nicht auf (auch nicht in einer lokal aufgerufenen Funktion) und hat keinen „schreibsperre-ausnahme:“-Kommentar.` })
        eintraege.push({ datei: rel, name: methode, art: 'FEHLT' })
        continue
      }
      funde.push(...reihenfolgeFunde(sf, r, methode, st, lokal, pruefNamen))
      eintraege.push({ datei: rel, name: methode, art: r.fn === st ? 'geprüft' : 'geprüft (delegiert)' })
      continue
    }
    // export const POST = … / export { x as POST } – für den Guard nicht auswertbar
    if (ts.isVariableStatement(st) && istExportiert(st)) {
      for (const d of st.declarationList.declarations) {
        if (ts.isIdentifier(d.name) && HTTP_SCHREIBEND.has(d.name.text) && ausnahmeGrund(text, st) === null) {
          funde.push({ typ: 'HANDLER_NICHT_PRUEFBAR', zeile: zeile(st), meldung: `${d.name.text} als Variable exportiert – bitte als „export async function ${d.name.text}(…)“ schreiben.` })
        }
      }
    }
    if (ts.isExportDeclaration(st) && st.exportClause && ts.isNamedExports(st.exportClause)) {
      for (const el of st.exportClause.elements) {
        if (HTTP_SCHREIBEND.has(el.name.text)) {
          funde.push({ typ: 'HANDLER_NICHT_PRUEFBAR', zeile: zeile(st), meldung: `${el.name.text} per „export { … }“ exportiert – bitte als „export async function ${el.name.text}(…)“ schreiben.` })
        }
      }
    }
  }
  return { funde: funde.map(f => ({ ...f, datei: rel })), eintraege }
}

// ── D) Inline-Server-Actions ('use server' in der Funktion) ──────────────────

function hatUseServerRumpf(fn) {
  const b = fn.body
  if (!b || !ts.isBlock(b) || b.statements.length === 0) return false
  const erste = b.statements[0]
  return ts.isExpressionStatement(erste) && ts.isStringLiteral(erste.expression) && erste.expression.text === 'use server'
}

/** Kommentar direkt über dem Knoten oder über der umgebenden Anweisung/JSX-Eigenschaft */
function ausnahmeGrundInline(text, fn) {
  for (let n = fn, i = 0; n && i < 4; n = n.parent, i++) {
    const g = ausnahmeGrund(text, n)
    if (g !== null) return g
    if (ts.isStatement(n) || ts.isJsxAttribute(n)) break
  }
  return null
}

function pruefeInlineDatei(datei) {
  const text = fs.readFileSync(datei, 'utf8')
  if (!/['"]use server['"]/.test(text)) return null
  const sf = ts.createSourceFile(datei, text, ts.ScriptTarget.Latest, true, datei.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  if (istServerActionDatei(sf)) return null   // ganze Datei: Teil A
  const rel = path.relative(ROOT, datei).replace(/\\/g, '/')
  const zeile = n => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1
  const lokal = lokaleFunktionen(sf)
  const funde = []
  const eintraege = []
  ;(function besuche(n) {
    if (istFunktion(n) && hatUseServerRumpf(n)) {
      const name = (n.name && ts.isIdentifier(n.name) ? n.name.text : null) || `Inline-Action Zeile ${zeile(n)}`
      const grund = ausnahmeGrundInline(text, n)
      const r = findePruefung(n, lokal, AKTION_PRUEFUNGEN, new Set())
      if (grund !== null) {
        if (grund.length < MIN_GRUND) funde.push({ typ: 'AUSNAHME_OHNE_GRUND', zeile: zeile(n), meldung: `${name}: „schreibsperre-ausnahme:“ braucht eine Begründung (mind. ${MIN_GRUND} Zeichen).` })
        eintraege.push({ datei: rel, name, art: 'Ausnahme', grund })
      } else if (r) {
        funde.push(...reihenfolgeFunde(sf, r, `${name}()`, n, lokal, AKTION_PRUEFUNGEN))
        eintraege.push({ datei: rel, name, art: 'geprüft (inline)' })
      } else if (findeSchreiben(n, lokal, SCHREIB_AUFRUFE)) {
        funde.push({ typ: 'SCHREIBSPERRE_FEHLT', zeile: zeile(n), meldung: `${name}: Inline-Server-Action schreibt selbst, ruft aber weder pruefeSchreibzugriff() noch schreibSperreFehler() auf und hat keinen „schreibsperre-ausnahme:“-Kommentar.` })
        eintraege.push({ datei: rel, name, art: 'FEHLT' })
      } else {
        // leitet nur an eine (geprüfte) Action weiter
        eintraege.push({ datei: rel, name, art: 'weiterleitend (inline)' })
      }
    }
    ts.forEachChild(n, besuche)
  })(sf)
  return { funde: funde.map(f => ({ ...f, datei: rel })), eintraege }
}

function main() {
  const quellen = dateien(APP_DIR, n => /\.(ts|tsx)$/.test(n))
  const routen = dateien(APP_DIR, n => /^route\.(ts|tsx|js)$/.test(n))
  if (quellen.length === 0 || routen.length === 0) {
    console.error(`Keine Dateien unter ${APP_DIR} gefunden.`)
    process.exit(2)
  }
  let funde = []
  let actions = []
  let handler = []
  for (const d of quellen) {
    try {
      const r = pruefeActionDatei(d) ?? pruefeInlineDatei(d)
      if (!r) continue
      funde = funde.concat(r.funde)
      actions = actions.concat(r.eintraege)
    } catch (err) {
      console.error(`Fehler beim Parsen von ${d}: ${err.message}`)
      process.exitCode = 2
    }
  }
  for (const d of routen) {
    try {
      const r = pruefeRouteDatei(d)
      funde = funde.concat(r.funde)
      handler = handler.concat(r.eintraege)
    } catch (err) {
      console.error(`Fehler beim Parsen von ${d}: ${err.message}`)
      process.exitCode = 2
    }
  }

  if (process.argv.includes('--liste')) {
    console.log('Server Actions:')
    for (const e of actions) console.log(`  ${e.art.padEnd(18)} ${e.datei} › ${e.name}${e.grund ? `  – ${e.grund}` : ''}`)
    console.log('Route-Handler:')
    for (const e of handler) console.log(`  ${e.art.padEnd(18)} ${e.name.padEnd(7)} ${e.datei}${e.grund ? `  – ${e.grund}` : ''}`)
    console.log('')
  }

  const aAusnahmen = actions.filter(e => e.art === 'Ausnahme').length
  const aInline = actions.filter(e => e.art === 'weiterleitend (inline)' || e.art === 'geprüft (inline)').length
  const hAusnahmen = handler.filter(e => e.art === 'Ausnahme').length
  const hSchreibend = handler.filter(e => !['geprüft (lesend)', 'geprüft (GET schreibt)', 'Ausnahme (GET schreibt)'].includes(e.art)).length
  const hGet = handler.filter(e => e.art === 'geprüft (GET schreibt)' || e.art === 'Ausnahme (GET schreibt)').length
  if (funde.length === 0) {
    console.log(`✓ Schreibsperre-Check (KAN-5): ${actions.length} Server Actions (${actions.length - aAusnahmen} geprüft bzw. weiterleitend, davon ${aInline} inline; ${aAusnahmen} begründete Ausnahmen), ${hSchreibend} schreibende Route-Handler (${hSchreibend - hAusnahmen} geprüft, ${hAusnahmen} begründete Ausnahmen), ${hGet} schreibende GET-Handler geprüft bzw. begründet.`)
    return
  }

  console.error(`\n✗ Schreibsperre-Check (KAN-5): ${funde.length} Fund(e):\n`)
  for (const f of funde) {
    console.error(`  ${f.datei}:${f.zeile}  [${f.typ}]`)
    console.error(`    ${f.meldung}`)
  }
  console.error(`\nServer Actions – im Kontext-Helfer direkt nach der Betriebs-Prüfung (KAN-30), vor canWrite/canAdmin:`)
  console.error(`    await pruefeSchreibzugriff(membership)   // import { pruefeSchreibzugriff } from '@/lib/auth/sperren'`)
  console.error(`Route-Handler (POST/PUT/PATCH/DELETE):`)
  console.error(`    const gesperrt = await ${ROUTE_PRUEFUNG}(membership)   // import { ${ROUTE_PRUEFUNG} } from '@/lib/auth/sperren'`)
  console.error(`    if (gesperrt) return gesperrt`)
  console.error(`Begründete Ausnahme: "// schreibsperre-ausnahme: <Grund>" direkt über der Funktion bzw. dem Handler,`)
  console.error(`für ganze Dateien "// schreibsperre-ausnahme-datei: <Grund>".\n`)
  process.exit(1)
}

main()
