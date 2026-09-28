// Charakterisierungstests (28.09.2026, STABILITAET.md Stufe 3 Punkt 2) für
// src/lib/kellerbuch/folgebuchungen.ts – „Hat die Charge Folgebuchungen?“, die zentrale Sperre
// vor Löschen/Überschreiben im Kellerbuch. Hält das HEUTIGE Verhalten fest (Sicherheitsnetz vor
// dem Storno-Umbau KAN-145/148/149).
//
// Abgedeckt:
//   folgebuchungenDerCharge  Mandant aus der Charge, Zählweise je Art (Batch, Schwund je Zeile,
//                            aktive Füllungen aus zwei Quellen, Tankverkauf je nicht stornierten
//                            Posten, count-Abfragen), feste Reihenfolge, opts.ohne (auch: welche
//                            Abfragen gar nicht erst laufen), ungültige ID, unbekannte Charge,
//                            Abfragefehler je Tabelle, Mandantenfilter
//   folgebuchungenText       Einzahl/Mehrzahl, Aufzählung mit „und“, Tausenderpunkt, leere Liste
//   sperreBeiFolgebuchungen  „hängt“/„hängen“, eigener bzw. Standard-Hinweis
//
// Aufruf: npm run -s test:csv  (Node ≥ 22.15 wegen module.registerHooks)

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  hooksRegistrieren, laden, nurMitHooks, hooksMoeglich, datenbank, uuid, hatFilter, ohneMandant, fehlerBei,
} from './buchung-attrappe.mjs'

hooksRegistrieren()
const f = hooksMoeglich ? await laden('lib/kellerbuch/folgebuchungen.ts') : null

const T = 'tenant-1'
const FREMD = 'tenant-2'
const C = uuid(1)
const ANDERE = uuid(2)
const OHNE_TENANT_SPALTE = ['verschneidung_quellen']

const vieles = () => ({
  weinausbau: [{ id: C, tenant_id: T, name: 'Grüner Veltliner' }],
  keller_umzuege: [
    { id: 'u1', tenant_id: T, von_weinausbau_id: C, umzug_batch_id: 'b1', umzug_typ: 'umzug' },
    { id: 'u2', tenant_id: T, nach_weinausbau_id: C, umzug_batch_id: 'b1', umzug_typ: 'umzug' },
    { id: 'u3', tenant_id: T, nach_weinausbau_id: C, umzug_batch_id: null, umzug_typ: null },
    { id: 'u4', tenant_id: T, von_weinausbau_id: C, umzug_batch_id: null, umzug_typ: 'schwund' },
    { id: 'u5', tenant_id: T, von_weinausbau_id: C, umzug_batch_id: 'b9', umzug_typ: 'schwund' },
    { id: 'u6', tenant_id: FREMD, von_weinausbau_id: C, umzug_batch_id: 'bf', umzug_typ: 'umzug' },
    { id: 'u7', tenant_id: T, von_weinausbau_id: ANDERE, umzug_batch_id: 'b2', umzug_typ: 'umzug' },
  ],
  verschneidung_quellen: [
    { verschneidung_id: 'v1', quell_weinausbau_id: C },
    { verschneidung_id: 'v1', quell_weinausbau_id: C },
    { verschneidung_id: 'v2', quell_weinausbau_id: C },
  ],
  verschneidungen: [
    { id: 'vz', tenant_id: T, ziel_weinausbau_id: C },
    { id: 'vzf', tenant_id: FREMD, ziel_weinausbau_id: C },
  ],
  fuellung_chargen: [
    { fuellung_id: 'f1', tenant_id: T, weinausbau_id: C, fuellungen: { aktiv: true } },
    { fuellung_id: 'f3', tenant_id: T, weinausbau_id: C, fuellungen: { aktiv: false } },
  ],
  fuellungen: [
    { id: 'f1', tenant_id: T, weinausbau_id: C, aktiv: true },
    { id: 'f2', tenant_id: T, weinausbau_id: C, aktiv: true },
    { id: 'f4', tenant_id: T, weinausbau_id: C, aktiv: false },
  ],
  verkauf_positionen: [
    { id: 'p1', tenant_id: T, weinausbau_id: C, typ: 'tank', verkaufsposten_id: 'vp1', verkaufsposten: { storniert: false } },
    { id: 'p2', tenant_id: T, weinausbau_id: C, typ: 'tank', verkaufsposten_id: 'vp1', verkaufsposten: { storniert: false } },
    { id: 'p3', tenant_id: T, weinausbau_id: C, typ: 'tank', verkaufsposten_id: 'vp2', verkaufsposten: { storniert: true } },
    { id: 'p4', tenant_id: T, weinausbau_id: C, typ: 'flasche', verkaufsposten_id: 'vp3', verkaufsposten: { storniert: false } },
  ],
  keller_behandlungen: [{ id: 'kb1', tenant_id: T, weinausbau_id: C }, { id: 'kb2', tenant_id: T, weinausbau_id: C }, { id: 'kb3', tenant_id: FREMD, weinausbau_id: C }],
  weinanalysen: [{ id: 'wa1', tenant_id: T, weinausbau_id: C }],
  dac_antrag: [{ id: 'd1', tenant_id: T, weinausbau_id: C, aktiv: false }],
  zukauf_posten: [{ id: 'z1', tenant_id: T, ziel_weinausbau_id: C, aktiv: true }, { id: 'z2', tenant_id: T, ziel_weinausbau_id: C, aktiv: false }],
})

