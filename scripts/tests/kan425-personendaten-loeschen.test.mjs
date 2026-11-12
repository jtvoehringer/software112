// KAN-425 Teil 1 (12.11.2026): Personendaten eines Kontakts löschen (DSGVO) – Regeln und Verdrahtung.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  DOKUMENT_BUCKET, GELOESCHTER_KONTAKT, PERSONENDATEN_HINWEIS, istAnonymisiert, personendatenErfolgText,
  personendatenErgebnisAus, personendatenGrundFehler,
} from '../../src/lib/crm/personendaten.ts'

const WURZEL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const quelle = p => readFileSync(path.join(WURZEL, p), 'utf8').replace(/\r\n/g, '\n')

describe('KAN-425: Regeln', () => {
  test('Grund: mindestens 10, höchstens 500 Zeichen, Ränder zählen nicht', () => {
    assert.match(personendatenGrundFehler(''), /mindestens 10 Zeichen/)
    assert.match(personendatenGrundFehler('   kurz    '), /mindestens 10 Zeichen/)
    assert.match(personendatenGrundFehler(null), /mindestens 10 Zeichen/)
    assert.equal(personendatenGrundFehler('Löschersuchen per E-Mail'), null)
    assert.equal(personendatenGrundFehler('x'.repeat(500)), null)
    assert.match(personendatenGrundFehler('x'.repeat(501)), /höchstens 500/)
  })
  test('Antwort der RPC: Art und Dateipfade, alles andere ist unerwartet', () => {
    assert.deepEqual(personendatenErgebnisAus({ art: 'geloescht', dateien: [] }), { art: 'geloescht', dateien: [] })
    assert.deepEqual(personendatenErgebnisAus([{ art: 'anonymisiert', dateien: ['t/a/1.pdf', '', 7, null] }]), { art: 'anonymisiert', dateien: ['t/a/1.pdf'] })
    assert.deepEqual(personendatenErgebnisAus({ art: 'anonymisiert' }), { art: 'anonymisiert', dateien: [] })
    assert.equal(personendatenErgebnisAus({ art: 'irgendwas' }), null)
    assert.equal(personendatenErgebnisAus(null), null)
    assert.equal(personendatenErgebnisAus('ok'), null)
  })
  test('Texte: Rückfrage nennt, was bleibt und was software:112 nicht löscht', () => {
    assert.match(PERSONENDATEN_HINWEIS, /Belege selbst behalten Name und Adresse/)
    assert.match(PERSONENDATEN_HINWEIS, /Postfach des Betriebs/)
    assert.match(PERSONENDATEN_HINWEIS, /nicht rückgängig/)
    assert.match(personendatenErfolgText('geloescht'), /wurden gelöscht\.$/)
    assert.match(personendatenErfolgText('anonymisiert'), /„Gelöschter Kontakt“/)
    assert.equal(GELOESCHTER_KONTAKT, 'Gelöschter Kontakt')
    assert.equal(istAnonymisiert({ anonymisiert_am: '2026-11-12T10:00:00Z' }), true)
    assert.equal(istAnonymisiert({ anonymisiert_am: null }), false)
    assert.equal(istAnonymisiert(null), false)
  })
})

