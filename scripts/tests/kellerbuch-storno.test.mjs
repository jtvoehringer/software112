// Charakterisierungstests (28.09.2026, STABILITAET.md Stufe 3 Punkt 2) für
// src/lib/kellerbuch/storno.ts – Storno von Umzug, Schwundbuchung und Verschnitt. Sicherheitsnetz
// vor dem Storno-Umbau (KAN-145/148/149): festgehalten ist das HEUTIGE Verhalten, fragwürdige
// Stellen sind mit „Befund“ markiert und nicht korrigiert.
//
// Abgedeckt:
//   datumText, umzugAlsEingabe (neues und altes Zeilenformat), nurNotizenAenderbar, umzugSperrMeldung
//   spaetereMengenbewegungen   Zählweise je Art, „später erfasst“ (>=, fehlender Zeitstempel),
//                              Ausnahmen der eigenen Buchung, Mandantenfilter, Abfragefehler
//   ladeUmzugZeilen            Batch, Einzelzeile, fremder Mandant, Fehler
//   planeUmzugStorno           Rückbuchungsplan (brutto zurück an die Quelle, netto ab vom Ziel),
//                              Reaktivierung, Sperren (weiterbewegt, zu wenig Bestand, altes Format,
//                              fehlende Charge/Ziel), Qualitäts-Abstufung zurücknehmen
//   Schwund (planeUmzugStorno) Bestandsprotokoll-Nachweis, Minderung samt aktiv/Status, Sperren
//   storniereUmzug             Reihenfolge, Vergleichen und Setzen, Rücknahme bei jedem Fehler
//                              (Rückbuchung, Löschen, Löschen ohne Treffer, Teil-Löschen)
//   planeVerschneidungStorno / storniereVerschneidung   Snapshot-Werte, Sperren, Fehler
//
// Aufruf: npm run -s test:csv  (Node ≥ 22.15 wegen module.registerHooks)

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  hooksRegistrieren, laden, nurMitHooks, hooksMoeglich, datenbank, uuid,
  schreibzugriffe, zugriffe, hatFilter, ohneMandant, zeile, fehlerBei,
} from './buchung-attrappe.mjs'

hooksRegistrieren()
const s = hooksMoeglich ? await laden('lib/kellerbuch/storno.ts') : null
const h = hooksMoeglich ? await laden('lib/kellerbuch/hinweise.ts') : null

const T = 'tenant-1'
const FREMD = 'tenant-2'
const A = uuid(1)   // Quelle
const B = uuid(2)   // Ziel
const S = uuid(3)   // Schwund-Charge
const Z = uuid(4)   // Verschnitt-Ziel
const V1 = uuid(5)
const V2 = uuid(6)
const VS = uuid(31)
const ZEIT = '2026-09-20T10:00:00.000Z'
const FRUEHER = '2026-09-19T10:00:00.000Z'
const SPAETER = '2026-09-21T10:00:00.000Z'
const OHNE_VERSCHNITT = ['verschneidung_quellen'] // Tabelle ohne tenant_id-Spalte (RLS über verschneidungen)

const charge = (id, name, teil) => ({
  id, tenant_id: T, name, menge_liter: 100, aktiv: true, status: 'ausbau',
  qualitaetsstufe: 'qualitaetswein', herkunft_code: null, notizen: null, ...teil,
})
const umzugZeile = (id, teil) => ({
  id, tenant_id: T, datum: '2026-09-20', erstellt_am: ZEIT, zeilen_typ: null, umzug_typ: 'umzug', umzug_batch_id: 'batch-1',
  von_weinausbau_id: null, nach_weinausbau_id: null, von_behaelter_id: null, nach_behaelter_id: null,
  brutto_liter: null, menge_liter: null, schwund_liter: null, notizen: null, ...teil,
})
const quelle = teil => umzugZeile(uuid(11), { zeilen_typ: 'quelle', von_weinausbau_id: A, von_behaelter_id: 'geb-1', brutto_liter: 505, menge_liter: 505, schwund_liter: 5, notizen: 'Umzug nach T2', ...teil })
const ziel = teil => umzugZeile(uuid(12), { zeilen_typ: 'ziel', von_weinausbau_id: A, nach_weinausbau_id: B, nach_behaelter_id: 'geb-2', menge_liter: 500, ...teil })

/** Umzug A (1000 L, 505 brutto entnommen → 495) nach B (neu, 500 L netto) */
const umzugTabellen = () => ({
  weinausbau: [charge(A, 'Welschriesling Tank 1', { menge_liter: 495 }), charge(B, 'Welschriesling Tank 2', { menge_liter: 500 })],
  keller_umzuege: [quelle(), ziel()],
})

const mengen = db => Object.fromEntries(db.tabellen.weinausbau.map(c => [c.name, c.menge_liter]))

async function fehlerVon(p) {
  try { await p } catch (e) { return e }
  assert.fail('Fehler erwartet')
}

// ── reine Helfer ──────────────────────────────────────────────────────────────

