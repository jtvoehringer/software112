// KAN-108 „Ernte bis Ernte“ (Jörgen, 25.09.2026; Rückfall 01.01. entschieden 29.09.2026): Fensterbeginn der
// Maßnahmen je Lese = Tag nach der letzten Lese des Vorjahrgangs am selben Grundstück, sonst 01.01. des Jahrgangs.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { hooksRegistrieren, laden, nurMitHooks, datenbank } from './buchung-attrappe.mjs'

hooksRegistrieren()

const lese = (id, extra = {}) => ({ id, grundstueckId: 'gA', weingartenId: 'w1', lesedatum: '2025-10-05', pressungDatum: '2025-10-05', jahrgang: 2025, ...extra })
const m = (id, datum, extra = {}) => ({ id, datum, datumBis: null, weingartenId: 'w1', grundstueckIds: ['gA'], ...extra })
const vj = (lesedatum, extra = {}) => ({ jahrgang: 2024, weingartenId: 'w1', grundstueckId: 'gA', lesedatum, ...extra })
const GST_W1 = new Map([['w1', ['gA', 'gB']], ['w2', ['gC']]])
const WG_GST = new Map([['gA', 'w1'], ['gB', 'w1'], ['gC', 'w2']])
const ids = z => z.massnahmen.map(t => t.massnahme.id)

