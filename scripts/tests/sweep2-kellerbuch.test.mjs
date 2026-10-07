// Sweep Kellerbuch (07.10.2026) – KAN-53 Zugangskorrektur, KAN-198 Chargenpflicht der Füllung, KAN-183 Umzug bearbeiten
//
// Aufruf:  npm run -s test:csv   (alle scripts/tests/*.test.mjs)
//
// 1. KAN-53: Regeln (Art, Menge, Grund ≥ 10, Datum), Prüfnummer (Zugangskorrektur nach der Einreichung beendet die
//    Gültigkeit), BSM INV_PLUS, Verdrahtung (Server Action nur Betriebsleitung, Rückfrage vor der RPC, Leser im
//    Bewegungsbuch/Folgebuchungen/Storno), Migration (Rollen, Journal, PN-Pflege).
// 2. KAN-198: Trigger nach RLS (AFTER), Wartung frei, Import/Zukauf/Charge zulässig.
// 3. KAN-183: Umzug bearbeiten – Prüfnummern-Rückfrage vor dem Storno, Zeilenzahl der Bestandsänderungen.
// DB-Seite: DB-Test 55.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { hooksRegistrieren, laden, nurMitHooks } from './buchung-attrappe.mjs'

hooksRegistrieren()
const quelle = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const migration = () => {
  const f = readdirSync(new URL('../../supabase/migrations', import.meta.url)).find(n => n.endsWith('_sweep2_zugangskorrektur_fuellung_herkunft.sql'))
  return quelle(f ? `supabase/migrations/${f}` : 'supabase/entwurf/sweep2_zugangskorrektur_fuellung_herkunft.sql')
}

