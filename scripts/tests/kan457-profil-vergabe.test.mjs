// KAN-457 (14.11.2026): Profile „Vertrieb“ und „Extern“ in der Benutzerverwaltung vergeben.
// Bisher ließ sich ein Profil nur per SQL setzen; die Datenbank erzwang nicht, dass die Schreibmodule zum Profil
// passen. Neu: Auswahl beim Einladen und am Mitglied (/benutzer, Mandantenverwaltung); die Schreibmodule folgen dem
// Profil – in der App gesetzt und per Trigger z_profil_module erzwungen. Datenbank: DB-Test 03_profil.
//
// Aufruf:  npm run -s test:csv
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PROFILE } from '../../src/lib/auth/lesebereiche.ts'
import { rolleProfilAus, rolleProfilWert, profilSchreibmodule, PROFIL_ROLLEN_WAHL } from '../../src/lib/auth/rolleProfil.ts'

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
const M = migration('kan457a_profil_module')

describe('KAN-457: Rolle und Profil in einem Auswahlwert (Mandantenverwaltung)', () => {
  test('Rolle allein, Mitarbeiter mit Profil; alles andere ist ungültig', () => {
    assert.deepEqual(rolleProfilAus('winzer'), { role: 'winzer', profil: null })
    assert.deepEqual(rolleProfilAus('tenant_admin'), { role: 'tenant_admin', profil: null })
    assert.deepEqual(rolleProfilAus('winzer:vertrieb'), { role: 'winzer', profil: 'vertrieb' })
    assert.deepEqual(rolleProfilAus('winzer:extern'), { role: 'winzer', profil: 'extern' })
    for (const w of ['', null, undefined, 5, 'winzer:chef', 'leser:extern', 'tenant_admin:vertrieb', 'winzer:extern:x', ':extern', 'winzer:']) assert.equal(rolleProfilAus(w), null, String(w))
  })
  test('Hin und zurück; ein Profil an einer anderen Rolle wird nicht angezeigt', () => {
    for (const p of Object.keys(PROFILE)) assert.deepEqual(rolleProfilAus(rolleProfilWert('winzer', p)), { role: 'winzer', profil: p })
    assert.equal(rolleProfilWert('leser', 'extern'), 'leser')
    assert.equal(rolleProfilWert('winzer', null), 'winzer')
    assert.equal(rolleProfilWert('winzer', 'chef'), 'winzer')
  })
  test('Auswahl: je Profil ein Eintrag; Schreibmodule aus PROFILE', () => {
    assert.deepEqual(PROFIL_ROLLEN_WAHL.map(p => p.value), Object.keys(PROFILE).map(p => `winzer:${p}`))
    assert.deepEqual(profilSchreibmodule('vertrieb'), ['warenwirtschaft', 'crm', 'auswertungen'])
    assert.deepEqual(profilSchreibmodule('extern'), ['rieden'])
  })
})

