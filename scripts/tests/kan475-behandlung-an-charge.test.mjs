// KAN-475 (16.11.2026, BKI-Sitzung): Kellerbehandlungen gehören zur Charge, nicht zum Gebinde.
// S1: Erfassen und Anzeigen an der Charge; das Gebinde ist nur die Angabe „lag damals in …“. Ohne Charge bleibt am
// Gebinde die Gebindepflege (Reinigen, Konservieren, Umbenennung, Notiz). Dashboard: letzte Maßnahme je Charge.
// Das Verhalten der Datenbank prüft scripts/db-tests/99_behandlung_an_charge.sql (Staging).
//
// Aufruf:  npm run -s test:csv
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { BEHANDLUNG_OHNE_CHARGE, behandlungCharge, behandlungOhneChargeFehler } from '../../src/lib/kellerbuch/behandlungRegeln.ts'

const WURZEL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const quelle = p => readFileSync(path.join(WURZEL, p), 'utf8').replace(/\r\n/g, '\n')
const KB = 'src/app/(dashboard)/kellerbuch'

describe('KAN-475: Regel „ohne Charge nur Gebindepflege“', () => {
  test('mit Charge immer in Ordnung; ohne Charge nur ein Typ der Gebindepflege', () => {
    assert.equal(behandlungOhneChargeFehler('c1', false), null)
    assert.equal(behandlungOhneChargeFehler('c1', true), null)
    assert.equal(behandlungOhneChargeFehler(null, true), null)
    assert.equal(behandlungOhneChargeFehler(null, false), BEHANDLUNG_OHNE_CHARGE)
    assert.match(BEHANDLUNG_OHNE_CHARGE, /werden an der Charge erfasst.*nur Gebindepflege/)
  })
  test('die Charge im Gebinde wird weiter automatisch gewählt (QR-Scan am Gebinde)', () => {
    assert.deepEqual(behandlungCharge(null, ['c1']), { chargeId: 'c1', fehler: null })
    assert.deepEqual(behandlungCharge(null, []), { chargeId: null, fehler: null })
    assert.match(behandlungCharge(null, ['c1', 'c2']).fehler, /mehrere Chargen/)
  })
  test('Server Action: Gebinde kommt von der Charge; ohne beides Ablehnung; Regel vor dem Schreiben', () => {
    const a = quelle(`${KB}/actions.ts`)
    const f = a.slice(a.indexOf('export async function speichereKellerbehandlung('), a.indexOf('export async function createKellerbehandlung('))
    assert.ok(f.includes('if (!behaelterId && !gewaehlt) throw new AktionsFehler(BEHANDLUNG_OHNE_CHARGE)'))
    assert.match(f, /\.select\('id, behaelter_id'\)\.eq\('id', gewaehlt\)\.eq\('tenant_id', tenantId\)\.maybeSingle\(\)/)
    const regel = f.indexOf("behandlungOhneChargeFehler(weinausbauId, typ.gebindepflege === true)")
    assert.ok(regel > 0 && regel < f.indexOf(".insert({ ...payload, tenant_id: tenantId })"), 'Regel vor dem Insert')
    assert.ok(f.includes("revalidatePath(`/kellerbuch/weinausbau/${weinausbauId}/behandlungen`)"))
    // die App-eigenen Typen ohne Charge sind als Gebindepflege gekennzeichnet
    assert.ok(a.includes("name: TYP_NAME, einheit_standard: '-', gebindepflege: true"))
    assert.ok(a.includes("name: NOTIZ_TYP, einheit_standard: '-', pn_wirkung: 'pflege', gebindepflege: true"))
  })
})

