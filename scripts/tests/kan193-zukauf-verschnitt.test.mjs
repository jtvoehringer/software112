// Tests KAN-193 (03.10.2026, Folge von KAN-112): Zukauf in ein Gebinde mit abweichendem Wein = sofort Verschnitt,
// atomar über die RPC s112_zukauf_buchen; Storno nimmt diesen Verschnitt mit zurück. Dazu die Entscheidung Jörgen
// 03.10.2026: Rot und Weiß dürfen verschnitten werden – mit Rückfrage und Abstufung auf „Wein (aus Österreich)“.
//
// Aufruf:  npm run -s test:csv  (Node ≥ 22.15 wegen module.registerHooks)
//
// 1. rotWeissMischung und verschnittWerte (rein): Entscheidung, Mehrheitsfarbe, Abstufungswerte, weinart nur bei Änderung.
// 2. verschnittVorbereiten mit virtueller Quelle (Zukauf): 85-%-Regel, Qualität, keine Quellzeile, keine PN-Rückfrage.
// 3. createZukauf() gegen die Attrappe (verschnitt-attrappe.mjs, zukaufRpc): Verschnitt, gleiche Merkmale, Trauben, ohne
//    Kellerbuch-Recht, Rot/Weiß mit Rückfrage, Rot/Weiß gegen eine Nicht-Anker-Charge, Fehler der RPC.
// 4. deleteZukauf(): storniert zuerst den Verschnitt des Zukaufs, dann den Zukauf.
// 5. umziehen() Rot in Weiß: Rückfrage, nach Bestätigung Verschnitt mit Abstufung.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { DOPPEL, hooksRegistrieren, laden, nurMitHooks, hooksMoeglich, datenbank, uuid, zeile } from './buchung-attrappe.mjs'
import { verschnittRpc, zukaufRpc } from './verschnitt-attrappe.mjs'

const modul = code => 'data:text/javascript,' + encodeURIComponent(code)
DOPPEL['@/lib/auth/seitenBetrieb'] = modul('export const pruefeSeitenBetrieb = async () => {}')
DOPPEL['@/lib/auth/sperren'] = modul('export const pruefeSchreibzugriff = async () => {}')
DOPPEL['next/navigation'] = modul('export const redirect = ziel => { const e = new Error("NEXT_REDIRECT"); e.ziel = ziel; throw e }')
hooksRegistrieren()

const vw = hooksMoeglich ? await laden('lib/kellerbuch/verschnittWerte.ts') : null
const vb = hooksMoeglich ? await laden('lib/kellerbuch/verschnittBuchen.ts') : null
const zk = hooksMoeglich ? await laden('app/(dashboard)/weinhandel/zukauf/actions.ts') : null
const um = hooksMoeglich ? await laden('app/(dashboard)/kellerbuch/umziehen/actions.ts') : null
const hw = hooksMoeglich ? await laden('lib/kellerbuch/verschnittHinweis.ts') : null

const T = 'tenant-1'
const G1 = uuid(101), G2 = uuid(102), G3 = uuid(103)
const RR = uuid(1)   // Riesling 2025 Qualitätswein Kamptal in G1 (1000 L, weiß)
const ZW = uuid(2)   // Zweigelt 2025 in G2 (300 L, rot)
const GV = uuid(3)   // Grüner Veltliner in G3 (100 L, weiß) – zweite Charge im Gebinde G3 neben ZW3
const ZW3 = uuid(4)  // Zweigelt in G3 (800 L, rot, Anker in G3)
const GRUND = 'S112TEST Zukauf storniert'

