// Tests KAN-94 (Rest) und KAN-83 (01.10.2026) – Umziehen und Übergangswarnung „Prüfnummer gilt nicht mehr“
//
// Aufruf:  npm run -s test:csv  (Node ≥ 22.15 wegen module.registerHooks)
//
// 1. Reiner Helfer pruefnummernSchaden (src/lib/kellerbuch/pruefnummer.ts): Rückfrage, Vermerk,
//    harte Ablehnung bei eingereichtem Antrag, keine Rückfrage ohne geltende Nummer.
// 2. waehleZielCharge (src/lib/kellerbuch/umzugZiel.ts): Zusammenführung vs. Rebsortenmix.
// 3. umziehen() gegen die Supabase-Attrappe (buchung-attrappe.mjs):
//    - Quelle je Charge: die zweite Charge eines Gebindes wird gebucht (KAN-94)
//    - Zusammenführung Riedenwein + Gebietswein → Gebietswein, Audit-Spalten, Notiz (KAN-94)
//    - Update ohne Treffer (RLS) bricht ab statt still weiterzubuchen (KAN-94)
//    - Prüfnummer: ohne Bestätigung nichts gebucht, mit Bestätigung Vermerk; eingereicht → Ablehnung;
//      Umzug in ein leeres Gebinde ohne Rückfrage (KAN-83)
// 4. createVerschneidung() und createZukauf(): dieselben zwei Stufen (KAN-83)
// 5. Quelltextprüfungen der Verdrahtung (Clients, Assistent-Tools, Storno).

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  DOPPEL, hooksRegistrieren, laden, nurMitHooks, hooksMoeglich, datenbank, uuid, zeile,
} from './buchung-attrappe.mjs'

const modul = code => 'data:text/javascript,' + encodeURIComponent(code)
DOPPEL['@/lib/auth/seitenBetrieb'] = modul('export const pruefeSeitenBetrieb = async () => {}')
DOPPEL['@/lib/auth/sperren'] = modul('export const pruefeSchreibzugriff = async () => {}')
DOPPEL['next/navigation'] = modul('export const redirect = ziel => { const e = new Error("NEXT_REDIRECT"); e.ziel = ziel; throw e }')
hooksRegistrieren()

const WURZEL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const quelle = rel => readFileSync(path.join(WURZEL, rel), 'utf8').replace(/\r\n/g, '\n')

const pn = hooksMoeglich ? await laden('lib/kellerbuch/pruefnummer.ts') : null
const uz = hooksMoeglich ? await laden('lib/kellerbuch/umzugZiel.ts') : null
const um = hooksMoeglich ? await laden('app/(dashboard)/kellerbuch/umziehen/actions.ts') : null
const kb = hooksMoeglich ? await laden('app/(dashboard)/kellerbuch/actions.ts') : null
const zk = hooksMoeglich ? await laden('app/(dashboard)/weinhandel/zukauf/actions.ts') : null

const T = 'tenant-1'
const G1 = uuid(101), G2 = uuid(102), G3 = uuid(103)
const A1 = uuid(1)    // Riesling Riedenwein in G1
const A2 = uuid(2)    // Riesling Gebietswein in G1 (zweite Charge im selben Gebinde)
const Z = uuid(3)     // Riesling Riedenwein in G2 – Ziel der Zusammenführung, ggf. mit Prüfnummer
const ANTRAG = uuid(50)
const PN = 'N 10716/26'

// ── 1. Helfer ────────────────────────────────────────────────────────────────

const antrag = teil => ({
  id: ANTRAG, weinausbauId: Z, status: 'genehmigt', aktiv: true, pruefnummer: PN,
  mengeLiter: 5000, eingereichtAm: '2026-05-20', bescheidAm: '2026-06-08', angelegtAm: '2026-05-20', ...teil,
})
const daten = teil => ({
  chargeId: Z, bestandLiter: 500, bestandAm: '2026-09-24', antraege: [antrag()],
  zugaenge: [{ art: 'pressung', datum: '2025-09-28' }], abfuellungen: [{ datum: '2026-06-20', liter: 4500, dacAntragId: ANTRAG }], ...teil,
})