describe('datumText, umzugAlsEingabe, nurNotizenAenderbar', nurMitHooks, () => {
  test('datumText: ISO-Datum → TT.MM.JJJJ, leer → „–“, Unlesbares unverändert', () => {
    assert.equal(s.datumText('2026-09-24'), '24.09.2026')
    assert.equal(s.datumText('2026-09-24T22:30:00Z'), '24.09.2026')
    assert.equal(s.datumText(null), '–')
    assert.equal(s.datumText(''), '–')
    assert.equal(s.datumText('gestern'), 'gestern')
  })

  test('umzugAlsEingabe, neues Format: Quellen brutto, Ziele netto, Notizen/ID der ersten Quelle', () => {
    const e = s.umzugAlsEingabe([quelle(), ziel(), ziel({ id: uuid(13), nach_behaelter_id: 'geb-3', menge_liter: '0' })])
    assert.deepEqual(e, {
      quellen: [{ weinausbau_id: A, brutto: 505 }],
      ziele: [{ behaelter_id: 'geb-2', menge_netto: 500 }, { behaelter_id: 'geb-3', menge_netto: 0 }],
      datum: '2026-09-20', notizen: 'Umzug nach T2', ersteId: uuid(11),
    })
  })

  test('umzugAlsEingabe, altes Format: eine Quelle, brutto aus der Hauptzeile bzw. Summe netto + Schwund', () => {
    const alt = [
      umzugZeile('z1', { von_weinausbau_id: A, nach_behaelter_id: 'geb-2', menge_liter: 300, schwund_liter: 2, notizen: 'alt' }),
      umzugZeile('z2', { von_weinausbau_id: A, nach_behaelter_id: 'geb-3', menge_liter: 100, schwund_liter: 1 }),
    ]
    assert.deepEqual(s.umzugAlsEingabe(alt), {
      quellen: [{ weinausbau_id: A, brutto: 403 }],
      ziele: [{ behaelter_id: 'geb-2', menge_netto: 300 }, { behaelter_id: 'geb-3', menge_netto: 100 }],
      datum: '2026-09-20', notizen: 'alt', ersteId: 'z1',
    })
    alt[1].brutto_liter = 410
    assert.equal(s.umzugAlsEingabe(alt).quellen[0].brutto, 410)
    assert.equal(s.umzugAlsEingabe(alt).notizen, '', 'Notizen der Hauptzeile (mit brutto_liter)')
  })

  test('nurNotizenAenderbar: Schwund immer, Umzug nur mit Sperre', () => {
    const plan = (istSchwund, sperre) => ({ zeilen: [], batchId: null, datum: null, istSchwund, sperre, aenderungen: [] })
    assert.equal(s.nurNotizenAenderbar(plan(true, null)), true)
    assert.equal(s.nurNotizenAenderbar(plan(false, null)), false)
    assert.equal(s.nurNotizenAenderbar(plan(false, { grund: 'x', hinweis: 'y' })), true)
  })

  test('umzugSperrMeldung: Texte je Vorgang; ohne Sperre leer; Schwund: Menge/Datum nie änderbar', () => {
    const sperre = { grund: 'etwas hängt', hinweis: 'Hinweis.' }
    const u = { zeilen: [], batchId: null, datum: '2026-09-20', istSchwund: false, sperre, aenderungen: [] }
    assert.equal(s.umzugSperrMeldung(u, 'stornieren'), 'Der Umzug vom 20.09.2026 ist nicht mehr stornierbar, weil etwas hängt. Hinweis.')
    assert.equal(s.umzugSperrMeldung(u, 'aendern'), 'Menge, Gebinde und Datum des Umzugs vom 20.09.2026 können nicht mehr geändert werden, weil etwas hängt. Die Notizen lassen sich weiterhin ändern. Hinweis.')
    assert.equal(s.umzugSperrMeldung(u, 'datum'), 'Das Datum des Umzugs vom 20.09.2026 kann nicht mehr geändert werden, weil etwas hängt. Die Notizen lassen sich weiterhin ändern.', 'ohne Hinweis')
    assert.equal(s.umzugSperrMeldung({ ...u, sperre: null }, 'stornieren'), '')
    const sw = { ...u, istSchwund: true, sperre: null }
    assert.equal(s.umzugSperrMeldung(sw, 'stornieren'), '')
    assert.equal(s.umzugSperrMeldung(sw, 'aendern'), `Menge und Datum der Schwundbuchung vom 20.09.2026 können nicht geändert werden – die Notizen lassen sich weiterhin ändern. ${h.SCHWUND_STORNO_HINWEIS}`)
    assert.equal(s.umzugSperrMeldung(sw, 'datum'), `Das Datum der Schwundbuchung vom 20.09.2026 kann nicht geändert werden – die Notizen lassen sich weiterhin ändern. ${h.SCHWUND_STORNO_HINWEIS}`)
    assert.equal(s.umzugSperrMeldung({ ...sw, sperre }, 'stornieren'), 'Die Schwundbuchung vom 20.09.2026 kann nicht storniert werden, weil etwas hängt. Hinweis.')
  })

  test('Konstanten der Sperrlisten', () => {
    assert.deepEqual(s.OHNE_MENGENWIRKUNG, ['behandlung', 'analyse', 'dac'])
    assert.deepEqual(s.GEBINDEWECHSEL_OHNE, ['zukauf_ziel', 'analyse', 'dac'])
  })
})

// ── spätere Mengenbewegungen ──────────────────────────────────────────────────

describe('spaetereMengenbewegungen – was wurde nach der Buchung an der Charge erfasst?', nurMitHooks, () => {
  const alleArten = () => ({
    keller_umzuege: [
      umzugZeile('u1', { von_weinausbau_id: B, umzug_batch_id: 'b-x', erstellt_am: SPAETER }),
      umzugZeile('u2', { nach_weinausbau_id: B, umzug_batch_id: 'b-x', erstellt_am: SPAETER }),
      umzugZeile('u3', { von_weinausbau_id: B, umzug_batch_id: null, erstellt_am: SPAETER }),
      umzugZeile('u4', { von_weinausbau_id: B, umzug_typ: 'schwund', umzug_batch_id: null, erstellt_am: SPAETER }),
      umzugZeile('u5', { von_weinausbau_id: B, umzug_typ: 'schwund', umzug_batch_id: null, erstellt_am: null }),
      umzugZeile('u6', { von_weinausbau_id: B, umzug_batch_id: 'b-alt', erstellt_am: FRUEHER }),
      umzugZeile('eigen', { nach_weinausbau_id: B, erstellt_am: SPAETER }),
      umzugZeile('fremd', { tenant_id: FREMD, von_weinausbau_id: B, erstellt_am: SPAETER }),
    ],
    verschneidung_quellen: [
      { verschneidung_id: 'vq1', quell_weinausbau_id: B, verschneidung: { created_at: SPAETER } },
      { verschneidung_id: 'vq1', quell_weinausbau_id: B, verschneidung: { created_at: SPAETER } },
      { verschneidung_id: 'vq-alt', quell_weinausbau_id: B, verschneidung: { created_at: FRUEHER } },
      { verschneidung_id: 'vq-ohne', quell_weinausbau_id: B, verschneidung: null },
    ],
    verschneidungen: [
      { id: 'vz1', tenant_id: T, ziel_weinausbau_id: B, created_at: ZEIT },
      { id: 'vz-alt', tenant_id: T, ziel_weinausbau_id: B, created_at: FRUEHER },
    ],
    fuellung_chargen: [
      { fuellung_id: 'f1', tenant_id: T, weinausbau_id: B, created_at: SPAETER, fuellungen: { aktiv: true } },
      { fuellung_id: 'f-inaktiv', tenant_id: T, weinausbau_id: B, created_at: SPAETER, fuellungen: { aktiv: false } },
    ],
    fuellungen: [
      { id: 'f1', tenant_id: T, weinausbau_id: B, aktiv: true, erstellt_am: SPAETER },
      { id: 'f2', tenant_id: T, weinausbau_id: B, aktiv: true, erstellt_am: SPAETER },
    ],
    verkauf_positionen: [
      { id: 'p1', tenant_id: T, weinausbau_id: B, typ: 'tank', verkaufsposten_id: 'vp1', erstellt_am: SPAETER, verkaufsposten: { storniert: false } },
      { id: 'p2', tenant_id: T, weinausbau_id: B, typ: 'tank', verkaufsposten_id: 'vp1', erstellt_am: SPAETER, verkaufsposten: { storniert: false } },
      { id: 'p3', tenant_id: T, weinausbau_id: B, typ: 'tank', verkaufsposten_id: 'vp-storno', erstellt_am: SPAETER, verkaufsposten: { storniert: true } },
      { id: 'p4', tenant_id: T, weinausbau_id: B, typ: 'flasche', verkaufsposten_id: 'vp2', erstellt_am: SPAETER, verkaufsposten: { storniert: false } },
    ],
    zukauf_posten: [
      { id: 'zk1', tenant_id: T, ziel_weinausbau_id: B, aktiv: true, erstellt_am: SPAETER },
      { id: 'zk-inaktiv', tenant_id: T, ziel_weinausbau_id: B, aktiv: false, erstellt_am: SPAETER },
    ],
  })

  test('zählt je Art in fester Reihenfolge; eigene Zeilen, ältere und fremde Buchungen zählen nicht', async () => {
    const db = datenbank(alleArten())
    const f = await s.spaetereMengenbewegungen(db, T, B, ZEIT, { umzugZeilenIds: ['eigen'] })
    assert.deepEqual(f, [
      { art: 'umzug', anzahl: 2 },             // Batch b-x einmal, u3 ohne Batch einzeln
      { art: 'schwund', anzahl: 2 },           // u4 und u5 (ohne Zeitstempel = später)
      { art: 'verschnitt_quelle', anzahl: 2 }, // vq1 einmal, vq-ohne (kein Zeitstempel)
      { art: 'verschnitt_ziel', anzahl: 1 },   // vz1: gleicher Zeitpunkt zählt als später (>=)
      { art: 'fuellung', anzahl: 2 },          // f1 aus beiden Quellen einmal, f2
      { art: 'tankverkauf', anzahl: 1 },       // je Posten, stornierte nicht
      { art: 'zukauf_ziel', anzahl: 1 },
    ])
    assert.deepEqual(ohneMandant(db, T, OHNE_VERSCHNITT), [])
    const umz = db.aufrufe.find(a => a.tabelle === 'keller_umzuege')
    assert.ok(hatFilter(umz, 'or', `von_weinausbau_id.eq.${B},nach_weinausbau_id.eq.${B}`))
    const vq = db.aufrufe.find(a => a.tabelle === 'verschneidung_quellen')
    assert.ok(!hatFilter(vq, 'eq', 'tenant_id'), 'verschneidung_quellen ohne Mandantenfilter (keine tenant_id-Spalte)')
  })

  test('ohne Zeitstempel der Buchung zählt jede Bewegung (sichere Richtung); eigener Verschnitt ausgenommen', async () => {
    const db = datenbank(alleArten())
    const f = await s.spaetereMengenbewegungen(db, T, B, null, { verschneidungId: 'vz1' })
    assert.deepEqual(f.find(x => x.art === 'umzug'), { art: 'umzug', anzahl: 4 })  // b-x, u3, b-alt, eigen
    assert.deepEqual(f.find(x => x.art === 'verschnitt_quelle'), { art: 'verschnitt_quelle', anzahl: 3 })
    assert.deepEqual(f.find(x => x.art === 'verschnitt_ziel'), { art: 'verschnitt_ziel', anzahl: 1 }, 'nur vz-alt')
  })

  test('unlesbarer Zeitstempel der Buchung wirkt wie „keiner“', async () => {
    const f = await s.spaetereMengenbewegungen(datenbank(alleArten()), T, B, 'kein Datum')
    assert.deepEqual(f.find(x => x.art === 'umzug'), { art: 'umzug', anzahl: 4 })
  })

  test('nichts erfasst: leere Liste', async () => {
    assert.deepEqual(await s.spaetereMengenbewegungen(datenbank({}), T, B, ZEIT), [])
  })

  test('ungültige Chargen-ID: Fehler ohne Datenbankzugriff', async () => {
    const db = datenbank({})
    const e = await fehlerVon(s.spaetereMengenbewegungen(db, T, 'charge-1', ZEIT))
    assert.equal(e.message, 'Buchungen der Charge können nicht geprüft werden: ungültige Chargen-ID')
    assert.deepEqual(db.aufrufe, [])
  })

  test('Abfragefehler in einer Tabelle: Fehler mit Tabellenname (nie still 0)', async () => {
    for (const tabelle of ['keller_umzuege', 'verschneidung_quellen', 'verschneidungen', 'fuellung_chargen', 'fuellungen', 'verkauf_positionen', 'zukauf_posten']) {
      const e = await fehlerVon(s.spaetereMengenbewegungen(datenbank(alleArten(), { vorher: fehlerBei(tabelle, 'select', { message: 'kaputt' }) }), T, B, ZEIT))
      assert.equal(e.message, `Buchungen der Charge konnten nicht geprüft werden (${tabelle}): kaputt`)
    }
  })
})

