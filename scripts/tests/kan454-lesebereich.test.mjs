// KAN-454 (13.11.2026): Rollen/Rechte R2 – Sperr-Policies „lesebereich“ auf allen Tabellen.
// Befund vor R2: Das Profil (KAN-412) stand an der Mitgliedschaft, die Datenbank lieferte aber weiter jedem Mitglied alle
// Zeilen des Betriebs. Neu: je Tabelle außerhalb von „allgemein“ eine RESTRICTIVE-SELECT-Policy. Die Liste der Policies
// steht an drei Stellen (scripts/lesebereiche.json → Migration → DB-Test 02) – dieser Test hält sie gleich.
//
// Aufruf:  npm run -s test:csv
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const { pruefe } = require('../check-lesebereiche.js')
const { zeilen, werteSql, sollListe } = require('../lesebereich-sql.js')

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
const M = migration('kan412b_lesebereich')
const DBTEST = quelle('scripts/db-tests/02_lesebereich.sql')
/** Inhalt von `<name> constant text[] := ARRAY[ … ];` als Liste */
function feld(name) {
  const m = new RegExp(`${name}\\s+constant text\\[\\] := ARRAY\\[([\\s\\S]*?)\\];`).exec(DBTEST)
  assert.ok(m, `${name} im DB-Test 02`)
  return [...m[1].matchAll(/'([^']+)'/g)].map(x => x[1])
}

describe('KAN-454: Liste der Sperr-Policies', () => {
  const z = zeilen(LISTE)
  test('jede Tabelle außerhalb von „allgemein“ bekommt genau eine Policy – Sichten keine', () => {
    const erwartet = Object.keys(LISTE.tabellen).filter(t => LISTE.tabellen[t] !== 'allgemein' && !LISTE.sichten.includes(t)).sort()
    assert.deepEqual(z.map(x => x.tabelle), erwartet)
    assert.equal(z.length, 125)
    assert.equal(new Set(z.map(x => x.tabelle)).size, z.length)
  })
  test('drei Formen: Betrieb (tenant_id), Kind (Elternzeile), Freigabe (beide Betriebe)', () => {
    const anzahl = art => z.filter(x => x.art === art).length
    assert.deepEqual([anzahl('tenant'), anzahl('kind'), anzahl('freigabe')], [106, 17, 2])
    for (const x of z) {
      if (x.art === 'tenant') assert.ok(SCHEMA[x.tabelle].includes('tenant_id'), `${x.tabelle} ohne tenant_id`)
      if (x.art === 'kind') {
        assert.ok(!SCHEMA[x.tabelle].includes('tenant_id'), x.tabelle)
        assert.ok(SCHEMA[x.tabelle].includes(x.spalte), `${x.tabelle}.${x.spalte}`)
        assert.equal(z.find(e => e.tabelle === x.eltern)?.art, 'tenant', `${x.tabelle}: Elterntabelle ${x.eltern} trägt die Sperre`)
        assert.equal(LISTE.tabellen[x.eltern], x.bereich, `${x.tabelle}: Bereich wie die Elterntabelle`)
      }
    }
    assert.deepEqual(z.filter(x => x.art === 'freigabe').map(x => x.tabelle), ['crm_freigaben', 'keller_freigaben'])
  })
  test('heikle Fälle: Lesedaten hängen am Jahrgang, globale Kataloge bleiben offen', () => {
    assert.deepEqual(z.find(x => x.tabelle === 'ernte_parzellen'), { tabelle: 'ernte_parzellen', bereich: 'lese', art: 'kind', eltern: 'weinjahrgaenge', spalte: 'jahrgang_id' })
    assert.equal(LISTE.tabellen.elabel_zutaten, 'allgemein')   // globaler Katalog ohne Betrieb
    assert.equal(LISTE.tabellen.svs_parameter, 'allgemein')    // globale Beitragssätze ohne Betrieb
    for (const t of ['elabel_zutaten', 'svs_parameter', 'tenants', 'tenant_memberships', 'profiles']) assert.ok(!z.some(x => x.tabelle === t), t)
    for (const t of LISTE.sichten) assert.ok(!z.some(x => x.tabelle === t), t)
  })
})