const charge = (id, behaelter_id, teil) => ({
  id, tenant_id: T, name: id, behaelter_id, menge_liter: 1000, aktiv: true, status: 'ausbau', rebsorte: 'Riesling', weinart: 'weiss',
  jahrgang: 2025, qualitaetsstufe: 'qualitaetswein', zusatzbezeichnung: null, erzeugnis: null, herkunft_code: 'wlnoe',
  notizen: null, weingarten_id: null, land_iso: 'AT', storniert_am: null, ...teil,
})
const gebinde = id => ({ id, tenant_id: T, name: `Tank ${id.slice(-3)}`, aktiv: true, fremd: false, fremd_liter: 0, volumen_liter: 10000 })
const tabellen = (extra = []) => ({
  weinausbau: [
    charge(RR, G1, { name: 'Riesling Kamptal' }),
    charge(ZW, G2, { name: 'Zweigelt', menge_liter: 300, rebsorte: 'Zweigelt', weinart: 'rot' }),
    ...extra,
  ],
  keller_umzuege: [], rebsorten: [], verschneidungen: [], verschneidung_quellen: [], zukauf_posten: [], pressung_behaelter: [],
  fuellung_chargen: [], verkauf_positionen: [], dac_antrag: [], fuellungen: [], weinbaugebiete_custom: [],
})

/** Einbettungen wie PostgREST: verschneidung_quellen.verschneidung und verschneidungen.quellen (live, für den Storno) */
function verknuepfe(t) {
  for (const q of t.verschneidung_quellen) {
    if (Object.getOwnPropertyDescriptor(q, 'verschneidung')?.get) continue
    Object.defineProperty(q, 'verschneidung', { enumerable: true, configurable: true, get: () => t.verschneidungen.find(v => v.id === q.verschneidung_id) ?? null })
  }
  for (const v of t.verschneidungen) {
    if (Object.getOwnPropertyDescriptor(v, 'quellen')?.get) continue
    Object.defineProperty(v, 'quellen', { enumerable: true, configurable: true, get: () => t.verschneidung_quellen.filter(q => q.verschneidung_id === v.id) })
  }
}

function db(t, { module = ['kellerbuch', 'warenwirtschaft'], eingriff = (name, args) => args } = {}) {
  const d = datenbank(t, {
    rpc: async (name, args) => {
      if (name === 'lade_behaelter') return { data: [G1, G2, G3].map(gebinde), error: null }
      const a = eingriff(name, args)
      if (a?.fehler) return { data: null, error: a.fehler }
      const r = name === 's112_verschnitt_buchen' ? verschnittRpc(t, a)
        : name === 's112_zukauf_buchen' ? zukaufRpc(t, a)
        : { data: null, error: { message: name } }
      verknuepfe(t)
      return r
    },
  })
  globalThis.__serverFake = d
  globalThis.__membership = { tenantId: T, role: 'winzer', schreibmodule: module }
  globalThis.__revalidiert = []
  return d
}

const WARE = { jahrgang: '2025', qualitaetsstufe: 'qualitaetswein', herkunft: 'wlnoe', alkohol_pct: '12' }
function zukaufFd(teil = {}) {
  const fd = new FormData()
  for (const [k, v] of Object.entries({ datum: '2026-10-03', art: 'wein', menge: '200', einheit: 'L', rebsorte: 'Grüner Veltliner', weinart: 'weiss', ...WARE, ...teil })) {
    if (v != null) fd.set(k, v)
  }
  return fd
}
async function fehlerVon(p) {
  try { await p } catch (e) { return e }
  assert.fail('Fehler erwartet')
}
const rpcAufrufe = (d, name) => d.aufrufe.filter(a => a.tabelle === `rpc:${name}`).map(a => a.werte)

// ── 1. Rein: Rot/Weiß-Entscheidung und Abstufungswerte ───────────────────────

