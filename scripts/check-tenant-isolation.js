#!/usr/bin/env node
/**
 * check-tenant-isolation.js
 *
 * Automatisierter Guard gegen den Mandanten-Isolation-Bug ("neuer Mandant zeigt
 * fremde Daten"), der diese App bereits einmal systemweit betroffen hat: RLS
 * allein reicht nicht, weil get_user_tenant_ids() ALLE Mitgliedschaften eines
 * Users liefert, nicht nur den aktiv gewählten Betrieb. Jede Abfrage auf eine
 * mandantenbezogene Tabelle braucht deshalb zusätzlich ein explizites
 * .eq('tenant_id', ...) (oder muss über den tf(...)-Wrapper laufen, der das
 * intern tut).
 *
 * Dieses Skript durchsucht den gesamten src/-Ordner nach drei Fehlerklassen:
 *
 *  1. TENANT_FILTER_MISSING – eine SELECT/UPDATE/DELETE-Abfrage auf eine der
 *     PROTECTED_TABLES ohne erkennbaren .eq('tenant_id', ...)-Filter in
 *     derselben Kette und ohne tf(...)-Wrapper.
 *  2. INSERT_MISSING_TENANT_ID – ein .insert(...)/.upsert(...) auf eine der
 *     PROTECTED_TABLES, dessen (statisch als Objekt-/Array-Literal erkennbares)
 *     Payload keine tenant_id-Property setzt.
 *  3. ARBITRARY_MEMBERSHIP_LOOKUP – eine Abfrage auf tenant_memberships, die
 *     per .limit(1).single()/.maybeSingle() "irgendeine" Mitgliedschaft greift
 *     statt der aktiven (der ursprüngliche Bug-Pattern) - sollte stattdessen
 *     getCurrentMembership() aus '@/lib/auth/roles' verwenden.
 *
 * Wird als "prebuild"-Skript vor jedem "next build" ausgeführt (siehe
 * package.json) - ein Fund lässt den Build (und damit den Vercel-Deploy)
 * fehlschlagen. Zusätzlich als eigener GitHub-Actions-Workflow für schnelles
 * Feedback bei jedem Push/PR.
 *
 * Ausnahmen: eine Zeile mit dem Kommentar "tenant-isolation-ignore: <Grund>"
 * unmittelbar über oder auf derselben Zeile wie die betroffene .from(...)-Abfrage
 * unterdrückt den jeweiligen Fund - der Grund muss im Kommentar stehen, damit
 * Ausnahmen im Code sichtbar und begründet bleiben (kein stilles Whitelisting).
 *
 * Kein vollständiger SQL-/Datenflussbeweis, sondern eine strukturelle
 * Heuristik auf dem AST - deckt aber genau die beiden Fehlerklassen ab, die
 * in dieser App real aufgetreten sind.
 */

const fs = require('fs')
const path = require('path')
const ts = require('typescript')

const ROOT = path.resolve(__dirname, '..')
const SRC_DIR = path.join(ROOT, 'src')

