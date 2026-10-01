// Tests für den Wächter scripts/check-replica.js (KAN-124, 25.09.2026): aktives
// session_replication_role bzw. DISABLE TRIGGER in sql/, scripts/ und supabase/migrations/ lässt den
// Build scheitern, auskommentierte Stellen (wie seit KAN-35 in den Cleanup-Skripten) nicht.
//
// Aufruf:  npm run -s test:csv   (alle scripts/tests/*.test.mjs)
//          bzw. node --test scripts/tests/check-replica.test.mjs
//
// Diese Datei liegt selbst unter scripts/ und wird vom Wächter mitgeprüft – die verbotenen Wörter
// werden deshalb zusammengesetzt statt ausgeschrieben.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import path from 'node:path'

const HIER = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HIER, '..', '..')
const SKRIPT = path.join(ROOT, 'scripts', 'check-replica.js')
const require = createRequire(import.meta.url)
const { pruefeText, pruefeWurzel, ohneKommentare } = require(SKRIPT)

const SRR = ['session', 'replication', 'role'].join('_')
const AKTIV = `SET ${SRR} = 'replica';`
const DT = 'DISABLE' + ' TRIGGER'
const ERT = 'ENABLE REPLICA' + ' TRIGGER'

const arten = (text, sprache) => pruefeText(text, sprache).funde.map(f => `${f.zeile}:${f.art}`)

describe('auskommentierte Stellen im Projekt schlagen nicht an', () => {
  // Die Cleanup-Skripte sind mit KAN-151 entfernt (sql/sandbox_zuruecksetzen.sql setzt kein replica); Muster als Text:
  // Ersatz für sql/cleanup_gebeshuber_testdaten_2026-08-14.sql (mit KAN-151 entfernt): gleiches Muster als Text
  test('Beispiel-Skript mit auskommentiertem Setzen und Zurücksetzen', () => {
    const text = `BEGIN;\n-- ${AKTIV}\nDELETE FROM beispiel WHERE tenant_id = '00000000-0000-0000-0000-000000000000';\n-- SET ${SRR} = 'origin';\nCOMMIT;\n`
    const e = pruefeText(text, 'sql')
    assert.deepEqual(e.funde, [])
    assert.ok(e.auskommentiert >= 2, `auskommentiert: ${e.auskommentiert}`)
  })

  test('ganzes Projekt ohne Fund, Skript endet mit Exit 0', () => {
    assert.deepEqual(pruefeWurzel(ROOT).funde, [])
    const r = spawnSync(process.execPath, [SKRIPT], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, S112_GUARD_ROOT: '' } })
    assert.equal(r.status, 0, r.stderr)
    assert.match(r.stdout, /✓ check-replica: \d+ Dateien/)
  })
})

