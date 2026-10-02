// KAN-43 Etappe 1 (02.10.2026) – Weinbestandsmeldung: Bestand zum Stichtag statt am Abrufdatum
//
// Aufruf:  npm run -s test:csv   (alle scripts/tests/*.test.mjs)
//
// 1. bestandAmStichtag(): Rückrechnung heute − Buchungen nach dem Stichtag, vor dem Beginn 0, ungeklärter Rest.
// 2. standardStichtag() / stichtagParameter(): 31.07. des laufenden Weinwirtschaftsjahres, „heute“, Zukunft → 400.
// 3. ladeBestandsmeldung() mit Beispielbewegungen (Pressung, Zukauf, Umzug, Abfüllung, Tankverkauf, Storno-Paar,
//    Flaschenverkauf alt und mit Bewegungszeile, Bruch, stornierte Füllung) → Bestand am 31.07.
// 4. Stichtag heute = Ist-Bestand (aktive Füllungen mit bestand_flaschen > 0, aktive, nicht abgeschlossene Chargen
//    mit menge_liter > 0 – die Logik bis 02.10.2026).
// 5. Mandantenfilter, Register (Parameter, Dateiname, BKI-Jahr), Druckseite (Stichtagsfeld, CSV mit Stichtag).
//
// Zusätzliche Prüfung gegen Staging (nur lesend, NICHT Teil von verify): auf /reports/ama mit „Bestand am“ = heute
// müssen Ausdruck und CSV dieselben Positionen und Mengen zeigen wie die Abfrage
//   select name, menge_liter from weinausbau where tenant_id = '<Musterhof>' and aktiv and status <> 'abgeschlossen' and menge_liter > 0;
//   select name, bestand_flaschen from fuellungen where tenant_id = '<Musterhof>' and aktiv and bestand_flaschen > 0;

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { hooksRegistrieren, laden, nurMitHooks, datenbank, ohneMandant, hatFilter } from './buchung-attrappe.mjs'

hooksRegistrieren()

const quelle = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')
const T = 'tenant-1'
const FREMD = 'tenant-2'
const HEUTE = '2026-10-02'
const STICHTAG = '2026-07-31'

// ── 1./2. reine Funktionen ────────────────────────────────────────────────────

