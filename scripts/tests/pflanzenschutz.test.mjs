// Tests der Behördenmeldungen „Pflanzenschutz & Düngung“ (24.09.2026):
//   psm-aufzeichnung, psm-mittelverbrauch, cu-bilanz, cu-bilanz-behandlungen, naehrstoffbilanz
// – Berechnung (lib/behoerden/psm.ts, cu.ts, naehrstoff.ts), Spalten/Formatierung (PROFIL_EXCEL_AT)
// und das Register (Parameter, Dateiname, Ladefunktion gegen einen Supabase-Ersatz ohne Datenbank).
//
// Aufruf:  node --experimental-strip-types --disable-warning=ExperimentalWarning \
//               --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test scripts/tests/pflanzenschutz.test.mjs
//          (Node ≥ 22.15 wegen module.registerHooks; keine zusätzliche Abhängigkeit)
//
// Die Quelldateien nutzen '@/'-Aliase und Importe ohne Endung (Next/TypeScript). Ein Resolve-Hook
// bildet beides auf src/…/*.ts ab und ersetzt 'server-only' durch ein leeres Modul.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'
import * as nodeModule from 'node:module'

const HIER = path.dirname(fileURLToPath(import.meta.url))
const SRC = path.resolve(HIER, '../../src')
const BOM = '\uFEFF'

const hooksMoeglich = typeof nodeModule.registerHooks === 'function'
if (hooksMoeglich) {
  nodeModule.registerHooks({
    resolve(spezifizierer, kontext, weiter) {
      if (spezifizierer === 'server-only') return { url: 'data:text/javascript,export {}', shortCircuit: true }
      let basis = null
      if (spezifizierer.startsWith('@/')) basis = path.join(SRC, spezifizierer.slice(2))
      else if (/^\.\.?\//.test(spezifizierer) && !path.extname(spezifizierer) && kontext.parentURL?.startsWith('file:')) {
        basis = path.resolve(path.dirname(fileURLToPath(kontext.parentURL)), spezifizierer)
      }
      if (basis) {
        for (const kandidat of [basis + '.ts', basis + '.tsx', path.join(basis, 'index.ts')]) {
          if (existsSync(kandidat)) return weiter(pathToFileURL(kandidat).href, kontext)
        }
      }
      return weiter(spezifizierer, kontext)
    },
  })
}

const laden = async (rel) => import(pathToFileURL(path.join(SRC, rel)).href)
const [csv, psm, cu, nst, register, katalog] = hooksMoeglich
  ? await Promise.all([
      laden('lib/csv/index.ts'), laden('lib/behoerden/psm.ts'), laden('lib/behoerden/cu.ts'),
      laden('lib/behoerden/naehrstoff.ts'), laden('lib/behoerden/register/pflanzenschutz.ts'),
      laden('lib/behoerden/katalog/pflanzenschutz.ts'),
    ])
  : []
const nurMitHooks = { skip: hooksMoeglich ? false : 'module.registerHooks fehlt (Node ≥ 22.15 nötig)' }

// ── Testdaten in der Form der PostgREST-Antwort von ladeBehandlungen() ─────────

