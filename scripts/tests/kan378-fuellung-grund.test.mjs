// KAN-378 (23.10.2026, UAT 5.7): Änderungen an einer gespeicherten Füllung nur mit Grund (≥ 10 Zeichen). Die App
// schreibt Produktname, Preise, KN-Code und Notizen nur über die RPC s112_fuellung_aendern; direkte Updates dieser
// Felder lehnt der Trigger a_grund_pflicht ab. Formular: Pflichtfeld „Grund der Änderung“ mit derselben Regel.
//
// Aufruf:  npm run -s test:csv   bzw. node --experimental-strip-types --test scripts/tests/kan378-fuellung-grund.test.mjs

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { aenderungGrundFehler, stornoGrundFehler, AENDERUNG_GRUND_MAX, STORNO_GRUND_MIN } from '../../src/lib/storno/grund.ts'

const WURZEL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const quelle = rel => readFileSync(path.join(WURZEL, rel), 'utf8').replace(/\r\n/g, '\n')

// Eingespielte Migration (supabase/migrations/<version>_kan378_fuellung_grund.sql), bis dahin der lokale Entwurf –
// der Entwurfsordner ist nicht eingecheckt (in der CI fehlt er vor dem Einspielen: dann null)
function migration() {
  const f = readdirSync(path.join(WURZEL, 'supabase/migrations')).find(x => x.endsWith('_kan378_fuellung_grund.sql'))
  if (f) return quelle('supabase/migrations/' + f)
  return existsSync(path.join(WURZEL, 'supabase/entwurf/kan378_fuellung_grund.sql')) ? quelle('supabase/entwurf/kan378_fuellung_grund.sql') : null
}

const actions = quelle('src/app/(dashboard)/weinhandel/actions.ts')
const updateFuellung = actions.slice(actions.indexOf('export async function updateFuellung'), actions.indexOf('const FUELLUNG_FELD_LABEL'))

describe('KAN-378: Grund-Regel (isomorph)', () => {
  test('mindestens 10 Zeichen wie beim Storno, getrimmt', () => {
    assert.equal(STORNO_GRUND_MIN, 10)
    assert.match(aenderungGrundFehler(''), /Grund für die Änderung.*mindestens 10 Zeichen/)
    assert.match(aenderungGrundFehler(null), /mindestens 10 Zeichen/)
    assert.match(aenderungGrundFehler('   kurz    '), /mindestens 10 Zeichen/)
    assert.match(aenderungGrundFehler('123456789'), /mindestens 10 Zeichen/)
    assert.equal(aenderungGrundFehler('1234567890'), null)
    assert.equal(aenderungGrundFehler('  Preis laut neuer Preisliste  '), null)
  })
  test('gleiche Mindestlänge wie stornoGrundFehler', () => {
    for (const t of ['', '123456789', '1234567890', ' x '.repeat(5)]) {
      assert.equal(aenderungGrundFehler(t) === null, stornoGrundFehler(t) === null, JSON.stringify(t))
    }
  })
  test('höchstens 500 Zeichen', () => {
    assert.equal(AENDERUNG_GRUND_MAX, 500)
    assert.equal(aenderungGrundFehler('x'.repeat(500)), null)
    assert.match(aenderungGrundFehler('x'.repeat(501)), /höchstens 500 Zeichen/)
  })
})

