// Tests KAN-381 (23.10.2026, Entscheidung Jörgen): Ein Gebinde darf nicht überfüllt werden.
//
// Aufruf:  npm run -s test:csv  (Node ≥ 22.15 wegen module.registerHooks)
//
// 1. Gemeinsame Regel (src/lib/keller/fassungsvermoegen.ts): Volumen unbekannt frei, Toleranz 0,5 l, nur eine Erhöhung
//    sperrt (bestehende Überfüllung bleibt bearbeitbar), Abgang aus demselben Gebinde, je Gebinde summiert, Meldung.
// 2. Server-Lader: Inhalt eigen + fremd (Kellergemeinschaft) aus lade_behaelter, Lesefehler wirft.
// 3. umziehen() gegen die Attrappe: zu kleines Ziel → Meldung, NICHTS gebucht (die Quelle würde sonst zuerst gemindert);
//    auch wenn der Umzug ein Verschnitt wäre; passendes Ziel bucht.
// 4. Verdrahtung: alle Zugangswege (Formulare und Server Actions) nutzen dieselbe Regel – vor der ersten Buchung.
// 5. Datenbank-Entwurf (nur lokal, supabase/entwurf ist nicht eingecheckt) bzw. Migration: Trigger, Konventionen,
//    dieselbe Meldung wie die App; DB-Test 84 und Einstufung der Triggerfunktionen.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  fassungsFehler, fassungsFehlerListe, fassungsHinweis, freiLiter, fassungsvermoegen, fassungenAus, pruefeFassung,
  FASSUNG_TOLERANZ_LITER,
} from '../../src/lib/keller/fassungsvermoegen.ts'
import { DOPPEL, hooksRegistrieren, laden, nurMitHooks, hooksMoeglich, datenbank, uuid, zeile } from './buchung-attrappe.mjs'

const modul = code => 'data:text/javascript,' + encodeURIComponent(code)
DOPPEL['@/lib/auth/seitenBetrieb'] = modul('export const pruefeSeitenBetrieb = async () => {}')
DOPPEL['@/lib/auth/sperren'] = modul('export const pruefeSchreibzugriff = async () => {}')
DOPPEL['next/navigation'] = modul('export const redirect = ziel => { const e = new Error("NEXT_REDIRECT"); e.ziel = ziel; throw e }')
hooksRegistrieren()

const WURZEL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const quelle = rel => readFileSync(path.join(WURZEL, rel), 'utf8').replace(/\r\n/g, '\n')

const barrique = { name: 'Barrique 3', volumen_liter: 225, inhalt: 0 }

