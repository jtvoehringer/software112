// Tests KAN-112 (03.10.2026): Verschnitt aus Gebinde atomar, Zwischencharge entfällt, Gebinde-Momentaufnahme.
//
// Aufruf:  npm run -s test:csv  (Node ≥ 22.15 wegen module.registerHooks)
//
// 1. waehleZielCharge/merkmalsUnterschiede (umzugZiel.ts): Rebsorte, Jahrgang, Herkunft, Qualität (normalisiert),
//    mehrere Quellen, leeres Gebinde.
// 2. Schwund-Verteilung (verteileLiter) und Fachwerte/RPC-Argumente (verschnittWerte.ts).
// 3. umziehen() gegen die Attrappe: Verschnitt in die Anker-Charge, neue Charge bei gemischten Quellen im leeren
//    Gebinde, gleiche Quellen in leeres Gebinde bleiben ein Umzug (mehrere Ziele: kan112-n-ziele.test.mjs).
// 4. Storno: Schwund beim Verschnitt geht an die Quelle zurück und wird mit storniert; die Schwundbuchung allein
//    ist gesperrt.
// 5. Quellgebinde: Spalte vor Regel, Hinweis „Gebinde rekonstruiert“, Blend-Schritt mit Schwund.
// 6. Quelltext: Redirect ins Verschneiden-Formular entfernt, Umzug bearbeiten lehnt Verschnitt ab, Assistent.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { verteileLiter } from '../../src/lib/wein/mischungsrechnung.ts'
import { quellGebindeAusDaten, verschnittQuelleText, gebindeText } from '../../src/lib/kellerbuch/quellGebindeKern.ts'
import { DOPPEL, hooksRegistrieren, laden, nurMitHooks, hooksMoeglich, datenbank, uuid, zeile } from './buchung-attrappe.mjs'
import { verschnittRpc, verschnitteRpc } from './verschnitt-attrappe.mjs'

const modul = code => 'data:text/javascript,' + encodeURIComponent(code)
DOPPEL['@/lib/auth/seitenBetrieb'] = modul('export const pruefeSeitenBetrieb = async () => {}')
DOPPEL['@/lib/auth/sperren'] = modul('export const pruefeSchreibzugriff = async () => {}')
DOPPEL['next/navigation'] = modul('export const redirect = ziel => { const e = new Error("NEXT_REDIRECT"); e.ziel = ziel; throw e }')
hooksRegistrieren()

const WURZEL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const quelle = rel => readFileSync(path.join(WURZEL, rel), 'utf8').replace(/\r\n/g, '\n')

const uz = hooksMoeglich ? await laden('lib/kellerbuch/umzugZiel.ts') : null
const vw = hooksMoeglich ? await laden('lib/kellerbuch/verschnittWerte.ts') : null
const um = hooksMoeglich ? await laden('app/(dashboard)/kellerbuch/umziehen/actions.ts') : null
const st = hooksMoeglich ? await laden('lib/kellerbuch/storno.ts') : null
const bs = hooksMoeglich ? await laden('lib/behoerden/blendSchritte.ts') : null

const T = 'tenant-1'
const G1 = uuid(101), G2 = uuid(102), G3 = uuid(103), G4 = uuid(104)
const RR = uuid(1)   // Riesling 2025 Riedenwein in G1 (Ziel)
const GV = uuid(2)   // Grüner Veltliner 2025 in G2
const WR = uuid(3)   // Welschriesling 2024 Landwein in G3
const RR2 = uuid(4)  // Riesling 2025 Riedenwein in G3 (gleich wie RR)

// ── 1. waehleZielCharge ──────────────────────────────────────────────────────