describe('KAN-43 bestandAmStichtag()', nurMitHooks, () => {
  test('heute − Buchungen nach dem Stichtag; Storno-Paar; vor dem Beginn 0', async () => {
    const { bestandAmStichtag } = await laden('lib/behoerden/bestandZum.ts')
    // Zugang 1000 (01.09.2025), Abgang 400 (01.03.2026), Verkauf −50 am 20.07. und Storno +50 am 05.08., Umzug −300 am 15.08.
    const b = [
      { datum: '2025-09-01', menge: 1000 }, { datum: '2026-03-01', menge: -400 },
      { datum: '2026-07-20', menge: -50 }, { datum: '2026-08-05', menge: 50 }, { datum: '2026-08-15', menge: -300 },
    ]
    assert.deepEqual(bestandAmStichtag(300, b, '2026-07-31', '2025-09-01', 2), { bestand: 550, vorBeginn: false, ungeklaert: 0 })
    assert.deepEqual(bestandAmStichtag(300, b, '2026-07-19', '2025-09-01', 2), { bestand: 600, vorBeginn: false, ungeklaert: 0 })
    assert.equal(bestandAmStichtag(300, b, '2026-08-15', '2025-09-01', 2).bestand, 300)   // Ende des Tages: Umzug schon ab
    assert.equal(bestandAmStichtag(300, b, HEUTE, '2025-09-01', 2).bestand, 300)          // heute = Ist
    assert.deepEqual(bestandAmStichtag(300, b, '2025-08-31', '2025-09-01', 2), { bestand: 0, vorBeginn: true, ungeklaert: 0 })
    // Altbestand ohne Zugangsbuchung: 120 l ungeklärt, ab dem Beginn enthalten
    assert.deepEqual(bestandAmStichtag(420, b, '2026-07-31', '2025-09-01', 2), { bestand: 670, vorBeginn: false, ungeklaert: 120 })
    // Buchungen ohne Datum zählen als vor jedem Stichtag
    assert.equal(bestandAmStichtag(10, [{ datum: '', menge: 10 }], '2020-01-01', null, 2).bestand, 10)
    // Gleitkomma: 0,1 + 0,2
    assert.equal(bestandAmStichtag(0.3, [{ datum: '2026-08-01', menge: 0.1 }, { datum: '2026-08-02', menge: 0.2 }], '2026-07-31', null, 2).bestand, 0)
  })

  test('Standard-Stichtag: 31.07. des laufenden Weinwirtschaftsjahres', async () => {
    const { standardStichtag } = await laden('lib/behoerden/bestandZum.ts')
    assert.equal(standardStichtag('2026-10-02'), '2026-07-31')
    assert.equal(standardStichtag('2026-08-01'), '2026-07-31')
    assert.equal(standardStichtag('2026-07-31'), '2025-07-31')
    assert.equal(standardStichtag('2027-01-15'), '2026-07-31')
  })

  test('?stichtag=: leer → Standard, „heute“, gültiges Datum, Zukunft und Unsinn → Parameterfehler', async () => {
    const { stichtagParameter } = await laden('lib/behoerden/bestandsmeldung.ts')
    const { istParameterFehler } = await laden('lib/behoerden/typen.ts')
    const p = q => stichtagParameter(new URLSearchParams(q), HEUTE)
    assert.deepEqual(p(''), { stichtag: '2026-07-31' })
    assert.deepEqual(p('stichtag='), { stichtag: '2026-07-31' })
    assert.deepEqual(p('stichtag=heute'), { stichtag: HEUTE })
    assert.deepEqual(p(`stichtag=${HEUTE}`), { stichtag: HEUTE })
    assert.deepEqual(p('stichtag=2025-07-31'), { stichtag: '2025-07-31' })
    for (const q of ['stichtag=2026-10-03', 'stichtag=2026-02-30', 'stichtag=31.07.2026', 'stichtag=%3DSUM(1)']) {
      assert.ok(istParameterFehler(p(q)), q)
    }
    assert.match(p('stichtag=2026-10-03').fehler, /Zukunft/)
  })
})

// ── 3./4. Ladefunktion mit Beispielbewegungen ────────────────────────────────

const b1 = { name: 'T1' }, b2 = { name: 'T2' }, b3 = { name: 'T3' }
const pressung = (id, datum, tenant = T) => ({ id, datum, notizen: null, tenant_id: tenant, storniert_am: null })

