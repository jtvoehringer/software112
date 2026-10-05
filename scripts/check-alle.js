#!/usr/bin/env node
/**
 * check-alle.js – Wächter gegen still gekappte Vollabfragen (05.10.2026)
 *
 * PostgREST (Supabase) liefert je Anfrage höchstens 1.000 Zeilen – ohne Fehler. Der Datenimport lud alle Firmen eines
 * Betriebs mit einer Abfrage; bei Gebeshuber (4.652 Firmen) blieben 4.164 Kontakte ohne Firma (PR #232). Vollständig
 * gebrauchte Mengen (Index/Map/Set, Summen, Abgleich, Export) holt die App deshalb über alle() aus
 * src/lib/supabase/alle.ts (seitenweise, mit .order() auf einer eindeutigen Spalte).
 *
 * Das Skript meldet (Regel VOLLABFRAGE) jede lesende Abfrage `.from('<große Tabelle>').select(…)` unter src/, die
 *  - weder in alle(…) steckt (direkt, über tf(…), über eine Variable `const q = …; await alle(q)` oder über eine
 *    Hilfsfunktion derselben Datei, die ihren Parameter an alle() gibt),
 *  - noch .range(…), .limit(…), .single(), .maybeSingle() oder `head: true` verwendet,
 *  - noch auf einen Datensatz bzw. eine Elternzeile eingeschränkt ist (.eq/.in/.match auf `id` oder `<x>_id` außer
 *    tenant_id) oder eine Suche ist (.ilike/.like/.textSearch bzw. .or(…ilike…)).
 * Datums-, Status- und Ja/Nein-Filter schränken nicht ein (ein Jahr E/A-Buchungen kann über 1.000 Zeilen haben).
 * Regel ALLE_OHNE_ORDER: alle(.from(…)…) ohne .order() – ohne stabile Reihenfolge kann Postgres zwischen den Blöcken
 * Zeilen doppelt liefern bzw. auslassen.
 * Grenze: .in('<x>_id', liste) gilt als eingeschränkt, auch wenn die Liste selbst lang ist.
 * Große Tabellen = GROSSE_TABELLEN (wachsen je Betrieb ohne Obergrenze; Stand Produktion 05.10.2026: kontakte 8.290,
 * wetter_stunden 6.396, firmen 4.652, behandlung_grundstuecke 1.520 je Betrieb).
 *
 * Ausnahme je Stelle: „// alle-ausnahme: <Grund>“ in derselben Zeile wie das .from( oder allein in der Zeile davor,
 * Grund mind. 15 Zeichen (z. B. „höchstens 12 Monatszeilen je Jahr“).
 *
 * Aufruf: node scripts/check-alle.js [--liste]   (Exit 1 bei Funden; --liste zeigt alle Ausnahmen)
 * Für Tests: require('./check-alle.js') → { pruefeText, pruefeWurzel, abfragen, GROSSE_TABELLEN } ohne Seiteneffekte;
 * S112_GUARD_ROOT prüft ein anderes Projektverzeichnis.
 */
const fs = require('fs')
const path = require('path')
const ts = require('typescript')

const WURZEL = process.env.S112_GUARD_ROOT || path.join(__dirname, '..')
const MIN_GRUND = 15
const AUSNAHME = /alle-ausnahme\s*:\s*(.*)$/i

/** Tabellen, die je Betrieb ohne Obergrenze wachsen (Stammdaten-Massenimporte, Bewegungen, Protokolle). */
const GROSSE_TABELLEN = [
  'kontakte', 'firmen', 'aktivitaeten', 'aktivitaet_dokumente', 'pipeline_eintraege', 'datenschutz_consents',
  'grundstuecke', 'behandlungen', 'behandlung_grundstuecke', 'wetter_stunden', 'zeiterfassung',
  'verkaufsposten', 'verkauf_positionen', 'zahlungen', 'sumup_transaktionen',
  'ea_transaktionen', 'ea_belege', 'konto_umbuchungen', 'fibu_buchungssaetze',
  'kosteneintraege', 'kosteneintrag_weingaerten',
  'psm_lager_bewegungen', 'duengemittel_lager_bewegungen', 'betriebsmittel_lager_bewegungen',
  'kellerbuch_buchungen', 'bestandsprotokoll', 'benachrichtigungen', 'system_ereignisse', 'assistent_nachrichten',
]