describe('KAN-112 waehleZielCharge: Verschnitt bei abweichenden Merkmalen', nurMitHooks, () => {
  const wein = teil => ({ rebsorte: 'Riesling', jahrgang: 2025, herkunft_code: 'kamptal_riedenwein', qualitaetsstufe: 'qualitaetswein', zusatzbezeichnung: null, erzeugnis: null, menge_liter: 100, ...teil })
  test('gleicher Wein → Zusammenführung; jedes abweichende Merkmal → Verschnitt mit Nennung', () => {
    assert.equal(uz.waehleZielCharge([wein({ id: 'a' })], [wein()]).istVerschnitt, false)
    for (const [teil, merkmal] of [
      [{ rebsorte: 'Grüner Veltliner' }, 'Rebsorte'], [{ jahrgang: 2024 }, 'Jahrgang'], [{ jahrgang: '2024' }, 'Jahrgang'],
      [{ herkunft_code: 'kamptal_gebietswein' }, 'Herkunft'], [{ qualitaetsstufe: 'kabinett' }, 'Qualität'],
      [{ zusatzbezeichnung: 'reserve' }, 'Qualität'], [{ erzeugnis: 'SEKTGU' }, 'Qualität'],
    ]) {
      const r = uz.waehleZielCharge([wein({ id: 'a', ...teil })], [wein()])
      assert.equal(r.istVerschnitt, true, JSON.stringify(teil))
      assert.deepEqual(r.unterschiede, [merkmal], JSON.stringify(teil))
      assert.equal(r.vorhanden.id, 'a')
    }
  })
  test('Qualität normalisiert: Altwert „reserve“ = Qualitätswein + Zusatz Reserve; Jahrgang als Text = Zahl', () => {
    const r = uz.waehleZielCharge([wein({ id: 'a', qualitaetsstufe: 'reserve' })], [wein({ zusatzbezeichnung: 'reserve', jahrgang: '2025' })])
    assert.equal(r.istVerschnitt, false)
  })
  test('mehrere Quellen: untereinander verschieden → Verschnitt, auch ins leere Gebinde; gleiche → Umzug', () => {
    const r = uz.waehleZielCharge([], [wein(), wein({ rebsorte: 'Welschriesling', jahrgang: 2024 })])
    assert.deepEqual(r, { vorhanden: null, istVerschnitt: true, unterschiede: ['Rebsorte', 'Jahrgang'] })
    assert.equal(uz.waehleZielCharge([], [wein(), wein()]).istVerschnitt, false)
    // Gebinde mit gleichem Wein neben anderem: bei gemischten Quellen trotzdem Verschnitt in die größte Charge
    const m = uz.waehleZielCharge([wein({ id: 'klein', menge_liter: 10 }), wein({ id: 'gross', rebsorte: 'Muskateller', menge_liter: 900 })],
      [wein(), wein({ jahrgang: 2024 })])
    assert.equal(m.vorhanden.id, 'gross')
    assert.deepEqual(m.unterschiede, ['Jahrgang', 'Rebsorte'])
  })
  test('merkmaleText', () => {
    assert.equal(uz.merkmaleText(['Rebsorte']), 'Rebsorte')
    assert.equal(uz.merkmaleText(['Rebsorte', 'Jahrgang', 'Herkunft']), 'Rebsorte, Jahrgang und Herkunft')
  })
})

// ── 2. Schwund-Verteilung und Fachwerte ──────────────────────────────────────

describe('KAN-112 Schwund-Verteilung (größter Rest, 2 Stellen)', () => {
  test('Summe exakt, im Verhältnis der Quellmengen', () => {
    assert.deepEqual(verteileLiter([300, 200], 10), [6, 4])
    assert.deepEqual(verteileLiter([1, 1, 1], 0.1), [0.04, 0.03, 0.03])
    assert.deepEqual(verteileLiter([100, 50], 0), [0, 0])
  })
})

