// STABILITAET.md Punkt „Bibliotheken unter 70 % Abdeckung“ (09.10.2026):
//   Lader von lib/wein/leseBilanz.ts (kg-Bilanz je Lese – die Server-Sperre für Traubenverkäufe, KAN-129) und
//   lib/verkauf/traubenverkaufStorno.ts (Stornieren statt Löschen, KAN-148 C1b).
// Der Verkaufsstorno (lib/verkauf/bestand) ist hier eine Attrappe: Er hat eigene Tests (verkauf-bestand.test.mjs);
// geprüft wird nur, wann er mit welchem Grund aufgerufen wird.
//
// Aufruf:  npm run -s test:csv   (Node ≥ 22.15 wegen module.registerHooks)

import { test, describe, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { DOPPEL, hooksRegistrieren, laden, nurMitHooks, hooksMoeglich, datenbank, zeile } from './buchung-attrappe.mjs'

DOPPEL['@/lib/verkauf/bestand'] = 'data:text/javascript,' + encodeURIComponent(`
  export const verkaufspostenStornieren = async (sb, tenantId, postenId, grund) => {
    (globalThis.__vpStorno ??= []).push([tenantId, postenId, grund])
    for (const r of sb.tabellen.traubenverkauf ?? []) if (r.verkaufsposten_id === postenId) { r.storniert_am = '2026-10-09T10:00:00Z'; r.storno_grund = grund }
  }`)
hooksRegistrieren()
const lb = hooksMoeglich ? await laden('lib/wein/leseBilanz.ts') : null
const st = hooksMoeglich ? await laden('lib/verkauf/traubenverkaufStorno.ts') : null

const T = 't1'
const JG = 'j1'
const WAEHLEN = 'Bitte die Lese wählen.'

function leseDaten() {
  return {
    weinjahrgaenge: [{ id: JG, tenant_id: T, jahrgang: 2026 }, { id: 'jf', tenant_id: 'anderer', jahrgang: 2026 }],
    lesen: [
      { id: 'L2', tenant_id: T, jahrgang_id: JG, lfd_nr: 2, beginn: '2026-10-15', art: 'eiswein' },
      { id: 'L1', tenant_id: T, jahrgang_id: JG, lfd_nr: 1, beginn: '2026-09-01', art: null },
    ],
    ernte_parzellen: [
      { id: 'e1', jahrgang_id: JG, lese_id: 'L1', weingarten_id: 'w1', grundstueck_id: 'g1', menge_kg: '1000', storniert_am: null, weingarten: { name: 'Kirchberg' }, grundstueck: { gst_nr: '12/3' } },
      { id: 'e2', jahrgang_id: JG, lese_id: 'L1', weingarten_id: 'w1', grundstueck_id: null, menge_kg: 999, storniert_am: '2026-09-30', weingarten: { name: 'Kirchberg' }, grundstueck: null },
      { id: 'e3', jahrgang_id: JG, lese_id: 'L1', weingarten_id: 'w2', grundstueck_id: null, menge_kg: null, storniert_am: null, weingarten: { name: 'Leiten' }, grundstueck: null },
    ],
    pressungen: [
      { id: 'p1', tenant_id: T, jahrgang_id: JG, lese_id: 'L1', storniert_am: null },
      { id: 'p2', tenant_id: T, jahrgang_id: JG, lese_id: 'L1', storniert_am: '2026-09-29' },
      { id: 'pf', tenant_id: 'anderer', jahrgang_id: JG, lese_id: 'L1', storniert_am: null },
    ],
    pressung_weingaerten: [
      { id: 'pw1', pressung_id: 'p1', weingarten_id: 'w1', grundstueck_id: 'g1', trauben_kg: '700', storniert_am: null },
      { id: 'pw2', pressung_id: 'p1', weingarten_id: null, grundstueck_id: null, trauben_kg: 5000, storniert_am: null },     // Zukauf-Trauben
      { id: 'pw3', pressung_id: 'p1', weingarten_id: 'w1', grundstueck_id: 'g1', trauben_kg: 900, storniert_am: '2026-09-28' },
      { id: 'pw4', pressung_id: 'p2', weingarten_id: 'w1', grundstueck_id: 'g1', trauben_kg: 900, storniert_am: null },     // stornierte Pressung
      { id: 'pw5', pressung_id: 'pf', weingarten_id: 'w1', grundstueck_id: 'g1', trauben_kg: 900, storniert_am: null },     // fremder Betrieb
    ],
    traubenverkauf: [
      { id: 'tv1', tenant_id: T, jahrgang_id: JG, lese_id: 'L1', weingarten_id: 'w1', grundstueck_id: 'g1', menge_kg: 200, storniert_am: null },
      { id: 'tv2', tenant_id: T, jahrgang_id: JG, lese_id: 'L1', weingarten_id: null, grundstueck_id: null, menge_kg: 800, storniert_am: null },   // Zukauf
    ],
  }
}

const anfrage = (x = {}) => ({ jahrgangId: JG, weingartenId: 'w1', grundstueckId: 'g1', zukaufPostenId: null, datum: '2026-09-20', mengeKg: 50, leseIdFormular: null, alt: null, leseWaehlenText: WAEHLEN, ...x })

describe('kg-Bilanz je Lese: Lader (lib/wein/leseBilanz.ts)', nurMitHooks, () => {
  test('ladeLeseVerbrauch: nur nicht stornierte Zeilen des Betriebs, Zukauf ohne Ried bleibt draußen, Namen je Ort', async () => {
    const v = await lb.ladeLeseVerbrauch(datenbank(leseDaten()), T, JG, 'L1')
    assert.deepEqual(v.gelesen, [{ weingarten_id: 'w1', grundstueck_id: 'g1', kg: 1000 }, { weingarten_id: 'w2', grundstueck_id: null, kg: null }])
    assert.deepEqual(v.pressungszeilen, [{ pressung_id: 'p1', weingarten_id: 'w1', grundstueck_id: 'g1', kg: 700 }])
    assert.deepEqual(v.verkaeufe, [{ id: 'tv1', weingarten_id: 'w1', grundstueck_id: 'g1', kg: 200 }])
    assert.deepEqual([v.namen.get('g1'), v.namen.get('w2')], [{ ried: 'Kirchberg', gstNr: '12/3' }, { ried: 'Leiten', gstNr: null }])
  })

  test('ladeLeseVerbrauch: ohne Pressung keine Abfrage auf pressung_weingaerten; Fehler nennen die Tabelle', async () => {
    const d = leseDaten()
    d.pressungen = []
    const db = datenbank(d)
    assert.deepEqual((await lb.ladeLeseVerbrauch(db, T, JG, 'L1')).pressungszeilen, [])
    assert.ok(!db.aufrufe.some(a => a.tabelle === 'pressung_weingaerten'))
    for (const tab of ['ernte_parzellen', 'pressungen', 'traubenverkauf', 'pressung_weingaerten']) {
      const kaputt = datenbank(leseDaten(), { vorher: e => (e.tabelle === tab ? { error: { message: 'weg' } } : null) })
      await assert.rejects(lb.ladeLeseVerbrauch(kaputt, T, JG, 'L1'), new RegExp(`Lesemenge konnte nicht geprüft werden \\(${tab}\\): weg`))
    }
  })

  test('ladeLesenDesJahrgangs: nach Nummer, nur der Betrieb; Fehler wirft', async () => {
    const d = leseDaten()
    d.lesen.push({ id: 'Lx', tenant_id: 'anderer', jahrgang_id: JG, lfd_nr: 3, beginn: null, art: null })
    assert.deepEqual(await lb.ladeLesenDesJahrgangs(datenbank(d), T, JG), [
      { id: 'L1', lfd_nr: 1, beginn: '2026-09-01', art: null }, { id: 'L2', lfd_nr: 2, beginn: '2026-10-15', art: 'eiswein' }])
    await assert.rejects(lb.ladeLesenDesJahrgangs(datenbank(d, { vorher: () => ({ error: { message: 'x' } }) }), T, JG), /Lesen konnten nicht geladen werden: x/)
  })

  test('traubenverkaufLese: Lese nach Datum, Sperre über der Lesemenge (gelesen 1000, verpresst 700, verkauft 200)', async () => {
    const db = datenbank(leseDaten())
    assert.deepEqual(await lb.traubenverkaufLese(db, T, anfrage({ mengeKg: 100 })), { leseId: 'L1', fehler: null })
    const r = await lb.traubenverkaufLese(db, T, anfrage({ mengeKg: 150 }))
    assert.equal(r.leseId, 'L1')
    assert.match(r.fehler, /^Von GST 12\/3 \(Kirchberg\) sind in der Lese 2026\/1 nur 1.000 kg gelesen – verpresst bzw\. als Trauben verkauft wären danach 1.050 kg/)
  })

  test('traubenverkaufLese: Bearbeiten zählt die eigene bisherige Menge nicht doppelt', async () => {
    const alt = { id: 'tv1', lese_id: 'L1', jahrgang_id: JG, weingarten_id: 'w1', grundstueck_id: 'g1', menge_kg: '200' }
    assert.deepEqual(await lb.traubenverkaufLese(datenbank(leseDaten()), T, anfrage({ alt, mengeKg: 300, datum: '2026-11-01' })), { leseId: 'L1', fehler: null },
      'bestehender Verkauf behält seine Lese (nicht nach Datum L2)')
    assert.match((await lb.traubenverkaufLese(datenbank(leseDaten()), T, anfrage({ alt, mengeKg: 301 }))).fehler, /1.001 kg/)
  })

  test('traubenverkaufLese: Formular-Lese, fremde Lese, keine passende Lese, Zukauf, ohne Jahrgang, ohne Ried, fremder Jahrgang', async () => {
    const db = () => datenbank(leseDaten())
    assert.deepEqual(await lb.traubenverkaufLese(db(), T, anfrage({ leseIdFormular: 'L2', mengeKg: 99999 })), { leseId: 'L2', fehler: null }, 'L2 ohne Lesemenge sperrt nicht')
    assert.match((await lb.traubenverkaufLese(db(), T, anfrage({ leseIdFormular: 'Lfremd' }))).fehler, /gewählte Lese gehört nicht zu diesem Jahrgang/)
    assert.deepEqual(await lb.traubenverkaufLese(db(), T, anfrage({ datum: '2026-08-01' })), { leseId: null, fehler: WAEHLEN })
    const zukauf = db()
    assert.deepEqual(await lb.traubenverkaufLese(zukauf, T, anfrage({ zukaufPostenId: 'zp1' })), { leseId: null, fehler: null })
    assert.equal(zukauf.aufrufe.length, 0)
    assert.deepEqual(await lb.traubenverkaufLese(db(), T, anfrage({ jahrgangId: null })), { leseId: null, fehler: null })
    assert.deepEqual(await lb.traubenverkaufLese(db(), T, anfrage({ weingartenId: null, mengeKg: 99999 })), { leseId: 'L1', fehler: null })
    assert.match((await lb.traubenverkaufLese(db(), T, anfrage({ jahrgangId: 'jf' }))).fehler, /Jahrgang gehört nicht zu diesem Betrieb/)
    await assert.rejects(lb.traubenverkaufLese(datenbank(leseDaten(), { vorher: e => (e.tabelle === 'weinjahrgaenge' ? { error: { message: 'x' } } : null) }), T, anfrage()), /Jahrgang konnte nicht geladen werden/)
  })

  test('leseDeckungFehler: ohne Zeile mit Ried keine Abfrage; Pressung ohne ihre eigenen bisherigen Zeilen', async () => {
    const lese = { id: 'L1', lfd_nr: 1, beginn: null }
    const leer = datenbank(leseDaten())
    assert.equal(await lb.leseDeckungFehler(leer, T, JG, lese, 2026, {}, [], [{ weingarten_id: null, grundstueck_id: null, kg: 9999 }]), null)
    assert.equal(leer.aufrufe.length, 0)
    const neu = [{ weingarten_id: 'w1', grundstueck_id: 'g1', kg: 800 }]
    assert.equal(await lb.leseDeckungFehler(datenbank(leseDaten()), T, JG, lese, 2026, { pressungId: 'p1' }, [], neu), null, '800 statt 700 + 200 Verkauf = 1000')
    assert.match(await lb.leseDeckungFehler(datenbank(leseDaten()), T, JG, lese, 2026, {}, [], neu), /1.700 kg/)
  })
})

describe('Traubenverkauf stornieren (lib/verkauf/traubenverkaufStorno.ts)', nurMitHooks, () => {
  const ADMIN = { tenantId: T, role: 'tenant_admin', schreibmodule: [] }
  const GRUND = 'Falsche Ried erfasst'
  beforeEach(() => { globalThis.__vpStorno = [] })

  const daten = (x = {}) => ({
    traubenverkauf: [
      { id: 'tv', tenant_id: T, verkaufsposten_id: null, storniert_am: null, storno_grund: null, ...x },
      { id: 'tvf', tenant_id: 'anderer', verkaufsposten_id: null, storniert_am: null },
    ],
    verkaufsposten: [{ id: 'vp', tenant_id: T, rechnungsnummer: 'R-2026-7', storniert: false }],
    verkauf_positionen: [],
  })

  test('ohne Rechnung: storniert mit getrimmtem Grund, Zeile bleibt', async () => {
    const db = datenbank(daten())
    assert.deepEqual(await st.traubenverkaufStornieren(db, ADMIN, 'tv', `  ${GRUND}  `), { postenId: null })
    const z = zeile(db, 'traubenverkauf', 'tv')
    assert.ok(z.storniert_am)
    assert.equal(z.storno_grund, GRUND)
    assert.deepEqual(globalThis.__vpStorno, [])
  })

  test('Grund, Berechtigung, fremder Betrieb, bereits storniert', async () => {
    await assert.rejects(st.traubenverkaufStornieren(datenbank(daten()), ADMIN, 'tv', 'kurz'), /mindestens/)
    await assert.rejects(st.traubenverkaufStornieren(datenbank(daten()), { tenantId: T, role: 'leser', schreibmodule: [] }, 'tv', GRUND), /Rieden oder Warenwirtschaft/)
    await assert.rejects(st.traubenverkaufStornieren(datenbank(daten()), { tenantId: T, role: 'winzer', schreibmodule: ['crm'] }, 'tv', GRUND), /Rieden oder Warenwirtschaft/)
    for (const m of [['rieden'], ['warenwirtschaft']]) {
      await st.traubenverkaufStornieren(datenbank(daten()), { tenantId: T, role: 'winzer', schreibmodule: m }, 'tv', GRUND)
    }
    await assert.rejects(st.traubenverkaufStornieren(datenbank(daten()), ADMIN, 'tvf', GRUND), /nicht gefunden/)
    await assert.rejects(st.traubenverkaufStornieren(datenbank(daten({ storniert_am: '2026-10-01' })), ADMIN, 'tv', GRUND), /bereits storniert/)
  })

  test('Rechnung nur mit diesem Verkauf (Position „sonstiges“ ohne bzw. „trauben“ mit Verweis): Rechnungsstorno mit dem Grund', async () => {
    for (const pos of [{ typ: 'sonstiges', traubenverkauf_id: null }, { typ: 'trauben', traubenverkauf_id: 'tv' }]) {
      globalThis.__vpStorno = []
      const d = daten({ verkaufsposten_id: 'vp' })
      d.verkauf_positionen = [{ id: 'p1', tenant_id: T, verkaufsposten_id: 'vp', ...pos }]
      const db = datenbank(d)
      assert.deepEqual(await st.traubenverkaufStornieren(db, ADMIN, 'tv', GRUND), { postenId: 'vp' })
      assert.deepEqual(globalThis.__vpStorno, [[T, 'vp', GRUND]])
      assert.equal(zeile(db, 'traubenverkauf', 'tv').storno_grund, GRUND)
    }
  })

  test('Mischrechnung: Abbruch mit Rechnungsnummer, nichts storniert; bereits stornierte Rechnung: nur der Verkauf', async () => {
    const d = daten({ verkaufsposten_id: 'vp' })
    d.verkauf_positionen = [
      { id: 'p1', tenant_id: T, verkaufsposten_id: 'vp', typ: 'trauben', traubenverkauf_id: 'tv' },
      { id: 'p2', tenant_id: T, verkaufsposten_id: 'vp', typ: 'flasche', traubenverkauf_id: null },
    ]
    const db = datenbank(d)
    await assert.rejects(st.traubenverkaufStornieren(db, ADMIN, 'tv', GRUND), /Rechnung R-2026-7 mit weiteren Positionen/)
    assert.equal(zeile(db, 'traubenverkauf', 'tv').storniert_am, null)
    assert.deepEqual(globalThis.__vpStorno, [])

    const fremdeTraube = daten({ verkaufsposten_id: 'vp' })
    fremdeTraube.verkauf_positionen = [{ id: 'p1', tenant_id: T, verkaufsposten_id: 'vp', typ: 'trauben', traubenverkauf_id: 'anderer-tv' }]
    await assert.rejects(st.traubenverkaufStornieren(datenbank(fremdeTraube), ADMIN, 'tv', GRUND), /weiteren Positionen/)

    const zweiSonstige = daten({ verkaufsposten_id: 'vp' })
    zweiSonstige.verkauf_positionen = ['p1', 'p2'].map(id => ({ id, tenant_id: T, verkaufsposten_id: 'vp', typ: 'sonstiges', traubenverkauf_id: null }))
    await assert.rejects(st.traubenverkaufStornieren(datenbank(zweiSonstige), ADMIN, 'tv', GRUND), /weiteren Positionen/, 'zwei Positionen sind immer eine Mischrechnung')

    const storniert = daten({ verkaufsposten_id: 'vp' })
    storniert.verkaufsposten[0].storniert = true
    storniert.verkauf_positionen = d.verkauf_positionen
    const db2 = datenbank(storniert)
    assert.deepEqual(await st.traubenverkaufStornieren(db2, ADMIN, 'tv', GRUND), { postenId: 'vp' })
    assert.deepEqual(globalThis.__vpStorno, [])
    assert.ok(zeile(db2, 'traubenverkauf', 'tv').storniert_am)
  })

  test('RLS ändert still 0 Zeilen → verständlicher Fehler; Datenbankfehler je Schritt', async () => {
    const rls = datenbank(daten(), { rls: e => e.art !== 'update' })
    await assert.rejects(st.traubenverkaufStornieren(rls, ADMIN, 'tv', GRUND), /keine Schreibberechtigung/)
    const mitRechnung = () => { const d = daten({ verkaufsposten_id: 'vp' }); return d }
    for (const [tab, art, nr, meldung, d] of [
      ['traubenverkauf', 'select', 1, /Traubenverkauf konnte nicht geladen werden/, daten()],
      ['verkaufsposten', 'select', 1, /Rechnung zum Traubenverkauf konnte nicht geladen werden/, mitRechnung()],
      ['verkauf_positionen', 'select', 1, /Rechnungspositionen konnten nicht geladen werden/, mitRechnung()],
      ['traubenverkauf', 'update', 1, /Traubenverkauf konnte nicht storniert werden/, daten()],
      ['traubenverkauf', 'select', 2, /Traubenverkauf konnte nicht geprüft werden/, daten()],
    ]) {
      let n = 0
      const db = datenbank(d, { vorher: e => (e.tabelle === tab && e.art === art && ++n === nr ? { error: { message: 'kaputt' } } : null) })
      await assert.rejects(st.traubenverkaufStornieren(db, ADMIN, 'tv', GRUND), meldung)
    }
  })
})