const L1 = '11111111-1111-4111-8111-111111111111'
const L2 = '22222222-2222-4222-8222-222222222222'
const WG1 = { id: 'wg-1', name: 'Pfaffenberg Riesling', ried: 'Pfaffenberg', flaeche_ha: 1.2, lage_id: L1, lagen: { name: 'Ried Pfaffenberg' } }
const WG2 = { id: 'wg-2', name: 'Steiner Hund Riesling', ried: null, flaeche_ha: 0.9, lage_id: L2, lagen: { name: 'Ried Steiner Hund' } }
const GST1 = { id: 'g-1', gst_nr: '123/1', katastralgemeinde: '04023', kg_bezeichnung: 'Stein', flaeche_ha: 1.2, weingarten: WG1 }
const GST2 = { id: 'g-2', gst_nr: '=1+1', katastralgemeinde: '12127', kg_bezeichnung: 'Stein', flaeche_ha: 0.9, weingarten: WG2 }
const CUPROZIN = { id: 'p-cu', name: 'Cuprozin', handelsname: 'Cuprozin progress', wirkstoff: 'Kupferhydroxid', wirkstoffgehalt_pct: 53.7, zulassungsnr: '3212-0', eppo_code: null, cu_gehalt_pct: 35, wartezeit_tage: 21, max_aufwand_kg_ha: 2, max_anwendungen: 6, oeko_zugelassen: true }
const FOLPAN = { id: 'p-fo', name: 'Folpan 80 WDG', handelsname: null, wirkstoff: 'Folpet', wirkstoffgehalt_pct: 80, zulassungsnr: '2648-0', eppo_code: 'VITVI', cu_gehalt_pct: 0, wartezeit_tage: 35, max_aufwand_kg_ha: 1.5, max_anwendungen: 1, oeko_zugelassen: false }
const BORDEAUX = { id: 'p-bo', name: 'Bordeaux Manica 20', handelsname: null, wirkstoff: 'Kupfersulfat', wirkstoffgehalt_pct: 20, zulassungsnr: '3410-0', eppo_code: null, cu_gehalt_pct: null, wartezeit_tage: 21, max_aufwand_kg_ha: null, max_anwendungen: null, oeko_zugelassen: true }

function roh(teil) {
  return {
    id: 'b-x', datum: '2026-01-01', datum_bis: null, art: 'spritzung', weingarten_id: null, psm_id: null, duengemittel_id: null,
    durchgefuehrt_von: null, aufwandmenge: null, aufwandmenge_einheit: null, menge_gesamt: null, menge_einheit: null,
    konzentration: null, wasseraufwand_l_ha: null, behandelte_flaeche_ha: null, bbch_stadium: null, schaderreger: null,
    witterung: null, temperatur_c: null, windstaerke: null, ernte_fruehesteins: null, wartezeit_eingehalten: null, notizen: null,
    weingarten: null, psm: null, duengemittel: null, behandlung_grundstuecke: [],
    ...teil,
  }
}

const A = roh({ // Kupfer auf zwei Grundstücken in zwei Rieden, 1,5 kg/ha × 2,1 ha = 3,15 kg
  id: 'b-a', datum: '2026-07-10', psm_id: 'p-cu', psm: CUPROZIN, durchgefuehrt_von: 'u-1',
  aufwandmenge: 1.5, aufwandmenge_einheit: 'kg_ha', menge_gesamt: 3.15, menge_einheit: 'kg', konzentration: 0.25,
  wasseraufwand_l_ha: 600, bbch_stadium: '75', schaderreger: 'Peronospora', witterung: 'bewoelkt', temperatur_c: 28,
  windstaerke: 'maessig', ernte_fruehesteins: '2026-07-31', wartezeit_eingehalten: true, notizen: 'Test; "Zitat"\nzweite Zeile',
  weingarten_id: 'wg-1', weingarten: WG1,
  behandlung_grundstuecke: [
    { grundstueck_id: 'g-2', flaeche_ha: 0.9, grundstueck: GST2 },
    { grundstueck_id: 'g-1', flaeche_ha: 1.2, grundstueck: GST1 },
  ],
})
const E = roh({ // ohne Grundstücke – nur Weingarten aus weingarten_id
  id: 'b-e', datum: '2026-06-14', psm_id: 'p-fo', psm: FOLPAN, aufwandmenge: 1, aufwandmenge_einheit: 'kg_ha',
  menge_gesamt: 1.2, menge_einheit: 'kg', bbch_stadium: '05', weingarten_id: 'wg-1', weingarten: WG1,
})
const F = roh({ // Kupfer 2022 (für 5-/7-Jahres-Summe), Cu-Gehalt nur als Wirkstoffgehalt
  id: 'b-f', datum: '2022-07-01', psm_id: 'p-bo', psm: BORDEAUX, menge_gesamt: 10, menge_einheit: 'kg',
  behandlung_grundstuecke: [{ grundstueck_id: 'g-1', flaeche_ha: 1.2, grundstueck: GST1 }],
})
const B = roh({ // Düngung
  id: 'b-b', datum: '2026-03-25', art: 'duengung', duengemittel_id: 'd-1',
  duengemittel: { id: 'd-1', name: 'Biosol', handelsname: null, typ: 'organisch', naehrstoff_n_pct: 6, naehrstoff_p_pct: 1, oeko_zugelassen: true },
  menge_gesamt: 3275, menge_einheit: 'kg', aufwandmenge: 500, aufwandmenge_einheit: 'kg_ha',
  behandlung_grundstuecke: [{ grundstueck_id: 'g-1', flaeche_ha: 1.2, grundstueck: GST1 }],
})
const C = roh({ id: 'b-c', datum: '2026-04-01', art: 'duengung', menge_gesamt: 100, menge_einheit: 'kg', weingarten_id: 'wg-2', weingarten: WG2 })
const D = roh({
  id: 'b-d', datum: '2026-04-02', art: 'duengung', duengemittel: { id: 'd-2', name: 'Flüssigdünger', typ: 'mineralisch', naehrstoff_n_pct: 8, naehrstoff_p_pct: 0 },
  menge_gesamt: 50, menge_einheit: 'l', weingarten_id: 'wg-2', weingarten: WG2,
})
const WEINGAERTEN_ROH = [
  { ...WG1, aktiv: true },
  { ...WG2, aktiv: true },
  { id: 'wg-3', name: 'Alt (gerodet)', ried: null, flaeche_ha: 2, aktiv: false, lage_id: null, lagen: null },
]
const NAMEN = new Map([['u-1', 'Maria Muster']])