const IGNORE_DIRS = new Set(['node_modules', '.next', '.git', '_to_delete'])
const BEGRENZT = new Set(['range', 'limit', 'single', 'maybeSingle', 'csv', 'explain'])
const SUCHE = new Set(['ilike', 'like', 'textSearch', 'likeAnyOf', 'ilikeAnyOf'])
const FILTER = new Set(['eq', 'in', 'match', 'contains', 'containedBy'])
/** Wrapper, die eine Abfrage nur um den Mandantenfilter ergänzen und sie zurückgeben */
const WRAPPER = /^(tf|mitTenant)$/

function istEinschraenkendeSpalte(spalte) {
  return spalte !== 'tenant_id' && (spalte === 'id' || /_id$/.test(spalte))
}

function dateien(dir, out = []) {
  if (!fs.existsSync(dir)) return out
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (IGNORE_DIRS.has(e.name)) continue
    const voll = path.join(dir, e.name)
    if (e.isDirectory()) dateien(voll, out)
    else if (/\.(ts|tsx)$/.test(e.name) && !e.name.endsWith('.d.ts')) out.push(voll)
  }
  return out
}

/** Ausnahme mit Grund in der Zeile oder allein in der Zeile davor; liefert Grund, '' (zu kurz) oder null */
function ausnahmeGrund(zeilen, idx) {
  const davor = idx > 0 && /^\s*\/\//.test(zeilen[idx - 1]) ? zeilen[idx - 1] : ''
  for (const z of [zeilen[idx], davor]) {
    const m = AUSNAHME.exec(z || '')
    if (m) return m[1].trim().length >= MIN_GRUND ? m[1].trim() : ''
  }
  return null
}

function istAlleAufruf(call) {
  const e = call.expression
  return (ts.isIdentifier(e) && e.text === 'alle') || (ts.isPropertyAccessExpression(e) && e.name.text === 'alle')
}

/** Spaltenname aus dem ersten Argument eines Filters ('id', "kontakt_id", `x`) bzw. die Schlüssel eines .match({…}) */
function filterSpalten(methode, args) {
  if (!args.length) return []
  const a = args[0]
  if (methode === 'match' && ts.isObjectLiteralExpression(a)) {
    return a.properties.map(p => (p.name && (ts.isIdentifier(p.name) || ts.isStringLiteralLike(p.name)) ? p.name.text : '')).filter(Boolean)
  }
  return ts.isStringLiteralLike(a) ? [a.text] : []
}

/**
 * Klettert von einem Knoten (dem .from(...)-Aufruf oder einer Abfrage-Variable) die Kette hoch und sammelt, was sie
 * begrenzt. Ergebnis: { operation, begrenzt, eingeschraenkt, inAlle, variable, aufruf }
 *  - variable: die Kette ist Initialisierer/rechte Seite von `x = …` (Abfrage wird später weitergebaut)
 *  - aufruf:   die Kette geht als Argument an eine Funktion (Name, Position) – z. B. liste(q, 'tabelle')
 */
