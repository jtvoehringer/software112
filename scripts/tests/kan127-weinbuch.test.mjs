// KAN-127: Weinbuch aus Sicht der Charge – Feldbehandlungen nur der gelesenen GST im Fenster „Ernte bis Ernte“
// (gemeinsamer Kern mit der Rückverfolgung Weingarten), Vorgänger über Verschnitt, Zukauf- und
// Eröffnungsbestand-Hinweise, Ende mit der letzten Füllung einer leeren Charge.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { hooksRegistrieren, laden, nurMitHooks, datenbank } from './buchung-attrappe.mjs'

hooksRegistrieren()

const T = 't1'
const W1 = 'wg-1', GA = 'gst-a', GB = 'gst-b'
const PRESSUNG = (id, datum, charge) => ({ id, datum, erstellt_am: `${datum}T10:00:00Z`, tenant_id: T, jahrgang_id: 'jg25', lese_id: 'l1', most_liter_gesamt: 700, weinbezeichnung: null, notizen: null, jahrgang: { jahrgang: 2025 }, lese: { lfd_nr: 1, art: 'hauptlese' }, _charge: charge })

function pw(id, gst, ernte_datum, pressung) {
  return {
    id, trauben_kg: 1000, rebsorte: 'Grüner Veltliner', ernte_datum, kmw: 18, oechsle: null, mostgewicht_einheit: 'kmw',
    weingarten_id: W1, grundstueck_id: gst, zukauf_posten_id: null,
    weingarten: { id: W1, name: 'Sandgrube' }, grundstueck: { gst_nr: gst === GA ? '1305/1' : '1305/2', katastralgemeinde: '12119', ama_feldnummer: null },
    pressung,
  }
}
function beh(id, datum, gsts, extra = {}) {
  return {
    id, tenant_id: T, datum, datum_bis: null, art: 'spritzung', weingarten_id: W1, aufwandmenge: 2, aufwandmenge_einheit: 'kg/ha',
    schaderreger: null, witterung: null, notizen: null, ernte_fruehesteins: null, wartezeit_eingehalten: null, bbch_stadium: null,
    psm: { name: 'Cuprozin progress', handelsname: null, zulassungsnr: '3106-0', wartezeit_tage: 21 },
    behandlung_grundstuecke: gsts.map(g => ({ grundstueck_id: g, flaeche_ha: 0.5 })), ...extra,
  }
}