// ── Umzug laden ───────────────────────────────────────────────────────────────

describe('ladeUmzugZeilen', nurMitHooks, () => {
  test('ganzer Batch, sortiert nach Erfassung und ID; fremde Zeilen im Batch nicht', async () => {
    const t = umzugTabellen()
    t.keller_umzuege.push(umzugZeile(uuid(10), { zeilen_typ: 'ziel', erstellt_am: ZEIT }))
    t.keller_umzuege.push(umzugZeile(uuid(9), { tenant_id: FREMD }))
    t.keller_umzuege.push(umzugZeile(uuid(8), { umzug_batch_id: 'anderer' }))
    const db = datenbank(t)
    const z = await s.ladeUmzugZeilen(db, T, uuid(12))
    assert.deepEqual(z.map(r => r.id), [uuid(10), uuid(11), uuid(12)])
    assert.deepEqual(ohneMandant(db, T), [])
  })

  test('Zeile ohne Batch: nur sie selbst; unbekannt oder fremd: null', async () => {
    const db = datenbank({ keller_umzuege: [umzugZeile('allein', { umzug_batch_id: null }), umzugZeile('fremd', { tenant_id: FREMD })] })
    assert.deepEqual((await s.ladeUmzugZeilen(db, T, 'allein')).map(r => r.id), ['allein'])
    assert.equal(await s.ladeUmzugZeilen(db, T, 'fremd'), null)
    assert.equal(await s.ladeUmzugZeilen(db, T, 'gibt-es-nicht'), null)
  })

  test('Lesefehler im ersten oder zweiten Schritt', async () => {
    let e = await fehlerVon(s.ladeUmzugZeilen(datenbank(umzugTabellen(), { vorher: fehlerBei('keller_umzuege', 'select', { message: 'a' }) }), T, uuid(11)))
    assert.equal(e.message, 'Umzug konnte nicht geladen werden: a')
    e = await fehlerVon(s.ladeUmzugZeilen(datenbank(umzugTabellen(), { vorher: fehlerBei('keller_umzuege', 'select', { message: 'b' }, 2) }), T, uuid(11)))
    assert.equal(e.message, 'Umzug konnte nicht geladen werden: b')
  })
})

// ── Umzug planen ──────────────────────────────────────────────────────────────