// Tabellen mit tenant_id-Spalte, extrahiert aus supabase/migrations/*.sql
// (create table ... tenant_id / alter table ... add column tenant_id).
// tenant_memberships bewusst NICHT hier drin - die hat eigene Semantik
// (wird per user_id gesucht) und wird unten separat behandelt.
const PROTECTED_TABLES = [
  'aktivitaet_dokumente', 'aktivitaeten', 'ama_erntemeldungen', 'assistent_korrekturen',
  'assistent_unterhaltungen', 'behaelter', 'benachrichtigungen', 'behandlungen', 'bestellungen', 'dac_antrag',
  'datenschutz_consents', 'duengemittel', 'duengemittel_lager_bewegungen', 'ea_belege', 'ea_dauerauftraege',
  'ea_dauerauftrag_log', 'ea_kategorien', 'ea_monatsabschluss', 'ea_transaktionen', 'ea_uva',
  'exportauftraege', 'fibu_buchungssaetze',
  'fibu_kontenplan', 'fibu_perioden', 'firmen', 'fuellung_chargen', 'fuellungen', 'grundstuecke',
  'keller_behandlungen', 'keller_behandlungstypen', 'keller_umzuege', 'kellerplaene',
  'kellerplan_positionen', 'kontakte', 'konten', 'konto_umbuchungen', 'kostenarten', 'kosteneintraege', 'kostenstellen', 'lagen',
  'module_flags', 'pflanzenschutzmittel', 'pipeline_eintraege', 'preislisten',
  'preislisten_positionen', 'pressungen', 'pruefnummernantraege', 'psm_lager_bewegungen',
  'rabattgruppen', 'saetze_massnahmen', 'sonstige_artikel', 'sumup_checkouts', 'sumup_terminals',
  'sumup_transaktionen', 'tenant_einstellungen', 'transaktionszaehler', 'transportbescheinigungen',
  'traubenverkauf', 'user_email_connections', 'verkauf_positionen', 'verkaufsposten',
  'verschneidungen', 'weinanalysen', 'weinausbau', 'weinausbau_weingaerten',
  'weinbaugebiete_custom', 'weingarten', 'weinjahrgaenge', 'zahlungen', 'zeiterfassung',
  'zukauf_posten',
]

// Wrapper-Funktionsnamen, die intern selbst .eq('tenant_id', ...) anwenden
// (siehe z.B. src/app/(dashboard)/dashboard/page.tsx, reports/page.tsx: `tf`).
const KNOWN_SAFE_WRAPPERS = /^tf$/

const IGNORE_DIRS = new Set(['node_modules', '.next', '.git', '_to_delete'])
const IGNORE_COMMENT = /tenant-isolation-ignore\s*:/i

function collectSourceFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (IGNORE_DIRS.has(entry.name)) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      collectSourceFiles(full, out)
    } else if (/\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith('.d.ts')) {
      out.push(full)
    }
  }
  return out
}

function isSuppressed(sourceText, node) {
  const start = node.getStart()
  const lineStart = sourceText.lastIndexOf('\n', start) + 1
  const prevLineStart = sourceText.lastIndexOf('\n', lineStart - 2) + 1
  const context = sourceText.slice(prevLineStart, sourceText.indexOf('\n', start) === -1 ? sourceText.length : sourceText.indexOf('\n', start))
  return IGNORE_COMMENT.test(context)
}

// Object-Literal (auch verschachtelt in einem Array-Literal für Bulk-Inserts) enthält
// eine 'tenant_id'-Property (PropertyAssignment ODER Shorthand { tenant_id })?
function objectHasTenantIdKey(expr) {
  if (!expr) return false
  if (ts.isObjectLiteralExpression(expr)) {
    return expr.properties.some(p => {
      if (ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p)) {
        return ts.isIdentifier(p.name) && p.name.text === 'tenant_id'
      }
      if (ts.isSpreadAssignment(p)) return true // z.B. {...basisFelder, ...} - kann tenant_id enthalten, nicht statisch prüfbar -> nicht blockieren
      return false
    })
  }
  if (ts.isArrayLiteralExpression(expr)) {
    // Bulk-Insert: JEDES Element muss tenant_id tragen
    return expr.elements.length > 0 && expr.elements.every(el => objectHasTenantIdKey(el))
  }
  return null // nicht statisch bestimmbar (z.B. eine Variable) - Aufrufer entscheidet, wie damit umzugehen ist
}