describe('aktive Stellen schlagen an', () => {
  test('SET … = replica (auch klein geschrieben, SET LOCAL, set_config, EXECUTE, im DO-Rumpf)', () => {
    assert.deepEqual(arten(AKTIV), ['1:REPLICA'])
    assert.deepEqual(arten(`begin;\n  set local ${SRR.toUpperCase()} to replica;\ncommit;`), ['2:REPLICA'])
    assert.deepEqual(arten(`select set_config('${SRR}', 'replica', true);`), ['1:REPLICA'])
    assert.deepEqual(arten(`DO $$\nBEGIN\n  EXECUTE 'SET ${SRR} = replica';\nEND $$;`), ['3:REPLICA'])
    assert.deepEqual(arten(`DO $body$\nBEGIN\n  -- Kommentar\n  ${AKTIV}\nEND $body$;`), ['4:REPLICA'])
    assert.deepEqual(arten(`SET ${SRR} = 'origin';`), ['1:REPLICA'], 'auch das Zurücksetzen – die Zeile gehört dann ganz weg')
  })

  test(`${DT} und ${ERT}, auch über Zeilen hinweg`, () => {
    assert.deepEqual(arten(`ALTER TABLE public.ernte_parzellen ${DT} ALL;`), ['1:DISABLE_TRIGGER'])
    assert.deepEqual(arten(`alter table x\n  disable\n  trigger z_protokoll_loeschen;`), ['2:DISABLE_TRIGGER'])
    assert.deepEqual(arten(`ALTER TABLE x ${ERT} t;`), ['1:DISABLE_TRIGGER'])
    assert.deepEqual(arten(`ALTER TABLE x ENABLE TRIGGER ALL;`), [], 'Einschalten ist erlaubt')
  })

  test('Kommentarzeichen in Strings und Bezeichnern beenden den Code nicht', () => {
    assert.deepEqual(arten(`SELECT '--'; ${AKTIV}`), ['1:REPLICA'])
    assert.deepEqual(arten(`SELECT '/*'; ${AKTIV} SELECT '*/';`), ['1:REPLICA'])
    assert.deepEqual(arten(`SELECT 'it''s -- kein Kommentar'; ${AKTIV}`), ['1:REPLICA'])
    assert.deepEqual(arten(`SELECT E'\\' -- '; ${AKTIV}`), ['1:REPLICA'])
    assert.deepEqual(arten(`SELECT 1 AS "a--b"; ${AKTIV}`), ['1:REPLICA'])
  })
})

describe('Kommentare werden übersprungen', () => {
  test('Zeilen- und Blockkommentare (auch verschachtelt und mehrzeilig)', () => {
    assert.deepEqual(arten(`-- ${AKTIV}`), [])
    assert.deepEqual(arten(`SELECT 1; -- danach ${AKTIV}`), [])
    assert.deepEqual(arten(`/*\n${AKTIV}\n${DT}\n*/\nSELECT 1;`), [])
    assert.deepEqual(arten(`/* außen /* innen */ ${AKTIV} */ SELECT 1;`), [], 'Postgres verschachtelt Blockkommentare')
    assert.deepEqual(arten(`/* a /* b */ c */ ${AKTIV}`), ['1:REPLICA'])
    assert.deepEqual(arten(`DO $$\nBEGIN\n  -- ${AKTIV}\n  /* ${DT} */\n  NULL;\nEND $$;`), [])
  })

  test('Zeilen bleiben erhalten (Kommentar → Leerzeichen)', () => {
    const text = `a -- x\r\n/* y\r\nz */ b\r\n`
    const code = ohneKommentare(text, 'sql')
    assert.equal(code.length, text.length)
    assert.equal(code.split('\n').length, text.split('\n').length)
    assert.match(code, /^a {5}\r\n {4}\r\n {5}b\r\n$/)
  })

  test('JS: // und /* */ sind Kommentare, Strings zählen', () => {
    assert.deepEqual(arten(`// ${AKTIV}\n/* ${DT} */\nconst x = 1`, 'js'), [])
    assert.deepEqual(arten(`await client.query("${AKTIV.replace(/'/g, '')}")`, 'js'), ['1:REPLICA'])
    assert.deepEqual(arten(`const sql = \`\n  ${DT} ALL\n\``, 'js'), ['2:DISABLE_TRIGGER'])
    assert.deepEqual(arten(`const s = '// kein Kommentar'; run('${SRR}')`, 'js'), ['1:REPLICA'])
  })
})

