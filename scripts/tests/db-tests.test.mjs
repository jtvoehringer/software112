// Tests für den Runner der SQL-Testsuite scripts/db-tests/run.mjs – OHNE Datenbank und ohne Netzwerk.
// Die SQL-Tests selbst laufen nur mit `npm run test:db` gegen Staging (braucht einen Supabase-Login).
//
// Geprüft werden: Produktionsschutz (Konstanten, CLI-Argumente, Umgebung, statische Regel „Produktions-IDs
// nur im Wächter“), die statische Prüfung der Testdateien (echte Dateien grün, typische Fehler rot), die
// Auswertung der CLI-Antworten, Ergebniszeile, Mutationen und bekannte Lücken sowie der ganze Ablauf mit
// einer Attrappe statt der CLI (Exit-Codes 0–4, Abbruch bei rotem 00, Wiederholung bei Infrastrukturfehlern).
//
// Aufruf:  npm run -s test:csv   (alle scripts/tests/*.test.mjs)
//          bzw. node --test scripts/tests/db-tests.test.mjs
//
// Diese Datei liegt unter scripts/ und wird von scripts/check-replica.js mitgeprüft – die dort verbotenen
// Wörter werden deshalb zusammengesetzt. Produktions-Ref und Produktions-Betriebs-IDs stehen hier nie im
// Klartext (Ref aus run.mjs, IDs aus dem Wächter in _helfer.sql).

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, mkdtempSync, writeFileSync, copyFileSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  STAGING_REF, STAGING_SYSID, PROD_REF, EXIT, TEST_DIR, MAX_WIEDERHOLUNGEN, PAUSE_MS,
  segmente, anweisungen, leseKopf, pruefeVerboten, pruefeHelfer, prodBetriebe, pruefeTestdatei, zusammensetzen,
  pruefSql, REST_SPALTEN, bewertePruefung, baueCliArgs, pruefeKeineProduktion, cliUmgebung, auswerten, parseErgebnis,
  bewerteMutation, bekannteLuecken, parseOptionen, lauf,
} from '../db-tests/run.mjs'

const HIER = path.dirname(fileURLToPath(import.meta.url))
const DB_DIR = path.resolve(HIER, '..', 'db-tests')
const HELFER = readFileSync(path.join(DB_DIR, '_helfer.sql'), 'utf8')
const PROD_IDS = prodBetriebe(HELFER)
const SRR = ['session', 'replication', 'role'].join('_')
const DT = 'DISABLE' + ' TRIGGER'

// ── Bausteine ──────────────────────────────────────────────────────────────────────────────────────────

/** Minimale gültige Testdatei (besteht pruefeTestdatei). */
function testDatei(name, { rumpf = '', kopf = null, declare = '' } = {}) {
  return `${kopf ?? `-- @bereich: Beispiel
-- @ziel: synthetische Datei für die Runner-Tests
-- @mutation m_eins: erste Mutation | rot: pruefung_a
-- @mutation m_zwei: zweite Mutation | rot: pruefung_b|pruefung_c`}
CREATE FUNCTION pg_temp.t_hilfe() RETURNS int LANGUAGE sql AS $f$ SELECT 1 $f$;

DO $test$
DECLARE
  c_datei constant text := '${name}';
  v_t0    timestamptz := clock_timestamp();
  v_erg   text[] := '{}';
  v_id    uuid := gen_random_uuid();
  v_n     numeric(10,2);${declare}
BEGIN
  PERFORM pg_temp.s112_nur_staging();
  PERFORM pg_temp.s112_mutiere('m_eins', $m$CREATE POLICY s112test_x ON public.kontakte FOR SELECT TO authenticated USING (true)$m$);
  PERFORM pg_temp.s112_mutiere('m_zwei', 'SELECT 1; SELECT 2');
  -- ein Kommentar mit ; und 'Anführungszeichen'
  v_erg := v_erg || pg_temp.s112_erwarte('pruefung_a', 'x;y', 'x;y');${rumpf}
  PERFORM pg_temp.s112_ende(c_datei, v_erg, v_t0, 1);
END
$test$;
`
}

const fehlerIn = (name, text) => pruefeTestdatei(name, text, PROD_IDS)
const einFehler = (text, re, name = '10_beispiel.sql') => {
  const f = fehlerIn(name, text)
  assert.ok(f.some(x => re.test(x)), `erwartet ${re}, gefunden:\n${f.join('\n') || '(keine Fehler)'}`)
}

const LOGIN = 'Initialising login role...\n'
const antwortFehler = (text, status = 400) => ({
  status: 1, stderr: LOGIN,
  stdout: JSON.stringify({ _tag: 'Error', error: { code: 'DbQueryUnexpectedStatusError', message: `unexpected status ${status}: ${JSON.stringify({ message: `Failed to run sql query: ERROR:  ${text}\nCONTEXT:  PL/pgSQL function inline_code_block line 9 at RAISE\n` })}` } }),
})
const antwortErgebnis = (datei, { ok = 5, fehler = [], bekannt = [], mutation = '-' } = {}) =>
  antwortFehler(`P0001: S112TEST|${datei}|ok=${ok}|fehler=${fehler.length}|bekannt=${bekannt.length}|dauer_ms=12 ; mutation=${mutation}`
    + fehler.map(f => ` ; FEHLER:${f}`).join('') + bekannt.map(b => ` ; BEKANNT:${b}`).join(''))
const antwortZeilen = zeilen => ({ status: 0, stdout: JSON.stringify(zeilen), stderr: LOGIN })
const pruefZeile = (x = {}) => antwortZeilen([{
  sysid_ok: true, keine_prod_betriebe: true, staging_admin: true, rest_betriebe: 0, rest_benutzer: 0, rest_faktoren: 0,
  rest_storage: 0, rest_kontakte: 0, rest_funktionen: 0, rest_policies: 0,
  rest_relationen: 0, rest_public_funktionen: 0, rest_plattform_admins: 0, rest_rechte: 0, ...x,
}])

/** Testverzeichnis mit echtem _helfer.sql/00_rahmen.sql und synthetischen Dateien. */
function testVerzeichnis(dateien = { '10_beispiel.sql': testDatei('10_beispiel') }) {
  const dir = mkdtempSync(path.join(tmpdir(), 's112-db-runner-test-'))
  copyFileSync(path.join(DB_DIR, '_helfer.sql'), path.join(dir, '_helfer.sql'))
  copyFileSync(path.join(DB_DIR, '00_rahmen.sql'), path.join(dir, '00_rahmen.sql'))
  for (const [n, t] of Object.entries(dateien)) writeFileSync(path.join(dir, n), t)
  return dir
}

/** Attrappe der CLI: antworten[name] = Antwort oder Liste (nacheinander) oder Funktion(sql). */
function attrappe(antworten) {
  const aufrufe = [], logs = [], pausen = []
  const zaehler = {}
  return {
    aufrufe, logs, pausen,
    umgebung: {
      cli(sql, name) {
        aufrufe.push({ name, sql })
        let a = antworten[name] ?? antworten[name.replace(/__.*$/, '') + '__*']
        if (typeof a === 'function') return a(sql)
        if (Array.isArray(a)) { const i = zaehler[name] = (zaehler[name] ?? -1) + 1; a = a[Math.min(i, a.length - 1)] }
        if (!a) throw new Error(`Attrappe: keine Antwort für ${name}`)
        return a
      },
      version: () => '2.118.0',
      log: t => logs.push(String(t)),
      sleep: ms => pausen.push(ms),
    },
  }
}