describe('pruefnummernSchaden (KAN-83)', nurMitHooks, () => {
  test('Verschnitt in die Charge mit geltender Nummer → Rückfrage mit PN und Menge, Vermerk', () => {
    const e = pn.pruefnummernSchaden('verschnitt', [{ daten: daten(), name: 'Riesling Ried Pfaffenberg', zugangLiter: 48 }], '2026-09-25')
    assert.equal(e.ablehnung, null)
    assert.deepEqual(e.schaeden, [{ chargeId: Z, name: 'Riesling Ried Pfaffenberg', pruefnummer: PN, bestandLiter: 500 }])
    assert.equal(pn.pruefnummernSchadenFrage(e.schaeden),
      'Die Prüfnummer N 10716/26 gilt für den Tankbestand der Charge „Riesling Ried Pfaffenberg“ (500 L) nicht mehr – bereits abgefüllte Flaschen behalten sie. Fortfahren?')
    assert.equal(pn.pruefnummernSchadenNotiz(e.schaeden), 'PN N 10716/26 für Tankbestand erloschen')
    assert.equal(pn.pruefnummernSchadenFrage([{ ...e.schaeden[0], name: null, bestandLiter: 548 }]),
      'Die Prüfnummer N 10716/26 gilt für den Tankbestand dieser Charge (548 L) nicht mehr – bereits abgefüllte Flaschen behalten sie. Fortfahren?')
  })
  test('auf vor die Einreichung rückdatierter Zugang → Mengenregel greift, ebenfalls Rückfrage', () => {
    const e = pn.pruefnummernSchaden('umzug', [{ daten: daten(), name: 'X', zugangLiter: 10 }], '2026-05-01')
    assert.equal(e.schaeden.length, 1)
  })
  test('keine geltende Nummer (kein Antrag, schon verletzt, nicht genehmigt) → keine Rückfrage', () => {
    assert.deepEqual(pn.pruefnummernSchaden('verschnitt', [{ daten: daten({ antraege: [] }), zugangLiter: 5 }], '2026-09-25').schaeden, [])
    const schonVerschnitten = daten({ zugaenge: [{ art: 'verschnitt', datum: '2026-09-01' }] })
    assert.deepEqual(pn.pruefnummernSchaden('verschnitt', [{ daten: schonVerschnitten, zugangLiter: 5 }], '2026-09-25').schaeden, [])
    assert.deepEqual(pn.pruefnummernSchaden('zukauf', [{ daten: daten({ antraege: [antrag({ status: 'entwurf', pruefnummer: null, eingereichtAm: null })] }), zugangLiter: 5 }], '2026-09-25'),
      { ablehnung: null, schaeden: [] })
  })
  test('Antrag eingereicht bzw. in Prüfung → harte Ablehnung „Antrag zuerst zurückziehen“', () => {
    for (const status of ['eingereicht', 'in_pruefung']) {
      const d = daten({ antraege: [antrag({ status, pruefnummer: null, bescheidAm: null })] })
      const e = pn.pruefnummernSchaden('verschnitt', [{ daten: d, name: 'Riesling Ried Pfaffenberg', zugangLiter: 48 }], '2026-09-25')
      assert.match(e.ablehnung, /Antrag zuerst zurückziehen/, status)
      assert.match(e.ablehnung, /„Riesling Ried Pfaffenberg“/)
      assert.deepEqual(e.schaeden, [])
    }
  })
  test('mitPnNotiz hängt den Vermerk als eigene Zeile an', () => {
    assert.equal(pn.mitPnNotiz(null, 'PN X für Tankbestand erloschen'), 'PN X für Tankbestand erloschen')
    assert.equal(pn.mitPnNotiz('Abstich', 'PN X für Tankbestand erloschen'), 'Abstich\nPN X für Tankbestand erloschen')
    assert.equal(pn.mitPnNotiz('Abstich', null), 'Abstich')
  })
})