describe('KAN-378: updateFuellung', () => {
  test('prüft den Grund vor dem ersten Schreiben (auch vor dem Charge-Nachtrag)', () => {
    const iGrund = updateFuellung.indexOf("aenderungGrundFehler(grundRoh)")
    assert.ok(iGrund > 0, 'Grundprüfung vorhanden')
    assert.match(updateFuellung, /formData\.get\('aenderung_grund'\)/)
    assert.match(updateFuellung, /if \(gf\) throw new AktionsFehler\(gf\)/)
    assert.ok(iGrund < updateFuellung.indexOf("'s112_fuellung_nachtragen'"), 'vor dem Nachtrag')
    assert.ok(iGrund < updateFuellung.indexOf("'s112_fuellung_aendern'"), 'vor der Änderung')
  })
  test('schreibt über die RPC s112_fuellung_aendern mit Grund, nicht per .update()', () => {
    assert.match(updateFuellung, /\(supabase\.rpc as any\)\('s112_fuellung_aendern', \{\n\s+p_tenant_id: tenantId, p_id: id, p_werte: payload, p_grund: grund,\n\s+\}\)/)
    assert.doesNotMatch(updateFuellung, /\.update\(/)
    assert.match(updateFuellung, /if \(error\) \{/)
  })
  test('payload ohne Änderungszeit (setzt der Trigger), nur Spalten der RPC-Positivliste', () => {
    const block = /const payload: AR = \{([\s\S]*?)\n  \}/.exec(updateFuellung)?.[1]
    assert.ok(block)
    const spalten = [...block.matchAll(/^\s+(\w+):/gm)].map(m => m[1])
    const erlaubt = ['name', 'vk_preis_brutto', 'einstandspreis', 'mwst_pct', 'zolltarifnummer', 'notizen', 'aktiv']
    for (const sp of spalten) assert.ok(erlaubt.includes(sp), `${sp} nimmt die RPC nicht an`)
  })
})

describe('KAN-378: keine stillen Umgehungen in src/', () => {
  // Alle direkten Updates auf fuellungen: nur der Storno (setzt storniert_am; Grund in storno_grund) ist erlaubt
  function dateien(dir) {
    const out = []
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) out.push(...dateien(p))
      else if (/\.(ts|tsx)$/.test(e.name)) out.push(p)
    }
    return out
  }
  test('jedes .update() auf fuellungen ist ein Storno', () => {
    let gefunden = 0
    for (const d of dateien(path.join(WURZEL, 'src'))) {
      const s = readFileSync(d, 'utf8').replace(/\r\n/g, '\n')
      // Kette direkt nach from('fuellungen') (ggf. „as any)“ und Zeilenumbruch); Argument: die nächsten 300 Zeichen
      const re = /from\(['"]fuellungen['"]\)(?: as any\))?\s*\.(update|upsert)\(([\s\S]{0,300})/g
      let m
      while ((m = re.exec(s))) {
        gefunden++
        const rel = path.relative(WURZEL, d)
        assert.equal(m[1], 'update', `${rel}: kein upsert auf fuellungen`)
        assert.match(m[2], /storniert_am:/, `${rel}: direktes Update auf fuellungen ohne Storno – über s112_fuellung_aendern mit Grund schreiben`)
        assert.match(m[2], /storno_grund:/, `${rel}: Storno ohne Grund`)
      }
    }
    assert.equal(gefunden, 1, 'genau ein direkter Schreibweg (deactivateFuellung)')
  })
})

describe('KAN-378: Formular', () => {
  const seite = quelle('src/app/(dashboard)/weinhandel/fuellungen/[id]/edit/page.tsx')
  const formular = quelle('src/app/(dashboard)/weinhandel/fuellungen/[id]/edit/FuellungEditFormular.tsx')
  test('Pflichtfeld „Grund der Änderung *“ mit Mindest- und Höchstlänge', () => {
    assert.match(seite, /Grund der Änderung \*/)
    const tag = /<textarea id="aenderung_grund"[\s\S]*?\/>/.exec(seite)?.[0]
    assert.ok(tag, 'Feld vorhanden')
    assert.match(tag, /name="aenderung_grund"/)
    assert.match(tag, /\brequired\b/)
    assert.match(tag, /minLength=\{STORNO_GRUND_MIN\}/)
    assert.match(tag, /maxLength=\{AENDERUNG_GRUND_MAX\}/)
    // innerhalb des Formulars (vor dem schließenden FuellungEditFormular)
    assert.ok(seite.indexOf('name="aenderung_grund"') < seite.indexOf('</FuellungEditFormular>'))
  })
  test('Vorabprüfung im Browser mit derselben Regel, Fehler am Formular', () => {
    assert.match(formular, /import \{ aenderungGrundFehler \} from '@\/lib\/storno\/grund'/)
    assert.match(formular, /const grundFehler = aenderungGrundFehler\(fd\.get\('aenderung_grund'\)\)\n\s+if \(grundFehler\) \{ setFehler\(grundFehler\); return \}/)
    assert.match(formular, /role="alert"/)
  })
})

describe('KAN-378: Migration', () => {
  const m = migration()
  test('RPC: SECURITY DEFINER, search_path, Zugriff, Abo-Sperre, Schreibmodul, REVOKE', () => {
    if (!m) return   // Entwurf ist nicht eingecheckt; nach dem Einspielen liegt die Migration vor
    const rpc = m.slice(m.indexOf('FUNCTION public.s112_fuellung_aendern('), m.indexOf('$function$;', m.indexOf('FUNCTION public.s112_fuellung_aendern(')))
    assert.match(rpc, /SECURITY DEFINER\nSET search_path = public/)
    assert.match(rpc, /PERFORM public\.pruefe_tenant_zugriff\(p_tenant_id, ARRAY\['system_admin', 'tenant_admin', 'winzer'\]\);/)
    assert.match(rpc, /PERFORM public\.s112_pruefe_abo_schreibsperre\(p_tenant_id\);/)
    assert.match(rpc, /s112_darf_schreiben\(p_tenant_id, 'kellerbuch', 'warenwirtschaft'\)/)
    assert.match(rpc, /char_length\(v_grund\) < 10/)
    assert.match(rpc, /set_config\('s112\.aenderung_grund', v_grund, true\);\n\s+UPDATE public\.fuellungen[\s\S]*?set_config\('s112\.aenderung_grund', '', true\);/)
    assert.match(m, /REVOKE EXECUTE ON FUNCTION public\.s112_fuellung_aendern\(uuid, uuid, jsonb, text\) FROM PUBLIC, anon;/)
  })
  test('Trigger: nur API-Rollen, Storno und Freeze-Freigabe frei, 42501 mit HINT grund_fehlt', () => {
    if (!m) return   // Entwurf ist nicht eingecheckt; nach dem Einspielen liegt die Migration vor
    assert.match(m, /CREATE TRIGGER a_grund_pflicht\n\s+BEFORE UPDATE OF name, vk_preis_brutto, einstandspreis, mwst_pct, zolltarifnummer, notizen, aktiv ON public\.fuellungen/)
    const fn = m.slice(m.indexOf('FUNCTION public.s112_fuellung_grund_pflicht()'), m.indexOf('CREATE TRIGGER a_grund_pflicht'))
    assert.match(fn, /SET search_path = public/)
    assert.match(fn, /IF v_rolle NOT IN \('authenticated', 'anon'\) THEN/)
    assert.match(fn, /OLD\.storniert_am IS NOT NULL OR NEW\.storniert_am IS NOT NULL/)
    assert.match(fn, /v_frei = TG_TABLE_NAME/)
    assert.match(fn, /ERRCODE = '42501', HINT = 'grund_fehlt'/)
    assert.match(m, /REVOKE EXECUTE ON FUNCTION public\.s112_fuellung_grund_pflicht\(\) FROM PUBLIC, anon, authenticated;/)
  })
  test('Positivliste der RPC = änderbare Felder aus KAN-101 (ohne Änderungszeit und Storno)', () => {
    if (!m) return   // Entwurf ist nicht eingecheckt; nach dem Einspielen liegt die Migration vor
    const liste = /c_erlaubt constant text\[\] := ARRAY\[([^\]]*)\]/.exec(m)?.[1].split(',').map(x => x.trim().replace(/'/g, ''))
    assert.deepEqual(liste.sort(), ['aktiv', 'einstandspreis', 'mwst_pct', 'name', 'notizen', 'vk_preis_brutto', 'zolltarifnummer'])
  })
  test('Bestandsprotokoll überwacht auch Preise, MwSt. und KN-Code', () => {
    if (!m) return   // Entwurf ist nicht eingecheckt; nach dem Einspielen liegt die Migration vor
    const trg = m.slice(m.indexOf('CREATE TRIGGER z_protokoll_aendern'))
    for (const sp of ['vk_preis_brutto', 'einstandspreis', 'mwst_pct', 'zolltarifnummer']) assert.match(trg, new RegExp(`'${sp}'`))
  })
})

describe('KAN-378: DB-Test', () => {
  test('82_fuellung_grund deckt Grund, Storno, Buchungen, Service-Role und Abo ab; Soll-RPC eingetragen', () => {
    const t = quelle('scripts/db-tests/82_fuellung_grund.sql')
    for (const n of ['ohne_grund_name', 'rpc_mit_grund', 'rpc_protokoll_mit_grund', 'storno_erlaubt', 'bestand_buchen',
      'verkauf_buchen', 'service_role_ohne_grund', 'wartung_ohne_grund', 'rpc_abo_gesperrt', 'rpc_fremder_betrieb', 'rpc_leser']) {
      assert.match(t, new RegExp(`'${n}'`), n)
    }
    assert.match(quelle('scripts/db-tests/_helfer.sql'), /'s112_fuellung_aendern\(p_tenant_id uuid, p_id uuid, p_werte jsonb, p_grund text\)'/)
  })
})