function mitVerzeichnis(dateien, antworten, opt = {}) {
  const dir = testVerzeichnis(dateien)
  try {
    const a = attrappe(antworten)
    const r = lauf({ nur: null, mutationen: false, mutationDatei: null, ausfuehrlich: false, streng: false, liste: false, json: null, ...opt, verzeichnis: dir }, a.umgebung)
    return { ...r, ...a, text: a.logs.join('\n') }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

const GRUEN = {
  vorpruefung: pruefZeile(), nachpruefung: pruefZeile(),
  '00_rahmen': antwortErgebnis('00_rahmen', { ok: 108 }),
  '10_beispiel': antwortErgebnis('10_beispiel'),
}

// ── Produktionsschutz ──────────────────────────────────────────────────────────────────────────────────

describe('Produktionsschutz', () => {
  test('Konstanten: Staging-Ref, Staging-system_identifier, Produktions-Ref verschieden', () => {
    assert.equal(STAGING_REF, 'sjpeghrlhsowmquacjhb')
    assert.equal(STAGING_SYSID, '7678069749886157684')
    assert.match(PROD_REF, /^[a-z]{20}$/)
    assert.notEqual(PROD_REF, STAGING_REF)
  })

  test('CLI-Argumente: fest auf Staging, eigenes --workdir, JSON ohne Agent-Erkennung', () => {
    const args = baueCliArgs(path.join(tmpdir(), 's112-db-tests-abc'), path.join(tmpdir(), 's112-db-tests-abc', '001_x.sql'))
    assert.deepEqual(args.slice(0, 3), ['supabase', 'db', 'query'])
    assert.equal(args[args.indexOf('--project-ref') + 1], STAGING_REF)
    assert.ok(args.includes('--linked'))
    assert.equal(args[args.indexOf('--workdir') + 1], path.join(tmpdir(), 's112-db-tests-abc'))
    assert.equal(args[args.indexOf('--agent') + 1], 'no')
    assert.equal(args[args.indexOf('--output-format') + 1], 'json')
    assert.ok(args.includes('--yes'), 'CLI ab 3.1 bricht ohne Bestätigung ab')
    assert.ok(!args.join(' ').includes(PROD_REF))
  })

  test('Befehlszeile mit Produktions-Ref oder ohne Staging-Ref bricht ab', () => {
    assert.throws(() => baueCliArgs(path.join(tmpdir(), PROD_REF), 'x.sql'), /Produktions-Ref/)
    assert.throws(() => pruefeKeineProduktion(['supabase', 'db', 'query', '--linked', '-f', 'x.sql']), /nicht Staging/)
    assert.throws(() => pruefeKeineProduktion(['supabase', 'db', 'query', '--project-ref', 'aaaaaaaaaaaaaaaaaaaa']), /nicht Staging/)
    assert.ok(pruefeKeineProduktion(['supabase', '--version']))
  })

  test('keine Option ändert die Ref; Argumente mit Produktions-Ref brechen ab', () => {
    assert.throws(() => parseOptionen(['--project-ref', STAGING_REF]), /unbekannte Option/)
    assert.throws(() => parseOptionen(['--nur', PROD_REF]), /Produktions-Ref/)
    assert.throws(() => parseOptionen(['--json', `x-${PROD_REF}.json`]), /Produktions-Ref/)
    assert.deepEqual(parseOptionen(['--nur', '10,11', '--streng', '--ausfuehrlich', '--json', 'x.json']),
      { nur: ['10', '11'], mutationen: false, mutationDatei: null, ausfuehrlich: true, streng: true, liste: false, json: 'x.json', zeitzone: null, hilfe: false })
    assert.deepEqual(parseOptionen(['--mutationen', '10']).mutationDatei, '10')
    assert.deepEqual(parseOptionen(['--mutationen', '--liste']).mutationDatei, null)
    assert.throws(() => parseOptionen(['--json']), /braucht einen Wert/)
    assert.equal(parseOptionen(['--zeitzone', 'Etc/GMT+12']).zeitzone, 'Etc/GMT+12')
    assert.equal(parseOptionen(['--zeitzone', 'America/Argentina/Buenos_Aires']).zeitzone, 'America/Argentina/Buenos_Aires')
    assert.throws(() => parseOptionen(['--zeitzone', "UTC'; SELECT 1; --"]), /kein Zeitzonenname/)
    assert.throws(() => parseOptionen(['--zeitzone']), /braucht einen Wert/)
  })

  test('CLI-Umgebung ohne SUPABASE_*-Variablen außer dem Zugangstoken', () => {
    const env = cliUmgebung({ PATH: '/bin', SUPABASE_ACCESS_TOKEN: 't', SUPABASE_PROJECT_REF: PROD_REF, SUPABASE_WORKDIR: '/x', supabase_db_url: 'u' })
    assert.deepEqual(env, { PATH: '/bin', SUPABASE_ACCESS_TOKEN: 't' })
  })

  test('Wächter in _helfer.sql: genau drei Produktions-Betriebe, Staging-sysid, Staging-Admin', () => {
    assert.equal(PROD_IDS.length, 3)
    assert.equal(new Set(PROD_IDS).size, 3)
    assert.ok(HELFER.includes(`c_staging_sysid constant text := '${STAGING_SYSID}'`))
    assert.match(HELFER, /u\.email = 'admin@software112\.test'/)
    assert.throws(() => prodBetriebe(HELFER.replace(PROD_IDS[2], 'keine-id')), /genau 3/)
  })

  test('Produktions-Ref und -Betriebs-IDs stehen nur im Wächter (_helfer.sql); run.mjs nennt nur die Ref', () => {
    const dateien = readdirSync(DB_DIR).filter(n => n !== '_helfer.sql')
    assert.ok(dateien.includes('run.mjs') && dateien.includes('README.md'))
    for (const n of dateien) {
      const t = readFileSync(path.join(DB_DIR, n), 'utf8').toLowerCase()
      for (const id of PROD_IDS) assert.ok(!t.includes(id), `${n} enthält die Produktions-Betriebs-ID ${id}`)
      if (n !== 'run.mjs') assert.ok(!t.includes(PROD_REF), `${n} enthält die Produktions-Ref`)
    }
    const selbst = readFileSync(fileURLToPath(import.meta.url), 'utf8').toLowerCase()
    for (const id of PROD_IDS) assert.ok(!selbst.includes(id))
    assert.ok(!selbst.includes(PROD_REF))
    // die Vorprüfung bekommt die IDs zur Laufzeit aus dem Wächter
    const sql = pruefSql(PROD_IDS)
    for (const id of PROD_IDS) assert.ok(sql.includes(`'${id}'`))
    assert.ok(sql.includes(`= '${STAGING_SYSID}' AS sysid_ok`))
  })

  test('Vorprüfung: nur drei wahre Merkmale gelten als Staging; Reste werden gemeldet', () => {
    const ok = { sysid_ok: true, keine_prod_betriebe: true, staging_admin: true, rest_betriebe: 0, rest_benutzer: 0, rest_faktoren: 0, rest_storage: 0, rest_kontakte: 0, rest_funktionen: 0, rest_policies: 0, rest_relationen: 0, rest_public_funktionen: 0, rest_plattform_admins: 0, rest_rechte: 0 }
    assert.deepEqual(bewertePruefung(ok), { staging: true, reste: {} })
    for (const k of ['sysid_ok', 'keine_prod_betriebe', 'staging_admin']) {
      assert.equal(bewertePruefung({ ...ok, [k]: false }).staging, false, k)
      assert.equal(bewertePruefung({ ...ok, [k]: null }).staging, false, k)
    }
    assert.deepEqual(bewertePruefung({ ...ok, rest_benutzer: 2 }).reste, { rest_benutzer: 2 })
    assert.deepEqual(bewertePruefung({ ...ok, rest_policies: undefined }).reste, { rest_policies: 'fehlt' })
  })

  test('Restprüfung: jede rest_*-Spalte der Abfrage schlägt bei einem Wert ungleich 0 an', () => {
    const spalten = [...pruefSql(['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', '44444444-4444-4444-8444-444444444444'])
      .matchAll(/\bAS\s+(rest_[a-z_]+)\b/g)].map(m => m[1])
    assert.ok(spalten.length >= 11, spalten.join(', '))
    assert.deepEqual([...REST_SPALTEN], spalten)
    for (const k of ['rest_relationen', 'rest_public_funktionen', 'rest_plattform_admins', 'rest_rechte']) assert.ok(spalten.includes(k), k)
    const ok = { sysid_ok: true, keine_prod_betriebe: true, staging_admin: true, ...Object.fromEntries(spalten.map(k => [k, 0])) }
    assert.deepEqual(bewertePruefung(ok).reste, {})
    for (const k of spalten) {
      assert.deepEqual(bewertePruefung({ ...ok, [k]: 3 }).reste, { [k]: 3 }, k)
      assert.deepEqual(bewertePruefung({ ...ok, [k]: '1' }).reste, { [k]: '1' }, k)
      assert.deepEqual(bewertePruefung({ ...ok, [k]: undefined }).reste, { [k]: 'fehlt' }, k)
    }
  })
})

// ── Statische Prüfung ──────────────────────────────────────────────────────────────────────────────────

describe('statische Prüfung', () => {
  test('echte Dateien: _helfer.sql und alle NN_*.sql bestehen', () => {
    assert.deepEqual(pruefeHelfer(HELFER), [])
    const tests = readdirSync(DB_DIR).filter(n => /^\d\d_.*\.sql$/.test(n))
    assert.ok(tests.includes('00_rahmen.sql'))
    for (const n of tests) assert.deepEqual(fehlerIn(n, readFileSync(path.join(DB_DIR, n), 'utf8')), [], n)
  })

  test('00_rahmen deklariert mindestens zwei Mutationen mit gültigem Muster', () => {
    const k = leseKopf(readFileSync(path.join(DB_DIR, '00_rahmen.sql'), 'utf8'))
    assert.equal(k.bereich, 'Rahmen')
    assert.ok(k.mutationen.length >= 2)
    assert.deepEqual(k.fehler, [])
  })

  test('synthetische gültige Datei besteht', () => {
    assert.deepEqual(fehlerIn('10_beispiel.sql', testDatei('10_beispiel')), [])
  })

  test('Zerlegung: ; in Strings, Kommentaren und Dollar-Quotes trennt nicht', () => {
    const a = anweisungen(`CREATE FUNCTION pg_temp.a() RETURNS text LANGUAGE sql AS $f$ SELECT 'x;y' $f$; -- ; kommentar
      /* ; /* verschachtelt ; */ */ DO $test$ BEGIN PERFORM 1; END $test$;`)
    assert.equal(a.length, 2)
    assert.match(a[1].code, /^DO \$test\$\$test\$$/)
    const s = segmente(`SELECT E'a\\'b;' , $x$ $y$ ; $y$ $x$`)
    assert.deepEqual(s.map(g => g.art), ['code', 'string', 'code', 'dollar'])
  })

  test('oberste Ebene: nur CREATE FUNCTION pg_temp.* und genau ein DO $test$ am Ende', () => {
    einFehler(testDatei('10_beispiel') + '\nSELECT 1;\n', /nur CREATE FUNCTION pg_temp\.\* und ein DO \$test\$|letzte Anweisung/)
    einFehler(testDatei('10_beispiel') + testDatei('10_beispiel').replace(/^[\s\S]*?(DO \$test\$)/, '$1'), /genau ein DO \$test\$/)
    einFehler(testDatei('10_beispiel').replace('DO $test$', 'DO $$').replace('END\n$test$;', 'END\n$$;'), /genau ein DO \$test\$/)
    einFehler(testDatei('10_beispiel').replace('CREATE FUNCTION pg_temp.t_hilfe()', 'CREATE FUNCTION public.t_hilfe()'), /nur CREATE FUNCTION pg_temp/)
    einFehler(testDatei('10_beispiel').replace('pg_temp.t_hilfe()', 'pg_temp.s112_ende2()'), /Präfix s112_/)
    einFehler(testDatei('10_beispiel').replace('END\n$test$;', 'END\n'), /nicht geschlossen|genau ein DO/)
  })

  test('Wächter muss die erste, s112_ende die letzte Anweisung sein', () => {
    einFehler(testDatei('10_beispiel').replace('  PERFORM pg_temp.s112_nur_staging();\n', ''), /erste Anweisung/)
    einFehler(testDatei('10_beispiel').replace('  PERFORM pg_temp.s112_nur_staging();\n', '  v_erg := \'{}\';\n  PERFORM pg_temp.s112_nur_staging();\n'), /erste Anweisung/)
    einFehler(testDatei('10_beispiel').replace('  PERFORM pg_temp.s112_ende(c_datei, v_erg, v_t0, 1);\n', ''), /letzte Anweisung/)
    einFehler(testDatei('10_beispiel').replace('  PERFORM pg_temp.s112_ende(c_datei, v_erg, v_t0, 1);\n',
      '  IF true THEN\n    PERFORM pg_temp.s112_ende(c_datei, v_erg, v_t0, 1);\n  END IF;\n'), /letzte Anweisung/)
    einFehler(testDatei('10_beispiel').replace('  PERFORM pg_temp.s112_ende(c_datei, v_erg, v_t0, 1);\n',
      '  PERFORM pg_temp.s112_ende(c_datei, v_erg, v_t0, 1);\nEXCEPTION WHEN OTHERS THEN\n  NULL;\n'), /letzte Anweisung/)
  })

  test('äußerer Block ohne EXCEPTION-Teil: s112_ende im Handler liefe ohne Fehler nie (= COMMIT)', () => {
    // s112_ende als letzte Anweisung, aber im Handler des äußeren Blocks
    einFehler(testDatei('10_beispiel').replace('  PERFORM pg_temp.s112_ende(c_datei, v_erg, v_t0, 1);\n',
      'EXCEPTION WHEN OTHERS THEN\n  NULL;\n  PERFORM pg_temp.s112_ende(c_datei, v_erg, v_t0, 1);\n'), /keinen EXCEPTION-Teil/)
    // s112_ende in einem Unterblock ohne nachfolgenden Aufruf auf Tiefe 1
    einFehler(testDatei('10_beispiel').replace('  PERFORM pg_temp.s112_ende(c_datei, v_erg, v_t0, 1);\n',
      '  BEGIN\n    PERFORM pg_temp.s112_ende(c_datei, v_erg, v_t0, 1);\n  END;\n'), /letzte Anweisung|Tiefe 1/)
    // Unterblöcke mit EXCEPTION, CASE-Ausdrücke, END IF/LOOP/CASE und RAISE EXCEPTION bleiben erlaubt
    assert.deepEqual(fehlerIn('10_beispiel.sql', testDatei('10_beispiel', { rumpf: `
  BEGIN
    RAISE EXCEPTION 'x';
  EXCEPTION WHEN OTHERS THEN
    v_erg := v_erg || (CASE WHEN true THEN 'a' ELSE 'b' END);
  END;
  CASE WHEN true THEN NULL; ELSE NULL; END CASE;
  FOR i IN 1..2 LOOP IF i = 1 THEN NULL; END IF; END LOOP;` })), [])
  })

  test('kein vorzeitiges Blockende: RETURN und Labels verboten (Strings zählen nicht)', () => {
    einFehler(testDatei('10_beispiel', { rumpf: '\n  IF v_erg = \'{}\' THEN RETURN; END IF;' }), /RETURN/)
    einFehler(testDatei('10_beispiel', { rumpf: '\n  <<aussen>> BEGIN EXIT aussen; END;' }), /Labels/)
    assert.deepEqual(fehlerIn('10_beispiel.sql', testDatei('10_beispiel', { rumpf: "\n  PERFORM pg_temp.s112_versuch('SELECT 1 /* RETURN */');" })), [])
  })

  test('DECLARE darf vor dem Wächter nichts ausführen', () => {
    einFehler(testDatei('10_beispiel', { declare: '\n  v_a jsonb := pg_temp.s112_aufbau();' }), /DECLARE ruft pg_temp\.s112_aufbau/)
    einFehler(testDatei('10_beispiel', { declare: "\n  v_nr text := get_next_rechnungsnummer('x');" }), /DECLARE ruft get_next_rechnungsnummer/)
    einFehler(testDatei('10_beispiel', { declare: '\n  v_k bigint := (SELECT count(*) FROM public.kontakte);' }), /DECLARE darf keine Abfragen/)
  })

  test('Transaktionssteuerung und Systembefehle sind verboten – auch in EXECUTE-Strings', () => {
    const faelle = [
      ["EXECUTE 'COMMIT';", /COMMIT/], ['COMMIT;', /COMMIT/], ["EXECUTE 'ROLLBACK';", /ROLLBACK/], ["EXECUTE 'SAVEPOINT a';", /SAVEPOINT/],
      ["EXECUTE 'BEGIN; SELECT 1';", /BEGIN;/], ["EXECUTE 'START TRANSACTION';", /START TRANSACTION/], ["EXECUTE 'END WORK';", /END TRANSACTION\/WORK/],
      ["EXECUTE 'ALTER SYSTEM SET x = 1';", /ALTER SYSTEM/], ["EXECUTE 'ALTER ROLE postgres SET x = 1';", /ALTER ROLE/],
      ["EXECUTE 'ALTER DATABASE postgres SET x = 1';", /ALTER DATABASE/], ["EXECUTE 'COMMENT ON DATABASE postgres IS ''x''';", /COMMENT ON DATABASE/],
      ["EXECUTE 'CREATE EXTENSION dblink';", /CREATE EXTENSION/], ["PERFORM dblink_exec('x', 'y');", /dblink/],
      ['PERFORM pg_terminate_backend(1);', /pg_terminate_backend/], ["EXECUTE 'COPY x FROM PROGRAM ''ls''';", /COPY … PROGRAM/],
      ["EXECUTE 'CREATE OR REPLACE FUNCTION pg_temp.s112_ende(text, text[], timestamptz, int) RETURNS void LANGUAGE sql AS ''SELECT 1''';", /_helfer\.sql vorbehalten/],
      ["EXECUTE 'DROP FUNCTION pg_temp.s112_nur_staging()';", /ALTER\/DROP FUNCTION pg_temp/],
    ]
    for (const [zeile, re] of faelle) einFehler(testDatei('10_beispiel', { rumpf: `\n  ${zeile}` }), re)
    // in Kommentaren erlaubt
    assert.deepEqual(fehlerIn('10_beispiel.sql', testDatei('10_beispiel', { rumpf: '\n  -- kein COMMIT, kein ROLLBACK, kein ALTER SYSTEM' })), [])
  })

  test('check-replica: Replikationsmodus und Trigger-Abschalten nur in Kommentaren', () => {
    einFehler(testDatei('10_beispiel', { rumpf: `\n  EXECUTE 'SET LOCAL ${SRR} = replica';` }), /check-replica.*REPLICA/)
    einFehler(testDatei('10_beispiel', { rumpf: `\n  EXECUTE 'ALTER TABLE public.kontakte ${DT} ALL';` }), /check-replica.*DISABLE_TRIGGER/)
    einFehler(testDatei('10_beispiel', { rumpf: `\n  -- replica-ausnahme: Begründung mit genug Zeichen\n  EXECUTE 'SET LOCAL ${SRR} = replica';` }), /replica-ausnahme/)
    assert.deepEqual(fehlerIn('10_beispiel.sql', testDatei('10_beispiel', { rumpf: `\n  -- nie ${SRR}, nie ${DT}` })), [])
    assert.deepEqual(pruefeVerboten(`-- ${SRR}\nSELECT 1;`), [])
  })

  test('Kopf: @bereich, @ziel, mindestens zwei Mutationen, jede angewendet und deklariert', () => {
    einFehler(testDatei('10_beispiel', { kopf: '-- @ziel: x\n-- @mutation m_eins: a | rot: x\n-- @mutation m_zwei: b | rot: y' }), /@bereich/)
    einFehler(testDatei('10_beispiel', { kopf: '-- @bereich: x\n-- @mutation m_eins: a | rot: x\n-- @mutation m_zwei: b | rot: y' }), /@ziel/)
    einFehler(testDatei('10_beispiel', { kopf: '-- @bereich: x\n-- @ziel: y\n-- @mutation m_eins: a | rot: x' }), /mindestens zwei/)
    einFehler(testDatei('10_beispiel', { kopf: '-- @bereich: x\n-- @ziel: y\n-- @mutation m_eins: a | rot: x\n-- @mutation m_zwei: b | rot: y\n-- @mutation m_drei: c | rot: z' }), /m_drei deklariert, aber kein/)
    einFehler(testDatei('10_beispiel', { kopf: '-- @bereich: x\n-- @ziel: y\n-- @mutation m_eins: a | rot: x' + '\n-- @mutation m_zwei: b | rot: (' }), /kein gültiger regulärer Ausdruck/)
    einFehler(testDatei('10_beispiel', { kopf: '-- @bereich: x\n-- @ziel: y\n-- @mutation m_eins: a | rot: x\n-- @mutation m_zwei ohne Muster' }), /unlesbar/)
    einFehler(testDatei('10_beispiel', { rumpf: "\n  PERFORM pg_temp.s112_mutiere('m_heimlich', 'SELECT 1');" }), /m_heimlich.*ohne Kopfzeile/)
  })

  test('Produktions-Ref und -Betriebs-IDs in einer Testdatei sind verboten, ebenso falsche Dateinamen', () => {
    einFehler(testDatei('10_beispiel', { rumpf: `\n  -- ${PROD_REF}` }), /Produktions-Ref/)
    einFehler(testDatei('10_beispiel', { rumpf: `\n  PERFORM 1 WHERE '${PROD_IDS[1]}' IS NOT NULL;` }), /Produktions-Betriebs-ID/)
    einFehler(testDatei('10_Beispiel'), /Dateiname/, '10_Beispiel.sql')
    einFehler(testDatei('1_x'), /Dateiname/, '1_x.sql')
  })

  test('current_date ist verboten (Sitzungs-Zeitzone UTC ≠ Wiener Datum der RPCs) – Code und SQL-Texte, nicht Kommentare', () => {
    einFehler(testDatei('10_beispiel', { rumpf: '\n  v_n := current_date - make_date(2026, 1, 1);' }), /current_date in Zeile .*v_heute/)
    einFehler(testDatei('10_beispiel', { rumpf: "\n  EXECUTE format('SELECT public.f(%L, CURRENT_DATE)', v_id);" }), /current_date in Zeile/)
    einFehler(testDatei('10_beispiel', { rumpf: '\n  EXECUTE $s$SELECT current_date$s$;' }), /current_date in Zeile/)
    assert.deepEqual(pruefeTestdatei('10_beispiel.sql', testDatei('10_beispiel', { rumpf: '\n  -- nicht current_date, sondern v_heute' }), PROD_IDS), [])
    assert.deepEqual(pruefeTestdatei('10_beispiel.sql', testDatei('10_beispiel', {
      declare: "\n  v_heute date := (now() AT TIME ZONE 'Europe/Vienna')::date;",
      rumpf: "\n  EXECUTE format('SELECT %L::date + 1, pg_temp.s112_heute()', v_heute);",
    }), PROD_IDS), [])
    assert.ok(pruefeHelfer(HELFER + '\nCREATE FUNCTION pg_temp.t_x() RETURNS date LANGUAGE sql AS $f$ SELECT current_date $f$;\n').some(f => /current_date/.test(f)))
  })

  test('_helfer.sql: nur Funktionen, keine DO-Blöcke, Pflichtfunktionen vorhanden', () => {
    assert.ok(pruefeHelfer(HELFER + '\nDO $x$ BEGIN NULL; END $x$;\n').some(f => /nur CREATE FUNCTION pg_temp/.test(f)))
    assert.ok(pruefeHelfer(HELFER.replace('CREATE FUNCTION pg_temp.s112_ende(', 'CREATE FUNCTION pg_temp.s112_ende_x(')).some(f => /s112_ende fehlt/.test(f)))
    assert.ok(pruefeHelfer(HELFER.replaceAll(STAGING_SYSID, '1')).some(f => /STAGING_SYSID/.test(f)))
    assert.ok(pruefeHelfer(HELFER.replace('CREATE FUNCTION pg_temp.s112_heute(', 'CREATE FUNCTION pg_temp.s112_heute_x(')).some(f => /s112_heute fehlt/.test(f)))
    assert.ok(pruefeHelfer(HELFER.replace('CREATE FUNCTION pg_temp.s112_zeitzone(', 'CREATE FUNCTION pg_temp.s112_zeitzone_x(')).some(f => /s112_zeitzone fehlt/.test(f)))
    // „heute“ = Wiener Datum; der Wächter übernimmt die Zeitzone des Schalters (--zeitzone)
    assert.match(HELFER, /pg_temp\.s112_heute\(\) RETURNS date LANGUAGE sql STABLE AS \$f\$\s+SELECT \(now\(\) AT TIME ZONE 'Europe\/Vienna'\)::date/)
    assert.match(HELFER, /IF pg_temp\.s112_zeitzone\(\) IS NOT NULL THEN\s+PERFORM set_config\('TimeZone', pg_temp\.s112_zeitzone\(\), true\);/)
  })

  test('zusammensetzen: Helfer + Schalter + Test, Mutationsname geprüft', () => {
    const t = testDatei('10_beispiel')
    const normal = zusammensetzen(HELFER, t)
    assert.ok(normal.startsWith(HELFER.trimEnd()))
    assert.ok(!normal.includes('CREATE OR REPLACE FUNCTION pg_temp.s112_mutation()'))
    const m = zusammensetzen(HELFER, t, { mutation: 'm_eins', ausfuehrlich: true })
    assert.match(m, /CREATE OR REPLACE FUNCTION pg_temp\.s112_mutation\(\) RETURNS text LANGUAGE sql AS \$m\$ SELECT 'm_eins'::text \$m\$;/)
    assert.match(m, /CREATE OR REPLACE FUNCTION pg_temp\.s112_ausfuehrlich\(\) RETURNS boolean LANGUAGE sql AS \$m\$ SELECT true \$m\$;/)
    assert.ok(m.indexOf('s112_mutation() RETURNS text LANGUAGE sql AS $m$') < m.indexOf('DO $test$'))
    assert.throws(() => zusammensetzen(HELFER, t, { mutation: "x'; DROP" }), /unzulässig/)
    assert.throws(() => zusammensetzen(HELFER, t + '\nSELECT 1;\n'), /zusammengesetzt/)
    assert.ok(!normal.includes('CREATE OR REPLACE FUNCTION pg_temp.s112_zeitzone()'))
    const z = zusammensetzen(HELFER, t, { zeitzone: 'Etc/GMT+12' })
    assert.match(z, /CREATE OR REPLACE FUNCTION pg_temp\.s112_zeitzone\(\) RETURNS text LANGUAGE sql AS \$m\$ SELECT 'Etc\/GMT\+12'::text \$m\$;/)
    assert.ok(z.indexOf('s112_zeitzone() RETURNS text LANGUAGE sql AS $m$') < z.indexOf('DO $test$'))
    assert.throws(() => zusammensetzen(HELFER, t, { zeitzone: "x'; DROP" }), /unzulässig/)
  })
})

// ── Auswertung ─────────────────────────────────────────────────────────────────────────────────────────

describe('Auswertung der CLI-Antwort', () => {
  test('S112TEST-Ergebnis (P0001) samt Umlauten', () => {
    const a = auswerten(antwortErgebnis('10_beispiel', { fehler: ['größe ist=1 soll=0'] }))
    assert.equal(a.art, 'ergebnis')
    const e = parseErgebnis(a.zeile)
    assert.equal(e.datei, '10_beispiel')
    assert.deepEqual([e.ok, e.fehler, e.bekannt, e.dauerMs, e.mutation], [5, 1, 0, 12, '-'])
    assert.deepEqual(e.fehlerNamen, ['größe'])
  })

  test('Wächter, Zeilen (ALARM), echter SQL-Fehler', () => {
    assert.deepEqual(auswerten(antwortFehler('P0001: S112GUARD|system_identifier 1 ist nicht Staging – Abbruch')).art, 'guard')
    assert.deepEqual(auswerten(antwortZeilen([])), { art: 'zeilen', zeilen: [] })
    assert.deepEqual(auswerten({ status: 0, stdout: JSON.stringify({ boundary: 'x', rows: [{ a: 1 }], warning: 'w' }) }).zeilen, [{ a: 1 }])
    const s = auswerten(antwortFehler('42P01: relation "public.gibt_es_nicht" does not exist'))
    assert.equal(s.art, 'sql')
    assert.equal(s.sqlstate, '42P01')
    assert.match(s.meldung, /CONTEXT:/)
    assert.equal(auswerten(antwortFehler('P0001: etwas anderes')).art, 'sql')
  })

  test('Exit-Status 0 ohne JSON-Antwort gilt als „ohne RAISE beendet“ (zeilen), nie als Infrastruktur', () => {
    for (const roh of [{ status: 0, stdout: '', stderr: 'Initialising login role...' }, { status: 0, stdout: 'npm notice x\n', stderr: '' }]) {
      const a = auswerten(roh)
      assert.equal(a.art, 'zeilen', JSON.stringify(roh))
      assert.deepEqual(a.zeilen, [])
    }
    // Exit-Status ungleich 0 bleibt wie bisher
    assert.equal(auswerten({ status: 1, stdout: '', stderr: LOGIN }).art, 'infra')
  })

  test('Infrastruktur: 28P01, HTTP 401/429/5xx, Zeitüberschreitung – sonst keine Wiederholung', () => {
    const temp = { status: 1, stdout: JSON.stringify({ _tag: 'Error', error: { code: 'DbConfigConnectTempRoleError', message: 'failed to connect: password authentication failed for user "cli_login_postgres" (SQLSTATE 28P01)' } }) }
    assert.equal(auswerten(temp).art, 'infra')
    for (const st of [401, 429, 500, 503]) assert.equal(auswerten(antwortFehler('x', st)).art, 'infra', String(st))
    assert.equal(auswerten(antwortFehler('x', 404)).art, 'sql')
    assert.equal(auswerten({ error: Object.assign(new Error('spawnSync npx ETIMEDOUT'), { code: 'ETIMEDOUT' }), signal: 'SIGTERM' }).art, 'infra')
    assert.equal(auswerten({ error: Object.assign(new Error('spawn npx ENOENT'), { code: 'ENOENT' }) }).art, 'cli')
    assert.equal(auswerten({ status: 1, stdout: '', stderr: 'unexpected status 503: {}' }).art, 'infra')
    assert.equal(auswerten({ status: 1, stdout: '', stderr: LOGIN + 'Access token not provided.' }).art, 'sql')
    // leere Antwort (nur npm-Hinweise und Login-Zeile) ohne SQL-Fehlertext → Wiederholung, Meldung mit Exit-Status
    const leer = auswerten({ status: 1, stdout: 'npm notice New minor version of npm available!\nnpm notice Run `npm install -g npm`\n', stderr: LOGIN })
    assert.equal(leer.art, 'infra')
    assert.match(leer.grund, /Exit-Status 1.*stderr \d+ Zeichen/)
    assert.equal(auswerten({ status: 1, stdout: 'npm notice x\nERROR: 42P01: relation fehlt', stderr: '' }).art, 'sql')
  })

  test('tolerant: Text vor dem JSON, fehlendes Präfix, inneres JSON unlesbar', () => {
    const roh = antwortErgebnis('10_beispiel')
    assert.equal(auswerten({ ...roh, stdout: 'Hinweis der CLI\n' + roh.stdout }).art, 'ergebnis')
    const ohnePraefix = { status: 1, stdout: JSON.stringify({ _tag: 'Error', error: { message: 'ERROR:  P0001: S112TEST|10_beispiel|ok=1|fehler=0|bekannt=0|dauer_ms=1 ; mutation=-' } }) }
    assert.equal(auswerten(ohnePraefix).art, 'ergebnis')
    const kaputt = { status: 1, stdout: JSON.stringify({ _tag: 'Error', error: { message: 'unexpected status 400: nicht json' } }) }
    assert.equal(auswerten(kaputt).art, 'sql')
  })
})

describe('Ergebniszeile, Mutationen, bekannte Lücken', () => {
  const zeile = 'S112TEST|12_rollen|ok=3|fehler=2|bekannt=2|dauer_ms=77 ; mutation=offen ; FEHLER:a_b ist=1 soll=0 ; FEHLER:c BEHOBEN – in harte Prüfung umwandeln'
    + ' ; BEKANNT:B1 (HOCH) Zahlung fremder Verkaufsposten [zahlung_fremd ist=k1] ; BEKANNT:B3 profiles_read_all ; OK:x ; GEKUERZT:4 weitere Einträge'

  test('parseErgebnis', () => {
    const e = parseErgebnis(zeile)
    assert.deepEqual([e.datei, e.ok, e.fehler, e.bekannt, e.dauerMs, e.mutation], ['12_rollen', 3, 2, 2, 77, 'offen'])
    assert.deepEqual(e.fehlerNamen, ['a_b', 'c'])
    assert.deepEqual(e.bekanntEintraege, [
      { titel: 'B1 (HOCH) Zahlung fremder Verkaufsposten', beleg: 'zahlung_fremd ist=k1' },
      { titel: 'B3 profiles_read_all', beleg: '' }])
    assert.deepEqual(e.okNamen, ['x'])
    assert.equal(e.gekuerzt, '4 weitere Einträge')
    assert.equal(parseErgebnis('S112TEST|x|ok=a|fehler=0|bekannt=0|'), null)
    assert.equal(parseErgebnis('etwas'), null)
  })

  test('bewerteMutation: erkannt nur mit Beleg, Fehler und passendem Namen', () => {
    const mut = { name: 'offen', rot: 'a_.*|z' }
    assert.deepEqual(bewerteMutation(parseErgebnis(zeile), mut), { getoetet: true, treffer: ['a_b'] })
    assert.equal(bewerteMutation(parseErgebnis(zeile), { name: 'offen', rot: 'c_d' }).getoetet, false)
    assert.equal(bewerteMutation(parseErgebnis(zeile.replace('mutation=offen', 'mutation=offen(nicht_angewendet)')), mut).getoetet, false)
    assert.equal(bewerteMutation(parseErgebnis(zeile.replace('mutation=offen', 'mutation=-')), mut).getoetet, false)
    assert.match(bewerteMutation(parseErgebnis('S112TEST|x|ok=3|fehler=0|bekannt=0|dauer_ms=1 ; mutation=offen'), mut).grund, /keine Prüfung schlug an/)
    // Muster gilt für den ganzen Namen
    assert.equal(bewerteMutation(parseErgebnis(zeile), { name: 'offen', rot: 'a' }).getoetet, false)
  })

  test('bekannte Lücken über Dateien dedupliziert, Belege je Datei', () => {
    const l = bekannteLuecken([
      { datei: '12_rollen.sql', erg: parseErgebnis(zeile) },
      { datei: '13_fremd.sql', erg: parseErgebnis('S112TEST|13_fremd|ok=1|fehler=0|bekannt=1|dauer_ms=1 ; mutation=- ; BEKANNT:B3 profiles_read_all [9 Profile]') },
    ])
    assert.deepEqual(l.map(x => x.titel), ['B1 (HOCH) Zahlung fremder Verkaufsposten', 'B3 profiles_read_all'])
    assert.deepEqual(l[1].belege, ['12_rollen.sql', '13_fremd.sql: 9 Profile'])
  })
})

// ── Ablauf mit Attrappe ────────────────────────────────────────────────────────────────────────────────

describe('Ablauf ohne Datenbank (Attrappe statt CLI)', () => {
  test('grün: Vorprüfung, 00 zuerst, Tests, Nachprüfung; Block „Bekannte Lücken“ immer', () => {
    const r = mitVerzeichnis(undefined, GRUEN)
    assert.equal(r.exit, EXIT.GRUEN, r.text)
    assert.deepEqual(r.aufrufe.map(a => a.name), ['vorpruefung', '00_rahmen', '10_beispiel', 'nachpruefung'])
    assert.ok(r.aufrufe[1].sql.startsWith(HELFER.trimEnd()))
    assert.ok(r.aufrufe[2].sql.includes("c_datei constant text := '10_beispiel'"))
    assert.match(r.text, /✓ 00_rahmen ok=108 fehler=0 bekannt=0 \(db 12 ms, gesamt/)
    assert.match(r.text, /Bekannte Lücken \(0\):\n {2}keine/)
    assert.match(r.text, /Ergebnis: grün \(Exit 0\)/)
  })

  test('bekannte Lücken lassen die Suite grün, --streng macht sie rot', () => {
    const antworten = { ...GRUEN, '10_beispiel': antwortErgebnis('10_beispiel', { bekannt: ['B2 Fremd-FK [kontakt_firmen k1]'] }) }
    const r = mitVerzeichnis(undefined, antworten)
    assert.equal(r.exit, EXIT.GRUEN)
    assert.match(r.text, /Bekannte Lücken \(1\):\n {2}• B2 Fremd-FK\n {6}10_beispiel\.sql: kontakt_firmen k1/)
    assert.equal(mitVerzeichnis(undefined, antworten, { streng: true }).exit, EXIT.TESTFEHLER)
  })

  test('Testfehler → Exit 1, alle FEHLER-Einträge aufgelistet', () => {
    const r = mitVerzeichnis(undefined, { ...GRUEN, '10_beispiel': antwortErgebnis('10_beispiel', { fehler: ['x ist=1 soll=0'] }) })
    assert.equal(r.exit, EXIT.TESTFEHLER)
    assert.match(r.text, /✗ 10_beispiel ok=5 fehler=1/)
    assert.match(r.text, /Fehler \(1\):\n {2}✗ 10_beispiel\.sql: x ist=1 soll=0/)
  })

  test('00 rot → Abbruch vor allen anderen Dateien', () => {
    const r = mitVerzeichnis(undefined, { ...GRUEN, '00_rahmen': antwortErgebnis('00_rahmen', { fehler: ['versuch_R_fremd ist=k1 soll=R'] }) })
    assert.equal(r.exit, EXIT.TESTFEHLER)
    assert.deepEqual(r.aufrufe.map(a => a.name), ['vorpruefung', '00_rahmen'])
    assert.match(r.text, /00_rahmen\.sql ist rot – Lauf abgebrochen/)
  })

  test('ALARM: Testdatei ohne RAISE (Zeilen statt Fehler) → Exit 3, sofort Stopp, Nachprüfung trotzdem', () => {
    const r = mitVerzeichnis(undefined, { ...GRUEN, '00_rahmen': antwortZeilen([]) })
    assert.equal(r.exit, EXIT.KEIN_ROLLBACK)
    assert.deepEqual(r.aufrufe.map(a => a.name), ['vorpruefung', '00_rahmen', 'nachpruefung'])
    assert.match(r.text, /ALARM/)
    assert.match(r.text, /Nachprüfung nach dem Abbruch/)
    // leere Antwort mit Exit-Status 0 → ebenfalls ALARM, ohne Wiederholung
    const leer = mitVerzeichnis(undefined, { ...GRUEN, '10_beispiel': { status: 0, stdout: '', stderr: LOGIN } })
    assert.equal(leer.exit, EXIT.KEIN_ROLLBACK)
    assert.equal(leer.aufrufe.filter(a => a.name === '10_beispiel').length, 1)
    assert.deepEqual(leer.pausen, [])
    // Reste in der Nachprüfung nach dem Abbruch werden gemeldet
    const rest = mitVerzeichnis(undefined, { ...GRUEN, '10_beispiel': antwortZeilen([]), nachpruefung: pruefZeile({ rest_rechte: 2 }) })
    assert.equal(rest.exit, EXIT.KEIN_ROLLBACK)
    assert.match(rest.text, /Reste auf Staging gefunden.*rest_rechte/)
  })

  test('Abbruch nach Infrastrukturfehlern: Exit 2, Nachprüfung läuft und meldet Reste (Exit 3)', () => {
    const temp = antwortFehler('x', 503)
    const r = mitVerzeichnis(undefined, { ...GRUEN, '10_beispiel': temp })
    assert.equal(r.exit, EXIT.ECHTER_FEHLER)
    assert.equal(r.aufrufe[r.aufrufe.length - 1].name, 'nachpruefung')
    const rest = mitVerzeichnis(undefined, { ...GRUEN, '10_beispiel': temp, nachpruefung: pruefZeile({ rest_plattform_admins: 1 }) })
    assert.equal(rest.exit, EXIT.KEIN_ROLLBACK)
  })

  test('Wächter schlägt an → Exit 4, sofort Stopp', () => {
    const r = mitVerzeichnis(undefined, { ...GRUEN, '10_beispiel': antwortFehler('P0001: S112GUARD|Produktions-Betrieb gefunden – Abbruch') })
    assert.equal(r.exit, EXIT.NICHT_STAGING)
    assert.ok(!r.aufrufe.some(a => a.name === 'nachpruefung'))
  })

  test('Vorprüfung: nicht Staging → Exit 4 ohne einen einzigen Test; Reste → Exit 3', () => {
    for (const k of ['sysid_ok', 'keine_prod_betriebe', 'staging_admin']) {
      const r = mitVerzeichnis(undefined, { ...GRUEN, vorpruefung: pruefZeile({ [k]: false }) })
      assert.equal(r.exit, EXIT.NICHT_STAGING, k)
      assert.deepEqual(r.aufrufe.map(a => a.name), ['vorpruefung'])
    }
    const g = mitVerzeichnis(undefined, { ...GRUEN, vorpruefung: antwortFehler('P0001: S112GUARD|x') })
    assert.equal(g.exit, EXIT.NICHT_STAGING)
    const rest = mitVerzeichnis(undefined, { ...GRUEN, vorpruefung: pruefZeile({ rest_betriebe: 1 }) })
    assert.equal(rest.exit, EXIT.KEIN_ROLLBACK)
    assert.deepEqual(rest.aufrufe.map(a => a.name), ['vorpruefung'])
  })

  test('Nachprüfung findet Reste → Exit 3', () => {
    const r = mitVerzeichnis(undefined, { ...GRUEN, nachpruefung: pruefZeile({ rest_policies: 1 }) })
    assert.equal(r.exit, EXIT.KEIN_ROLLBACK)
    assert.match(r.text, /Reste auf Staging gefunden.*rest_policies/)
  })

  test('Infrastrukturfehler: Wiederholung mit Pause, danach grün bzw. nach allen Versuchen Exit 2', () => {
    const temp = antwortFehler('x', 503)
    const r = mitVerzeichnis(undefined, { ...GRUEN, '10_beispiel': [temp, temp, antwortErgebnis('10_beispiel')] })
    assert.equal(r.exit, EXIT.GRUEN, r.text)
    assert.deepEqual(r.pausen, [PAUSE_MS, PAUSE_MS])
    assert.equal(r.aufrufe.filter(a => a.name === '10_beispiel').length, 3)
    const nie = mitVerzeichnis(undefined, { ...GRUEN, '10_beispiel': temp })
    assert.equal(nie.exit, EXIT.ECHTER_FEHLER)
    assert.equal(nie.aufrufe.filter(a => a.name === '10_beispiel').length, 1 + MAX_WIEDERHOLUNGEN)
    // ein SQL-Fehler wird nie wiederholt
    const sql = mitVerzeichnis(undefined, { ...GRUEN, '10_beispiel': antwortFehler('22012: division by zero') })
    assert.equal(sql.exit, EXIT.ECHTER_FEHLER)
    assert.equal(sql.aufrufe.filter(a => a.name === '10_beispiel').length, 1)
    assert.match(sql.text, /echter SQL-Fehler 22012/)
    assert.ok(sql.aufrufe.some(a => a.name === 'nachpruefung'), 'Nachprüfung läuft trotzdem')
  })

  test('Ergebnis einer anderen Datei → Exit 2', () => {
    const r = mitVerzeichnis(undefined, { ...GRUEN, '10_beispiel': antwortErgebnis('11_anderes') })
    assert.equal(r.exit, EXIT.ECHTER_FEHLER)
    assert.match(r.text, /gehört zu „11_anderes“/)
  })

  test('statisch fehlerhafte Datei wird nicht gesendet → Exit 2', () => {
    const r = mitVerzeichnis({ '10_beispiel.sql': testDatei('10_beispiel', { rumpf: "\n  EXECUTE 'COMMIT';" }) }, GRUEN)
    assert.equal(r.exit, EXIT.ECHTER_FEHLER)
    assert.ok(!r.aufrufe.some(a => a.name === '10_beispiel'))
    assert.match(r.text, /statische Prüfung fehlgeschlagen/)
  })

  test('--nur: 00 läuft immer zuerst, dann nur die Auswahl', () => {
    const dateien = { '10_beispiel.sql': testDatei('10_beispiel'), '11_zweites.sql': testDatei('11_zweites') }
    const r = mitVerzeichnis(dateien, { ...GRUEN, '11_zweites': antwortErgebnis('11_zweites') }, { nur: ['11'] })
    assert.equal(r.exit, EXIT.GRUEN)
    assert.deepEqual(r.aufrufe.map(a => a.name), ['vorpruefung', '00_rahmen', '11_zweites', 'nachpruefung'])
    assert.equal(mitVerzeichnis(dateien, GRUEN, { nur: ['99'] }).exit, EXIT.ECHTER_FEHLER)
  })

  test('--liste: kein CLI-Aufruf', () => {
    const r = mitVerzeichnis(undefined, {}, { liste: true })
    assert.equal(r.exit, EXIT.GRUEN)
    assert.equal(r.aufrufe.length, 0)
    assert.match(r.text, /Mutation m_eins: erste Mutation \| rot: pruefung_a/)
  })

  test('--mutationen: jede Mutation einzeln; erkannt → grün, überlebt → Exit 1', () => {
    const antworten = {
      ...GRUEN,
      '00_rahmen__kontakte_select_offen': antwortErgebnis('00_rahmen', { mutation: 'kontakte_select_offen', fehler: ['fremder_kontakt_unsichtbar ist=1 soll=0'] }),
      '00_rahmen__pruefe_tenant_zugriff_offen': antwortErgebnis('00_rahmen', { mutation: 'pruefe_tenant_zugriff_offen', fehler: ['versuch_T_rpc_fremd ist=k1 soll=T'] }),
      '10_beispiel__m_eins': antwortErgebnis('10_beispiel', { mutation: 'm_eins', fehler: ['pruefung_a ist=x soll=y'] }),
      '10_beispiel__m_zwei': antwortErgebnis('10_beispiel', { mutation: 'm_zwei', fehler: ['pruefung_c ist=x soll=y'] }),
    }
    const r = mitVerzeichnis(undefined, antworten, { mutationen: true })
    assert.equal(r.exit, EXIT.GRUEN, r.text)
    const m = r.aufrufe.filter(a => a.name.includes('__'))
    assert.deepEqual(m.map(a => a.name), ['00_rahmen__kontakte_select_offen', '00_rahmen__pruefe_tenant_zugriff_offen', '10_beispiel__m_eins', '10_beispiel__m_zwei'])
    assert.ok(m[2].sql.includes("SELECT 'm_eins'::text"))
    assert.match(r.text, /Mutationen: 4\/4 erkannt/)
    const ueberlebt = mitVerzeichnis(undefined, { ...antworten, '10_beispiel__m_zwei': antwortErgebnis('10_beispiel', { mutation: 'm_zwei' }) }, { mutationen: true, mutationDatei: '10' })
    assert.equal(ueberlebt.exit, EXIT.TESTFEHLER)
    assert.match(ueberlebt.text, /überlebt: 10_beispiel\.sql ⟂ m_zwei/)
    // ist die Datei schon ohne Mutation rot, belegen Mutationen nichts – sie werden übersprungen
    const rot = mitVerzeichnis(undefined, { ...antworten, '10_beispiel': antwortErgebnis('10_beispiel', { fehler: ['pruefung_a ist=1 soll=0'] }) }, { mutationen: true })
    assert.equal(rot.exit, EXIT.TESTFEHLER)
    assert.ok(!rot.aufrufe.some(a => a.name.startsWith('10_beispiel__')))
    assert.match(rot.text, /übersprungen \(Datei rot\): 10_beispiel\.sql ⟂ m_eins, 10_beispiel\.sql ⟂ m_zwei/)
  })

  test('das echte Testverzeichnis ist das der Suite', () => {
    assert.equal(path.resolve(TEST_DIR), DB_DIR)
  })
})
