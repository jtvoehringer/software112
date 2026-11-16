// KAN-476 (16.11.2026): Traubenverkauf – Fehlermeldung, obwohl gespeichert (Befund BKI-Sitzung, Musterhof).
//
// Zwei Ursachen: (1) Der Musterhof-Reset ließ Rechnungen ohne Verkauf stehen und stellte den Rechnungszähler auf eine
// vergebene Nummer. (2) Die App legte den Traubenverkauf an und erst danach Verkauf und Rechnung – scheiterte der
// zweite Schritt, blieb der Traubenverkauf ohne Verkauf stehen.
// Geprüft wird: beide Anlege-Wege laufen über die RPC s112_traubenverkauf_anlegen (eine Transaktion), kein Schreiben
// mehr davor; Freigabe Warenwirtschaft vorab; Fehler der RPC wird gemeldet; Migration (Reset, RPC als INVOKER).
// Das Verhalten der Datenbank prüft scripts/db-tests/99_traubenverkauf_transaktion.sql (Staging).
//
// Aufruf:  npm run -s test:csv   (Node ≥ 22.15 wegen module.registerHooks)
import { test, describe, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { DOPPEL, hooksRegistrieren, laden, nurMitHooks, hooksMoeglich, datenbank } from './buchung-attrappe.mjs'

const modul = code => 'data:text/javascript,' + encodeURIComponent(code)
DOPPEL['@/lib/auth/seitenBetrieb'] = modul('export const pruefeSeitenBetrieb = async () => {}; export const seitenBetriebFehler = async () => null')
DOPPEL['@/lib/auth/sperren'] = modul('export const pruefeSchreibzugriff = async () => {}; export const schreibSperreFehler = async () => null')
DOPPEL['@/lib/auth/modul'] = modul('export const pruefeModul = async () => {}; export const hatModul = async () => true')
DOPPEL['next/navigation'] = modul("export const redirect = u => { throw Object.assign(new Error('NEXT_REDIRECT'), { ziel: u }) }")
DOPPEL['@/lib/wein/grundstueckStatus'] = modul('export const NUTZART_OPTIONS = []; export const STATUS_OPTIONS = []; export const NutzungBadge = () => null; export const StatusBadge = () => null')
hooksRegistrieren()

const WURZEL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const quelle = p => readFileSync(path.join(WURZEL, p), 'utf8').replace(/\r\n/g, '\n')
const lib = hooksMoeglich ? await laden('lib/verkauf/traubenverkaufAnlegen.ts') : null
const ernte = hooksMoeglich ? await laden('app/(dashboard)/erntemeldung/actions.ts') : null

const T = '00000000-0000-4000-8000-000000000001'
const als = (role, schreibmodule = null) => { globalThis.__membership = { tenantId: T, role, schreibmodule } }
const meldung = async p => { try { const r = await p; return r?.error ?? '' } catch (e) { return e.message } }
beforeEach(() => als('tenant_admin'))

describe('KAN-476: traubenverkaufAnlegen (eine Transaktion in der Datenbank)', nurMitHooks, () => {
  const payload = {
    tenant_id: T, weingarten_id: 'w1', zukauf_posten_id: null, jahrgang_id: 'j1', lese_id: 'l1', grundstueck_id: '', kontakt_id: null, firma_id: 'f1',
    datum: '2026-11-16', menge_kg: 250, preis_per_kg: 1, kmw_grad: 15, oechsle: 73.1, mostgewicht_einheit: 'kmw',
    qualitaetsstufe: 'Qualitätswein', herkunft_code: 'NOE', gesundheit: 'G', notizen: null, updated_at: 'x', liefernummer: 'LN-FREMD', verkaufsposten_id: 'fremd',
  }
  test('übergibt nur die Felder der Liste – Betrieb, Liefernummer und Verkaufsbezug vergibt die Funktion', () => {
    assert.deepEqual(lib.traubenverkaufDaten(payload), {
      jahrgang_id: 'j1', lese_id: 'l1', weingarten_id: 'w1', firma_id: 'f1', datum: '2026-11-16', menge_kg: 250, preis_per_kg: 1,
      kmw_grad: 15, oechsle: 73.1, mostgewicht_einheit: 'kmw', qualitaetsstufe: 'Qualitätswein', gesundheit: 'G', herkunft_code: 'NOE',
    })
  })
  test('ein Aufruf der RPC mit Betrieb, Daten und Quelle; Ergebnis mit Verkauf und Liefernummer', async () => {
    const aufrufe = []
    const supabase = { rpc: async (name, args) => { aufrufe.push([name, args]); return { data: { id: 'tv1', verkaufsposten_id: 'vp1', liefernummer: 'LN-2026-0005' }, error: null } } }
    assert.deepEqual(await lib.traubenverkaufAnlegen(supabase, T, payload, 'Frechau Zweigelt'), { id: 'tv1', verkaufspostenId: 'vp1', liefernummer: 'LN-2026-0005' })
    assert.equal(aufrufe.length, 1)
    assert.equal(aufrufe[0][0], 's112_traubenverkauf_anlegen')
    assert.deepEqual(Object.keys(aufrufe[0][1]), ['p_tenant_id', 'p_daten', 'p_quelle'])
    assert.equal(aufrufe[0][1].p_tenant_id, T)
    assert.equal(aufrufe[0][1].p_quelle, 'Frechau Zweigelt')
    assert.ok(!('liefernummer' in aufrufe[0][1].p_daten) && !('tenant_id' in aufrufe[0][1].p_daten))
  })
  test('Befund aus dem Ticket: Rechnungsnummer schon vergeben → Fehler, die Meldung sagt „nichts angelegt“', async () => {
    const supabase = { rpc: async () => ({ data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "rechnungen_nummer_eindeutig"' } }) }
    const m = await meldung(lib.traubenverkaufAnlegen(supabase, T, payload, 'x'))
    assert.match(m, /es wurde nichts angelegt/)
    assert.match(m, /rechnungen_nummer_eindeutig|gibt es bereits/)
  })
  test('eigene Meldung der Datenbank (22023, 42501) wird unverändert durchgereicht; leere Antwort ist ein Fehler', async () => {
    const mit = error => ({ rpc: async () => ({ data: null, error }) })
    assert.equal(await meldung(lib.traubenverkaufAnlegen(mit({ code: '22023', message: 'Bitte eine Menge in kg größer als 0 angeben.' }), T, payload, 'x')), 'Bitte eine Menge in kg größer als 0 angeben.')
    assert.match(await meldung(lib.traubenverkaufAnlegen({ rpc: async () => ({ data: null, error: null }) }, T, payload, 'x')), /nichts angelegt/)
    assert.match(await meldung(lib.traubenverkaufAnlegen({ rpc: async () => ({ data: { id: 'tv1' }, error: null }) }, T, payload, 'x')), /nichts angelegt/)
  })
})

describe('KAN-476: Freigabe Warenwirtschaft vorab', nurMitHooks, () => {
  test('Lese › Traubenverkauf: nur Rieden → abgelehnt, bevor irgendetwas gelesen oder geschrieben wird', async () => {
    als('winzer', ['rieden'])
    const d = datenbank({}, { rpc: () => ({ data: null, error: null }) }); globalThis.__serverFake = d
    assert.match(await meldung(ernte.createTraubenverkauf(new FormData())), /Freigabe Warenwirtschaft\. Es wurde nichts gespeichert/)
    assert.deepEqual(d.aufrufe, [])
  })
  test('Warenwirtschaft › Traubenverkauf: Prüfung steht im Neuanlage-Zweig vor dem Anlegen', () => {
    const t = quelle('src/app/(dashboard)/weinhandel/traubenverkauf/actions.ts')
    const neu = t.slice(t.lastIndexOf('if (qualitaetUnzulaessig) throw new AktionsFehler(qualitaetUnzulaessig)'))
    const recht = neu.indexOf("if (!canWrite(membership, 'warenwirtschaft'))")
    assert.ok(recht > 0 && recht < neu.indexOf('await traubenverkaufAnlegen('))
    assert.ok(neu.indexOf("verkaufKundeFehler({ typen: ['trauben']") < neu.indexOf('await traubenverkaufAnlegen('), 'Abnehmer-Pflicht (KAN-208) wie in der Lese')
  })
})

describe('KAN-476: beide Wege legen nur noch über die RPC an', () => {
  test('Warenwirtschaft: Neuanlage ohne eigenes Insert, ohne Liefernummer außerhalb der Transaktion', () => {
    const t = quelle('src/app/(dashboard)/weinhandel/traubenverkauf/actions.ts')
    const neu = t.slice(t.lastIndexOf('if (qualitaetUnzulaessig) throw new AktionsFehler(qualitaetUnzulaessig)'), t.indexOf("revalidatePath('/weinhandel/traubenverkauf')"))
    assert.ok(neu.includes('await traubenverkaufAnlegen(supabase, tenantId, payload, weingartenName)'))
    assert.ok(!/\.insert\(|\.update\(|get_next_liefernummer|createVerkaufspostenFuerTrauben/.test(neu), 'kein weiterer Schreibzugriff im Neuanlage-Zweig')
    assert.ok(!t.includes('get_next_liefernummer'))
  })
  test('Lese: createTraubenverkauf ohne eigenes Insert, Liefernummer und Verkauf kommen aus der RPC', () => {
    const a = quelle('src/app/(dashboard)/erntemeldung/actions.ts')
    const f = a.slice(a.indexOf('export async function createTraubenverkauf('), a.indexOf('export async function updateTraubenverkauf('))
    assert.ok(f.includes('await traubenverkaufAnlegen(supabase, tenantId, payload, weingartenName)'))
    assert.ok(!/\.insert\(|\.update\(|get_next_liefernummer|createVerkaufspostenFuerTrauben/.test(f))
    assert.ok(!a.includes('createVerkaufspostenFuerTrauben'))
  })
  test('Bibliothek: ein RPC-Aufruf, keine Tabellenzugriffe', () => {
    const l = quelle('src/lib/verkauf/traubenverkaufAnlegen.ts')
    assert.ok(l.includes("rpc('s112_traubenverkauf_anlegen'"))
    assert.ok(!l.includes('.from('))
  })
})

describe('KAN-476: Migration', () => {
  const ordner = path.join(WURZEL, 'supabase', 'migrations')
  const datei = readdirSync(ordner).find(n => /_kan476_traubenverkauf_transaktion\.sql$/.test(n))
  const pfad = datei ? path.join(ordner, datei) : path.join(WURZEL, 'supabase', 'entwurf', 'kan476_traubenverkauf_transaktion.sql')
  test('Reset räumt Rechnungen ab und zählt sie beim Rechnungszähler mit; RPC als INVOKER, nicht für anon', () => {
    assert.ok(existsSync(pfad), 'Migration kan476_traubenverkauf_transaktion fehlt (migrations/ bzw. entwurf/)')
    const sql = readFileSync(pfad, 'utf8').replace(/\r\n/g, '\n')
    assert.ok(sql.includes('delete from rechnungen where tenant_id = c_t;  -- storno-ausnahme: Demo-Reset des Musterhofs'))
    assert.ok(sql.includes('storno_zaehler = 1, gutschrift_zaehler = 1'))
    assert.ok(sql.includes("from rechnungen where tenant_id = c_t and rechnungsnummer ~ ''^RE-[0-9]+$''"))
    assert.match(sql, /CREATE FUNCTION public\.s112_traubenverkauf_anlegen\(p_tenant_id uuid, p_daten jsonb, p_quelle text\)\nRETURNS jsonb\nLANGUAGE plpgsql SECURITY INVOKER SET search_path = public/)
    assert.ok(sql.includes("PERFORM public.pruefe_tenant_zugriff(p_tenant_id, ARRAY['system_admin', 'tenant_admin', 'winzer']);"))
    assert.ok(sql.includes('REVOKE EXECUTE ON FUNCTION public.s112_traubenverkauf_anlegen(uuid, jsonb, text) FROM PUBLIC, anon;'))
    // Reihenfolge in der Funktion: Liefernummer, Verkauf, Position, Traubenverkauf mit Verkaufsbezug
    const fn = sql.slice(sql.indexOf('CREATE FUNCTION public.s112_traubenverkauf_anlegen'), sql.indexOf('REVOKE EXECUTE ON FUNCTION public.s112_traubenverkauf_anlegen'))
    const stellen = ['get_next_liefernummer(p_tenant_id)', 'INSERT INTO public.verkaufsposten', 'INSERT INTO public.verkauf_positionen', 'INSERT INTO public.traubenverkauf'].map(s => fn.indexOf(s))
    assert.ok(stellen.every((s, i) => s > 0 && (i === 0 || s > stellen[i - 1])), String(stellen))
    assert.ok(fn.includes('liefernummer, verkaufsposten_id)'))
  })
  test('DB-Test deckt Reset, Transaktion und Rechte ab', () => {
    const t = quelle('scripts/db-tests/99_traubenverkauf_transaktion.sql')
    for (const n of ['reset_keine_rechnung_ohne_verkauf', 'reset_zaehler_hinter_hoechster_nummer', 'nummer_vergeben_nichts_gespeichert', 'fremde_ried_nichts_gespeichert', 'leser_darf_nicht', 'anon_ohne_rechte']) {
      assert.ok(t.includes(`'${n}'`), n)
    }
  })
})
