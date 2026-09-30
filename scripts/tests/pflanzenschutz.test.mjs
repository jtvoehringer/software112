// Tests der Behördenmeldungen „Pflanzenschutz & Düngung“ (24.09.2026):
//   psm-aufzeichnung, psm-mittelverbrauch, cu-bilanz, cu-bilanz-behandlungen, naehrstoffbilanz
// – Berechnung (lib/behoerden/psm.ts, cu.ts, naehrstoff.ts), Spalten/Formatierung (PROFIL_EXCEL_AT)
// und das Register (Parameter, Dateiname, Ladefunktion gegen einen Supabase-Ersatz ohne Datenbank).
// KAN-133 (26.09.2026): mittelmenge() – bei Spritzungen ist „Menge gesamt“ die Spritzbrühe (l) und
// nie die Mittelmenge; Mittelmenge nur aus dem Aufwand. Betriebsfläche als Σ WI-GST-Fläche.
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

const A = roh({ // Kupfer auf zwei Grundstücken in zwei Rieden, 1,5 kg/ha × 2,1 ha = 3,15 kg; Spritzbrühe 600 l/ha × 2,1 ha = 1260 l
  id: 'b-a', datum: '2026-07-10', psm_id: 'p-cu', psm: CUPROZIN, durchgefuehrt_von: 'u-1',
  aufwandmenge: 1.5, aufwandmenge_einheit: 'kg_ha', menge_gesamt: 1260, menge_einheit: 'l', konzentration: 0.25,
  wasseraufwand_l_ha: 600, bbch_stadium: '75', schaderreger: 'Peronospora', witterung: 'bewoelkt', temperatur_c: 28,
  windstaerke: 'maessig', ernte_fruehesteins: '2026-07-31', wartezeit_eingehalten: true, notizen: 'Test; "Zitat"\nzweite Zeile',
  weingarten_id: 'wg-1', weingarten: WG1,
  behandlung_grundstuecke: [
    { grundstueck_id: 'g-2', flaeche_ha: 0.9, grundstueck: GST2 },
    { grundstueck_id: 'g-1', flaeche_ha: 1.2, grundstueck: GST1 },
  ],
})
const E = roh({ // ohne Grundstücke – nur Weingarten aus weingarten_id; 1 kg/ha × 1,2 ha, Spritzbrühe 480 l
  id: 'b-e', datum: '2026-06-14', psm_id: 'p-fo', psm: FOLPAN, aufwandmenge: 1, aufwandmenge_einheit: 'kg_ha',
  menge_gesamt: 480, menge_einheit: 'l', bbch_stadium: '05', weingarten_id: 'wg-1', weingarten: WG1,
})
const F = roh({ // Kupfer 2022 (für 5-/7-Jahres-Summe), Cu-Gehalt nur als Wirkstoffgehalt; Aufwand 10 kg gesamt, Spritzbrühe 960 l
  id: 'b-f', datum: '2022-07-01', psm_id: 'p-bo', psm: BORDEAUX, aufwandmenge: 10, aufwandmenge_einheit: 'kg',
  menge_gesamt: 960, menge_einheit: 'l',
  behandlung_grundstuecke: [{ grundstueck_id: 'g-1', flaeche_ha: 1.2, grundstueck: GST1 }],
})
// Vor KAN-133 stand bei Spritzungen die Mittelmenge in „Menge gesamt“ (Altwert in kg): weder Spritzbrühe
// noch Mittelmenge – zählt nirgends, die Mittelmenge kommt weiter aus dem Aufwand
const ALT = (x, kg) => ({ ...x, menge_gesamt: kg, menge_einheit: 'kg' })
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
const WEINGAERTEN_ROH = [ // grundstuecke: eingebettet (ladeWeingaerten), nur Nutzart WI zählt zur Betriebsfläche
  { ...WG1, aktiv: true, grundstuecke: [{ flaeche_ha: 1.2, nutzart: 'WI' }, { flaeche_ha: 0.25, nutzart: 'A' }] },
  { ...WG2, aktiv: true, grundstuecke: [{ flaeche_ha: 0.9, nutzart: 'WI' }] },
  { id: 'wg-3', name: 'Alt (gerodet)', ried: null, flaeche_ha: 2, aktiv: false, lage_id: null, lagen: null, grundstuecke: [{ flaeche_ha: 2, nutzart: 'WI' }] },
]
/** WeingartenStamm wie aus ladeWeingaerten() (Betriebsfläche der Cu-Bilanz = Σ WI-GST der aktiven Weingärten = 2,1 ha) */
const wg = () => WEINGAERTEN_ROH.map(w => {
  const wi = w.grundstuecke.filter(g => g.nutzart === 'WI')
  return { id: w.id, name: w.name, ried: w.lagen?.name ?? w.ried, lageId: w.lage_id, flaecheHa: w.flaeche_ha, aktiv: w.aktiv, wiFlaecheHa: wi.reduce((s, g) => s + g.flaeche_ha, 0) }
})
const NAMEN = new Map([['u-1', 'Maria Muster']])