function zeilenVon(text) {
  assert.ok(text.startsWith(BOM), 'BOM fehlt')
  assert.ok(text.endsWith('\r\n'), 'abschließendes CRLF fehlt')
  return text.slice(1, -2).split('\r\n')
}

// ── psm-aufzeichnung ─────────────────────────────────────────────────────────

describe('psm-aufzeichnung', nurMitHooks, () => {
  test('eine Zeile je Maßnahme × Grundstück, Codes unverändert, Formelschutz, Umbrüche', () => {
    const b = [psm.normalisiereBehandlung(A, NAMEN), psm.normalisiereBehandlung(E)]
    assert.equal(b[0].flaecheHa, 2.1)
    assert.equal(b[0].flaecheQuelle, 'grundstuecke')
    assert.equal(b[1].flaecheQuelle, 'weingarten')
    const { zeilen, warnungen } = psm.psmAufzeichnungZeilen(b)
    assert.equal(zeilen.length, 3)
    assert.equal(warnungen.length, 1)
    assert.match(warnungen[0], /1 Maßnahme ist keinem Grundstück zugeordnet/)

    const datei = csv.csvDatei(zeilen, psm.SPALTEN_PSM_AUFZEICHNUNG)
    assert.deepEqual(datei.warnungen, [])
    const [kopf, z1, z2, z3] = zeilenVon(datei.text)
    assert.equal(kopf, 'Datum;Datum bis;Art;Ried;Weingarten;KG-Nr.;Katastralgemeinde;GST-Nr.;Fläche (ha);Kultur;EPPO-Code Kultur;Mittel;Zulassungsnr.;Wirkstoff;Schaderreger;BBCH;Aufwand;Aufwand-Einheit;Gesamtmenge;Mengeneinheit;Menge anteilig (GST);Wasseraufwand (l/ha);Konzentration (%);Wartezeit (Tage);Frühester Lesetermin;Wartezeit eingehalten;Öko-zugelassen;Anwender;Witterung;Temperatur (°C);Wind;Notiz')
    // sortiert nach Ried: Pfaffenberg vor Steiner Hund; anteilige Menge 3,15 × 1,2/2,1 = 1,8
    assert.equal(z1, '10.07.2026;;Spritzung;Ried Pfaffenberg;Pfaffenberg Riesling;04023;Stein;123/1;1,2000;Weinrebe;VITVI;Cuprozin progress;3212-0;Kupferhydroxid;Peronospora;75;1,500;kg/ha;3,150;kg;1,800;600,0;0,25;21;31.07.2026;Ja;Ja;Maria Muster;bewölkt;28,0;mäßig;"Test; ""Zitat"" zweite Zeile"')
    assert.equal(z2, "10.07.2026;;Spritzung;Ried Steiner Hund;Steiner Hund Riesling;12127;Stein;'=1+1;0,9000;Weinrebe;VITVI;Cuprozin progress;3212-0;Kupferhydroxid;Peronospora;75;1,500;kg/ha;3,150;kg;1,350;600,0;0,25;21;31.07.2026;Ja;Ja;Maria Muster;bewölkt;28,0;mäßig;\"Test; \"\"Zitat\"\" zweite Zeile\"")
    // ohne GST: Weingarten-Zeile, Fläche = Weingartenfläche, ganze Menge, BBCH „05“ bleibt Code
    assert.equal(z3, '14.06.2026;;Spritzung;Ried Pfaffenberg;Pfaffenberg Riesling;;;;1,2000;Weinrebe;VITVI;Folpan 80 WDG;2648-0;Folpet;;05;1,000;kg/ha;1,200;kg;1,200;;;35;;;Nein;;;;;')
  })

  test('Ried-Filter nur auf die Grundstücke dieser Ried', () => {
    const b = [psm.normalisiereBehandlung(A), psm.normalisiereBehandlung(E)]
    const { zeilen } = psm.psmAufzeichnungZeilen(b, { ried: L2 })
    assert.equal(zeilen.length, 1)
    assert.equal(zeilen[0].gstNr, '=1+1')
    assert.equal(psm.psmAufzeichnungZeilen(b, { ried: psm.OHNE_RIED }).zeilen.length, 0)
  })

  test('Leermeldung: nur Kopfzeile', () => {
    const d = csv.csvDatei([], psm.SPALTEN_PSM_AUFZEICHNUNG)
    assert.equal(d.zeilen, 0)
    assert.equal(zeilenVon(d.text).length, 1)
  })
})