// Klettert eine bereits vorliegende Kette (z.B. die rechte Seite einer Reassignment
// `query = query.eq('tenant_id', tenantId)`) von AUSSEN nach INNEN ab (umgekehrte
// Richtung zu analyzeChain(), das von .from(...) aus nach OBEN klettert) und meldet,
// ob irgendwo in dieser Kette ein .eq('tenant_id', ...) oder ein bekannter
// Tenant-Filter-Wrapper (z.B. tf(...)) vorkommt.
function chainContainsTenantIdEq(expr) {
  let node = expr
  while (node) {
    if (ts.isCallExpression(node)) {
      if (ts.isPropertyAccessExpression(node.expression)) {
        const methodName = node.expression.name.text
        if (methodName === 'eq') {
          const args = node.arguments
          if (args.length > 0 && ts.isStringLiteralLike(args[0]) && args[0].text === 'tenant_id') {
            return true
          }
        }
        node = node.expression.expression
        continue
      }
      if (ts.isIdentifier(node.expression) && KNOWN_SAFE_WRAPPERS.test(node.expression.text)) {
        return true
      }
      node = node.expression
      continue
    }
    if (ts.isPropertyAccessExpression(node)) { node = node.expression; continue }
    if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isNonNullExpression(node)) {
      node = node.expression
      continue
    }
    break
  }
  return false
}

// Sucht im GESAMTEN Source-File nach einer Reassignment-Zeile der Form
// `varName = varName.eq('tenant_id', ...)` (bzw. `varName = tf(varName)`) - das
// gängige Pattern `let query = supabase.from(...)...; if (tenantId) query =
// query.eq('tenant_id', tenantId)` verteilt den Tenant-Filter bewusst auf eine
// SPÄTERE, bedingte Anweisung statt auf dieselbe Kette wie das .from(...), damit
// der Filter nur angewendet wird, wenn tatsächlich ein aktiver Mandant vorliegt.
// analyzeChain() alleine (das nur INNERHALB der ursprünglichen Kette klettert)
// erkennt das nicht - das würde sonst zu Fehlalarmen für dieses etablierte,
// bewusste Pattern führen (siehe z.B. weingarten/[id]/page.tsx,
// reports/weinbuecher-sammlung/page.tsx).
function variableGetsTenantIdViaReassignment(sourceFile, varName) {
  let found = false
  function walk(node) {
    if (found) return
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isIdentifier(node.left) &&
      node.left.text === varName &&
      chainContainsTenantIdEq(node.right)
    ) {
      found = true
      return
    }
    ts.forEachChild(node, walk)
  }
  walk(sourceFile)
  return found
}

/**
 * Klettert vom .from(...)-Aufruf aus die Methodenkette (.select().eq().order()...)
 * bzw. eine umschließende as-/Klammer-/Wrapper-Struktur nach oben und meldet,
 * was dabei in der GLEICHEN Kette gefunden wurde.
 *
 * Unterscheidet INSERT (braucht tenant_id als Wert im eingefügten Objekt, kein .eq()
 * möglich/nötig) von SELECT/UPDATE/DELETE/UPSERT (brauchen .eq('tenant_id', ...), um
 * nur auf Zeilen des aktiven Mandanten zu wirken).
 */