// KAN-133: Funguran-Beispiel (Gebeshuber) – Spritzung auf 2 GST mit Σ 2 ha, Spritzbrühe 800 l
const FUNGURAN = { id: 'p-fu', name: 'Funguran progress', handelsname: 'Funguran Progress', wirkstoff: 'Kupferhydroxid', wirkstoffgehalt_pct: 53.8, zulassungsnr: null, eppo_code: null, cu_gehalt_pct: 35, wartezeit_tage: 21, max_aufwand_kg_ha: 4, max_anwendungen: null, oeko_zugelassen: true }
const TOPAS = { id: 'p-to', name: 'Topas', handelsname: null, wirkstoff: 'Penconazol', wirkstoffgehalt_pct: 10, zulassungsnr: null, eppo_code: null, cu_gehalt_pct: null, wartezeit_tage: 14, max_aufwand_kg_ha: null, max_anwendungen: null, oeko_zugelassen: false }
const GST3 = { id: 'g-3', gst_nr: '124', katastralgemeinde: '04023', kg_bezeichnung: 'Stein', flaeche_ha: 0.8, weingarten: WG1 }
/** zwei GST mit Σ 2 ha */
const ZWEI_HA = [{ grundstueck_id: 'g-1', flaeche_ha: 1.2, grundstueck: GST1 }, { grundstueck_id: 'g-3', flaeche_ha: 0.8, grundstueck: GST3 }]
/** Spritzung auf 2 ha, Spritzbrühe 800 l (400 l/ha) */
const spritzung = (teil) => psm.normalisiereBehandlung(roh({
  id: 'b-s', datum: '2026-05-30', psm_id: 'p-fu', psm: FUNGURAN, menge_gesamt: 800, menge_einheit: 'l', wasseraufwand_l_ha: 400,
  behandlung_grundstuecke: ZWEI_HA, ...teil,
}))
const duengung = (teil) => psm.normalisiereBehandlung(roh({
  id: 'b-d', datum: '2026-03-25', art: 'duengung', duengemittel_id: 'd-1',
  duengemittel: { id: 'd-1', name: 'Biosol', typ: 'organisch', einheit: 'kg', naehrstoff_n_pct: 6, naehrstoff_p_pct: 1 },
  behandlung_grundstuecke: ZWEI_HA, ...teil,
}))

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
    assert.equal(kopf, 'Datum;Datum bis;Art;Ried;Weingarten;KG-Nr.;Katastralgemeinde;GST-Nr.;Fläche (ha);Kultur;EPPO-Code Kultur;Mittel;Zulassungsnr.;Wirkstoff;Schaderreger;BBCH;Aufwand;Aufwand-Einheit;Mittelmenge anteilig (GST);Mittelmenge Einheit;Mittelmenge Basis;Spritzbrühe anteilig (GST, l);Wasseraufwand (l/ha);Konzentration (%);Wartezeit (Tage);Frühester Lesetermin;Wartezeit eingehalten;Öko-zugelassen;Anwender;Witterung;Temperatur (°C);Wind;Notiz')
    // sortiert nach Ried: Pfaffenberg vor Steiner Hund; Mittelmenge 1,5 kg/ha × 2,1 ha = 3,15 kg,
    // anteilig 3,15 × 1,2/2,1 = 1,8 kg; Spritzbrühe 1260 l anteilig 720 l – keine Maßnahmen-Gesamtwerte je Zeile
    assert.equal(z1, '10.07.2026;;Spritzung;Ried Pfaffenberg;Pfaffenberg Riesling;04023;Stein;123/1;1,2000;Weinrebe;VITVI;Cuprozin progress;3212-0;Kupferhydroxid;Peronospora;75;1,500;kg/ha;1,800;kg;Aufwand × Fläche;720,000;600,0;0,25;21;31.07.2026;Ja;Ja;Maria Muster;bewölkt;28,0;mäßig;"Test; ""Zitat"" zweite Zeile"')
    assert.equal(z2, "10.07.2026;;Spritzung;Ried Steiner Hund;Steiner Hund Riesling;12127;Stein;'=1+1;0,9000;Weinrebe;VITVI;Cuprozin progress;3212-0;Kupferhydroxid;Peronospora;75;1,500;kg/ha;1,350;kg;Aufwand × Fläche;540,000;600,0;0,25;21;31.07.2026;Ja;Ja;Maria Muster;bewölkt;28,0;mäßig;\"Test; \"\"Zitat\"\" zweite Zeile\"")
    // ohne GST: Weingarten-Zeile, Fläche = Weingartenfläche, ganze Menge (1 kg/ha × 1,2 ha), BBCH „05“ bleibt Code
    assert.equal(z3, '14.06.2026;;Spritzung;Ried Pfaffenberg;Pfaffenberg Riesling;;;;1,2000;Weinrebe;VITVI;Folpan 80 WDG;2648-0;Folpet;;05;1,000;kg/ha;1,200;kg;Aufwand × Fläche;480,000;;;35;;;Nein;;;;;')
  })

  test('Funguran 0,6 kg/ha auf 2 GST: Σ Mittelmenge anteilig 1,2 kg, Σ Spritzbrühe anteilig 800 l', () => {
    const b = spritzung({ aufwandmenge: 0.6, aufwandmenge_einheit: 'kg_ha' })
    const { zeilen, warnungen } = psm.psmAufzeichnungZeilen([b])
    assert.deepEqual(warnungen, [])
    assert.deepEqual(zeilen.map(z => [z.gstNr, z.mittelmengeAnteil, z.mittelmengeEinheit, z.spritzbruehAnteil]), [['123/1', 0.72, 'kg', 480], ['124', 0.48, 'kg', 320]])
    assert.equal(csv.runden(zeilen.reduce((s, z) => s + z.mittelmengeAnteil, 0), 3), 1.2)   // nicht 800
    assert.equal(zeilen.reduce((s, z) => s + z.spritzbruehAnteil, 0), 800)
    // Tankmischung: Topas mit derselben Brühe – je Mittel eine eigene Zeile, Einheit l
    const topas = spritzung({ id: 'b-t2', psm_id: 'p-to', psm: TOPAS, aufwandmenge: 0.25, aufwandmenge_einheit: 'l_ha' })
    assert.deepEqual(psm.psmAufzeichnungZeilen([topas]).zeilen.map(z => [z.mittelmengeAnteil, z.mittelmengeEinheit]), [[0.3, 'l'], [0.2, 'l']])
  })

  test('Aufwand 1,2 kg gesamt auf 2 GST: Aufwand-Einheit „kg (gesamt)“, Σ Mittelmenge anteilig 1,2 kg', () => {
    const b = spritzung({ aufwandmenge: 1.2, aufwandmenge_einheit: 'kg' })
    const { zeilen } = psm.psmAufzeichnungZeilen([b])
    // der Aufwand bleibt Pflichtangabe, ist aber als Gesamtwert der Maßnahme gekennzeichnet – keine Menge je Grundstück
    assert.deepEqual(zeilen.map(z => [z.aufwand, z.aufwandEinheit, z.mittelmengeAnteil, z.mittelmengeBasis]),
      [[1.2, 'kg (gesamt)', 0.72, 'Aufwand (gesamt)'], [1.2, 'kg (gesamt)', 0.48, 'Aufwand (gesamt)']])
    assert.equal(csv.runden(zeilen.reduce((s, z) => s + z.mittelmengeAnteil, 0), 3), 1.2)
    const [, z1] = zeilenVon(csv.csvText(zeilen, psm.SPALTEN_PSM_AUFZEICHNUNG))
    assert.match(z1, /;1,200;kg \(gesamt\);0,720;kg;Aufwand \(gesamt\);480,000;/)
    // je ha und im Tank wie im Formular
    assert.deepEqual(['kg_ha', 'l_ha', 'g_hl', 'ml_hl', 'kg', 'l', null].map(psm.aufwandEinheitText),
      ['kg/ha', 'l/ha', 'g/hl (im Tank)', 'ml/hl (im Tank)', 'kg (gesamt)', 'l (gesamt)', ''])
  })

  test('ohne Aufwand, Altwert in kg und Düngung', () => {
    const ohne = spritzung({ id: 'b-o' })
    const alt = psm.normalisiereBehandlung(ALT(A, 3.15))
    const dueng = duengung({ menge_gesamt: 1000, menge_einheit: 'kg' })
    const { zeilen, warnungen } = psm.psmAufzeichnungZeilen([ohne, alt, dueng])
    // ohne Aufwand: keine Mittelmenge, Brühe trotzdem anteilig
    assert.deepEqual(zeilen.filter(z => z.behandlungId === 'b-o').map(z => [z.mittelmengeAnteil, z.mittelmengeEinheit, z.mittelmengeBasis, z.spritzbruehAnteil]), [[null, '', null, 480], [null, '', null, 320]])
    // Altwert: Mittelmenge aus dem Aufwand, die 3,15 kg „Menge gesamt“ sind keine Spritzbrühe –
    // die kommt nur aus Wasseraufwand × Fläche (600 l/ha × 2,1 ha = 1260 l), ohne Wasseraufwand bleibt sie leer
    assert.deepEqual(zeilen.filter(z => z.behandlungId === 'b-a').map(z => [z.mittelmengeAnteil, z.spritzbruehAnteil]), [[1.8, 720], [1.35, 540]])
    const altOhneWasser = psm.normalisiereBehandlung({ ...ALT(A, 3.15), wasseraufwand_l_ha: null })
    assert.deepEqual(psm.psmAufzeichnungZeilen([altOhneWasser]).zeilen.map(z => z.spritzbruehAnteil), [null, null])
    // Düngung: Düngermenge anteilig, keine Spritzbrühe
    assert.deepEqual(zeilen.filter(z => z.behandlungId === 'b-d').map(z => [z.mittelmengeAnteil, z.mittelmengeEinheit, z.mittelmengeBasis, z.spritzbruehAnteil]), [[600, 'kg', 'Düngermenge', null], [400, 'kg', 'Düngermenge', null]])
    assert.equal(warnungen.length, 2)
    assert.match(warnungen[0], /1 Maßnahme ohne berechenbare Mittelmenge .*Spritzung am 30\.05\.2026 .* – ohne Aufwand/)
    assert.match(warnungen[1], /1 Spritzung hat „Menge gesamt“ noch in kg bzw\. g/)
  })

  test('mehrere GST ohne Fläche: Anteile leer, Hinweis mit Mittelmenge und Spritzbrühe der Maßnahme', () => {
    const ohneFlaeche = [
      { grundstueck_id: 'g-1', flaeche_ha: null, grundstueck: { ...GST1, flaeche_ha: null } },
      { grundstueck_id: 'g-3', flaeche_ha: null, grundstueck: { ...GST3, flaeche_ha: null } },
    ]
    const b = spritzung({ aufwandmenge: 1.2, aufwandmenge_einheit: 'kg', behandlung_grundstuecke: ohneFlaeche })
    assert.deepEqual([psm.mittelmenge(b).menge, psm.mittelmenge(b).basis, psm.spritzbruehe(b)], [1.2, 'Aufwand (gesamt)', 800])
    const { zeilen, warnungen } = psm.psmAufzeichnungZeilen([b])
    assert.deepEqual(zeilen.map(z => [z.gstNr, z.mittelmengeAnteil, z.spritzbruehAnteil]), [['123/1', null, null], ['124', null, null]])
    assert.equal(warnungen.length, 1)
    assert.match(warnungen[0], /^1 Maßnahme hat Grundstücke ohne Fläche – .* bleiben dort leer, .*: Spritzung am 30\.05\.2026 \(Pfaffenberg Riesling\) – Mittelmenge 1,2 kg, Spritzbrühe 800 l \(nicht verteilt\)$/)
    // nur ein GST ohne Fläche: das andere trägt die ganze Menge (ohne Restausgleich, KAN-132), Hinweis trotzdem
    const teil = spritzung({ aufwandmenge: 1.2, aufwandmenge_einheit: 'kg', behandlung_grundstuecke: [ZWEI_HA[0], ohneFlaeche[1]] })
    const t = psm.psmAufzeichnungZeilen([teil])
    assert.deepEqual(t.zeilen.map(z => [z.mittelmengeAnteil, z.spritzbruehAnteil]), [[1.2, 800], [null, null]])
    assert.equal(t.warnungen.length, 1)
    assert.match(t.warnungen[0], /Mittelmenge 1,2 kg, Spritzbrühe 800 l \(nur auf GST mit Fläche verteilt\)$/)
    // Düngung ohne Fläche: Düngermenge genannt, keine Spritzbrühe
    const dueng = duengung({ menge_gesamt: 1000, menge_einheit: 'kg', behandlung_grundstuecke: ohneFlaeche })
    assert.match(psm.psmAufzeichnungZeilen([dueng]).warnungen[0], /Düngung am 25\.03\.2026 \(Pfaffenberg Riesling\) – Düngermenge 1\.000 kg \(nicht verteilt\)$/)
    // ohne Mittelmenge und ohne Spritzbrühe nur der bisherige Hinweis „ohne berechenbare Mittelmenge“
    const leer = spritzung({ menge_gesamt: null, menge_einheit: null, wasseraufwand_l_ha: null, behandlung_grundstuecke: ohneFlaeche })
    const l = psm.psmAufzeichnungZeilen([leer]).warnungen
    assert.equal(l.length, 1)
    assert.match(l[0], /ohne berechenbare Mittelmenge/)
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
  // Σ Mittelmenge aus mittelmenge() (KAN-133 Nr. 4) – „Menge gesamt“ ist bei Spritzungen die Spritzbrühe und zählt nicht
  test('je Saison × Mittel, Ø Aufwand und Grenzwerte', () => {
    const b = [A, E, F].map(x => psm.normalisiereBehandlung(x))
    const zeilen = psm.mittelverbrauch([...b, psm.normalisiereBehandlung({ ...E, id: 'b-e2', datum: '2026-08-01' })])
    assert.deepEqual(zeilen.map(z => `${z.jahr}|${z.mittel}`), ['2026|Cuprozin progress', '2026|Folpan 80 WDG', '2022|Bordeaux Manica 20'])
    const folpan = zeilen[1]
    assert.equal(folpan.anwendungen, 2)
    assert.equal(folpan.mittelmenge, 2.4)             // 2 × 1 kg/ha × 1,2 ha
    assert.equal(folpan.aufwandJeHa, 1)
    assert.equal(folpan.anwendungenUeber, true)       // max. 1 Anwendung je Saison
    assert.equal(folpan.status, 'Anwendungen über Grenzwert')
    assert.equal(zeilen[2].mittelmenge, 10)            // Bordeaux: Aufwand 10 kg gesamt, nicht die 960 l Spritzbrühe
    const [kopf, z1] = zeilenVon(csv.csvText(zeilen, psm.SPALTEN_PSM_MITTELVERBRAUCH))
    assert.equal(kopf, 'Jahr;Mittel;Zulassungsnr.;Wirkstoff;Anwendungen;Max. Anwendungen;Mittelmenge;Einheit;Behandelte Fläche (ha);Ø Aufwand (Einheit/ha);Ø Aufwand (kg/ha);Grenzwert Aufwand (kg/ha);Status')
    // 3,15 kg ÷ 2,1 ha = 1,5 kg/ha – nicht 1260 l Spritzbrühe ÷ 2,1 ha
    assert.equal(z1, '2026;Cuprozin progress;3212-0;Kupferhydroxid;1;6;3,150;kg;2,1000;1,500;1,500;2,000;OK')
    // Altwert („Menge gesamt“ in kg) ändert nichts: die Mittelmenge kommt weiter aus dem Aufwand
    assert.deepEqual(psm.mittelverbrauch([psm.normalisiereBehandlung(ALT(A, 99))]).map(z => [z.mittelmenge, z.einheit]), [[3.15, 'kg']])
  })

  test('Leermeldung: nur Kopfzeile', () => {
    const d = csv.csvDatei(psm.mittelverbrauch([]), psm.SPALTEN_PSM_MITTELVERBRAUCH)
    assert.equal(d.zeilen, 0)
    assert.equal(zeilenVon(d.text).length, 1)
  })

  test('Funguran 0,6 kg/ha × 2 ha, Spritzbrühe 800 l: Ø 0,6 kg/ha gegen 4 kg/ha „OK“', () => {
    const [z] = psm.mittelverbrauch([spritzung({ aufwandmenge: 0.6, aufwandmenge_einheit: 'kg_ha' })])
    assert.deepEqual([z.mittelmenge, z.einheit, z.flaecheHa, z.aufwandJeHa, z.aufwandKgHa, z.maxAufwandKgHa, z.status], [1.2, 'kg', 2, 0.6, 0.6, 4, 'OK'])
  })

  test('Grenzwert kg/ha nur für Mittel in kg: g → kg, l „nicht vergleichbar“', () => {
    const mittel = { id: 'm1', name: 'Testmittel', max_aufwand_kg_ha: 1.5 }
    const mit = (aufwand, einheit) => psm.normalisiereBehandlung({ ...A, id: 'x-' + einheit, aufwandmenge: aufwand, aufwandmenge_einheit: einheit, psm: { ...A.psm, ...mittel } })
    const [g] = psm.mittelverbrauch([mit(4200, 'g')])                            // 4200 g = 4,2 kg auf 2,1 ha = 2 kg/ha
    assert.equal(g.einheit, 'kg')
    assert.equal(g.mittelmenge, 4.2)
    assert.equal(g.aufwandJeHa, 2)
    assert.equal(g.aufwandKgHa, 2)
    assert.equal(g.aufwandUeber, true)
    const [gOk] = psm.mittelverbrauch([mit(1050, 'g')])                          // 0,5 kg/ha
    assert.equal(gOk.aufwandUeber, false)
    assert.equal(gOk.status, 'OK')
    const [hl] = psm.mittelverbrauch([mit(25, 'g_hl')])                          // 25 g/hl × 1260 l Spritzbrühe = 0,315 kg → 0,15 kg/ha
    assert.deepEqual([hl.mittelmenge, hl.aufwandKgHa, hl.status], [0.315, 0.15, 'OK'])
    const [l] = psm.mittelverbrauch([mit(0.25, 'l_ha')])                        // Grenzwert flüssiger Mittel: eigenes Ticket (Entscheidung 7)
    assert.deepEqual([l.mittelmenge, l.einheit, l.aufwandJeHa], [0.525, 'l', 0.25])
    assert.equal(l.aufwandKgHa, null)
    assert.equal(l.aufwandUeber, false)
    assert.equal(l.aufwandNichtVergleichbar, true)
    assert.match(l.status, /Aufwand-Grenzwert nicht vergleichbar \(Einheit l, Grenzwert in kg\/ha\)/)
    // kg und l desselben Mittels werden nicht addiert
    assert.deepEqual(psm.mittelverbrauch([mit(1, 'kg'), mit(1, 'l')]).map(z => z.einheit).sort(), ['kg', 'l'])
  })

  test('Hinweise: ohne Aufwand nicht enthalten, ohne Fläche nicht im Ø, nur Spritzungen', () => {
    const ohne = spritzung({ id: 'b-o' })                                         // Spritzbrühe 800 l, aber kein Aufwand
    const ohneFlaeche = spritzung({ id: 'b-g', aufwandmenge: 1.2, aufwandmenge_einheit: 'kg', behandlung_grundstuecke: [] })
    const mit = spritzung({ id: 'b-m', aufwandmenge: 0.6, aufwandmenge_einheit: 'kg_ha' })
    const [z] = psm.mittelverbrauch([ohne, ohneFlaeche, mit])
    assert.equal(z.anwendungen, 2)
    assert.equal(z.mittelmenge, 2.4)                    // 1,2 kg gesamt + 0,6 kg/ha × 2 ha
    assert.equal(z.aufwandJeHa, 0.6)                    // Ø nur über die Anwendung mit Fläche
    const h = psm.mittelverbrauchHinweise([ohne, ohneFlaeche, mit])
    assert.equal(h.length, 2)
    assert.match(h[0], /^1 Anwendung ohne berechenbare Mittelmenge – im Mittelverbrauch nicht enthalten: Spritzung am 30\.05\.2026 \(Pfaffenberg Riesling\) – Funguran Progress: ohne Aufwand$/)
    assert.match(h[1], /^1 Anwendung ohne behandelte Fläche/)
    const dueng = psm.normalisiereBehandlung(roh({ id: 'b-x', art: 'duengung', psm_id: 'p-fu', psm: FUNGURAN, aufwandmenge: 1, aufwandmenge_einheit: 'kg', behandlung_grundstuecke: ZWEI_HA }))
    assert.deepEqual(psm.mittelverbrauch([dueng]), [])
    assert.match(psm.mittelverbrauchHinweise([dueng])[0], /Düngung mit Pflanzenschutzmittel – es zählen nur Spritzungen/)
  })
})