// ── 1. Regel ─────────────────────────────────────────────────────────────────────────────────────────────────
describe('1. Gemeinsame Regel fassungsFehler', () => {
  test('UAT-Befund: 1.100 l passen nicht in „Barrique 3“ (225 l) – Meldung laut Ticket', () => {
    assert.equal(fassungsFehler(barrique, 1100), 'Die Charge (1.100 l) passt nicht in „Barrique 3“ (Fassungsvermögen 225 l, frei 225 l).')
  })
  test('freier Platz = Volumen − Inhalt (eigen + fremd), Toleranz 0,5 l', () => {
    const tank = { name: 'Tank 1', volumen_liter: 1000, inhalt: 700 }
    assert.equal(FASSUNG_TOLERANZ_LITER, 0.5)
    assert.equal(fassungsFehler(tank, 300), null)
    assert.equal(fassungsFehler(tank, 300.5), null)
    assert.equal(fassungsFehler(tank, 300.6), 'Die Charge (300,6 l) passt nicht in „Tank 1“ (Fassungsvermögen 1.000 l, frei 300 l).')
    assert.equal(freiLiter(tank), 300)
    assert.equal(freiLiter({ ...tank, inhalt: 1200 }), 0, 'nie negativ')
  })
  test('Volumen unbekannt (null, leer, 0) → keine Sperre, nur Hinweis', () => {
    for (const v of [null, undefined, '', 0, '0']) {
      assert.equal(fassungsFehler({ name: 'Fass', volumen_liter: v, inhalt: 0 }, 5000), null)
      assert.equal(fassungsvermoegen({ volumen_liter: v }), null)
      assert.match(fassungsHinweis({ name: 'Fass', volumen_liter: v }), /Fassungsvermögen von „Fass“ ist nicht hinterlegt/)
    }
    assert.equal(fassungsHinweis({ name: 'Tank', volumen_liter: 100 }), null)
    assert.equal(fassungsFehler(null, 100), null)
    assert.equal(fassungsvermoegen({ volumen_liter: '1000.00' }), 1000, 'numeric als Text (PostgREST)')
  })
  test('bestehende Überfüllung: nur eine Erhöhung sperrt (Minderung, Umverteilung im Gebinde frei)', () => {
    const voll = { name: 'Immervolltank 09', volumen_liter: 1000, inhalt: 1900 }
    assert.equal(fassungsFehler(voll, 0), null)
    assert.equal(fassungsFehler(voll, 100, { abgang: 100 }), null, 'Verschnitt im selben Gebinde')
    assert.equal(fassungsFehler(voll, 50, { abgang: 100 }), null)
    assert.equal(fassungsFehler(voll, 10), 'Die Charge (10 l) passt nicht in „Immervolltank 09“ (Fassungsvermögen 1.000 l, frei 0 l).')
  })
  test('Abgang aus demselben Gebinde zählt (Ziel vor Quelle)', () => {
    const eng = { name: 'Eng', volumen_liter: 300, inhalt: 280 }
    assert.equal(fassungsFehler(eng, 80, { abgang: 80 }), null)
    assert.match(fassungsFehler(eng, 80), /Die Charge \(80 l\) passt nicht in „Eng“ \(Fassungsvermögen 300 l, frei 20 l\)/)
  })
  test('mehrere Zugänge je Gebinde summiert, unbekannte Gebinde übergangen', () => {
    const g = new Map([['a', { name: 'A', volumen_liter: 100, inhalt: 0 }], ['b', { name: 'B', volumen_liter: 100, inhalt: 0 }]])
    assert.equal(fassungsFehlerListe(g, [{ behaelterId: 'a', zugang: 60 }, { behaelterId: 'b', zugang: 60 }]), null)
    assert.match(fassungsFehlerListe(g, [{ behaelterId: 'a', zugang: 60 }, { behaelterId: 'a', zugang: 60 }]), /Die Charge \(120 l\) passt nicht in „A“/)
    assert.equal(fassungsFehlerListe(g, [{ behaelterId: 'x', zugang: 5000 }, { behaelterId: '', zugang: 5 }]), null)
    assert.equal(fassungsFehlerListe(g, [{ behaelterId: 'a', zugang: 120 }, { behaelterId: 'a', zugang: 0, abgang: 30 }]), null, 'Bearbeiten: bisherige Buchung geht ab')
  })
  test('fassungenAus: Inhalt = eigene + fremde Liter (Kellergemeinschaft)', () => {
    const m = fassungenAus([{ id: 'g', name: 'Gemeinsam', volumen_liter: 100, eigen_liter: 0, fremd_liter: 80 }])
    assert.deepEqual(m.get('g'), { id: 'g', name: 'Gemeinsam', volumen_liter: 100, inhalt: 80 })
    assert.match(fassungsFehler(m.get('g'), 30), /frei 20 l/)
  })
  test('Meldung der App = Meldung der Datenbank (DB-Test 84)', () => {
    const t84 = quelle('scripts/db-tests/84_fassungsvermoegen.sql')
    const app = [
      fassungsFehler({ name: 'S112TEST Klein', volumen_liter: 100, inhalt: 0 }, 200),
      fassungsFehler({ name: 'S112TEST Klein', volumen_liter: 100, inhalt: 0 }, 100.6),
      fassungsFehler({ name: 'S112TEST Groß', volumen_liter: 1000, inhalt: 200 }, 1250.25),
      fassungsFehler({ name: 'S112TEST Voll', volumen_liter: 100, inhalt: 150 }, 10),
      fassungsFehler({ name: 'S112TEST Gemeinsam', volumen_liter: 100, inhalt: 80 }, 40),
    ]
    for (const m of app) assert.ok(t84.includes(`'23514: ${m} | HINT: fassungsvermoegen'`), m)
  })
})

