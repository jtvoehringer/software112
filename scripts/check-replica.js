#!/usr/bin/env node
/**
 * check-replica.js – Wächter „Datenkorrekturen nie an FK-Kaskaden und Protokoll vorbei“ (KAN-124, 25.09.2026)
 *
 * Läuft im prebuild neben check-behoerden-csv.js & Co. und bricht den Build ab bei:
 *  1. REPLICA          session_replication_role – egal ob SET, SET LOCAL, set_config('session_…', …)
 *                      oder ALTER ROLE … SET. 'replica' schaltet FK-Prüfungen, FK-Kaskaden und die
 *                      Protokoll-Trigger (bestandsprotokoll) ab; so blieben nach einem Cleanup-Skript
 *                      10 verwaiste ernte_parzellen ohne Jahrgang zurück (KAN-124).
 *  2. DISABLE_TRIGGER  ALTER TABLE … DISABLE TRIGGER … (auch ALL/USER) bzw. ENABLE REPLICA TRIGGER
 *                      (feuert dann nur noch unter 'replica', im Normalbetrieb also nie).
 *
 * Geprüft werden sql/**, scripts/** und supabase/** (Migrationen, aber auch Datenskripte wie
 * supabase/import_*.sql) – *.sql, in scripts/ zusätzlich *.js/*.mjs/*.cjs/*.ts (dynamisches SQL in
 * Node-Skripten). Nicht geprüft: supabase/migrations_legacy/ (unveränderliche Historie bis
 * 24.09.2026, dort nichts davon) und dieses Skript selbst.
 * Kommentare zählen nicht: -- … und /* … *\/ (in SQL auch verschachtelt) bzw. // … und /* … *\/ in JS –
 * die seit KAN-35 auskommentierten Zeilen der Cleanup-Skripte bleiben so erlaubt. Strings zählen
 * (EXECUTE 'SET …', set_config('session_replication_role', …)), ebenso DO-Rümpfe in $$ … $$.
 * Ausnahme je Stelle: „-- replica-ausnahme: <Grund>“ (JS: „// replica-ausnahme: <Grund>“) als
 * Kommentar in derselben Zeile oder allein in der Zeile davor; Begründung mind. 15 Zeichen, sonst Fund.
 *
 * Ohne Abhängigkeiten (kleiner Scanner, der Kommentare durch Leerzeichen ersetzt; Zeilen bleiben erhalten).
 * Aufruf: node scripts/check-replica.js   (Exit 1 bei Funden)
 * Für Tests: require('./check-replica.js') → { pruefeText, pruefeWurzel, ohneKommentare } ohne Seiteneffekte;
 * S112_GUARD_ROOT prüft ein anderes Projektverzeichnis (scripts/tests/check-replica.test.mjs).
 */
const fs = require('fs')
const path = require('path')

const VERZEICHNISSE = ['sql', 'scripts', 'supabase']
const AUSGENOMMEN = ['supabase/migrations_legacy']
const SQL_ENDUNGEN = ['.sql']
const JS_ENDUNGEN = ['.js', '.mjs', '.cjs', '.ts']
const SELBST = 'scripts/check-replica.js'

const MUSTER = [
  { art: 'REPLICA', re: /session_replication_role/gi, text: 'session_replication_role schaltet FK-Kaskaden, FK-Prüfungen und Protokoll-Trigger ab' },
  { art: 'DISABLE_TRIGGER', re: /\bdisable\s+trigger\b|\benable\s+replica\s+trigger\b/gi, text: 'Trigger abschalten umgeht Protokoll- und Schutz-Trigger (bei ALL auch die FK-Trigger)' },
]
const AUSNAHME = /replica-ausnahme\b/i
const AUSNAHME_GRUND = /replica-ausnahme\s*:\s*(.*)$/i
const MIN_GRUND = 15

const BS = String.fromCharCode(92) // Backslash

// ── Kommentare entfernen ───────────────────────────────────────────────────────

/** Ersetzt Kommentarzeichen durch Leerzeichen (Zeilenumbrüche bleiben) – gleiche Länge wie s. */
function leeren(s) { return s.replace(/[^\r\n]/g, ' ') }

/** Ende eines '…'-Strings ab i (s[i] === "'"); backslash = E'…' mit Escapes */
function stringEnde(s, i, backslash) {
  for (let j = i + 1; j < s.length; j++) {
    if (backslash && s[j] === BS) { j++; continue }
    if (s[j] === "'") { if (s[j + 1] === "'") { j++; continue } return j + 1 }
  }
  return s.length
}