/** Charge A (GST A, Lese 20.09.2025) ← Verschnitt aus Charge B (GST B, Lese 25.09.2025) */
function daten({ mengeA = 900, fuellungen = [] } = {}) {
  const pA = PRESSUNG('pA', '2025-09-21', 'A'), pB = PRESSUNG('pB', '2025-09-26', 'B')
  const zA = pw('pw-a', GA, '2025-09-20', pA), zB = pw('pw-b', GB, '2025-09-25', pB)
  const vs = { id: 'vs1', tenant_id: T, datum: '2025-11-02', created_at: '2025-11-02T10:00:00Z', ziel_weinausbau_id: 'A', notizen: null, quellen: [{ id: 'vq1', quell_weinausbau_id: 'B', menge_liter: 200, anteil_pct: null, quelle: { id: 'B', name: 'GV 1305/2', rebsorte: 'Grüner Veltliner' } }] }
  return {
    weinausbau: [
      { id: 'A', tenant_id: T, name: 'GV Sandgrube', jahrgang: 2025, rebsorte: 'Grüner Veltliner', qualitaetsstufe: null, status: 'ausbau', menge_liter: mengeA, behaelter_id: null, behaelter: null, ist_eroeffnungsbestand: false, anfangsbestand_liter: null, created_at: '2025-09-21T10:00:00Z' },
      { id: 'B', tenant_id: T, name: 'GV 1305/2', jahrgang: 2025, rebsorte: 'Grüner Veltliner', qualitaetsstufe: null, status: 'ausbau', menge_liter: 500, behaelter_id: null, behaelter: null, ist_eroeffnungsbestand: false, anfangsbestand_liter: null, created_at: '2025-09-26T10:00:00Z' },
    ],
    pressung_behaelter: [
      { id: 'pbA', menge_liter: 700, weinausbau_id: 'A', pressung: { ...pA, pressung_weingaerten: [zA] } },
      { id: 'pbB', menge_liter: 700, weinausbau_id: 'B', pressung: { ...pB, pressung_weingaerten: [zB] } },
    ],
    pressung_weingaerten: [zA, zB],
    verschneidungen: [vs],
    verschneidung_quellen: [{ id: 'vq1', quell_weinausbau_id: 'B', menge_liter: 200, anteil_pct: null, verschneidung: { ...vs, ziel: { id: 'A', name: 'GV Sandgrube' } } }],
    zukauf_posten: [], keller_umzuege: [], keller_behandlungen: [], weinanalysen: [], dac_antrag: [], verkauf_positionen: [],
    fuellung_chargen: [], fuellungen, weinausbau_weingaerten: [], traubenverkauf: [], ernte_parzellen: [],
    weinjahrgaenge: [{ id: 'jg25', tenant_id: T, jahrgang: 2025 }],
    grundstuecke: [
      { id: GA, tenant_id: T, weingarten_id: W1, gst_nr: '1305/1' },
      { id: GB, tenant_id: T, weingarten_id: W1, gst_nr: '1305/2' },
      { id: 'gst-c', tenant_id: T, weingarten_id: W1, gst_nr: '1305/3' },
    ],
    behandlungen: [
      beh('beide', '2025-07-01', [GA, GB]),                  // beide gelesenen GST → eine Zeile, beide GST
      beh('nurA-aug', '2025-08-01', [GA]),
      beh('nurB-sep', '2025-09-22', [GB]),                   // nach Lese A, vor Lese B → nur über B
      beh('nachLese', '2025-10-10', [GA, GB]),               // nach beiden Lesen → nicht im Weinbuch
      beh('nichtGelesen', '2025-07-15', ['gst-c']),          // GST des Weingartens, nicht gelesen → fehlt
      beh('nurWeingarten', '2025-06-01', [], { art: 'duengung', psm: null }),
      beh('mehrtaegig', '2025-05-30', [GA], { datum_bis: '2025-06-02', art: 'laubarbeit', psm: null }),
    ],
  }
}

const feld = wb => wb.events.filter(e => e.typ === 'feldbehandlung')

