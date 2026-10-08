// Server Actions E&A-Rechnung (STABILITAET.md, Lücke 4; KAN-240, 08.10.2026) – buchhaltung/actions.ts auf Action-Ebene:
// Kontext und Freigabe E&A vor jedem Zugriff, USt-Satz 0 % bleibt 0 % (vorher still 20 %), Zeitraumsperre, Beleg
// verbuchen ohne Doppelbuchung, Admin-Vorgänge (UVA übermitteln, Monat abschließen, Dauerauftrag deaktivieren).
//
// Aufruf:  npm run -s test:csv   (Node ≥ 22.15 wegen module.registerHooks)

import { test, describe, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { DOPPEL, hooksRegistrieren, laden, nurMitHooks, hooksMoeglich, datenbank } from './buchung-attrappe.mjs'
import { ustSatzAus, UST_SAETZE_AT } from '../../src/lib/ea/ustSatz.ts'

const modul = code => 'data:text/javascript,' + encodeURIComponent(code)
DOPPEL['@/lib/auth/seitenBetrieb'] = modul('export const pruefeSeitenBetrieb = async () => {}')
DOPPEL['@/lib/auth/sperren'] = modul('export const pruefeSchreibzugriff = async () => {}')
DOPPEL['@/lib/auth/modul'] = modul("export const pruefeModul = async f => { if ((globalThis.__modulAus ?? []).includes(f)) { const e = new Error('Modul aus: ' + f); e.name = 'AktionsFehler'; throw e } }")
DOPPEL['next/navigation'] = modul("export const redirect = u => { throw Object.assign(new Error('NEXT_REDIRECT'), { ziel: u }) }")
hooksRegistrieren()

const ea = hooksMoeglich ? await laden('app/(dashboard)/buchhaltung/actions.ts') : null
const T = '00000000-0000-4000-8000-000000000001'
const KAT = '00000000-0000-4000-8000-0000000000c1', BELEG = '00000000-0000-4000-8000-0000000000e1', UVA = '00000000-0000-4000-8000-0000000000e9'

function db(extra = {}, opt = {}) {
  return datenbank({
    ea_kategorien: [{ id: KAT, tenant_id: null, abzugsfaehig_pct: 50 }],
    ea_transaktionen: [], ea_dauerauftraege: [],
    ea_belege: [{ id: BELEG, tenant_id: T, status: 'erkannt', storage_pfad: 'x/y.pdf' }],
    ea_uva: [{ id: UVA, tenant_id: T, jahr: 2026, zeitraum: '09', gesperrt: false }],
    ...extra,
  }, { rpc: name => (name === 'pruefe_ea_zeitraum_offen' ? { data: [{ offen: true }], error: null } : { data: null, error: null }), ...opt })
}
const formular = f => { const fd = new FormData(); for (const [k, w] of Object.entries(f)) fd.set(k, w); return fd }
const buchung = (extra = {}) => formular({ typ: 'einnahme', datum: '2026-10-08', beschreibung: 'Export CH', betrag_netto: '100', ust_satz: '0', ...extra })
const schreib = d => d.aufrufe.filter(a => a.art !== 'select' && a.tabelle !== 'rpc:pruefe_ea_zeitraum_offen')

beforeEach(() => {
  globalThis.__membership = { tenantId: T, role: 'tenant_admin', schreibmodule: [] }
  globalThis.__modulAus = []
})

describe('USt-Satz aus dem Formular (lib/ea/ustSatz.ts)', () => {
  test('0 % bleibt 0 % (vorher || 20), leer = Standard, nur österreichische Sätze', () => {
    assert.equal(ustSatzAus('0'), 0)
    assert.equal(ustSatzAus('13'), 13)
    assert.equal(ustSatzAus(' 20 '), 20)
    assert.equal(ustSatzAus(''), 20)
    assert.equal(ustSatzAus(null, 13), 13)
    assert.equal(ustSatzAus('7'), null)
    assert.equal(ustSatzAus('abc'), null)
    assert.deepEqual([...UST_SAETZE_AT], [0, 10, 13, 20])
    // Regression: so wurde bisher gerechnet
    assert.equal(parseFloat('0') || 20, 20)
  })
})

describe('E&A-Actions: Kontext und Freigabe', nurMitHooks, () => {
  test('ohne Mandant, ohne E&A-Modul, ohne Freigabe E&A: Abbruch vor jedem Zugriff', async () => {
    for (const [setze, muster] of [
      [() => { globalThis.__membership = null }, /Kein Mandant/],
      [() => { globalThis.__modulAus = ['modul_ea'] }, /Modul aus: modul_ea/],
      [() => { globalThis.__membership = { tenantId: T, role: 'leser', schreibmodule: [] } }, /Freigabe E&A nötig/],
      [() => { globalThis.__membership = { tenantId: T, role: 'winzer', schreibmodule: ['warenwirtschaft', 'crm'] } }, /Freigabe E&A nötig/],
    ]) {
      setze()
      const d = db(); globalThis.__serverFake = d
      for (const f of [() => ea.createEaTransaktion(buchung()), () => ea.createEaKategorie(formular({ typ: 'ausgabe', name: 'X' })),
        () => ea.createEaDauerauftrag(formular({ typ: 'ausgabe', beschreibung: 'Miete', betrag_netto: '100' })), () => ea.berechneUndSpeichereUva(2026, '09'),
        () => ea.verbucheBeleg(BELEG, buchung()), () => ea.stornoEaTransaktion('x', 'Doppelt gebucht bei Import')]) {
        await assert.rejects(f(), muster)
      }
      assert.deepEqual(d.aufrufe, [], 'kein Datenbankzugriff')
      globalThis.__membership = { tenantId: T, role: 'tenant_admin', schreibmodule: [] }; globalThis.__modulAus = []
    }
  })

  test('Mitarbeiter mit Freigabe E&A darf buchen', async () => {
    globalThis.__membership = { tenantId: T, role: 'winzer', schreibmodule: ['ea'] }
    const d = db(); globalThis.__serverFake = d
    assert.deepEqual(await ea.createEaTransaktion(buchung()), { ok: true })
    assert.equal(d.tabellen.ea_transaktionen.length, 1)
  })

  test('Admin-Vorgänge: UVA übermitteln, Monat abschließen, Dauerauftrag deaktivieren nur Betriebsleitung', async () => {
    globalThis.__membership = { tenantId: T, role: 'winzer', schreibmodule: ['ea'] }
    const d = db(); globalThis.__serverFake = d
    assert.match((await ea.markiereUvaAlsUebermittelt(UVA)).error, /nur Admins/)
    assert.match((await ea.schliesseEaMonat(2026, 9)).error, /nur Admins/)
    assert.match((await ea.deaktiviereEaDauerauftrag('x')).error, /nur Admins/)
    assert.deepEqual(schreib(d), [])
  })
})

describe('Buchen (createEaTransaktion, verbucheBeleg)', nurMitHooks, () => {
  test('0 % USt bleibt 0 % (KAN-240), Abzugsfähigkeit aus der Kategorie, Standard 20 % ohne Angabe', async () => {
    const d = db(); globalThis.__serverFake = d
    await ea.createEaTransaktion(buchung({ kategorie_id: KAT }))
    await ea.createEaTransaktion(buchung({ ust_satz: '' }))
    assert.deepEqual(d.tabellen.ea_transaktionen.map(t => [t.ust_satz, t.abzugsfaehig_pct]), [[0, 50], [20, 100]])
  })

  test('ungültiger Satz, fehlende Pflichtfelder, geschlossener Zeitraum: Meldung ohne Insert', async () => {
    let d = db(); globalThis.__serverFake = d
    assert.deepEqual(await ea.createEaTransaktion(buchung({ ust_satz: '7' })), { error: 'Bitte einen gültigen USt-Satz wählen (0, 10, 13 oder 20 %).' })
    assert.deepEqual(await ea.createEaTransaktion(buchung({ beschreibung: '' })), { error: 'Pflichtfelder fehlen' })
    assert.deepEqual(schreib(d), [])
    d = db({}, { rpc: name => (name === 'pruefe_ea_zeitraum_offen' ? { data: [{ offen: false, grund: 'September 2026 ist abgeschlossen.' }], error: null } : { data: null, error: null }) })
    globalThis.__serverFake = d
    assert.deepEqual(await ea.createEaTransaktion(buchung()), { error: 'September 2026 ist abgeschlossen.' })
    assert.equal(d.tabellen.ea_transaktionen.length, 0)
  })

  test('Kategorie und Dauerauftrag: 0 % bleibt 0 %', async () => {
    const d = db(); globalThis.__serverFake = d
    await ea.createEaKategorie(formular({ typ: 'einnahme', name: 'Export', ust_satz_std: '0' }))
    await ea.createEaDauerauftrag(formular({ typ: 'ausgabe', beschreibung: 'Miete', betrag_netto: '100', ust_satz: '0', intervall: 'monatlich' }))
    assert.equal(d.tabellen.ea_kategorien.at(-1).ust_satz_std, 0)
    assert.equal(d.tabellen.ea_dauerauftraege[0].ust_satz, 0)
  })

  test('Beleg verbuchen: Buchung + Beleg „verbucht“; zweites Verbuchen abgelehnt', async () => {
    const d = db(); globalThis.__serverFake = d
    assert.deepEqual(await ea.verbucheBeleg(BELEG, buchung({ ust_satz: '20', typ: 'ausgabe' })), { ok: true })
    const b = d.tabellen.ea_belege[0]
    assert.equal(b.status, 'verbucht')
    assert.equal(b.ea_transaktion_id, d.tabellen.ea_transaktionen[0].id)
    assert.deepEqual(await ea.verbucheBeleg(BELEG, buchung()), { error: 'Dieser Beleg wurde bereits verbucht.' })
    assert.equal(d.tabellen.ea_transaktionen.length, 1)
  })

  test('KAN-240: Markieren als verbucht scheitert → Meldung „bitte nicht erneut verbuchen“ statt still „erkannt“', async () => {
    const d = db({}, {
      rpc: name => (name === 'pruefe_ea_zeitraum_offen' ? { data: [{ offen: true }], error: null } : { data: null, error: null }),
      vorher: e => (e.tabelle === 'ea_belege' && e.art === 'update' ? { error: { message: 'permission denied' } } : null),
    })
    // ea_transaktionen-Insert liefert die neue ID nur mit gesetzter id – die Attrappe vergibt keine
    d.tabellen.ea_transaktionen = []
    globalThis.__serverFake = d
    const r = await ea.verbucheBeleg(BELEG, buchung({ typ: 'ausgabe', ust_satz: '20' }))
    assert.match(r.error, /Die Buchung ist angelegt \(bitte nicht erneut verbuchen\), der Beleg konnte aber nicht als verbucht markiert werden/)
    assert.equal(d.tabellen.ea_transaktionen.length, 1)
  })
})

describe('Storno (stornoEaTransaktion)', nurMitHooks, () => {
  test('Grund ≥ 10 Zeichen vor jedem Zugriff; abgeleitete Buchungen auf ihren eigenen Weg verwiesen', async () => {
    const d = db({ ea_transaktionen: [
      { id: 'v', tenant_id: T, import_quelle: 'verkauf', verkaufsposten_id: 'p' },
      { id: 'a', tenant_id: T, anlage_id: 'x' },
      { id: 'b', tenant_id: T, import_quelle: 'betriebsmittel' },
      { id: 'm', tenant_id: T, import_quelle: null },
    ] })
    globalThis.__serverFake = d
    assert.match((await ea.stornoEaTransaktion('m', 'kurz')).error, /mindestens 10 Zeichen|Grund/)
    assert.match((await ea.stornoEaTransaktion('v', 'Falsch zugeordnet bei Import')).error, /Zahlung im Verkauf stornieren/)
    assert.match((await ea.stornoEaTransaktion('a', 'Falsch zugeordnet bei Import')).error, /Anlagen & AfA/)
    assert.match((await ea.stornoEaTransaktion('b', 'Falsch zugeordnet bei Import')).error, /Betriebsmittel/)
    assert.deepEqual(schreib(d), [])
    assert.deepEqual(await ea.stornoEaTransaktion('m', '  Falsch zugeordnet bei Import '), { ok: true })
    const rpc = d.aufrufe.find(a => a.tabelle === 'rpc:s112_ea_stornieren')
    assert.deepEqual(rpc.werte, { p_tenant_id: T, p_id: 'm', p_grund: 'Falsch zugeordnet bei Import', p_datum: null })
  })
})