describe('KAN-193 rotWeissMischung', nurMitHooks, () => {
  test('ohne Rot/Weiß (gleiche Farbe, Rosé + Rot, unbekannt) → kein Verschnitt Rot/Weiß', () => {
    assert.deepEqual(vw.rotWeissMischung([{ weinart: 'weiss', liter: 100 }, { weinart: 'weiss', liter: 5 }]), { rotWeiss: false, weinart: null })
    assert.deepEqual(vw.rotWeissMischung([{ weinart: 'rose', liter: 100 }, { weinart: 'rot', liter: 5 }]), { rotWeiss: false, weinart: null })
    assert.deepEqual(vw.rotWeissMischung([{ weinart: 'unbekannt', liter: 100 }, { weinart: 'rot', liter: 5 }]), { rotWeiss: false, weinart: null })
  })
  test('Mehrheit der Liter entscheidet die Farbe; Rosé zählt als rot; Gleichstand → weiß', () => {
    assert.deepEqual(vw.rotWeissMischung([{ weinart: 'weiss', liter: 400 }, { weinart: 'rot', liter: 600 }]), { rotWeiss: true, weinart: 'rot' })
    assert.deepEqual(vw.rotWeissMischung([{ weinart: 'weiss', liter: 1000 }, { weinart: 'rot', liter: 200 }]), { rotWeiss: true, weinart: 'weiss' })
    assert.deepEqual(vw.rotWeissMischung([{ weinart: 'weiss', liter: 500 }, { weinart: 'rose', liter: 300 }, { weinart: 'rot', liter: 250 }]), { rotWeiss: true, weinart: 'rot' })
    assert.deepEqual(vw.rotWeissMischung([{ weinart: 'weiss', liter: 500 }, { weinart: 'rot', liter: 500 }]), { rotWeiss: true, weinart: 'weiss' })
  })
})

describe('KAN-193 verschnittWerte mit rotWeiss', nurMitHooks, () => {
  const gruppen = { sorten: [{ wert: 'Riesling', liter: 400 }, { wert: 'Zweigelt', liter: 600 }], jahrgaenge: [{ wert: '2025', liter: 1000 }] }
  const ziel = charge(RR, G1, { menge_liter: 400, zusatzbezeichnung: 'reserve', erzeugnis: null })
  const quelle = charge(ZW, G2, { menge_liter: 600, rebsorte: 'Zweigelt', weinart: 'rot' })
  test('Stufe Wein ohne Zusatz, Herkunft Österreich, Farbe nur bei Änderung, Vermerk in den Notizen', () => {
    const w = vw.verschnittWerte({ datum: '2026-10-03', ziel, weinart: 'rot', quellen: [{ charge: quelle, menge: 600, schwund: 0 }], gruppen, notizen: 'X', rotWeiss: true })
    assert.equal(w.rotWeiss, true)
    assert.equal(w.kopf.ziel.qualitaetsstufe, 'wein')
    assert.equal(w.kopf.ziel.zusatzbezeichnung, null)
    assert.equal(w.kopf.ziel.herkunft_code, 'wein')
    assert.equal(w.kopf.ziel.weinart, 'rot')
    assert.match(w.kopf.notizen, /^X\nAbstufung auf Wein \(aus Österreich\) – Verschnitt Rot\/Weiß\nAbstufung Qualität von /)
    assert.ok(w.qualitaetAbgestuft && w.herkunftAbgestuft)
    assert.equal(w.herkunftAbgestuft.nach, 'wein')
    // gleiche Farbe wie die Ziel-Charge → kein weinart-Feld (die RPC kennt es erst ab kan112c)
    const w2 = vw.verschnittWerte({ datum: '2026-10-03', ziel, weinart: 'weiss', quellen: [{ charge: quelle, menge: 600, schwund: 0 }], gruppen, notizen: null, rotWeiss: true })
    assert.equal('weinart' in w2.kopf.ziel, false)
  })
  test('ohne rotWeiss: kein weinart-Feld, Mischung wie bisher', () => {
    const w = vw.verschnittWerte({ datum: '2026-10-03', ziel, weinart: 'weiss', quellen: [{ charge: { ...quelle, weinart: 'weiss' }, menge: 600, schwund: 0 }], gruppen, notizen: null })
    assert.equal(w.rotWeiss, false)
    assert.equal(w.kopf.ziel.qualitaetsstufe, 'qualitaetswein')
    assert.equal('weinart' in w.kopf.ziel, false)
  })
  test('neue Ziel-Charge: Farbe der Mehrheit, Stufe Wein, Herkunft Österreich', () => {
    const w = vw.verschnittWerte({
      datum: '2026-10-03', ziel: null, neueCharge: { behaelterId: G3 }, weinart: 'rot', rotWeiss: true, notizen: null, gruppen,
      quellen: [{ charge: ziel, menge: 400, schwund: 0 }, { charge: quelle, menge: 600, schwund: 0 }],
    })
    assert.equal(w.kopf.neue_ziel_charge.weinart, 'rot')
    assert.equal(w.kopf.neue_ziel_charge.qualitaetsstufe, 'wein')
    assert.equal(w.kopf.neue_ziel_charge.herkunft_code, 'wein')
  })
  test('Hinweis nennt Zukauf und Rot/Weiß', () => {
    const z = hw.verschnittHinweis({ zielName: 'Riesling', unterschiede: ['Rebsorte'], qualitaetAbgestuft: null, herkunftAbgestuft: null, rotWeiss: true }, 'Zukauf')
    assert.deepEqual(z, ['Zukauf als Verschnitt in „Riesling“ gebucht (abweichend: Rebsorte).', 'Abstufung auf Wein (aus Österreich) – Verschnitt Rot/Weiß.'])
  })
})

