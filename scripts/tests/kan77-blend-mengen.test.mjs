// KAN-77: Blend-Protokoll mit Mengen und Quellgebinde (BKI-Termin R2 „Herkunft des Verschnitts nicht erkennbar –
// kommt aus Stahltank 03; Verschnitt-Protokoll: Menge wäre gut“).
//   • anteile() / blendZeilen(): Liter nach dem größten Rest – Summe genau die Bezugsmenge
//   • gebindeAmTag() / Zwischencharge-Regel (quellGebindeKern.ts): Stahltank 03 statt Stahltank 04
//   • blendSchritte(): Verschnitt- und Umzugsschritte mit brutto / Schwund / netto
//   • Lader quellGebindeDesVerschnitts() und ladeBlendProtokoll() gegen die Supabase-Attrappe
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { anteile, verteileLiter, zusammensetzung, bestandNachEreignis } from '../../src/lib/wein/mischungsrechnung.ts'
import { gebindeAmTag, quellGebindeAusDaten, quellGebindeId, verschnittQuelleText } from '../../src/lib/kellerbuch/quellGebindeKern.ts'
import { hooksRegistrieren, laden, nurMitHooks, datenbank } from './buchung-attrappe.mjs'

hooksRegistrieren()

const info = (rebsorte, weingarten_name) => ({
  typ: 'pressung', rebsorte, jahrgang: 2025, weingarten_name, gst_nr: null, katastralgemeinde: null, ernte_datum: null, kmw: null, zukauf_von: null,
})
const summe = xs => Math.round(xs.reduce((s, x) => s + x, 0) * 100) / 100

describe('KAN-77 Liter je Herkunft (Größter-Rest-Methode)', () => {
  test('Ticket: 500,00 L (91,2 %) + 48,00 L (8,8 %) = 548,00 L', () => {
    const m = new Map([['rr', { liter: 500, info: info('Riesling', 'Pfaffenberg') }], ['gv', { liter: 48, info: info('Grüner Veltliner', 'Sandgrube') }]])
    const a = anteile(m)
    assert.deepEqual(a.map(x => [x.key, x.liter, x.anteil_pct]), [['rr', 500, 91.2], ['gv', 48, 8.8]])
    assert.equal(summe(a.map(x => x.liter)), 548)
  })

  test('Dreiteilung mit Resten: Summe genau die Bezugsmenge (Einzelrundung ergäbe 99,99 bzw. 100,01)', () => {
    const m = new Map([['a', { liter: 1, info: info('A', null) }], ['b', { liter: 1, info: info('B', null) }], ['c', { liter: 1, info: info('C', null) }]])
    assert.deepEqual(anteile(m, 100).map(x => x.liter), [33.34, 33.33, 33.33])
    assert.equal(summe(anteile(m, 100).map(x => x.liter)), 100)
    const n = new Map([['a', { liter: 2, info: info('A', null) }], ['b', { liter: 2, info: info('B', null) }], ['c', { liter: 2, info: info('C', null) }]])
    assert.equal(summe(anteile(n, 200.02).map(x => x.liter)), 200.02)
    assert.equal(summe(anteile(n, 0.05).map(x => x.liter)), 0.05)
    assert.deepEqual(verteileLiter([1, 1, 1], 1), [0.34, 0.33, 0.33])
    assert.deepEqual(verteileLiter([0, 0], 10), [0, 0])
  })

  test('Bestand ≠ Saldo: Liter summieren genau auf den gebuchten Bestand', () => {
    const z = zusammensetzung([
      { art: 'zugang', id: 'z1', datum: '2025-10-01', erfasst: null, charge: 'A', herkunft: [{ key: 'a', liter: 1, info: info('A', null) }] },
      { art: 'zugang', id: 'z2', datum: '2025-10-01', erfasst: null, charge: 'A', herkunft: [{ key: 'b', liter: 2, info: info('B', null) }] },
    ], 'A', { gebuchterBestand: 1000 })
    assert.equal(summe(z.anteile.map(a => a.liter)), 1000)
    assert.deepEqual(z.anteile.map(a => a.liter), [666.67, 333.33])
  })

  test('Anteil am Ergebnis: Bestand der Ziel-Charge unmittelbar nach dem Verschnitt', () => {
    const e = [
      { art: 'zugang', id: 'z1', datum: '2025-09-28', erfasst: null, charge: 'A', herkunft: [{ key: 'rr', liter: 5000, info: info('Riesling', null) }] },
      { art: 'zugang', id: 'z2', datum: '2025-09-20', erfasst: null, charge: 'Z', herkunft: [{ key: 'gv', liter: 48, info: info('GV', null) }] },
      { art: 'abgang', id: 'a1', datum: '2026-06-20', erfasst: null, charge: 'A', liter: 4500, grund: 'fuellung', bezug: 'f' },
      { art: 'uebertrag', id: 'vs:1', grund: 'verschnitt', datum: '2026-09-25', erfasst: '2026-09-25T09:00:00Z', quellen: [{ charge: 'Z', liter: 48 }], ziele: [{ charge: 'A', liter: 48 }] },
      { art: 'abgang', id: 'a2', datum: '2026-09-30', erfasst: null, charge: 'A', liter: 100, grund: 'verkauf' },
    ]
    assert.equal(bestandNachEreignis(e, 'A', 'vs:1'), 548)
    assert.equal(Math.round(48 / 548 * 1000) / 10, 8.8)
    assert.equal(bestandNachEreignis(e, 'A', 'vs:fehlt'), null)
  })
})