/** SQL: -- …, /* … *\/ (verschachtelt), '…', E'…', "…", $tag$ … $tag$ (Rumpf wird selbst gescannt) */
function ohneKommentareSql(s) {
  let out = ''
  let i = 0
  let code = 0 // Beginn des noch nicht übernommenen Code-Stücks
  const uebernimm = bis => { out += s.slice(code, bis) }
  while (i < s.length) {
    const c = s[i], n = s[i + 1]
    if (c === '-' && n === '-') {
      const e = s.indexOf('\n', i)
      const ende = e < 0 ? s.length : e
      uebernimm(i); out += leeren(s.slice(i, ende)); i = code = ende
      continue
    }
    if (c === '/' && n === '*') {
      let tiefe = 1, j = i + 2
      while (j < s.length && tiefe > 0) {
        if (s[j] === '/' && s[j + 1] === '*') { tiefe++; j += 2 }
        else if (s[j] === '*' && s[j + 1] === '/') { tiefe--; j += 2 }
        else j++
      }
      uebernimm(i); out += leeren(s.slice(i, j)); i = code = j
      continue
    }
    if (c === "'") {
      const e = /[Ee]/.test(s[i - 1] ?? '') && !/[\w$]/.test(s[i - 2] ?? '')
      i = stringEnde(s, i, e)
      continue
    }
    if (c === '"') {
      let j = i + 1
      while (j < s.length) { if (s[j] === '"') { if (s[j + 1] === '"') { j += 2; continue } break } j++ }
      i = j + 1
      continue
    }
    if (c === '$' && !/[\w$]/.test(s[i - 1] ?? '')) {
      const m = /^\$([A-Za-z_][A-Za-z_0-9]*)?\$/.exec(s.slice(i, i + 64))
      if (m) {
        const start = i + m[0].length
        const e = s.indexOf(m[0], start)
        const ende = e < 0 ? s.length : e
        uebernimm(start); out += ohneKommentareSql(s.slice(start, ende))
        i = code = Math.min(s.length, ende + m[0].length)
        out += s.slice(ende, i)
        continue
      }
    }
    i++
  }
  uebernimm(s.length)
  return out
}

/** JS/TS: // …, /* … *\/, '…', "…", `…` (Regex-Literale werden nicht erkannt – reicht für scripts/) */
function ohneKommentareJs(s) {
  let out = ''
  let i = 0
  let code = 0
  const uebernimm = bis => { out += s.slice(code, bis) }
  while (i < s.length) {
    const c = s[i], n = s[i + 1]
    if (c === '/' && (n === '/' || n === '*')) {
      let ende
      if (n === '/') { const e = s.indexOf('\n', i); ende = e < 0 ? s.length : e }
      else { const e = s.indexOf('*/', i + 2); ende = e < 0 ? s.length : e + 2 }
      uebernimm(i); out += leeren(s.slice(i, ende)); i = code = ende
      continue
    }
    if (c === '"' || c === "'" || c === '`') {
      let j = i + 1
      while (j < s.length) {
        if (s[j] === BS) { j += 2; continue }
        if (s[j] === c || (c !== '`' && s[j] === '\n')) break
        j++
      }
      i = j + 1
      continue
    }
    i++
  }
  uebernimm(s.length)
  return out
}

function ohneKommentare(text, sprache) {
  return sprache === 'js' ? ohneKommentareJs(text) : ohneKommentareSql(text)
}

// ── Prüfung ────────────────────────────────────────────────────────────────────

/**
 * Prüft einen Dateiinhalt. sprache: 'sql' | 'js'.
 * → { funde: [{ zeile, art, text }], ausnahmen, auskommentiert }
 */
