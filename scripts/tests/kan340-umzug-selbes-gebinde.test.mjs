// Tests KAN-340 (22.10.2026) – Umzug in dasselbe Gebinde
//
// Befund UAT: Paul hat 500 L aus „Immervoll 10“ nach „Immervoll 10“ umgezogen; danach lagen zwei Chargen im selben
// Gebinde. Ursache: Die Quell-Chargen zählen bei der Wahl der Ziel-Charge nicht mit (KAN-112) – war die Quelle die
// einzige Charge im Gebinde, galt es als leer, und es entstand eine neue Charge daneben.
//
// Aufruf:  npm run -s test:csv
//
// 1. Prüf-Logik (src/lib/kellerbuch/umzugGebinde.ts): Gebinde der Quellen, Fehlertext, Zielliste ohne Quell-Gebinde.
// 2. Kellerplan (bewerteZiel): Ziehen auf sich selbst ist gesperrt – mit derselben Meldung.
// 3. umziehen() gegen die Supabase-Attrappe: Ziel = Gebinde der Quelle → Ablehnung, nichts gebucht (ohne den Fix
//    entstand eine zweite Charge im selben Gebinde); auch als eines von mehreren Zielen; anderes Gebinde bucht weiter.
// 4. Verdrahtung (Quelltext): Formulare blenden die Quell-Gebinde als Ziel aus, Umzug bearbeiten prüft dasselbe.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DOPPEL, hooksRegistrieren, laden, nurMitHooks, hooksMoeglich, datenbank, uuid, zeile } from './buchung-attrappe.mjs'
import { UMZUG_SELBES_GEBINDE, istQuellGebinde, quellGebinde, selbesGebindeFehler, zielGebindeOhneQuellen } from '../../src/lib/kellerbuch/umzugGebinde.ts'

const modul = code => 'data:text/javascript,' + encodeURIComponent(code)
DOPPEL['@/lib/auth/seitenBetrieb'] = modul('export const pruefeSeitenBetrieb = async () => {}')
DOPPEL['@/lib/auth/sperren'] = modul('export const pruefeSchreibzugriff = async () => {}')
DOPPEL['next/navigation'] = modul('export const redirect = ziel => { const e = new Error("NEXT_REDIRECT"); e.ziel = ziel; throw e }')
hooksRegistrieren()

const quelle = p => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')

// ── 1. Prüf-Logik ────────────────────────────────────────────────────────────

describe('KAN-340: Prüf-Logik Quelle = Ziel', () => {
  test('Gebinde der Quellen – Chargen ohne Gebinde zählen nicht', () => {
    assert.deepEqual([...quellGebinde([{ behaelter_id: 'G1' }, { behaelter_id: 'G1' }, { behaelter_id: null }, null, { behaelter_id: 'G2' }])], ['G1', 'G2'])
  })
  test('Ziel = Gebinde einer Quelle → Meldung, sonst null', () => {
    const q = quellGebinde([{ behaelter_id: 'G1' }])
    assert.equal(selbesGebindeFehler(q, ['G1']), UMZUG_SELBES_GEBINDE)
    assert.equal(selbesGebindeFehler(q, ['G2', 'G1']), UMZUG_SELBES_GEBINDE)   // eines von mehreren Zielen
    assert.equal(selbesGebindeFehler(q, ['G2', 'G3']), null)
    assert.equal(selbesGebindeFehler(q, ['', null, undefined]), null)          // noch nicht gewählt
    assert.equal(selbesGebindeFehler(new Set(), ['G1']), null)                 // Quelle ohne Gebinde
    assert.equal(UMZUG_SELBES_GEBINDE, 'Quelle und Ziel sind dasselbe Gebinde.')
    assert.equal(istQuellGebinde('G1', q), true)
    assert.equal(istQuellGebinde('', q), false)
  })
  test('Zielliste ohne die Gebinde der Quellen; ein schon gewähltes Ziel bleibt sichtbar', () => {
    const gebinde = [{ id: 'G1' }, { id: 'G2' }, { id: 'G3' }]
    const q = quellGebinde([{ behaelter_id: 'G1' }, { behaelter_id: 'G3' }])
    assert.deepEqual(zielGebindeOhneQuellen(gebinde, q).map(g => g.id), ['G2'])
    assert.deepEqual(zielGebindeOhneQuellen(gebinde, q, 'G3').map(g => g.id), ['G2', 'G3'])
    assert.deepEqual(zielGebindeOhneQuellen(gebinde, new Set()).map(g => g.id), ['G1', 'G2', 'G3'])
  })
})