describe('KAN-77 blendZeilen: Σ „Menge anteilig“ = Bezugsmenge', nurMitHooks, () => {
  const kopf = (bezugLiter) => ({ art: 'charge', id: 'c', name: 'Riesling Ried Pfaffenberg', jahrgang: 2025, rebsorte: 'Riesling', qualitaet: null, pruefnummer: null, pruefnummerHinweis: null, chargennummer: null, datum: null, anzahlFlaschen: null, flaschengroesseMl: null, bezugLiter })
  const u = (key, liter, anteil_pct) => ({ key, ...info('Riesling', key), liter, anteil_pct })
  test('Ticket, drei gleiche Teile, Gewichte nur über den Anteil, ohne Bezugsmenge', async () => {
    const { blendZeilen } = await laden('lib/behoerden/blend.ts')
    const t = blendZeilen(kopf(548), [u('rr', 500, 91.2), u('gv', 48, 8.8)])
    assert.deepEqual(t.map(z => z.mengeLiter), [500, 48])
    for (const [bezug, komp] of [
      [100, [u('a', 1, 33.4), u('b', 1, 33.3), u('c', 1, 33.3)]],
      [750, [u('a', 2, 66.7), u('b', 1, 33.3)]],
      [1234.57, [u('a', 3.3, 33), u('b', 3.3, 33), u('c', 3.4, 34)]],
      [0.03, [u('a', 1, 50), u('b', 1, 50)]],
    ]) {
      const zeilen = blendZeilen(kopf(bezug), komp)
      assert.equal(summe(zeilen.map(z => z.mengeLiter)), bezug, `Bezugsmenge ${bezug}`)
    }
    const ohneLiter = blendZeilen(kopf(750), [{ ...u('a', undefined, 66.7) }, { ...u('b', undefined, 33.3) }])
    assert.deepEqual(ohneLiter.map(z => z.mengeLiter), [500.25, 249.75])
    assert.deepEqual(blendZeilen(kopf(null), [u('a', 1, 100)]).map(z => z.mengeLiter), [null])
  })
})

// Ticket-Fall: GV-Charge G in Stahltank 03; Umzug 50 L brutto / 48 L netto am 25.09.2026 in eine Zwischencharge Z, die
// im Ziel-Tank Stahltank 04 liegt; Verschnitt Z → A (Riesling, Stahltank 04)
const T = 'tenant-1'
const ST03 = 'beh-03', ST04 = 'beh-04', ST07 = 'beh-07'
const umzug = (id, p) => ({ id, tenant_id: T, datum: '2026-09-25', erstellt_am: '2026-09-25T08:00:00Z', storniert_am: null, umzug_batch_id: null, zeilen_typ: null, umzug_typ: 'umzug', von_behaelter_id: null, nach_behaelter_id: null, von_weinausbau_id: null, nach_weinausbau_id: null, ...p })
const KU1 = umzug('ku-1', { von_weinausbau_id: 'G', nach_weinausbau_id: 'Z', von_behaelter_id: ST03, nach_behaelter_id: ST04, menge_liter: 48, brutto_liter: 50, schwund_liter: 2,
  von_behaelter: { name: 'Stahltank 03' }, nach_behaelter: { name: 'Stahltank 04' } })
const VS = { id: 'vs-1', datum: '2026-09-25', created_at: '2026-09-25T09:00:00Z', ziel_weinausbau_id: 'A', quellen: [{ quell_weinausbau_id: 'Z', menge_liter: 48 }] }
const aktuell = new Map([['A', ST04], ['G', ST03], ['Z', ST04]])
const NAMEN = new Map([[ST03, 'Stahltank 03'], [ST04, 'Stahltank 04'], [ST07, 'Stahltank 07']])