describe('KAN-475: Seiten', () => {
  const k = quelle(`${KB}/_behandlungen/Kellerbehandlungen.tsx`)
  test('eigene Seite an der Charge; die alte Adresse am Gebinde bleibt für die Gebindepflege', () => {
    assert.match(quelle(`${KB}/weinausbau/[id]/behandlungen/page.tsx`), /<Kellerbehandlungen modus="charge" id=\{params\.id as string\} \/>/)
    const alt = quelle(`${KB}/behaelter/[id]/behandlungen/page.tsx`)
    assert.match(alt, /<Kellerbehandlungen modus="gebinde" id=\{params\.id as string\} \/>/)
    // seit KAN-479 läuft die Behördenmeldung je Charge – die Gebinde-Seite trägt keinen Marker mehr
    assert.ok(alt.startsWith("'use client'"))
    assert.ok(existsSync(path.join(WURZEL, KB, 'weinausbau/[id]/behandlungen/layout.tsx')), 'Seitentitel')
  })
  test('an der Charge: Liste nach Charge (in welchem Gebinde auch immer); am Gebinde nur Einträge ohne Charge', () => {
    assert.ok(k.includes("behandlungenQuery = chargeId ? behandlungenQuery.eq('weinausbau_id', chargeId) : behandlungenQuery.eq('behaelter_id', bId).is('weinausbau_id', null)"))
    assert.ok(k.includes("bId = ((c as R).behaelter_id as string | null) ?? null"))
    assert.ok(k.includes('lag in {(b.behaelter as R).name}'))
  })
  test('genau eine Charge im Gebinde → weiter zu ihren Kellerbehandlungen, ?neu=1 bleibt erhalten (QR-Scan)', () => {
    assert.match(k, /if \(modus === 'gebinde' && \(\(bh_data \?\? \[\]\) as R\[\]\)\.length === 1\) \{\n\s+router\.replace\(`\/kellerbuch\/weinausbau\/\$\{\(\(bh_data \?\? \[\]\) as R\[\]\)\[0\]\.id\}\/behandlungen\$\{window\.location\.search\}`\)/)
  })
  test('Formular: an der Charge steht sie fest, am Gebinde nur Typen der Gebindepflege; neuer Typ dort als Gebindepflege', () => {
    assert.ok(k.includes("const typenWahl = modus === 'gebinde' ? typen.filter(t => t.gebindepflege === true) : typen"))
    assert.ok(k.includes("setFormWeinausbauId(chargeId ?? '')"))
    assert.ok(k.includes("if (behaelterId) fd.set('behaelter_id', behaelterId)"))
    assert.ok(k.includes("legeBehandlungstypAn(neuerTypName.trim(), neuerTypEinheit || null, neuerTypWirkung, modus === 'gebinde')"))
  })
  test('Vorgeschichte: Behandlungen der Ursprungscharge bis zum Teilumzug, ohne stornierte, nur Anzeige', () => {
    assert.ok(k.includes(".eq('tenant_id', activeTenantId).eq('nach_weinausbau_id', chargeId).neq('von_weinausbau_id', chargeId).eq('verschnitt', false)"))
    assert.ok(k.includes(".is('storniert_am', null).order('datum', { ascending: false }).order('erstellt_am', { ascending: false }).order('id', { ascending: false }).limit(5)"))
    assert.match(k, /\.eq\('weinausbau_id', u\.von_weinausbau_id\)\.lte\('datum', u\.datum\)\.is\('storniert_am', null\)/)
    assert.ok(k.includes('Übernommen von Charge {v.charge}'))
  })
  test('Chargen-Seite verlinkt die eigene Seite; Dashboard nimmt die letzte Maßnahme der Charge', () => {
    assert.ok(quelle(`${KB}/weinausbau/[id]/page.tsx`).includes('<Link href={`/kellerbuch/weinausbau/${weinausbau.id}/behandlungen`}'))
    const d = quelle('src/app/(dashboard)/dashboard/_shared/data.ts')
    assert.ok(d.includes("inBloecken(ids, b => ctx.tf(ctx.q('keller_behandlungen').select('weinausbau_id, datum, typ_name_snapshot, menge, einheit').in('weinausbau_id', b)"))
    assert.ok(d.includes('const m = letzteMassnahme.get(c.id) ?? null'))
  })
})

describe('KAN-475: Migration', () => {
  const ordner = path.join(WURZEL, 'supabase', 'migrations')
  const datei = readdirSync(ordner).find(n => /_kan475_behandlung_an_charge\.sql$/.test(n))
  const pfad = datei ? path.join(ordner, datei) : path.join(WURZEL, 'supabase', 'entwurf', 'kan475_behandlung_an_charge.sql')
  test('Gebinde nicht mehr Pflicht, Kennzeichen Gebindepflege, Trigger mit derselben Meldung wie die App', () => {
    assert.ok(existsSync(pfad), 'Migration kan475_behandlung_an_charge fehlt (migrations/ bzw. entwurf/)')
    const sql = readFileSync(pfad, 'utf8').replace(/\r\n/g, '\n')
    assert.ok(sql.includes('ALTER TABLE public.keller_behandlungstypen ADD COLUMN gebindepflege boolean NOT NULL DEFAULT false;'))
    assert.ok(sql.includes('ALTER TABLE public.keller_behandlungen ALTER COLUMN behaelter_id DROP NOT NULL;'))
    assert.ok(sql.includes(`RAISE EXCEPTION '${BEHANDLUNG_OHNE_CHARGE}'`), 'gleicher Wortlaut in App und Datenbank')
    assert.ok(sql.includes('REVOKE EXECUTE ON FUNCTION public.s112_behandlung_an_charge() FROM PUBLIC, anon, authenticated;'))
    assert.ok(sql.includes("lower(btrim(name)) IN ('umbenennung', 'notiz')"))
    assert.ok(quelle('scripts/schema.json').includes('"gebindepflege"'))
  })
  test('Nachtrag: die Regel läuft nach der Rechteprüfung (AFTER-Trigger), vorher nur das Übernehmen des Gebindes', () => {
    const d = readdirSync(ordner).find(n => /_kan475b_charge_pflicht_nach_rls\.sql$/.test(n))
    const p = d ? path.join(ordner, d) : path.join(WURZEL, 'supabase', 'entwurf', 'kan475b_charge_pflicht_nach_rls.sql')
    assert.ok(existsSync(p), 'Migration kan475b_charge_pflicht_nach_rls fehlt (migrations/ bzw. entwurf/)')
    const sql = readFileSync(p, 'utf8').replace(/\r\n/g, '\n')
    assert.ok(sql.includes('DROP TRIGGER a_charge_pflicht ON public.keller_behandlungen;'))
    assert.ok(sql.includes('CREATE TRIGGER a_gebinde_von_charge BEFORE INSERT ON public.keller_behandlungen'))
    assert.ok(sql.includes('CREATE TRIGGER z_charge_pflicht AFTER INSERT OR UPDATE OF weinausbau_id, behaelter_id, typ_id ON public.keller_behandlungen'))
    assert.ok(sql.includes(`RAISE EXCEPTION '${BEHANDLUNG_OHNE_CHARGE}'`), 'gleicher Wortlaut in App und Datenbank')
    // die Funktion vor dem Schreiben wirft nie – sonst bekäme ein fremder Betrieb eine fachliche Meldung vor der Rechte-Ablehnung
    const vorher = sql.slice(sql.indexOf('CREATE FUNCTION public.s112_behandlung_gebinde_von_charge()'), sql.indexOf('CREATE OR REPLACE FUNCTION public.s112_behandlung_an_charge()'))
    assert.ok(!/RAISE EXCEPTION/.test(vorher))
    assert.ok(sql.includes('REVOKE EXECUTE ON FUNCTION public.s112_behandlung_gebinde_von_charge() FROM PUBLIC, anon, authenticated;'))
  })
})