// ── psm-mittelverbrauch ──────────────────────────────────────────────────────

describe('psm-mittelverbrauch', nurMitHooks, () => {
  test('je Saison × Mittel, Ø Aufwand und Grenzwerte', () => {
    const b = [A, E, F].map(x => psm.normalisiereBehandlung(x))
    const zeilen = psm.mittelverbrauch([...b, psm.normalisiereBehandlung({ ...E, id: 'b-e2', datum: '2026-08-01' })])
    assert.deepEqual(zeilen.map(z => `${z.jahr}|${z.mittel}`), ['2026|Cuprozin progress', '2026|Folpan 80 WDG', '2022|Bordeaux Manica 20'])
    const folpan = zeilen[1]
    assert.equal(folpan.anwendungen, 2)
    assert.equal(folpan.anwendungenUeber, true)       // max. 1 Anwendung je Saison
    assert.equal(folpan.status, 'Anwendungen über Grenzwert')
    const [kopf, z1] = zeilenVon(csv.csvText(zeilen, psm.SPALTEN_PSM_MITTELVERBRAUCH))
    assert.equal(kopf, 'Jahr;Mittel;Zulassungsnr.;Wirkstoff;Anwendungen;Max. Anwendungen;Gesamtmenge;Einheit;Behandelte Fläche (ha);Ø Aufwand (Einheit/ha);Ø Aufwand (kg/ha);Grenzwert Aufwand (kg/ha);Status')
    assert.equal(z1, '2026;Cuprozin progress;3212-0;Kupferhydroxid;1;6;3,150;kg;2,1000;1,500;1,500;2,000;OK')
  })

  test('Grenzwert kg/ha nur für Massen: g → /1000, l/ml „nicht vergleichbar“', () => {
    const mittel = { id: 'm1', name: 'Testmittel', max_aufwand_kg_ha: 1.5 }
    const mit = (einheit, menge) => psm.normalisiereBehandlung({ ...A, id: 'x-' + einheit, menge_gesamt: menge, menge_einheit: einheit, psm: { ...A.psm, ...mittel } })
    const [g] = psm.mittelverbrauch([mit('g', 4200)])                            // 4200 g auf 2,1 ha = 2 kg/ha
    assert.equal(g.einheit, 'g')
    assert.equal(g.aufwandJeHa, 2000)
    assert.equal(g.aufwandKgHa, 2)
    assert.equal(g.aufwandUeber, true)
    const [gOk] = psm.mittelverbrauch([mit('g', 1050)])                          // 0,5 kg/ha – früher fälschlich „über Grenzwert“ (500 > 1,5)
    assert.equal(gOk.aufwandUeber, false)
    assert.equal(gOk.status, 'OK')
    const [l] = psm.mittelverbrauch([mit('l', 1)])
    assert.equal(l.aufwandKgHa, null)
    assert.equal(l.aufwandUeber, false)
    assert.equal(l.aufwandNichtVergleichbar, true)
    assert.match(l.status, /Aufwand-Grenzwert nicht vergleichbar \(Einheit l, Grenzwert in kg\/ha\)/)
  })
})