function tabellen() {
  return {
    weinausbau: [
      // GV: Pressung 1000 l, Abfüllung 400 l (f1), Tankverkauf 50 l am 20.07. – am 05.08. storniert → heute 600
      { id: 'w1', tenant_id: T, name: 'GV 25', jahrgang: 2025, rebsorte: 'Grüner Veltliner', qualitaetsstufe: 'qualitaetswein', weinart: 'weiss', menge_liter: 600, status: 'lagerung', aktiv: true, created_at: '2025-09-20T10:00:00Z', behaelter_id: 'b1', behaelter: b1 },
      // ZW: Pressung 800 l, Umzug 300 l nach T3 am 15.08., Tankverkauf 100 l am 01.09. → heute 400, am Stichtag 800
      { id: 'w2', tenant_id: T, name: 'ZW 25', jahrgang: 2025, rebsorte: 'Zweigelt', qualitaetsstufe: 'kabinett', weinart: 'rot', menge_liter: 400, status: 'lagerung', aktiv: true, created_at: '2025-10-01T10:00:00Z', behaelter_id: 'b2', behaelter: b2 },
      // Ziel-Charge des Umzugs (erst ab 15.08.)
      { id: 'w3', tenant_id: T, name: 'ZW 25', jahrgang: 2025, rebsorte: 'Zweigelt', qualitaetsstufe: 'kabinett', weinart: 'rot', menge_liter: 300, status: 'lagerung', aktiv: true, created_at: '2026-08-15T09:00:00Z', behaelter_id: 'b3', behaelter: b3 },
      // Zukauf in ein Partner-Gebinde der Kellergemeinschaft
      { id: 'w4', tenant_id: T, name: 'Zukauf RR', jahrgang: 2025, rebsorte: 'Riesling', qualitaetsstufe: null, weinart: null, menge_liter: 200, status: 'lagerung', aktiv: true, created_at: '2026-06-01T09:00:00Z', behaelter_id: 'b9', behaelter: null },
      // heute abgeschlossen (am 10.08. ganz abgefüllt) – lag am Stichtag noch in T1 neben w1
      { id: 'w5', tenant_id: T, name: 'WB 25', jahrgang: 2025, rebsorte: 'Weißburgunder', qualitaetsstufe: 'qualitaetswein', weinart: 'weiss', menge_liter: 0, status: 'abgeschlossen', aktiv: false, created_at: '2025-09-25T10:00:00Z', behaelter_id: 'b1', behaelter: b1 },
      // anderer Betrieb
      { id: 'w9', tenant_id: FREMD, name: 'Fremd', jahrgang: 2025, rebsorte: 'Zweigelt', menge_liter: 999, status: 'lagerung', aktiv: true, created_at: '2025-09-01T10:00:00Z', behaelter_id: 'b9' },
    ],
    pressung_behaelter: [
      { id: 'pb1', menge_liter: 1000, weinausbau_id: 'w1', behaelter_id: 'b1', notizen: null, storniert_am: null, pressung: pressung('p1', '2025-09-20') },
      { id: 'pb2', menge_liter: 800, weinausbau_id: 'w2', behaelter_id: 'b2', notizen: null, storniert_am: null, pressung: pressung('p2', '2025-10-01') },
      { id: 'pb3', menge_liter: 300, weinausbau_id: 'w5', behaelter_id: 'b1', notizen: null, storniert_am: null, pressung: pressung('p3', '2025-09-25') },
      { id: 'pb9', menge_liter: 999, weinausbau_id: 'w9', behaelter_id: 'b9', notizen: null, storniert_am: null, pressung: pressung('p9', '2025-09-01', FREMD) },
    ],
    keller_umzuege: [
      { id: 'u1', tenant_id: T, datum: '2026-08-15', menge_liter: 300, brutto_liter: 300, schwund_liter: 0, umzug_typ: 'umzug', zeilen_typ: 'quelle', umzug_batch_id: 'batch1', von_behaelter_id: 'b2', von_weinausbau_id: 'w2', nach_behaelter_id: null, nach_weinausbau_id: null, storniert_am: null, von_behaelter: b2, von_weinausbau: { name: 'ZW 25', jahrgang: 2025, behaelter: b2 } },
      { id: 'u2', tenant_id: T, datum: '2026-08-15', menge_liter: 300, brutto_liter: null, schwund_liter: 0, umzug_typ: 'umzug', zeilen_typ: 'ziel', umzug_batch_id: 'batch1', von_behaelter_id: null, von_weinausbau_id: null, nach_behaelter_id: 'b3', nach_weinausbau_id: 'w3', storniert_am: null, nach_behaelter: b3, nach_weinausbau: { name: 'ZW 25' } },
    ],
    fuellungen: [
      // 400 Flaschen à 1 l aus w1 am 01.03.; Verkauf 100 (alt, ohne Bewegungszeile) am 01.07., Verkauf 20 (alt) am 10.07.
      // mit Storno-Rückbuchung (Bewegungszeile) am 01.10., Verkauf 40 (Bewegungszeile) am 20.08., Bruch 10 am 10.09. → heute 250
      { id: 'f1', tenant_id: T, datum: '2026-03-01', name: 'GV Klassik', jahrgang: 2025, rebsorte: 'Grüner Veltliner', qualitaet: 'qualitaetswein', aktiv: true, bestand_flaschen: 250, anzahl_flaschen: 400, menge_liter_gefuellt: 400, flaschengroesse_ml: 1000, weinausbau_id: 'w1', storniert_am: null, weinausbau: { weinart: 'weiss' } },
      // WB am 10.08. abgefüllt (300 l) – am Stichtag noch nicht in Flaschen
      { id: 'f2', tenant_id: T, datum: '2026-08-10', name: 'WB Flasche', jahrgang: 2025, rebsorte: 'Weißburgunder', qualitaet: 'qualitaetswein', aktiv: true, bestand_flaschen: 400, anzahl_flaschen: 400, menge_liter_gefuellt: 300, flaschengroesse_ml: 750, weinausbau_id: 'w5', storniert_am: null, weinausbau: { weinart: 'weiss' } },
      // am 03.08. storniert (Restbestand bleibt in bestand_flaschen stehen) – am Stichtag noch da
      { id: 'f3', tenant_id: T, datum: '2026-05-01', name: 'Rosé 25', jahrgang: 2025, rebsorte: 'Zweigelt', qualitaet: null, aktiv: false, bestand_flaschen: 100, anzahl_flaschen: 100, menge_liter_gefuellt: 75, flaschengroesse_ml: 750, weinausbau_id: null, storniert_am: '2026-08-03T08:00:00Z', weinausbau: { weinart: 'rose' } },
      // vor KAN-145 deaktiviert, Rest 5 Flaschen, kein Datum
      { id: 'f4', tenant_id: T, datum: '2025-12-01', name: 'Alt', jahrgang: 2024, rebsorte: 'Zweigelt', aktiv: false, bestand_flaschen: 5, anzahl_flaschen: 50, flaschengroesse_ml: 750, weinausbau_id: null, storniert_am: null },
      { id: 'f9', tenant_id: FREMD, datum: '2026-01-01', name: 'Fremd', aktiv: true, bestand_flaschen: 99, anzahl_flaschen: 99, flaschengroesse_ml: 750, weinausbau_id: 'w9', storniert_am: null },
    ],
    fuellung_bewegungen: [
      { id: 'fb1', tenant_id: T, fuellung_id: 'f1', datum: '2026-08-20', art: 'verkauf', menge_stk: -40, verkaufsposten_id: 'vp3' },
      { id: 'fb2', tenant_id: T, fuellung_id: 'f1', datum: '2026-09-10', art: 'bruch', menge_stk: -10, verkaufsposten_id: null },
      { id: 'fb3', tenant_id: T, fuellung_id: 'f1', datum: '2026-10-01', art: 'verkauf_storno', menge_stk: 20, verkaufsposten_id: 'vp4' },
      { id: 'fb9', tenant_id: FREMD, fuellung_id: 'f9', datum: '2026-08-01', art: 'bruch', menge_stk: -1, verkaufsposten_id: null },
    ],
    verkauf_positionen: [
      { id: 'vf1', tenant_id: T, typ: 'flasche', menge: 100, fuellung_id: 'f1', weinausbau_id: null, verkaufsposten_id: 'vp1', verkaufsposten: { datum: '2026-07-01', storniert: false, storniert_am: null } },
      { id: 'vf3', tenant_id: T, typ: 'flasche', menge: 40, fuellung_id: 'f1', weinausbau_id: null, verkaufsposten_id: 'vp3', verkaufsposten: { datum: '2026-08-20', storniert: false, storniert_am: null } },
      { id: 'vf4', tenant_id: T, typ: 'flasche', menge: 20, fuellung_id: 'f1', weinausbau_id: null, verkaufsposten_id: 'vp4', verkaufsposten: { datum: '2026-07-10', storniert: true, storniert_am: '2026-10-01T09:00:00Z' } },
      // Tankverkäufe: w1 am 20.07. (am 05.08. storniert), w2 am 01.09.
      { id: 'vt1', tenant_id: T, typ: 'tank', menge: 50, fuellung_id: null, weinausbau_id: 'w1', verkaufsposten_id: 'vp5', verkaufsposten: { datum: '2026-07-20', storniert: true, storniert_am: '2026-08-05T10:00:00Z', storno_grund: 'Kunde storniert Auftrag' } },
      { id: 'vt2', tenant_id: T, typ: 'tank', menge: 100, fuellung_id: null, weinausbau_id: 'w2', verkaufsposten_id: 'vp6', verkaufsposten: { datum: '2026-09-01', storniert: false, storniert_am: null } },
      { id: 'vt9', tenant_id: FREMD, typ: 'tank', menge: 5, fuellung_id: null, weinausbau_id: 'w9', verkaufsposten_id: 'vp9', verkaufsposten: { datum: '2026-09-01', storniert: false } },
    ],
    zukauf_posten: [
      { id: 'z1', tenant_id: T, datum: '2026-06-01', menge: 200, ziel_weinausbau_id: 'w4', aktiv: true, art: 'wein', rebsorte: 'Riesling', jahrgang: 2025 },
    ],
    // Quelle eines fremden Verschnitts (Mehrfach-Mitgliedschaft) – darf w1 nicht mindern
    verschneidung_quellen: [
      { id: 'vq9', menge_liter: 50, quell_weinausbau_id: 'w1', verschneidung: { datum: '2026-09-15', notizen: null, tenant_id: FREMD, storniert_am: null, ziel: null } },
    ],
    verschneidungen: [],
  }
}