describe('KAN-53: Zugangskorrektur', nurMitHooks, () => {
  test('zugangskorrekturFehler: Art, Menge, Grund, Datum', async () => {
    const z = await laden('lib/kellerbuch/zugangskorrektur.ts')
    const ok = { art: 'inventur', menge: 12, grund: 'Inventur Tank 3 nachgemessen', datum: '2026-10-06', heute: '2026-10-07' }
    assert.equal(z.zugangskorrekturFehler(ok), null)
    assert.match(z.zugangskorrekturFehler({ ...ok, art: 'schwund' }), /Art/)
    assert.match(z.zugangskorrekturFehler({ ...ok, menge: 0 }), /größer als 0/)
    assert.match(z.zugangskorrekturFehler({ ...ok, menge: null }), /größer als 0/)
    assert.match(z.zugangskorrekturFehler({ ...ok, grund: 'zu kurz' }), /mindestens 10 Zeichen/)
    assert.match(z.zugangskorrekturFehler({ ...ok, datum: '2026-10-08' }), /Zukunft/)
  })
  test('Prüfnummer: Zugangskorrektur nach der Einreichung verletzt den Antrag, davor nicht', async () => {
    const pn = await laden('lib/kellerbuch/pruefnummer.ts')
    const antrag = { id: 'A1', status: 'genehmigt', aktiv: true, pruefnummer: 'N 1/26', mengeLiter: 1000, eingereichtAm: '2026-09-01', bescheidAm: '2026-09-10', angelegtAm: '2026-08-30' }
    const daten = (datum) => ({ chargeId: 'C1', bestandLiter: 500, bestandAm: '2026-10-07', antraege: [antrag], zugaenge: [{ art: 'korrektur', datum }], abfuellungen: [], tankverkaeufe: [] })
    assert.deepEqual(pn.antragVerletzung(antrag, daten('2026-09-20'), '2026-10-07'), { grund: 'korrektur', ereignisDatum: '2026-09-20', menge: null })
    assert.equal(pn.antragVerletzung(antrag, daten('2026-08-20'), '2026-10-07'), null)
    assert.match(pn.pnZugangText('korrektur', '2026-09-20'), /^Zugangskorrektur \(Mehrmenge, Inventur-Plus\) am 20\.09\.2026/)
  })
  test('BSM-Rekonstruktion: Zugangskorrektur = INV_PLUS', async () => {
    const { buchungsartBewegung } = await laden('lib/behoerden/bsm.ts')
    assert.equal(buchungsartBewegung('zugangskorrektur'), 'INV_PLUS')
  })
  test('Server Action: nur Betriebsleitung, Rückfrage vor der RPC, Vermerk im Grund', () => {
    const a = quelle('src/app/(dashboard)/kellerbuch/actions.ts')
    const fn = a.slice(a.indexOf('export async function zugangskorrekturBuchen'), a.indexOf('export async function zugangskorrekturStornieren'))
    assert.match(a, /async function zugangskorrekturRecht\(\): Promise<string> \{\n\s+const tenantId = await kellerbuchSchreibrecht\(\)\n\s+const membership = await getCurrentMembership\(\)\n\s+if \(!membership \|\| !canAdmin\(membership\.role\)\)/)
    assert.ok(fn.indexOf("pruefePruefnummernSchaden(supabase, tenantId, 'korrektur'") > 0)
    assert.ok(fn.indexOf("formData.get('pn_bestaetigt') !== '1'") < fn.indexOf("rpc('s112_zugangskorrektur_buchen'"))
    assert.match(fn, /p_grund: mitPnNotiz\(grund, pn\?\.notiz \?\? null\)/)
  })
  test('Leser: Bewegungsbuch (Zugang, Saldo), Folgebuchungen, Storno-Sperre, Prüfnummer-Lader', () => {
    const b = quelle('src/lib/behoerden/bewegungsbuch.ts')
    assert.match(b, /for \(const z of roh\.zugangskorrekturen\) if \(!istStorniert\(z\)\) plus\(z\.weinausbau_id, num\(z\.menge_liter\)\)/)
    assert.equal(b.split("from('keller_zugangskorrekturen')").length - 1, 2)   // je Gebinde und Betrieb (BSM)
    assert.match(quelle('src/lib/kellerbuch/folgebuchungen.ts'), /zugangskorrektur:  anzahl\('keller_zugangskorrekturen', korrekturen\)/)
    assert.match(quelle('src/lib/kellerbuch/storno.ts'), /\['zugangskorrektur', korrekturAnzahl\]/)
    assert.match(quelle('src/lib/kellerbuch/pruefnummerLaden.ts'), /zugang\(k\.weinausbau_id, \{ art: 'korrektur', datum: pnTag\(k\.datum\), id: String\(k\.id\) \}\)/)
  })
  test('Migration: nur Betriebsleitung, INV_PLUS, Prüfnummer-Pflege und erstes Ende, Folgebuchung', () => {
    const m = migration()
    assert.equal(m.split("PERFORM public.pruefe_tenant_zugriff(p_tenant_id, ARRAY['system_admin', 'tenant_admin']);").length - 1, 2)
    assert.match(m, /jsonb_build_object\('code', 'INV_PLUS', 'bestand', 'offen'/)
    assert.match(m, /ELSIF TG_TABLE_NAME = 'keller_zugangskorrekturen' THEN[^\n]*\n\s+v_ziel := NEW\.weinausbau_id;  v_grund := 'korrektur';/)
    assert.match(m, /SELECT zk\.datum, 'korrektur', 'keller_zugangskorrekturen:' \|\| zk\.id/)
    assert.equal(m.split('OR EXISTS (SELECT 1 FROM public.keller_zugangskorrekturen zk WHERE zk.weinausbau_id = p_charge AND zk.storniert_am IS NULL)').length - 1, 2)
    assert.match(m, /CREATE TRIGGER z_pn_chargen AFTER INSERT OR UPDATE OF storniert_am ON public\.keller_zugangskorrekturen/)
    assert.match(m, /CREATE POLICY keine_direktloeschung ON public\.keller_zugangskorrekturen/)
  })
})

describe('KAN-198: Chargenpflicht der Füllung', () => {
  test('AFTER-Trigger (nach RLS), Wartung frei, Charge/Zukauf/Import/Mehrfach-Charge zulässig', () => {
    const m = migration()
    assert.match(m, /CREATE TRIGGER z_fuellung_herkunft AFTER INSERT OR UPDATE OF weinausbau_id, zukauf_posten_id, import_quelle ON public\.fuellungen/)
    assert.doesNotMatch(m, /BEFORE INSERT OR UPDATE OF weinausbau_id, zukauf_posten_id, import_quelle/)
    assert.match(m, /IF v_rolle NOT IN \('authenticated', 'anon'\) THEN\n\s+RETURN NULL;/)
    assert.match(m, /NEW\.weinausbau_id IS NULL AND NEW\.zukauf_posten_id IS NULL\n\s+AND NULLIF\(btrim\(coalesce\(NEW\.import_quelle, ''\)\), ''\) IS NULL\n\s+AND NOT EXISTS \(SELECT 1 FROM public\.fuellung_chargen/)
    assert.match(m, /USING ERRCODE = '23514', HINT = 'fuellung_charge'/)
    assert.match(m, /UPDATE public\.fuellungen f SET import_quelle = 'eroeffnungsbestand'/)
  })
})

describe('KAN-183: Umzug bearbeiten', () => {
  const g = () => quelle('src/app/(dashboard)/kellerbuch/gebinde-actions.ts')
  test('Rückfrage vor dem Storno der bisherigen Buchung, Vermerk an der Zielzeile', () => {
    const a = g()
    const upd = a.slice(a.indexOf('export async function updateUmzugBatch'))
    assert.ok(upd.indexOf("if (pnFragen.length > 0 && formData.get('pn_bestaetigt') !== '1') return { bestaetigung:") < upd.indexOf('await storniereUmzug(supabase, tenantId, plan, GRUND_BEARBEITET)'))
    assert.match(a, /const pn = await pruefePruefnummernSchaden\(supabase, tenantId, 'umzug', \[\{ chargeId, name, zugangLiter: liter \}\], e\.datum\)/)
    assert.match(a, /const pnNotiz = opts\.pnNotizJeCharge\?\.get\(existing\.id\)/)
    assert.match(quelle('src/components/kellerbuch/UmziehenFormClient.tsx'), /fd\.set\('pn_bestaetigt', '1'\)/)
  })
  test('Bestandsänderungen mit Zeilenzahl – ohne Treffer keine Umzugszeile', () => {
    const a = g()
    const anlegen = a.slice(a.indexOf('async function umzugAnlegen'), a.indexOf('function revalidiereUmzug'))
    assert.equal(anlegen.split(".select('id')\n").length - 1 >= 2, true)
    assert.ok(anlegen.indexOf("if (((d1 ?? []) as R[]).length !== 1)") < anlegen.indexOf("from('keller_umzuege') as any).insert"))
    assert.match(anlegen, /if \(\(\(d2 \?\? \[\]\) as R\[\]\)\.length !== 1\)/)
  })
})