function analyzeChain(fromCallNode) {
  let current = fromCallNode
  let hasTenantIdEq = false
  let sawLimitOne = false
  let sawSingleFinal = false
  let wrappedBySafeWrapper = false
  let operation = null          // 'insert' | 'update' | 'upsert' | 'delete' | 'select' | null
  let insertPayloadHasTenantId = null // true/false/null (null = nicht statisch bestimmbar)
  let reassignVarName = null    // wird gesetzt, wenn die Kette Initializer von `let/const X = ...` ist

  while (current.parent) {
    const parent = current.parent

    if (ts.isCallExpression(parent)) {
      if (parent.expression === current) {
        // current ist das Ziel dieses Aufrufs, z.B. X in X(...) bzw. X.methode in X.methode(...)
        if (ts.isPropertyAccessExpression(current)) {
          const methodName = current.name.text
          if (methodName === 'eq') {
            const args = parent.arguments
            if (args.length > 0 && ts.isStringLiteralLike(args[0]) && args[0].text === 'tenant_id') {
              hasTenantIdEq = true
            }
          } else if (methodName === 'or') {
            // Für Tabellen mit globalem Katalog + mandanteneigenen Einträgen (tenant_id
            // NULLABLE, NULL = global - z.B. pflanzenschutzmittel, duengemittel, ea_kategorien)
            // ist .or(`tenant_id.eq.${tenantId},tenant_id.is.null`) der korrekte Filter, nicht
            // .eq('tenant_id', ...) (das würde die globalen Einträge fälschlich ausblenden).
            const args = parent.arguments
            if (args.length > 0) {
              const argText = args[0].getText()
              if (/tenant_id\s*\.\s*eq\s*\./.test(argText)) {
                hasTenantIdEq = true
              }
            }
          } else if (methodName === 'limit') {
            const args = parent.arguments
            if (args.length > 0 && ts.isNumericLiteral(args[0]) && args[0].text === '1') {
              sawLimitOne = true
            }
          } else if (methodName === 'single' || methodName === 'maybeSingle') {
            sawSingleFinal = true
          } else if (['insert', 'update', 'upsert', 'delete', 'select'].includes(methodName)) {
            // Nur die ERSTE (innerste, alsо naeheste am .from(...)) Operation zaehlt -
            // das ist die eigentliche DB-Operation dieser Kette.
            if (!operation) {
              operation = methodName
              if (methodName === 'insert' || methodName === 'upsert') {
                const arg0 = parent.arguments[0]
                insertPayloadHasTenantId = objectHasTenantIdKey(arg0)
              }
            }
          }
        }
        current = parent
        continue
      }
      if (parent.arguments.includes(current)) {
        // current ist Argument eines Aufrufs - prüfen ob es ein bekannter Tenant-Filter-Wrapper ist
        let calleeName = null
        if (ts.isIdentifier(parent.expression)) calleeName = parent.expression.text
        else if (ts.isPropertyAccessExpression(parent.expression)) calleeName = parent.expression.name.text
        if (calleeName && KNOWN_SAFE_WRAPPERS.test(calleeName)) {
          wrappedBySafeWrapper = true
        }
        // Kette endet hier (z.B. Promise.all([...]), .map(...) o.ä.) - nicht weiter hochklettern,
        // da ein .eq(...) AUSSERHALB dieses Aufrufs sich nicht mehr auf unsere Abfrage bezieht.
        break
      }
      break
    }

    if (
      (ts.isPropertyAccessExpression(parent) && parent.expression === current) ||
      (ts.isParenthesizedExpression(parent) && parent.expression === current) ||
      (ts.isAsExpression(parent) && parent.expression === current) ||
      (ts.isNonNullExpression(parent) && parent.expression === current)
    ) {
      current = parent
      continue
    }

    if (ts.isArrayLiteralExpression(parent) && parent.elements.includes(current)) {
      current = parent
      continue
    }

    break
  }

  // Kette endet hier (kein weiterer Parent zum Hochklettern mehr) - prüfen, ob sie
  // der Initializer einer `let/const X = ...`-Deklaration ist, damit checkFile()
  // anschließend nach einer späteren `X = X.eq('tenant_id', ...)`-Reassignment suchen kann.
  if (
    current.parent &&
    ts.isVariableDeclaration(current.parent) &&
    current.parent.initializer === current &&
    ts.isIdentifier(current.parent.name)
  ) {
    reassignVarName = current.parent.name.text
  }

  return { hasTenantIdEq, sawLimitOne, sawSingleFinal, wrappedBySafeWrapper, operation, insertPayloadHasTenantId, reassignVarName }
}