// ── Kupfer-Bilanz ────────────────────────────────────────────────────────────

describe('cu-bilanz', nurMitHooks, () => {
  const wg = () => WEINGAERTEN_ROH.map(w => ({ id: w.id, name: w.name, ried: w.lagen?.name ?? w.ried, lageId: w.lage_id, flaecheHa: w.flaeche_ha, aktiv: w.aktiv }))

  test('je Weingarten anteilig, Betrieb über aktive Fläche, 5-/7-Jahres-Summe', () => {
    const b = [A, E, F].map(x => psm.normalisiereBehandlung(x))
    const bilanz = cu.cuBilanz(b, wg(), { jahre: [2026] })
    assert.equal(bilanz.gesamtHa, 2.1)                   // inaktiver Weingarten zählt nicht
    const j = bilanz.jahre[0]
    assert.equal(j.jahr, 2026)
    assert.equal(j.cuKg, 1.1025)                          // 3,15 kg × 35 %
    assert.equal(j.cuKgHa, 0.525)
    assert.equal(j.cuKgHa5J, 1.4774)                      // (1,1025 + 2) / 2,1
    assert.equal(j.status, 'ok')
    assert.equal(bilanz.behandlungsZeilen.length, 1)     // 2022 nur in den Summen
    assert.ok(bilanz.warnungen.every(w => !w.includes('Bordeaux')), 'Hinweise der Vorjahre gehören nicht in das Jahr')

    const [kopf, z1, z2] = zeilenVon(csv.csvText(bilanz.weingartenZeilen, cu.SPALTEN_CU_BILANZ))
    assert.equal(kopf, 'Jahr;Weingarten;Ried;Fläche (ha);Kupfer-Anwendungen;Cu (kg);Cu (kg/ha);Grenzwert (kg/ha/Jahr);Auslastung (%);Status;Cu 5 Jahre (kg/ha);Cu 7 Jahre (kg/ha)')
    assert.equal(z1, '2026;Pfaffenberg Riesling;Ried Pfaffenberg;1,2000;1;0,6300;0,5250;4,00;13,1;im Rahmen;2,1917;2,1917')
    assert.equal(z2, '2026;Steiner Hund Riesling;Ried Steiner Hund;0,9000;1;0,4725;0,5250;4,00;13,1;im Rahmen;0,5250;0,5250')

    const [kopfB, zB] = zeilenVon(csv.csvText(bilanz.behandlungsZeilen, cu.SPALTEN_CU_BEHANDLUNGEN))
    assert.equal(kopfB, 'Datum;Weingarten;Ried;Mittel;Zulassungsnr.;Cu-Gehalt (%);Cu-Gehalt Quelle;Menge;Einheit;Mittelmenge (kg);Mengenbasis;Behandelte Fläche (ha);Cu (kg);Cu (kg/ha)')
    assert.equal(zB, '10.07.2026;Pfaffenberg Riesling, Steiner Hund Riesling;Ried Pfaffenberg, Ried Steiner Hund;Cuprozin progress;3212-0;35,00;Stammdaten;3,150;kg;3,150;Gesamtmenge;2,1000;1,1025;0,5250')
  })

  test('alle Jahre, Cu-Gehalt-Näherung und Liter-Hinweis', () => {
    const liter = psm.normalisiereBehandlung(roh({
      id: 'b-l', datum: '2025-06-01', psm: { ...CUPROZIN, id: 'p-cul', handelsname: 'Kupfer flüssig' }, aufwandmenge: 2, aufwandmenge_einheit: 'l_ha',
      menge_gesamt: 480, menge_einheit: 'l', wasseraufwand_l_ha: 400,
      behandlung_grundstuecke: [{ grundstueck_id: 'g-1', flaeche_ha: 1.2, grundstueck: GST1 }],
    }))
    const b = [...[A, F].map(x => psm.normalisiereBehandlung(x)), liter]
    const bilanz = cu.cuBilanz(b, wg())
    assert.deepEqual(bilanz.jahre.map(j => j.jahr), [2026, 2025, 2022])
    const zl = bilanz.behandlungsZeilen.find(z => z.behandlungId === 'b-l')
    assert.equal(zl.mengeKg, 2.4)                          // Aufwand 2 l/ha × 1,2 ha, nicht die 480 l Spritzbrühe
    assert.equal(zl.mengeBasis, 'Aufwand × Fläche (1 kg/l)')
    const zf = bilanz.behandlungsZeilen.find(z => z.behandlungId === 'b-f')
    assert.equal(zf.cuGehaltQuelle, 'Wirkstoffgehalt (Näherung)')
    assert.equal(zf.cuKg, 2)
    assert.ok(bilanz.warnungen.some(w => w.includes('Dichte 1 kg/l')))
    assert.ok(bilanz.warnungen.some(w => w.includes('Bordeaux Manica 20') && w.includes('Näherung')))
    // Zeilen je Weingarten aufsteigend nach Jahr
    assert.deepEqual([...new Set(bilanz.weingartenZeilen.map(z => z.jahr))], [2022, 2025, 2026])
  })

  test('Ampel', () => {
    assert.equal(cu.cuStatus(4.01), 'ueber')
    assert.equal(cu.cuStatus(3.21), 'warnung')
    assert.equal(cu.cuStatus(3.2), 'ok')
    assert.equal(cu.cuStatus(null), null)
  })
})