describe('Ausnahme „-- replica-ausnahme: <Grund>“', () => {
  test('in derselben Zeile oder allein in der Zeile davor, Grund ab 15 Zeichen', () => {
    const e1 = pruefeText(`${AKTIV} -- replica-ausnahme: einmaliger Restore-Test auf Kopie`)
    assert.deepEqual(e1.funde, [])
    assert.equal(e1.ausnahmen, 1)
    const e2 = pruefeText(`-- replica-ausnahme: pg_restore einer Sicherung in leeres Projekt\n${AKTIV}`)
    assert.deepEqual(e2.funde, [])
    assert.equal(e2.ausnahmen, 1)
    const e3 = pruefeText(`/* replica-ausnahme: pg_restore einer Sicherung */ ALTER TABLE x ${DT} ALL;`)
    assert.deepEqual(e3.funde, [])
  })

  test('zu kurzer oder fehlender Grund ist ein Fund', () => {
    assert.deepEqual(arten(`${AKTIV} -- replica-ausnahme: schneller`), ['1:AUSNAHME'])
    assert.deepEqual(arten(`${AKTIV} -- replica-ausnahme`), ['1:AUSNAHME'])
    assert.deepEqual(arten(`-- replica-ausnahme: nur kurz\n${AKTIV}`), ['2:AUSNAHME'])
  })

  test('Marker gilt nur als Kommentar und nur für die nächste Zeile', () => {
    assert.deepEqual(arten(`SELECT '-- replica-ausnahme: steht in einem String'; ${AKTIV}`), ['1:REPLICA'])
    assert.deepEqual(arten(`-- replica-ausnahme: pg_restore einer Sicherung\nSELECT 1;\n${AKTIV}`), ['3:REPLICA'])
    assert.deepEqual(arten(`SELECT 1; -- replica-ausnahme: pg_restore einer Sicherung\n${AKTIV}`), ['2:REPLICA'], 'Zeile davor muss eine reine Kommentarzeile sein')
  })
})

describe('Verzeichnisse (Beispielprojekt über S112_GUARD_ROOT)', () => {
  function lauf(dateien) {
    const wurzel = mkdtempSync(path.join(tmpdir(), 'kan124-replica-'))
    try {
      for (const [rel, inhalt] of Object.entries(dateien)) {
        const ziel = path.join(wurzel, rel)
        mkdirSync(path.dirname(ziel), { recursive: true })
        writeFileSync(ziel, inhalt)
      }
      const r = spawnSync(process.execPath, [SKRIPT], { env: { ...process.env, S112_GUARD_ROOT: wurzel }, encoding: 'utf8' })
      return { code: r.status, text: `${r.stdout}${r.stderr}` }
    } finally {
      rmSync(wurzel, { recursive: true, force: true })
    }
  }

  test('aktive Zeile in sql/, scripts/, supabase/migrations/ und Datenskripten unter supabase/ lässt den Lauf scheitern', () => {
    const r = lauf({
      'sql/cleanup.sql': `-- Kopf\n${AKTIV}\nDELETE FROM x;\n`,
      'scripts/restore.mjs': `await db.query("ALTER TABLE x ${DT} ALL")\n`,
      'supabase/migrations/20260925120000_x.sql': `ALTER TABLE x ${DT} USER;\n`,
      'supabase/import_x.sql': `${AKTIV}\n`,
    })
    assert.equal(r.code, 1, r.text)
    assert.match(r.text, /sql\/cleanup\.sql:2 {2}REPLICA/)
    assert.match(r.text, /scripts\/restore\.mjs:1 {2}DISABLE_TRIGGER/)
    assert.match(r.text, /supabase\/migrations\/20260925120000_x\.sql:1 {2}DISABLE_TRIGGER/)
    assert.match(r.text, /supabase\/import_x\.sql:1 {2}REPLICA/)
    assert.match(r.text, /4 Fund\(e\)/)
  })

  test('migrations_legacy, andere Ordner, andere Endungen und das Skript selbst bleiben außen vor', () => {
    const r = lauf({
      'supabase/migrations_legacy/052_alt.sql': `${AKTIV}\n`,
      'docs/notiz.sql': `${AKTIV}\n`,
      'scripts/notiz.md': `${AKTIV}\n`,
      'scripts/check-replica.js': `const x = "${AKTIV.replace(/'/g, '')}"\n`,
      'sql/ok.sql': `-- ${AKTIV}\nDELETE FROM x;\n`,
    })
    assert.equal(r.code, 0, r.text)
    assert.match(r.text, /✓ check-replica: 1 Dateien .* 1 auskommentierte Erwähnung/)
  })
})