// ── 2. Service mit virtueller Quelle ─────────────────────────────────────────

describe('KAN-193 verschnittVorbereiten mit virtueller Quelle (Zukauf)', nurMitHooks, () => {
  const virtuell = (menge, teil = {}) => ({ charge: { name: 'GV', rebsorte: 'Grüner Veltliner', jahrgang: 2025, weinart: 'weiss', qualitaetsstufe: 'landwein', herkunft_code: 'weinland', ...teil }, menge })
  test('200 L GV in 1000 L Riesling: Sortenverschnitt (Riesling 83 %), Landwein, keine Quellzeile, kein Laden einer Quelle', async () => {
    const d = db(tabellen())
    const r = await vb.verschnittVorbereiten(d, T, { datum: '2026-10-03', ziel: { weinausbauId: RR }, quellen: [], virtuelleQuelle: virtuell(200), notizen: 'Zukauf', pnBestaetigt: false })
    const b = r.buchung
    assert.deepEqual(b.quellen, [])
    assert.equal(b.kopf.ziel_weinausbau_id, RR)
    assert.equal(b.kopf.ziel_menge_erwartet, 1000)
    assert.notEqual(b.kopf.ziel.rebsorte, 'Riesling')
    assert.equal(b.kopf.ziel.qualitaetsstufe, 'landwein')
    assert.equal(b.kopf.ziel.herkunft_code, 'weinland')
    assert.ok(b.qualitaetAbgestuft)
    assert.equal(d.aufrufe.some(a => a.tabelle === 'weinausbau' && a.filter.some(f => f[0] === 'in' && f[2].some(x => x == null))), false)
  })
  test('100 L GV in 1000 L Riesling: Riesling bleibt (91 %)', async () => {
    const d = db(tabellen())
    const r = await vb.verschnittVorbereiten(d, T, { datum: '2026-10-03', ziel: { weinausbauId: RR }, quellen: [], virtuelleQuelle: virtuell(100), notizen: null, pnBestaetigt: false })
    assert.equal(r.buchung.kopf.ziel.rebsorte, 'Riesling')
  })
  test('nur mit vorhandener Ziel-Charge und ohne weitere Quellen', async () => {
    const d = db(tabellen())
    const e = await fehlerVon(vb.verschnittVorbereiten(d, T, { datum: '2026-10-03', ziel: { neueCharge: { behaelterId: G3 } }, quellen: [], virtuelleQuelle: virtuell(10), notizen: null, pnBestaetigt: false }))
    assert.match(e.message, /nur allein in eine vorhandene Charge/)
  })
})

// ── 3. createZukauf ──────────────────────────────────────────────────────────