// ── Nährstoffbilanz ──────────────────────────────────────────────────────────

describe('naehrstoffbilanz', nurMitHooks, () => {
  test('je Düngung, übersprungene Einträge als Hinweis', () => {
    const b = [A, B, C, D].map(x => psm.normalisiereBehandlung(x))
    const wg = WEINGAERTEN_ROH.map(w => ({ id: w.id, name: w.name, ried: w.lagen?.name ?? null, lageId: w.lage_id, flaecheHa: w.flaeche_ha, aktiv: w.aktiv }))
    const bilanz = nst.naehrstoffbilanz(b, wg)
    assert.equal(bilanz.zeilen.length, 1)
    assert.equal(bilanz.uebersprungen, 2)
    assert.equal(bilanz.warnungen.length, 2)
    assert.match(bilanz.warnungen[0], /1 Düngung ohne Düngemittel – nicht in der Bilanz: Düngung am 01\.04\.2026 \(Steiner Hund Riesling\)/)
    assert.match(bilanz.warnungen[1], /Flüssigdünger, 50 l/)
    assert.equal(bilanz.nKg, 196.5)
    assert.equal(bilanz.nKgHa, 93.571)                     // 196,5 / 2,1 ha (aktive Weingärten)
    const [kopf, z1] = zeilenVon(csv.csvText(bilanz.zeilen, nst.SPALTEN_NAEHRSTOFFBILANZ))
    assert.equal(kopf, 'Datum;Weingarten;Ried;Fläche (ha);Düngemittel;Typ;Menge;Einheit;Menge (kg);Mengenbasis;N (%);P (%);N (kg);P (kg);N (kg/ha);P (kg/ha)')
    assert.equal(z1, '25.03.2026;Pfaffenberg Riesling;Ried Pfaffenberg;1,2000;Biosol;organisch;3275,000;kg;3275,000;Gesamtmenge;6,00;1,00;196,500;32,750;163,750;27,292')
  })

  test('Aufwand kg/ha × Fläche, wenn die Gesamtmenge fehlt', () => {
    const x = psm.normalisiereBehandlung({ ...B, menge_gesamt: null, menge_einheit: null })
    assert.deepEqual(psm.mittelmengeKg(x, { literAlsKg: false }), { kg: 600, basis: 'Aufwand × Fläche', dichteAngenommen: false })
  })
})