// ── 2. Kellerplan ────────────────────────────────────────────────────────────

describe('KAN-340: Kellerplan – Ziehen auf sich selbst', nurMitHooks, () => {
  test('bewerteZiel sperrt das eigene Gebinde mit derselben Meldung', async () => {
    const { bewerteZiel } = await laden('lib/keller/kellerplanZiehen.ts')
    const g = { id: 'A', name: 'Immervoll 10', volumen_liter: 2000, gesperrt: false, fremd_betrieb: null, fuellung: 500 }
    const q = { id: 'C', name: 'GV', menge_liter: 500, jahrgang: 2025, rebsorte: 'Grüner Veltliner', weinart: 'weiss', qualitaetsstufe: 'qualitaetswein', zusatzbezeichnung: null, erzeugnis: null, herkunft_code: null }
    const b = bewerteZiel({ quelle: q, quellGebinde: g, ziel: g, zielChargen: [q], menge: 500 })
    assert.equal(b.art, 'gesperrt')
    assert.equal(b.text, UMZUG_SELBES_GEBINDE)
  })
})

// ── 3. umziehen() gegen die Attrappe ─────────────────────────────────────────

const T = 'tenant-1'
const G1 = uuid(101), G2 = uuid(102)
const A = uuid(1)   // einzige Charge in G1 („Immervoll 10“)

const um = hooksMoeglich ? await laden('app/(dashboard)/kellerbuch/umziehen/actions.ts') : null

function tabellen() {
  return {
    weinausbau: [{
      id: A, tenant_id: T, name: 'Grüner Veltliner 2025', behaelter_id: G1, menge_liter: 1000, aktiv: true, status: 'ausbau',
      rebsorte: 'Grüner Veltliner', weinart: 'weiss', jahrgang: 2025, qualitaetsstufe: 'qualitaetswein', herkunft_code: 'weinviertel',
      notizen: null, weingarten_id: null,
    }],
    keller_umzuege: [], rebsorten: [], verschneidungen: [], verschneidung_quellen: [], zukauf_posten: [],
    pressung_behaelter: [], fuellung_chargen: [], verkauf_positionen: [], dac_antrag: [], fuellungen: [],
  }
}
const gebinde = (id, name) => ({ id, tenant_id: T, name, aktiv: true, fremd: false, fremd_liter: 0, volumen_liter: 10000 })

function db(t) {
  const d = datenbank(t, { rpc: async name => name === 'lade_behaelter'
    ? { data: [gebinde(G1, 'Immervoll 10'), gebinde(G2, 'Immervoll 11')], error: null }
    : { data: null, error: { message: name } } })
  globalThis.__serverFake = d
  globalThis.__membership = { tenantId: T, role: 'winzer', schreibmodule: ['kellerbuch'] }
  globalThis.__revalidiert = []
  return d
}
function umzugFd(quellen, ziele) {
  const fd = new FormData()
  fd.set('quellen_json', JSON.stringify(quellen))
  fd.set('ziele_json', JSON.stringify(ziele))
  fd.set('datum', '2026-10-20')
  return fd
}
async function fehlerVon(p) {
  try { await p } catch (e) { return e }
  assert.fail('Fehler erwartet')
}

