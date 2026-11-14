// KAN-459 (14.11.2026): Wer einen Bereich nicht liest, schreibt dort auch nicht.
// Befund: Die Sperr-Policy „lesebereich“ galt nur für SELECT. „Extern“ (Schreibmodul Rieden) konnte in 25 Tabellen
// außerhalb seiner Lesebereiche anlegen und – ohne Filter – ändern und löschen (auf Staging nachgewiesen: Einheitswert
// überschrieben, Preis eines Pflanzenschutzmittels auf 999). Neu: jede Policy gilt für alle Befehle.
// Datenbank: DB-Test 07_lesebereich_schreiben.
//
// Aufruf:  npm run -s test:csv
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const WURZEL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const quelle = p => readFileSync(path.join(WURZEL, p), 'utf8').replace(/\r\n/g, '\n')
function migration(name) {
  const dir = path.join(WURZEL, 'supabase', 'migrations')
  const datei = readdirSync(dir).find(d => d.endsWith(`_${name}.sql`))
  if (datei) return quelle(path.join('supabase', 'migrations', datei))
  const entwurf = path.join('supabase', 'entwurf', `${name}.sql`)
  assert.ok(existsSync(path.join(WURZEL, entwurf)), `Migration ${name} fehlt in supabase/migrations`)
  return quelle(entwurf)
}
const M = migration('kan459a_lesebereich_schreiben')
const LISTE = JSON.parse(quelle('scripts/lesebereiche.json'))
const { zeilen } = createRequire(import.meta.url)('../lesebereich-sql.js')

describe('KAN-459: Migration kan459a', () => {
  test('jede Policy lesebereich wird FOR ALL mit demselben Ausdruck als USING und WITH CHECK neu angelegt', () => {
    assert.match(M, /EXECUTE format\('DROP POLICY lesebereich ON %I\.%I', r\.schemaname, r\.tablename\);/)
    assert.match(M, /'CREATE POLICY lesebereich ON %I\.%I AS RESTRICTIVE FOR ALL TO authenticated USING \(%s\) WITH CHECK \(%s\)',\n\s+r\.schemaname, r\.tablename, r\.qual, r\.qual\);/)
    assert.doesNotMatch(M, /FOR (SELECT|INSERT|UPDATE|DELETE) TO/)
  })
  test('public und storage; der Ausdruck kommt unverändert aus der bestehenden Policy', () => {
    assert.match(M, /WHERE p\.policyname = 'lesebereich' AND p\.schemaname IN \('public', 'storage'\)/)
    assert.match(M, /SELECT p\.schemaname, p\.tablename, p\.qual, obj_description\(pol\.oid, 'pg_policy'\) AS kommentar/)
  })
  test('Selbstprüfung: Anzahl = Tabellen der Liste + storage.objects, keine Policy in anderer Form', () => {
    const n = zeilen(LISTE).length
    assert.equal(n, 126)
    assert.match(M, new RegExp(`IF v_n <> ${n + 1} THEN RAISE EXCEPTION 'KAN-459: % Policies umgestellt \\(erwartet ${n + 1}\\)'`))
    assert.match(M, /p\.cmd = 'ALL' AND p\.permissive = 'RESTRICTIVE' AND p\.roles = '\{authenticated\}'::name\[\] AND p\.qual IS NOT NULL AND p\.with_check IS NOT DISTINCT FROM p\.qual/)
    assert.match(M, /IF v_rest > 0 THEN RAISE EXCEPTION/)
  })
})

describe('KAN-459: DB-Tests und Regel', () => {
  test('DB-Test 02 und 07_lesewege erwarten die Policy für alle Befehle', () => {
    assert.match(quelle('scripts/db-tests/02_lesebereich.sql'), /p\.cmd = 'ALL' AND p\.with_check IS NOT DISTINCT FROM p\.qual AND p\.roles = '\{authenticated\}'/)
    assert.match(quelle('scripts/db-tests/07_lesewege.sql'), /'RESTRICTIVE\|ALL\|\{authenticated\}'/)
  })
  test('DB-Test 07_lesebereich_schreiben: Anlegen, Ändern und Löschen ohne Filter, eigener Bereich, ohne Profil; zwei Mutationen', () => {
    const t = quelle('scripts/db-tests/07_lesebereich_schreiben.sql')
    assert.equal([...t.matchAll(/^-- @mutation /gm)].length, 2)
    for (const p of ['katalog_alle_befehle', 'katalog_storage', 'extern_recht_anlegen', 'extern_recht_aendern_loeschen', 'extern_psm_preis_bleibt',
      'extern_kostenstelle_anlegen', 'extern_eigener_bereich', 'vertrieb_fremder_bereich', 'vertrieb_eigener_bereich', 'ohne_profil_schreibt']) assert.ok(t.includes(`'${p}'`), p)
    assert.match(t, /UPDATE public\.grundstueck_recht SET einheitswert = 7;\n\s+DELETE FROM public\.grundstueck_recht;\n\s+UPDATE public\.pflanzenschutzmittel SET preis_pro_einheit = 999;/)
    assert.match(t, new RegExp(`'${zeilen(LISTE).length}\\|${zeilen(LISTE).length}'`))
  })
  test('Projektregel und Doku nennen FOR ALL', () => {
    assert.match(quelle('CLAUDE.md'), /seit KAN-459 `FOR ALL` mit demselben Ausdruck als `USING` und `WITH CHECK`/)
    assert.match(quelle('docs/Leserechte.md'), /Schreiben nur mit Leserecht \(KAN-459\)/)
  })
})