describe('KAN-457: Migration kan457a – die Datenbank erzwingt Module = Profil', () => {
  test('dieselben Schreibmodule wie PROFILE in der App', () => {
    for (const [p, def] of Object.entries(PROFILE)) {
      const m = new RegExp(`WHEN '${p}'\\s+THEN ARRAY\\[([^\\]]*)\\]`).exec(M)
      assert.ok(m, p)
      assert.deepEqual(m[1].split(',').map(x => x.trim().replace(/'/g, '')), [...def.schreibmodule], p)
    }
  })
  test('Trigger vor INSERT und UPDATE, nach der Modul-Vorgabe; Funktion für Benutzer nicht aufrufbar', () => {
    assert.match(M, /CREATE TRIGGER z_profil_module BEFORE INSERT OR UPDATE ON public\.tenant_memberships\n\s+FOR EACH ROW EXECUTE FUNCTION public\.s112_mitglied_profil_module\(\);/)
    assert.match(M, /REVOKE EXECUTE ON FUNCTION public\.s112_mitglied_profil_module\(\) FROM PUBLIC, anon, authenticated;/)
    assert.match(M, /SECURITY DEFINER\nSET search_path = public/)
  })
  test('Rollenwechsel weg vom Mitarbeiter leert das Profil – ein ausdrücklich gesetztes Profil an anderer Rolle bleibt ein Fehler', () => {
    assert.match(M, /IF TG_OP = 'UPDATE' AND NEW\.role IS DISTINCT FROM 'winzer' AND OLD\.role = 'winzer'\n\s+AND NEW\.profil IS NOT NULL AND NEW\.profil IS NOT DISTINCT FROM OLD\.profil THEN\n\s+NEW\.profil := NULL;/)
    assert.doesNotMatch(M, /DROP CONSTRAINT/)
  })
  test('Selbstprüfung: kein Mitglied mit Profil und abweichenden Modulen', () => {
    assert.match(M, /RAISE EXCEPTION 'KAN-457: % Mitglieder mit Profil und abweichenden Schreibmodulen'/)
  })
})

describe('KAN-457: Server Actions', () => {
  const a = quelle('src/app/(dashboard)/benutzer/actions.ts')
  test('unbekanntes Profil ist ein Fehler – nie still „ohne Profil“ (das gäbe mehr Rechte)', () => {
    assert.match(a, /return istProfil\(roh\) \? \{ profil: roh \} : \{ error: 'Ungültiges Profil' \}/)
    assert.equal([...a.matchAll(/const p = profilAusEingabe\(profilRoh\)\n {2}if \('error' in p\) return \{ error: p\.error \}/g)].length, 3)   // einladen, Rolle, Profil
  })
  test('Profil nur für Mitarbeiter; mit Profil kommen die Module aus dem Profil', () => {
    assert.equal([...a.matchAll(/return \{ error: 'Ein Profil gibt es nur für Mitarbeiter\.' \}/g)].length, 3)
    assert.match(a, /schreibmodule: role === 'winzer' \? \(p\.profil \? profilModule\(p\.profil\) : moduleBereinigen\(module\)\) : null,\n\s+profil: p\.profil,/)
    assert.match(a, /const patch: R = \{ role: newRole, profil: p\.profil \}/)
    assert.match(a, /patch\.schreibmodule = p\.profil \? profilModule\(p\.profil\) : module \? moduleBereinigen\(module\) : ALLE_MODULE/)
  })
  test('Modulmatrix nur ohne Profil änderbar; Profil setzen nur an Mitarbeitern des eigenen Betriebs', () => {
    assert.match(a, /\.eq\('role', 'winzer'\)\n\s+\.is\('profil', null\)/)
    const u = a.slice(a.indexOf('export async function updateMemberProfil'))
    assert.match(u, /canManageUsers\(membership\.role\)/)
    assert.match(u, /\.eq\('id', membershipId\)\n\s+\.eq\('tenant_id', membership\.tenantId\)\n\s+\.eq\('role', 'winzer'\)/)
    assert.ok(u.indexOf('seitenBetriebFehler') < u.indexOf('schreibSperreFehler') && u.indexOf('schreibSperreFehler') < u.indexOf('canManageUsers'))
  })
  test('Mitgliederliste liefert das Profil; die Einladung schreibt es', () => {
    assert.match(a, /\.select\('id, user_id, role, created_at, aktiv, schreibmodule, profil'\)/)
    assert.match(quelle('src/lib/auth/einladung.ts'), /if \(p\.profil\) zeile\.profil = p\.profil/)
  })
  test('Mandantenverwaltung: Rolle und Profil aus einem Wert; fällt das Profil weg, wieder alle Module', () => {
    const m = quelle('src/app/(dashboard)/admin/mandanten/[id]/actions.ts')
    assert.equal([...m.matchAll(/const rp = rolleProfilAus\(rolleWert\)/g)].length, 2)
    assert.equal([...m.matchAll(/if \(!rp \|\| !VERGEBBARE_ROLLEN\.includes\(rp\.role\)\) return \{ error: 'Ungültige Rolle' \}/g)].length, 2)
    assert.match(m, /else if \(role === 'winzer' && bisher\?\.profil\) patch\.schreibmodule = \['rieden', 'kellerbuch', 'warenwirtschaft', 'crm', 'ea', 'auswertungen'\]/)
    assert.match(m, /if \(bisherFehler\) return \{ error: dbFehlerText\(bisherFehler, 'Mitgliedschaft konnte nicht geladen werden'\) \}/)
  })
})

describe('KAN-457: Oberfläche und Hilfe', () => {
  test('/benutzer: Auswahl „Zugriff“ beim Einladen und Bearbeiten; mit Profil ist die Matrix fest', () => {
    const c = quelle('src/app/(dashboard)/benutzer/BenutzerClient.tsx')
    assert.equal([...c.matchAll(/<ZugriffWahl profil=/g)].length, 2)
    assert.match(c, /disabled=\{isPending \|\| !!selectedProfil\}/)
    assert.match(c, /disabled=\{isPending \|\| !!inviteProfil\}/)
    assert.match(c, /Profil \{PROFILE\[m\.profil\]\.label\}/)
  })
  test('Handbuch und FAQ erklären die Profile', () => {
    assert.match(quelle('src/app/(dashboard)/hilfe/handbuch/page.tsx'), /Profile Vertrieb und Extern/)
    const f = quelle('src/app/(dashboard)/hilfe/faq/page.tsx')
    assert.match(f, /Was ist ein Profil \(Vertrieb, Extern\)\?/)
    assert.match(f, /Ein Mitarbeiter mit Profil sieht einen Bereich nicht – warum\?/)
  })
})