// ── 2. waehleZielCharge ──────────────────────────────────────────────────────

describe('waehleZielCharge (KAN-94/KAN-83)', nurMitHooks, () => {
  const v = (id, rebsorte, menge) => ({ id, rebsorte, menge_liter: menge })
  test('gleiche Rebsorte → Zusammenführung, auch wenn eine größere andere Charge daneben liegt', () => {
    const r = uz.waehleZielCharge([v('a', 'Grüner Veltliner', 900), v('b', 'Riesling', 100)], [{ rebsorte: 'Riesling' }])
    assert.equal(r.vorhanden.id, 'b')
    assert.equal(r.istRebsortenmix, false)
  })
  test('andere Rebsorte bzw. Charge ohne Rebsorte → Rebsortenmix mit der größten Charge', () => {
    const r = uz.waehleZielCharge([v('a', 'Grüner Veltliner', 900), v('b', null, 100)], [{ rebsorte: 'Riesling' }])
    assert.equal(r.vorhanden.id, 'a')
    assert.equal(r.istRebsortenmix, true)
  })
  test('leeres Gebinde → keine Ziel-Charge; mehrere Quellen → nie Rebsortenmix', () => {
    assert.deepEqual(uz.waehleZielCharge([], [{ rebsorte: 'Riesling' }]), { vorhanden: null, istRebsortenmix: false })
    assert.equal(uz.waehleZielCharge([v('a', 'Grüner Veltliner', 1)], [{ rebsorte: 'Riesling' }, { rebsorte: 'Riesling' }]).istRebsortenmix, false)
  })
})

// ── 3. umziehen() gegen die Attrappe ─────────────────────────────────────────

const charge = (id, behaelter_id, teil) => ({
  id, tenant_id: T, name: id, behaelter_id, menge_liter: 1000, aktiv: true, status: 'ausbau', rebsorte: 'Riesling',
  weinart: 'weiss', jahrgang: 2025, qualitaetsstufe: 'qualitaetswein', herkunft_code: 'kamptal_riedenwein', notizen: null,
  weingarten_id: null, ...teil,
})
const gebinde = id => ({ id, tenant_id: T, name: `Tank ${id.slice(-3)}`, aktiv: true, fremd: false, fremd_liter: 0, volumen_liter: 10000 })

function tabellen({ antragStatus = null } = {}) {
  const t = {
    weinausbau: [
      charge(A1, G1, { name: 'Riesling Ried 2025' }),
      charge(A2, G1, { name: 'Riesling Gebiet 2025', menge_liter: 300, herkunft_code: 'kamptal_gebietswein' }),
      charge(Z, G2, { name: 'Riesling Ried Pfaffenberg', menge_liter: 500 }),
    ],
    keller_umzuege: [], rebsorten: [], verschneidungen: [], verschneidung_quellen: [], zukauf_posten: [],
    pressung_behaelter: [], fuellung_chargen: [], verkauf_positionen: [], dac_antrag: [], fuellungen: [],
  }
  if (antragStatus) {
    t.dac_antrag.push({
      id: ANTRAG, tenant_id: T, weinausbau_id: Z, bezeichnung: 'Riesling Ried Pfaffenberg 2025', status: antragStatus, aktiv: true,
      pruefnummer: antragStatus === 'genehmigt' ? PN : null, menge_liter: 5000, eingereicht_am: '2026-05-20',
      bescheid_am: antragStatus === 'genehmigt' ? '2026-06-08' : null, created_at: '2026-05-20T08:00:00Z', storniert_am: null,
    })
    t.fuellungen.push({ id: uuid(60), tenant_id: T, weinausbau_id: Z, datum: '2026-06-20', menge_liter_gefuellt: 4500, anzahl_flaschen: null, flaschengroesse_ml: null, aktiv: true, dac_antrag_id: ANTRAG })
  }
  return t
}

