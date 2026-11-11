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
 * Regel IN_OHNE_BLOECKE (seit 05.10.2026): .in()-Listen mit Werten aus großen Tabellen ohne Blöcke – siehe unten.
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
  'grundstuecke', 'behandlungen', 'behandlung_grundstuecke', 'psm_uebermittlungen',   // KAN-120: psm_uebermittlungen
  'wetter_stunden', 'zeiterfassung',
  'verkaufsposten', 'verkauf_positionen', 'zahlungen', 'sumup_transaktionen', 'rechnungen',   // KAN-102: rechnungen
  'ea_transaktionen', 'ea_belege', 'konto_umbuchungen', 'fibu_buchungssaetze',
  'kosteneintraege', 'kosteneintrag_weingaerten',
  'psm_lager_bewegungen', 'duengemittel_lager_bewegungen', 'betriebsmittel_lager_bewegungen',
  'kellerbuch_buchungen', 'bestandsprotokoll', 'benachrichtigungen', 'system_ereignisse', 'assistent_nachrichten',
  // Keller und Lese (05.10.2026): wachsen mit jedem Jahrgang – Chargen, Füllungen, Zukäufe, Pressungen, Anträge …
  // (lesen bewusst nicht: wenige je Jahrgang)
  'weinausbau', 'weinausbau_weingaerten', 'behaelter', 'fuellungen', 'fuellung_chargen', 'fuellung_bewegungen',
  'zukauf_posten', 'traubenverkauf', 'keller_umzuege', 'keller_behandlungen', 'weinanalysen', 'verschneidungen',
  'verschneidung_quellen', 'pressungen', 'pressung_behaelter', 'pressung_weingaerten', 'ernte_parzellen',
  'dac_antrag', 'pruefnummer_chargen', 'elabels',   // KAN-216: je Füllung
  'keller_verarbeitungen',   // KAN-41 Paket 3a
  'keller_zugangskorrekturen',   // KAN-53
  'kellermittel_buchungen',      // KAN-107: Stoffkonto
  'reifemessungen',              // KAN-203: Reife-Messungen je Ried
  'lieferadressen',              // KAN-176: Lieferadressen je Kontakt/Firma
  'ernte_gst_abgeschlossen',     // KAN-392: abgeschlossene Ernte je Grundstück und Jahrgang
  'verkauf_ki_begriffe',         // KAN-411: gelernte Begriffe aus Bestell-Mails je Kunde
  'sonstige_artikel_bewegungen', // KAN-115: Lager Sonstiger Produkte
  'fuellung_etikettierungen',   // KAN-41 Paket 3d
]

const IGNORE_DIRS = new Set(['node_modules', '.next', '.git', '_to_delete'])
const BEGRENZT = new Set(['range', 'limit', 'single', 'maybeSingle', 'csv', 'explain'])
const SUCHE = new Set(['ilike', 'like', 'textSearch', 'likeAnyOf', 'ilikeAnyOf'])
const FILTER = new Set(['eq', 'in', 'match', 'contains', 'containedBy'])
/**
 * Wrapper, die eine Abfrage nur um Filter ergänzen und sie zurückgeben: Mandantenfilter (tf, mitTenant) und seit KAN-358
 * die Belegung eines Gebindes (nurBelegendeChargen, src/lib/kellerbuch/leereGebinde.ts)
 */