describe('KAN-112 verschnittWerte: Werte und RPC-Argumente', nurMitHooks, () => {
  const ziel = { id: 'Z', name: 'Riesling Ried', menge_liter: '1000', rebsorte: 'Riesling', jahrgang: 2025, weinart: 'weiss',
    qualitaetsstufe: 'qualitaetswein', zusatzbezeichnung: 'reserve', erzeugnis: null, herkunft_code: 'kamptal_riedenwein', kmw: 19, oechsle: null, mostgewicht_einheit: 'kmw' }
  const gv = { id: 'Q', name: 'GV', menge_liter: 300.004, rebsorte: 'Grüner Veltliner', jahrgang: 2025, qualitaetsstufe: 'qualitaetswein', herkunft_code: 'kamptal_gebietswein', kmw: 17, mostgewicht_einheit: 'kmw', land_iso: 'AT' }
  test('bestehendes Ziel: erwartete Bestände ungerundet, Schwund je Quelle, Abstufungen und Hinweise in den Notizen', () => {
    const w = vw.verschnittWerte({
      datum: '2026-10-03', ziel, weinart: 'weiss', notizen: 'Abstich',
      quellen: [{ charge: gv, menge: 98, schwund: 2 }],
      gruppen: { sorten: [{ wert: 'Riesling', liter: 1000 }, { wert: 'Grüner Veltliner', liter: 98 }], jahrgaenge: [{ wert: '2025', liter: 1098 }] },
    })
    assert.equal(w.kopf.ziel_weinausbau_id, 'Z')
    assert.equal(w.kopf.ziel_menge_erwartet, 1000)
    assert.equal(w.kopf.neue_ziel_charge, undefined)
    assert.deepEqual(w.quellen, [{ weinausbau_id: 'Q', menge_liter: 98, schwund_liter: 2, menge_erwartet: 300.004 }])
    assert.equal(w.kopf.ziel.rebsorte, 'Riesling')
    assert.equal(w.kopf.ziel.jahrgang, 2025)
    assert.equal(w.kopf.ziel.herkunft_code, 'kamptal_gebietswein')
    assert.deepEqual([w.kopf.ziel.qualitaetsstufe, w.kopf.ziel.zusatzbezeichnung], ['qualitaetswein', null])
    assert.ok(w.kopf.ziel.kmw > 17 && w.kopf.ziel.kmw < 19)
    assert.deepEqual(Object.keys(w.kopf).sort(), ['datum', 'notizen', 'ziel', 'ziel_menge_erwartet', 'ziel_weinausbau_id'])
    assert.match(w.kopf.notizen, /^Abstich\nAbstufung Qualität von Qualitätswein Reserve auf Qualitätswein\nAbstufung Herkunft-Code \(BKI\) von /)
    assert.deepEqual(w.qualitaetAbgestuft, { von: 'Qualitätswein Reserve', nach: 'Qualitätswein' })
    assert.deepEqual(w.herkunftAbgestuft, { von: 'kamptal_riedenwein', nach: 'kamptal_gebietswein' })
  })
  test('neue Charge: Angaben nach der 85-%-Regel, Weinart und Land aus den Quellen, ohne erwarteten Zielbestand', () => {
    const wr = { ...gv, id: 'W', name: 'WR', rebsorte: 'Welschriesling', jahrgang: 2024, menge_liter: 200, herkunft_code: 'kamptal_gebietswein' }
    const w = vw.verschnittWerte({
      datum: '2026-10-03', ziel: null, neueCharge: { behaelterId: 'G4', status: 'ausbau' }, weinart: vw.weinartAusQuellen(['weiss', 'weiss']), notizen: null,
      quellen: [{ charge: gv, menge: 50, schwund: 0 }, { charge: wr, menge: 50, schwund: 0.5 }],
      gruppen: { sorten: [{ wert: 'Grüner Veltliner', liter: 50 }, { wert: 'Welschriesling', liter: 50 }], jahrgaenge: [{ wert: '2025', liter: 50 }, { wert: '2024', liter: 50 }] },
    })
    assert.equal(w.kopf.ziel_weinausbau_id, undefined)
    assert.equal(w.kopf.ziel_menge_erwartet, undefined)
    const n = w.kopf.neue_ziel_charge
    assert.deepEqual([n.behaelter_id, n.weinart, n.rebsorte, n.jahrgang, n.land_iso, n.status], ['G4', 'weiss', 'Sortenverschnitt weiß', null, 'AT', 'ausbau'])
    assert.equal(n.name, 'Sortenverschnitt weiß')
    assert.deepEqual(w.quellen.map(q => q.schwund_liter), [undefined, 0.5])
    assert.equal(vw.weinartAusQuellen(['rose', 'rot']), 'rot')
    assert.equal(vw.weinartAusQuellen(['unbekannt']), 'unbekannt')
  })
  test('KAN-110: mit Herkunftsteilen gilt die 85-%-Regel (Ried bleibt bzw. fällt weg, Hinweis in den Notizen)', () => {
    const basis = { datum: '2026-10-04', ziel, weinart: 'weiss', notizen: null, quellen: [{ charge: gv, menge: 100, schwund: 0 }] }
    const sorten = { sorten: [{ wert: 'Riesling', liter: 1100 }], jahrgaenge: [{ wert: '2025', liter: 1100 }] }
    const bleibt = vw.verschnittWerte({ ...basis, gruppen: { ...sorten, herkunft: [
      { liter: 1000, code: 'kamptal_riedenwein', ried: 'Heiligenstein', ort: '12017' },
      { liter: 100, code: 'kamptal_gebietswein', ried: null, ort: null },
    ] } })
    assert.equal(bleibt.kopf.ziel.herkunft_code, 'kamptal_riedenwein')
    assert.equal(bleibt.herkunftAbgestuft, null)
    assert.match(bleibt.kopf.notizen, /Ried Heiligenstein mit 90,9 % – Rest aus demselben Weinbaugebiet/)
    const weg = vw.verschnittWerte({ ...basis, gruppen: { ...sorten, herkunft: [
      { liter: 600, code: 'kamptal_riedenwein', ried: 'Heiligenstein', ort: '12017' },
      { liter: 500, code: 'kamptal_riedenwein', ried: 'Gaisberg', ort: '12030' },
    ] } })
    assert.equal(weg.kopf.ziel.herkunft_code, 'kamptal_gebietswein')
    assert.deepEqual(weg.herkunftAbgestuft, { von: 'kamptal_riedenwein', nach: 'kamptal_gebietswein' })
    assert.match(weg.kopf.notizen, /Keine Ried bzw. Gemeinde mit mindestens 85 %/)
  })
  test('KAN-111: Herkunft lässt nur Wein zu → Qualität automatisch herabgesetzt, Vermerk; Ried im Chargennamen nur Hinweis', () => {
    const w = vw.verschnittWerte({
      datum: '2026-10-04', ziel, weinart: 'weiss', notizen: null, quellen: [{ charge: gv, menge: 100, schwund: 0 }],
      gruppen: { sorten: [{ wert: 'Riesling', liter: 1100 }], jahrgaenge: [{ wert: '2025', liter: 1100 }], herkunft: [
        { liter: 1000, code: 'kamptal_riedenwein', ried: 'Heiligenstein', ort: null },
        { liter: 100, code: 'burgenland', ried: null, ort: null },
      ] },
    })
    assert.equal(w.kopf.ziel.herkunft_code, 'wein')
    assert.deepEqual([w.kopf.ziel.qualitaetsstufe, w.kopf.ziel.zusatzbezeichnung], ['wein', null])
    assert.deepEqual(w.herkunftQualitaet?.stufe, 'wein')
    assert.match(vw.herkunftQualitaetFrage(w.herkunftQualitaet), /nur noch Wein \(aus Österreich\) zu/)
    assert.match(w.kopf.notizen, /Abstufung auf Wein – keine gemeinsame Weinbauregion bzw. verschiedene Bundesländer/)
    assert.match(w.kopf.notizen, /Chargenname „Riesling Ried“ nennt eine Ried, die nicht mehr zulässig ist/)
    assert.equal(w.kopf.ziel.name, undefined)   // Name bleibt unverändert
  })
  test('KAN-111: Landwein-Deckel nur, wenn die Mischung darüber liegt; ohne Herkunftsteile kein Deckel', () => {
    const lw = { ...gv, id: 'L', qualitaetsstufe: 'landwein', herkunft_code: 'weinland' }
    const basis = { datum: '2026-10-04', ziel: { ...ziel, qualitaetsstufe: 'landwein', zusatzbezeichnung: null, herkunft_code: 'weinland', name: 'Cuvée' }, weinart: 'weiss', notizen: null, quellen: [{ charge: lw, menge: 100, schwund: 0 }] }
    const w = vw.verschnittWerte({ ...basis, gruppen: { sorten: [{ wert: 'Riesling', liter: 1100 }], jahrgaenge: [{ wert: '2025', liter: 1100 }], herkunft: [
      { liter: 1000, code: 'weinland', ried: null, ort: null }, { liter: 100, code: 'wlnoe', ried: null, ort: null },
    ] } })
    assert.equal(w.herkunftQualitaet, null)
    assert.equal(w.kopf.ziel.qualitaetsstufe, 'landwein')
    const ohne = vw.verschnittWerte({ ...basis, gruppen: { sorten: [{ wert: 'Riesling', liter: 1100 }], jahrgaenge: [{ wert: '2025', liter: 1100 }] } })
    assert.equal(ohne.herkunftQualitaet, null)
    assert.equal(vw.riedImNamenHinweis('Ried Mandlerin 2025', 'thermenregion_gebietswein', 'thermenregion_gebietswein'), null)
  })
})