/** single() bildet die Attrappe nicht nach – hier wie maybeSingle() (Verschnitt und Zukauf lesen eine eingefügte Zeile) */
function mitSingle(o) {
  if (!o || typeof o !== 'object' || o instanceof Promise) return o
  return new Proxy(o, {
    get(z, k) {
      if (k === 'single') return () => z.maybeSingle()
      const v = z[k]
      return typeof v === 'function' && k !== 'then' ? (...a) => mitSingle(v.apply(z, a)) : v
    },
  })
}

function db(t, opt = {}) {
  const d = datenbank(t, { rpc: async name => name === 'lade_behaelter' ? { data: [gebinde(G1), gebinde(G2), gebinde(G3)], error: null } : { data: null, error: { message: name } }, ...opt })
  const from = d.from
  d.from = tabelle => mitSingle(from(tabelle))
  globalThis.__serverFake = d
  globalThis.__membership = { tenantId: T, role: 'winzer', schreibmodule: ['kellerbuch', 'warenwirtschaft'] }
  globalThis.__revalidiert = []
  return d
}

function umzugFd(quellen, ziele, extra = {}) {
  const fd = new FormData()
  fd.set('quellen_json', JSON.stringify(quellen))
  fd.set('ziele_json', JSON.stringify(ziele))
  fd.set('datum', '2026-10-01')
  for (const [k, v] of Object.entries(extra)) fd.set(k, v)
  return fd
}

async function fehlerVon(p) {
  try { await p } catch (e) { return e }
  assert.fail('Fehler erwartet')
}

