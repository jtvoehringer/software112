// Tests KAN-112 Nachtrag (03.10.2026, Entscheidung Jörgen „n Zielgebinde“): Umzug als Verschnitt in mehrere Ziel-Gebinde.
//
// Aufruf:  npm run -s test:csv  (Node ≥ 22.15 wegen module.registerHooks)
//
// 1. teileUmzugAuf (umzugAufteilung.ts): Summen exakt (Σ_i netto = Ziel, Σ_j brutto = Quelle), Schwund ≥ 0, im
//    Verhältnis der Quellen bzw. Ziele, 3 Quellen × 3 Ziele, ohne Schwund, Überhang, zu kleine Quelle.
// 2. verschnitteVorbereiten (verschnittBuchen.ts): erwartete Bestände späterer Buchungen = Stand nach den früheren.
// 3. umziehen() gegen die Attrappe: zwei Verschnitt-Ziele in EINEM Aufruf von s112_verschnitte_buchen, gemischte
//    Quellen in zwei leere Gebinde, Verschnitt + Zusammenführung gemischt, scheitert ein Verschnitt → nichts gebucht.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { DOPPEL, hooksRegistrieren, laden, nurMitHooks, hooksMoeglich, datenbank, uuid, zeile } from './buchung-attrappe.mjs'
import { verschnittRpc, verschnitteRpc } from './verschnitt-attrappe.mjs'

const modul = code => 'data:text/javascript,' + encodeURIComponent(code)
DOPPEL['@/lib/auth/seitenBetrieb'] = modul('export const pruefeSeitenBetrieb = async () => {}')
DOPPEL['@/lib/auth/sperren'] = modul('export const pruefeSchreibzugriff = async () => {}')
DOPPEL['next/navigation'] = modul('export const redirect = ziel => { const e = new Error("NEXT_REDIRECT"); e.ziel = ziel; throw e }')
hooksRegistrieren()

const ua = hooksMoeglich ? await laden('lib/kellerbuch/umzugAufteilung.ts') : null
const vb = hooksMoeglich ? await laden('lib/kellerbuch/verschnittBuchen.ts') : null
const um = hooksMoeglich ? await laden('app/(dashboard)/kellerbuch/umziehen/actions.ts') : null

const cent = n => Math.round(n * 100)
const summe = a => a.reduce((s, x) => s + cent(x), 0)

/** Invarianten einer Aufteilung (in Cent, damit kein Gleitkomma-Rauschen stört) */
function pruefeInvarianten(brutto, ziele, auf, toleranz = 0.03) {
  const B = summe(brutto), N = summe(auf.ziele)
  auf.netto.forEach((zeile, j) => assert.equal(summe(zeile), cent(auf.ziele[j]), `Σ netto Ziel ${j}`))
  brutto.forEach((b, i) => assert.equal(summe(auf.brutto.map(z => z[i])), cent(b), `Σ brutto Quelle ${i}`))
  auf.schwund.forEach(z => z.forEach(s => assert.ok(s >= 0, `Schwund ${s} ≥ 0`)))
  auf.brutto.forEach((z, j) => z.forEach((b, i) => assert.equal(cent(b), cent(auf.netto[j][i]) + cent(auf.schwund[j][i]))))
  for (let j = 0; j < ziele.length; j++) {
    for (let i = 0; i < brutto.length; i++) {
      const sollNetto = auf.ziele[j] * brutto[i] / (B / 100)
      const sollBrutto = brutto[i] * auf.ziele[j] / (N / 100)
      assert.ok(Math.abs(auf.netto[j][i] - sollNetto) <= toleranz, `netto[${j}][${i}] ${auf.netto[j][i]} ≈ ${sollNetto}`)
      assert.ok(Math.abs(auf.brutto[j][i] - sollBrutto) <= toleranz, `brutto[${j}][${i}] ${auf.brutto[j][i]} ≈ ${sollBrutto}`)
    }
  }
}

// ── 1. teileUmzugAuf ─────────────────────────────────────────────────────────