// ── 3. umziehen() gegen die Attrappe ─────────────────────────────────────────

const charge = (id, behaelter_id, teil) => ({
  id, tenant_id: T, name: id, behaelter_id, menge_liter: 1000, aktiv: true, status: 'ausbau', rebsorte: 'Riesling', weinart: 'weiss',
  jahrgang: 2025, qualitaetsstufe: 'qualitaetswein', zusatzbezeichnung: null, erzeugnis: null, herkunft_code: 'kamptal_riedenwein',
  notizen: null, weingarten_id: null, land_iso: 'AT', storniert_am: null, ...teil,
})
const gebinde = id => ({ id, tenant_id: T, name: `Tank ${id.slice(-3)}`, aktiv: true, fremd: false, fremd_liter: 0, volumen_liter: 10000 })
const tabellen = () => ({
  weinausbau: [
    charge(RR, G1, { name: 'Riesling Ried' }),
    charge(GV, G2, { name: 'GV Sandgrube', menge_liter: 300, rebsorte: 'Grüner Veltliner' }),
    charge(WR, G3, { name: 'WR 2024', menge_liter: 200, rebsorte: 'Welschriesling', jahrgang: 2024, qualitaetsstufe: 'landwein', herkunft_code: 'weinland' }),
    charge(RR2, G3, { name: 'Riesling Ried 2', menge_liter: 100 }),
  ],
  keller_umzuege: [], rebsorten: [], verschneidungen: [], verschneidung_quellen: [], zukauf_posten: [], pressung_behaelter: [],
  fuellung_chargen: [], verkauf_positionen: [], dac_antrag: [], fuellungen: [],
})
function db(t) {
  const d = datenbank(t, {
    rpc: async (name, args) => name === 'lade_behaelter' ? { data: [G1, G2, G3, G4].map(gebinde), error: null }
      : name === 's112_verschnitt_buchen' ? verschnittRpc(t, args)
      : name === 's112_verschnitte_buchen' ? verschnitteRpc(t, args)
      : { data: null, error: { message: name } },
  })
  globalThis.__serverFake = d
  globalThis.__membership = { tenantId: T, role: 'winzer', schreibmodule: ['kellerbuch'] }
  globalThis.__revalidiert = []
  return d
}
function umzugFd(quellen, ziele, extra = {}) {
  const fd = new FormData()
  fd.set('quellen_json', JSON.stringify(quellen))
  fd.set('ziele_json', JSON.stringify(ziele))
  fd.set('datum', '2026-10-03')
  for (const [k, v] of Object.entries(extra)) fd.set(k, v)
  return fd
}
async function fehlerVon(p) {
  try { await p } catch (e) { return e }
  assert.fail('Fehler erwartet')
}