function pruefeText(text, sprache = 'sql') {
  const code = ohneKommentare(text, sprache)
  const zeilen = text.split('\n')
  const codeZeilen = code.split('\n')
  const kommentarZeile = sprache === 'js' ? /^\s*(\/\/|\/\*|\*)/ : /^\s*(--|\/\*|\*)/
  const zeileVon = pos => code.slice(0, pos).split('\n').length

  const jeZeile = new Map() // Zeilennummer → Set(art)
  let roh = 0
  for (const { art, re } of MUSTER) {
    roh += (text.match(re) ?? []).length
    for (const m of code.matchAll(re)) {
      const nr = zeileVon(m.index)
      if (!jeZeile.has(nr)) jeZeile.set(nr, new Set())
      jeZeile.get(nr).add(art)
    }
  }

  // Marker zählt nur als Kommentar: im Original vorhanden, im Code (ohne Kommentare) nicht
  const markerIn = nr => AUSNAHME.test(zeilen[nr - 1] ?? '') && !AUSNAHME.test(codeZeilen[nr - 1] ?? '')
  const funde = []
  let ausnahmen = 0
  for (const [nr, arten] of [...jeZeile].sort((a, b) => a[0] - b[0])) {
    const markerZeile = markerIn(nr) ? nr : (nr > 1 && markerIn(nr - 1) && kommentarZeile.test(zeilen[nr - 2]) ? nr - 1 : null)
    if (markerZeile !== null) {
      const grund = (AUSNAHME_GRUND.exec(zeilen[markerZeile - 1].replace(/\r$/, ''))?.[1] ?? '').replace(/\*\/.*$/, '').trim()
      if (grund.length >= MIN_GRUND) { ausnahmen++; continue }
      funde.push({ zeile: nr, art: 'AUSNAHME', text: `„replica-ausnahme“ ohne ausreichende Begründung (mind. ${MIN_GRUND} Zeichen, Schreibweise: -- replica-ausnahme: <Grund>)` })
      continue
    }
    for (const art of arten) funde.push({ zeile: nr, art, text: MUSTER.find(x => x.art === art).text })
  }
  // Statistik: Erwähnungen, die nur in Kommentaren stehen (z. B. die seit KAN-35 auskommentierten Zeilen)
  const imCode = MUSTER.reduce((summe, { re }) => summe + (code.match(re) ?? []).length, 0)
  // (nie negativ: „DISABLE /* … */ TRIGGER“ trifft erst nach dem Entfernen des Kommentars)
  return { funde, ausnahmen, auskommentiert: Math.max(0, roh - imCode) }
}

const rel = (root, f) => path.relative(root, f).split(path.sep).join('/')

function dateien(dir, endungen) {
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) return ['node_modules', '.next'].includes(e.name) ? [] : dateien(p, endungen)
    return endungen.some(x => e.name.endsWith(x)) ? [p] : []
  })
}

/** Prüft ein Projektverzeichnis → { funde: ['pfad:zeile  ART  text'], dateien, ausnahmen, auskommentiert } */
function pruefeWurzel(root) {
  const funde = []
  let anzahl = 0, ausnahmen = 0, auskommentiert = 0
  for (const verzeichnis of VERZEICHNISSE) {
    const endungen = verzeichnis === 'scripts' ? [...SQL_ENDUNGEN, ...JS_ENDUNGEN] : SQL_ENDUNGEN
    for (const f of dateien(path.join(root, verzeichnis), endungen)) {
      const r = rel(root, f)
      if (r === SELBST || AUSGENOMMEN.some(a => r.startsWith(a + '/'))) continue
      anzahl++
      const sprache = SQL_ENDUNGEN.some(x => r.endsWith(x)) ? 'sql' : 'js'
      const e = pruefeText(fs.readFileSync(f, 'utf8'), sprache)
      ausnahmen += e.ausnahmen
      auskommentiert += e.auskommentiert
      for (const x of e.funde) funde.push(`${r}:${x.zeile}  ${x.art}  ${x.text}`)
    }
  }
  return { funde, dateien: anzahl, ausnahmen, auskommentiert }
}

module.exports = { pruefeText, pruefeWurzel, ohneKommentare }

// ── Ergebnis ───────────────────────────────────────────────────────────────────

if (require.main === module) {
  const ROOT = process.env.S112_GUARD_ROOT ? path.resolve(process.env.S112_GUARD_ROOT) : path.resolve(__dirname, '..')
  const e = pruefeWurzel(ROOT)
  if (e.funde.length) {
    console.error(`\n✖ check-replica: ${e.funde.length} Fund(e) – Datenkorrekturen/Cleanup-Skripte (CLAUDE.md, Konventionen, KAN-124):\n`)
    for (const x of e.funde) console.error('  ' + x)
    console.error('\nNie session_replication_role = replica oder DISABLE TRIGGER: abhängige Tabellen ausdrücklich zuerst löschen,')
    console.error('danach scripts/fk-waisen.sql ausführen (0 Zeilen erwartet). Begründete Ausnahme je Zeile: -- replica-ausnahme: <Grund>\n')
    process.exit(1)
  }
  console.log(`✓ check-replica: ${e.dateien} Dateien in ${VERZEICHNISSE.join('/, ')}/ ohne aktives session_replication_role/DISABLE TRIGGER; ${e.auskommentiert} auskommentierte Erwähnung(en), ${e.ausnahmen} begründete Ausnahme(n).`)
}
