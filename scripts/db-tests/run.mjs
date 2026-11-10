#!/usr/bin/env node
/**
 * run.mjs – SQL-Testsuite gegen die STAGING-Datenbank (Mandantentrennung, Rollen, Sperren, Trigger, RPCs).
 *
 * Aufruf:  npm run test:db [-- Optionen]
 *   --nur 10,11          nur diese Dateien (Nummer oder Name); 00_rahmen läuft trotzdem immer zuerst
 *   --mutationen [datei] jede im Dateikopf deklarierte Mutation einzeln ausführen (optional nur eine Datei)
 *   --ausfuehrlich       auch die Namen der OK-Prüfungen ausgeben
 *   --streng             BEKANNT zählt als Fehler (z. B. für ein Sicherheitsreview)
 *   --liste              Dateien, Ziele und Mutationen samt statischer Prüfung zeigen – ohne Datenbank
 *   --json <pfad>        maschinenlesbare Zusammenfassung schreiben (nie einchecken)
 *   --zeitzone <IANA>    Sitzungs-Zeitzone im Test (z. B. Etc/GMT+12): current_date ≠ Wiener Datum erzwingen
 *
 * Exit-Codes: 0 grün (BEKANNT erlaubt) · 1 Testfehler/überlebte Mutation · 2 echter SQL- oder
 * Infrastrukturfehler · 3 kein Rollback (Datei endete ohne RAISE oder Reste gefunden) · 4 nicht Staging.
 *
 * Produktionsschutz (gestaffelt, siehe README.md):
 *   1. STAGING_REF/STAGING_SYSID/PROD_REF sind Konstanten – keine Option, keine Umgebungsvariable ändert sie;
 *      enthält die Befehlszeile PROD_REF, bricht der Lauf ab.
 *   2. Eigenes, leeres --workdir (os.tmpdir()/s112-db-tests-*): supabase/.temp/project-ref im Repo zeigt auf
 *      die PRODUKTION; ohne diese Datei gibt es keinen Rückfall auf den verknüpften Stand.
 *   3. Vor jedem Lauf ein SELECT: system_identifier = STAGING_SYSID, keiner der Produktions-Betriebe
 *      (IDs aus dem Wächter in _helfer.sql) vorhanden, admin@software112.test ist Plattform-Admin – sonst Exit 4.
 *   4. In SQL ist die erste Anweisung jedes DO-Blocks pg_temp.s112_nur_staging() (Wächter, 'S112GUARD|…').
 *   5. Statisch: Produktions-Ref und Produktions-Betriebs-IDs stehen nur in _helfer.sql (Wächter);
 *      scripts/tests/db-tests.test.mjs prüft das.
 *
 * Jede Testdatei wird vor dem Senden statisch geprüft (pruefeTestdatei): oben nur CREATE FUNCTION pg_temp.*
 * und genau ein DO $test$; erste Anweisung der Wächter, letzte pg_temp.s112_ende(…) (wirft immer); keine
 * Transaktionssteuerung, kein RETURN/Block-Label (sonst endete der Block ohne RAISE = COMMIT), keine
 * Funktionsaufrufe im DECLARE (liefen VOR dem Wächter) u. a. Gesendet wird _helfer.sql + ggf. Mutations-/
 * Ausführlich-Schalter + Testdatei – als EINE Transaktion, die mit RAISE endet und zurückgerollt wird.
 *
 * Streng nacheinander: parallele CLI-Aufrufe scheitern mit 28P01 (cli_login_postgres). Wiederholung nur bei
 * Infrastrukturfehlern (28P01/DbConfigConnectTempRoleError, HTTP 401/429/5xx, Zeitüberschreitung).
 *
 * Für Unit-Tests (scripts/tests/db-tests.test.mjs) ohne Seiteneffekte importierbar; lauf() nimmt eine
 * Umgebung (CLI-Aufruf, Ausgabe, Pause) entgegen, damit sich der Ablauf ohne Datenbank prüfen lässt.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

// ── Konstanten (bewusst ohne Option/ENV zum Überschreiben) ─────────────────────────────────────────────
export const STAGING_REF = 'sjpeghrlhsowmquacjhb'
export const STAGING_SYSID = '7678069749886157684'
export const PROD_REF = 'zwcsgnemijkpyxrqykul' // nur zur Negativprüfung
export const STAGING_ADMIN = 'admin@software112.test'

export const EXIT = Object.freeze({ GRUEN: 0, TESTFEHLER: 1, ECHTER_FEHLER: 2, KEIN_ROLLBACK: 3, NICHT_STAGING: 4 })

export const TEST_DIR = path.dirname(fileURLToPath(import.meta.url))
export const HELFER_NAME = '_helfer.sql'
export const RAHMEN_NAME = '00_rahmen.sql'
export const DATEI_RE = /^(\d\d)_[a-z0-9_]+\.sql$/
const NAME_RE = /^[a-z0-9_]+$/

const TIMEOUT_MS = 150_000
export const MAX_WIEDERHOLUNGEN = 3
export const PAUSE_MS = 5_000

const require = createRequire(import.meta.url)
const { pruefeText } = require('../check-replica.js')

// ── SQL zerlegen (Kommentare, Strings, Dollar-Quotes) ─────────────────────────────────────────────────

const BS = String.fromCharCode(92) // Backslash

/** Ende eines '…'-Strings ab i (s[i] === "'"); mitBackslash = E'…' */
function stringEnde(s, i, mitBackslash) {
  for (let j = i + 1; j < s.length; j++) {
    if (mitBackslash && s[j] === BS) { j++; continue }
    if (s[j] === "'") { if (s[j + 1] === "'") { j++; continue } return j + 1 }
  }
  return s.length
}

/**
 * Zerlegt SQL in Segmente: code | kommentar | string ('…', E'…') | dollar ($tag$…$tag$, mit tag/inhalt).
 * "…"-Bezeichner bleiben Code.
 */
export function segmente(s) {
  const out = []
  let i = 0
  let code = 0
  const push = (art, von, bis, extra = {}) => { if (bis > von) out.push({ art, text: s.slice(von, bis), ...extra }) }
  while (i < s.length) {
    const c = s[i], n = s[i + 1]
    if (c === '-' && n === '-') {
      const e = s.indexOf('\n', i)
      const ende = e < 0 ? s.length : e
      push('code', code, i); push('kommentar', i, ende); i = code = ende
      continue
    }
    if (c === '/' && n === '*') {
      let tiefe = 1, j = i + 2
      while (j < s.length && tiefe > 0) {
        if (s[j] === '/' && s[j + 1] === '*') { tiefe++; j += 2 } else if (s[j] === '*' && s[j + 1] === '/') { tiefe--; j += 2 } else j++
      }
      push('code', code, i); push('kommentar', i, j); i = code = j
      continue
    }
    if (c === "'") {
      const e = /[Ee]/.test(s[i - 1] ?? '') && !/[\w$]/.test(s[i - 2] ?? '')
      const ende = stringEnde(s, i, e)
      push('code', code, i); push('string', i, ende); i = code = ende
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
        const ende = e < 0 ? s.length : e + m[0].length
        push('code', code, i)
        push('dollar', i, ende, { tag: m[1] ?? '', inhalt: s.slice(start, e < 0 ? s.length : e), offen: e < 0 })
        i = code = ende
        continue
      }
    }
    i++
  }
  push('code', code, s.length)
  return out
}

/** Code-Sicht: Kommentare → Leerzeichen, Strings → '', Dollar-Quotes → $tag$$tag$ (Inhalt weg). */
function codeSicht(segs) {
  return segs.map(g => g.art === 'code' ? g.text
    : g.art === 'kommentar' ? ' '
      : g.art === 'string' ? "''"
        : `$${g.tag}$$${g.tag}$`).join('')
}

/**
 * Text ohne Kommentare – auch in Dollar-Quotes (DO-Rumpf, EXECUTE-Texte) –, Strings bleiben: für Verbotslisten,
 * die auch EXECUTE-Strings treffen. Zeilenumbrüche bleiben erhalten (Zeilennummern in Meldungen).
 */
function ohneKommentare(segs) {
  return segs.map(g => {
    if (g.art === 'kommentar') return g.text.replace(/[^\n]/g, ' ')
    if (g.art === 'dollar' && !g.offen) return `$${g.tag}$${ohneKommentare(segmente(g.inhalt))}$${g.tag}$`
    return g.text
  }).join('')
}