async function fehlerVon(p) {
  try { await p } catch (e) { return e }
  assert.fail('Fehler erwartet')
}

describe('folgebuchungenDerCharge', nurMitHooks, () => {
  test('zählt alle Arten in fester Reihenfolge – nur eigene Mandantendaten, aktive Füllungen/Zukäufe, nicht stornierte Tankverkäufe', async () => {
    const db = datenbank(vieles())
    const r = await f.folgebuchungenDerCharge(db, C)
    assert.deepEqual(r, [
      { art: 'umzug', anzahl: 2 },             // Batch b1 einmal + u3 ohne Batch
      { art: 'schwund', anzahl: 2 },           // je Zeile, Batch egal
      { art: 'verschnitt_quelle', anzahl: 2 }, // je Verschnitt
      { art: 'verschnitt_ziel', anzahl: 1 },
      { art: 'fuellung', anzahl: 2 },          // f1 (beide Quellen) + f2
      { art: 'tankverkauf', anzahl: 1 },       // vp1 einmal, vp2 storniert, p4 keine Tankposition
      { art: 'zukauf_ziel', anzahl: 1 },
      { art: 'behandlung', anzahl: 2 },
      { art: 'analyse', anzahl: 1 },
      { art: 'dac', anzahl: 1 },               // auch inaktive Anträge
    ])
    assert.deepEqual(ohneMandant(db, T, [...OHNE_TENANT_SPALTE, 'weinausbau']), [])
    const charge = db.aufrufe[0]
    assert.equal(charge.tabelle, 'weinausbau')
    assert.ok(!hatFilter(charge, 'eq', 'tenant_id'), 'Mandant wird erst aus der Charge gelesen')
    for (const t of ['verschneidungen', 'keller_behandlungen', 'weinanalysen', 'dac_antrag', 'zukauf_posten']) {
      const a = db.aufrufe.find(x => x.tabelle === t)
      assert.deepEqual(a.optionen, { count: 'exact', head: true }, `${t} als count-Abfrage`)
    }
  })

  test('Charge eines anderen Betriebs (per RLS sichtbar): gezählt wird in DESSEN Mandanten', async () => {
    const t = vieles()
    t.weinausbau[0].tenant_id = FREMD
    const db = datenbank(t)
    const r = await f.folgebuchungenDerCharge(db, C)
    assert.deepEqual(r, [
      { art: 'umzug', anzahl: 1 },
      { art: 'verschnitt_quelle', anzahl: 2 },
      { art: 'verschnitt_ziel', anzahl: 1 },
      { art: 'behandlung', anzahl: 1 },
    ])
    assert.deepEqual(ohneMandant(db, FREMD, [...OHNE_TENANT_SPALTE, 'weinausbau']), [])
  })

  test('nichts hängt: leere Liste', async () => {
    assert.deepEqual(await f.folgebuchungenDerCharge(datenbank({ weinausbau: [{ id: C, tenant_id: T }] }), C), [])
  })

  test('opts.ohne: ausgenommene Arten fehlen, ihre Abfragen laufen gar nicht erst', async () => {
    const db = datenbank(vieles())
    const r = await f.folgebuchungenDerCharge(db, C, { ohne: ['zukauf_ziel', 'analyse', 'dac', 'fuellung'] })
    assert.deepEqual(r.map(x => x.art), ['umzug', 'schwund', 'verschnitt_quelle', 'verschnitt_ziel', 'tankverkauf', 'behandlung'])
    const tabellen = db.aufrufe.map(a => a.tabelle)
    for (const t of ['zukauf_posten', 'weinanalysen', 'dac_antrag', 'fuellungen', 'fuellung_chargen']) assert.ok(!tabellen.includes(t), t)
  })

  test('ohne „umzug“ wird Schwund weiter gezählt (dieselbe Abfrage); ohne beides keine Umzugsabfrage', async () => {
    let db = datenbank(vieles())
    let r = await f.folgebuchungenDerCharge(db, C, { ohne: ['umzug'] })
    assert.deepEqual(r[0], { art: 'schwund', anzahl: 2 })
    assert.ok(db.aufrufe.some(a => a.tabelle === 'keller_umzuege'))
    db = datenbank(vieles())
    r = await f.folgebuchungenDerCharge(db, C, { ohne: ['umzug', 'schwund'] })
    assert.equal(r[0].art, 'verschnitt_quelle')
    assert.ok(!db.aufrufe.some(a => a.tabelle === 'keller_umzuege'))
  })

  test('ungültige Chargen-ID (auch kein Text): Fehler ohne Datenbankzugriff', async () => {
    for (const id of ['abc', '', null, 42]) {
      const db = datenbank(vieles())
      const e = await fehlerVon(f.folgebuchungenDerCharge(db, id))
      assert.equal(e.message, 'Folgebuchungen können nicht geprüft werden: ungültige Chargen-ID')
      assert.deepEqual(db.aufrufe, [])
    }
  })

  test('unbekannte Charge: Fehler, keine Zählabfragen', async () => {
    const db = datenbank({ weinausbau: [] })
    const e = await fehlerVon(f.folgebuchungenDerCharge(db, C))
    assert.equal(e.message, 'Folgebuchungen können nicht geprüft werden: Charge nicht gefunden')
    assert.equal(db.aufrufe.length, 1)
  })

  test('Abfragefehler je Tabelle: Fehler mit Tabellenname, nie still 0; ohne Meldung „unbekannter Fehler“', async () => {
    const tabellen = ['weinausbau', 'keller_umzuege', 'verschneidung_quellen', 'verschneidungen', 'fuellung_chargen', 'fuellungen',
      'verkauf_positionen', 'keller_behandlungen', 'weinanalysen', 'dac_antrag', 'zukauf_posten']
    for (const t of tabellen) {
      const e = await fehlerVon(f.folgebuchungenDerCharge(datenbank(vieles(), { vorher: fehlerBei(t, 'select', { message: 'kaputt' }) }), C))
      assert.equal(e.message, `Folgebuchungen der Charge konnten nicht geprüft werden (${t}): kaputt`)
    }
    const e = await fehlerVon(f.folgebuchungenDerCharge(datenbank(vieles(), { vorher: fehlerBei('dac_antrag', 'select', { code: '500' }) }), C))
    assert.equal(e.message, 'Folgebuchungen der Charge konnten nicht geprüft werden (dac_antrag): unbekannter Fehler')
  })

  test('count null (z. B. ohne Zählung geliefert) gilt als 0', async () => {
    const db = datenbank(vieles())
    // Attrappe liefert für head-Abfragen count; für keller_behandlungen wird er gezielt auf null gesetzt
    const orig = db.from
    db.from = t => {
      const q = orig(t)
      if (t !== 'keller_behandlungen') return q
      const then = q.then
      q.then = (ok, err) => then.call(q, r => ok({ ...r, count: null }), err)
      return q
    }
    const r = await f.folgebuchungenDerCharge(db, C)
    assert.ok(!r.some(x => x.art === 'behandlung'))
  })
})