describe('planeUmzugStorno – Umzug', nurMitHooks, () => {
  test('Normalfall: Quelle bekommt brutto zurück (inkl. Schwund), Ziel gibt netto ab und wird abgeschlossen; Zugänge zuerst', async () => {
    const db = datenbank(umzugTabellen())
    const plan = await s.planeUmzugStorno(db, T, db.tabellen.keller_umzuege)
    assert.equal(plan.sperre, null)
    assert.equal(plan.istSchwund, false)
    assert.equal(plan.batchId, 'batch-1')
    assert.equal(plan.datum, '2026-09-20')
    assert.deepEqual(plan.aenderungen.map(({ id, vorher, neu, payload }) => ({ id, vorher, neu, payload })), [
      { id: A, vorher: 495, neu: 1000, payload: { menge_liter: 1000 } },
      { id: B, vorher: 500, neu: 0, payload: { menge_liter: 0, aktiv: false, status: 'abgeschlossen' } },
    ])
    assert.deepEqual(schreibzugriffe(db), [], 'Planen schreibt nichts')
    assert.deepEqual(ohneMandant(db, T, OHNE_VERSCHNITT), [])
    assert.equal(db.aufrufe.filter(a => a.tabelle === 'keller_umzuege').length, 1,
      'Befund: nur das Ziel wird auf spätere Bewegungen geprüft, die Quelle nicht (eigener Test unten)')
  })

  test('Befund: spätere Bewegungen an der QUELL-Charge sperren nicht – sie bekommt ihre Liter trotzdem zurück', async () => {
    const t = umzugTabellen()
    t.fuellungen = [{ id: 'fq', tenant_id: T, weinausbau_id: A, aktiv: true, erstellt_am: SPAETER }]
    const db = datenbank(t)
    const plan = await s.planeUmzugStorno(db, T, t.keller_umzuege)
    assert.equal(plan.sperre, null)
    assert.equal(plan.aenderungen.find(a => a.id === A).neu, 1000)
    const fuell = db.aufrufe.filter(a => a.tabelle === 'fuellungen')
    assert.deepEqual(fuell.map(a => a.filter.find(f => f[1] === 'weinausbau_id')?.[2]), [B], 'nur die Ziel-Charge wird abgefragt')
    // Gegenprobe: dieselbe Füllung am Ziel sperrt
    t.fuellungen[0].weinausbau_id = B
    assert.match((await s.planeUmzugStorno(datenbank(t), T, t.keller_umzuege)).sperre.grund, /weiterbewegt wurde \(1 Füllung\)/)
  })

  test('Quelle ohne brutto_liter: menge_liter zählt; abgeschlossene Quelle wird reaktiviert', async () => {
    const t = umzugTabellen()
    t.weinausbau[0] = charge(A, 'Welschriesling Tank 1', { menge_liter: 0, aktiv: false, status: 'abgeschlossen' })
    t.keller_umzuege[0].brutto_liter = null
    t.keller_umzuege[0].menge_liter = 500
    const plan = await s.planeUmzugStorno(datenbank(t), T, t.keller_umzuege)
    assert.deepEqual(plan.aenderungen[0].payload, { menge_liter: 500, aktiv: true, status: 'ausbau' })
  })

  test('Ziel seither weiterbewegt (spätere Füllung): Sperre mit Grund und Gegenbuchungs-Hinweis', async () => {
    const t = umzugTabellen()
    t.fuellungen = [{ id: 'f1', tenant_id: T, weinausbau_id: B, aktiv: true, erstellt_am: SPAETER }]
    const plan = await s.planeUmzugStorno(datenbank(t), T, t.keller_umzuege)
    assert.deepEqual(plan.sperre, {
      grund: 'die Ziel-Charge „Welschriesling Tank 2“ seither weiterbewegt wurde (1 Füllung)',
      hinweis: s.GEGENBUCHUNG_HINWEIS,
    })
    assert.deepEqual(plan.aenderungen, [])
    assert.equal(s.umzugSperrMeldung(plan, 'stornieren'),
      'Der Umzug vom 20.09.2026 ist nicht mehr stornierbar, weil die Ziel-Charge „Welschriesling Tank 2“ seither weiterbewegt wurde (1 Füllung). Bitte die Korrektur als Gegenbuchung erfassen (Umzug zurück bzw. „Schwund buchen“ auf der Chargen-Seite).')
  })

  test('ältere Füllung am Ziel sperrt nicht – außer der Umzug hat eine Zeile ohne Zeitstempel', async () => {
    const t = umzugTabellen()
    t.fuellungen = [{ id: 'f0', tenant_id: T, weinausbau_id: B, aktiv: true, erstellt_am: FRUEHER }]
    assert.equal((await s.planeUmzugStorno(datenbank(t), T, t.keller_umzuege)).sperre, null)
    t.keller_umzuege[1].erstellt_am = null
    assert.match((await s.planeUmzugStorno(datenbank(t), T, t.keller_umzuege)).sperre.grund, /weiterbewegt wurde \(1 Füllung\)/)
  })

  test('Ziel hat weniger als zurückzubuchen: Sperre, kein Kappen bei 0', async () => {
    const t = umzugTabellen()
    t.weinausbau[1].menge_liter = 300
    const plan = await s.planeUmzugStorno(datenbank(t), T, t.keller_umzuege)
    assert.equal(plan.sperre.grund, 'die Ziel-Charge „Welschriesling Tank 2“ nur noch 300,00 L Bestand hat, zurückzubuchen wären 500,00 L')
    assert.deepEqual(plan.aenderungen, [])
  })

  test('Befund: bis 0,01 L Fehlmenge am Ziel wird still auf 0 gekappt (Toleranz)', async () => {
    const t = umzugTabellen()
    t.weinausbau[1].menge_liter = 499.995
    const plan = await s.planeUmzugStorno(datenbank(t), T, t.keller_umzuege)
    assert.equal(plan.sperre, null)
    assert.deepEqual(plan.aenderungen[1].payload, { menge_liter: 0, aktiv: false, status: 'abgeschlossen' })
  })

  test('altes Zeilenformat (ohne quelle/ziel): Sperre, keine Datenbankabfrage', async () => {
    const db = datenbank({})
    const plan = await s.planeUmzugStorno(db, T, [umzugZeile('alt', { von_weinausbau_id: A, nach_weinausbau_id: B, menge_liter: 100 })])
    assert.equal(plan.sperre.grund, 'es eine ältere Umzugsbuchung ohne getrennte Quell- und Zielzeilen ist und die Rückbuchung nicht eindeutig bestimmt werden kann')
    assert.deepEqual(db.aufrufe, [])
  })

  test('Zielzeile ohne Ziel-Charge (netto > 0): Sperre; Zielzeile mit 0 L wird übersprungen', async () => {
    const t = umzugTabellen()
    t.keller_umzuege[1].nach_weinausbau_id = null
    assert.equal((await s.planeUmzugStorno(datenbank(t), T, t.keller_umzuege)).sperre.grund, 'die Ziel-Charge in der Buchung fehlt')
    t.keller_umzuege[1].menge_liter = 0
    const plan = await s.planeUmzugStorno(datenbank(t), T, t.keller_umzuege)
    assert.equal(plan.sperre, null)
    assert.deepEqual(plan.aenderungen.map(a => a.id), [A], 'nur die Quelle bekommt Liter zurück')
  })

  test('beteiligte Charge fehlt (gelöscht oder anderer Mandant): Sperre', async () => {
    const t = umzugTabellen()
    t.weinausbau[1].tenant_id = FREMD
    const plan = await s.planeUmzugStorno(datenbank(t), T, t.keller_umzuege)
    assert.equal(plan.sperre.grund, 'eine beteiligte Charge nicht (mehr) gefunden wurde')
  })

  test('Chargen nicht ladbar: Fehler', async () => {
    const e = await fehlerVon(s.planeUmzugStorno(datenbank(umzugTabellen(), { vorher: fehlerBei('weinausbau', 'select', { message: 'x' }) }), T, umzugTabellen().keller_umzuege))
    assert.equal(e.message, 'Chargen konnten nicht geladen werden: x')
  })

  test('Qualitäts-Abstufung einer zusammengeführten Ziel-Charge wird zurückgenommen, wenn beide Vermerke passen', async () => {
    const t = umzugTabellen()
    t.weinausbau[1] = charge(B, 'Welschriesling Tank 2', {
      menge_liter: 800, qualitaetsstufe: 'landwein',
      notizen: 'Lese 2025\nAbstufung von Qualitätswein auf Landwein (Zusammenführung per Umziehen)',
    })
    t.keller_umzuege[1].notizen = 'Abstufung von Qualitätswein auf Landwein'
    let plan = await s.planeUmzugStorno(datenbank(t), T, t.keller_umzuege)
    assert.deepEqual(plan.aenderungen[1].payload, { menge_liter: 300, qualitaetsstufe: 'qualitaetswein' })

    // Vermerk fehlt an der Charge bzw. Charge steht nicht mehr auf der abgestuften Stufe: Qualität bleibt
    t.weinausbau[1].notizen = null
    plan = await s.planeUmzugStorno(datenbank(t), T, t.keller_umzuege)
    assert.deepEqual(plan.aenderungen[1].payload, { menge_liter: 300 })
    t.weinausbau[1].notizen = 'Abstufung von Qualitätswein auf Landwein (Zusammenführung per Umziehen)'
    t.weinausbau[1].qualitaetsstufe = 'wein'
    plan = await s.planeUmzugStorno(datenbank(t), T, t.keller_umzuege)
    assert.deepEqual(plan.aenderungen[1].payload, { menge_liter: 300 })
  })

  test('Abstufung wird nicht angefasst, wenn das Ziel durch den Storno leer wird', async () => {
    const t = umzugTabellen()
    t.weinausbau[1].qualitaetsstufe = 'landwein'
    t.weinausbau[1].notizen = 'Abstufung von Qualitätswein auf Landwein (Zusammenführung per Umziehen)'
    t.keller_umzuege[1].notizen = 'Abstufung von Qualitätswein auf Landwein'
    const plan = await s.planeUmzugStorno(datenbank(t), T, t.keller_umzuege)
    assert.deepEqual(plan.aenderungen[1].payload, { menge_liter: 0, aktiv: false, status: 'abgeschlossen' })
  })
})