describe('KAN-112 umziehen(): Verschnitt statt Zwischencharge', nurMitHooks, () => {
  test('andere Rebsorte im Ziel-Gebinde: sofort Verschnitt in die Charge dort, keine zweite Charge, kein Redirect-Signal', async () => {
    const d = db(tabellen())
    const r = await um.umziehen(umzugFd([{ weinausbau_id: GV, menge: 100 }], [{ behaelter_id: G1, menge: 100 }]))
    assert.equal(r.verschneidungNeeded, undefined)
    assert.equal(r.verschnitte.length, 1)
    assert.equal(r.verschnitte[0].zielChargeId, RR)
    assert.equal(r.verschnitte[0].zielName, 'Riesling Ried')
    assert.deepEqual(r.verschnitte[0].unterschiede, ['Rebsorte'])
    assert.equal(d.tabellen.weinausbau.filter(c => c.behaelter_id === G1).length, 1)
    assert.equal(zeile(d, 'weinausbau', RR).menge_liter, 1100)
    assert.equal(zeile(d, 'weinausbau', GV).menge_liter, 200)
    assert.equal(d.tabellen.keller_umzuege.length, 0)
    assert.equal(d.tabellen.verschneidung_quellen[0].schwund_umzug_id, null)
  })
  test('gemischte Quellen in ein leeres Gebinde: neue Charge per neue_ziel_charge, Schwund anteilig auf die Quellen', async () => {
    const d = db(tabellen())
    const r = await um.umziehen(umzugFd([{ weinausbau_id: GV, menge: 300 }, { weinausbau_id: WR, menge: 200 }], [{ behaelter_id: G4, menge: 490 }]))
    const rpc = d.aufrufe.find(a => a.tabelle === 'rpc:s112_verschnitt_buchen').werte
    assert.equal(rpc.p_kopf.neue_ziel_charge.behaelter_id, G4)
    assert.deepEqual(rpc.p_quellen.map(q => [q.weinausbau_id, q.menge_liter, q.schwund_liter]), [[GV, 294, 6], [WR, 196, 4]])
    const neu = zeile(d, 'weinausbau', r.verschnitte[0].zielChargeId)
    assert.equal(neu.behaelter_id, G4)
    assert.equal(neu.menge_liter, 490)
    assert.equal(neu.weinart, 'weiss')
    assert.equal(neu.qualitaetsstufe, 'landwein')
    assert.equal(d.tabellen.keller_umzuege.filter(u => u.umzug_typ === 'schwund').length, 2)
    assert.equal(zeile(d, 'weinausbau', GV).aktiv, false)
    assert.match(d.tabellen.verschneidungen[0].notizen, /^Umzug als Verschnitt gebucht \(abweichend: Rebsorte, Jahrgang, Herkunft und Qualität\)/)
  })
  test('Verschnitt mit mehreren Zielen: keine Ablehnung mehr (Entscheidung Jörgen 03.10.2026, „n Zielgebinde“)', async () => {
    const d = db(tabellen())
    const r = await um.umziehen(umzugFd([{ weinausbau_id: GV, menge: 100 }], [{ behaelter_id: G1, menge: 50 }, { behaelter_id: G4, menge: 50 }]))
    // G1: Verschnitt in RR; G4 leer, eine Quelle: Umzug in eine neue Charge
    assert.deepEqual(r.verschnitte.map(v => v.zielChargeId), [RR])
    assert.equal(zeile(d, 'weinausbau', GV).menge_liter, 200)
    assert.equal(d.tabellen.weinausbau.filter(c => c.behaelter_id === G4).length, 1)
  })
  test('gleicher Wein ins Gebinde: Zusammenführung wie bisher (Umzugszeilen, keine RPC)', async () => {
    const d = db(tabellen())
    const r = await um.umziehen(umzugFd([{ weinausbau_id: RR2, menge: 100 }], [{ behaelter_id: G1, menge: 100 }]))
    assert.equal(r?.verschnitte, undefined)
    assert.equal(zeile(d, 'weinausbau', RR).menge_liter, 1100)
    assert.deepEqual(d.tabellen.keller_umzuege.map(u => u.zeilen_typ).sort(), ['quelle', 'ziel'])
    assert.equal(d.aufrufe.some(a => a.tabelle === 'rpc:s112_verschnitt_buchen'), false)
  })
  test('geänderter Bestand seit der Berechnung: Meldung der RPC (40001) unverändert', async () => {
    const t = tabellen()
    const d = db(t)
    d.rpc = async (name, args) => name === 'lade_behaelter' ? { data: [G1, G2, G3, G4].map(gebinde), error: null }
      : verschnittRpc(t, { ...args, p_kopf: { ...args.p_kopf, ziel_menge_erwartet: 1 } })
    const e = await fehlerVon(um.umziehen(umzugFd([{ weinausbau_id: GV, menge: 100 }], [{ behaelter_id: G1, menge: 100 }])))
    assert.match(e.message, /hat sich inzwischen geändert – bitte erneut buchen\.$/)
  })
})