describe('KAN-77 Quellgebinde (quellGebindeKern)', () => {
  test('gebindeAmTag: letzter Umzug hinein ≤ Tag, sonst erster Umzug hinaus danach, sonst heutiges Gebinde', () => {
    const spaeter = umzug('ku-2', { datum: '2026-10-01', von_weinausbau_id: 'G', von_behaelter_id: ST03, nach_weinausbau_id: 'X', nach_behaelter_id: ST07, menge_liter: 100 })
    assert.equal(gebindeAmTag('Z', '2026-09-25', [KU1], null), ST04)
    assert.equal(gebindeAmTag('Z', '2026-09-24', [KU1], ST07), ST07)
    assert.equal(gebindeAmTag('G', '2026-09-25', [KU1, spaeter], ST07), ST03)
    assert.equal(gebindeAmTag('X', '2026-10-02', [spaeter], null), ST07)
    // stornierte Umzüge zählen nicht; Gleichstand am Tag nach Erfassungszeit
    assert.equal(gebindeAmTag('Z', '2026-09-25', [{ ...KU1, storniert_am: '2026-09-26T10:00:00Z' }], ST07), ST07)
    const frueh = umzug('ku-3', { nach_weinausbau_id: 'Q', nach_behaelter_id: ST03, erstellt_am: '2026-09-25T07:00:00Z' })
    const spaet = umzug('ku-4', { nach_weinausbau_id: 'Q', nach_behaelter_id: ST07, erstellt_am: '2026-09-25T10:00:00Z' })
    assert.equal(gebindeAmTag('Q', '2026-09-25', [spaet, frueh], null), ST07)
  })

  test('Zwischencharge im Ziel-Tank: Quellgebinde Stahltank 03, nicht Stahltank 04', () => {
    const akt = id => aktuell.get(id) ?? null
    assert.equal(quellGebindeId('Z', 'A', '2026-09-25', [KU1], akt), ST03)
    const m = quellGebindeAusDaten([VS], [KU1], aktuell, NAMEN)
    assert.deepEqual(m.get('vs-1:Z'), { behaelterId: ST03, name: 'Stahltank 03' })
    assert.equal(verschnittQuelleText('Grüner Veltliner Sandgrube', m.get('vs-1:Z').name, '48 L'), 'Grüner Veltliner Sandgrube (Stahltank 03) · 48 L')
    // Quelle in einem anderen Gebinde als das Ziel: ihr eigenes Gebinde
    const anders = new Map([...aktuell, ['Z', ST07]])
    assert.equal(quellGebindeAusDaten([VS], [], anders, NAMEN).get('vs-1:Z').name, 'Stahltank 07')
    // n:m-Umzug in die Zwischencharge: eindeutiges Gebinde der Quellzeilen
    const q = umzug('b-q', { umzug_batch_id: 'B1', zeilen_typ: 'quelle', von_weinausbau_id: 'G', von_behaelter_id: ST03, menge_liter: 50 })
    const z = umzug('b-z', { umzug_batch_id: 'B1', zeilen_typ: 'ziel', nach_weinausbau_id: 'Z', nach_behaelter_id: ST04, menge_liter: 48 })
    assert.equal(quellGebindeId('Z', 'A', '2026-09-25', [q, z], akt), ST03)
    // Altdaten ohne von_behaelter_id: Gebinde der Vorgänger-Charge
    const alt = { ...KU1, von_behaelter_id: null }
    assert.equal(quellGebindeId('Z', 'A', '2026-09-25', [alt], akt), ST03)
  })
})

