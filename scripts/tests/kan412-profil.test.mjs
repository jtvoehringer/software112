// KAN-412 R1 (13.11.2026): Profile „Vertrieb“ und „Extern“ – Grundlage ohne Wirkung.
// Befund: Jedes aktive Mitglied liest alles im Betrieb; nur das Schreiben ist je Modul geregelt. Neu: Profil an der
// Mitgliedschaft, Lesebereich je Tabelle (scripts/lesebereiche.json), Funktionen für die späteren Sperr-Policies.
// Die Bereiche eines Profils stehen an drei Stellen (App, Liste, Datenbank) – dieser Test hält sie gleich.
//
// Aufruf:  npm run -s test:csv
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { LESEBEREICHE, PROFILE, canRead, istLesebereich, istProfil, lesbareBereiche, profilAus } from '../../src/lib/auth/lesebereiche.ts'

const require = createRequire(import.meta.url)
const { pruefe } = require('../check-lesebereiche.js')

const WURZEL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const quelle = p => readFileSync(path.join(WURZEL, p), 'utf8').replace(/\r\n/g, '\n')
const LISTE = JSON.parse(quelle('scripts/lesebereiche.json'))
const SCHEMA = JSON.parse(quelle('scripts/schema.json'))
function migration(name) {
  const dir = path.join(WURZEL, 'supabase', 'migrations')
  const datei = readdirSync(dir).find(d => d.endsWith(`_${name}.sql`))
  if (datei) return quelle(path.join('supabase', 'migrations', datei))
  const entwurf = path.join('supabase', 'entwurf', `${name}.sql`)
  assert.ok(existsSync(path.join(WURZEL, entwurf)), `Migration ${name} fehlt in supabase/migrations`)
  return quelle(entwurf)
}

describe('KAN-412: Leserecht je Profil', () => {
  test('ohne Profil liest jede Rolle alles – wie bisher', () => {
    for (const role of ['system_admin', 'tenant_admin', 'winzer', 'leser']) {
      assert.deepEqual(lesbareBereiche({ role, profil: null }), [...LESEBEREICHE], role)
      assert.equal(canRead({ role }, 'ea'), true, role)
    }
  })
  test('Extern: nur Allgemeines, Rieden und Maßnahmen', () => {
    const m = { role: 'winzer', profil: 'extern' }
    assert.deepEqual(lesbareBereiche(m), ['allgemein', 'rieden', 'massnahmen'])
    for (const b of ['betriebsmittel', 'lese', 'keller', 'lager', 'verkauf', 'crm', 'ea', 'controlling', 'ki', 'betrieb', 'verwaltung']) assert.equal(canRead(m, b), false, b)
  })
  test('Vertrieb: CRM, Verkauf, Lager, Auswertungen – nicht Keller, Rieden, E&A-Rechnung', () => {
    const m = { role: 'winzer', profil: 'vertrieb' }
    assert.deepEqual(lesbareBereiche(m), ['allgemein', 'lager', 'verkauf', 'crm', 'controlling', 'ki', 'betrieb'])
    for (const b of ['rieden', 'massnahmen', 'betriebsmittel', 'lese', 'keller', 'ea', 'verwaltung']) assert.equal(canRead(m, b), false, b)
  })
  test('ein Profil gilt nur für Mitarbeiter; unbekanntes Profil bzw. keine Mitgliedschaft', () => {
    assert.equal(profilAus('winzer', 'extern'), 'extern')
    assert.equal(profilAus('tenant_admin', 'extern'), null)   // die Datenbank verhindert die Kombination (CHECK), die App rechnet trotzdem sicher
    assert.equal(profilAus('leser', 'vertrieb'), null)
    assert.equal(profilAus('winzer', 'chef'), null)
    assert.equal(profilAus('winzer', 'toString'), null)
    assert.equal(canRead(null, 'allgemein'), false)
    assert.equal(canRead({ role: null, profil: 'extern' }, 'rieden'), false)
    assert.equal(istProfil('vertrieb'), true)
    assert.equal(istLesebereich('crm'), true)
    assert.equal(istLesebereich('alles'), false)
  })
  test('die Schreibmodule eines Profils liegen in seinen Lesebereichen (kein Schreiben ohne Lesen)', () => {
    const MODUL_BEREICHE = { rieden: ['rieden', 'massnahmen'], kellerbuch: ['keller'], warenwirtschaft: ['verkauf', 'lager'], crm: ['crm'], ea: ['ea'], auswertungen: ['controlling'] }
    for (const [name, p] of Object.entries(PROFILE)) {
      for (const modul of p.schreibmodule) assert.ok(MODUL_BEREICHE[modul].some(b => p.lesen.includes(b)), `${name}: ${modul}`)
    }
  })
})