describe('KAN-127 Weinbuch', nurMitHooks, () => {
  test('Feldbehandlungen nur der gelesenen GST bis zur jeweiligen Lese, je Maßnahme einmal, Herkunft über den Verschnitt', async () => {
    const { buildWeinbuch } = await laden('lib/wein/weinbuch.ts')
    const wb = await buildWeinbuch(datenbank(daten()), 'A', T)
    const f = feld(wb)
    assert.deepEqual(f.map(e => e.datum), ['2025-05-30', '2025-06-01', '2025-07-01', '2025-08-01', '2025-09-22'])
    assert.equal(new Set(f.map(e => e.datum + e.titel)).size, f.length, 'keine Dublette')
    const beide = f.find(e => e.datum === '2025-07-01')
    assert.ok(beide.details.includes('GST 1305/1, 1305/2 (Ried: Sandgrube)'), beide.details.join(' | '))
    assert.ok(beide.details.includes('Fläche: 1 ha'), beide.details.join(' | '))
    assert.ok(!beide.details.some(d => d.startsWith('Herkunft:')))
    const nurB = f.find(e => e.datum === '2025-09-22')
    assert.ok(nurB.details.includes('Herkunft: über Charge „GV 1305/2“'), nurB.details.join(' | '))
    assert.ok(f.find(e => e.datum === '2025-06-01').details.some(d => d.startsWith('am Weingarten erfasst (ohne Grundstück)')))
    assert.ok(f.find(e => e.datum === '2025-05-30').details.includes('Zeitraum: 30.05.2025–02.06.2025'))
    assert.ok(!f.some(e => e.details.some(d => d.includes('1305/3'))))
  })

  test('Lesen und Pressungen aus den Lesezeilen der Charge und ihrer Vorgänger', async () => {
    const { buildWeinbuch } = await laden('lib/wein/weinbuch.ts')
    const wb = await buildWeinbuch(datenbank(daten()), 'A', T)
    const lesen = wb.events.filter(e => e.typ === 'ernte')
    assert.deepEqual(lesen.map(e => [e.datum, e.titel]), [['2025-09-20', 'Lese 2025/1 Hauptlese'], ['2025-09-25', 'Lese 2025/1 Hauptlese']])
    assert.ok(lesen[1].details.includes('über Charge „GV 1305/2“'))
    const pressungen = wb.events.filter(e => e.typ === 'pressung')
    assert.deepEqual(pressungen.map(e => [e.datum, e.titel]), [['2025-09-21', 'Pressung'], ['2025-09-26', 'Pressung (über Charge „GV 1305/2“)']])
  })

  test('Zukauf und Eröffnungsbestand: Hinweise statt Ried-Maßnahmen', async () => {
    const { buildWeinbuch, HINWEIS_EROEFFNUNGSBESTAND } = await laden('lib/wein/weinbuch.ts')
    const d = daten()
    d.zukauf_posten = [{
      id: 'zk1', tenant_id: T, datum: '2025-10-05', art: 'wein', menge: 300, einheit: 'l', rebsorte: 'Grüner Veltliner', jahrgang: 2025,
      ziel_weinausbau_id: 'B', aktiv: true, erstellt_am: '2025-10-05T10:00:00Z',
      lieferant_firma: { name: 'Winzerhof Berger', betrieb_nr: '7654321' }, lieferant_kontakt: null,
    }]
    d.weinausbau[1].ist_eroeffnungsbestand = true
    const wb = await buildWeinbuch(datenbank(d), 'A', T)
    const zk = wb.warnungen.find(w => w.startsWith('Zukauf '))
    assert.ok(zk, wb.warnungen.join(' / '))
    assert.match(zk, /über Charge „GV 1305\/2“/)
    assert.match(zk, /Lieferbetrieb Winzerhof Berger \(Betriebsnr\. 7654321\); Transportschein-Nr\. nicht erfasst\./)
    assert.ok(wb.warnungen.includes(`Charge „GV 1305/2“: ${HINWEIS_EROEFFNUNGSBESTAND}`))
  })

  test('Ende: leere Charge endet mit der letzten Füllung – spätere Einträge fallen weg', async () => {
    const { buildWeinbuch } = await laden('lib/wein/weinbuch.ts')
    const f = { id: 'f1', tenant_id: T, datum: '2026-03-01', chargennummer: 'L1', pruefnummer: null, name: 'GV Sandgrube 2025', anzahl_flaschen: 1200, flaschengroesse_ml: 750, menge_liter_gefuellt: 900, weinausbau_id: 'A', aktiv: true, erstellt_am: '2026-03-01T10:00:00Z' }
    const d = daten({ mengeA: 0, fuellungen: [f] })
    d.weinanalysen = [
      { tenant_id: T, weinausbau_id: 'A', analyse_datum: '2026-02-10', labor: 'Klosterneuburg' },
      { tenant_id: T, weinausbau_id: 'A', analyse_datum: '2026-04-01', labor: 'zu spät' },
    ]
    const wb = await buildWeinbuch(datenbank(d), 'A', T)
    assert.equal(wb.abgeschlossenAm, '2026-03-01')
    assert.ok(wb.events.some(e => e.titel === 'Analyse – Klosterneuburg'))
    assert.ok(!wb.events.some(e => e.titel === 'Analyse – zu spät'))
    assert.equal(wb.events.at(-1).typ, 'fuellung')
    // noch nicht leer → kein Ende
    assert.equal((await buildWeinbuch(datenbank(daten({ mengeA: 400, fuellungen: [f] })), 'A', T)).abgeschlossenAm, null)
  })

  test('keine RPC mehr, gemeinsamer Kern mit der Rückverfolgung Weingarten', () => {
    const w = readFileSync(new URL('../../src/lib/wein/weinbuch.ts', import.meta.url), 'utf8')
    assert.doesNotMatch(w, /['"`]get_behandlungen_fuer_grundstuecke['"`]|\.rpc\b/)
    assert.match(w, /ladeRvWeingarten\(supabase, tenantId, \{ charge: id/)
  })
})