describe('KAN-193 createZukauf()', nurMitHooks, () => {
  test('abweichender Wein im Gebinde: EIN RPC-Aufruf bucht Charge, Beleg und Verschnitt; Hinweis statt Weiterleitung', async () => {
    const t = tabellen()
    const d = db(t)
    const r = await zk.createZukauf(zukaufFd({ ziel_behaelter_id: G1, notizen: 'Lieferung A' }))
    const [aufruf] = rpcAufrufe(d, 's112_zukauf_buchen')
    assert.equal(rpcAufrufe(d, 's112_zukauf_buchen').length, 1)
    assert.equal(aufruf.p_tenant_id, T)
    assert.equal(aufruf.p_charge.behaelter_id, G1)
    assert.equal(aufruf.p_charge.menge_liter, 200)
    assert.equal('datum' in aufruf.p_verschnitt, false)
    assert.equal(aufruf.p_verschnitt.ziel_weinausbau_id, RR)
    assert.match(aufruf.p_verschnitt.notizen, /^Zukauf als Verschnitt gebucht \(abweichend: Rebsorte\)/)
    assert.deepEqual(r.verschnitt.unterschiede, ['Rebsorte'])
    assert.equal(r.verschnitt.zielChargeId, RR)
    assert.ok(r.verschnitt.verschneidungId)
    // Bestände: Anker 1200 L, Zukauf-Charge leer und abgeschlossen, Beleg zeigt auf sie
    assert.equal(zeile(d, 'weinausbau', RR).menge_liter, 1200)
    const zp = t.zukauf_posten[0]
    const zc = zeile(d, 'weinausbau', zp.ziel_weinausbau_id)
    assert.deepEqual([zc.menge_liter, zc.aktiv, zc.status, zc.behaelter_id], [0, false, 'abgeschlossen', G1])
    assert.equal(t.weinausbau.filter(c => c.behaelter_id === G1 && c.aktiv).length, 1)
    assert.equal(zp.notizen, 'Lieferung A')
    // kein direkter Schreibzugriff mehr (alles in der RPC)
    assert.equal(d.aufrufe.some(a => a.art === 'insert' || a.art === 'update'), false)
  })
  test('gleiche Merkmale: wie bisher eigene Zukauf-Charge im Gebinde, Weiterleitung zur Liste', async () => {
    const t = tabellen()
    const d = db(t)
    const e = await fehlerVon(zk.createZukauf(zukaufFd({ ziel_behaelter_id: G1, rebsorte: 'Riesling' })))
    assert.equal(e.ziel, '/weinhandel/zukauf')
    const [aufruf] = rpcAufrufe(d, 's112_zukauf_buchen')
    assert.equal(aufruf.p_verschnitt, null)
    assert.equal(t.weinausbau.filter(c => c.behaelter_id === G1 && c.aktiv).length, 2)
    assert.equal(zeile(d, 'weinausbau', RR).menge_liter, 1000)
  })
  test('Trauben: Beleg ohne Charge (p_charge null)', async () => {
    const t = tabellen()
    const d = db(t)
    const e = await fehlerVon(zk.createZukauf(zukaufFd({ art: 'trauben', einheit: 'kg', menge: '500', qualitaetsstufe: 'qualitaetswein', alkohol_pct: null, mostgewicht_wert: '19', mostgewicht_einheit: 'kmw' })))
    assert.equal(e.message, 'NEXT_REDIRECT')
    const [aufruf] = rpcAufrufe(d, 's112_zukauf_buchen')
    assert.equal(aufruf.p_charge, null)
    assert.equal(t.zukauf_posten[0].ziel_weinausbau_id, null)
  })
  test('Verschnitt nötig, aber ohne Schreibrecht im Kellerbuch → Meldung, nichts gebucht', async () => {
    const t = tabellen()
    const d = db(t, { module: ['warenwirtschaft'] })
    const e = await fehlerVon(zk.createZukauf(zukaufFd({ ziel_behaelter_id: G1 })))
    assert.match(e.message, /Schreibfreigabe für das Kellerbuch/)
    assert.equal(rpcAufrufe(d, 's112_zukauf_buchen').length, 0)
  })
  test('scheitert die RPC (Bestand geändert, 40001): Meldung unverändert, nichts gebucht', async () => {
    const t = tabellen()
    const d = db(t, { eingriff: (name, args) => (name === 's112_zukauf_buchen' ? { ...args, p_verschnitt: { ...args.p_verschnitt, ziel_menge_erwartet: 1 } } : args) })
    const e = await fehlerVon(zk.createZukauf(zukaufFd({ ziel_behaelter_id: G1 })))
    assert.match(e.message, /„Riesling Kamptal“ hat sich inzwischen geändert – bitte erneut buchen\.$/)
    assert.equal(t.zukauf_posten.length, 0)
    assert.equal(t.weinausbau.length, 2)
    assert.equal(zeile(d, 'weinausbau', RR).menge_liter, 1000)
  })
  test('Rot in Weiß: erst Rückfrage (nichts gebucht), nach Bestätigung Verschnitt mit Abstufung auf Wein (aus Österreich)', async () => {
    const t = tabellen()
    const d = db(t)
    const fd = zukaufFd({ ziel_behaelter_id: G1, rebsorte: 'Zweigelt', weinart: 'rot', menge: '1500' })
    const r = await zk.createZukauf(fd)
    assert.equal(r.bestaetigung, vw.ROT_WEISS_FRAGE)
    assert.equal(rpcAufrufe(d, 's112_zukauf_buchen').length, 0)
    fd.set('pn_bestaetigt', '1')
    fd.set('rotweiss_bestaetigt', '1')
    const r2 = await zk.createZukauf(fd)
    assert.equal(r2.verschnitt.rotWeiss, true)
    const [aufruf] = rpcAufrufe(d, 's112_zukauf_buchen')
    assert.equal(aufruf.p_verschnitt.ziel.qualitaetsstufe, 'wein')
    assert.equal(aufruf.p_verschnitt.ziel.herkunft_code, 'wein')
    assert.equal(aufruf.p_verschnitt.ziel.weinart, 'rot')   // 1500 L rot gegen 1000 L weiß
    const rr = zeile(d, 'weinausbau', RR)
    assert.deepEqual([rr.menge_liter, rr.weinart, rr.qualitaetsstufe, rr.herkunft_code], [2500, 'rot', 'wein', 'wein'])
  })
  test('Rot in ein Gebinde, in dem neben der Anker-Charge Weißwein liegt → Ablehnung wie bisher', async () => {
    const t = tabellen([
      charge(ZW3, G3, { name: 'Zweigelt groß', menge_liter: 800, rebsorte: 'Zweigelt', weinart: 'rot' }),
      charge(GV, G3, { name: 'GV klein', menge_liter: 100, rebsorte: 'Grüner Veltliner' }),
    ])
    const d = db(t)
    const e = await fehlerVon(zk.createZukauf(zukaufFd({ ziel_behaelter_id: G3, rebsorte: 'Blaufränkisch', weinart: 'rot' })))
    assert.match(e.message, /Rotwein und Weißwein dürfen laut Weingesetz nicht vermischt werden: Der Zukauf kann nicht in dieses Gebinde, dort liegt „GV klein“/)
    assert.equal(rpcAufrufe(d, 's112_zukauf_buchen').length, 0)
  })
})

