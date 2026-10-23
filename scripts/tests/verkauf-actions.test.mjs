// Server Actions Verkauf (STABILITAET.md, Lücke 4; 08.10.2026) – weinhandel/verkauf/actions.ts auf Action-Ebene:
// Kontext (Mandant, Betrieb der Seite, Nur-Lesen-Modus) vor jedem Zugriff, Ablehnungen von createVerkauf OHNE
// Schreibzugriff (kein Bestand, keine Rechnungsnummer – KAN-35), Storno-, Zahlungs- und Erstattungsprüfungen.
// Charakterisierungstest: hält das heutige Verhalten fest, Auffälligkeiten als „Befund“ (nicht korrigiert).
//
// Aufruf:  npm run -s test:csv   (Node ≥ 22.15 wegen module.registerHooks)

import { test, describe, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { DOPPEL, hooksRegistrieren, laden, nurMitHooks, hooksMoeglich, datenbank } from './buchung-attrappe.mjs'

const modul = code => 'data:text/javascript,' + encodeURIComponent(code)
// zusätzlich zu den gemeinsamen Ersatzmodulen: Betrieb der Seite, Abo-Sperre und E&A-Abgleich steuerbar
DOPPEL['@/lib/auth/seitenBetrieb'] = modul(`export const pruefeSeitenBetrieb = async () => { (globalThis.__reihenfolge ??= []).push('seitenBetrieb'); if (globalThis.__seiteFremd) { const e = new Error('Der Betrieb wurde in einem anderen Tab gewechselt – bitte Seite neu laden.'); e.name = 'AktionsFehler'; throw e } }`)
DOPPEL['@/lib/auth/sperren'] = modul(`export const pruefeSchreibzugriff = async () => { (globalThis.__reihenfolge ??= []).push('sperre'); if (globalThis.__nurLesen) { const e = new Error('Das Abo dieses Betriebs ist gesperrt – Änderungen sind im Nur-Lesen-Modus nicht möglich.'); e.name = 'AktionsFehler'; throw e } }`)
DOPPEL['@/app/(dashboard)/buchhaltung/actions'] = modul('export const syncEaEinnahmeFuerVerkauf = async id => { (globalThis.__eaSync ??= []).push(id); return globalThis.__ea ?? { ok: true } }')
hooksRegistrieren()

const v = hooksMoeglich ? await laden('app/(dashboard)/weinhandel/verkauf/actions.ts') : null

const T = '00000000-0000-4000-8000-000000000001'
const F1 = '00000000-0000-4000-8000-0000000000f1', W1 = '00000000-0000-4000-8000-0000000000c1', K1 = '00000000-0000-4000-8000-0000000000a1'
const P1 = '00000000-0000-4000-8000-0000000000b1', Z1 = '00000000-0000-4000-8000-0000000000d1'

function db(extra = {}) {
  return datenbank({
    fuellungen: [{ id: F1, tenant_id: T, name: 'GV Klassik 2025', bestand_flaschen: 12, qualitaet: 'qualitaetswein', pruefnummer: 'N 1/26', dac: { status: 'genehmigt' } }],
    weinausbau: [{ id: W1, tenant_id: T, name: 'GV 2025', menge_liter: 500 }],
    kontakte: [{ id: K1, tenant_id: T, vorname: 'Eva', nachname: 'Huber', betrieb_nr: null }],
    verkaufsposten: [{ id: P1, tenant_id: T, rechnungsnummer: 'RE-1', storniert: false }],
    zahlungen: [{ id: Z1, tenant_id: T, verkaufsposten_id: P1, betrag: 10, storniert_am: null }],
    ...extra,
  }, { rpc: name => (name === 'lade_crmgemeinschaft' ? { data: [], error: null } : name === 'pruefe_ea_zeitraum_offen' ? ZEITRAUM_OFFEN : { data: null, error: null }) })
}
const formular = (felder) => {
  const fd = new FormData()
  for (const [k, w] of Object.entries(felder)) fd.set(k, typeof w === 'string' ? w : JSON.stringify(w))
  return fd
}
const flasche = (menge, extra = {}) => ({ typ: 'flasche', name: 'GV Klassik 2025', fuellung_id: F1, menge, preis_brutto: 12, ...extra })
/** Schreibzugriffe der Attrappe (insert/update/upsert/delete und RPCs außer reinen Lese-RPCs) */
// (KAN-355: pruefe_ea_zeitraum_offen ist eine reine Lese-RPC – Vorabprüfung des Rechnungsdatums)
const LESE_RPCS = ['rpc:lade_crmgemeinschaft', 'rpc:pruefe_ea_zeitraum_offen']
const schreibzugriffe = d => d.aufrufe.filter(a => a.art !== 'select' && !LESE_RPCS.includes(a.tabelle))
/** KAN-355: Zeitraum des Rechnungsdatums offen */
const ZEITRAUM_OFFEN = { data: [{ offen: true, grund: null }], error: null }

beforeEach(() => {
  globalThis.__membership = { tenantId: T, role: 'tenant_admin', schreibmodule: [] }
  globalThis.__seiteFremd = false
  globalThis.__nurLesen = false
  globalThis.__reihenfolge = []
  globalThis.__eaSync = []
  globalThis.__ea = { ok: true }
})

describe('Verkauf: Kontext vor jedem Zugriff', nurMitHooks, () => {
  test('ohne Mandant, aus einem fremden Tab, im Nur-Lesen-Modus: Abbruch vor dem ersten Datenbankzugriff', async () => {
    for (const [setze, muster] of [
      [() => { globalThis.__membership = null }, /Kein aktiver Mandant/],
      [() => { globalThis.__seiteFremd = true }, /anderen Tab gewechselt/],
      [() => { globalThis.__nurLesen = true }, /Nur-Lesen-Modus/],
    ]) {
      setze()
      const d = db(); globalThis.__serverFake = d
      await assert.rejects(v.createVerkauf(formular({ datum: '2026-10-08', positionen_json: [flasche(1)] })), muster)
      await assert.rejects(v.createZahlung(P1, formular({ betrag: '10' })), muster)
      await assert.rejects(v.stornoVerkauf(P1, 'Falsch erfasst, Kunde storniert'), muster)
      assert.deepEqual(d.aufrufe, [], 'kein Datenbankzugriff')
      globalThis.__membership = { tenantId: T, role: 'tenant_admin', schreibmodule: [] }; globalThis.__seiteFremd = false; globalThis.__nurLesen = false
    }
  })

  test('Reihenfolge: Betrieb der Seite vor der Abo-Sperre (KAN-30 vor KAN-5)', async () => {
    globalThis.__serverFake = db()
    await v.createZahlung(P1, formular({ betrag: '5' }))
    assert.deepEqual(globalThis.__reihenfolge, ['seitenBetrieb', 'sperre'])
  })
})

describe('Verkauf anlegen: Ablehnungen ohne Schreibzugriff (KAN-35)', nurMitHooks, () => {
  const faelle = [
    ['Datum fehlt (KAN-208)', { datum: '', positionen_json: [flasche(1)] }, /Bitte das Verkaufsdatum angeben/],
    ['Positionen kein JSON', { datum: '2026-10-08', positionen_json: '{kaputt' }, /Ungültige Positions-Daten/],
    ['keine Position', { datum: '2026-10-08', positionen_json: [] }, /Mindestens eine Position/],
    ['unbekannter Typ', { datum: '2026-10-08', positionen_json: [{ typ: 'gutschein', name: 'X', menge: 1 }] }, /unbekannter Positionstyp/],
    ['ohne Bezeichnung', { datum: '2026-10-08', positionen_json: [flasche(1, { name: ' ' })] }, /Bezeichnung angeben/],
    ['Menge 0 (Rücknahme)', { datum: '2026-10-08', positionen_json: [flasche(0)] }, /größer als 0 sein\. Rücknahmen bitte als Storno/],
    ['Flaschen nicht ganzzahlig', { datum: '2026-10-08', positionen_json: [flasche(1.5)] }, /ganzen Stück/],
    ['Flaschen über Bestand (zwei Positionen derselben Füllung zusammen)', { datum: '2026-10-08', positionen_json: [flasche(8), flasche(5)] }, /nur noch 12 Flaschen verfügbar, 13 angefragt/],
    ['Tank ohne Kunde (KAN-208)', { datum: '2026-10-08', positionen_json: [{ typ: 'tank', name: 'Fass', weinausbau_id: W1, menge: 10 }] }, /Kunde/],
    ['Tank, Kunde ohne Betriebsnummer (KAN-208)', { datum: '2026-10-08', kontakt_id: K1, positionen_json: [{ typ: 'tank', name: 'Fass', weinausbau_id: W1, menge: 10 }] }, /Betriebsnummer/],
  ]
  for (const [name, felder, muster] of faelle) {
    test(name, async () => {
      const d = db(); globalThis.__serverFake = d
      await assert.rejects(v.createVerkauf(formular(felder)), muster)
      assert.deepEqual(schreibzugriffe(d), [], 'nichts geschrieben (kein Bestand, keine Rechnungsnummer)')
    })
  }

  test('Tank ohne Charge (Kunde mit Betriebsnummer)', async () => {
    const d = db({ kontakte: [{ id: K1, tenant_id: T, vorname: 'Eva', nachname: 'Huber', betrieb_nr: '1234567' }] }); globalThis.__serverFake = d
    await assert.rejects(v.createVerkauf(formular({ datum: '2026-10-08', kontakt_id: K1, positionen_json: [{ typ: 'tank', name: 'Fass', menge: 10 }] })), /Kellerbuch-Charge auswählen/)
    assert.deepEqual(schreibzugriffe(d), [])
  })

  test('Tank über Bestand der Charge', async () => {
    const d = db({ kontakte: [{ id: K1, tenant_id: T, vorname: 'Eva', nachname: 'Huber', betrieb_nr: '1234567' }] }); globalThis.__serverFake = d
    await assert.rejects(v.createVerkauf(formular({ datum: '2026-10-08', kontakt_id: K1, positionen_json: [{ typ: 'tank', name: 'Fass', weinausbau_id: W1, menge: 600 }] })),
      /„GV 2025“: Menge \(600 L\) überschreitet den verfügbaren Bestand \(500 L\)/)
    assert.deepEqual(schreibzugriffe(d), [])
  })

  test('Qualitätswein ohne zugeteilte Prüfnummer (KAN-208)', async () => {
    const d = db({ fuellungen: [{ id: F1, tenant_id: T, name: 'GV Klassik 2025', bestand_flaschen: 12, qualitaet: 'qualitaetswein', pruefnummer: null, dac: null }] }); globalThis.__serverFake = d
    await assert.rejects(v.createVerkauf(formular({ datum: '2026-10-08', positionen_json: [flasche(1)] })), /keine zugeteilte staatliche Prüfnummer/)
    assert.deepEqual(schreibzugriffe(d), [])
  })

  test('Rechte: Leser und Mitarbeiter ohne Warenwirtschaft dürfen nicht verkaufen; Flaschen brauchen Kellerbuch oder Warenwirtschaft', async () => {
    for (const m of [{ role: 'leser', schreibmodule: [] }, { role: 'winzer', schreibmodule: ['kellerbuch', 'crm'] }]) {
      globalThis.__membership = { tenantId: T, ...m }
      const d = db(); globalThis.__serverFake = d
      await assert.rejects(v.createVerkauf(formular({ datum: '2026-10-08', positionen_json: [flasche(1)] })), /Freigabe Warenwirtschaft/)
      assert.deepEqual(schreibzugriffe(d), [])
    }
    // Tank: Warenwirtschaft genügt nicht, es braucht zusätzlich Kellerbuch oder Rieden
    globalThis.__membership = { tenantId: T, role: 'winzer', schreibmodule: ['warenwirtschaft'] }
    const d = db({ kontakte: [{ id: K1, tenant_id: T, vorname: 'Eva', nachname: 'Huber', betrieb_nr: '1234567' }] }); globalThis.__serverFake = d
    await assert.rejects(v.createVerkauf(formular({ datum: '2026-10-08', kontakt_id: K1, positionen_json: [{ typ: 'tank', name: 'Fass', weinausbau_id: W1, menge: 10 }] })), /Kellerbuch|Rieden/)
    assert.deepEqual(schreibzugriffe(d), [])
  })

  test('Erfolg: Bestand zuerst (RPC je Füllung, alles oder nichts), dann Beleg, Positionen und CRM-Aktivität', async () => {
    const rpc = (name, args) => {
      if (name === 'lade_crmgemeinschaft') return { data: [], error: null }
      if (name === 'pruefe_ea_zeitraum_offen') return ZEITRAUM_OFFEN
      if (name === 'get_next_transaktionsnr') return { data: 'VK-2026-0001', error: null }
      if (name === 's112_fuellung_verkauf_buchen') return { data: 12 + args.p_menge_stk, error: null }
      return { data: null, error: { message: 'unerwartet ' + name } }
    }
    const d = datenbank({
      fuellungen: [{ id: F1, tenant_id: T, name: 'GV Klassik 2025', bestand_flaschen: 12, qualitaet: 'qualitaetswein', pruefnummer: 'N 1/26', dac: { status: 'genehmigt' } }],
      kontakte: [{ id: K1, tenant_id: T, vorname: 'Eva', nachname: 'Huber', is_lead: true }],
      verkaufsposten: [], verkauf_positionen: [], aktivitaeten: [],
    }, { rpc })
    globalThis.__serverFake = d
    const r = await v.createVerkauf(formular({ datum: '2026-10-08', kontakt_id: K1, positionen_json: [flasche(3)] }))
    const schritte = schreibzugriffe(d).map(a => a.tabelle)
    assert.deepEqual(schritte.slice(0, 4), ['rpc:s112_fuellung_verkauf_buchen', 'rpc:get_next_transaktionsnr', 'verkaufsposten', 'verkauf_positionen'])
    const buchung = d.aufrufe.find(a => a.tabelle === 'rpc:s112_fuellung_verkauf_buchen').werte
    assert.deepEqual([buchung.p_fuellung_id, buchung.p_menge_stk, buchung.p_datum, buchung.p_verkaufsposten_id], [F1, -3, '2026-10-08', r.id])
    assert.equal(d.tabellen.verkaufsposten[0].id, r.id)
    assert.equal(d.tabellen.verkaufsposten[0].transaktions_nr, 'VK-2026-0001')
    assert.equal(d.tabellen.verkauf_positionen[0].verkaufsposten_id, r.id)
    assert.equal(d.tabellen.aktivitaeten[0].art, 'verkauf')
    assert.equal(d.tabellen.kontakte[0].is_lead, false)   // erster Verkauf: Lead → Kunde
  })

  test('Beleg scheitert nach der Abbuchung: Bestand wird zurückgebucht, Meldung „Bestand ist unverändert“', async () => {
    const rpc = (name, args) => {
      if (name === 'get_next_transaktionsnr') return { data: null, error: null }
      if (name === 's112_fuellung_verkauf_buchen') return { data: 12 + args.p_menge_stk, error: null }
      return { data: [], error: null }
    }
    const d = datenbank({
      fuellungen: [{ id: F1, tenant_id: T, name: 'GV Klassik 2025', bestand_flaschen: 12, qualitaet: 'landwein', pruefnummer: null }],
      verkaufsposten: [],
    }, { rpc, vorher: e => (e.tabelle === 'verkaufsposten' && e.art === 'insert' ? { error: { message: 'violates check constraint' } } : null) })
    globalThis.__serverFake = d
    await assert.rejects(v.createVerkauf(formular({ datum: '2026-10-08', positionen_json: [flasche(3, { name: 'Landwein' })] })), /Der Bestand ist unverändert/)
    const buchungen = d.aufrufe.filter(a => a.tabelle === 'rpc:s112_fuellung_verkauf_buchen').map(a => a.werte.p_menge_stk)
    assert.deepEqual(buchungen, [-3, 3])   // Abbuchung und Rücknahme
    assert.equal(d.tabellen.verkaufsposten.length, 0)
  })

  test('Löschen gibt es nicht – nur Storno', async () => {
    await assert.rejects(v.deactivateVerkauf(P1), /storniert, nicht gelöscht/)
  })
})

describe('Storno und Zahlungen', nurMitHooks, () => {
  test('Verkauf stornieren: Grund ≥ 10 Zeichen und gültiges Erstattungsdatum vor jedem Schreibzugriff', async () => {
    let d = db(); globalThis.__serverFake = d
    await assert.rejects(v.stornoVerkauf(P1, 'zu kurz'), /mindestens 10 Zeichen|Grund/)
    await assert.rejects(v.stornoVerkauf(P1, 'Falsch erfasst, Kunde storniert', '08.10.2026'), /gültiges Erstattungsdatum/)
    assert.deepEqual(schreibzugriffe(d), [])
  })

  test('Zahlung erfassen: Betrag > 0, Datum ohne Angabe = heute in Wien, danach E&A-Abgleich', async () => {
    let d = db(); globalThis.__serverFake = d
    // KAN-355: erwartbare Ablehnung als { error } (Meldung im Formular), nicht geworfen
    for (const b of ['', '0', '-5', 'abc']) assert.match((await v.createZahlung(P1, formular({ betrag: b }))).error, /Ungültiger Betrag/)
    assert.deepEqual(schreibzugriffe(d), [])
    const { heuteWien } = await laden('lib/datum/wien.ts')
    assert.deepEqual(await v.createZahlung(P1, formular({ betrag: '12,50', art: 'bar' })), { ok: true })
    const z = d.tabellen.zahlungen.at(-1)
    assert.deepEqual([z.betrag, z.art, z.datum, z.verkaufsposten_id, z.tenant_id], [12.5, 'bar', heuteWien(), P1, T])
    assert.deepEqual(globalThis.__eaSync, [P1])
  })

  test('E&A-Abgleich scheitert: Meldung „gespeichert, bitte nicht erneut erfassen“ statt stillem Fehlen (KAN-149)', async () => {
    globalThis.__serverFake = db()
    globalThis.__ea = { ok: false, error: 'Periode gesperrt.' }
    await assert.rejects(v.createZahlung(P1, formular({ betrag: '5' })), /Die Zahlung ist gespeichert \(bitte nicht erneut erfassen\), die Einnahme in der E&A-Rechnung wurde aber nicht aktualisiert: Periode gesperrt\./)
  })

  // KAN-239 (vorher Befund: keine Rechteprüfung in der App – ein Leser erreichte das Insert, die DB lehnte technisch ab)
  test('Zahlungen nur mit Freigabe Warenwirtschaft oder E&A (wie RLS) – erfassen, als bezahlt markieren, stornieren', async () => {
    for (const m of [{ role: 'leser', schreibmodule: [] }, { role: 'winzer', schreibmodule: ['kellerbuch', 'crm'] }]) {
      globalThis.__membership = { tenantId: T, ...m }
      const d = db(); globalThis.__serverFake = d
      await assert.rejects(v.createZahlung(P1, formular({ betrag: '5' })), /Keine Berechtigung für Zahlungen – dafür ist die Freigabe Warenwirtschaft oder E&A nötig/)
      await assert.rejects(v.markiereAlsBezahlt(P1), /Keine Berechtigung für Zahlungen/)
      await assert.rejects(v.stornoZahlung(Z1, P1, 'Doppelt erfasst bei Kassa'), /Keine Berechtigung für Zahlungen/)
      assert.deepEqual(d.aufrufe, [], `${m.role}: kein Datenbankzugriff`)
    }
    for (const mods of [['warenwirtschaft'], ['ea']]) {
      globalThis.__membership = { tenantId: T, role: 'winzer', schreibmodule: mods }
      const d = db(); globalThis.__serverFake = d
      await v.createZahlung(P1, formular({ betrag: '5' }))
      assert.equal(d.tabellen.zahlungen.length, 2, mods[0])
    }
  })

  test('Zahlung stornieren: Grund, Datum und Zugehörigkeit zum Verkauf vor der RPC', async () => {
    let d = db(); globalThis.__serverFake = d
    await assert.rejects(v.stornoZahlung(Z1, P1, 'kurz'), /mindestens 10 Zeichen|Grund/)
    await assert.rejects(v.stornoZahlung(Z1, P1, 'Doppelt erfasst bei Kassa', '2026-13'), /gültiges Erstattungsdatum/)
    await assert.rejects(v.stornoZahlung(Z1, '00000000-0000-4000-8000-0000000000b9', 'Doppelt erfasst bei Kassa'), /Zahlung nicht gefunden/)
    assert.deepEqual(schreibzugriffe(d), [])
    await v.stornoZahlung(Z1, P1, '  Doppelt erfasst bei Kassa ', '2026-10-08')
    const rpc = d.aufrufe.find(a => a.tabelle === 'rpc:s112_zahlung_stornieren')
    assert.deepEqual(rpc?.werte, { p_tenant_id: T, p_zahlung_id: Z1, p_grund: 'Doppelt erfasst bei Kassa', p_datum: '2026-10-08' })
  })
})