// ── Kupfer-Bilanz ────────────────────────────────────────────────────────────

describe('cu-bilanz', nurMitHooks, () => {
  test('je Weingarten anteilig, Betrieb über WI-Fläche der aktiven Weingärten, 5-/7-Jahres-Summe', () => {
    const b = [A, E, F].map(x => psm.normalisiereBehandlung(x))
    const bilanz = cu.cuBilanz(b, wg(), { jahre: [2026] })
    assert.equal(bilanz.gesamtHa, 2.1)                   // Σ WI-GST: ohne Nutzart A (0,25 ha), inaktiver Weingarten zählt nicht
    const j = bilanz.jahre[0]
    assert.equal(j.jahr, 2026)
    assert.equal(j.cuKg, 1.1025)                          // Aufwand 1,5 kg/ha × 2,1 ha = 3,15 kg × 35 % (nicht die 1260 l Spritzbrühe)
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
    assert.equal(kopfB, 'Datum;Weingarten;Ried;Mittel;Zulassungsnr.;Cu-Gehalt (%);Cu-Gehalt Quelle;Spritzbrühe (l);Aufwand;Aufwand-Einheit;Mittelmenge (kg);Mengenbasis;Behandelte Fläche (ha);Cu (kg);Cu (kg/ha)')
    // Spritzbrühe nur zur Information; Mittelmenge 1,5 kg/ha × 2,1 ha aus dem Aufwand
    assert.equal(zB, '10.07.2026;Pfaffenberg Riesling, Steiner Hund Riesling;Ried Pfaffenberg, Ried Steiner Hund;Cuprozin progress;3212-0;35,00;Stammdaten;1260,000;1,500;kg/ha;3,150;Aufwand × Fläche;2,1000;1,1025;0,5250')
    assert.ok(bilanz.behandlungsZeilen.every(z => z.mengeBasis !== 'Gesamtmenge'))

    const leer = csv.csvDatei([], cu.SPALTEN_CU_BEHANDLUNGEN)
    assert.equal(zeilenVon(leer.text).length, 1)
  })

  test('Kupfer ohne Aufwand: Hinweis statt Menge, auch ohne Jahresauswahl', () => {
    const ohne = spritzung({ id: 'b-o' })                  // Funguran, Spritzbrühe 800 l, kein Aufwand
    const bilanz = cu.cuBilanz([ohne], wg())
    assert.equal(bilanz.behandlungsZeilen.length, 0)
    assert.equal(bilanz.warnungen.length, 1)
    assert.match(bilanz.warnungen[0], /^1 Kupfer-Anwendung ohne berechenbare Mittelmenge .* – nicht in der Bilanz: Spritzung am 30\.05\.2026 \(Pfaffenberg Riesling\) – Funguran Progress: ohne Aufwand$/)
    // mit Jahresauswahl nur im Jahr bzw. als Vorjahres-Hinweis
    assert.equal(cu.cuBilanz([ohne], wg(), { jahre: [2026] }).warnungen.length, 1)
    assert.match(cu.cuBilanz([ohne], wg(), { jahre: [2027] }).warnungen[0], /1 Kupfer-Anwendung der Vorjahre ohne berechenbare Mittelmenge/)
  })

  test('Betrieb ohne WI-Grundstücke: Cu je ha „–“ statt 0 (Kachel und Druck)', () => {
    const b = spritzung({ aufwandmenge: 0.6, aufwandmenge_einheit: 'kg_ha' })
    const ohneWi = wg().map(w => ({ ...w, wiFlaecheHa: 0 }))
    const j = cu.cuBilanz([b], ohneWi, { jahre: [2026] })
    assert.equal(j.gesamtHa, 0)
    assert.equal(j.jahre[0].cuKg, 0.42)
    assert.equal(j.jahre[0].cuKgHa, null)
    assert.equal(j.jahre[0].status, null)
    assert.ok(j.warnungen.some(w => w.includes('Keine Grundstücke mit Nutzart WI')))
    // Gebeshuber: weingarten.flaeche_ha leer, 22,1891 ha WI-GST → 0,42 kg ÷ 22,1891 ha = 0,0189 kg/ha
    const gebeshuber = [{ ...wg()[0], flaecheHa: null, wiFlaecheHa: 22.1891 }]
    assert.equal(cu.cuBilanz([b], gebeshuber, { jahre: [2026] }).jahre[0].cuKgHa, 0.0189)
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
    assert.equal(zf.cuKg, 2)                               // Aufwand 10 kg gesamt × 20 %, nicht die 960 l Spritzbrühe
    assert.equal(zf.mengeBasis, 'Aufwand (gesamt)')
    assert.deepEqual([zf.aufwand, zf.aufwandEinheit], [10, 'kg (gesamt)'])   // wie Formular und psm-aufzeichnung
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
    const bilanz = nst.naehrstoffbilanz(b, wg())
    assert.equal(bilanz.zeilen.length, 1)
    assert.equal(bilanz.uebersprungen, 2)
    assert.equal(bilanz.warnungen.length, 2)
    assert.match(bilanz.warnungen[0], /1 Düngung ohne Düngemittel – nicht in der Bilanz: Düngung am 01\.04\.2026 \(Steiner Hund Riesling\)/)
    assert.match(bilanz.warnungen[1], /Flüssigdünger, 50 l/)
    assert.equal(bilanz.nKg, 196.5)
    assert.equal(bilanz.nKgHa, 93.571)                     // 196,5 / 2,1 ha (aktive Weingärten)
    const [kopf, z1] = zeilenVon(csv.csvText(bilanz.zeilen, nst.SPALTEN_NAEHRSTOFFBILANZ))
    assert.equal(kopf, 'Datum;Weingarten;Ried;Fläche (ha);Düngemittel;Typ;Menge;Einheit;Menge (kg);Mengenbasis;N (%);P (%);N (kg);P (kg);N (kg/ha);P (kg/ha)')
    assert.equal(z1, '25.03.2026;Pfaffenberg Riesling;Ried Pfaffenberg;1,2000;Biosol;organisch;3275,000;kg;3275,000;Düngermenge;6,00;1,00;196,500;32,750;163,750;27,292')
  })

  test('Aufwand kg/ha × Fläche, wenn die Düngermenge fehlt', () => {
    const x = psm.normalisiereBehandlung({ ...B, menge_gesamt: null, menge_einheit: null })
    assert.deepEqual(psm.mittelmengeKg(x, { literAlsKg: false }), { kg: 600, basis: 'Aufwand × Fläche', dichteAngenommen: false })
    const [z] = nst.naehrstoffbilanz([x], wg()).zeilen
    assert.deepEqual([z.mengeKg, z.mengeBasis, z.nKg], [600, 'Aufwand × Fläche', 36])
  })

  test('Düngemittel in l: Menge in l, aber nicht in der Bilanz (keine Dichte-Annahme)', () => {
    const fluessig = duengung({ duengemittel: { id: 'd-2', name: 'Flüssigdünger', typ: 'mineralisch', einheit: 'l', naehrstoff_n_pct: 8, naehrstoff_p_pct: 0 }, menge_gesamt: 50, menge_einheit: 'l' })
    assert.deepEqual([psm.mittelmenge(fluessig).menge, psm.mittelmenge(fluessig).einheit], [50, 'l'])
    const bilanz = nst.naehrstoffbilanz([fluessig], wg())
    assert.equal(bilanz.zeilen.length, 0)
    assert.equal(bilanz.uebersprungen, 1)
    assert.match(bilanz.warnungen[0], /Flüssigdünger, 50 l \(in l, ohne Dichte nicht in kg umrechenbar\)/)
  })
})