// ── Register (Parameter, Dateiname, Ladefunktion mit Supabase-Ersatz) ─────────

class Abfrage {
  constructor(quelle) {
    this.tabelle = quelle.tabelle
    this.daten = quelle.daten
    this.filter = [...(quelle.filter ?? [])]
    this.protokoll = quelle.protokoll
  }
  select() { return this }
  order() { return this }
  eq(k, v) { this.filter.push(['eq', k, v]); return this }
  gte(k, v) { this.filter.push(['gte', k, v]); return this }
  lte(k, v) { this.filter.push(['lte', k, v]); return this }
  in(k, v) { this.filter.push(['in', k, v]); return this }
  range(von, bis) {
    this.protokoll.push({ tabelle: this.tabelle, filter: this.filter })
    let zeilen = this.daten[this.tabelle] ?? []
    for (const [op, k, v] of this.filter) {
      if (k === 'tenant_id') continue
      if (op === 'eq') zeilen = zeilen.filter(z => z[k] === v)
      if (op === 'gte') zeilen = zeilen.filter(z => z[k] >= v)
      if (op === 'lte') zeilen = zeilen.filter(z => z[k] <= v)
      if (op === 'in') zeilen = zeilen.filter(z => v.includes(z[k]))
    }
    return Promise.resolve({ data: zeilen.slice(von, bis + 1), error: null })
  }
  then(ok, fehler) { return this.range(0, 999).then(ok, fehler) }
}

function supabaseErsatz(daten) {
  const protokoll = []
  return { protokoll, from: tabelle => new Abfrage({ tabelle, daten, protokoll }) }
}

const DATEN = {
  behandlungen: [A, E, F, B, C, D],
  weingarten: WEINGAERTEN_ROH,
  profiles: [{ id: 'u-1', full_name: 'Maria Muster', display_name: null }],
}