// ── 4. Storno ────────────────────────────────────────────────────────────────

describe('KAN-112 Storno des Verschnitts samt Schwund', nurMitHooks, () => {
  const VS = uuid(31), SW = uuid(41), GRUND = 'S112TEST falsch gebucht'
  const t = () => ({
    weinausbau: [charge(GV, G2, { name: 'GV', menge_liter: 198 }), charge(RR, G1, { name: 'RR', menge_liter: 1100, rebsorte: 'Riesling' })],
    verschneidungen: [{
      id: VS, tenant_id: T, datum: '2026-10-03', created_at: '2026-10-03T10:00:00.000Z', ziel_weinausbau_id: RR, storniert_am: null,
      ziel_rebsorte_vorher: 'Riesling', quellen: [{ quell_weinausbau_id: GV, menge_liter: 100, schwund_umzug_id: SW }],
    }],
    verschneidung_quellen: [{ verschneidung_id: VS, quell_weinausbau_id: GV, menge_liter: 100, schwund_umzug_id: SW, verschneidung: { created_at: '2026-10-03T10:00:00.000Z', storniert_am: null } }],
    keller_umzuege: [{ id: SW, tenant_id: T, datum: '2026-10-03', erstellt_am: '2026-10-03T10:00:00.000Z', umzug_typ: 'schwund', umzug_batch_id: null,
      von_weinausbau_id: GV, menge_liter: 0, brutto_liter: 2, schwund_liter: 2, storniert_am: null, notizen: 'Schwund beim Verschnitt in „RR“' }],
    fuellung_chargen: [], fuellungen: [], verkauf_positionen: [], zukauf_posten: [],
  })
  test('Quelle bekommt Menge + Schwund zurück, Schwundbuchung wird mit demselben Grund storniert', async () => {
    const d = datenbank(t())
    const plan = await st.planeVerschneidungStorno(d, T, VS)
    assert.equal(plan.sperre, null)
    assert.deepEqual(plan.schwundZeilen, [SW])
    assert.deepEqual(plan.aenderungen.map(a => [a.id, a.neu]).sort(), [[GV, 300], [RR, 1000]].sort())
    await st.storniereVerschneidung(d, T, plan, GRUND)
    assert.equal(zeile(d, 'weinausbau', GV).menge_liter, 300)
    assert.equal(zeile(d, 'weinausbau', RR).menge_liter, 1000)
    assert.equal(zeile(d, 'keller_umzuege', SW).storno_grund, GRUND)
    assert.ok(zeile(d, 'verschneidungen', VS).storniert_am)
  })
  test('bereits stornierte Schwundbuchung zählt nicht doppelt', async () => {
    const tab = t()
    tab.keller_umzuege[0].storniert_am = '2026-10-03T11:00:00.000Z'
    const plan = await st.planeVerschneidungStorno(datenbank(tab), T, VS)
    assert.equal(plan.schwundZeilen, undefined)
    assert.equal(plan.aenderungen.find(a => a.id === GV).neu, 298)
  })
  test('die Schwundbuchung allein ist nicht stornierbar (gehört zum Verschnitt)', async () => {
    const tab = t()
    const d = datenbank(tab, { rpc: async () => ({ data: [], error: null }) })
    const plan = await st.planeUmzugStorno(d, T, tab.keller_umzuege)
    assert.match(plan.sperre.grund, /Schwund beim Verschnitt/)
    assert.match(st.umzugSperrMeldung(plan, 'stornieren'), /Bitte den Verschnitt stornieren/)
  })
})