describe('KAN-412: App, Liste und Datenbank nennen dieselben Bereiche', () => {
  const m = migration('kan412a_profil')
  test('Bereiche: Liste = App', () => {
    assert.deepEqual(Object.keys(LISTE.bereiche), [...LESEBEREICHE])
  })
  for (const profil of Object.keys(PROFILE)) {
    test(`Profil „${profil}“: App = Liste = Datenbank`, () => {
      const app = [...PROFILE[profil].lesen].sort()
      assert.deepEqual([...LISTE.profile[profil]].sort(), app)
      const treffer = new RegExp(`WHEN '${profil}'\\s+THEN ARRAY\\[([^\\]]+)\\]`).exec(m)
      assert.ok(treffer, 'Zeile in s112_profil_bereiche')
      assert.deepEqual(treffer[1].split(',').map(s => s.trim().replace(/'/g, '')).sort(), app)
    })
  }
  test('die Liste kennt genau die Profile der App', () => {
    assert.deepEqual(Object.keys(LISTE.profile).sort(), Object.keys(PROFILE).sort())
  })
})

describe('KAN-412: Wächter check-lesebereiche', () => {
  test('der aktuelle Stand ist vollständig: jede Tabelle genau ein Bereich', () => {
    assert.deepEqual(pruefe(LISTE, SCHEMA), [])
    assert.equal(Object.keys(LISTE.tabellen).length, Object.keys(SCHEMA).length)
  })
  test('neue Tabelle ohne Bereich, verwaiste Tabelle, unbekannter Bereich, Profil ohne „allgemein“, falscher Spalten-Fall', () => {
    assert.match(pruefe(LISTE, { ...SCHEMA, neue_tabelle: ['id'] }).join('|'), /Tabelle „neue_tabelle“ hat keinen Lesebereich/)
    assert.match(pruefe({ ...LISTE, tabellen: { ...LISTE.tabellen, gibt_es_nicht: 'crm' } }, SCHEMA).join('|'), /„gibt_es_nicht“ steht in der Liste, aber nicht in scripts\/schema\.json/)
    assert.match(pruefe({ ...LISTE, tabellen: { ...LISTE.tabellen, kontakte: 'kunden' } }, SCHEMA).join('|'), /„kontakte“: unbekannter Bereich „kunden“/)
    assert.match(pruefe({ ...LISTE, profile: { ...LISTE.profile, extern: ['rieden'] } }, SCHEMA).join('|'), /Profil „extern“ braucht den Bereich „allgemein“/)
    assert.match(pruefe({ ...LISTE, spaltenfaelle: [{ tabelle: 'grundstuecke', profil: 'extern', spalten: ['pachtzins'] }] }, SCHEMA).join('|'), /unbekannte Spalte „pachtzins“/)
  })
  test('im Build eingehängt', () => {
    assert.match(JSON.parse(quelle('package.json')).scripts.prebuild, /node scripts\/check-lesebereiche\.js/)
  })
  test('heikle Zuordnungen bleiben, wo sie entschieden sind', () => {
    const t = LISTE.tabellen
    assert.equal(t.fuellungen, 'lager')            // Vertrieb verkauft Füllungen
    assert.equal(t.weinausbau, 'keller')           // Chargen sieht Vertrieb nicht
    assert.equal(t.bestandsprotokoll, 'verwaltung')// Änderungsprotokoll: keines der Profile
    assert.equal(t.ea_transaktionen, 'ea')
    assert.equal(t.psm_lager_bewegungen, 'betriebsmittel')
    assert.equal(t.behandlungen, 'massnahmen')
    assert.equal(t.kontakte, 'crm')
    for (const p of Object.keys(LISTE.profile)) assert.ok(!LISTE.profile[p].includes('verwaltung') && !LISTE.profile[p].includes('ea'), p)
  })
})

describe('KAN-412: Migration und Mitgliedschaft', () => {
  const m = migration('kan412a_profil')
  test('Profil nur für Mitarbeiter, nur die zwei Werte; noch keine Policy', () => {
    assert.match(m, /ADD CONSTRAINT tenant_memberships_profil_chk CHECK \(profil IS NULL OR profil IN \('vertrieb', 'extern'\)\),/)
    assert.match(m, /ADD CONSTRAINT tenant_memberships_profil_rolle_chk CHECK \(profil IS NULL OR role = 'winzer'\);/)
    assert.doesNotMatch(m, /CREATE POLICY/)
  })
  test('Funktionen: search_path, nicht für anonyme Aufrufe; ohne Profil ist nichts gesperrt', () => {
    assert.equal(m.split('SET search_path = public').length - 1, 3)
    for (const fn of ['s112_profil_bereiche(text)', 's112_lesegesperrte_tenants(text)', 's112_darf_lesen(uuid, text)']) {
      assert.ok(m.includes(`REVOKE EXECUTE ON FUNCTION public.${fn} FROM PUBLIC, anon;`), fn)
      assert.ok(m.includes(`GRANT EXECUTE ON FUNCTION public.${fn} TO authenticated;`), fn)
    }
    assert.match(m, /WHERE m\.user_id = \(SELECT auth\.uid\(\)\)\n\s+AND m\.profil IS NOT NULL\n\s+AND NOT \(p_bereich = ANY \(public\.s112_profil_bereiche\(m\.profil\)\)\)/)
  })
  test('getCurrentMembership lädt das Profil in allen drei Abfragen; canRead kommt aus lesebereiche', () => {
    const r = quelle('src/lib/auth/roles.ts')
    assert.equal(r.split("'tenant_id, role, schreibmodule, profil").length - 1, 3)
    assert.match(r, /const profil = profilAus\(role, d\.profil\)/)
    // ohne Profil bleibt das Objekt genau wie bisher (kein Feld „profil“)
    assert.match(r, /\.\.\.\(profil \? \{ profil \} : \{\}\) \}/)
    assert.match(r, /export \{ canRead, type Lesebereich, type Profil \} from '\.\/lesebereiche'/)
  })
  test('Dokument zur Abnahme nennt jede Tabelle und die Spalten-Fälle', () => {
    const d = quelle('docs/Leserechte.md')
    for (const t of Object.keys(LISTE.tabellen)) assert.ok(d.includes(t), t)
    for (const f of LISTE.spaltenfaelle) assert.ok(d.includes(`\`${f.tabelle}\` | ${f.profil}`), f.tabelle)
  })
})