const RPC = (name) => name === 'lade_behaelter'
  ? { data: [
      { id: 'b1', tenant_id: T, name: 'T1', fremd: false, eigentuemer_name: 'Weingut Muster' },
      { id: 'b2', tenant_id: T, name: 'T2', fremd: false, eigentuemer_name: 'Weingut Muster' },
      { id: 'b3', tenant_id: T, name: 'T3', fremd: false, eigentuemer_name: 'Weingut Muster' },
      { id: 'b9', tenant_id: FREMD, name: 'a1', fremd: true, eigentuemer_name: 'Weingut Partner' },
    ], error: null }
  : { data: null, error: { message: `rpc ${name}` } }

const kurz = z => [z.abschnitt, z.bezeichnung, z.behaelter, z.flaschen ?? z.liter]

describe('KAN-43 ladeBestandsmeldung()', nurMitHooks, () => {
  test('Bestand am 31.07.: Umzug, Abfüllung, Verkauf und Stornos danach zurückgerechnet', async () => {
    const { ladeBestandsmeldung } = await laden('lib/behoerden/bestandsmeldung.ts')
    const db = datenbank(tabellen(), { rpc: RPC })
    const d = await ladeBestandsmeldung(db, T, { stichtag: STICHTAG, heute: HEUTE })
    assert.equal(d.stichtag, STICHTAG)
    assert.deepEqual(d.flaschen.map(kurz), [
      ['A', 'GV Klassik', null, 280],   // 250 + 40 (Verkauf 20.08.) + 10 (Bruch) − 20 (Storno-Rückbuchung 01.10.)
      ['A', 'Rosé 25', null, 100],      // Storno der Füllung erst am 03.08.
    ])
    assert.deepEqual(d.gebinde.map(kurz), [
      ['B', 'GV 25', 'T1', 550],        // Tankverkauf 20.07. lag vor dem Stichtag, Storno erst am 05.08.
      ['B', 'WB 25', 'T1', 300],        // erst am 10.08. abgefüllt
      ['B', 'ZW 25', 'T2', 800],        // Umzug 15.08. und Verkauf 01.09. zurückgerechnet; T3 war am Stichtag leer
      ['B', 'Zukauf RR', 'a1 · Weingut Partner', 200],
    ])
    assert.ok(d.zeilen.every(z => z.bestandAm === STICHTAG))
    assert.deepEqual(d.summe, { flaschen: 380, flaschenHl: 3.55, gebindeHl: 18.5, gesamtHl: 22.05 })
    assert.ok(d.warnungen.some(w => /zurückgerechnet aus dem Bestand am 02\.10\.2026/.test(w)))
    assert.ok(d.warnungen.some(w => /1 Gebinde enthält am Stichtag mehr als eine Charge.*T1/.test(w)), d.warnungen.join('\n'))
    assert.ok(d.warnungen.some(w => /1 deaktivierte Füllung mit Restbestand ohne Storno-Datum/.test(w)))
    assert.ok(!d.warnungen.some(w => /nicht vollständig erklärt/.test(w)), d.warnungen.join('\n'))
    assert.ok(!d.warnungen.some(w => /verlangt den Bestand zum 31\. Juli/.test(w)))
    // nur eigener Betrieb (Tabellen ohne tenant_id über die Elterntabelle mit !inner)
    assert.deepEqual(ohneMandant(db, T, ['pressung_behaelter', 'verschneidung_quellen']), [])
    const pb = db.aufrufe.find(a => a.tabelle === 'pressung_behaelter')
    assert.ok(hatFilter(pb, 'eq', 'pressung.tenant_id', T))
    // verschneidung_quellen: Mandant über die eingebettete Verschneidung, im Code gefiltert (vq9 zählt nicht, s. GV 25)
    // gesammelt geladen: jede Tabelle genau einmal (kein N+1 je Gebinde)
    const selects = db.aufrufe.filter(a => a.art === 'select').map(a => a.tabelle)
    for (const t of ['weinausbau', 'keller_umzuege', 'pressung_behaelter', 'fuellungen', 'zukauf_posten', 'verschneidungen', 'fuellung_bewegungen']) {
      assert.equal(selects.filter(x => x === t).length, 1, t)
    }
  })

  test('Stichtag heute = Ist-Bestand (Logik bis 02.10.2026)', async () => {
    const { ladeBestandsmeldung } = await laden('lib/behoerden/bestandsmeldung.ts')
    const t = tabellen()
    const d = await ladeBestandsmeldung(datenbank(t, { rpc: RPC }), T, { stichtag: HEUTE, heute: HEUTE })
    // bisherige Abfragen: aktive Füllungen mit Bestand > 0 (nach Name), aktive, nicht abgeschlossene Chargen mit Menge > 0
    const istFlaschen = t.fuellungen.filter(f => f.tenant_id === T && f.aktiv && f.bestand_flaschen > 0)
      .sort((a, b) => (a.name < b.name ? -1 : 1)).map(f => [f.name, f.bestand_flaschen])
    const istGebinde = t.weinausbau.filter(w => w.tenant_id === T && w.aktiv && w.status !== 'abgeschlossen' && w.menge_liter > 0)
      .map(w => [w.name, w.menge_liter]).sort()
    assert.deepEqual(d.flaschen.map(z => [z.bezeichnung, z.flaschen]), istFlaschen)
    assert.deepEqual(d.gebinde.map(z => [z.bezeichnung, z.liter]).sort(), istGebinde)
    assert.deepEqual(d.gebinde.map(z => z.behaelter), ['T1', 'T2', 'T3', 'a1 · Weingut Partner'])
    assert.ok(!d.warnungen.some(w => /zurückgerechnet/.test(w)))
    assert.ok(d.warnungen.some(w => /verlangt den Bestand zum 31\. Juli/.test(w)))
  })

  test('ungeklärter Altbestand und negativer Bestand werden gemeldet', async () => {
    const { ladeBestandsmeldung } = await laden('lib/behoerden/bestandsmeldung.ts')
    const t = tabellen()
    t.weinausbau[0].menge_liter = 650              // 50 l mehr, als die Buchungen erklären
    t.fuellungen[0].bestand_flaschen = 0           // heute 0 Flaschen, obwohl am 30.09. 300 zugebucht → am Stichtag −270
    t.fuellung_bewegungen.push({ id: 'fbX', tenant_id: T, fuellung_id: 'f1', datum: '2026-09-30', art: 'korrektur', menge_stk: 300, verkaufsposten_id: null })
    const d = await ladeBestandsmeldung(datenbank(t, { rpc: RPC }), T, { stichtag: STICHTAG, heute: HEUTE })
    assert.deepEqual(d.gebinde.find(z => z.bezeichnung === 'GV 25').liter, 600)
    assert.ok(d.warnungen.some(w => /1 Charge: Der heutige Bestand ist durch die Kellerbuchungen nicht vollständig erklärt \(zusammen 50,00 l.*GV 25/.test(w)), d.warnungen.join('\n'))
    assert.ok(d.warnungen.some(w => /1 Füllung ergibt zum Stichtag einen negativen Bestand.*GV Klassik \(-270 Fl\.\)/.test(w)), d.warnungen.join('\n'))
    assert.ok(!d.flaschen.some(z => z.bezeichnung === 'GV Klassik'))
  })

  test('Leermeldung: nur Kopfzeile', async () => {
    const { ladeBestandsmeldung, SPALTEN_BESTANDSMELDUNG } = await laden('lib/behoerden/bestandsmeldung.ts')
    const csv = await laden('lib/csv/index.ts')
    const d = await ladeBestandsmeldung(datenbank({}, { rpc: RPC }), T, { stichtag: STICHTAG, heute: HEUTE })
    const datei = csv.csvDatei(d.zeilen, SPALTEN_BESTANDSMELDUNG)
    assert.equal(datei.zeilen, 0)
    assert.equal(datei.text.split('\r\n').length, 2)
  })

  test('CSV: Spalte „Bestand am“ = Stichtag, Summen aus gerundeten Zeilen', async () => {
    const { ladeBestandsmeldung, SPALTEN_BESTANDSMELDUNG } = await laden('lib/behoerden/bestandsmeldung.ts')
    const csv = await laden('lib/csv/index.ts')
    const d = await ladeBestandsmeldung(datenbank(tabellen(), { rpc: RPC }), T, { stichtag: STICHTAG, heute: HEUTE })
    const zeilen = csv.csvText(d.zeilen, SPALTEN_BESTANDSMELDUNG).split('\r\n')
    assert.equal(zeilen[1], '31.07.2026;A – Flaschenwein;GV Klassik;2025;Grüner Veltliner;GV;Weiß;Qualitätswein;;1000;280;280,00;2,800')
    assert.equal(zeilen[5], '31.07.2026;B – Wein in Gebinden (Tank / Fass);ZW 25;2025;Zweigelt;ZW;Rot;Kabinett;T2;;;800,00;8,000')
    const hl = d.zeilen.reduce((s, z) => s + z.hl, 0)
    assert.equal(Math.round(hl * 1000) / 1000, d.summe.gesamtHl)
  })
})

// ── 5. Register und Druckseite ───────────────────────────────────────────────

describe('KAN-43 Register und Druckseite', nurMitHooks, () => {
  test('Register: Stichtag aus ?stichtag=, Dateiname und BKI-Jahr nach dem Stichtag', async () => {
    const { MELDUNGEN_ERNTE } = await laden('lib/behoerden/register/ernte.ts')
    const { meldungsDateiname } = await laden('lib/behoerden/dateiname.ts')
    const { istParameterFehler } = await laden('lib/behoerden/typen.ts')
    const m = MELDUNGEN_ERNTE.bestandsmeldung
    assert.deepEqual(m.parameter(new URLSearchParams('stichtag=2025-07-31')), { stichtag: '2025-07-31' })
    assert.match(m.parameter(new URLSearchParams('')).stichtag, /^\d{4}-07-31$/)
    assert.ok(istParameterFehler(m.parameter(new URLSearchParams('stichtag=2999-07-31'))))
    const B = { name: 'Weingut Muster', betriebsnummer: '9988776' }
    assert.equal(meldungsDateiname(m, { stichtag: '2025-07-31' }, B, '2026-10-02').dateiname.ascii, '9988776_2025_Weinbestand-Stichtag-2025-07-31.csv')
  })

  test('Druckseite: Stichtagsfeld, Laden mit Stichtag, CSV-Knopf mit denselben Parametern', () => {
    const seite = quelle('src/app/(dashboard)/reports/(pflicht)/ama/page.tsx')
    assert.match(seite, /^\/\/ behoerdenmeldung: erntemeldung, bestandsmeldung/)
    assert.match(seite, /type="date" name="stichtag"/)
    assert.match(seite, /stichtagParameter\(/)
    assert.match(seite, /ladeBestandsmeldung\(supabase, tenantId, \{ stichtag, heute: heuteIso \}\)/)
    assert.match(seite, /csvPfad\('bestandsmeldung', \{ stichtag \}\)/)
    assert.doesNotMatch(seite, /kein Stichtagsbestand/)
  })
})