describe('folgebuchungenText', nurMitHooks, () => {
  test('leer bzw. nur Nullen: „keine Folgebuchungen“', () => {
    assert.equal(f.folgebuchungenText([]), 'keine Folgebuchungen')
    assert.equal(f.folgebuchungenText([{ art: 'umzug', anzahl: 0 }]), 'keine Folgebuchungen')
  })

  test('Einzahl, Mehrzahl, Aufzählung mit Komma und „und“, Tausenderpunkt', () => {
    assert.equal(f.folgebuchungenText([{ art: 'fuellung', anzahl: 1 }]), '1 Füllung')
    assert.equal(f.folgebuchungenText([{ art: 'umzug', anzahl: 2 }, { art: 'dac', anzahl: 1 }]), '2 Umzüge und 1 DAC-Antrag')
    assert.equal(
      f.folgebuchungenText([{ art: 'umzug', anzahl: 1234 }, { art: 'verschnitt_quelle', anzahl: 1 }, { art: 'tankverkauf', anzahl: 3 }, { art: 'behandlung', anzahl: 0 }]),
      '1.234 Umzüge, 1 Verschnitt (als Quelle) und 3 Tankverkäufe')
  })

  test('alle Bezeichnungen', () => {
    const arten = ['umzug', 'schwund', 'verschnitt_quelle', 'verschnitt_ziel', 'fuellung', 'tankverkauf', 'zukauf_ziel', 'behandlung', 'analyse', 'dac']
    assert.equal(f.folgebuchungenText(arten.map(art => ({ art, anzahl: 2 }))),
      '2 Umzüge, 2 Schwundbuchungen, 2 Verschnitte (als Quelle), 2 Verschnitte (als Ziel), 2 Füllungen, 2 Tankverkäufe, 2 Zukäufe, 2 Kellerbehandlungen, 2 Weinanalysen und 2 DAC-Anträge')
    assert.equal(f.folgebuchungenText(arten.map(art => ({ art, anzahl: 1 }))),
      '1 Umzug, 1 Schwundbuchung, 1 Verschnitt (als Quelle), 1 Verschnitt (als Ziel), 1 Füllung, 1 Tankverkauf, 1 Zukauf, 1 Kellerbehandlung, 1 Weinanalyse und 1 DAC-Antrag')
  })
})