/** Anweisungen auf oberster Ebene (Trenner ; außerhalb von Strings/Kommentaren/Dollar-Quotes). */
export function anweisungen(s) {
  const segs = segmente(s)
  const out = []
  let cur = []
  const fertig = () => {
    const code = codeSicht(cur)
    if (code.trim()) out.push({ text: cur.map(g => g.text).join(''), code: code.trim(), segmente: cur })
    cur = []
  }
  for (const g of segs) {
    if (g.art !== 'code') { cur.push(g); continue }
    const teile = g.text.split(';')
    teile.forEach((t, k) => {
      if (t) cur.push({ art: 'code', text: t })
      if (k < teile.length - 1) fertig()
    })
  }
  fertig()
  return out
}

// ── Kopf der Testdatei ─────────────────────────────────────────────────────────────────────────────────

/** -- @bereich: …, -- @ziel: … (mehrzeilig), -- @mutation <name>: <Beschreibung> | rot: <Muster> */
export function leseKopf(text) {
  const zeilen = text.split(/\r?\n/)
  const kopf = { bereich: null, ziel: [], mutationen: [], fehler: [] }
  for (const z of zeilen) {
    let m
    if ((m = /^--\s*@bereich:\s*(.+?)\s*$/.exec(z))) kopf.bereich = m[1]
    else if ((m = /^--\s*@ziel:\s*(.+?)\s*$/.exec(z))) kopf.ziel.push(m[1])
    else if ((m = /^--\s*@mutation\b(.*)$/.exec(z))) {
      const mm = /^\s+([a-z0-9_]+)\s*:\s*(.*?)\s*\|\s*rot:\s*(.+?)\s*$/.exec(m[1])
      if (!mm) { kopf.fehler.push(`Mutationszeile unlesbar (Form: -- @mutation <name>: <Beschreibung> | rot: <Muster>): ${z.trim()}`); continue }
      const [, name, beschreibung, rot] = mm
      try { new RegExp(`^(?:${rot})$`) } catch (e) { kopf.fehler.push(`Mutation ${name}: Muster „${rot}“ ist kein gültiger regulärer Ausdruck (${e.message})`); continue }
      if (kopf.mutationen.some(x => x.name === name)) kopf.fehler.push(`Mutation ${name} doppelt deklariert`)
      kopf.mutationen.push({ name, beschreibung, rot })
    }
  }
  kopf.ziel = kopf.ziel.join(' ')
  return kopf
}

// ── Statische Prüfungen ────────────────────────────────────────────────────────────────────────────────

const VERBOTEN = [
  [/\bCOMMIT\b/i, 'COMMIT (Transaktionssteuerung)'],
  [/\bROLLBACK\b/i, 'ROLLBACK (Transaktionssteuerung)'],
  [/\bSAVEPOINT\b/i, 'SAVEPOINT (Transaktionssteuerung)'],
  [/\bSTART\s+TRANSACTION\b/i, 'START TRANSACTION'],
  [/\bPREPARE\s+TRANSACTION\b/i, 'PREPARE TRANSACTION'],
  [/\bBEGIN\s*;/i, 'BEGIN; (Transaktionssteuerung)'],
  [/\bBEGIN\s+(TRANSACTION|WORK|ISOLATION)\b/i, 'BEGIN TRANSACTION/WORK'],
  [/\bEND\s+(TRANSACTION|WORK)\b/i, 'END TRANSACTION/WORK (= COMMIT)'],
  [/\bABORT\b/i, 'ABORT (Transaktionssteuerung)'],
  [/\bALTER\s+SYSTEM\b/i, 'ALTER SYSTEM'],
  [/\bALTER\s+DATABASE\b/i, 'ALTER DATABASE'],
  [/\bALTER\s+(ROLE|USER)\b/i, 'ALTER ROLE/USER'],
  [/\bCOMMENT\s+ON\s+DATABASE\b/i, 'COMMENT ON DATABASE'],
  [/\bCREATE\s+EXTENSION\b/i, 'CREATE EXTENSION'],
  [/\bdblink\w*/i, 'dblink'],
  [/\bpg_terminate_backend\b/i, 'pg_terminate_backend'],
  [/\bpg_cancel_backend\b/i, 'pg_cancel_backend'],
  [/\bCOPY\b[\s\S]{0,300}?\bPROGRAM\b/i, 'COPY … PROGRAM'],
  [/\b(ALTER|DROP)\s+FUNCTION\s+pg_temp\./i, 'ALTER/DROP FUNCTION pg_temp.* (Rahmen nicht verändern)'],
]
const NUR_TESTDATEI = [
  [/\bCREATE\s+(OR\s+REPLACE\s+)?FUNCTION\s+pg_temp\.s112_/i, 'pg_temp.s112_* ist _helfer.sql vorbehalten (eigene Hilfsfunktionen z. B. pg_temp.t10_…)'],
]
// Erlaubte Aufrufe im DECLARE (laufen VOR dem Wächter): nur Zeit, Zufalls-IDs, Konstruktoren – und Typnamen
const DECLARE_ERLAUBT = new Set(['gen_random_uuid', 'clock_timestamp', 'now', 'transaction_timestamp', 'statement_timestamp',
  'jsonb_build_object', 'jsonb_build_array', 'json_build_object', 'json_build_array', 'make_date', 'coalesce', 'array',
  'numeric', 'decimal', 'varchar', 'char', 'character', 'varying', 'timestamp', 'timestamptz', 'time', 'interval', 'bit'])

/** Verbotene Muster (Kommentare zählen nicht, Strings schon – EXECUTE 'COMMIT' ist genauso verboten). */
export function pruefeVerboten(text, { testdatei = false } = {}) {
  const fehler = []
  const ohne = ohneKommentare(segmente(text))
  for (const [re, was] of [...VERBOTEN, ...(testdatei ? NUR_TESTDATEI : [])]) {
    const m = re.exec(ohne)
    if (m) fehler.push(`verboten: ${was} („${m[0].replace(/\s+/g, ' ').slice(0, 60)}“, Zeile ${ohne.slice(0, m.index).split('\n').length})`)
  }
  const r = pruefeText(text, 'sql') // scripts/check-replica.js: Replikationsmodus / Trigger abschalten
  for (const f of r.funde) fehler.push(`verboten (check-replica): Zeile ${f.zeile} ${f.art} – ${f.text}`)
  if (r.ausnahmen) fehler.push('verboten: replica-ausnahme-Marker sind in Testdateien nicht zulässig')
  return fehler
}

/**
 * „Heute“ nur als Wiener Datum: current_date (Sitzungs-Zeitzone UTC) liegt zwischen 00:00 und 01:00 bzw. 02:00
 * Wiener Zeit einen Tag hinter den RPCs (now() AT TIME ZONE 'Europe/Vienna'). Kommentare zählen nicht, Strings
 * (EXECUTE/format) schon.
 */
export function pruefeHeute(text) {
  const ohne = ohneKommentare(segmente(text))
  const fehler = []
  for (const m of ohne.matchAll(/\bcurrent_date\b/gi)) {
    fehler.push(`current_date in Zeile ${ohne.slice(0, m.index).split('\n').length} – Wiener Datum verwenden: v_heute (DECLARE v_heute date := (now() AT TIME ZONE 'Europe/Vienna')::date) bzw. pg_temp.s112_heute() in SQL-Texten`)
  }
  return fehler
}