describe('KAN-112 teileUmzugAuf: Quellen auf n Ziele, größter Rest', nurMitHooks, () => {
  test('3 Quellen × 3 Ziele mit Schwund: Summen exakt, Schwund ≥ 0, im Verhältnis', () => {
    const brutto = [333.33, 100.01, 66.67], ziele = [123.45, 200, 166.54]
    const auf = ua.teileUmzugAuf(brutto, ziele)
    assert.deepEqual(auf.ziele, ziele)
    assert.deepEqual(auf.ohneAnteil, [])
    pruefeInvarianten(brutto, ziele, auf)
    assert.equal(summe(auf.schwund.flat()), cent(500.01 - 489.99))
  })
  test('viele Fälle (deterministisch): Invarianten halten immer', () => {
    let x = 12345
    const zufall = () => ((x = (x * 1103515245 + 12345) % 2147483648) / 2147483648)
    for (let fall = 0; fall < 300; fall++) {
      const brutto = Array.from({ length: 1 + Math.floor(zufall() * 4) }, () => Math.round((0.5 + zufall() * 999) * 100) / 100)
      const B = brutto.reduce((s, b) => s + b, 0)
      const anteil = 0.9 + zufall() * 0.1
      const roh = Array.from({ length: 1 + Math.floor(zufall() * 4) }, () => 0.1 + zufall())
      const r = roh.reduce((s, v) => s + v, 0)
      const ziele = roh.map(v => Math.max(0.01, Math.floor(B * anteil * v / r * 100) / 100))
      const auf = ua.teileUmzugAuf(brutto, ziele)
      if (auf.ohneAnteil.length) continue
      pruefeInvarianten(brutto, ziele, auf, 0.05)
    }
  })
  test('ohne Schwund (N = B): kein Schwund, netto = brutto', () => {
    const brutto = [300, 200, 0.03], ziele = [250.01, 249.99, 0.03]
    const auf = ua.teileUmzugAuf(brutto, ziele)
    assert.ok(auf.schwund.flat().every(s => s === 0))
    assert.deepEqual(auf.brutto, auf.netto)
    pruefeInvarianten(brutto, ziele, auf)
  })
  test('eine Quelle, zwei Ziele: Schwund im Verhältnis der Ziele', () => {
    const auf = ua.teileUmzugAuf([300], [145, 145])
    assert.deepEqual(auf.netto, [[145], [145]])
    assert.deepEqual(auf.schwund, [[5], [5]])
    assert.deepEqual(auf.brutto, [[150], [150]])
  })
  test('Ziele 0,01 L über den Quellen: Überhang vom größten Ziel abgezogen', () => {
    const auf = ua.teileUmzugAuf([100], [60.01, 40])
    assert.deepEqual(auf.ziele, [60, 40])
    assert.deepEqual(auf.brutto, [[60], [40]])
  })
  test('Quelle zu klein, um in ein Ziel 0,01 L netto zu geben → ohneAnteil', () => {
    assert.deepEqual(ua.teileUmzugAuf([1000, 0.01], [100]).ohneAnteil, [1])
  })
})

// ── 2./3. Service und umziehen() gegen die Attrappe ─────────────────────────