describe('KAN-77 Verschnitt- und Umzugsschritte', nurMitHooks, () => {
  test('Ticket: Umzug Stahltank 03 → 04, 50 L / 2 L Schwund / 48 L; Verschnitt 48 L', async () => {
    const { blendSchritte } = await laden('lib/behoerden/blendSchritte.ts')
    const schritte = blendSchritte({
      chargen: new Set(['A', 'Z', 'G']), umzuege: [KU1], verschneidungen: [VS],
      chargeNamen: new Map([['A', 'Riesling Ried Pfaffenberg'], ['G', 'Grüner Veltliner Sandgrube'], ['Z', 'Zwischencharge']]),
      gebindeJeCharge: aktuell, behaelterNamen: NAMEN, bis: null,
    })
    assert.deepEqual(schritte.map(s => [s.datum, s.vorgang, s.von.map(v => v.gebinde), s.nach.map(n => n.gebinde), s.bruttoLiter, s.schwundLiter, s.nettoLiter]), [
      ['2026-09-25', 'Umzug', ['Stahltank 03'], ['Stahltank 04'], 50, 2, 48],
      ['2026-09-25', 'Verschnitt', ['Stahltank 04'], ['Stahltank 04'], 48, 0, 48],
    ])
    assert.deepEqual(schritte[0].von[0], { charge: 'Grüner Veltliner Sandgrube', gebinde: 'Stahltank 03' })
    // Stichtag davor: keine Schritte; Altformat ohne brutto_liter: netto = menge − schwund
    assert.deepEqual(blendSchritte({ chargen: new Set(['A', 'Z']), umzuege: [KU1], verschneidungen: [VS], chargeNamen: new Map(), gebindeJeCharge: aktuell, behaelterNamen: NAMEN, bis: '2026-09-24' }), [])
    const altformat = blendSchritte({ chargen: new Set(['Z']), umzuege: [{ ...KU1, brutto_liter: null, menge_liter: 50 }], verschneidungen: [], chargeNamen: new Map(), gebindeJeCharge: aktuell, behaelterNamen: NAMEN, bis: null })
    assert.deepEqual(altformat.map(s => [s.bruttoLiter, s.schwundLiter, s.nettoLiter]), [[50, 2, 48]])
    // n:m-Umzug: brutto = Σ Quellen, netto = Σ Ziele
    const nm = blendSchritte({
      chargen: new Set(['Z']), verschneidungen: [], chargeNamen: new Map(), gebindeJeCharge: aktuell, behaelterNamen: NAMEN, bis: null,
      umzuege: [
        umzug('b-q1', { umzug_batch_id: 'B1', zeilen_typ: 'quelle', von_weinausbau_id: 'G', von_behaelter_id: ST03, menge_liter: 30 }),
        umzug('b-q2', { umzug_batch_id: 'B1', zeilen_typ: 'quelle', von_weinausbau_id: 'X', von_behaelter_id: ST07, menge_liter: 20, umzug_typ: 'filtration' }),
        umzug('b-z', { umzug_batch_id: 'B1', zeilen_typ: 'ziel', nach_weinausbau_id: 'Z', nach_behaelter_id: ST04, menge_liter: 49 }),
      ],
    })
    assert.deepEqual(nm.map(s => [s.vorgang, s.von.length, s.bruttoLiter, s.schwundLiter, s.nettoLiter]), [['Filtration', 2, 50, 1, 49]])
  })
})