// ── 2. Server-Lader ──────────────────────────────────────────────────────────────────────────────────────────
describe('2. pruefeFassung (lade_behaelter)', () => {
  const client = (data, error = null) => ({ rpc: async (name, args) => {
    assert.equal(name, 'lade_behaelter')
    assert.deepEqual(args, { p_tenant_id: 't1' })
    return { data, error }
  } })
  const zeilen = [
    { id: 'g1', tenant_id: 't1', name: 'Tank 1', volumen_liter: '1000.00', eigen_liter: '700', fremd_liter: 0, aktiv: true },
    { id: 'g2', tenant_id: 't2', name: 'Partnertank', volumen_liter: 100, eigen_liter: 0, fremd_liter: '80', aktiv: true, fremd: true },
  ]
  test('eigener und fremder Inhalt zählen, Text-Zahlen von PostgREST', async () => {
    assert.equal(await pruefeFassung(client(zeilen), 't1', [{ behaelterId: 'g1', zugang: 300 }]), null)
    assert.match(await pruefeFassung(client(zeilen), 't1', [{ behaelterId: 'g1', zugang: 301 }]), /frei 300 l/)
    assert.match(await pruefeFassung(client(zeilen), 't1', [{ behaelterId: 'g2', zugang: 30 }]), /„Partnertank“ \(Fassungsvermögen 100 l, frei 20 l\)/)
  })
  test('ohne Zugang kein Laden; Lesefehler wirft (KAN-254: nie still „passt“)', async () => {
    assert.equal(await pruefeFassung({ rpc: async () => assert.fail('nicht laden') }, 't1', [{ behaelterId: 'g1', zugang: 0 }]), null)
    await assert.rejects(pruefeFassung(client(null, { message: 'kaputt' }), 't1', [{ behaelterId: 'g1', zugang: 5 }]), /Gebinde konnten nicht geladen werden/)
  })
})

// ── 3. umziehen() gegen die Attrappe ─────────────────────────────────────────────────────────────────────────
const T = 'tenant-1'
const G1 = uuid(201), G2 = uuid(202), G3 = uuid(203)
const RR = uuid(11), GV = uuid(12)
const um = hooksMoeglich ? await laden('app/(dashboard)/kellerbuch/umziehen/actions.ts') : null
const charge = (id, behaelter_id, teil) => ({
  id, tenant_id: T, name: id, behaelter_id, menge_liter: 1000, aktiv: true, status: 'ausbau', rebsorte: 'Riesling', weinart: 'weiss',
  jahrgang: 2025, qualitaetsstufe: 'qualitaetswein', zusatzbezeichnung: null, erzeugnis: null, herkunft_code: 'kamptal_riedenwein',
  notizen: null, weingarten_id: null, land_iso: 'AT', storniert_am: null, ...teil,
})
const gebinde = (id, volumen_liter, eigen_liter = 0) => ({ id, tenant_id: T, name: `Tank ${id.slice(-3)}`, aktiv: true, fremd: false, fremd_liter: 0, eigen_liter, volumen_liter })
function db() {
  const t = {
    weinausbau: [charge(RR, G1, { menge_liter: 500 }), charge(GV, G3, { menge_liter: 50, rebsorte: 'Grüner Veltliner', name: 'GV' })],
    keller_umzuege: [], rebsorten: [], verschneidungen: [], verschneidung_quellen: [], zukauf_posten: [], pressung_behaelter: [],
    fuellung_chargen: [], verkauf_positionen: [], dac_antrag: [], fuellungen: [],
  }
  const d = datenbank(t, {
    rpc: async name => name === 'lade_behaelter'
      ? { data: [gebinde(G1, 1000, 500), gebinde(G2, 300), gebinde(G3, 100, 50)], error: null }
      : { data: null, error: { message: `rpc ${name} darf nicht laufen` } },
  })
  globalThis.__serverFake = d
  globalThis.__membership = { tenantId: T, role: 'winzer', schreibmodule: ['kellerbuch'] }
  globalThis.__revalidiert = []
  return d
}
const umzugFd = (quellen, ziele) => {
  const fd = new FormData()
  fd.set('quellen_json', JSON.stringify(quellen))
  fd.set('ziele_json', JSON.stringify(ziele))
  fd.set('datum', '2026-10-23')
  return fd
}
const schreibend = d => d.aufrufe.filter(a => ['insert', 'update', 'delete', 'upsert'].includes(a.art) || a.art === 'rpc' && a.tabelle !== 'rpc:lade_behaelter')