// ── 5. Quellgebinde, Weinbuch-/Bewegungsbuch-Text, Blend-Schritt ─────────────

describe('KAN-112 Quellgebinde: Spalte vor Regel, Hinweis „Gebinde rekonstruiert“', () => {
  const namen = new Map([['g-alt', 'Stahltank 03'], ['g-heute', 'Stahltank 07'], ['g-snap', 'Barrique 2']])
  const vs = q => [{ id: 'vs', datum: '2026-09-25', ziel_weinausbau_id: 'A', quellen: [{ quell_weinausbau_id: 'Q', ...q }] }]
  test('quell_behaelter_id gewinnt; rekonstruiert nur bei gebinde_rekonstruiert = true; ohne Spalte die Regel', () => {
    const heute = new Map([['Q', 'g-heute'], ['A', 'g-alt']])
    assert.deepEqual(quellGebindeAusDaten(vs({ quell_behaelter_id: 'g-snap', gebinde_rekonstruiert: false }), [], heute, namen).get('vs:Q'), { behaelterId: 'g-snap', name: 'Barrique 2' })
    assert.deepEqual(quellGebindeAusDaten(vs({ quell_behaelter_id: 'g-snap', gebinde_rekonstruiert: true }), [], heute, namen).get('vs:Q'), { behaelterId: 'g-snap', name: 'Barrique 2', rekonstruiert: true })
    assert.deepEqual(quellGebindeAusDaten(vs({ quell_behaelter_id: null }), [], heute, namen).get('vs:Q'), { behaelterId: 'g-heute', name: 'Stahltank 07' })
  })
  test('Texte mit Hinweis', () => {
    assert.equal(verschnittQuelleText('GV', 'Stahltank 03', '48 L', true), 'GV (Stahltank 03, Gebinde rekonstruiert) · 48 L')
    assert.equal(verschnittQuelleText('GV', 'Stahltank 03', '48 L'), 'GV (Stahltank 03) · 48 L')
    assert.equal(gebindeText('Stahltank 03', true), 'Stahltank 03 (Gebinde rekonstruiert)')
    assert.equal(gebindeText(null, true), null)
  })
  test('Blend-Schritt: Gebinde aus der Momentaufnahme, Schwund aus der Schwundbuchung, Hinweis', { skip: nurMitHooks.skip }, () => {
    const schritte = bs.blendSchritte({
      chargen: new Set(['A']), bis: null, chargeNamen: new Map([['A', 'Riesling'], ['Q', 'GV']]), gebindeJeCharge: new Map([['A', 'g-alt'], ['Q', 'g-heute']]),
      behaelterNamen: namen,
      umzuege: [{ id: 'sw', datum: '2026-09-25', umzug_typ: 'schwund', von_weinausbau_id: 'Q', nach_weinausbau_id: null, von_behaelter_id: 'g-snap', nach_behaelter_id: 'g-snap', menge_liter: 0, brutto_liter: 2, schwund_liter: 2 }],
      verschneidungen: [{ id: 'vs', datum: '2026-09-25', ziel_weinausbau_id: 'A', ziel_behaelter_id: 'g-alt', gebinde_rekonstruiert: false,
        quellen: [{ quell_weinausbau_id: 'Q', menge_liter: 48, quell_behaelter_id: 'g-snap', gebinde_rekonstruiert: true, schwund_umzug_id: 'sw' }] }],
    })
    assert.equal(schritte.length, 1)
    assert.deepEqual([schritte[0].bruttoLiter, schritte[0].schwundLiter, schritte[0].nettoLiter], [50, 2, 48])
    assert.equal(bs.schrittStelleText(schritte[0].von[0]), 'GV (Barrique 2, Gebinde rekonstruiert)')
    assert.equal(bs.schrittStelleText(schritte[0].nach[0]), 'Riesling (Stahltank 03)')
  })
})