function checkFile(filePath) {
  const text = fs.readFileSync(filePath, 'utf8')
  const sourceFile = ts.createSourceFile(filePath, text, ts.ScriptTarget.Latest, /* setParentNodes */ true, ts.ScriptKind.TSX)
  const relPath = path.relative(ROOT, filePath).replace(/\\/g, '/')
  const findings = []

  function visit(node) {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'from' &&
      node.arguments.length > 0 &&
      ts.isStringLiteralLike(node.arguments[0])
    ) {
      const table = node.arguments[0].text
      if (table === 'tenant_memberships' || PROTECTED_TABLES.includes(table)) {
        if (!isSuppressed(text, node)) {
          let { hasTenantIdEq, sawLimitOne, sawSingleFinal, wrappedBySafeWrapper, operation, insertPayloadHasTenantId, reassignVarName } = analyzeChain(node)
          if (!hasTenantIdEq && reassignVarName && variableGetsTenantIdViaReassignment(sourceFile, reassignVarName)) {
            hasTenantIdEq = true
          }
          const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart())

          if (table === 'tenant_memberships') {
            if (sawLimitOne && sawSingleFinal && !hasTenantIdEq) {
              findings.push({
                type: 'ARBITRARY_MEMBERSHIP_LOOKUP',
                line: line + 1,
                message: `.from('tenant_memberships')...limit(1).single()/.maybeSingle() greift eine BELIEBIGE Mitgliedschaft, nicht die aktive. Stattdessen getCurrentMembership() aus '@/lib/auth/roles' verwenden.`,
              })
            }
          } else if ((operation === 'insert' || operation === 'upsert') && !wrappedBySafeWrapper) {
            // INSERT/UPSERT brauchen tenant_id als WERT im eingefügten Objekt, kein .eq() -
            // nur melden, wenn statisch NACHWEISBAR ist, dass tenant_id fehlt (Objekt-/Array-
            // Literal ohne die Property). Bei nicht statisch bestimmbaren Payloads (Variable,
            // Spread) wird NICHT gemeldet, um Fehlalarme zu vermeiden.
            if (insertPayloadHasTenantId === false && !hasTenantIdEq) {
              findings.push({
                type: 'INSERT_MISSING_TENANT_ID',
                line: line + 1,
                message: `.from('${table}').${operation}(...) - das eingefügte Objekt enthält keine 'tenant_id'-Property. Ohne tenant_id im Insert kann die Zeile keinem Mandanten zugeordnet sein.`,
              })
            }
          } else if ((operation === 'update' || operation === 'delete' || operation === 'select' || operation === null) && !hasTenantIdEq && !wrappedBySafeWrapper) {
            findings.push({
              type: 'TENANT_FILTER_MISSING',
              line: line + 1,
              message: `.from('${table}')${operation ? `.${operation}(...)` : ''} ohne erkennbares .eq('tenant_id', ...) (und ohne tf(...)-Wrapper). RLS allein reicht nicht - siehe CLAUDE.md / Migration-Historie.`,
            })
          }
        }
      }
    }
    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return findings.map(f => ({ ...f, file: relPath }))
}

function main() {
  if (!fs.existsSync(SRC_DIR)) {
    console.error(`src/-Ordner nicht gefunden unter ${SRC_DIR}`)
    process.exit(2)
  }
  const files = collectSourceFiles(SRC_DIR)
  let allFindings = []
  for (const file of files) {
    try {
      allFindings = allFindings.concat(checkFile(file))
    } catch (err) {
      console.error(`Fehler beim Parsen von ${file}: ${err.message}`)
      process.exitCode = 2
    }
  }

  if (allFindings.length === 0) {
    console.log(`✓ Tenant-Isolation-Check: ${files.length} Dateien geprüft, keine Funde.`)
    return
  }

  console.error(`\n✗ Tenant-Isolation-Check: ${allFindings.length} Fund(e) in ${files.length} geprüften Dateien:\n`)
  for (const f of allFindings) {
    console.error(`  ${f.file}:${f.line}  [${f.type}]`)
    console.error(`    ${f.message}`)
  }
  console.error(`\nFalls eine Meldung ein bewusster, begründeter Sonderfall ist: Kommentar`)
  console.error(`"// tenant-isolation-ignore: <Grund>" direkt über der betroffenen Zeile ergänzen.\n`)
  process.exit(1)
}

main()