// ── Mittelmenge und Spritzbrühe (KAN-133) ────────────────────────────────────

describe('mittelmenge (KAN-133)', nurMitHooks, () => {
  test('Funguran 0,6 kg/ha × 2 ha, Spritzbrühe 800 l → 1,2 kg Mittel, 0,42 kg Cu', () => {
    const b = spritzung({ aufwandmenge: 0.6, aufwandmenge_einheit: 'kg_ha' })
    assert.equal(b.flaecheHa, 2)
    assert.deepEqual(psm.mittelmenge(b), { menge: 1.2, einheit: 'kg', basis: 'Aufwand × Fläche', warnung: null, grund: null })
    assert.equal(psm.spritzbruehe(b), 800)
    assert.deepEqual(psm.mittelmengeKg(b, { literAlsKg: false }), { kg: 1.2, basis: 'Aufwand × Fläche', dichteAngenommen: false })
    const z = cu.cuBilanz([b], wg()).behandlungsZeilen[0]
    assert.equal(z.mengeKg, 1.2)                           // nicht 800
    assert.equal(z.cuKg, 0.42)
    assert.equal(z.cuKgHa, 0.21)
    // Betrieb mit den Gebeshuber-Flächen (190 WI-GST, 22,1891 ha): 0,42 kg ÷ 22,1891 ha = 0,0189 kg/ha
    const ha = psm.betriebsflaecheWi([{ aktiv: true, wiFlaecheHa: 22.1891 }, { aktiv: false, wiFlaecheHa: 5 }])
    assert.equal(ha, 22.1891)
    assert.equal(csv.runden(z.cuKg / ha, 4), 0.0189)
  })

  test('Konzentration im Tank: g/hl bzw. ml/hl × Spritzbrühe ÷ 100', () => {
    assert.deepEqual(psm.mittelmenge(spritzung({ aufwandmenge: 25, aufwandmenge_einheit: 'g_hl' })),
      { menge: 0.2, einheit: 'kg', basis: 'Konzentration × Spritzbrühe', warnung: null, grund: null })
    assert.deepEqual(psm.mittelmenge(spritzung({ aufwandmenge: 300, aufwandmenge_einheit: 'ml_hl' })),
      { menge: 2.4, einheit: 'l', basis: 'Konzentration × Spritzbrühe', warnung: null, grund: null })
    // ohne erfasste Spritzbrühe: Wasseraufwand 400 l/ha × 2 ha = 800 l
    const ohneBruehe = spritzung({ aufwandmenge: 25, aufwandmenge_einheit: 'g_hl', menge_gesamt: null, menge_einheit: null })
    assert.equal(psm.spritzbruehe(ohneBruehe), 800)
    assert.deepEqual(psm.mittelmenge(ohneBruehe), { menge: 0.2, einheit: 'kg', basis: 'Konzentration × Wasseraufwand × Fläche', warnung: null, grund: null })
    // ohne Spritzbrühe und Wasseraufwand: keine Menge – auch kein Rückfall auf konzentration (%)
    const nichts = spritzung({ aufwandmenge: 25, aufwandmenge_einheit: 'g_hl', menge_gesamt: null, menge_einheit: null, wasseraufwand_l_ha: null, konzentration: 0.03 })
    assert.deepEqual(psm.mittelmenge(nichts), { menge: null, einheit: null, basis: null, warnung: 'ohne Spritzbrühe und Wasseraufwand', grund: 'bruehe' })
  })

  test('Spritzbrühe in ml wird l', () => {
    const b = spritzung({ aufwandmenge: 25, aufwandmenge_einheit: 'g_hl', menge_gesamt: 800000, menge_einheit: 'ml', wasseraufwand_l_ha: null })
    assert.equal(psm.spritzbruehe(b), 800)
    assert.equal(psm.mittelmenge(b).menge, 0.2)
  })

  test('Tankmischung: je Mittel eine Maßnahme mit derselben Spritzbrühe, Mittelmengen getrennt', () => {
    const funguran = spritzung({ id: 'b-t1', aufwandmenge: 0.6, aufwandmenge_einheit: 'kg_ha' })
    const topas = spritzung({ id: 'b-t2', psm_id: 'p-to', psm: TOPAS, aufwandmenge: 0.25, aufwandmenge_einheit: 'l_ha' })
    assert.deepEqual([funguran, topas].map(b => [psm.mittelmenge(b).menge, psm.mittelmenge(b).einheit]), [[1.2, 'kg'], [0.5, 'l']])
    // jede Maßnahme zeigt die ganze Brühe des Tanks – summiert wären es fälschlich 1600 l
    assert.deepEqual([funguran, topas].map(psm.spritzbruehe), [800, 800])
  })

  test('ohne Aufwand: keine Mittelmenge, Warnung – „Menge gesamt“ zählt nie als Mittel', () => {
    const f = psm.normalisiereBehandlung({ ...F, aufwandmenge: null, aufwandmenge_einheit: null })
    assert.deepEqual(psm.mittelmenge(f), { menge: null, einheit: null, basis: null, warnung: 'ohne Aufwand', grund: 'aufwand' })
    assert.equal(psm.mittelmengeKg(f, { literAlsKg: true }), null)
    assert.equal(cu.cuBilanz([f], wg()).behandlungsZeilen.length, 0)
    // Altwert: Spritzung mit „Menge gesamt“ in kg – weder Spritzbrühe noch Mittelmenge
    const alt = psm.normalisiereBehandlung(ALT(F, 10))
    assert.equal(psm.bruehenAltwert(alt), true)
    assert.equal(psm.spritzbruehe(alt), null)
    assert.equal(psm.mittelmenge(alt).menge, 10)            // aus dem Aufwand 10 kg, nicht aus „Menge gesamt“
    assert.equal(psm.mittelmenge(alt).basis, 'Aufwand (gesamt)')
    assert.equal(psm.bruehenAltwert(psm.normalisiereBehandlung(A)), false)
  })

  test('Aufwand je ha ohne Fläche, gesamt in g/ml, unbekannte Einheit', () => {
    const ohneFlaeche = spritzung({ aufwandmenge: 0.6, aufwandmenge_einheit: 'kg_ha', behandlung_grundstuecke: [] })
    assert.equal(ohneFlaeche.flaecheHa, null)
    assert.deepEqual(psm.mittelmenge(ohneFlaeche), { menge: null, einheit: null, basis: null, warnung: 'ohne behandelte Fläche', grund: 'flaeche' })
    assert.equal(psm.spritzbruehe(ohneFlaeche), 800)       // erfasste Brühe braucht keine Fläche
    assert.deepEqual(psm.mittelmenge(spritzung({ aufwandmenge: 1.2, aufwandmenge_einheit: 'kg' })), { menge: 1.2, einheit: 'kg', basis: 'Aufwand (gesamt)', warnung: null, grund: null })
    assert.deepEqual(psm.mittelmenge(spritzung({ aufwandmenge: 1200, aufwandmenge_einheit: 'g' })), { menge: 1.2, einheit: 'kg', basis: 'Aufwand (gesamt, g)', warnung: null, grund: null })
    assert.deepEqual(psm.mittelmenge(spritzung({ aufwandmenge: 500, aufwandmenge_einheit: 'ml' })), { menge: 0.5, einheit: 'l', basis: 'Aufwand (gesamt, ml)', warnung: null, grund: null })
    assert.equal(psm.mittelmenge(spritzung({ aufwandmenge: 1, aufwandmenge_einheit: 'stk' })).grund, 'einheit')
    assert.equal(psm.mittelmenge(spritzung({ aufwandmenge: -1, aufwandmenge_einheit: 'kg' })).grund, 'ungueltig')
  })

  test('Flüssiges Mittel: l, in kg nur mit literAlsKg (Kupfer-Bilanz)', () => {
    const b = spritzung({ aufwandmenge: 2, aufwandmenge_einheit: 'l_ha' })
    assert.deepEqual(psm.mittelmenge(b), { menge: 4, einheit: 'l', basis: 'Aufwand × Fläche', warnung: null, grund: null })
    assert.equal(psm.mittelmengeKg(b, { literAlsKg: false }), null)
    assert.deepEqual(psm.mittelmengeKg(b, { literAlsKg: true }), { kg: 4, basis: 'Aufwand × Fläche (1 kg/l)', dichteAngenommen: true })
  })

  test('Düngung: Düngermenge (g → kg, l nur bei Düngemittel in l), sonst Aufwand', () => {
    assert.deepEqual(psm.mittelmenge(duengung({ menge_gesamt: 1000, menge_einheit: 'kg', aufwandmenge: 400, aufwandmenge_einheit: 'kg_ha' })),
      { menge: 1000, einheit: 'kg', basis: 'Düngermenge', warnung: null, grund: null })
    assert.deepEqual(psm.mittelmenge(duengung({ menge_gesamt: 1500, menge_einheit: 'g' })), { menge: 1.5, einheit: 'kg', basis: 'Düngermenge (g)', warnung: null, grund: null })
    assert.deepEqual(psm.mittelmenge(duengung({ aufwandmenge: 400, aufwandmenge_einheit: 'kg_ha' })), { menge: 800, einheit: 'kg', basis: 'Aufwand × Fläche', warnung: null, grund: null })
    // Flüssigdünger: l nur, wenn das Düngemittel in l geführt wird – keine Dichte-Annahme
    const fluessig = { id: 'd-2', name: 'Flüssigdünger', typ: 'mineralisch', einheit: 'l' }
    assert.deepEqual(psm.mittelmenge(duengung({ duengemittel: fluessig, menge_gesamt: 50, menge_einheit: 'l' })), { menge: 50, einheit: 'l', basis: 'Düngermenge', warnung: null, grund: null })
    assert.deepEqual(psm.mittelmenge(duengung({ duengemittel: fluessig, aufwandmenge: 20, aufwandmenge_einheit: 'l_ha' })), { menge: 40, einheit: 'l', basis: 'Aufwand × Fläche', warnung: null, grund: null })
    const literBeiKg = psm.mittelmenge(duengung({ menge_gesamt: 50, menge_einheit: 'l' }))
    assert.equal(literBeiKg.menge, null)
    assert.equal(literBeiKg.grund, 'einheit')
    assert.match(literBeiKg.warnung, /Düngermenge in l, Düngemittel nicht in l geführt/)
    // ohne Düngermenge, Konzentration g/hl: nicht zulässig
    assert.match(psm.mittelmenge(duengung({ aufwandmenge: 25, aufwandmenge_einheit: 'g_hl' })).warnung, /g\/hl, ml\/hl\) bei Düngung nicht zulässig/)
    assert.deepEqual(psm.mittelmenge(duengung({})), { menge: null, einheit: null, basis: null, warnung: 'ohne Düngermenge und Aufwand', grund: 'menge' })
    // Nährstoffbilanz liest Düngungen in kg weiter über mittelmengeKg()
    assert.deepEqual(psm.mittelmengeKg(duengung({ menge_gesamt: 3275, menge_einheit: 'kg' }), { literAlsKg: false }), { kg: 3275, basis: 'Düngermenge', dichteAngenommen: false })
  })

  test('andere Arten haben keine Mittelmenge', () => {
    const b = psm.normalisiereBehandlung(roh({ art: 'bodenbearbeitung', menge_gesamt: 5, menge_einheit: 'kg', behandlung_grundstuecke: ZWEI_HA }))
    assert.equal(psm.mittelmenge(b).menge, null)
    assert.equal(psm.mittelmenge(b).grund, 'art')
    assert.equal(psm.spritzbruehe(b), null)
  })

  test('mengeInEinheit: kg ↔ g, l ↔ ml, kg ↔ l nicht', () => {
    assert.equal(psm.mengeInEinheit(1.2, 'kg', 'g'), 1200)
    assert.equal(psm.mengeInEinheit(0.2, 'kg', 'g'), 200)
    assert.equal(psm.mengeInEinheit(1050, 'g', 'kg'), 1.05)
    assert.equal(psm.mengeInEinheit(2.4, 'l', 'ml'), 2400)
    assert.equal(psm.mengeInEinheit(1.2, 'kg', 'kg'), 1.2)
    assert.equal(psm.mengeInEinheit(1.2, 'kg', 'l'), null)   // keine Dichte-Annahme
    assert.equal(psm.mengeInEinheit(1.2, 'kg', null), null)
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

  test('Register = Katalog, Zugriff betriebsleitung (Rückverfolgung Weingarten: jedes Mitglied), Druckpfade', () => {
    assert.deepEqual(Object.keys(M()).sort(), Object.keys(katalog.KATALOG_PFLANZENSCHUTZ).sort())
    for (const m of Object.values(M())) {
      assert.equal(m.zugriff, m.id === 'rueckverfolgung-weingarten' ? 'mitglied' : 'betriebsleitung')
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

// ── Betriebsfläche aus den WI-GST (KAN-133 Nr. 5, KAN-132 Regel 8) ──────────

describe('betriebsflaecheWi', nurMitHooks, () => {
  test('ladeWeingaerten: Σ WI-GST je Weingarten, Betrieb nur aktive Weingärten', async () => {
    const sb = supabaseErsatz(DATEN)
    const w = await psm.ladeWeingaerten(sb, 't-1')
    assert.deepEqual(w.map(x => [x.id, x.wiFlaecheHa]), [['wg-1', 1.2], ['wg-2', 0.9], ['wg-3', 2]])
    assert.equal(psm.betriebsflaecheWi(w), 2.1)                // ohne Nutzart A (0,25 ha) und ohne den inaktiven Weingarten
    assert.ok(sb.protokoll.every(x => x.filter.some(([op, k, v]) => op === 'eq' && k === 'tenant_id' && v === 't-1')))
    // Weingärten ohne Stammdaten-Fläche (Gebeshuber): Betriebsfläche trotzdem aus den GST
    const ohneStamm = w.map(x => ({ ...x, flaecheHa: null }))
    assert.equal(psm.betriebsflaecheHa(ohneStamm), 0)
    assert.equal(psm.betriebsflaecheWi(ohneStamm), 2.1)
    assert.equal(psm.betriebsflaecheWi([]), 0)
  })
})