describe('KAN-425: Verdrahtung', () => {
  const aktionen = quelle('src/app/(dashboard)/crm/actions.ts')
  const fn = aktionen.slice(aktionen.indexOf('export async function kontaktPersonendatenLoeschen('), aktionen.indexOf('// ── Kontakt → Firma umwandeln'))
  test('Server Action: Grund und Rechte vor der RPC, Adressen vorher gemerkt', () => {
    const grund = fn.indexOf('personendatenGrundFehler(grund)'), recht = fn.indexOf('await crmSchreibTenant()')
    const lesen = fn.indexOf(".select('id, email, email_weitere, anonymisiert_am')"), rpc = fn.indexOf("'s112_kontakt_personendaten_loeschen'")
    assert.ok(grund > 0 && recht > grund && lesen > recht && rpc > lesen, 'Reihenfolge Grund → Recht → lesen → RPC')
    assert.match(fn, /p_tenant_id: tenantId, p_kontakt_id: id, p_grund: grund\.trim\(\),/)
    assert.match(fn, /if \(kErr\) return \{ error: dbFehlerText\(kErr/)
    assert.match(fn, /if \(error\) return \{ error: dbFehlerText\(error, 'Die Personendaten konnten nicht gelöscht werden'\) \}/)
  })
  test('Server Action: Dateien nur im eigenen Betrieb, Brevo-Kontakt gelöscht, Fehler danach gemeldet statt verschwiegen', () => {
    assert.match(fn, /erg\.dateien\.filter\(p => p\.startsWith\(`\$\{tenantId\}\/`\)\)/)
    assert.match(fn, /admin\.storage\.from\(DOKUMENT_BUCKET\)\.remove\(dateien\)/)
    assert.equal(DOKUMENT_BUCKET, 'aktivitaet-dokumente')
    assert.match(quelle('src/app/api/crm/aktivitaet/[id]/dokument/route.ts'), /storage\.from\('aktivitaet-dokumente'\)/)
    assert.match(fn, /if \(betrieb\?\.zugang\) for \(const a of adressen\) await deleteContact\(a, betrieb\.zugang\)/)
    assert.equal((fn.match(/await ereignisMelden\(/g) ?? []).length, 2)
    assert.match(fn, /hinweis: offen\.length > 0 \?/)
    const brevo = quelle('src/lib/brevo/api.ts')
    assert.match(brevo, /export async function deleteContact\(email: string, zugang: BrevoZugang\)/)
    assert.match(brevo, /contacts\/\$\{encodeURIComponent\(email\)\}\?identifierType=email_id`, \{\s*method: 'DELETE'/)
    assert.match(brevo, /if \(!res\.ok && res\.status !== 404\)/)
  })
  test('Kontaktseite: Knopf mit Pflicht-Grund, anonymisierter Kontakt nur lesbar', () => {
    const s = quelle('src/app/(dashboard)/crm/kontakte/[id]/KontaktDetailClient.tsx')
    assert.match(s, /<StornoButton modus="loeschen" mitText schwebend label="Personendaten löschen \(DSGVO\)"\s+hinweis=\{PERSONENDATEN_HINWEIS\} action=\{handlePersonendaten\} \/>/)
    assert.match(s, /const anonymisiert = istAnonymisiert\(kontakt\)\n\s*const writeOk = darfSchreiben && !anonymisiert/)
    assert.match(s, /\{anonymisiert && \(\s*<div role="status"/)
    assert.match(s, /if \(r\.art === 'geloescht'\) router\.push\('\/crm\/kontakte'\)/)
    assert.match(quelle('src/lib/crm/liste.ts'), /stammkunde, aktiv, anonymisiert_am, notizen,/)
  })
  test('Migration: Spalten, Schutz-Trigger, RPC mit Prüfungen, Momentaufnahme-Wächter, Protokoll ohne Altwerte', () => {
    const ordner = path.join(WURZEL, 'supabase', 'migrations')
    const datei = readdirSync(ordner).find(f => f.endsWith('_kan425_personendaten_loeschen.sql'))
    const entwurf = path.join(WURZEL, 'supabase', 'entwurf', 'kan425_personendaten_loeschen.sql')
    const pfad = datei ? path.join(ordner, datei) : entwurf   // Entwurfsordner ist nicht eingecheckt
    if (!existsSync(pfad)) return
    const sql = readFileSync(pfad, 'utf8').replace(/\r\n/g, '\n')
    assert.match(sql, /ADD COLUMN anonymisiert_am\s+timestamptz,\s+ADD COLUMN anonymisiert_von\s+uuid,\s+ADD COLUMN anonymisiert_grund text CHECK/)
    assert.match(sql, /CREATE TRIGGER a_anonymisiert_schutz\s+BEFORE INSERT OR UPDATE ON public\.kontakte/)
    const rpc = sql.slice(sql.indexOf('CREATE FUNCTION public.s112_kontakt_personendaten_loeschen'))
    for (const p of ["pruefe_tenant_zugriff(p_tenant_id, ARRAY['system_admin', 'tenant_admin', 'winzer'])", 's112_pruefe_abo_schreibsperre(p_tenant_id)', "s112_pruefe_schreibmodul(p_tenant_id, 'crm')"]) {
      assert.ok(rpc.includes(`PERFORM public.${p};`), p)
    }
    assert.match(rpc, /SET search_path = public/)
    assert.match(rpc, /HINT = 'momentaufnahme_fehlt'/)
    for (const t of ['verkaufsposten', 'rechnungen', 'zukauf_posten', 'exportauftraege', 'traubenverkauf']) assert.match(rpc, new RegExp(`FROM public\\.${t} x WHERE .* AND x\\.partner_daten IS NULL`), t)
    for (const t of ['aktivitaeten', 'pipeline_eintraege', 'lieferadressen', 'kontakt_firmen', 'kontakt_praeferenzen', 'datenschutz_consents', 'verkauf_ki_begriffe']) assert.match(rpc, new RegExp(`DELETE FROM public\\.${t} WHERE kontakt_id = p_kontakt_id`), t)
    // Protokoll: nur Vorgang, Kundennummer und Grund – keine Spalten alt/neu
    assert.match(rpc, /INSERT INTO public\.bestandsprotokoll \(tenant_id, tabelle, aktion, datensatz_id, benutzer_id, db_rolle, kennung, grund\)/)
    assert.match(sql, /REVOKE EXECUTE ON FUNCTION public\.s112_kontakt_personendaten_loeschen\(uuid, uuid, text\) FROM PUBLIC, anon;/)
    assert.match(sql, /REVOKE EXECUTE ON FUNCTION public\.s112_kontakt_anonymisiert_schutz\(\) FROM PUBLIC, anon, authenticated;/)
  })
})