function klettere(start) {
  let cur = start
  let operation = null, begrenzt = false, eingeschraenkt = false, inAlle = false, sortiert = false, variable = null, aufruf = null
  for (;;) {
    const p = cur.parent
    if (!p) break
    if (ts.isCallExpression(p) && p.expression === cur) {
      if (ts.isPropertyAccessExpression(cur)) {
        const m = cur.name.text
        if (!operation && ['select', 'insert', 'update', 'upsert', 'delete'].includes(m)) {
          operation = m
          if (m === 'select' && p.arguments[1] && /head\s*:\s*true/.test(p.arguments[1].getText())) begrenzt = true
        } else if (m === 'order') sortiert = true
        else if (BEGRENZT.has(m)) begrenzt = true
        else if (SUCHE.has(m)) eingeschraenkt = true
        else if (FILTER.has(m) && filterSpalten(m, p.arguments).some(istEinschraenkendeSpalte)) eingeschraenkt = true
        else if (m === 'or' && p.arguments[0] &&
          /i?like\.|(^|[,(`'"])(id|[a-z_]+_id)\.(eq|in)\./.test(p.arguments[0].getText().replace(/tenant_id\.[a-z]+\./g, ''))) eingeschraenkt = true
      }
      cur = p
      continue
    }
    if (ts.isCallExpression(p) && p.arguments.includes(cur)) {
      if (istAlleAufruf(p)) { inAlle = true; break }
      // Mandanten-Wrapper tf(q) (hängt nur .eq('tenant_id', …) an): weiter nach außen, z. B. alle(tf(q))
      if (ts.isIdentifier(p.expression) && WRAPPER.test(p.expression.text) && p.arguments[0] === cur) { cur = p; continue }
      if (ts.isIdentifier(p.expression)) aufruf = { name: p.expression.text, index: p.arguments.indexOf(cur) }
      break
    }
    if ((ts.isPropertyAccessExpression(p) || ts.isParenthesizedExpression(p) || ts.isAsExpression(p) ||
      ts.isNonNullExpression(p) || ts.isAwaitExpression(p) || ts.isTypeAssertionExpression?.(p) || ts.isSatisfiesExpression?.(p)) && p.expression === cur) {
      cur = p
      continue
    }
    if (ts.isVariableDeclaration(p) && p.initializer === cur && ts.isIdentifier(p.name)) variable = p.name.text
    else if (ts.isBinaryExpression(p) && p.right === cur && p.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isIdentifier(p.left)) variable = p.left.text
    break
  }
  return { operation, begrenzt, eingeschraenkt, inAlle, sortiert, variable, aufruf }
}

/** Gibt die Funktion `name` (Deklaration oder const-Pfeilfunktion derselben Datei) ihren Parameter `index` an alle()? */
function hilfsfunktionMitAlle(sf, name, index) {
  let treffer = false
  function besuche(n) {
    if (treffer) return
    let fn = null
    if (ts.isFunctionDeclaration(n) && n.name?.text === name) fn = n
    else if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === name && n.initializer &&
      (ts.isArrowFunction(n.initializer) || ts.isFunctionExpression(n.initializer))) fn = n.initializer
    if (fn && fn.body && fn.parameters[index] && ts.isIdentifier(fn.parameters[index].name)) {
      const param = fn.parameters[index].name.text
      if (new RegExp(`\\balle\\s*(<[^>]*>)?\\(\\s*\\(?\\s*${param}\\b`).test(fn.body.getText())) treffer = true
    }
    ts.forEachChild(n, besuche)
  }
  besuche(sf)
  return treffer
}

/**
 * Abfrage in einer Variable (`let q = supabase.from(…)…; q = q.eq(…); await q.order('id').range(0, n)`): alle Ketten
 * derselben Datei, die bei dieser Variable beginnen, zählen mit (Begrenzung, Einschränkung, alle()).
 */
function variableBegrenzt(sf, variable, besucht = new Set()) {
  if (besucht.has(variable)) return false
  besucht.add(variable)
  let ok = false
  function besuche(n) {
    if (ok) return
    if (ts.isIdentifier(n) && n.text === variable && n.parent &&
      !(ts.isVariableDeclaration(n.parent) && n.parent.name === n) &&
      !(ts.isBinaryExpression(n.parent) && n.parent.left === n) &&
      !(ts.isPropertyAccessExpression(n.parent) && n.parent.name === n)) {
      const r = klettere(n)
      if (r.begrenzt || r.eingeschraenkt || r.inAlle) ok = true
      else if (r.aufruf && hilfsfunktionMitAlle(sf, r.aufruf.name, r.aufruf.index)) ok = true
      else if (r.variable && r.variable !== variable && variableBegrenzt(sf, r.variable, besucht)) ok = true
    }
    ts.forEachChild(n, besuche)
  }
  besuche(sf)
  return ok
}

/**
 * Alle lesenden Abfragen auf großen Tabellen eines Dateitexts mit ihrer Bewertung:
 * { tabelle, zeile, gepaged (alle() direkt, über Variable oder Hilfsfunktion), begrenzt, eingeschraenkt, sortiert }
 */
function abfragen(text, datei = '') {
  const sf = ts.createSourceFile(datei || 'x.tsx', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const out = []
  function besuche(node) {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'from' &&
      node.arguments.length > 0 && ts.isStringLiteralLike(node.arguments[0]) && GROSSE_TABELLEN.includes(node.arguments[0].text)) {
      const a = klettere(node)
      if (a.operation === 'select') {
        const gepaged = a.inAlle || !!(a.aufruf && hilfsfunktionMitAlle(sf, a.aufruf.name, a.aufruf.index)) ||
          !!(a.variable && variableBegrenzt(sf, a.variable))
        out.push({
          tabelle: node.arguments[0].text, zeile: sf.getLineAndCharacterOfPosition(node.getStart()).line + 1,
          gepaged, direktInAlle: a.inAlle, begrenzt: a.begrenzt, eingeschraenkt: a.eingeschraenkt, sortiert: a.sortiert,
        })
      }
    }
    ts.forEachChild(node, besuche)
  }
  besuche(sf)
  return out
}

/** Prüft einen Dateitext; liefert { funde, ausnahmen } */
function pruefeText(text, datei = '') {
  const zeilen = text.split(/\r?\n/)
  const funde = [], ausnahmen = []
  for (const q of abfragen(text, datei)) {
    let regel = null
    if (q.direktInAlle && !q.sortiert) regel = 'ALLE_OHNE_ORDER'
    else if (!q.gepaged && !q.begrenzt && !q.eingeschraenkt) regel = 'VOLLABFRAGE'
    if (!regel) continue
    const grund = ausnahmeGrund(zeilen, q.zeile - 1)
    if (grund) { ausnahmen.push({ datei, zeile: q.zeile, tabelle: q.tabelle, regel, grund }); continue }
    funde.push({
      datei, zeile: q.zeile, tabelle: q.tabelle, regel,
      text: grund === ''
        ? `alle-ausnahme ohne ausreichenden Grund (mind. ${MIN_GRUND} Zeichen)`
        : regel === 'ALLE_OHNE_ORDER'
          ? `alle(.from('${q.tabelle}')…) ohne .order() – die Blöcke brauchen eine stabile Reihenfolge (eindeutige Spalte, z. B. .order('id'))`
          : `.from('${q.tabelle}').select(…) ohne alle(), .range() oder .limit() – PostgREST kappt still bei 1.000 Zeilen`,
    })
  }
  return { funde, ausnahmen }
}

function pruefeWurzel(wurzel = WURZEL) {
  const funde = [], ausnahmen = []
  for (const d of dateien(path.join(wurzel, 'src'))) {
    const r = pruefeText(fs.readFileSync(d, 'utf8'), path.relative(wurzel, d).split(path.sep).join('/'))
    funde.push(...r.funde)
    ausnahmen.push(...r.ausnahmen)
  }
  return { funde, ausnahmen }
}

module.exports = { pruefeText, pruefeWurzel, abfragen, GROSSE_TABELLEN, MIN_GRUND }

if (require.main === module) {
  const { funde, ausnahmen } = pruefeWurzel()
  if (process.argv.includes('--liste')) {
    console.log(`Ausnahmen (${ausnahmen.length}):`)
    for (const a of ausnahmen) console.log(`  ${a.datei}:${a.zeile}  [${a.tabelle}, ${a.regel}]  ${a.grund}`)
  }
  if (funde.length === 0) {
    console.log(`✓ alle()-Check: keine ungepagte Vollabfrage auf großen Tabellen (${ausnahmen.length} begründete Ausnahmen).`)
  } else {
    console.error(`\n✗ alle()-Check: ${funde.length} Fund(e):\n`)
    for (const f of funde) console.error(`  ${f.datei}:${f.zeile}  [${f.tabelle}, ${f.regel}]  ${f.text}`)
    console.error(`\nVollständig gebrauchte Mengen über alle() aus '@/lib/supabase/alle' holen (mit .order() auf eindeutiger Spalte).`)
    console.error(`Bewusst begrenzt? Kommentar "// alle-ausnahme: <Grund>" (mind. ${MIN_GRUND} Zeichen) in oder über der .from(-Zeile.\n`)
    process.exit(1)
  }
}