/** _helfer.sql: oben nur CREATE [OR REPLACE] FUNCTION pg_temp.*, keine verbotenen Muster, Wächter vorhanden. */
export function pruefeHelfer(text) {
  const fehler = []
  for (const a of anweisungen(text)) {
    if (!/^CREATE\s+(OR\s+REPLACE\s+)?FUNCTION\s+pg_temp\.[a-z_][a-z0-9_]*\s*\(/i.test(a.code)) {
      fehler.push(`_helfer.sql: auf oberster Ebene nur CREATE FUNCTION pg_temp.* erlaubt, gefunden: „${a.code.slice(0, 80)}“`)
    }
  }
  fehler.push(...pruefeVerboten(text).map(f => `_helfer.sql: ${f}`))
  fehler.push(...pruefeHeute(text).map(f => `_helfer.sql: ${f}`))
  for (const fn of ['s112_nur_staging', 's112_ende', 's112_mutation', 's112_ausfuehrlich', 's112_mutiere', 's112_heute', 's112_zeitzone']) {
    if (!new RegExp(`CREATE\\s+FUNCTION\\s+pg_temp\\.${fn}\\s*\\(`, 'i').test(text)) fehler.push(`_helfer.sql: pg_temp.${fn} fehlt`)
  }
  if (!text.includes(`'${STAGING_SYSID}'`)) fehler.push('_helfer.sql: Wächter prüft nicht STAGING_SYSID aus run.mjs')
  try { prodBetriebe(text) } catch (e) { fehler.push(`_helfer.sql: ${e.message}`) }
  return fehler
}

/** Produktions-Betriebs-IDs aus dem Wächter (einzige Stelle, an der sie stehen dürfen). Genau drei. */
export function prodBetriebe(helferText) {
  const m = /c_prod_betriebe\s+constant\s+uuid\[\]\s*:=\s*ARRAY\[([^\]]*)\]/i.exec(helferText)
  const ids = m ? [...m[1].matchAll(/'([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})'/gi)].map(x => x[1].toLowerCase()) : []
  if (ids.length !== 3) throw new Error(`Wächter: c_prod_betriebe muss genau 3 Produktions-Betriebs-IDs enthalten (gefunden: ${ids.length})`)
  return ids
}

/**
 * Testdatei statisch prüfen → Liste von Fehlern (leer = ok). kopf: Ergebnis von leseKopf.
 * prodIds: Produktions-Betriebs-IDs (aus _helfer.sql) – dürfen hier nicht vorkommen.
 */