describe('sperreBeiFolgebuchungen', nurMitHooks, () => {
  const nur = teil => ({ weinausbau: [{ id: C, tenant_id: T }], ...teil })

  test('ohne Folgebuchungen: kein Fehler', async () => {
    await f.sperreBeiFolgebuchungen(datenbank(nur({})), C, 'Löschen der Charge')
  })

  test('genau eine Buchung: „hängt“, Standard-Hinweis', async () => {
    const e = await fehlerVon(f.sperreBeiFolgebuchungen(datenbank(nur({ weinanalysen: [{ id: 'a', tenant_id: T, weinausbau_id: C }] })), C, 'Löschen der Charge'))
    assert.equal(e.name, 'AktionsFehler')
    assert.equal(e.message, 'Löschen der Charge ist nicht möglich: An der Charge hängt bereits 1 Weinanalyse. Die Charge bleibt als Historie erhalten – Korrekturen bitte als eigene, datierte Buchung erfassen (z. B. Schwund buchen oder Umzug).')
  })

  test('mehrere Buchungen einer Art bzw. mehrere Arten: „hängen“; eigener Hinweis wird getrimmt, leerer ersetzt', async () => {
    const zwei = nur({ weinanalysen: [{ id: 'a', tenant_id: T, weinausbau_id: C }, { id: 'b', tenant_id: T, weinausbau_id: C }] })
    let e = await fehlerVon(f.sperreBeiFolgebuchungen(datenbank(zwei), C, 'Ändern der Pressmenge', { hinweis: '  Menge bitte über „Schwund buchen“ korrigieren.  ' }))
    assert.equal(e.message, 'Ändern der Pressmenge ist nicht möglich: An der Charge hängen bereits 2 Weinanalysen. Menge bitte über „Schwund buchen“ korrigieren.')
    const gemischt = nur({ weinanalysen: [{ id: 'a', tenant_id: T, weinausbau_id: C }], dac_antrag: [{ id: 'd', tenant_id: T, weinausbau_id: C }] })
    e = await fehlerVon(f.sperreBeiFolgebuchungen(datenbank(gemischt), C, 'X', { hinweis: '   ' }))
    assert.match(e.message, /^X ist nicht möglich: An der Charge hängen bereits 1 Weinanalyse und 1 DAC-Antrag\. Die Charge bleibt als Historie erhalten/)
  })

  test('ohne: ausgenommene Arten sperren nicht', async () => {
    await f.sperreBeiFolgebuchungen(datenbank(nur({ weinanalysen: [{ id: 'a', tenant_id: T, weinausbau_id: C }] })), C, 'Gebindewechsel', { ohne: ['analyse'] })
  })
})