describe('3. umziehen(): zu kleines Ziel → Meldung, nichts gebucht', nurMitHooks, () => {
  test('Umzug 500 l in ein Gebinde mit 300 l: abgelehnt, Quelle nicht gemindert', async () => {
    const d = db()
    await assert.rejects(um.umziehen(umzugFd([{ weinausbau_id: RR, menge: 500 }], [{ behaelter_id: G2, menge: 500 }])),
      e => e.message === 'Die Charge (500 l) passt nicht in „Tank 202“ (Fassungsvermögen 300 l, frei 300 l).')
    assert.deepEqual(schreibend(d), [])
    assert.equal(zeile(d, 'weinausbau', RR).menge_liter, 500)
  })
  test('Umzug wäre ein Verschnitt (anderer Wein im Ziel): ebenso vor jeder Buchung abgelehnt', async () => {
    const d = db()
    await assert.rejects(um.umziehen(umzugFd([{ weinausbau_id: RR, menge: 60 }], [{ behaelter_id: G3, menge: 60 }])),
      e => /Die Charge \(60 l\) passt nicht in „Tank 203“ \(Fassungsvermögen 100 l, frei 50 l\)/.test(e.message))
    assert.deepEqual(schreibend(d), [])
  })
  test('mehrere Ziel-Zeilen in dasselbe Gebinde werden summiert', async () => {
    const d = db()
    await assert.rejects(um.umziehen(umzugFd([{ weinausbau_id: RR, menge: 400 }], [{ behaelter_id: G2, menge: 200 }, { behaelter_id: G2, menge: 200 }])),
      /Die Charge \(400 l\) passt nicht in „Tank 202“/)
    assert.deepEqual(schreibend(d), [])
  })
  test('passendes Ziel (300 l in 300 l) bucht', async () => {
    const d = db()
    await um.umziehen(umzugFd([{ weinausbau_id: RR, menge: 300 }], [{ behaelter_id: G2, menge: 300 }]))
    assert.equal(zeile(d, 'weinausbau', RR).menge_liter, 200)
    assert.equal(d.tabellen.weinausbau.filter(c => c.behaelter_id === G2 && c.menge_liter === 300).length, 1)
  })
})

// ── 4. Verdrahtung ───────────────────────────────────────────────────────────────────────────────────────────
const vor = (text, a, b, nachricht) => {
  const i = text.indexOf(a), j = text.indexOf(b, Math.max(0, i))
  assert.ok(i >= 0, `${nachricht}: „${a}“ fehlt`)
  assert.ok(j > i, `${nachricht}: „${a}“ steht nicht vor „${b}“`)
}
const abschnitt = (text, von, bis) => text.slice(text.indexOf(von), bis ? text.indexOf(bis, text.indexOf(von) + 1) : undefined)