describe('umziehen() – KAN-94', nurMitHooks, () => {
  test('Quelle je Charge: die zweite Charge im Gebinde wird gebucht, die erste bleibt unberührt', async () => {
    const d = db(tabellen())
    await um.umziehen(umzugFd([{ weinausbau_id: A2, menge: 100 }], [{ behaelter_id: G3, menge: 100 }]))
    assert.equal(zeile(d, 'weinausbau', A1).menge_liter, 1000)
    assert.equal(zeile(d, 'weinausbau', A2).menge_liter, 200)
    const q = d.tabellen.keller_umzuege.find(u => u.zeilen_typ === 'quelle')
    assert.equal(q.von_weinausbau_id, A2)
    const zz = d.tabellen.keller_umzuege.find(u => u.zeilen_typ === 'ziel')
    const neu = zeile(d, 'weinausbau', zz.nach_weinausbau_id)
    assert.equal(neu.behaelter_id, G3)
    assert.equal(neu.herkunft_code, 'kamptal_gebietswein')
    assert.equal(zz.herkunft_code_vorher, null)
    assert.equal(zz.herkunft_code_nachher, 'kamptal_gebietswein')
  })

  test('Zusammenführung Riedenwein + Gebietswein ergibt Gebietswein; Audit-Spalten und Notiz gesetzt', async () => {
    const d = db(tabellen())
    await um.umziehen(umzugFd([{ weinausbau_id: A2, menge: 300 }], [{ behaelter_id: G2, menge: 300 }]))
    const ziel = zeile(d, 'weinausbau', Z)
    assert.equal(ziel.menge_liter, 800)
    assert.equal(ziel.herkunft_code, 'kamptal_gebietswein')
    assert.match(ziel.notizen, /^Abstufung Herkunft-Code \(BKI\) von .*Riedenwein auf .*Gebietswein \(Zusammenführung per Umziehen\)$/)
    const zz = d.tabellen.keller_umzuege.find(u => u.zeilen_typ === 'ziel')
    assert.equal(zz.nach_weinausbau_id, Z)
    assert.equal(zz.herkunft_code_vorher, 'kamptal_riedenwein')
    assert.equal(zz.herkunft_code_nachher, 'kamptal_gebietswein')
    assert.match(zz.notizen, /^Abstufung Herkunft-Code \(BKI\)/)
    const q = d.tabellen.keller_umzuege.find(u => u.zeilen_typ === 'quelle')
    assert.equal(q.herkunft_code_vorher, 'kamptal_gebietswein')
    // Quelle ganz umgezogen → abgeschlossen
    assert.equal(zeile(d, 'weinausbau', A2).aktiv, false)
  })

  test('gleiche Herkunft → keine Abstufung, Herkunft unverändert', async () => {
    const d = db(tabellen())
    await um.umziehen(umzugFd([{ weinausbau_id: A1, menge: 100 }], [{ behaelter_id: G2, menge: 100 }]))
    assert.equal(zeile(d, 'weinausbau', Z).herkunft_code, 'kamptal_riedenwein')
    assert.equal(zeile(d, 'weinausbau', Z).notizen, null)
    const zz = d.tabellen.keller_umzuege.find(u => u.zeilen_typ === 'ziel')
    assert.equal(zz.herkunft_code_vorher, 'kamptal_riedenwein')
    assert.equal(zz.herkunft_code_nachher, 'kamptal_riedenwein')
  })

  test('UPDATE ohne Treffer (RLS) bricht vor der Umzugszeile ab', async () => {
    const d = db(tabellen(), { rls: (eintrag, z) => !(eintrag.art === 'update' && eintrag.tabelle === 'weinausbau' && z.id === A1) })
    const e = await fehlerVon(um.umziehen(umzugFd([{ weinausbau_id: A1, menge: 100 }], [{ behaelter_id: G3, menge: 100 }])))
    assert.match(e.message, /konnte nicht geändert werden/)
    assert.equal(d.tabellen.keller_umzuege.length, 0)
  })

  test('Winzer ohne Modul Kellerbuch kann nicht umziehen', async () => {
    db(tabellen())
    globalThis.__membership = { tenantId: T, role: 'winzer', schreibmodule: ['warenwirtschaft'] }
    const e = await fehlerVon(um.umziehen(umzugFd([{ weinausbau_id: A1, menge: 100 }], [{ behaelter_id: G3, menge: 100 }])))
    assert.match(e.message, /Keine Schreibberechtigung für das Kellerbuch/)
  })
})

describe('umziehen() – Prüfnummer (KAN-83)', nurMitHooks, () => {
  test('Zusammenführung mit geltender Nummer: ohne Bestätigung Rückfrage und nichts gebucht', async () => {
    const d = db(tabellen({ antragStatus: 'genehmigt' }))
    const r = await um.umziehen(umzugFd([{ weinausbau_id: A1, menge: 48 }], [{ behaelter_id: G2, menge: 48 }]))
    assert.match(r.bestaetigung, /^Die Prüfnummer N 10716\/26 gilt für den Tankbestand der Charge „Riesling Ried Pfaffenberg“ \(500 L\) nicht mehr – bereits abgefüllte Flaschen behalten sie\. Fortfahren\?$/)
    assert.equal(d.tabellen.keller_umzuege.length, 0)
    assert.equal(zeile(d, 'weinausbau', A1).menge_liter, 1000)
    assert.equal(zeile(d, 'weinausbau', Z).menge_liter, 500)
  })
  test('mit Bestätigung gebucht und an der Zielzeile vermerkt', async () => {
    const d = db(tabellen({ antragStatus: 'genehmigt' }))
    const r = await um.umziehen(umzugFd([{ weinausbau_id: A1, menge: 48 }], [{ behaelter_id: G2, menge: 48 }], { pn_bestaetigt: '1' }))
    assert.equal(r?.bestaetigung, undefined)
    assert.equal(zeile(d, 'weinausbau', Z).menge_liter, 548)
    const zz = d.tabellen.keller_umzuege.find(u => u.zeilen_typ === 'ziel')
    assert.equal(zz.notizen, 'PN N 10716/26 für Tankbestand erloschen')
  })
  test('Antrag eingereicht → Ablehnung, nichts gebucht', async () => {
    const d = db(tabellen({ antragStatus: 'eingereicht' }))
    const e = await fehlerVon(um.umziehen(umzugFd([{ weinausbau_id: A1, menge: 48 }], [{ behaelter_id: G2, menge: 48 }], { pn_bestaetigt: '1' })))
    assert.match(e.message, /Antrag zuerst zurückziehen/)
    assert.equal(d.tabellen.keller_umzuege.length, 0)
  })
  test('Umzug in ein leeres Gebinde und Umzug AUS der Antrags-Charge → keine Rückfrage', async () => {
    const d = db(tabellen({ antragStatus: 'genehmigt' }))
    assert.equal(await um.umziehen(umzugFd([{ weinausbau_id: A1, menge: 10 }], [{ behaelter_id: G3, menge: 10 }])), undefined)
    assert.equal(await um.umziehen(umzugFd([{ weinausbau_id: Z, menge: 10 }], [{ behaelter_id: G3, menge: 10 }])), undefined)
    assert.equal(d.tabellen.keller_umzuege.filter(u => u.zeilen_typ === 'ziel').every(u => u.notizen === null), true)
  })
})