describe('KAN-454: Migration, Liste und DB-Test nennen dieselben Policies', () => {
  test('die VALUES-Liste der Migration ist die Ausgabe von lesebereich-sql.js', () => {
    const m = /FOR r IN SELECT \* FROM \(VALUES\n([\s\S]*?)\n {2}\) AS t\(tabelle, bereich, art, eltern, spalte\) LOOP/.exec(M)
    assert.ok(m, 'VALUES-Liste in der Migration')
    assert.equal(m[1], werteSql(LISTE))
  })
  test('die Soll-Liste des DB-Tests 02 ist die Ausgabe von lesebereich-sql.js', () => {
    assert.deepEqual(feld('c_soll'), sollListe(LISTE))
  })
  test('der DB-Test kennt genau die Tabellen des Bereichs „allgemein“ (ohne Policy)', () => {
    assert.deepEqual(feld('c_allgemein'), Object.keys(LISTE.tabellen).filter(t => LISTE.tabellen[t] === 'allgemein').sort())
  })
  test('Policies: RESTRICTIVE, nur SELECT, nur authenticated – eine Auswertung je Abfrage', () => {
    const anlagen = [...M.matchAll(/CREATE POLICY lesebereich ON public\.%I AS RESTRICTIVE FOR SELECT TO authenticated USING/g)]
    assert.equal(anlagen.length, 3)
    assert.equal([...M.matchAll(/CREATE POLICY/g)].length, 3, 'keine weitere Policy in dieser Migration')
    assert.match(M, /NOT \(tenant_id IN \(SELECT public\.s112_lesegesperrte_tenants\(%L\)\)\)/)   // Unterabfrage = InitPlan, nicht je Zeile
    assert.match(M, /EXISTS \(SELECT 1 FROM public\.%I e WHERE e\.id = %I\.%I\)/)
    assert.match(M, /NOT \(eigentuemer_tenant_id IN \([^)]+\(%L\)\)\) AND NOT \(nutzer_tenant_id IN/)
    assert.doesNotMatch(M, /FOR (ALL|INSERT|UPDATE|DELETE)/)
  })
  test('die Sperre gilt nur für Mitglieder mit Profil und sperrt Partnerbetriebe einer Gemeinschaft mit', () => {
    assert.match(M, /m\.profil IS NOT NULL AND NOT \(p_bereich = ANY \(public\.s112_profil_bereiche\(m\.profil\)\)\)/)
    assert.match(M, /FROM public\.keller_freigaben f WHERE f\.aktiv\s+UNION\s+SELECT [^;]+FROM public\.crm_freigaben f WHERE f\.aktiv/)
    assert.match(M, /SECURITY DEFINER\s+SET search_path = public/)
    assert.doesNotMatch(M, /GRANT /)   // Rechte bleiben wie in kan412a (CREATE OR REPLACE behält sie)
  })
})

describe('KAN-454: Wächter check-lesebereiche kennt die Form der Policy', () => {
  const mit = aenderung => pruefe({ ...LISTE, ...aenderung }, SCHEMA).join('|')
  test('der aktuelle Stand ist vollständig', () => {
    assert.deepEqual(pruefe(LISTE, SCHEMA), [])
  })
  test('Tabelle ohne tenant_id braucht eine Form', () => {
    const { ernte_parzellen: _weg, ...kinder } = LISTE.kinder
    assert.match(mit({ kinder }), /Tabelle „ernte_parzellen“ \(lese\) hat keine tenant_id – als Kindtabelle/)
    assert.match(pruefe(LISTE, { ...SCHEMA, neue_kind: ['id', 'kontakt_id'] }).join('|'), /„neue_kind“ hat keinen Lesebereich/)
    assert.match(pruefe({ ...LISTE, tabellen: { ...LISTE.tabellen, neue_kind: 'crm' } }, { ...SCHEMA, neue_kind: ['id', 'kontakt_id'] }).join('|'), /„neue_kind“ \(crm\) hat keine tenant_id/)
  })
  test('Kindtabelle: Spalte, Elterntabelle und Bereich müssen passen', () => {
    assert.match(mit({ kinder: { ...LISTE.kinder, kontakt_firmen: { eltern: 'kontakte', spalte: 'kontakt' } } }), /„kontakt_firmen“: unbekannte Spalte „kontakt“/)
    assert.match(mit({ kinder: { ...LISTE.kinder, kontakt_firmen: { eltern: 'kunden', spalte: 'kontakt_id' } } }), /unbekannte Elterntabelle „kunden“/)
    assert.match(mit({ kinder: { ...LISTE.kinder, kontakt_firmen: { eltern: 'pressung_behaelter', spalte: 'kontakt_id' } } }), /muss eine Tabelle mit tenant_id sein/)
    assert.match(mit({ kinder: { ...LISTE.kinder, kontakt_firmen: { eltern: 'behaelter', spalte: 'kontakt_id' } } }), /liegen in verschiedenen Bereichen/)
    assert.match(mit({ kinder: { ...LISTE.kinder, kontakte: { eltern: 'firmen', spalte: 'id' } } }), /„kontakte“ hat eine tenant_id/)
  })
  test('Freigabe braucht beide Betriebsspalten; Sicht und Freigabe müssen existieren', () => {
    assert.match(mit({ freigaben: [...LISTE.freigaben, 'kontakte'] }), /Freigabe „kontakte“: Spalte „eigentuemer_tenant_id“ fehlt/)
    assert.match(mit({ sichten: [...LISTE.sichten, 'v_gibt_es_nicht'] }), /Sicht „v_gibt_es_nicht“ steht nicht in scripts\/schema\.json/)
  })
})