describe('4. Alle Zugangswege nutzen die gemeinsame Regel vor der ersten Buchung', () => {
  test('Umzug (Formular „Umziehen“, n:m): Server vor der ersten Buchung, Formular sperrt', () => {
    const a = quelle('src/app/(dashboard)/kellerbuch/umziehen/actions.ts')
    const u = abschnitt(a, 'export async function umziehen(', 'async function umzugBuchen(')
    vor(u, 'fassungsFehlerListe(fassungenAus(zielGebinde)', 'return umzugMitVerschnitten(', 'umziehen')
    vor(u, 'fassungsFehlerListe(fassungenAus(zielGebinde)', 'await umzugBuchen(', 'umziehen')
    const c = quelle('src/app/(dashboard)/kellerbuch/umziehen/UmziehenClient.tsx')
    assert.match(c, /fassungsFehlerListe\(fassungen, ziele\.map\(z => \(\{ behaelterId: z\.behId, zugang: parseFloat\(z\.menge\) \|\| 0 \}\)\)\)/)
    assert.match(c, /if \(fassungFehlerText\)\s+\{ setError\(fassungFehlerText\); return \}/)
  })
  test('Umzug bearbeiten (Storno + Neubuchung) und Formular UmziehenFormClient', () => {
    const g = quelle('src/app/(dashboard)/kellerbuch/gebinde-actions.ts')
    const p = abschnitt(g, 'async function pruefeUmzug(', 'const UMZUG_WAERE_VERSCHNITT')
    assert.match(p, /fassungsFehlerListe\(fassungenAus\(zielGebinde\)/)
    assert.match(p, /deltaJeGebinde/)
    vor(g, 'await pruefeUmzug(supabase, tenantId, neu, new Map(', 'await storniereUmzug(supabase, tenantId, plan, GRUND_BEARBEITET)', 'updateUmzugBatch')
    const f = quelle('src/components/kellerbuch/UmziehenFormClient.tsx')
    assert.match(f, /fassungsFehlerListe\(fassungen, \[/)
    assert.match(f, /&& !fassungFehlerText/)
  })
  test('Chargen-Seite (UmziehenWidget) und Kellerplan nutzen fassungsFehler', () => {
    const w = quelle('src/components/kellerbuch/UmziehenWidget.tsx')
    assert.match(w, /const fassungFehlerText = nettoVal > 0 \? fassungsFehler\(fassung, nettoVal\) : null/)
    assert.match(w, /&& !fassungFehlerText/)
    const k = quelle('src/lib/keller/kellerplanZiehen.ts')
    assert.match(k, /fassungsFehler\(\{ name: p\.ziel\.name, volumen_liter: p\.ziel\.volumen_liter, inhalt: p\.ziel\.fuellung \}, p\.menge\)/)
  })
  test('Verschnitt (Service für Formular, Umzug, Pressung, Assistent, Zukauf) und Verschneiden-Formular', () => {
    const s = quelle('src/lib/kellerbuch/verschnittBuchen.ts')
    assert.match(s, /const CHARGE_SPALTEN = 'id, name, menge_liter, aktiv, behaelter_id,/)
    const v = abschnitt(s, 'export async function verschnittVorbereiten(', 'function rpcFehler(')
    vor(v, 'fassungsFehler((await ladeFassungen(supabase, tenantId)).get(zielGebinde), zugang, { abgang })', 'return {', 'verschnittVorbereiten')
    assert.match(v, /\(virtuell\?\.menge \?\? 0\)/)
    const f = quelle('src/components/kellerbuch/VerschneidungForm.tsx')
    assert.match(f, /fassungsFehler\(zielFassung, zuflussGesamt, \{ abgang: abflussGleichesGebinde \}\)/)
    assert.match(f, /disabled=\{pending \|\| !!fassungFehlerText\}/)
  })
  test('Zukauf: Anlegen und Bearbeiten (Mehrmenge, neues Gebinde) vor der Buchung', () => {
    const z = quelle('src/app/(dashboard)/weinhandel/zukauf/actions.ts')
    const c = abschnitt(z, 'export async function createZukauf(', 'export async function updateZukauf(')
    vor(c, "pruefeFassung(supabase, tenantId, [{ behaelterId: f.zielBehaelterId as string, zugang: f.menge }])", "('s112_zukauf_buchen'", 'createZukauf')
    const u = abschnitt(z, 'export async function updateZukauf(', 'async function verschnittDesZukaufs(')
    vor(u, 'zugang: neu - bisher', 'await chargeAendern(supabase, chargeId, tenantId, { ...chargeStammdaten(f), menge_liter: neu })', 'Mehrmenge')
    vor(u, 'KAN-381: neues Gebinde muss die volle Belegmenge fassen', 'await bereinigCharge(supabase, chargeId, tenantId)', 'Gebindewechsel')
    assert.equal((u.match(/pruefeFassung\(/g) ?? []).length, 3)
    const n = quelle('src/app/(dashboard)/weinhandel/zukauf/neu/page.tsx')
    assert.match(n, /if \(fassungFehlerText\) \{ setError\(fassungFehlerText\); return \}/)
  })
  test('Pressung: behaelterPruefung mit der gemeinsamen Regel, Inhalt über lade_behaelter (auch Partner-Gebinde)', () => {
    const l = quelle('src/lib/wein/pressungLesedatum.ts')
    assert.match(l, /const f = fassungsFehler\(\{ name: b\.name \?\? 'ohne Namen', volumen_liter: b\.volumen_liter, inhalt: o\.fuellstand\[b\.id\] \?\? 0 \}, plus\)/)
    const a = quelle('src/app/(dashboard)/erntemeldung/actions.ts')
    const u = abschnitt(a, 'export async function upsertPressung(', 'export async function deletePressung')
    assert.match(u, /await ladeFassungen\(supabase, tenantId\)/)
    assert.doesNotMatch(u, /from\('v_behaelter_fuellstand'\)/)
    vor(u, 'const fehlerText = behaelterPruefung({', 'mostzeileMitChargeAnlegen(supabase, tenantId, pressId, b, vorgaben)', 'Pressung')
  })
  test('Produktion und Eröffnungsbestand-Import auf die gemeinsame Regel umgestellt', () => {
    assert.match(quelle('src/lib/kellerbuch/produktion.ts'), /return fassungsFehler\(\{ name: gebinde\.name, volumen_liter: gebinde\.volumen, inhalt: gebinde\.inhalt \?\? 0 \}, zielLiter\)/)
    assert.match(quelle('src/lib/import/eroeffnungsbestand.ts'), /fassungsFehler\(\{ name: g\.anzeigeName, volumen_liter: g\.volumen, inhalt: 0 \}, liter\)/)
  })
  test('Eröffnungsbestand (Formular und Bearbeiten), Zugangskorrektur, Volumenzugang, Charge bearbeiten', () => {
    const g = quelle('src/app/(dashboard)/kellerbuch/gebinde-actions.ts')
    const ins = abschnitt(g, 'async function insertEroeffnungsbestand(', 'const WEINARTEN')
    vor(ins, 'const voll = fassungsFehler(g, menge)', "('get_next_transaktionsnr'", 'Eröffnungsbestand')
    assert.match(g, /const kontext = \{ \.\.\.\(await eroeffnungImportKontext\(\)\), fassungGeprueft: true \}/)
    const sp = abschnitt(g, 'async function eroeffnungsbestandSpeichern(', 'export async function updateEroeffnungsbestand(')
    vor(sp, 'KAN-381: Fassungsvermögen – neues Gebinde mit der ganzen Menge', '.update(payload)', 'Eröffnungsbestand bearbeiten')
    const k = quelle('src/app/(dashboard)/kellerbuch/actions.ts')
    const zk = abschnitt(k, 'export async function zugangskorrekturBuchen(', 'export async function zugangskorrekturStornieren(')
    vor(zk, "pruefeFassung(supabase, tenantId, [{ behaelterId: charge.behaelter_id as string, zugang: menge }])", "'s112_zugangskorrektur_buchen'", 'Zugangskorrektur')
    const kb = abschnitt(k, 'export async function speichereKellerbehandlung(', 'export async function createKellerbehandlung(')
    vor(kb, 'pruefeFassung(supabase, tenantId, [{ behaelterId, zugang: zugangLiter }])', "from('keller_behandlungen')", 'Volumenzugang')
    const uw = abschnitt(k, 'export async function updateWeinausbau(', 'export async function verarbeitungBuchen(')
    vor(uw, 'pruefeFassung(supabase, tenantId, [{ behaelterId: ziel, zugang: bestand }])', ".update(payload)", 'Charge bearbeiten')
  })
  test('Datenbank-Meldung (23514) erreicht das Formular unverändert (dbFehlerText)', async () => {
    const { dbFehlerText } = await import('../../src/lib/fehler.ts')
    const m = 'Die Charge (40 l) passt nicht in „Tank 1“ (Fassungsvermögen 100 l, frei 20 l).'
    assert.equal(dbFehlerText({ code: '23514', message: m, hint: 'fassungsvermoegen' }, 'Speichern fehlgeschlagen'), m)
  })
})

// ── 5. Datenbank ─────────────────────────────────────────────────────────────────────────────────────────────
const mig = existsSync(path.join(WURZEL, 'supabase/migrations'))
  ? readdirSync(path.join(WURZEL, 'supabase/migrations')).find(f => /_kan381_fassungsvermoegen\.sql$/.test(f)) : undefined
const sqlPfad = mig ? `supabase/migrations/${mig}` : 'supabase/entwurf/kan381_fassungsvermoegen.sql'
const sqlDa = existsSync(path.join(WURZEL, sqlPfad))

describe('5. Datenbank: Trigger und DB-Test', () => {
  test('Constraint-Trigger aufgeschoben, Vorher-Stand, Toleranz, Wartung, Konventionen', { skip: sqlDa ? false : 'Entwurf nur lokal (supabase/entwurf ist nicht eingecheckt)' }, () => {
    const s = quelle(sqlPfad)
    assert.match(s, /CREATE CONSTRAINT TRIGGER z_fassungsvermoegen\s+AFTER INSERT OR UPDATE OF menge_liter, behaelter_id, aktiv, storniert_am\s+ON public\.weinausbau\s+DEFERRABLE INITIALLY DEFERRED/)
    assert.match(s, /CREATE TRIGGER a_fassung_vorher\s+BEFORE INSERT OR UPDATE OF menge_liter, behaelter_id, aktiv, storniert_am/)
    assert.match(s, /v_inhalt <= v_beh\.volumen_liter \+ 0\.5/)
    assert.match(s, /IF v_neu <= v_alt THEN/)
    assert.match(s, /IF v_inhalt <= v_vorher \+ 0\.005 THEN/)
    assert.match(s, /USING ERRCODE = '23514', HINT = 'fassungsvermoegen'/)
    assert.match(s, /'Die Charge \(% l\) passt nicht in „%“ \(Fassungsvermögen % l, frei % l\)\.'/)
    assert.equal((s.match(/public\.s112_wartung_frei\(NEW\.tenant_id\)/g) ?? []).length, 2)
    assert.equal((s.match(/SECURITY DEFINER\n SET search_path = public/g) ?? []).length, 2)
    assert.match(s, /REVOKE EXECUTE ON FUNCTION public\.s112_fassung_vorher\(\) FROM PUBLIC, anon, authenticated;/)
    assert.match(s, /REVOKE EXECUTE ON FUNCTION public\.s112_fassungsvermoegen_pruefen\(\) FROM PUBLIC, anon, authenticated;/)
    assert.match(s, /aktiv AND w\.storniert_am IS NULL AND w\.menge_liter > 0/, 'Inhalt wie lade_behaelter/v_behaelter_fuellstand')
    assert.match(s, /FOR NO KEY UPDATE/)
    assert.doesNotMatch(s.replace(/--.*$/gm, ''), /\bCOMMIT\b|\bROLLBACK\b/)   // Replikationsmodus/Trigger-Abschalten prüft check-replica.js
  })
  test('DB-Test 84 deckt die Fälle des Tickets ab; Triggerfunktionen eingestuft; Test 20 löst offene Prüfungen vor TRUNCATE aus', () => {
    const t = quelle('scripts/db-tests/84_fassungsvermoegen.sql')
    for (const fall of ['umzug_zu_klein', 'umzug_passt', 'teilumzug_transaktion', 'ziel_vor_quelle', 'toleranz_100_5', 'toleranz_100_6_meldung',
      'ohne_volumen_frei', 'ueberfuellt_mindern', 'ueberfuellt_umbenennen', 'ueberfuellt_umverteilen', 'ueberfuellt_erhoehen',
      'verschnitt_zu_gross', 'produktion_zu_gross', 'zukauf_zu_gross', 'pressung_zu_gross', 'zugangskorrektur_zu_gross',
      'gemeinschaft_zu_viel', 'wartung_frei', 'postgres_zu_gross']) {
      assert.ok(t.includes(`'${fall}'`), fall)
    }
    const h = quelle('scripts/db-tests/_helfer.sql')
    assert.match(h, /\('trigger', +'--S', false, 's112_fassung_vorher\(\)'\)/)
    assert.match(h, /\('trigger', +'--S', false, 's112_fassungsvermoegen_pruefen\(\)'\)/)
    assert.match(quelle('scripts/db-tests/20_sperren_protokoll_trigger.sql'), /SET CONSTRAINTS public\.z_fassungsvermoegen IMMEDIATE;/)
  })
})