const T = 'tenant-1'
const G1 = uuid(101), G2 = uuid(102), G3 = uuid(103), G4 = uuid(104), G5 = uuid(105)
const RR = uuid(1)   // Riesling 2025 Riedenwein in G1
const GV = uuid(2)   // Grüner Veltliner 2025 in G2
const WR = uuid(3)   // Welschriesling 2024 Landwein in G3 (größte Charge dort)
const RR2 = uuid(4)  // Riesling 2025 Riedenwein in G3 (gleich wie RR)

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
function db(t, eingriff = (name, args) => args) {
  const d = datenbank(t, {
    rpc: async (name, args) => name === 'lade_behaelter' ? { data: [G1, G2, G3, G4, G5].map(gebinde), error: null }
      : name === 's112_verschnitt_buchen' ? verschnittRpc(t, eingriff(name, args))
      : name === 's112_verschnitte_buchen' ? verschnitteRpc(t, eingriff(name, args))
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
const rpcAufrufe = (d, name) => d.aufrufe.filter(a => a.tabelle === `rpc:${name}`).map(a => a.werte)

describe('KAN-112 verschnitteVorbereiten: erwartete Bestände in Buchungsreihenfolge', nurMitHooks, () => {
  test('zweite Buchung aus derselben Quelle erwartet den Bestand nach der ersten (Menge + Schwund abgezogen)', async () => {
    const d = db(tabellen())
    const r = await vb.verschnitteVorbereiten(d, T, [
      { datum: '2026-10-03', ziel: { weinausbauId: RR }, quellen: [{ weinausbau_id: GV, menge: 145, schwund: 5 }], notizen: null, pnBestaetigt: false },
      { datum: '2026-10-03', ziel: { weinausbauId: WR }, quellen: [{ weinausbau_id: GV, menge: 145.5, schwund: 4.5 }], notizen: null, pnBestaetigt: false },
    ])
    assert.deepEqual(r.fragen, [])
    assert.deepEqual(r.buchungen.map(b => b.quellen[0].menge_erwartet), [300, 150])
    assert.deepEqual(r.buchungen.map(b => b.kopf.ziel_menge_erwartet), [1000, 200])
    assert.equal(d.aufrufe.some(a => a.art === 'rpc' && a.tabelle.startsWith('rpc:s112_verschnitt')), false, 'nur vorbereitet, nichts gebucht')
  })
  test('Bestand reicht für die zweite Buchung nicht mehr → Ablehnung mit deutscher Meldung', async () => {
    const d = db(tabellen())
    const e = await fehlerVon(vb.verschnitteVorbereiten(d, T, [
      { datum: '2026-10-03', ziel: { weinausbauId: RR }, quellen: [{ weinausbau_id: GV, menge: 200 }], notizen: null, pnBestaetigt: false },
      { datum: '2026-10-03', ziel: { weinausbauId: WR }, quellen: [{ weinausbau_id: GV, menge: 150 }], notizen: null, pnBestaetigt: false },
    ]))
    assert.match(e.message, /übersteigt den Bestand der Charge \(100,00 L\)/)
  })
})

describe('KAN-112 umziehen() in mehrere Ziel-Gebinde', nurMitHooks, () => {
  test('eine Quelle in zwei Gebinde mit anderem Wein: zwei Verschnitte in EINEM RPC-Aufruf, Schwund je Ziel', async () => {
    const t = tabellen()
    const d = db(t)
    const r = await um.umziehen(umzugFd([{ weinausbau_id: GV, menge: 300 }], [{ behaelter_id: G1, menge: 145 }, { behaelter_id: G3, menge: 145 }]))
    assert.equal(rpcAufrufe(d, 's112_verschnitt_buchen').length, 0)
    const [aufruf] = rpcAufrufe(d, 's112_verschnitte_buchen')
    assert.equal(aufruf.p_tenant_id, T)
    assert.deepEqual(aufruf.p_buchungen.map(b => b.kopf.ziel_weinausbau_id), [RR, WR])
    assert.deepEqual(aufruf.p_buchungen.map(b => b.quellen.map(q => [q.weinausbau_id, q.menge_liter, q.schwund_liter, q.menge_erwartet])),
      [[[GV, 145, 5, 300]], [[GV, 145, 5, 150]]])
    assert.deepEqual(r.verschnitte.map(v => [v.zielChargeId, v.zielName]), [[RR, 'Riesling Ried'], [WR, 'WR 2024']])
    assert.deepEqual(r.verschnitte[0].unterschiede, ['Rebsorte'])
    assert.equal(zeile(d, 'weinausbau', RR).menge_liter, 1145)
    assert.equal(zeile(d, 'weinausbau', WR).menge_liter, 345)
    assert.equal(zeile(d, 'weinausbau', GV).menge_liter, 0)
    assert.equal(zeile(d, 'weinausbau', GV).aktiv, false)
    assert.equal(t.verschneidungen.length, 2)
    assert.deepEqual(t.keller_umzuege.map(u => [u.umzug_typ, u.schwund_liter]), [['schwund', 5], ['schwund', 5]])
    for (const b of aufruf.p_buchungen) assert.match(b.kopf.notizen, /^Umzug als Verschnitt gebucht \(abweichend: /)
  })
  test('gemischte Quellen in zwei leere Gebinde: zwei neue Chargen, jede mit derselben Mischung', async () => {
    const t = tabellen()
    const d = db(t)
    const r = await um.umziehen(umzugFd([{ weinausbau_id: GV, menge: 300 }, { weinausbau_id: WR, menge: 200 }], [{ behaelter_id: G4, menge: 250 }, { behaelter_id: G5, menge: 240 }]))
    const [aufruf] = rpcAufrufe(d, 's112_verschnitte_buchen')
    assert.deepEqual(aufruf.p_buchungen.map(b => b.kopf.neue_ziel_charge.behaelter_id), [G4, G5])
    assert.deepEqual(aufruf.p_buchungen.map(b => b.quellen.map(q => [q.menge_liter, q.schwund_liter ?? 0])), [[[150, 3.06], [100, 2.04]], [[144, 2.94], [96, 1.96]]])
    assert.deepEqual(aufruf.p_buchungen.map(b => b.quellen.map(q => q.menge_erwartet)), [[300, 200], [146.94, 97.96]])
    assert.deepEqual(r.verschnitte.map(v => zeile(d, 'weinausbau', v.zielChargeId).behaelter_id), [G4, G5])
    assert.deepEqual(r.verschnitte.map(v => zeile(d, 'weinausbau', v.zielChargeId).menge_liter), [250, 240])
    assert.equal(zeile(d, 'weinausbau', GV).aktiv, false)
    assert.equal(zeile(d, 'weinausbau', WR).aktiv, false)
    assert.equal(cent(t.keller_umzuege.reduce((s, u) => s + u.schwund_liter, 0)), 1000)
  })
  test('ein Ziel Verschnitt, eines Zusammenführung: zuerst der Verschnitt (RPC), dann der Umzug mit dem Rest-Brutto', async () => {
    const t = tabellen()
    const d = db(t)
    const r = await um.umziehen(umzugFd([{ weinausbau_id: RR2, menge: 100 }], [{ behaelter_id: G1, menge: 40 }, { behaelter_id: G2, menge: 50 }]))
    // nur ein Verschnitt-Ziel → Einzel-RPC
    const [aufruf] = rpcAufrufe(d, 's112_verschnitt_buchen')
    assert.deepEqual(aufruf.p_quellen, [{ weinausbau_id: RR2, menge_liter: 50, schwund_liter: 5.56, menge_erwartet: 100 }])
    assert.equal(aufruf.p_kopf.ziel_weinausbau_id, GV)
    assert.deepEqual(r.verschnitte.map(v => v.zielChargeId), [GV])
    assert.equal(zeile(d, 'weinausbau', GV).menge_liter, 350)
    assert.equal(zeile(d, 'weinausbau', RR).menge_liter, 1040)
    assert.equal(zeile(d, 'weinausbau', RR2).menge_liter, 0)
    const quelle = t.keller_umzuege.find(u => u.zeilen_typ === 'quelle')
    assert.deepEqual([quelle.von_weinausbau_id, quelle.brutto_liter, quelle.schwund_liter], [RR2, 44.44, 4.44])
    const ziel = t.keller_umzuege.find(u => u.zeilen_typ === 'ziel')
    assert.deepEqual([ziel.nach_weinausbau_id, ziel.menge_liter], [RR, 40])
    // Reihenfolge: RPC vor der ersten Umzugszeile
    const iRpc = d.aufrufe.findIndex(a => a.tabelle === 'rpc:s112_verschnitt_buchen')
    const iUmzug = d.aufrufe.findIndex(a => a.tabelle === 'keller_umzuege' && a.art === 'insert')
    assert.ok(iRpc >= 0 && iRpc < iUmzug)
  })
  test('scheitert der zweite Verschnitt (Bestand geändert), ist NICHTS gebucht', async () => {
    const t = tabellen()
    const d = db(t, (name, args) => name !== 's112_verschnitte_buchen' ? args
      : { ...args, p_buchungen: args.p_buchungen.map((b, i) => (i === 1 ? { ...b, kopf: { ...b.kopf, ziel_menge_erwartet: 1 } } : b)) })
    const e = await fehlerVon(um.umziehen(umzugFd([{ weinausbau_id: GV, menge: 300 }], [{ behaelter_id: G1, menge: 145 }, { behaelter_id: G3, menge: 145 }])))
    assert.match(e.message, /„WR 2024“ hat sich inzwischen geändert – bitte erneut buchen\.$/)
    assert.equal(t.verschneidungen.length, 0)
    assert.equal(t.keller_umzuege.length, 0)
    assert.equal(zeile(d, 'weinausbau', GV).menge_liter, 300)
    assert.equal(zeile(d, 'weinausbau', RR).menge_liter, 1000)
  })
  test('dasselbe Gebinde zweimal als Ziel = ein Verschnitt', async () => {
    const d = db(tabellen())
    const r = await um.umziehen(umzugFd([{ weinausbau_id: GV, menge: 100 }], [{ behaelter_id: G1, menge: 50 }, { behaelter_id: G1, menge: 50 }]))
    assert.equal(r.verschnitte.length, 1)
    assert.deepEqual(rpcAufrufe(d, 's112_verschnitt_buchen')[0].p_quellen.map(q => q.menge_liter), [100])
  })
})