// ── 4. deleteZukauf ──────────────────────────────────────────────────────────

describe('KAN-193 deleteZukauf(): Verschnitt des Zukaufs zuerst stornieren', nurMitHooks, () => {
  test('Zukauf als Verschnitt gebucht → Verschnitt storniert, Anker zurück auf 1000 L, Zukauf-Charge 0 L, Zukauf storniert', async () => {
    const t = tabellen()
    const d = db(t)
    await zk.createZukauf(zukaufFd({ ziel_behaelter_id: G1 }))
    const zp = t.zukauf_posten[0]
    await zk.deleteZukauf(zp.id, GRUND)
    assert.equal(t.verschneidungen[0].storno_grund, GRUND)
    assert.ok(t.verschneidungen[0].storniert_am)
    assert.equal(zeile(d, 'weinausbau', RR).menge_liter, 1000)
    const zc = zeile(d, 'weinausbau', zp.ziel_weinausbau_id)
    assert.deepEqual([zc.menge_liter, zc.aktiv, zc.status], [0, false, 'abgeschlossen'])
    assert.deepEqual([zp.aktiv, zp.storno_grund], [false, GRUND])
  })
  test('Anker seither weiterbewegt → Verschnitt nicht stornierbar, Zukauf bleibt', async () => {
    const t = tabellen()
    const d = db(t)
    await zk.createZukauf(zukaufFd({ ziel_behaelter_id: G1 }))
    t.keller_umzuege.push({ id: uuid(70), tenant_id: T, von_weinausbau_id: RR, nach_weinausbau_id: null, umzug_typ: 'normal', umzug_batch_id: null, storniert_am: null, erstellt_am: '2026-10-03T12:00:00Z' })
    const e = await fehlerVon(zk.deleteZukauf(t.zukauf_posten[0].id, GRUND))
    assert.match(e.message, /nicht mehr stornierbar/)
    assert.equal(t.zukauf_posten[0].aktiv, true)
    assert.equal(t.verschneidungen[0].storniert_am, null)
    assert.equal(zeile(d, 'weinausbau', RR).menge_liter, 1200)
  })
  test('ohne Kellerbuch-Recht → Meldung, nichts storniert', async () => {
    const t = tabellen()
    db(t)
    await zk.createZukauf(zukaufFd({ ziel_behaelter_id: G1 }))
    globalThis.__membership = { tenantId: T, role: 'winzer', schreibmodule: ['warenwirtschaft'] }
    const e = await fehlerVon(zk.deleteZukauf(t.zukauf_posten[0].id, GRUND))
    assert.match(e.message, /Schreibfreigabe für das Kellerbuch/)
    assert.equal(t.verschneidungen[0].storniert_am, null)
  })
  test('updateZukauf: Mengenänderung nach Verschnitt verweist auf Storno und Neuerfassung', async () => {
    const t = tabellen()
    db(t)
    await zk.createZukauf(zukaufFd({ ziel_behaelter_id: G1 }))
    const e = await fehlerVon(zk.updateZukauf(t.zukauf_posten[0].id, zukaufFd({ ziel_behaelter_id: G1, menge: '250' })))
    assert.match(e.message, /Wurde der Zukauf als Verschnitt gebucht: Änderungen an Menge, Einheit, Gebinde oder Art bitte über „Stornieren“/)
  })
})