// ── 4. Verschnitt und Zukauf ─────────────────────────────────────────────────

describe('createVerschneidung() / createZukauf() – Prüfnummer (KAN-83)', nurMitHooks, () => {
  const verschnittFd = extra => {
    const fd = new FormData()
    fd.set('datum', '2026-10-01')
    fd.set('ziel_weinausbau_id', Z)
    fd.set('quellen_json', JSON.stringify([{ weinausbau_id: A2, menge_liter: 48 }]))
    for (const [k, v] of Object.entries(extra ?? {})) fd.set(k, v)
    return fd
  }
  test('Verschnitt: ohne Bestätigung Rückfrage, nichts gebucht; mit Bestätigung Vermerk am Verschnitt', async () => {
    const d = db(tabellen({ antragStatus: 'genehmigt' }))
    const r = await kb.createVerschneidung(verschnittFd())
    assert.match(r.bestaetigung, /Prüfnummer N 10716\/26 .*\(500 L\) nicht mehr/)
    assert.equal(d.tabellen.verschneidungen.length, 0)
    assert.equal(zeile(d, 'weinausbau', Z).menge_liter, 500)

    const r2 = await kb.createVerschneidung(verschnittFd({ pn_bestaetigt: '1', notizen: 'GV ergänzt' }))
    assert.equal(r2.bestaetigung, undefined)
    assert.equal(d.tabellen.verschneidungen.length, 1)
    assert.match(d.tabellen.verschneidungen[0].notizen, /^GV ergänzt\nPN N 10716\/26 für Tankbestand erloschen/)
  })
  test('Verschnitt bei eingereichtem Antrag → Ablehnung', async () => {
    const d = db(tabellen({ antragStatus: 'eingereicht' }))
    const e = await fehlerVon(kb.createVerschneidung(verschnittFd({ pn_bestaetigt: '1' })))
    assert.match(e.message, /Antrag zuerst zurückziehen/)
    assert.equal(d.tabellen.verschneidungen.length, 0)
  })
  test('Zukauf Wein in das Gebinde der Antrags-Charge: Rückfrage, mit Bestätigung Vermerk am Zukauf', async () => {
    const d = db(tabellen({ antragStatus: 'genehmigt' }))
    const fd = new FormData()
    for (const [k, v] of Object.entries({ datum: '2026-10-01', art: 'wein', menge: '100', einheit: 'l', ziel_behaelter_id: G2, rebsorte: 'Riesling', weinart: 'weiss' })) fd.set(k, v)
    const r = await zk.createZukauf(fd)
    assert.match(r.bestaetigung, /Prüfnummer N 10716\/26/)
    assert.equal(d.tabellen.zukauf_posten.length, 0)
    fd.set('pn_bestaetigt', '1')
    const e = await fehlerVon(zk.createZukauf(fd))   // redirect() der Attrappe wirft
    assert.equal(e.message, 'NEXT_REDIRECT')
    assert.equal(d.tabellen.zukauf_posten.length, 1)
    assert.equal(d.tabellen.zukauf_posten[0].notizen, 'PN N 10716/26 für Tankbestand „Riesling Ried Pfaffenberg“ erloschen')
  })
  test('Zukauf in ein leeres Gebinde → keine Rückfrage', async () => {
    const d = db(tabellen({ antragStatus: 'genehmigt' }))
    const fd = new FormData()
    for (const [k, v] of Object.entries({ datum: '2026-10-01', art: 'wein', menge: '100', einheit: 'l', ziel_behaelter_id: G3, rebsorte: 'Riesling', weinart: 'weiss' })) fd.set(k, v)
    const e = await fehlerVon(zk.createZukauf(fd))
    assert.equal(e.message, 'NEXT_REDIRECT')
    assert.equal(d.tabellen.zukauf_posten[0].notizen, null)
  })
})