// ── 6. Quelltext ─────────────────────────────────────────────────────────────

describe('KAN-112 Verdrahtung (Quelltext)', () => {
  test('kein Redirect ins Verschneiden-Formular mehr, stattdessen Hinweis', () => {
    for (const datei of ['src/app/(dashboard)/kellerbuch/umziehen/UmziehenClient.tsx', 'src/components/kellerbuch/UmziehenWidget.tsx']) {
      const q = quelle(datei)
      assert.doesNotMatch(q, /verschneidungNeeded|form=verschneiden&quelle=/, datei)
      assert.match(q, /result\.verschnitte\.map\(v => \(\{ zeilen: verschnittHinweis\(v\), chargeId: v\.zielChargeId \}\)\)/, datei)
    }
    assert.doesNotMatch(quelle('src/app/(dashboard)/kellerbuch/umziehen/actions.ts'), /verschneidungNeeded|istRebsortenmix/)
  })
  test('Umzug bearbeiten lehnt einen Verschnitt ab statt still eine zweite Charge anzulegen', () => {
    const q = quelle('src/app/(dashboard)/kellerbuch/gebinde-actions.ts')
    assert.match(q, /Dieser Umzug wäre ein Verschnitt – bitte stornieren und über ‚Umziehen‘ neu buchen\./)
    assert.match(q, /if \(istVerschnitt\) throw new AktionsFehler\(UMZUG_WAERE_VERSCHNITT\)/)
    assert.match(q, /if \(wahl\.istVerschnitt\) throw new AktionsFehler\(UMZUG_WAERE_VERSCHNITT\)/)
    assert.doesNotMatch(q, /export async function createUmzug/)
  })
  test('createVerschneidung prüft das Schreibrecht im Kellerbuch und bucht über den Service', () => {
    const q = quelle('src/app/(dashboard)/kellerbuch/actions.ts')
    const rumpf = q.slice(q.indexOf('export async function createVerschneidung('), q.indexOf('// VERSCHNEIDUNG STORNIEREN'))
    assert.match(rumpf, /const tenantId {2}= await kellerbuchSchreibrecht\(\)/)
    assert.match(rumpf, /await verschnittBuchen\(supabase, tenantId, \{/)
    assert.doesNotMatch(rumpf, /from\('verschneidungen'\)|from\('verschneidung_quellen'\)/)
  })
  test('Assistent: verschnitt statt verschneidung_noetig', () => {
    const t = quelle('src/lib/assistent/tools/umziehen.ts')
    assert.doesNotMatch(t, /verschneidung_noetig/)
    assert.match(t, /verschnitte: liste\.map\(v => \(\{/)
    assert.doesNotMatch(quelle('src/app/api/assistent/chat/route.ts'), /verschneidung_noetig/)
  })
})