// ── Umzug ausführen ───────────────────────────────────────────────────────────

describe('storniereUmzug – Rückbuchung und Löschen, alles oder nichts', nurMitHooks, () => {
  const geplant = async (t = umzugTabellen(), opt) => {
    const db = datenbank(t, opt)
    const plan = await s.planeUmzugStorno(db, T, t.keller_umzuege)
    db.aufrufe.length = 0
    return { db, plan }
  }

  test('Normalfall: erst Quelle, dann Ziel (Vergleichen und Setzen), dann alle Zeilen der Buchung löschen', async () => {
    const { db, plan } = await geplant()
    await s.storniereUmzug(db, T, plan)
    assert.deepEqual(zugriffe(db), ['update weinausbau', 'update weinausbau', 'delete keller_umzuege'])
    assert.ok(hatFilter(db.aufrufe[0], 'gte', 'menge_liter', 495 - 0.001) && hatFilter(db.aufrufe[0], 'lte', 'menge_liter', 495 + 0.001))
    assert.deepEqual(db.aufrufe[2].filter.find(f => f[0] === 'in'), ['in', 'id', [uuid(11), uuid(12)]])
    assert.deepEqual(mengen(db), { 'Welschriesling Tank 1': 1000, 'Welschriesling Tank 2': 0 })
    assert.equal(zeile(db, 'weinausbau', B).aktiv, false)
    assert.deepEqual(db.tabellen.keller_umzuege, [])
    assert.deepEqual(ohneMandant(db, T), [])
  })

  test('gesperrter Plan: Sperrmeldung, nichts geschrieben', async () => {
    const t = umzugTabellen()
    t.weinausbau[1].menge_liter = 300
    const { db, plan } = await geplant(t)
    const e = await fehlerVon(s.storniereUmzug(db, T, plan))
    assert.match(e.message, /^Der Umzug vom 20\.09\.2026 ist nicht mehr stornierbar, weil die Ziel-Charge/)
    assert.deepEqual(db.aufrufe, [])
  })

  test('Quelle inzwischen geändert (Vergleich greift nicht): Abbruch vor jeder Änderung', async () => {
    const { db, plan } = await geplant()
    zeile(db, 'weinausbau', A).menge_liter = 490
    const e = await fehlerVon(s.storniereUmzug(db, T, plan))
    assert.equal(e.message, 'Rückbuchung auf die Charge „Welschriesling Tank 1“ fehlgeschlagen: Der Bestand der Charge wurde inzwischen geändert (oder es fehlt die Berechtigung) – bitte Seite neu laden und erneut versuchen. Es wurde nichts geändert.')
    assert.deepEqual(zugriffe(db), ['update weinausbau'])
    assert.equal(db.tabellen.keller_umzuege.length, 2)
  })

  test('Fehler beim Ziel: reaktivierte Quelle wird samt aktiv/Status zurückgesetzt', async () => {
    const t = umzugTabellen()
    t.weinausbau[0] = charge(A, 'Welschriesling Tank 1', { menge_liter: 0, aktiv: false, status: 'abgeschlossen' })
    t.keller_umzuege[0].brutto_liter = 500
    const { db, plan } = await geplant(t, { vorher: fehlerBei('weinausbau', 'update', { message: 'boom' }, 2) })
    const e = await fehlerVon(s.storniereUmzug(db, T, plan))
    assert.equal(e.message, 'Rückbuchung auf die Charge „Welschriesling Tank 2“ fehlgeschlagen: boom. Es wurde nichts geändert.')
    assert.deepEqual(zugriffe(db), ['update weinausbau', 'update weinausbau', 'update weinausbau'])
    assert.deepEqual(db.aufrufe[2].werte, { menge_liter: 0, aktiv: false, status: 'abgeschlossen' })
    const a = zeile(db, 'weinausbau', A)
    assert.deepEqual([a.menge_liter, a.aktiv, a.status], [0, false, 'abgeschlossen'])
    assert.equal(db.tabellen.keller_umzuege.length, 2)
  })

  test('Gebinde-Trigger (P0001) beim Reaktivieren: Meldung ab „Gebinde …“', async () => {
    const t = umzugTabellen()
    t.weinausbau[0] = charge(A, 'Welschriesling Tank 1', { menge_liter: 0, aktiv: false, status: 'abgeschlossen' })
    const { db, plan } = await geplant(t, { vorher: fehlerBei('weinausbau', 'update', { code: 'P0001', message: 'Trigger: Gebinde „T1“ ist durch Weingut Nachbar belegt.' }) })
    const e = await fehlerVon(s.storniereUmzug(db, T, plan))
    assert.equal(e.message, 'Gebinde „T1“ ist durch Weingut Nachbar belegt. Es wurde nichts geändert.')
  })

  test('Löschen scheitert: beide Rückbuchungen zurückgenommen, Buchung bleibt', async () => {
    const { db, plan } = await geplant(umzugTabellen(), { vorher: fehlerBei('keller_umzuege', 'delete', { message: 'fk' }) })
    const e = await fehlerVon(s.storniereUmzug(db, T, plan))
    assert.equal(e.message, 'Löschen fehlgeschlagen (keller_umzuege): fk. Es wurde nichts geändert.')
    assert.deepEqual(zugriffe(db), ['update weinausbau', 'update weinausbau', 'delete keller_umzuege', 'update weinausbau', 'update weinausbau'])
    assert.deepEqual(mengen(db), { 'Welschriesling Tank 1': 495, 'Welschriesling Tank 2': 500 })
    assert.equal(zeile(db, 'weinausbau', B).aktiv, true)
    assert.equal(zeile(db, 'weinausbau', B).status, 'ausbau')
  })

  test('Löschen ohne Treffer (keine Berechtigung): zurückgenommen, eigene Meldung', async () => {
    const { db, plan } = await geplant(umzugTabellen(), { rls: e => !(e.tabelle === 'keller_umzuege' && e.art === 'delete') })
    const e = await fehlerVon(s.storniereUmzug(db, T, plan))
    assert.equal(e.message, 'Die Buchung konnte nicht gelöscht werden – vermutlich fehlt die Berechtigung. Es wurde nichts geändert.')
    assert.deepEqual(mengen(db), { 'Welschriesling Tank 1': 495, 'Welschriesling Tank 2': 500 })
  })

  test('nur teilweise gelöscht: Fehler OHNE Rücknahme – Bestände bleiben zurückgebucht', async () => {
    const { db, plan } = await geplant(umzugTabellen(), { rls: (e, r) => !(e.art === 'delete' && r.id === uuid(12)) })
    const e = await fehlerVon(s.storniereUmzug(db, T, plan))
    assert.equal(e.message, 'Die Buchung wurde nur teilweise gelöscht (gleichzeitige Änderung?) – die Bestände wurden bereits zurückgebucht. Bitte Support kontaktieren.')
    assert.deepEqual(mengen(db), { 'Welschriesling Tank 1': 1000, 'Welschriesling Tank 2': 0 })
    assert.deepEqual(db.tabellen.keller_umzuege.map(r => r.id), [uuid(12)])
  })

  test('Löschen scheitert und eine Rücknahme auch: „Achtung“-Meldung nennt die Charge', async () => {
    const { db, plan } = await geplant(umzugTabellen(), {
      vorher: (e, t) => {
        if (e.tabelle === 'keller_umzuege' && e.art === 'delete') {
          t.weinausbau.find(c => c.id === A).menge_liter = 999 // gleichzeitige Buchung an der Quelle
          return { error: { message: 'fk' } }
        }
        return null
      },
    })
    const e = await fehlerVon(s.storniereUmzug(db, T, plan))
    assert.equal(e.message, 'Löschen fehlgeschlagen (keller_umzuege): fk. Achtung: Bereits zurückgebuchte Chargen konnten nicht zurückgesetzt werden („Welschriesling Tank 1“: inzwischen geändert) – bitte die Bestände prüfen und Support kontaktieren.')
    assert.deepEqual(mengen(db), { 'Welschriesling Tank 1': 999, 'Welschriesling Tank 2': 500 })
  })

  test('Rücknahme mit DB-Fehler: Fehlertext je Charge', async () => {
    const f1 = fehlerBei('keller_umzuege', 'delete', { message: 'fk' })
    const f2 = fehlerBei('weinausbau', 'update', { message: 'weg' }, 3)
    const { db, plan } = await geplant(umzugTabellen(), { vorher: (e, t) => f1(e, t) ?? f2(e, t) })
    const e = await fehlerVon(s.storniereUmzug(db, T, plan))
    assert.equal(e.message, 'Löschen fehlgeschlagen (keller_umzuege): fk. Achtung: Bereits zurückgebuchte Chargen konnten nicht zurückgesetzt werden („Welschriesling Tank 2“: weg) – bitte die Bestände prüfen und Support kontaktieren.')
  })

  test('fuehreRueckbuchungAus und rueckbuchungZuruecknehmen mit leerer Liste: kein Zugriff', async () => {
    const db = datenbank({})
    assert.deepEqual(await s.fuehreRueckbuchungAus(db, T, []), [])
    assert.deepEqual(await s.rueckbuchungZuruecknehmen(db, T, []), [])
    assert.deepEqual(db.aufrufe, [])
  })
})