describe('register/pflanzenschutz', nurMitHooks, () => {
  const M = () => register.MELDUNGEN_PFLANZENSCHUTZ
  const ctx = (sb) => ({ supabase: sb, tenantId: 't-1', membership: { tenantId: 't-1', role: 'winzer', schreibmodule: [] }, betrieb: { name: 'Weingut Test', betriebsnummer: '1234567' } })

  test('Register = Katalog, Zugriff betriebsleitung, Druckpfade', () => {
    assert.deepEqual(Object.keys(M()).sort(), Object.keys(katalog.KATALOG_PFLANZENSCHUTZ).sort())
    for (const m of Object.values(M())) {
      assert.equal(m.zugriff, 'betriebsleitung')
      assert.equal(m.gruppe, 'pflanzenschutz')
      assert.ok(m.druckPfad, `${m.id}: druckPfad fehlt`)
      assert.ok(m.spalten.length > 0)
    }
  })

  test('Parameter und Dateiname', () => {
    const p = (id, q) => M()[id].parameter(new URLSearchParams(q))
    assert.deepEqual(p('psm-aufzeichnung', 'jahr=2026&art=spritzung&ried=' + L1), { jahr: 2026, art: 'spritzung', ried: L1 })
    assert.deepEqual(p('psm-aufzeichnung', ''), { jahr: null, art: null, ried: null })
    assert.equal(p('psm-aufzeichnung', 'art=gift').parameterFehler, true)
    assert.equal(p('psm-aufzeichnung', 'ried=x').parameterFehler, true)
    assert.equal(p('cu-bilanz', 'jahr=26').parameterFehler, true)
    assert.deepEqual(p('naehrstoffbilanz', 'jahr=all'), { jahr: null })
    const name = csv.csvDateiname(M()['naehrstoffbilanz'].dateiteile({ jahr: 2026 }, { name: null, betriebsnummer: '1234567' }), '2026-09-24')
    assert.deepEqual(name, { utf8: 'Nährstoffbilanz_1234567_2026_2026-09-24.csv', ascii: 'Naehrstoffbilanz_1234567_2026_2026-09-24.csv' })
    const alle = csv.csvDateiname(M()['psm-aufzeichnung'].dateiteile({ jahr: null, art: 'spritzung', ried: null }, { name: null, betriebsnummer: null }), '2026-09-24')
    assert.equal(alle.utf8, 'Pflanzenschutz-Aufzeichnung_alle-Jahre_Spritzung_2026-09-24.csv')
  })

  test('Ladefunktionen: Mandantenfilter, Zeitraum, Zeilen', async () => {
    const sb = supabaseErsatz(DATEN)
    const auf = await M()['psm-aufzeichnung'].laden(ctx(sb), { jahr: 2026, art: 'spritzung', ried: null })
    assert.equal(auf.zeilen.length, 3)
    assert.equal(auf.zeilen[0].anwender, 'Maria Muster')
    const beh = sb.protokoll.find(x => x.tabelle === 'behandlungen')
    assert.deepEqual(beh.filter, [['eq', 'tenant_id', 't-1'], ['gte', 'datum', '2026-01-01'], ['lte', 'datum', '2026-12-31'], ['eq', 'art', 'spritzung']])

    const sb2 = supabaseErsatz(DATEN)
    const cuB = await M()['cu-bilanz'].laden(ctx(sb2), { jahr: 2026 })
    assert.equal(cuB.zeilen.length, 2)
    assert.deepEqual(sb2.protokoll.find(x => x.tabelle === 'behandlungen').filter.slice(0, 3), [['eq', 'tenant_id', 't-1'], ['gte', 'datum', '2020-01-01'], ['lte', 'datum', '2026-12-31']])
    assert.ok(sb2.protokoll.filter(x => x.tabelle === 'weingarten').every(x => x.filter.some(([op, k, v]) => op === 'eq' && k === 'tenant_id' && v === 't-1')))
    const cuE = await M()['cu-bilanz-behandlungen'].laden(ctx(supabaseErsatz(DATEN)), { jahr: 2026 })
    assert.equal(cuE.zeilen.length, 1)

    const n = await M()['naehrstoffbilanz'].laden(ctx(supabaseErsatz(DATEN)), { jahr: 2026 })
    assert.equal(n.zeilen.length, 1)
    assert.equal(n.warnungen.length, 2)

    const mv = await M()['psm-mittelverbrauch'].laden(ctx(supabaseErsatz(DATEN)), { jahr: null })
    assert.equal(mv.zeilen.length, 3)

    const leer = await M()['psm-aufzeichnung'].laden(ctx(supabaseErsatz({ behandlungen: [], weingarten: [] })), { jahr: 2026, art: null, ried: null })
    assert.equal(leer.zeilen.length, 0)
    assert.equal(zeilenVon(csv.csvDatei(leer.zeilen, M()['psm-aufzeichnung'].spalten).text).length, 1)
  })
})