describe('KAN-77 Lader gegen die Attrappe', nurMitHooks, () => {
  const pressung = (id, charge, liter, rebsorte, wg, datum) => ({
    id: `pb-${id}`, menge_liter: liter, weinausbau_id: charge,
    pressung: { id, datum, erstellt_am: `${datum}T10:00:00Z`, tenant_id: T, jahrgang: { jahrgang: 2025 },
      pressung_weingaerten: [{ id: `pw-${id}`, trauben_kg: liter * 1.4, rebsorte, ernte_datum: datum, kmw: 18, zukauf_posten_id: null, weingarten: { name: wg }, grundstueck: { gst_nr: '1/1', katastralgemeinde: '12119' } }] },
  })
  const db = () => {
    const vs = { id: 'vs-1', tenant_id: T, datum: '2026-09-25', created_at: '2026-09-25T09:00:00Z', storniert_am: null, ziel_weinausbau_id: 'A', notizen: null,
      quellen: [{ id: 'vq-1', quell_weinausbau_id: 'Z', menge_liter: 48, anteil_pct: 100, quelle: { id: 'Z', name: 'Zwischencharge', rebsorte: 'Grüner Veltliner' } }] }
    return datenbank({
      weinausbau: [
        { id: 'A', tenant_id: T, name: 'Riesling Ried Pfaffenberg', rebsorte: 'Riesling', jahrgang: 2025, menge_liter: 548, behaelter_id: ST04, ist_eroeffnungsbestand: false, created_at: '2025-09-28T10:00:00Z' },
        { id: 'G', tenant_id: T, name: 'Grüner Veltliner Sandgrube', rebsorte: 'Grüner Veltliner', jahrgang: 2025, menge_liter: 2950, behaelter_id: ST03, ist_eroeffnungsbestand: false, created_at: '2025-09-20T10:00:00Z' },
        { id: 'Z', tenant_id: T, name: 'Zwischencharge', rebsorte: 'Grüner Veltliner', jahrgang: 2025, menge_liter: 0, behaelter_id: ST04, ist_eroeffnungsbestand: false, created_at: '2026-09-25T08:00:00Z' },
      ],
      behaelter: [
        { id: ST03, tenant_id: T, name: 'Stahltank 03' }, { id: ST04, tenant_id: T, name: 'Stahltank 04' },
        { id: ST03, tenant_id: 'anderer-betrieb', name: 'Fremdtank' },
      ],
      pressung_behaelter: [pressung('p-rr', 'A', 5000, 'Riesling', 'Pfaffenberg Riesling', '2025-09-28'), pressung('p-gv', 'G', 3000, 'Grüner Veltliner', 'Sandgrube', '2025-09-20')],
      keller_umzuege: [KU1],
      verschneidungen: [vs],
      verschneidung_quellen: [{ id: 'vq-1', quell_weinausbau_id: 'Z', menge_liter: 48, verschneidung: vs }],
      fuellung_chargen: [{ id: 'fc-1', tenant_id: T, fuellung_id: 'F', weinausbau_id: 'A', anteil_liter: 4500, fuellung: { id: 'F', datum: '2026-06-20', erstellt_am: '2026-06-20T10:00:00Z', aktiv: true } }],
      fuellungen: [], zukauf_posten: [], verkauf_positionen: [], dac_antrag: [],
    })
  }

  test('quellGebindeDesVerschnitts: Stahltank 03 (eigener Betrieb)', async () => {
    const { quellGebindeDesVerschnitts } = await laden('lib/kellerbuch/quellGebinde.ts')
    const m = await quellGebindeDesVerschnitts(db(), T, [{ id: 'vs-1', datum: '2026-09-25', ziel_weinausbau_id: 'A', quellen: [{ quell_weinausbau_id: 'Z' }] }])
    assert.deepEqual(m.get('vs-1:Z'), { behaelterId: ST03, name: 'Stahltank 03' })
    assert.equal((await quellGebindeDesVerschnitts(db(), T, [])).size, 0)
  })

  test('ladeBlendProtokoll (Charge): Liter-Summe = Bestand, Schritte mit Mengen', async () => {
    const { ladeBlendProtokoll } = await laden('lib/behoerden/blend.ts')
    const p = await ladeBlendProtokoll(db(), T, { art: 'charge', id: 'A' })
    assert.deepEqual(p.zeilen.map(z => [z.anteilPct, z.mengeLiter]), [[91.2, 500], [8.8, 48]])
    assert.equal(summe(p.zeilen.map(z => z.mengeLiter)), p.kopf.bezugLiter)
    assert.deepEqual(p.schritte.map(s => [s.vorgang, s.von[0].gebinde, s.nach[0].gebinde, s.bruttoLiter, s.schwundLiter, s.nettoLiter]), [
      ['Umzug', 'Stahltank 03', 'Stahltank 04', 50, 2, 48],
      ['Verschnitt', 'Stahltank 04', 'Stahltank 04', 48, 0, 48],
    ])
    const vorher = await ladeBlendProtokoll(db(), T, { art: 'charge', id: 'A', stichtag: '2026-09-24' })
    assert.deepEqual(vorher.schritte, [])
  })

  test('Weinbuch: „Verschneidung von Zwischencharge (Stahltank 03) · 48 L“', async () => {
    const { buildWeinbuch } = await laden('lib/wein/weinbuch.ts')
    const wb = await buildWeinbuch(db(), 'A', T)
    const ev = wb.events.find(e => e.typ === 'verschneidung')
    assert.ok(ev, 'Verschnitt-Ereignis fehlt')
    assert.deepEqual(ev.details, ['Verschneidung von Zwischencharge (Stahltank 03) · 48 L'])
    assert.equal(ev.quellgebinde, 'Stahltank 03')   // KAN-365: eigene CSV-Spalte Quellgebinde
    const { weinbuchZeilen } = await laden('lib/behoerden/weinbuch.ts')
    assert.ok(weinbuchZeilen(wb).some(z => z.details.includes('Stahltank 03') && !z.details.includes('Stahltank 04')))
  })

  test('Bewegungsbuch (Betriebs-Variante, auch CSV): Verschnitt-Zugang nennt Stahltank 03', async () => {
    const { ladeBewegungenBetrieb } = await laden('lib/behoerden/bewegungsbuch.ts')
    const { bewegungen } = await ladeBewegungenBetrieb(db(), T)
    const vs = bewegungen.find(b => b.art === 'verschneidung_ein')
    assert.equal(vs.beschreibung, 'Verschneidung von Stahltank 03 (Zwischencharge)')
    assert.equal(vs.gegenstelle, 'Stahltank 03 (Zwischencharge)')
  })
})