// ── Schwund ───────────────────────────────────────────────────────────────────

describe('planeUmzugStorno – Schwundbuchung', nurMitHooks, () => {
  const SW_ZEIT = '2026-09-22T08:00:00.000Z'
  const swZeile = teil => umzugZeile(uuid(21), { datum: '2026-09-22', erstellt_am: SW_ZEIT, umzug_typ: 'schwund', umzug_batch_id: null, von_weinausbau_id: S, menge_liter: 5, schwund_liter: 5, ...teil })
  const prot = (alt, neu, teil) => ({
    id: 'bp1', tenant_id: T, tabelle: 'weinausbau', datensatz_id: S, aktion: 'UPDATE', erstellt_am: SW_ZEIT,
    geaenderte_spalten: ['menge_liter', 'updated_at'], alt, neu, ...teil,
  })
  const tabellen = (teil = {}) => ({
    weinausbau: [charge(S, 'Muskateller', { menge_liter: 95 })],
    keller_umzuege: [swZeile()],
    bestandsprotokoll: [prot({ menge_liter: 100, aktiv: true, status: 'ausbau' }, { menge_liter: 95, aktiv: true, status: 'ausbau' })],
    ...teil,
  })
  const plane = async (t, opt) => {
    const db = datenbank(t, opt)
    return { db, plan: await s.planeUmzugStorno(db, T, t.keller_umzuege) }
  }

  test('Normalfall: protokollierte Minderung zurück; Storno bucht zurück und löscht die Zeile', async () => {
    const { db, plan } = await plane(tabellen())
    assert.equal(plan.istSchwund, true)
    assert.equal(plan.sperre, null)
    assert.deepEqual(plan.aenderungen.map(({ id, vorher, neu, payload }) => ({ id, vorher, neu, payload })), [
      { id: S, vorher: 95, neu: 100, payload: { menge_liter: 100, aktiv: true, status: 'ausbau' } },
    ])
    const p = db.aufrufe.find(a => a.tabelle === 'bestandsprotokoll')
    for (const [art, k, v] of [['eq', 'tenant_id', T], ['eq', 'tabelle', 'weinausbau'], ['eq', 'datensatz_id', S], ['eq', 'aktion', 'UPDATE'], ['eq', 'erstellt_am', SW_ZEIT], ['contains', 'geaenderte_spalten', ['menge_liter']]]) {
      assert.ok(hatFilter(p, art, k, v), `${art} ${k}`)
    }
    assert.deepEqual(ohneMandant(db, T, OHNE_VERSCHNITT), [])
    db.aufrufe.length = 0
    await s.storniereUmzug(db, T, plan)
    assert.deepEqual(zugriffe(db), ['update weinausbau', 'delete keller_umzuege'])
    assert.equal(zeile(db, 'weinausbau', S).menge_liter, 100)
    assert.deepEqual(db.tabellen.keller_umzuege, [])
    assert.equal(s.nurNotizenAenderbar(plan), true, 'Menge/Datum eines Schwunds nie änderbar')
  })

  test('Schwund hat die Charge geleert: aktiv/Status aus dem Protokoll zurück', async () => {
    const t = tabellen({
      weinausbau: [charge(S, 'Muskateller', { menge_liter: 0, aktiv: false, status: 'abgeschlossen' })],
      bestandsprotokoll: [prot({ menge_liter: 5, aktiv: true, status: 'gaerung' }, { menge_liter: 0, aktiv: false, status: 'abgeschlossen' })],
    })
    const { plan } = await plane(t)
    assert.deepEqual(plan.aenderungen[0].payload, { menge_liter: 5, aktiv: true, status: 'gaerung' })
  })

  test('Protokoll ohne aktiv/Status, Charge inaktiv und abgeschlossen: wird mit Bestand wieder aktiv/„ausbau“', async () => {
    const t = tabellen({
      weinausbau: [charge(S, 'Muskateller', { menge_liter: '0.00', aktiv: false, status: 'abgeschlossen' })],
      bestandsprotokoll: [prot({ menge_liter: '5.00' }, { menge_liter: '0.00' })],
    })
    const { plan } = await plane(t)
    assert.deepEqual(plan.aenderungen[0].payload, { menge_liter: 5, aktiv: true, status: 'ausbau' })
  })

  test('kein oder mehrdeutiger Protokolleintrag (Nachbuchung, Altbuchung, keine Leseberechtigung): Sperre', async () => {
    const grund = 'nicht nachvollziehbar ist, dass sie den Bestand der Charge gemindert hat (Nachbuchung ins Bewegungsbuch, Buchung vor dem 24.09.2026 oder keine Leseberechtigung für das Bestandsprotokoll – das dürfen nur Betriebs-Manager)'
    let { plan } = await plane(tabellen({ bestandsprotokoll: [] }))
    assert.equal(plan.sperre.grund, grund)
    assert.equal(plan.sperre.hinweis, `Schwund bleibt als datierte Buchung im Bewegungsbuch. ${h.KORREKTUR_NACH_OBEN_HINWEIS}`)
    const zwei = tabellen()
    zwei.bestandsprotokoll.push({ ...zwei.bestandsprotokoll[0], id: 'bp2' })
    ;({ plan } = await plane(zwei))
    assert.equal(plan.sperre.grund, grund)
    ;({ plan } = await plane(tabellen({ bestandsprotokoll: [prot({ menge_liter: 100 }, { menge_liter: 95 }, { erstellt_am: '2026-09-22T08:00:00.001Z' })] })))
    assert.equal(plan.sperre.grund, grund, 'Zeitstempel muss exakt gleich sein')
    assert.equal(s.umzugSperrMeldung(plan, 'stornieren'), `Die Schwundbuchung vom 22.09.2026 kann nicht storniert werden, weil ${grund}. Schwund bleibt als datierte Buchung im Bewegungsbuch. ${h.KORREKTUR_NACH_OBEN_HINWEIS}`)
  })

  test('Protokoll nicht lesbar: Sperre mit Fehlertext (kein Fehler)', async () => {
    const { plan } = await plane(tabellen(), { vorher: fehlerBei('bestandsprotokoll', 'select', { message: 'permission denied for table bestandsprotokoll' }) })
    assert.equal(plan.sperre.grund, 'das Bestandsprotokoll nicht gelesen werden konnte (Keine Berechtigung für „bestandsprotokoll“)')
  })

  test('Minderung unter 0,01 L bzw. Erhöhung: Sperre', async () => {
    for (const neu of [99.995, 101]) {
      const { plan } = await plane(tabellen({ bestandsprotokoll: [prot({ menge_liter: 100 }, { menge_liter: neu })] }))
      assert.equal(plan.sperre.grund, 'sie den Bestand der Charge laut Protokoll nicht gemindert hat')
    }
  })

  test('mehrere Zeilen, keine Charge, ungültige Charge oder fehlender Zeitstempel: „keiner Charge eindeutig zugeordnet“', async () => {
    const faelle = [
      [swZeile(), swZeile({ id: uuid(22) })],
      [swZeile({ von_weinausbau_id: null })],
      [swZeile({ von_weinausbau_id: 'keine-uuid' })],
      [swZeile({ erstellt_am: null })],
    ]
    for (const zeilen of faelle) {
      const db = datenbank(tabellen())
      const plan = await s.planeUmzugStorno(db, T, zeilen)
      assert.equal(plan.sperre.grund, 'sie keiner Charge eindeutig zugeordnet ist')
      assert.deepEqual(db.aufrufe, [])
    }
  })

  test('an der Charge seither weitergebucht: Sperre mit Aufzählung', async () => {
    const t = tabellen()
    t.keller_umzuege.push(swZeile({ id: uuid(23), erstellt_am: '2026-09-23T08:00:00.000Z' }))
    t.zukauf_posten = [{ id: 'zk', tenant_id: T, ziel_weinausbau_id: S, aktiv: true, erstellt_am: '2026-09-23T09:00:00.000Z' }]
    const plan = await s.planeUmzugStorno(datenbank(t), T, [t.keller_umzuege[0]])
    assert.equal(plan.sperre.grund, 'an der Charge seither weitergebucht wurde (1 Schwundbuchung und 1 Zukauf)')
  })

  test('Bestand seither geändert (ohne erfasste Buchung): Sperre mit beiden Werten', async () => {
    const { plan } = await plane(tabellen({ weinausbau: [charge(S, 'Muskateller', { menge_liter: 90 })] }))
    assert.equal(plan.sperre.grund, 'sich der Bestand der Charge seither geändert hat (90,00 L statt 95,00 L)')
  })

  test('Charge fehlt: Sperre; Charge nicht ladbar: Fehler', async () => {
    let { plan } = await plane(tabellen({ weinausbau: [] }))
    assert.equal(plan.sperre.grund, 'die Charge nicht (mehr) gefunden wurde')
    const e = await fehlerVon(plane(tabellen(), { vorher: fehlerBei('weinausbau', 'select', { message: 'x' }) }))
    assert.equal(e.message, 'Charge konnte nicht geladen werden: x')
  })
})