describe('KAN-108 Ernte bis Ernte – Fensterbeginn', nurMitHooks, () => {
  test('Tag nach der letzten Vorjahres-Lese am GST: Rebschnitt im Dezember gehört zur neuen Ernte', async () => {
    const f = await laden('lib/behoerden/rueckverfolgungFenster.ts')
    const ms = [m('amVorjahresLesetag', '2024-10-02'), m('oktober', '2024-10-03'), m('rebschnittDez', '2024-12-10'), m('mai', '2025-05-01'), m('danach', '2025-10-06')]
    const fruehere = [vj('2024-09-20'), vj('2024-10-02'), vj('2024-10-30', { grundstueckId: 'gB' }), vj('2023-10-01', { jahrgang: 2023 })]
    const [z] = f.ordneMassnahmenZu([lese('l')], ms, GST_W1, WG_GST, [], [], fruehere)
    assert.deepEqual(z.fenster, { von: '2024-10-03', bis: '2025-10-05', jahrgang: 2025, bisAus: 'lesedatum', vonAus: 'vorjahreslese', vorjahresLese: '2024-10-02' })
    assert.deepEqual(ids(z), ['oktober', 'rebschnittDez', 'mai'])
    assert.equal(f.fensterBeginnText(z.fenster), 'ab 03.10.2024, Tag nach der letzten Lese des Jahrgangs 2024 (02.10.2024)')
    assert.deepEqual(f.leseWarnungen([z]), [])
  })

  test('Eiswein des Vorjahrgangs im Jänner: Fenster ab dem Tag danach; Hauptlese und Eiswein des eigenen Jahrgangs beginnen gleich', async () => {
    const f = await laden('lib/behoerden/rueckverfolgungFenster.ts')
    const fruehere = [vj('2024-09-25'), vj('2025-01-12')]
    const haupt = lese('haupt', { lesedatum: '2025-09-20' })
    const eis = lese('eis', { lesedatum: '2026-01-08', pressungDatum: '2026-01-08' })
    const ms = [m('jaenner10', '2025-01-10'), m('jaenner13', '2025-01-13'), m('juli', '2025-07-01'), m('november', '2025-11-02')]
    const [h, e] = f.ordneMassnahmenZu([haupt, eis], ms, GST_W1, WG_GST, [], [], fruehere)
    assert.equal(h.fenster.von, '2025-01-13')
    assert.equal(e.fenster.von, '2025-01-13')
    assert.deepEqual(ids(h), ['jaenner13', 'juli'])
    assert.deepEqual(ids(e), ['jaenner13', 'juli', 'november'])
  })

  test('Rückfall ohne Vorjahres-Lese: 01.01. des Jahrgangs, Text und X-Warnung nennen es', async () => {
    const f = await laden('lib/behoerden/rueckverfolgungFenster.ts')
    const [z] = f.ordneMassnahmenZu([lese('l')], [m('dez', '2024-12-10'), m('mai', '2025-05-01')], GST_W1, WG_GST, [], [], [vj('2024-09-20', { grundstueckId: 'gC', weingartenId: 'w2' })])
    assert.deepEqual(z.fenster, { von: '2025-01-01', bis: '2025-10-05', jahrgang: 2025, bisAus: 'lesedatum', vonAus: 'jahresbeginn', vorjahresLese: null })
    assert.deepEqual(ids(z), ['mai'])
    assert.equal(f.fensterBeginnText(z.fenster), 'ab 01.01. des Jahrgangs 2025 (keine Lese des Jahrgangs 2024 erfasst)')
    assert.match(f.leseWarnungen([z]).join(' '), /1 Lese hat keine erfasste Lese des Vorjahrgangs am Grundstück/)
  })

  test('Ort: Vorjahres-Lese ohne GST am Weingarten zählt; Lese ohne GST nimmt die früheste letzte Lese je Ort', async () => {
    const f = await laden('lib/behoerden/rueckverfolgungFenster.ts')
    assert.equal(f.letzteVorjahresLese({ grundstueckId: 'gA', weingartenId: 'w1' }, 2024, '2025-10-05', [vj('2024-09-28', { grundstueckId: null })]), '2024-09-28')
    assert.equal(f.letzteVorjahresLese({ grundstueckId: 'gA', weingartenId: 'w1' }, 2024, '2025-10-05', [vj('2024-09-28', { grundstueckId: null, weingartenId: 'w2' })]), null)
    const fruehere = [vj('2024-09-20'), vj('2024-10-02'), vj('2024-10-15', { grundstueckId: 'gB' })]
    assert.equal(f.letzteVorjahresLese({ grundstueckId: null, weingartenId: 'w1' }, 2024, '2025-10-05', fruehere), '2024-10-02')
    // Lesetage am oder nach dem eigenen Fensterende zählen nicht (Datenfehler)
    assert.equal(f.letzteVorjahresLese({ grundstueckId: 'gA', weingartenId: 'w1' }, 2024, '2024-10-02', fruehere), '2024-09-20')
    assert.equal(f.folgetag('2024-12-31'), '2025-01-01')
    assert.equal(f.folgetag('2024-02-28'), '2024-02-29')
  })

  test('Lader: Vorjahres-Lesen aus Lesezeile, Erntemeldung und Traubenverkauf – je Betrieb, ohne Zukauf', async () => {
    const r = await laden('lib/behoerden/rueckverfolgung.ts')
    const T = 't1'
    const db = datenbank({
      weinjahrgaenge: [
        { id: 'jg24', tenant_id: T, jahrgang: 2024 },
        { id: 'jgFremd', tenant_id: 'fremd', jahrgang: 2024 },
      ],
      pressung_weingaerten: [
        { id: 'pw1', weingarten_id: 'w1', grundstueck_id: 'gA', ernte_datum: '2024-09-20', zukauf_posten_id: null, pressung: { tenant_id: T, jahrgang_id: 'jg24' } },
        { id: 'pwZukauf', weingarten_id: null, grundstueck_id: null, ernte_datum: '2024-10-30', zukauf_posten_id: 'zk', pressung: { tenant_id: T, jahrgang_id: 'jg24' } },
        { id: 'pwFremd', weingarten_id: 'w1', grundstueck_id: 'gA', ernte_datum: '2024-11-11', zukauf_posten_id: null, pressung: { tenant_id: 'fremd', jahrgang_id: 'jgFremd' } },
      ],
      ernte_parzellen: [
        { id: 'ep1', jahrgang_id: 'jg24', weingarten_id: 'w1', grundstueck_id: 'gA', ernte_datum: '2024-10-02', jahrgang: { tenant_id: T } },
      ],
      traubenverkauf: [
        { id: 'tv1', tenant_id: T, jahrgang_id: 'jg24', weingarten_id: 'w1', grundstueck_id: 'gB', datum: '2024-10-05', zukauf_posten_id: null },
      ],
    })
    const lesen = await r.ladeFruehereLesen(db, T, r.vorjahrgaenge([lese('l')]))
    assert.deepEqual(lesen.map(l => [l.grundstueckId, l.lesedatum]).sort(), [['gA', '2024-09-20'], ['gA', '2024-10-02'], ['gB', '2024-10-05']])
    assert.deepEqual(r.vorjahrgaenge([lese('a'), lese('b', { jahrgang: null, lesedatum: '2026-09-01' })]), [2024, 2025])
    assert.deepEqual(await r.ladeFruehereLesen(db, T, []), [])
  })
})