// ── 5. umziehen() Rot in Weiß ────────────────────────────────────────────────

describe('KAN-193 umziehen(): Rot in Weiß', nurMitHooks, () => {
  const fd = extra => {
    const f = new FormData()
    f.set('quellen_json', JSON.stringify([{ weinausbau_id: ZW, menge: 300 }]))
    f.set('ziele_json', JSON.stringify([{ behaelter_id: G1, menge: 300 }]))
    f.set('datum', '2026-10-03')
    for (const [k, v] of Object.entries(extra ?? {})) f.set(k, v)
    return f
  }
  test('Rückfrage statt Ablehnung, nach Bestätigung Verschnitt mit Abstufung (Farbe weiß: 1000 L gegen 300 L)', async () => {
    const t = tabellen()
    const d = db(t)
    const r = await um.umziehen(fd())
    assert.equal(r.bestaetigung, vw.ROT_WEISS_FRAGE)
    assert.equal(t.verschneidungen.length, 0)
    const r2 = await um.umziehen(fd({ pn_bestaetigt: '1', rotweiss_bestaetigt: '1' }))
    assert.equal(r2.verschnitte[0].rotWeiss, true)
    const [aufruf] = rpcAufrufe(d, 's112_verschnitt_buchen')
    assert.equal(aufruf.p_kopf.ziel.qualitaetsstufe, 'wein')
    assert.equal(aufruf.p_kopf.ziel.herkunft_code, 'wein')
    assert.equal('weinart' in aufruf.p_kopf.ziel, false)
    assert.match(aufruf.p_kopf.notizen, /Abstufung auf Wein \(aus Österreich\) – Verschnitt Rot\/Weiß/)
    assert.equal(zeile(d, 'weinausbau', RR).menge_liter, 1300)
  })
  test('nur pn_bestaetigt (alte Clients) reicht nicht: Rückfrage bleibt, nichts gebucht', async () => {
    const t = tabellen()
    db(t)
    const r = await um.umziehen(fd({ pn_bestaetigt: '1' }))
    assert.equal(r.bestaetigung, vw.ROT_WEISS_FRAGE)
    assert.equal(t.verschneidungen.length, 0)
  })
})