// ── 5. Verdrahtung ───────────────────────────────────────────────────────────

describe('Verdrahtung (Quelltext)', () => {
  test('UmziehenClient wählt die Quelle je Charge und fragt bei bestaetigung nach', () => {
    const q = quelle('src/app/(dashboard)/kellerbuch/umziehen/UmziehenClient.tsx')
    assert.match(q, /<option key=\{q\.charge_id\} value=\{q\.charge_id\}>/)
    assert.doesNotMatch(q, /x\.behaelter_id === q\.behId/)
    assert.match(q, /window\.confirm\(result\.bestaetigung\)[\s\S]*fd\.set\('pn_bestaetigt', '1'\)/)
  })
  test('Widget, Verschnitt- und Zukauf-Formular fragen nach', () => {
    for (const datei of ['src/components/kellerbuch/UmziehenWidget.tsx', 'src/components/kellerbuch/VerschneidungForm.tsx', 'src/app/(dashboard)/weinhandel/zukauf/neu/page.tsx']) {
      assert.match(quelle(datei), /window\.confirm\(result\.bestaetigung\)[\s\S]*fd\.set\('pn_bestaetigt', '1'\)/, datei)
    }
  })
  test('Assistent-Tools geben die Rückfrage weiter und kennen pruefnummer_verlust_bestaetigt', () => {
    for (const datei of ['src/lib/assistent/tools/umziehen.ts', 'src/lib/assistent/tools/verschneiden.ts']) {
      const q = quelle(datei)
      assert.match(q, /pruefnummer_verlust_bestaetigt: \{/, datei)
      assert.match(q, /if \(input\.pruefnummer_verlust_bestaetigt === true\) fd\.set\('pn_bestaetigt', '1'\)/, datei)
      assert.match(q, /bestaetigung_noetig: true/, datei)
    }
  })
  test('umziehen() prüft die Zeilenzahl jeder Chargenänderung', () => {
    const q = quelle('src/app/(dashboard)/kellerbuch/umziehen/actions.ts')
    const start = q.indexOf('export async function umziehen(')
    const ende = q.indexOf('export async function deleteUmzug(')
    const body = q.slice(start, ende)
    assert.doesNotMatch(body, /from\('weinausbau'\) as any\)\s*\.update\(/)
    assert.match(q, /async function aendereCharge[\s\S]*\.select\('id'\)[\s\S]*length !== 1/)
  })
  test('Storno nimmt die Herkunft-Abstufung der Zusammenführung zurück', () => {
    const q = quelle('src/lib/kellerbuch/storno.ts')
    assert.match(q, /herkunft_code_vorher, herkunft_code_nachher'/)
    assert.match(q, /a\.payload\.herkunft_code = z\.herkunft_code_vorher \?\? null/)
  })
})