describe('KAN-340: umziehen() – Ziel = Gebinde der Quelle', nurMitHooks, () => {
  test('500 L aus „Immervoll 10“ nach „Immervoll 10“ → Ablehnung, keine zweite Charge, nichts gebucht', async () => {
    const d = db(tabellen())
    const e = await fehlerVon(um.umziehen(umzugFd([{ weinausbau_id: A, menge: 500 }], [{ behaelter_id: G1, menge: 500 }])))
    assert.equal(e.message, UMZUG_SELBES_GEBINDE)
    assert.equal(d.tabellen.weinausbau.length, 1)
    assert.equal(zeile(d, 'weinausbau', A).menge_liter, 1000)
    assert.equal(d.tabellen.keller_umzuege.length, 0)
    assert.equal(d.aufrufe.filter(a => ['insert', 'update', 'delete', 'upsert'].includes(a.art)).length, 0)
  })
  test('auch als eines von zwei Zielen → Ablehnung vor der ersten Buchung', async () => {
    const d = db(tabellen())
    const e = await fehlerVon(um.umziehen(umzugFd([{ weinausbau_id: A, menge: 500 }], [{ behaelter_id: G2, menge: 250 }, { behaelter_id: G1, menge: 250 }])))
    assert.equal(e.message, UMZUG_SELBES_GEBINDE)
    assert.equal(d.aufrufe.filter(a => ['insert', 'update', 'delete', 'upsert'].includes(a.art)).length, 0)
  })
  test('anderes Gebinde → Umzug wie bisher (neue Charge im leeren Ziel)', async () => {
    const d = db(tabellen())
    await um.umziehen(umzugFd([{ weinausbau_id: A, menge: 500 }], [{ behaelter_id: G2, menge: 500 }]))
    assert.equal(zeile(d, 'weinausbau', A).menge_liter, 500)
    const neu = d.tabellen.weinausbau.find(w => w.id !== A)
    assert.equal(neu.behaelter_id, G2)
    assert.equal(d.tabellen.keller_umzuege.length, 2)
  })
})

// ── 4. Verdrahtung ───────────────────────────────────────────────────────────

describe('KAN-340: Verdrahtung', () => {
  test('Umziehen-Seite: Quell-Gebinde nicht als Ziel, Absenden gesperrt', () => {
    const q = quelle('src/app/(dashboard)/kellerbuch/umziehen/UmziehenClient.tsx')
    assert.match(q, /zielGebindeOhneQuellen\(behaelter, quellGebindeIds, value\)/)
    assert.match(q, /if \(selbesGebinde\)\s+\{ setError\(selbesGebinde\); return \}/)
  })
  test('Umziehen-Widget an der Charge: eigenes Gebinde nicht als Ziel', () => {
    const w = quelle('src/components/kellerbuch/UmziehenWidget.tsx')
    assert.match(w, /zielGebinde\.map\(g =>/)
    assert.match(w, /!istQuellGebinde\(zielId, quellGebindeIds\)/)
    assert.match(quelle('src/app/(dashboard)/kellerbuch/weinausbau/[id]/page.tsx'), /quelleBehaelterId=\{weinausbau\.behaelter_id \?\? null\}/)
  })
  test('Umzug bearbeiten: Formular und Server prüfen dasselbe', () => {
    assert.match(quelle('src/components/kellerbuch/UmziehenFormClient.tsx'), /zielGebindeOhneQuellen\(/)
    assert.match(quelle('src/app/(dashboard)/kellerbuch/gebinde-actions.ts'), /selbesGebindeFehler\(quellGebinde\(quellCharge\.values\(\)\), e\.ziele\.map/)
  })
  test('umziehen() und Kellerplan nutzen die gemeinsame Prüfung', () => {
    assert.match(quelle('src/app/(dashboard)/kellerbuch/umziehen/actions.ts'), /selbesGebindeFehler\(quellGebinde\(quellRows\), ziele\.map/)
    assert.match(quelle('src/lib/keller/kellerplanZiehen.ts'), /selbesGebindeFehler\(/)
  })
})