// ── Verschnitt ────────────────────────────────────────────────────────────────

describe('planeVerschneidungStorno / storniereVerschneidung', nurMitHooks, () => {
  const V_ZEIT = '2026-09-23T09:00:00.000Z'
  const tabellen = (teil = {}) => ({
    weinausbau: [
      charge(V1, 'Zweigelt', { menge_liter: 0, aktiv: false, status: 'abgeschlossen' }),
      charge(V2, 'Blaufränkisch'),
      charge(Z, 'Cuvée Rot', { menge_liter: 500, qualitaetsstufe: 'landwein', herkunft_code: 'AT' }),
    ],
    verschneidungen: [{
      id: VS, tenant_id: T, datum: '2026-09-23', created_at: V_ZEIT, ziel_weinausbau_id: Z,
      ziel_qualitaet_vorher: 'qualitaetswein', ziel_herkunft_code_vorher: 'AT-NOE',
      quellen: [{ quell_weinausbau_id: V1, menge_liter: 300 }, { quell_weinausbau_id: V2, menge_liter: '200' }],
    }],
    verschneidung_quellen: [
      { verschneidung_id: VS, quell_weinausbau_id: V1, menge_liter: 300, verschneidung: { created_at: V_ZEIT } },
      { verschneidung_id: VS, quell_weinausbau_id: V2, menge_liter: 200, verschneidung: { created_at: V_ZEIT } },
    ],
    ...teil,
  })

  test('Normalfall: Quellen zurück (V1 reaktiviert), Ziel leer mit Qualität/Herkunft aus dem Snapshot; dann löschen', async () => {
    const db = datenbank(tabellen())
    const plan = await s.planeVerschneidungStorno(db, T, VS)
    assert.equal(plan.sperre, null)
    assert.equal(plan.datum, '2026-09-23')
    assert.deepEqual(plan.aenderungen.map(({ id, vorher, neu, payload }) => ({ id, vorher, neu, payload })), [
      { id: V1, vorher: 0, neu: 300, payload: { menge_liter: 300, aktiv: true, status: 'ausbau' } },
      { id: V2, vorher: 100, neu: 300, payload: { menge_liter: 300 } },
      { id: Z, vorher: 500, neu: 0, payload: { menge_liter: 0, aktiv: false, status: 'abgeschlossen', qualitaetsstufe: 'qualitaetswein', herkunft_code: 'AT-NOE' } },
    ])
    assert.deepEqual(ohneMandant(db, T, OHNE_VERSCHNITT), [])
    db.aufrufe.length = 0
    await s.storniereVerschneidung(db, T, plan)
    assert.deepEqual(zugriffe(db), ['update weinausbau', 'update weinausbau', 'update weinausbau', 'delete verschneidungen'])
    assert.deepEqual(mengen(db), { Zweigelt: 300, Blaufränkisch: 300, 'Cuvée Rot': 0 })
    assert.equal(zeile(db, 'weinausbau', Z).qualitaetsstufe, 'qualitaetswein')
    assert.deepEqual(db.tabellen.verschneidungen, [])
    assert.equal(db.tabellen.verschneidung_quellen.length, 2, 'Quellzeilen entfernt die DB per ON DELETE CASCADE, nicht der Code')
  })

  test('Befund: ohne Snapshot (Ziel hatte vorher keine Qualitätsstufe) bleibt die Verschnitt-Qualität am Ziel stehen', async () => {
    const t = tabellen()
    t.weinausbau[2].menge_liter = 800 // Ziel hatte vorher 300 L
    t.verschneidungen[0].ziel_qualitaet_vorher = null
    t.verschneidungen[0].ziel_herkunft_code_vorher = null
    const plan = await s.planeVerschneidungStorno(datenbank(t), T, VS)
    assert.deepEqual(plan.aenderungen.find(a => a.id === Z).payload, { menge_liter: 300 })
  })

  test('Befund: Verschnitt ohne Quellmengen – keine Rückbuchung, keine Snapshot-Wiederherstellung, Storno löscht nur', async () => {
    const t = tabellen()
    t.verschneidungen[0].quellen = [{ quell_weinausbau_id: V1, menge_liter: 0 }, { quell_weinausbau_id: null, menge_liter: 50 }]
    const db = datenbank(t)
    const plan = await s.planeVerschneidungStorno(db, T, VS)
    assert.deepEqual(plan, { verschneidung: plan.verschneidung, datum: '2026-09-23', sperre: null, aenderungen: [] })
    db.aufrufe.length = 0
    await s.storniereVerschneidung(db, T, plan)
    assert.deepEqual(zugriffe(db), ['delete verschneidungen'])
    assert.equal(zeile(db, 'weinausbau', Z).qualitaetsstufe, 'landwein')
  })

  test('Ziel fehlt: Sperre mit Verschnitt-Hinweis; Meldung', async () => {
    const t = tabellen()
    t.verschneidungen[0].ziel_weinausbau_id = null
    const plan = await s.planeVerschneidungStorno(datenbank(t), T, VS)
    assert.deepEqual(plan.sperre, { grund: 'die Ziel-Charge fehlt', hinweis: s.VERSCHNITT_HINWEIS })
    assert.equal(s.verschneidungSperrMeldung(plan), `Die Verschneidung vom 23.09.2026 ist nicht mehr stornierbar, weil die Ziel-Charge fehlt. ${s.VERSCHNITT_HINWEIS}`)
    assert.equal(s.verschneidungSperrMeldung({ ...plan, sperre: null }), '')
  })

  test('Ziel seither weiterbewegt (spätere Schwundbuchung): Sperre; storniereVerschneidung wirft sie ohne Schreibzugriff', async () => {
    const t = tabellen({ keller_umzuege: [umzugZeile('sw', { umzug_typ: 'schwund', von_weinausbau_id: Z, erstellt_am: '2026-09-24T08:00:00.000Z' })] })
    const db = datenbank(t)
    const plan = await s.planeVerschneidungStorno(db, T, VS)
    assert.equal(plan.sperre.grund, 'die Ziel-Charge „Cuvée Rot“ seither weiterbewegt wurde (1 Schwundbuchung)')
    assert.equal(plan.sperre.hinweis, s.VERSCHNITT_HINWEIS)
    db.aufrufe.length = 0
    const e = await fehlerVon(s.storniereVerschneidung(db, T, plan))
    assert.match(e.message, /^Die Verschneidung vom 23\.09\.2026 ist nicht mehr stornierbar/)
    assert.deepEqual(db.aufrufe, [])
  })

  test('Befund: spätere Bewegungen an einer QUELL-Charge sperren nicht – sie bekommt ihre Liter trotzdem zurück', async () => {
    const t = tabellen({ fuellungen: [{ id: 'f', tenant_id: T, weinausbau_id: V2, aktiv: true, erstellt_am: '2026-09-24T08:00:00.000Z' }] })
    const plan = await s.planeVerschneidungStorno(datenbank(t), T, VS)
    assert.equal(plan.sperre, null)
    assert.equal(plan.aenderungen.find(a => a.id === V2).neu, 300)
  })

  test('nicht gefunden (auch fremder Mandant) bzw. Ladefehler: Fehler', async () => {
    const t = tabellen()
    t.verschneidungen[0].tenant_id = FREMD
    let e = await fehlerVon(s.planeVerschneidungStorno(datenbank(t), T, VS))
    assert.equal(e.message, 'Verschneidung nicht gefunden')
    e = await fehlerVon(s.planeVerschneidungStorno(datenbank(tabellen(), { vorher: fehlerBei('verschneidungen', 'select', { message: 'x' }) }), T, VS))
    assert.equal(e.message, 'Verschneidung konnte nicht geladen werden: x')
  })

  test('Löschen scheitert: alle drei Chargen zurückgesetzt, inkl. Qualität des Ziels', async () => {
    const db = datenbank(tabellen(), { vorher: fehlerBei('verschneidungen', 'delete', { message: 'fk' }) })
    const plan = await s.planeVerschneidungStorno(db, T, VS)
    const e = await fehlerVon(s.storniereVerschneidung(db, T, plan))
    assert.equal(e.message, 'Löschen fehlgeschlagen (verschneidungen): fk. Es wurde nichts geändert.')
    assert.deepEqual(mengen(db), { Zweigelt: 0, Blaufränkisch: 100, 'Cuvée Rot': 500 })
    const z = zeile(db, 'weinausbau', Z)
    assert.deepEqual([z.qualitaetsstufe, z.herkunft_code, z.aktiv, z.status], ['landwein', 'AT', true, 'ausbau'])
    assert.equal(zeile(db, 'weinausbau', V1).aktiv, false)
  })
})