const WRAPPER = /^(tf|mitTenant|nurBelegendeChargen)$/

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
  // die Zeile selbst und der unmittelbar darüberstehende Kommentarblock (höchstens 3 Zeilen, z. B. über einem
  // eslint-disable-next-line, das direkt über dem Code stehen muss)
  const davor = []
  for (let i = idx - 1; i >= 0 && i >= idx - 3 && /^\s*\/\//.test(zeilen[i]); i--) davor.push(zeilen[i])
  for (const z of [zeilen[idx], ...davor]) {
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
// Sweep 102 (10.10.2026): nach einer Datums-/Zeitspalte AUFSTEIGEND sortiert und dann begrenzt → behält die ältesten Zeilen.
// Befund: CRM-Kalender (.order('datum', { ascending: true }).limit(5000)) – über der Grenze fehlten die kommenden Termine.
// Gewollt bei „die nächsten N ab heute“ (Filter .gte('datum', heute)) – solche Stellen mit // alle-ausnahme: <Grund>.
const DATUM_SPALTE = /^(datum|[a-z_]*_datum|datum_[a-z_]+|[a-z_]*_am|created_at|updated_at|zeit|zeitpunkt|[a-z_]*_zeit)$/

function klettere(start) {
  let cur = start
  let operation = null, begrenzt = false, eingeschraenkt = false, inAlle = false, sortiert = false, variable = null, aufruf = null
  let ersteOrder = null, limit = false   // Sweep 102: erste Sortierung { spalte, aufsteigend } und .limit(n)
  const untergrenzen = new Set()         // Sweep 102: .gte/.gt(spalte, …) – „die nächsten N ab …“ ist gewollt
  for (;;) {
    const p = cur.parent
    if (!p) break
    if (ts.isCallExpression(p) && p.expression === cur) {
      if (ts.isPropertyAccessExpression(cur)) {
        const m = cur.name.text
        if (!operation && ['select', 'insert', 'update', 'upsert', 'delete'].includes(m)) {
          operation = m
          if (m === 'select' && p.arguments[1] && /head\s*:\s*true/.test(p.arguments[1].getText())) begrenzt = true
        } else if (m === 'order') {
          sortiert = true
          if (!ersteOrder && p.arguments[0] && ts.isStringLiteralLike(p.arguments[0]))
            ersteOrder = { spalte: p.arguments[0].text, aufsteigend: !(p.arguments[1] && /ascending\s*:\s*false/.test(p.arguments[1].getText())) }
        }
        else if (m === 'limit') { limit = true; begrenzt = true }
        if ((m === 'gte' || m === 'gt') && p.arguments[0] && ts.isStringLiteralLike(p.arguments[0])) untergrenzen.add(p.arguments[0].text)
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
      // Sweep 93: ebenso ctx.tf(q) (Dashboard, Morgenbericht, Finanzübersicht)
      if (ts.isPropertyAccessExpression(p.expression) && WRAPPER.test(p.expression.name.text) && p.arguments[0] === cur) { cur = p; continue }
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
    // Fabrik `const q = () => supabase.from(…)…` – geprüft werden die Aufrufstellen q()
    else if (ts.isArrowFunction(p) && p.body === cur && p.parameters.length === 0 && p.parent &&
      ts.isVariableDeclaration(p.parent) && ts.isIdentifier(p.parent.name)) aufruf = { fabrik: p.parent.name.text }
    break
  }
  return { operation, begrenzt, eingeschraenkt, inAlle, sortiert, variable, aufruf, ersteOrder: ersteOrder && untergrenzen.has(ersteOrder.spalte) ? null : ersteOrder, limit }
}

/** Fabrik ohne Parameter: jede Aufrufstelle name() muss gepaged, begrenzt oder eingeschränkt sein (mindestens eine) */
function fabrikBegrenzt(sf, name) {
  let anzahl = 0, alleOk = true
  function besuche(n) {
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === name && n.arguments.length === 0) {
      anzahl++
      const r = klettere(n)
      const ok = r.begrenzt || r.eingeschraenkt || r.inAlle ||
        !!(r.aufruf?.name && hilfsfunktionMitAlle(sf, r.aufruf.name, r.aufruf.index)) ||
        !!(r.variable && variableBegrenzt(sf, r.variable))
      if (!ok) alleOk = false
    }
    ts.forEachChild(n, besuche)
  }
  besuche(sf)
  return anzahl > 0 && alleOk
}

/** Abfrage endet in einem Aufruf (Hilfsfunktion mit alle()) bzw. ist der Rumpf einer Fabrik */
function aufrufBegrenzt(sf, aufruf) {
  if (!aufruf) return false
  if (aufruf.fabrik) return fabrikBegrenzt(sf, aufruf.fabrik)
  return hilfsfunktionMitAlle(sf, aufruf.name, aufruf.index)
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
      else if (aufrufBegrenzt(sf, r.aufruf)) ok = true
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
    // Sweep 93 (KAN-288): auch die Helfer q('…') und ctx.q('…') (Dashboard, Morgenbericht) – sie liefen am Wächter vorbei
    const tabellenAufruf = ts.isCallExpression(node) && (
      (ts.isPropertyAccessExpression(node.expression) && (node.expression.name.text === 'from' || node.expression.name.text === 'q')) ||
      (ts.isIdentifier(node.expression) && node.expression.text === 'q'))
    if (tabellenAufruf && node.arguments.length > 0 && ts.isStringLiteralLike(node.arguments[0]) && GROSSE_TABELLEN.includes(node.arguments[0].text)) {
      const a = klettere(node)
      if (a.operation === 'select') {
        const gepaged = a.inAlle || aufrufBegrenzt(sf, a.aufruf) ||
          !!(a.variable && variableBegrenzt(sf, a.variable))
        out.push({
          tabelle: node.arguments[0].text, zeile: sf.getLineAndCharacterOfPosition(node.getStart()).line + 1,
          gepaged, direktInAlle: a.inAlle, begrenzt: a.begrenzt, eingeschraenkt: a.eingeschraenkt, sortiert: a.sortiert,
          aeltesteBehalten: !a.inAlle && a.limit && !!a.ersteOrder && a.ersteOrder.aufsteigend && DATUM_SPALTE.test(a.ersteOrder.spalte),
          ordnung: a.ersteOrder?.spalte,
        })
      }
    }
    ts.forEachChild(node, besuche)
  }
  besuche(sf)
  return out
}

/** Prüft einen Dateitext; liefert { funde, ausnahmen } */
// ── Regel IN_OHNE_BLOECKE (05.10.2026) ─────────────────────────────────────────────────────────────────────────────
// .in('spalte', liste) steht in der URL – ab ≈ 350 UUIDs scheitert die Anfrage (gemessen gegen Staging), supabase-js
// liefert nur einen Fehler, den viele Aufrufer verwerfen. Gemeldet wird gezielt: eine .in()-Liste, deren Werte (über
// höchstens IN_TIEFE Zuweisungen in derselben Datei) aus einer Abfrage auf einer großen Tabelle stammen und die nicht
// in Blöcken läuft (inBloecken/zaehleInBloecken-Rückruf, Schleife über bloecke(…), .slice(i, i + ≤ 100)).
// Listen aus Auswahlen, Parametern oder Hilfsfunktionen bleiben unbehelligt (Heuristik, kein Datenflussbeweis).

const IN_TIEFE = 6
const BLOCK_FUNKTIONEN = new Set(['inBloecken', 'zaehleInBloecken'])

/** Ist der Ausdruck `arg` eines .in(…) bereits geblockt? */
function inGeblockt(arg) {
  // x.slice(i, i + N) mit N ≤ 100
  if (ts.isCallExpression(arg) && ts.isPropertyAccessExpression(arg.expression) && arg.expression.name.text === 'slice' &&
    arg.arguments[1] && /\+\s*(\d+)\s*$/.test(arg.arguments[1].getText()) && Number(/(\d+)\s*$/.exec(arg.arguments[1].getText())[1]) <= 100) return true
  if (!ts.isIdentifier(arg)) return false
  for (let p = arg.parent; p; p = p.parent) {
    // inBloecken(liste, b => … .in('x', b) …)
    if ((ts.isArrowFunction(p) || ts.isFunctionExpression(p)) && p.parameters.some(pa => ts.isIdentifier(pa.name) && pa.name.text === arg.text) &&
      p.parent && ts.isCallExpression(p.parent) && ts.isIdentifier(p.parent.expression) && (BLOCK_FUNKTIONEN.has(p.parent.expression.text) || /InBloecken$/.test(p.parent.expression.text))) return true
    // for (const block of bloecke(…)) … .in('x', block)
    if (ts.isForOfStatement(p) && ts.isCallExpression(p.expression) && ts.isIdentifier(p.expression.expression) &&
      /^(bloecke|inBloecken)$/.test(p.expression.expression.text) && new RegExp(`\\b${arg.text}\\b`).test(p.initializer.getText())) return true
  }
  return false
}

/** Deklaration des Namens `name`, die vor `pos` steht und `pos` umschließt (nächste zuerst): liefert den Quell-Ausdruck */
function quelleVon(sf, name, pos) {
  let best = null
  function besuche(n) {
    if (n.getStart() > pos) return
    if (ts.isVariableDeclaration(n) && n.initializer && n.getEnd() <= pos) {
      const q = bindungsQuelle(n.name, n.initializer, name)
      if (q && (!best || n.getStart() > best.start)) {
        // nur Deklarationen, deren Gültigkeitsbereich pos umschließt
        let block = n.parent
        while (block && !ts.isBlock(block) && !ts.isSourceFile(block) && !ts.isFunctionLike(block)) block = block.parent
        if (!block || (block.getStart() <= pos && block.getEnd() >= pos)) best = { start: n.getStart(), ausdruck: q }
      }
    }
    ts.forEachChild(n, besuche)
  }
  besuche(sf)
  return best?.ausdruck ?? null
}

/** Welcher Teil des Initialisierers liefert `name`? (const x = …, const { data: x } = …, const [{ data: a }, { data: b }] = await Promise.all([…])) */
function bindungsQuelle(bindung, init, name) {
  if (ts.isIdentifier(bindung)) return bindung.text === name ? init : null
  if (ts.isObjectBindingPattern(bindung)) {
    for (const el of bindung.elements) if (bindungsQuelle(el.name, init, name)) return init
    return null
  }
  if (ts.isArrayBindingPattern(bindung)) {
    let arr = init
    while (arr && (ts.isAwaitExpression(arr) || ts.isParenthesizedExpression(arr) || ts.isAsExpression(arr))) arr = arr.expression
    if (arr && ts.isCallExpression(arr) && /Promise\.all$/.test(arr.expression.getText()) && arr.arguments[0] && ts.isArrayLiteralExpression(arr.arguments[0])) {
      const el = arr.arguments[0].elements
      for (let i = 0; i < bindung.elements.length; i++) {
        const b = bindung.elements[i]
        if (ts.isBindingElement(b) && bindungsQuelle(b.name, el[i] ?? init, name)) return el[i] ?? init
      }
      return null
    }
    for (const b of bindung.elements) if (ts.isBindingElement(b) && bindungsQuelle(b.name, init, name)) return init
  }
  return null
}

/** Große Tabelle, aus der die Werte des Ausdrucks stammen (oder null) */
function grosseQuelle(sf, ausdruck, tiefe = IN_TIEFE, gesehen = new Set()) {
  if (!ausdruck || tiefe < 0) return null
  const t = ausdruck.getText()
  const m = [...t.matchAll(/\.from\(\s*['"`]([a-z_]+)['"`]\s*\)/g)].map(x => x[1]).find(x => GROSSE_TABELLEN.includes(x))
  // Quelle mit .limit(n ≤ 300) bzw. Einzelsatz ist klein (z. B. Top-50-Kontakte im Controlling)
  if (m) return /\.limit\(\s*([0-9]{1,3})\s*\)/.test(t) && Number(/\.limit\(\s*([0-9]{1,3})\s*\)/.exec(t)[1]) <= 300 || /\.(single|maybeSingle)\(\)/.test(t) ? null : m
  // Bezeichner im Ausdruck (ohne Eigenschaftsnamen und Parameter von Pfeilfunktionen im Ausdruck)
  const namen = new Set(), parameter = new Set()
  const sammle = n => {
    if ((ts.isArrowFunction(n) || ts.isFunctionExpression(n))) for (const p of n.parameters) if (ts.isIdentifier(p.name)) parameter.add(p.name.text)
    if (ts.isIdentifier(n) && !(n.parent && ts.isPropertyAccessExpression(n.parent) && n.parent.name === n) &&
      !(n.parent && ts.isPropertyAssignment(n.parent) && n.parent.name === n)) namen.add(n.text)
    ts.forEachChild(n, sammle)
  }
  sammle(ausdruck)
  for (const name of namen) {
    if (parameter.has(name) || gesehen.has(name)) continue
    gesehen.add(name)
    const q = quelleVon(sf, name, ausdruck.getStart())
    const r = q && grosseQuelle(sf, q, tiefe - 1, gesehen)
    if (r) return r
  }
  return null
}

/** Alle .in()-Aufrufe mit Liste aus Code: { zeile, spalte, quelle (große Tabelle oder null), geblockt } */
function inListen(text, datei = '') {
  const sf = ts.createSourceFile(datei || 'x.tsx', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const out = []
  function besuche(n) {
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === 'in' &&
      n.arguments.length === 2 && ts.isStringLiteralLike(n.arguments[0]) && !ts.isArrayLiteralExpression(n.arguments[1]) &&
      /\.from\(|\.select\(|\.eq\(|\.update\(|\.delete\(/.test(n.expression.expression.getText())) {
      const arg = n.arguments[1]
      const geblockt = inGeblockt(arg)
      out.push({
        zeile: sf.getLineAndCharacterOfPosition(n.getStart()).line + 1, spalte: n.arguments[0].text,
        geblockt, quelle: geblockt ? null : grosseQuelle(sf, arg),
      })
    }
    ts.forEachChild(n, besuche)
  }
  besuche(sf)
  return out
}

function pruefeText(text, datei = '') {
  const zeilen = text.split(/\r?\n/)
  const funde = [], ausnahmen = []
  for (const l of inListen(text, datei)) {
    if (l.geblockt || !l.quelle) continue
    const grund = ausnahmeGrund(zeilen, l.zeile - 1)
    const regel = 'IN_OHNE_BLOECKE'
    if (grund) { ausnahmen.push({ datei, zeile: l.zeile, tabelle: l.quelle, regel, grund }); continue }
    funde.push({
      datei, zeile: l.zeile, tabelle: l.quelle, regel,
      text: grund === ''
        ? `alle-ausnahme ohne ausreichenden Grund (mind. ${MIN_GRUND} Zeichen)`
        : `.in('${l.spalte}', …) mit Werten aus '${l.quelle}' ohne Blöcke – ab ≈ 350 IDs scheitert die URL; inBloecken(liste, b => … .in('${l.spalte}', b) …) verwenden`,
    })
  }
  // Sweep 102: auth.admin.listUsers liefert je Aufruf eine Seite (höchstens perPage Konten) – ohne page/Blättern fehlen
  // Konten still (Benutzerverwaltung: perPage 1000). Richtig: alleKonten() bzw. findeKontoPerEmail() aus lib/auth/einladung.
  { const re = /\.listUsers\(([^)]*)\)/g; let m
    while ((m = re.exec(text))) {
      if (/\bpage\s*:/.test(m[1])) continue
      const zeile = text.slice(0, m.index).split('\n').length
      const grund = ausnahmeGrund(zeilen, zeile - 1)
      if (grund) { ausnahmen.push({ datei, zeile, tabelle: 'auth.users', regel: 'LISTUSERS_OHNE_SEITE', grund }); continue }
      funde.push({ datei, zeile, tabelle: 'auth.users', regel: 'LISTUSERS_OHNE_SEITE',
        text: grund === '' ? `alle-ausnahme ohne ausreichenden Grund (mind. ${MIN_GRUND} Zeichen)` : 'auth.admin.listUsers() ohne page – liefert nur die erste Seite; alleKonten() aus src/lib/auth/einladung.ts verwenden' })
    } }
  for (const q of abfragen(text, datei)) {
    let regel = null
    if (q.direktInAlle && !q.sortiert) regel = 'ALLE_OHNE_ORDER'
    else if (q.aeltesteBehalten) regel = 'AELTESTE_BEHALTEN'
    else if (!q.gepaged && !q.begrenzt && !q.eingeschraenkt) regel = 'VOLLABFRAGE'
    if (!regel) continue
    const grund = ausnahmeGrund(zeilen, q.zeile - 1)
    if (grund) { ausnahmen.push({ datei, zeile: q.zeile, tabelle: q.tabelle, regel, grund }); continue }
    funde.push({
      datei, zeile: q.zeile, tabelle: q.tabelle, regel,
      text: grund === ''
        ? `alle-ausnahme ohne ausreichenden Grund (mind. ${MIN_GRUND} Zeichen)`
        : regel === 'AELTESTE_BEHALTEN'
          ? `.order('${q.ordnung}') aufsteigend mit .limit() behält die ältesten Zeilen – neue fehlen still (alle() verwenden bzw. absteigend sortieren)`
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

module.exports = { pruefeText, pruefeWurzel, abfragen, inListen, GROSSE_TABELLEN, MIN_GRUND }

if (require.main === module) {
  const { funde, ausnahmen } = pruefeWurzel()
  if (process.argv.includes('--liste')) {
    console.log(`Ausnahmen (${ausnahmen.length}):`)
    for (const a of ausnahmen) console.log(`  ${a.datei}:${a.zeile}  [${a.tabelle}, ${a.regel}]  ${a.grund}`)
  }
  if (funde.length === 0) {
    console.log(`✓ alle()-Check: keine ungepagte Vollabfrage und keine ungeblockte .in()-Liste aus großen Tabellen (${ausnahmen.length} begründete Ausnahmen).`)
  } else {
    console.error(`\n✗ alle()-Check: ${funde.length} Fund(e):\n`)
    for (const f of funde) console.error(`  ${f.datei}:${f.zeile}  [${f.tabelle}, ${f.regel}]  ${f.text}`)
    console.error(`\nVollständig gebrauchte Mengen über alle() aus '@/lib/supabase/alle' holen (mit .order() auf eindeutiger Spalte),`)
    console.error(`lange .in()-Listen über inBloecken()/bloecke() aus derselben Datei.`)
    console.error(`Bewusst begrenzt? Kommentar "// alle-ausnahme: <Grund>" (mind. ${MIN_GRUND} Zeichen) in der Zeile oder im Kommentarblock darüber.\n`)
    process.exit(1)
  }
}