export function pruefeTestdatei(name, text, prodIds = []) {
  const fehler = []
  const f = x => fehler.push(`${name}: ${x}`)
  if (!DATEI_RE.test(name)) f(`Dateiname muss NN_<bereich>.sql sein (Kleinbuchstaben, Ziffern, _)`)

  const kopf = leseKopf(text)
  if (!kopf.bereich) f('Kopfzeile „-- @bereich: …“ fehlt')
  if (!kopf.ziel) f('Kopfzeile „-- @ziel: …“ fehlt')
  kopf.fehler.forEach(f)
  if (kopf.mutationen.length < 2) f(`mindestens zwei „-- @mutation <name>: … | rot: …“ nötig (gefunden: ${kopf.mutationen.length})`)
  const angewendet = new Set([...text.matchAll(/s112_mutiere\s*\(\s*'([a-z0-9_]+)'/g)].map(m => m[1]))
  for (const m of kopf.mutationen) if (!angewendet.has(m.name)) f(`Mutation ${m.name} deklariert, aber kein pg_temp.s112_mutiere('${m.name}', …)`)
  for (const n of angewendet) if (!kopf.mutationen.some(m => m.name === n)) f(`pg_temp.s112_mutiere('${n}', …) ohne Kopfzeile „-- @mutation ${n}: …“`)

  if (text.includes(PROD_REF)) f('enthält die Produktions-Ref – nur _helfer.sql (Wächter) darf sie nennen')
  for (const id of prodIds) if (text.toLowerCase().includes(id)) f(`enthält die Produktions-Betriebs-ID ${id} – nur der Wächter in _helfer.sql darf sie nennen`)

  fehler.push(...pruefeVerboten(text, { testdatei: true }).map(x => `${name}: ${x}`))
  fehler.push(...pruefeHeute(text).map(x => `${name}: ${x}`))

  // Oberste Ebene: CREATE FUNCTION pg_temp.* (nicht s112_*) und genau ein DO $test$ als letzte Anweisung
  const anw = anweisungen(text)
  const dos = []
  anw.forEach((a, k) => {
    if (/^DO\s+\$test\$\$test\$$/i.test(a.code)) { dos.push(k); return }
    const m = /^CREATE\s+(OR\s+REPLACE\s+)?FUNCTION\s+pg_temp\.([a-z_][a-z0-9_]*)\s*\(/i.exec(a.code)
    if (m) { if (/^s112_/i.test(m[2])) f(`pg_temp.${m[2]}: Präfix s112_ ist _helfer.sql vorbehalten`); return }
    f(`auf oberster Ebene nur CREATE FUNCTION pg_temp.* und ein DO $test$ erlaubt, gefunden: „${a.code.slice(0, 80)}“`)
  })
  if (dos.length !== 1) { f(`genau ein DO $test$ … $test$ nötig (gefunden: ${dos.length})`); return fehler }
  if (dos[0] !== anw.length - 1) f('DO $test$ muss die letzte Anweisung der Datei sein')
  const doSeg = anw[dos[0]].segmente.find(g => g.art === 'dollar' && g.tag === 'test')
  if (!doSeg || doSeg.offen) { f('DO-Block $test$ ist nicht geschlossen'); return fehler }

  // Rumpf des DO-Blocks
  const body = doSeg.inhalt
  const bodyCode = codeSicht(segmente(body))
  if (/\bRETURN\b/i.test(bodyCode)) f('RETURN im DO-Block verboten (der Block endete ohne RAISE → keine Rücknahme)')
  if (/<</.test(bodyCode)) f('Block-/Schleifen-Labels (<<…>>) im DO-Block verboten (EXIT <label> könnte s112_ende überspringen)')
  const ba = anweisungen(body)
  const k = ba.findIndex(a => /\bBEGIN\b/i.test(a.code))
  if (k < 0) { f('DO-Block ohne BEGIN'); return fehler }
  const beginPos = ba[k].code.search(/\bBEGIN\b/i)
  const declare = [...ba.slice(0, k).map(a => a.code), ba[k].code.slice(0, beginPos)].join(';\n')
  const erste = ba[k].code.slice(beginPos + 5).trim()
  if (!/^PERFORM\s+pg_temp\.s112_nur_staging\s*\(\s*\)$/i.test(erste)) {
    f(`erste Anweisung im DO-Block muss „PERFORM pg_temp.s112_nur_staging();“ sein, gefunden: „${erste.slice(0, 80)}“`)
  }
  if (/\b(SELECT|INSERT|UPDATE|DELETE|EXECUTE|PERFORM|CALL)\b/i.test(declare)) f('DECLARE darf keine Abfragen enthalten (liefen vor dem Wächter)')
  for (const m of declare.matchAll(/([A-Za-z_][A-Za-z0-9_]*)\s*\.\s*([A-Za-z_][A-Za-z0-9_]*)\s*\(/g)) {
    f(`DECLARE ruft ${m[1]}.${m[2]}() auf – das liefe vor dem Wächter; Zuweisung nach BEGIN verschieben`)
  }
  for (const m of declare.matchAll(/(?<![.\w])([A-Za-z_][A-Za-z0-9_]*)\s*\(/g)) {
    if (!DECLARE_ERLAUBT.has(m[1].toLowerCase())) f(`DECLARE ruft ${m[1]}() auf – das liefe vor dem Wächter; Zuweisung nach BEGIN verschieben`)
  }
  const letzte = ba[ba.length - 1]?.code ?? ''
  const vorletzte = ba[ba.length - 2]?.code ?? ''
  if (!/^END$/i.test(letzte) || !/^PERFORM\s+pg_temp\.s112_ende\s*\(/i.test(vorletzte)) {
    f('letzte Anweisung im DO-Block muss „PERFORM pg_temp.s112_ende(…);“ direkt vor dem abschließenden END sein (ohne EXCEPTION-Teil)')
  }
  for (const x of pruefeBlocktiefe(bodyCode)) f(x)
  return fehler
}

/**
 * Blocktiefe im DO-Rumpf (Code-Sicht: ohne Kommentare, Strings, Dollar-Quotes): der äußere Block darf keinen
 * EXCEPTION-Teil haben, und der letzte pg_temp.s112_ende(…)-Aufruf muss auf Tiefe 1 stehen. Sonst könnte s112_ende in einem
 * Handler landen, der ohne Fehler nie läuft – der Block endete normal und die Transaktion würde festgeschrieben.
 * BEGIN und CASE öffnen, END schließt; END IF/END LOOP zählen nicht (IF/LOOP öffnen nichts), END CASE schließt
 * ein CASE, RAISE EXCEPTION ist kein Handler.
 */
export function pruefeBlocktiefe(bodyCode) {
  const fehler = []
  const stapel = []
  let letzteTiefe = null // Tiefe des LETZTEN s112_ende-Aufrufs (frühere in Unterblöcken sind erlaubt, sie werfen ohnehin)
  const re = /\bEND\s+(IF|LOOP|CASE)\b|\bRAISE\s+EXCEPTION\b|\b(BEGIN|END|CASE|EXCEPTION)\b|\bpg_temp\s*\.\s*s112_ende\s*\(/gi
  for (const m of bodyCode.matchAll(re)) {
    const w = m[0].toUpperCase().replace(/\s+/g, ' ')
    if (w === 'END IF' || w === 'END LOOP' || w.startsWith('RAISE')) continue
    if (w === 'END CASE') { if (stapel.pop() !== 'CASE') fehler.push('Blocktiefe: END CASE ohne passendes CASE'); continue }
    if (w === 'BEGIN' || w === 'CASE') { stapel.push(w); continue }
    if (w === 'END') { if (!stapel.length) fehler.push('Blocktiefe: END ohne offenes BEGIN/CASE'); else stapel.pop(); continue }
    if (w === 'EXCEPTION') {
      if (stapel.length === 1 && stapel[0] === 'BEGIN') fehler.push('äußerer Block des DO-Rumpfs darf keinen EXCEPTION-Teil haben (ohne Fehler liefe der Handler nie → Block endete ohne RAISE = COMMIT); Teilschritte in BEGIN … EXCEPTION … END-Unterblöcke')
      continue
    }
    // pg_temp.s112_ende(
    letzteTiefe = stapel.length === 1 && stapel[0] === 'BEGIN' ? 1 : stapel.length
  }
  if (stapel.length) fehler.push(`Blocktiefe: ${stapel.length} BEGIN/CASE nicht geschlossen`)
  if (letzteTiefe === null) fehler.push('pg_temp.s112_ende(…) fehlt im DO-Block')
  else if (letzteTiefe !== 1) fehler.push(`der letzte pg_temp.s112_ende(…)-Aufruf muss auf Tiefe 1 des DO-Blocks stehen (gefunden auf Tiefe ${letzteTiefe})`)
  return fehler
}

/** Gesendete Datei: _helfer.sql + Schalter + Testdatei. Danach nochmals Struktur und Verbote prüfen. */
export function zusammensetzen(helfer, test, { mutation = null, ausfuehrlich = false, zeitzone = null } = {}) {
  const teile = [helfer.trimEnd(), '']
  if (mutation !== null) {
    if (!NAME_RE.test(mutation)) throw new Error(`Mutationsname „${mutation}“ unzulässig`)
    teile.push(`CREATE OR REPLACE FUNCTION pg_temp.s112_mutation() RETURNS text LANGUAGE sql AS $m$ SELECT '${mutation}'::text $m$;`)
  }
  if (ausfuehrlich) teile.push('CREATE OR REPLACE FUNCTION pg_temp.s112_ausfuehrlich() RETURNS boolean LANGUAGE sql AS $m$ SELECT true $m$;')
  if (zeitzone !== null) {
    if (!ZEITZONE_RE.test(zeitzone)) throw new Error(`Zeitzone „${zeitzone}“ unzulässig`)
    teile.push(`CREATE OR REPLACE FUNCTION pg_temp.s112_zeitzone() RETURNS text LANGUAGE sql AS $m$ SELECT '${zeitzone}'::text $m$;`)
  }
  teile.push('', test.trimEnd(), '')
  const sql = teile.join('\n')
  const fehler = []
  const anw = anweisungen(sql)
  const dos = anw.filter(a => /^DO\s+\$test\$\$test\$$/i.test(a.code))
  if (dos.length !== 1 || anw[anw.length - 1] !== dos[0]) fehler.push('zusammengesetzt: genau ein DO $test$ als letzte Anweisung nötig')
  for (const a of anw) {
    if (a === dos[0]) continue
    if (!/^CREATE\s+(OR\s+REPLACE\s+)?FUNCTION\s+pg_temp\./i.test(a.code)) fehler.push(`zusammengesetzt: unzulässige Anweisung „${a.code.slice(0, 60)}“`)
  }
  fehler.push(...pruefeVerboten(sql).map(x => `zusammengesetzt: ${x}`))
  if (fehler.length) throw new Error(fehler.join('\n'))
  return sql
}

// ── Vor- und Nachprüfung ───────────────────────────────────────────────────────────────────────────────

/** Ein SELECT: Identität (drei Merkmale) und Reste früherer Läufe. Liefert genau eine Zeile. */
export function pruefSql(prodIds) {
  if (prodIds.length !== 3 || prodIds.some(id => !/^[0-9a-f-]{36}$/.test(id))) throw new Error('Produktions-Betriebs-IDs ungültig')
  return `-- software:112 SQL-Testsuite: Identitäts- und Restprüfung (nur lesend)
SELECT (SELECT system_identifier::text FROM pg_control_system()) = '${STAGING_SYSID}' AS sysid_ok,
       NOT EXISTS (SELECT 1 FROM public.tenants WHERE id IN (${prodIds.map(id => `'${id}'`).join(', ')})) AS keine_prod_betriebe,
       EXISTS (SELECT 1 FROM auth.users u JOIN public.plattform_admins p ON p.user_id = u.id WHERE u.email = '${STAGING_ADMIN}') AS staging_admin,
       (SELECT count(*) FROM public.tenants WHERE slug LIKE 's112test-%' OR name LIKE 'S112TEST%') AS rest_betriebe,
       (SELECT count(*) FROM auth.users WHERE email LIKE 's112test-%') AS rest_benutzer,
       (SELECT count(*) FROM auth.mfa_factors WHERE friendly_name LIKE 's112test%') AS rest_faktoren,
       (SELECT count(*) FROM storage.objects WHERE name LIKE '%s112test%') AS rest_storage,
       (SELECT count(*) FROM public.kontakte WHERE nachname LIKE 'S112TEST%') AS rest_kontakte,
       (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname LIKE 'pg_temp%' AND p.proname LIKE 's112%') AS rest_funktionen,
       (SELECT count(*) FROM pg_policies WHERE policyname LIKE 's112test%') AS rest_policies,
       (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'public' AND c.relname LIKE 's112test%') AS rest_relationen,
       (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public' AND p.proname LIKE 's112test%') AS rest_public_funktionen,
       (SELECT count(*) FROM public.plattform_admins WHERE hinweis LIKE 'S112TEST%') AS rest_plattform_admins,
       -- Rechte, die Tests (und Mutationen) an echten Objekten ändern: jede Abweichung vom Sollzustand zählt
       (SELECT count(*) FROM pg_attribute a JOIN (VALUES ('authenticated'), ('anon')) r (rolle) ON true
         WHERE a.attrelid IN ('public.tenant_einstellungen'::regclass, 'public.user_email_connections'::regclass)
           AND a.attnum > 0 AND NOT a.attisdropped AND a.attname ~ '(_enc|_api_key|passwort)$'
           AND has_column_privilege(r.rolle, a.attrelid, a.attnum, 'SELECT'))
       + (SELECT count(*) FROM (VALUES
           (has_column_privilege('authenticated', 'public.tenant_einstellungen', 'tenant_id', 'INSERT')),
           (NOT has_column_privilege('anon', 'public.tenant_einstellungen', 'anzeigename', 'SELECT')),
           (has_column_privilege('authenticated', 'public.user_email_connections', 'anzeigename', 'UPDATE')),
           (coalesce(has_function_privilege('anon', to_regprocedure('public.s112_meine_tenants()'), 'EXECUTE'), false)),
           (coalesce(has_function_privilege('anon', to_regprocedure('public.s112_aal_ok()'), 'EXECUTE'), false)),
           (coalesce(has_function_privilege('authenticated', to_regprocedure('public.ist_service_kontext()'), 'EXECUTE'), false))
         ) v (abweichung) WHERE v.abweichung) AS rest_rechte;
`
}

/**
 * Alle rest_*-Spalten der Abfrage – aus pruefSql() selbst abgeleitet, damit Abfrage und Bewertung nicht wieder
 * auseinanderlaufen (früher prüfte eine feste Liste nur 7 der 11 Spalten; Rechte, public.s112test_* und
 * plattform_admins-Reste blieben unbemerkt).
 */
export const REST_SPALTEN = Object.freeze([...pruefSql(Array(3).fill('00000000-0000-0000-0000-000000000000'))
  .matchAll(/\bAS\s+(rest_[a-z_]+)\b/g)].map(m => m[1]))
if (REST_SPALTEN.length < 11) throw new Error(`pruefSql: nur ${REST_SPALTEN.length} rest_*-Spalten erkannt`)

/** Zeile der Identitäts-/Restprüfung bewerten → { staging, reste: {spalte: n} } */
export function bewertePruefung(zeile) {
  const wahr = v => v === true || v === 't' || v === 'true'
  const staging = ['sysid_ok', 'keine_prod_betriebe', 'staging_admin'].every(k => wahr(zeile?.[k]))
  const reste = {}
  for (const k of REST_SPALTEN) { const v = zeile?.[k]; if (v === null || v === undefined || v === '' || Number(v) !== 0) reste[k] = v ?? 'fehlt' }
  return { staging, reste }
}

// ── CLI-Aufruf und Auswertung ──────────────────────────────────────────────────────────────────────────

/** Argumente für npx (ohne 'npx'); bricht ab, wenn irgendwo die Produktions-Ref steht.
 *  --yes: Supabase-CLI ab 3.1 fragt vor SQL auf einem gehosteten Projekt nach und bricht bei JSON-Ausgabe ohne
 *  Bestätigung ab; SUPABASE_YES entfernt cliUmgebung() bewusst. Das Ziel ist hier fest Staging (pruefeKeineProduktion). */
export function baueCliArgs(workdir, sqlDatei) {
  const args = ['supabase', 'db', 'query', '--workdir', workdir, '--linked', '--project-ref', STAGING_REF,
    '-f', sqlDatei, '--agent', 'no', '--output-format', 'json', '--yes']
  pruefeKeineProduktion(args)
  return args
}

export function pruefeKeineProduktion(args) {
  const zeile = args.join(' ')
  if (zeile.includes(PROD_REF)) throw new Error('ABBRUCH: Befehlszeile enthält die Produktions-Ref')
  const i = args.indexOf('--project-ref')
  if (args[0] === 'supabase' && args[1] === 'db' && (i < 0 || args[i + 1] !== STAGING_REF)) throw new Error('ABBRUCH: --project-ref ist nicht Staging')
  return true
}

/** Umgebung für die CLI: SUPABASE_* außer SUPABASE_ACCESS_TOKEN entfernen (keine Ref/Workdir/DB-URL von außen). */
export function cliUmgebung(env = process.env) {
  const out = {}
  for (const [k, v] of Object.entries(env)) {
    if (/^SUPABASE_/i.test(k) && k.toUpperCase() !== 'SUPABASE_ACCESS_TOKEN') continue
    out[k] = v
  }
  return out
}

function quoteWin(a) {
  if (/["%^&|<>!\r\n]/.test(a)) throw new Error(`Argument mit Sonderzeichen: ${a}`)
  return /[\s()]/.test(a) ? `"${a}"` : a
}

/** Startet npx synchron (Windows: shell, ein fertig gequoteter Befehl). → roh für auswerten() */
export function starteNpx(args, cwd) {
  pruefeKeineProduktion(args)
  const istWin = process.platform === 'win32'
  const t0 = Date.now()
  const r = spawnSync(istWin ? ['npx', ...args].map(quoteWin).join(' ') : 'npx', istWin ? [] : args, {
    cwd, shell: istWin, encoding: 'utf8', timeout: TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024, env: cliUmgebung(), windowsHide: true,
  })
  if (istWin && (r.error?.code === 'ETIMEDOUT' || r.signal)) beendeHaengende(args)
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '', error: r.error, signal: r.signal, ms: Date.now() - t0 }
}

/**
 * Windows: bei einer Zeitüberschreitung beendet spawnSync nur die Shell (cmd.exe) – npx/node/supabase.exe laufen
 * verwaist weiter, halten Verbindungen zu cli_login_postgres und lassen spätere Aufrufe ebenfalls hängen. Deshalb
 * alle Prozesse beenden, deren Befehlszeile die (eindeutige) SQL-Datei dieses Aufrufs nennt.
 */
function beendeHaengende(args) {
  const datei = args[args.indexOf('-f') + 1]
  if (!datei || !/^[A-Za-z]:[\\/][\w\\/.\- ]+\.sql$/.test(datei) || !/s112-db-tests-/.test(datei)) return
  const muster = datei.replace(/'/g, "''")
  spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    `Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and $_.CommandLine.Contains('${muster}') } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`],
  { encoding: 'utf8', timeout: 30_000, windowsHide: true })
}

/**
 * CLI-Antwort auswerten (tolerant – die CLI-Version ist nicht fixiert):
 *   zeilen   Exit 0 mit JSON-Array (oder {rows}) – bei Testdateien ALARM (kein RAISE → kein Rollback)
 *   ergebnis P0001 'S112TEST|…'
 *   guard    'S112GUARD|…'
 *   infra    28P01/DbConfigConnectTempRoleError, HTTP 401/429/5xx, Zeitüberschreitung → Wiederholung
 *   sql      alles andere (echter Fehler; Meldung samt CONTEXT)
 *   cli      die CLI ließ sich nicht starten (npx/supabase fehlt) – Abbruch
 */
export function auswerten(roh) {
  const { stdout = '', stderr = '', error, signal, status } = roh ?? {}
  const stderrRein = String(stderr).split(/\r?\n/).filter(z => z.trim() && !/^Initialising login role/.test(z.trim())).join('\n')
  if (error && (error.code === 'ETIMEDOUT' || signal)) return { art: 'infra', grund: `Zeitüberschreitung (${TIMEOUT_MS / 1000} s)` }
  if (error) return { art: 'cli', meldung: `CLI nicht startbar: ${error.message}` }
  const text = String(stdout).trim()
  let j
  try { j = JSON.parse(text) } catch {
    const k = text.search(/[[{]/)
    if (k >= 0) { try { j = JSON.parse(text.slice(k)) } catch { /* bleibt undefined */ } }
  }
  if (j === undefined) {
    // Exit-Status 0 ohne erkennbares Fehler-JSON: die CLI hat das SQL fehlerfrei ausgeführt (z. B. eine andere
    // CLI-Version, die bei einem DO-Block nichts ausgibt). Für eine Testdatei heißt das „endete ohne RAISE“ →
    // wie Zeilen behandeln (ALARM, Exit 3), nie als Infrastruktur wiederholen.
    if (status === 0) return { art: 'zeilen', zeilen: [], hinweis: `Exit-Status 0 ohne JSON-Antwort (stdout ${text.length} Zeichen)` }
    const alles = `${text}\n${stderrRein}`
    if (/28P01|ConnectTempRole/i.test(alles) || /unexpected status (401|429|5\d\d)/.test(alles)) return { art: 'infra', grund: alles.trim().slice(0, 300) }
    const kennung = `Exit-Status ${roh?.status ?? '–'}, stdout ${text.length} Zeichen, stderr ${String(stderr).length} Zeichen`
    // Leere Antwort (höchstens npm-Hinweise und die Login-Zeile) ohne SQL-Fehlertext ist praktisch immer
    // Infrastruktur (abgebrochener CLI-Prozess, Konkurrenz um cli_login_postgres …) → Wiederholung statt
    // „echter SQL-Fehler“. Eine Meldung der CLI (z. B. fehlendes Zugangs-Token) bleibt ein echter Fehler.
    const inhalt = alles.split(/\r?\n/).filter(z => z.trim() && !/^npm (notice|warn)\b/i.test(z.trim())).join('\n')
    if (!inhalt.trim() && !/\bERROR:|\bSQLSTATE\b/.test(alles)) {
      return { art: 'infra', grund: `keine JSON-Antwort und kein SQL-Fehlertext (${kennung}): ${alles.trim().slice(0, 200) || '(leer)'}` }
    }
    return { art: 'sql', meldung: `keine JSON-Antwort der CLI (${kennung}): ${alles.trim().slice(0, 1000)}` }
  }
  if (Array.isArray(j)) return { art: 'zeilen', zeilen: j }
  if (j && Array.isArray(j.rows)) return { art: 'zeilen', zeilen: j.rows }
  const code = j?.error?.code ?? j?.code ?? ''
  const nachricht = j?.error?.message ?? (typeof j?.message === 'string' ? j.message : JSON.stringify(j))
  const st = /unexpected status (\d+):\s*/.exec(nachricht)
  const http = st ? Number(st[1]) : null
  let m = nachricht
  if (st) {
    const rest = nachricht.slice(st.index + st[0].length)
    try { const inner = JSON.parse(rest); m = typeof inner?.message === 'string' ? inner.message : rest } catch { m = rest }
  }
  if (/ConnectTempRole/i.test(code) || /28P01/.test(m) || (http !== null && (http === 401 || http === 429 || http >= 500))) {
    return { art: 'infra', grund: `${code || 'HTTP ' + http}: ${m.slice(0, 300)}`, http }
  }
  const erste = m.split('\n')[0]
  const mm = /ERROR:\s+([0-9A-Z]{5}):\s?(.*)$/.exec(erste)
  const sqlstate = mm?.[1] ?? null
  const inhalt = mm ? mm[2] : erste
  if (inhalt.startsWith('S112GUARD|')) return { art: 'guard', meldung: inhalt, sqlstate }
  if (sqlstate === 'P0001' && inhalt.startsWith('S112TEST|')) return { art: 'ergebnis', zeile: inhalt, http }
  return { art: 'sql', sqlstate, meldung: m.trim(), http, code }
}

/** 'S112TEST|<datei>|ok=<n>|fehler=<m>|bekannt=<k>|dauer_ms=… ; mutation=… ; FEHLER:… ; BEKANNT:… ; OK:…' */
export function parseErgebnis(zeile) {
  const teile = String(zeile).split('|')
  if (teile.length < 6 || teile[0] !== 'S112TEST') return null
  const zahl = (t, k) => { const m = new RegExp(`^${k}=(\\d+)$`).exec(t ?? ''); return m ? Number(m[1]) : NaN }
  const ok = zahl(teile[2], 'ok'), fehler = zahl(teile[3], 'fehler'), bekannt = zahl(teile[4], 'bekannt')
  if ([ok, fehler, bekannt].some(Number.isNaN)) return null
  const eintraege = teile.slice(5).join('|').split(' ; ').map(s => s.trim()).filter(Boolean)
  const meta = k => eintraege.find(e => e.startsWith(k + '='))?.slice(k.length + 1) ?? null
  const fehlerEintraege = eintraege.filter(e => e.startsWith('FEHLER:')).map(e => e.slice(7))
  const bekanntEintraege = eintraege.filter(e => e.startsWith('BEKANNT:')).map(e => {
    const b = /^(.*?)(?: \[(.*)\])?$/s.exec(e.slice(8))
    return { titel: b[1].trim(), beleg: b[2] ?? '' }
  })
  return {
    datei: teile[1], ok, fehler, bekannt,
    dauerMs: Number(meta('dauer_ms')) || 0,
    mutation: meta('mutation'),
    fehlerEintraege,
    fehlerNamen: fehlerEintraege.map(e => e.split(' ')[0]),
    bekanntEintraege,
    okNamen: eintraege.filter(e => e.startsWith('OK:')).map(e => e.slice(3)),
    gekuerzt: eintraege.find(e => e.startsWith('GEKUERZT:'))?.slice(9) ?? null,
  }
}

/** Mutation getötet? fehler ≥ 1, ein FEHLER-Name passt aufs Muster, mutation=<name> belegt die Anwendung. */
export function bewerteMutation(erg, mutation) {
  if (!erg) return { getoetet: false, grund: 'kein Ergebnis' }
  if (erg.mutation !== mutation.name) return { getoetet: false, grund: `nicht angewendet (mutation=${erg.mutation ?? 'fehlt'})` }
  if (!(erg.fehler >= 1)) return { getoetet: false, grund: 'überlebt: keine Prüfung schlug an' }
  const re = new RegExp(`^(?:${mutation.rot})$`)
  const treffer = erg.fehlerNamen.filter(n => re.test(n))
  if (!treffer.length) return { getoetet: false, grund: `überlebt: kein FEHLER passt auf „${mutation.rot}“ (rot: ${erg.fehlerNamen.join(', ') || '–'})` }
  return { getoetet: true, treffer }
}

/** Bekannte Lücken über alle Dateien deduplizieren (Titel = Schlüssel). */
export function bekannteLuecken(ergebnisse) {
  const karte = new Map()
  for (const { datei, erg } of ergebnisse) {
    for (const b of erg?.bekanntEintraege ?? []) {
      if (!karte.has(b.titel)) karte.set(b.titel, { titel: b.titel, belege: [] })
      const e = karte.get(b.titel)
      const beleg = `${datei}${b.beleg ? ': ' + b.beleg : ''}`
      if (!e.belege.includes(beleg)) e.belege.push(beleg)
    }
  }
  return [...karte.values()].sort((a, b) => a.titel.localeCompare(b.titel, 'de'))
}

// ── Optionen ───────────────────────────────────────────────────────────────────────────────────────────

/** IANA-Zeitzonenname (Europe/Vienna, Etc/GMT+12, UTC) – landet in einem SQL-String, daher eng. */
export const ZEITZONE_RE = /^[A-Za-z][A-Za-z0-9_]*(\/[A-Za-z0-9_+-]+){0,2}$/

export function parseOptionen(argv) {
  const opt = { nur: null, mutationen: false, mutationDatei: null, ausfuehrlich: false, streng: false, liste: false, json: null, zeitzone: null, hilfe: false }
  for (const a of argv) if (String(a).includes(PROD_REF)) throw new Error('ABBRUCH: Argument enthält die Produktions-Ref')
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const wert = () => { const w = argv[++i]; if (w === undefined || w.startsWith('--')) throw new Error(`${a} braucht einen Wert`); return w }
    if (a === '--nur') opt.nur = wert().split(',').map(s => s.trim()).filter(Boolean)
    else if (a === '--mutationen') { opt.mutationen = true; if (argv[i + 1] && !argv[i + 1].startsWith('--')) opt.mutationDatei = argv[++i] }
    else if (a === '--ausfuehrlich') opt.ausfuehrlich = true
    else if (a === '--streng') opt.streng = true
    else if (a === '--liste') opt.liste = true
    else if (a === '--json') opt.json = wert()
    else if (a === '--zeitzone') { opt.zeitzone = wert(); if (!ZEITZONE_RE.test(opt.zeitzone)) throw new Error(`--zeitzone: „${opt.zeitzone}“ ist kein Zeitzonenname (z. B. Etc/GMT+12)`) }
    else if (a === '--hilfe' || a === '-h' || a === '--help') opt.hilfe = true
    else throw new Error(`unbekannte Option: ${a} (--nur, --mutationen [datei], --ausfuehrlich, --streng, --liste, --json <pfad>, --zeitzone <IANA>)`)
  }
  return opt
}

/** passt „10“, „10_mandanten“ oder „10_mandanten.sql“ auf eine Datei? */
function passt(datei, filter) {
  return filter.some(f => datei === f || datei === `${f}.sql` || datei.startsWith(`${f}_`))
}

// ── Ablauf ─────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Hauptablauf. umgebung: { cli(sql, name) → roh, version() → text, log(text), sleep(ms) }.
 * opt.verzeichnis (nur für Unit-Tests): anderes Testverzeichnis.
 * → { exit, bericht }
 */
export function lauf(opt, umgebung) {
  const { log } = umgebung
  const dir = opt.verzeichnis ?? TEST_DIR
  const bericht = { beginn: new Date().toISOString(), cliVersion: null, dateien: [], mutationen: [], bekannt: [], exit: null, meldungen: [] }
  const ende = (exit, meldung) => {
    if (meldung) { log(meldung); bericht.meldungen.push(meldung) }
    bericht.bekannt = bekannteLuecken(bericht.dateien.filter(d => d.erg).map(d => ({ datei: d.datei, erg: d.erg })))
    ausgabe(bericht, opt, log)
    bericht.exit = exit
    log(`\nErgebnis: ${exit === 0 ? 'grün' : 'rot'} (Exit ${exit})`)
    return { exit, bericht }
  }

  // Dateien und statische Prüfung
  const helfer = fs.readFileSync(path.join(dir, HELFER_NAME), 'utf8')
  const helferFehler = pruefeHelfer(helfer)
  if (helferFehler.length) return ende(EXIT.ECHTER_FEHLER, `✗ _helfer.sql ist fehlerhaft:\n  ${helferFehler.join('\n  ')}`)
  const prodIds = prodBetriebe(helfer)
  const alle = fs.readdirSync(dir).filter(n => DATEI_RE.test(n)).sort()
  const falsch = fs.readdirSync(dir).filter(n => n.endsWith('.sql') && n !== HELFER_NAME && !DATEI_RE.test(n))
  if (falsch.length) return ende(EXIT.ECHTER_FEHLER, `✗ SQL-Dateien mit unzulässigem Namen (NN_<bereich>.sql): ${falsch.join(', ')}`)
  if (alle[0] !== RAHMEN_NAME) return ende(EXIT.ECHTER_FEHLER, `✗ ${RAHMEN_NAME} fehlt – ohne Rahmentest läuft nichts`)
  const filter = opt.mutationDatei ? [opt.mutationDatei] : opt.nur
  let auswahl = filter ? alle.filter(n => passt(n, filter)) : alle
  if (filter && !auswahl.length) return ende(EXIT.ECHTER_FEHLER, `✗ keine Datei passt auf ${filter.join(', ')} (vorhanden: ${alle.join(', ')})`)
  const dateien = [RAHMEN_NAME, ...auswahl.filter(n => n !== RAHMEN_NAME)]
  const inhalt = Object.fromEntries(dateien.map(n => [n, fs.readFileSync(path.join(dir, n), 'utf8')]))
  const statisch = Object.fromEntries(dateien.map(n => [n, pruefeTestdatei(n, inhalt[n], prodIds)]))

  if (opt.liste) {
    let fehlerhaft = false
    for (const n of alle) {
      const text = fs.readFileSync(path.join(dir, n), 'utf8')
      const kopf = leseKopf(text)
      const fe = statisch[n] ?? pruefeTestdatei(n, text, prodIds)
      fehlerhaft ||= fe.length > 0
      log(`${fe.length ? '✗' : '✓'} ${n} – ${kopf.bereich ?? '(ohne @bereich)'}`)
      if (kopf.ziel) log(`    Ziel: ${kopf.ziel}`)
      for (const m of kopf.mutationen) log(`    Mutation ${m.name}: ${m.beschreibung} | rot: ${m.rot}`)
      for (const x of fe) log(`    ✗ ${x}`)
    }
    log(`\n${alle.length} Datei(en), keine Datenbank angesprochen.`)
    return { exit: fehlerhaft ? EXIT.ECHTER_FEHLER : EXIT.GRUEN, bericht }
  }

  if (statisch[RAHMEN_NAME].length) return ende(EXIT.ECHTER_FEHLER, `✗ ${RAHMEN_NAME} besteht die statische Prüfung nicht:\n  ${statisch[RAHMEN_NAME].join('\n  ')}`)

  // CLI-Version, Vorprüfung (Identität + Reste)
  bericht.cliVersion = umgebung.version()
  log(`Supabase CLI ${bericht.cliVersion ?? '(Version unbekannt)'} · Ziel Staging ${STAGING_REF} · ${dateien.length} Datei(en)${opt.mutationen ? ' mit Mutationen' : ''}${opt.zeitzone ? ` · Sitzungs-Zeitzone ${opt.zeitzone}` : ''}`)
  const vor = pruefe(umgebung, prodIds, 'vorpruefung')
  if (vor.exit !== null) return ende(vor.exit, vor.meldung)
  log('✓ Vorprüfung: Staging bestätigt (system_identifier, keine Produktions-Betriebe, Staging-Admin), keine Reste')

  let exit = EXIT.GRUEN
  const hebe = e => { exit = Math.max(exit, e) }
  // Abbruch nach dem ersten gesendeten Test (ALARM, Infrastruktur, CLI): die Nachprüfung trotzdem versuchen, damit
  // Reste sofort auffallen und nicht erst im nächsten Lauf. Beim Wächter nicht – das Ziel ist dann nicht Staging.
  const abbrechen = (code, meldung) => {
    log(meldung); bericht.meldungen.push(meldung)
    if (code === EXIT.NICHT_STAGING) return ende(code)
    const nach = pruefe(umgebung, prodIds, 'nachpruefung')
    if (nach.exit !== null) return ende(Math.max(code, nach.exit), nach.meldung)
    log('✓ Nachprüfung nach dem Abbruch: keine S112TEST-Reste auf Staging')
    return ende(code)
  }
  for (const n of dateien) {
    if (statisch[n].length) {
      log(`✗ ${n}: statische Prüfung fehlgeschlagen – nicht gesendet\n  ${statisch[n].join('\n  ')}`)
      bericht.dateien.push({ datei: n, status: 'statisch', meldung: statisch[n] })
      hebe(EXIT.ECHTER_FEHLER)
      continue
    }
    const kopf = leseKopf(inhalt[n])
    const r = einzellauf(umgebung, helfer, n, inhalt[n], null, opt)
    if (r.abbruch !== undefined) return abbrechen(Math.max(exit, r.abbruch), r.meldung)
    bericht.dateien.push(r.eintrag)
    hebe(r.exit)
    if (n === RAHMEN_NAME && r.exit !== EXIT.GRUEN) return ende(exit, `✗ ${RAHMEN_NAME} ist rot – Lauf abgebrochen (der Rahmen selbst ist nicht verlässlich)`)
    if (!opt.mutationen) continue
    if (r.exit !== EXIT.GRUEN) {
      // eine schon rote Datei „erkennt“ jede Mutation – das belegte nichts
      log(`  … ${n}: Mutationen übersprungen, weil der normale Lauf nicht grün ist`)
      for (const m of kopf.mutationen) bericht.mutationen.push({ datei: n, mutation: m.name, getoetet: null, grund: 'übersprungen (normaler Lauf rot)' })
      continue
    }
    for (const mutation of kopf.mutationen) {
      const rm = einzellauf(umgebung, helfer, n, inhalt[n], mutation, opt)
      if (rm.abbruch !== undefined) return abbrechen(Math.max(exit, rm.abbruch), rm.meldung)
      bericht.mutationen.push(rm.eintrag)
      hebe(rm.exit)
    }
  }

  // Nachprüfung: nichts übrig (zweiter, eigener Aufruf belegt das Zurückrollen)
  const nach = pruefe(umgebung, prodIds, 'nachpruefung')
  if (nach.exit !== null) return ende(Math.max(exit, nach.exit), nach.meldung)
  log('✓ Nachprüfung: keine S112TEST-Reste auf Staging')
  if (opt.streng && bericht.dateien.some(d => d.erg?.bekannt > 0)) {
    hebe(EXIT.TESTFEHLER)
    bericht.meldungen.push('--streng: bekannte Lücken zählen als Fehler')
  }
  return ende(exit)
}

/** Identitäts-/Restprüfung → { exit: null | 2 | 3 | 4, meldung } */
function pruefe(umgebung, prodIds, name) {
  const a = mitWiederholung(umgebung, pruefSql(prodIds), name)
  if (a.art !== 'zeilen' || a.zeilen.length !== 1) {
    if (a.art === 'guard') return { exit: EXIT.NICHT_STAGING, meldung: `✗ ${name}: ${a.meldung}` }
    return { exit: EXIT.ECHTER_FEHLER, meldung: `✗ ${name} fehlgeschlagen (${a.art}): ${a.meldung ?? a.grund ?? JSON.stringify(a.zeilen)?.slice(0, 300)}` }
  }
  const b = bewertePruefung(a.zeilen[0])
  if (!b.staging) return { exit: EXIT.NICHT_STAGING, meldung: `✗ ${name}: NICHT Staging – Abbruch ohne Test (${JSON.stringify(a.zeilen[0])})` }
  if (Object.keys(b.reste).length) {
    return { exit: EXIT.KEIN_ROLLBACK, meldung: `✗ ${name}: S112TEST-Reste auf Staging gefunden – wurde etwas nicht zurückgerollt? ${JSON.stringify(b.reste)}` }
  }
  return { exit: null }
}

function mitWiederholung(umgebung, sql, name) {
  let a
  for (let versuch = 1; versuch <= 1 + MAX_WIEDERHOLUNGEN; versuch++) {
    a = auswerten(umgebung.cli(sql, name))
    if (a.art !== 'infra') return a
    if (versuch <= MAX_WIEDERHOLUNGEN) {
      umgebung.log(`  … ${name}: Infrastrukturfehler (${a.grund}) – Wiederholung ${versuch}/${MAX_WIEDERHOLUNGEN} in ${PAUSE_MS / 1000} s`)
      umgebung.sleep(PAUSE_MS)
    }
  }
  return a
}

/** Eine Datei (optional mit Mutation) ausführen und bewerten. */
function einzellauf(umgebung, helfer, n, text, mutation, opt) {
  const basis = n.replace(/\.sql$/, '')
  const kennung = mutation ? `${basis} ⟂ ${mutation.name}` : basis
  let sql
  try {
    sql = zusammensetzen(helfer, text, { mutation: mutation?.name ?? null, ausfuehrlich: opt.ausfuehrlich, zeitzone: opt.zeitzone ?? null })
  } catch (e) {
    umgebung.log(`✗ ${kennung}: ${e.message}`)
    return { exit: EXIT.ECHTER_FEHLER, eintrag: { datei: n, mutation: mutation?.name, status: 'statisch', meldung: e.message } }
  }
  const t0 = Date.now()
  const a = mitWiederholung(umgebung, sql, mutation ? `${basis}__${mutation.name}` : basis)
  const gesamt = ((Date.now() - t0) / 1000).toFixed(1)
  if (a.art === 'zeilen') return { abbruch: EXIT.KEIN_ROLLBACK, meldung: `✗ ALARM ${kennung}: die Datei endete OHNE RAISE – die Transaktion wurde womöglich festgeschrieben (kein Rollback). Lauf gestoppt.` }
  if (a.art === 'guard') return { abbruch: EXIT.NICHT_STAGING, meldung: `✗ ${kennung}: Wächter schlug an – ${a.meldung}. Lauf gestoppt.` }
  if (a.art === 'infra') return { abbruch: EXIT.ECHTER_FEHLER, meldung: `✗ ${kennung}: Infrastrukturfehler nach ${MAX_WIEDERHOLUNGEN} Wiederholungen – ${a.grund}. Lauf gestoppt.` }
  if (a.art === 'cli') return { abbruch: EXIT.ECHTER_FEHLER, meldung: `✗ ${kennung}: ${a.meldung}. Lauf gestoppt.` }
  if (a.art === 'sql') {
    umgebung.log(`✗ ${kennung}: echter SQL-Fehler${a.sqlstate ? ' ' + a.sqlstate : ''} (gesamt ${gesamt} s)\n${einruecken(a.meldung)}`)
    return { exit: EXIT.ECHTER_FEHLER, eintrag: { datei: n, mutation: mutation?.name, status: 'sql', sqlstate: a.sqlstate, meldung: a.meldung } }
  }
  const erg = parseErgebnis(a.zeile)
  if (!erg || erg.datei !== basis) {
    const m = !erg ? `Ergebniszeile unlesbar: ${a.zeile.slice(0, 200)}` : `Ergebnis gehört zu „${erg.datei}“, nicht zu „${basis}“ (c_datei im Test prüfen)`
    umgebung.log(`✗ ${kennung}: ${m}`)
    return { exit: EXIT.ECHTER_FEHLER, eintrag: { datei: n, mutation: mutation?.name, status: 'rahmen', meldung: m } }
  }
  const zeit = `(db ${erg.dauerMs} ms, gesamt ${gesamt} s)`
  if (mutation) {
    const b = bewerteMutation(erg, mutation)
    umgebung.log(`${b.getoetet ? '✓' : '✗'} ${kennung}: ${b.getoetet ? `erkannt (${b.treffer.join(', ')})` : b.grund} ${zeit}`)
    return { exit: b.getoetet ? EXIT.GRUEN : EXIT.TESTFEHLER, eintrag: { datei: n, mutation: mutation.name, getoetet: b.getoetet, grund: b.grund ?? null, treffer: b.treffer ?? [], erg } }
  }
  const gruen = erg.fehler === 0
  umgebung.log(`${gruen ? '✓' : '✗'} ${basis} ok=${erg.ok} fehler=${erg.fehler} bekannt=${erg.bekannt} ${zeit}${erg.mutation && erg.mutation !== '-' ? ` mutation=${erg.mutation}` : ''}`)
  if (opt.ausfuehrlich) for (const o of erg.okNamen) umgebung.log(`    OK ${o}`)
  if (erg.gekuerzt) umgebung.log(`    (Ergebnis gekürzt: ${erg.gekuerzt})`)
  return { exit: gruen ? EXIT.GRUEN : EXIT.TESTFEHLER, eintrag: { datei: n, status: gruen ? 'gruen' : 'rot', erg, gesamtS: Number(gesamt) } }
}

function einruecken(t) { return String(t ?? '').split('\n').map(z => '    ' + z).join('\n') }

function ausgabe(bericht, opt, log) {
  const fehler = bericht.dateien.flatMap(d => (d.erg?.fehlerEintraege ?? []).map(e => `${d.datei}: ${e}`))
  if (fehler.length) {
    log(`\nFehler (${fehler.length}):`)
    for (const f of fehler) log(`  ✗ ${f}`)
  }
  const ueberlebt = bericht.mutationen.filter(m => m.getoetet === false)
  const uebersprungen = bericht.mutationen.filter(m => m.getoetet === null)
  if (bericht.mutationen.length) {
    log(`\nMutationen: ${bericht.mutationen.filter(m => m.getoetet).length}/${bericht.mutationen.length} erkannt`
      + (ueberlebt.length ? `, überlebt: ${ueberlebt.map(m => `${m.datei} ⟂ ${m.mutation}`).join(', ')}` : '')
      + (uebersprungen.length ? `, übersprungen (Datei rot): ${uebersprungen.map(m => `${m.datei} ⟂ ${m.mutation}`).join(', ')}` : ''))
  }
  log(`\nBekannte Lücken (${bericht.bekannt.length})${opt.streng ? ' – zählen mit --streng als Fehler' : ''}:`)
  if (!bericht.bekannt.length) log('  keine')
  for (const b of bericht.bekannt) {
    log(`  • ${b.titel}`)
    for (const beleg of b.belege) log(`      ${beleg}`)
  }
}

// ── Echte Umgebung ─────────────────────────────────────────────────────────────────────────────────────

export function echteUmgebung() {
  const workdir = fs.mkdtempSync(path.join(os.tmpdir(), 's112-db-tests-'))
  fs.mkdirSync(path.join(workdir, 'supabase'))
  let nr = 0
  return {
    workdir,
    cli(sql, name) {
      if (!NAME_RE.test(name)) throw new Error(`Dateiname unzulässig: ${name}`)
      const datei = path.join(workdir, `${String(++nr).padStart(3, '0')}_${name}.sql`)
      fs.writeFileSync(datei, sql, 'utf8')
      return starteNpx(baueCliArgs(workdir, datei), workdir)
    },
    version() {
      const r = starteNpx(['supabase', '--version'], workdir)
      return r.status === 0 ? String(r.stdout).trim().split(/\r?\n/).pop() : null
    },
    log: t => console.log(t),
    sleep: ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms),
    aufraeumen() { fs.rmSync(workdir, { recursive: true, force: true }) },
  }
}

export function main(argv) {
  let opt
  try { opt = parseOptionen(argv) } catch (e) { console.error(`✗ ${e.message}`); return EXIT.ECHTER_FEHLER }
  if (opt.hilfe) {
    console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0].replace(/^#!.*\n\/\*\*?/, '').replace(/^ \* ?/gm, ''))
    return EXIT.GRUEN
  }
  const umgebung = echteUmgebung()
  const weg = () => { try { umgebung.aufraeumen() } catch { /* bereits weg */ } }
  process.on('SIGINT', () => { weg(); process.exit(130) })
  try {
    const { exit, bericht } = lauf(opt, umgebung)
    if (opt.json) fs.writeFileSync(opt.json, JSON.stringify(bericht, null, 2), 'utf8')
    return exit
  } catch (e) {
    console.error(`✗ ${e.stack ?? e.message}`)
    return EXIT.ECHTER_FEHLER
  } finally {
    weg()
  }
}

const hier = fileURLToPath(import.meta.url)
const aufgerufen = process.argv[1] ? path.resolve(process.argv[1]) : ''
if (aufgerufen && (process.platform === 'win32' ? aufgerufen.toLowerCase() === hier.toLowerCase() : aufgerufen === hier)) {
  process.exitCode = main(process.argv.slice(2))
}
