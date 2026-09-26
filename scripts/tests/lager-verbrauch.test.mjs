// KAN-133 Soll 2 und 3 (26.09.2026): Lagerbestand der Betriebsmittel – Verbrauch aus Maßnahmen als
// Σ Mittelmenge (lib/behandlungen/lagerVerbrauch.ts auf mittelmenge() aus lib/behoerden/psm.ts).
// Pflanzenschutzmittel nur aus Spritzungen (Aufwand × Fläche, nie die Spritzbrühe), Düngemittel nur
// aus Düngungen (Düngermenge, sonst Aufwand × Fläche); in der Lager-Einheit, kg ↔ l nur als Hinweis.
//
// Aufruf:  node --experimental-strip-types --disable-warning=ExperimentalWarning \
//               --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test scripts/tests/lager-verbrauch.test.mjs
//          (Node ≥ 22.15 wegen module.registerHooks; läuft auch über npm run test:csv)
//
// Resolve-Hook wie in pflanzenschutz.test.mjs: '@/'-Aliase und endungslose Importe → src/…/*.ts.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'
import * as nodeModule from 'node:module'

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src')

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
const [psm, lv] = hooksMoeglich
  ? await Promise.all([laden('lib/behoerden/psm.ts'), laden('lib/behandlungen/lagerVerbrauch.ts')])
  : []
const nurMitHooks = { skip: hooksMoeglich ? false : 'module.registerHooks fehlt (Node ≥ 22.15 nötig)' }

// ── Testdaten in der Form der PostgREST-Antwort von ladeBehandlungen() ─────────

const WG = { id: 'wg-1', name: 'Pfaffenberg Riesling', ried: 'Pfaffenberg', flaeche_ha: null, lage_id: null, lagen: null }
const gst = (nr, ha) => ({
  grundstueck_id: `g-${nr}`, flaeche_ha: ha,
  grundstueck: { id: `g-${nr}`, gst_nr: nr, katastralgemeinde: '04023', kg_bezeichnung: 'Stein', flaeche_ha: ha, weingarten: WG },
})

const FUNGURAN = { id: 'p-fu', name: 'Funguran Progress', cu_gehalt_pct: 35 }
const CUPROZIN = { id: 'p-cu', name: 'Cuprozin progress', cu_gehalt_pct: 35 }
const TOPAS = { id: 'p-to', name: 'Topas' }
const STEWARD = { id: 'p-st', name: 'Steward' }
const BIOSOL = { id: 'd-bi', name: 'Biosol', einheit: 'kg' }
const FLUESSIG = { id: 'd-fl', name: 'Flüssigdünger', einheit: 'l' }

function roh(teil) {
  return {
    id: 'b-x', datum: '2026-06-01', datum_bis: null, art: 'spritzung', weingarten_id: null, psm_id: null, duengemittel_id: null,
    durchgefuehrt_von: null, aufwandmenge: null, aufwandmenge_einheit: null, menge_gesamt: null, menge_einheit: null,
    konzentration: null, wasseraufwand_l_ha: null, behandelte_flaeche_ha: null, bbch_stadium: null, schaderreger: null,
    witterung: null, temperatur_c: null, windstaerke: null, ernte_fruehesteins: null, wartezeit_eingehalten: null, notizen: null,
    weingarten: null, psm: null, duengemittel: null, behandlung_grundstuecke: [gst('1', 1.25), gst('2', 0.75)],
    ...teil,
  }
}
const spritzung = (id, mittel, teil = {}) => psm.normalisiereBehandlung(roh({ id, art: 'spritzung', psm_id: mittel.id, psm: mittel, ...teil }))
const duengung = (id, dm, teil = {}) => psm.normalisiereBehandlung(roh({ id, art: 'duengung', duengemittel_id: dm.id, duengemittel: dm, ...teil }))
const buchung = (datum, menge, einheit) => ({ datum, menge, einheit })

/** Funguran Progress 0,6 kg/ha auf 2 ha, 400 l/ha, Spritzbrühe 800 l (Beispiel aus dem Ticket) */
const funguran = (teil = {}) => spritzung('b-fu', FUNGURAN, {
  aufwandmenge: 0.6, aufwandmenge_einheit: 'kg_ha', menge_gesamt: 800, menge_einheit: 'l', wasseraufwand_l_ha: 400, ...teil,
})

function konto(behandlungen, lager, id, buchungen, stammEinheit) {
  return lv.lagerKonto(buchungen, lv.verbrauchJeMittel(behandlungen, lager).get(id) ?? [], stammEinheit)
}

// ── Pflanzenschutzmittel ────────────────────────────────────────────────────

describe('Lager Pflanzenschutzmittel (Soll 2)', nurMitHooks, () => {
  test('Spritzbrühe wird nicht abgezogen: Funguran 0,6 kg/ha × 2 ha, Brühe 800 l → −1,2 kg', () => {
    const posten = lv.verbrauchJeMittel([funguran()], 'psm').get('p-fu')
    assert.equal(posten.length, 1)
    assert.equal(posten[0].menge, 1.2)
    assert.equal(posten[0].einheit, 'kg')
    assert.equal(posten[0].basis, 'Aufwand × Fläche')
    const k = lv.lagerKonto([buchung('2026-05-01', 2, 'kg')], posten)
    assert.deepEqual(k, { einheit: 'kg', zugang: 2, abgang: 0, verbrauch: 1.2, bestand: 0.8, hinweise: [] })
  })

  test('Tankmischung: dieselbe Spritzbrühe in zwei Maßnahmen – je Mittel nur die eigene Mittelmenge', () => {
    const tank = { datum: '2026-07-10', menge_gesamt: 8460, menge_einheit: 'l', wasseraufwand_l_ha: 600, behandlung_grundstuecke: [gst('1', 14.1)] }
    const b = [
      spritzung('b-cu', CUPROZIN, { ...tank, aufwandmenge: 1.5, aufwandmenge_einheit: 'kg_ha' }),
      spritzung('b-to', TOPAS, { ...tank, aufwandmenge: 0.25, aufwandmenge_einheit: 'l_ha' }),
    ]
    const cu = konto(b, 'psm', 'p-cu', [buchung('2026-03-01', 95, 'kg')])
    const to = konto(b, 'psm', 'p-to', [buchung('2026-03-01', 22, 'l')])
    assert.deepEqual([cu.einheit, cu.verbrauch, cu.bestand], ['kg', 21.15, 73.85])
    assert.deepEqual([to.einheit, to.verbrauch, to.bestand], ['l', 3.525, 18.475])
    assert.deepEqual([...cu.hinweise, ...to.hinweise], [])
  })

  test('nur Spritzungen zählen: Düngung und andere Arten nicht im PSM-Lager', () => {
    const b = [
      funguran(),
      psm.normalisiereBehandlung(roh({ id: 'b-so', art: 'sonstiges', psm_id: FUNGURAN.id, psm: FUNGURAN, aufwandmenge: 5, aufwandmenge_einheit: 'kg' })),
      duengung('b-du', BIOSOL, { aufwandmenge: 500, aufwandmenge_einheit: 'kg_ha' }),
    ]
    const je = lv.verbrauchJeMittel(b, 'psm')
    assert.deepEqual([...je.keys()], ['p-fu'])
    assert.deepEqual(je.get('p-fu').map(p => p.behandlungId), ['b-fu'])
  })

  test('g/hl mit Spritzbrühe: 25 g/hl × 800 l = 0,2 kg – Lager in g zieht 200 g ab', () => {
    const b = [funguran({ aufwandmenge: 25, aufwandmenge_einheit: 'g_hl' })]
    const k = konto(b, 'psm', 'p-fu', [buchung('2026-05-01', 500, 'g')])
    assert.deepEqual([k.einheit, k.zugang, k.verbrauch, k.bestand], ['g', 500, 200, 300])
  })

  test('g → kg: Buchungen in g und kg gemischt → Lager in kg (Steward 0,5 kg + 2.000 g, 0,125 kg/ha × 4,75 ha)', () => {
    const b = [spritzung('b-st', STEWARD, { aufwandmenge: 0.125, aufwandmenge_einheit: 'kg_ha', wasseraufwand_l_ha: 500, behandlung_grundstuecke: [gst('1', 4.75)] })]
    const k = konto(b, 'psm', 'p-st', [buchung('2026-01-10', 0.5, 'kg'), buchung('2026-04-01', 2000, 'g')])
    assert.deepEqual([k.einheit, k.zugang, k.verbrauch, k.bestand], ['kg', 2.5, 0.594, 1.906])
  })

  test('ml → l: Mittel in l, Lager in ml', () => {
    const b = [spritzung('b-to', TOPAS, { aufwandmenge: 0.25, aufwandmenge_einheit: 'l_ha' })]
    const k = konto(b, 'psm', 'p-to', [buchung('2026-01-10', 1000, 'ml')])
    assert.deepEqual([k.einheit, k.verbrauch, k.bestand], ['ml', 500, 500])
  })

  test('Lager in kg, Mittel in l → kein Abzug, sichtbarer Hinweis (keine Dichte-Annahme)', () => {
    const b = [spritzung('b-to', TOPAS, { aufwandmenge: 0.25, aufwandmenge_einheit: 'l_ha' })]
    const k = konto(b, 'psm', 'p-to', [buchung('2026-01-10', 5, 'kg')])
    assert.deepEqual([k.einheit, k.verbrauch, k.bestand], ['kg', 0, 5])
    assert.equal(k.hinweise.length, 1)
    assert.equal(k.hinweise[0].behandlungId, 'b-to')
    assert.match(k.hinweise[0].text, /^Spritzung am 01\.06\.2026 \(Pfaffenberg Riesling\): 0,5 l – Lager in kg, l ohne Dichte nicht in kg umrechenbar, nicht abgezogen\.$/)
  })

  test('ohne Aufwand → Hinweis, kein Abzug – auch nicht eine Gesamtmenge in kg (Altwert)', () => {
    const b = [spritzung('b-alt', CUPROZIN, { menge_gesamt: 21.15, menge_einheit: 'kg' })]
    const k = konto(b, 'psm', 'p-cu', [buchung('2026-03-01', 95, 'kg')])
    assert.deepEqual([k.verbrauch, k.bestand], [0, 95])
    assert.deepEqual(k.hinweise, [{ text: 'Spritzung am 01.06.2026 (Pfaffenberg Riesling): ohne Aufwand – nicht abgezogen.', behandlungId: 'b-alt' }])
  })

  test('Mittel ohne Buchungen: Lager-Einheit aus der Mittelmenge, Bestand negativ', () => {
    const k = konto([funguran()], 'psm', 'p-fu', [])
    assert.deepEqual([k.einheit, k.zugang, k.verbrauch, k.bestand], ['kg', 0, 1.2, -1.2])
  })

  test('Korrektur-Abgänge und Buchung in l neben kg (nicht berücksichtigt, Hinweis)', () => {
    const k = lv.lagerKonto([
      buchung('2026-01-01', 5, 'l'), buchung('2026-02-01', 100, 'kg'), buchung('2026-03-01', -3, 'kg'),
    ], [])
    assert.deepEqual([k.einheit, k.zugang, k.abgang, k.bestand], ['kg', 100, 3, 97])
    assert.deepEqual(k.hinweise, [{ text: 'Buchung vom 01.01.2026 über 5 l: Lager in kg, l ohne Dichte nicht in kg umrechenbar – nicht berücksichtigt.', behandlungId: null }])
  })
})

// ── Düngemittel ─────────────────────────────────────────────────────────────

describe('Lager Düngemittel (Soll 3)', nurMitHooks, () => {
  test('Düngermenge in kg', () => {
    const b = [duengung('b-bi', BIOSOL, { aufwandmenge: 500, aufwandmenge_einheit: 'kg_ha', menge_gesamt: 3275, menge_einheit: 'kg', behandlung_grundstuecke: [gst('1', 6.55)] })]
    const k = konto(b, 'duenger', 'd-bi', [buchung('2026-01-01', 7500, 'kg')], 'kg')
    assert.deepEqual([k.einheit, k.verbrauch, k.bestand, k.hinweise.length], ['kg', 3275, 4225, 0])
  })

  test('Düngung nur mit Aufwand (ohne Düngermenge) → Aufwand × Fläche', () => {
    const b = [duengung('b-pk', BIOSOL, { aufwandmenge: 200, aufwandmenge_einheit: 'kg_ha', behandlung_grundstuecke: [gst('1', 3.8)] })]
    const posten = lv.verbrauchJeMittel(b, 'duenger').get('d-bi')
    assert.deepEqual([posten[0].menge, posten[0].einheit, posten[0].basis], [760, 'kg', 'Aufwand × Fläche'])
    assert.equal(lv.lagerKonto([buchung('2026-01-01', 1000, 'kg')], posten, 'kg').bestand, 240)
  })

  test('Düngermenge in g → kg', () => {
    const b = [duengung('b-g', BIOSOL, { menge_gesamt: 1500, menge_einheit: 'g' })]
    const k = konto(b, 'duenger', 'd-bi', [buchung('2026-01-01', 10, 'kg')], 'kg')
    assert.deepEqual([k.verbrauch, k.bestand], [1.5, 8.5])
  })

  test('Flüssigdünger (Stammdaten l) ohne Buchungen: Lager in l', () => {
    const b = [duengung('b-fl', FLUESSIG, { menge_gesamt: 50, menge_einheit: 'l' })]
    const k = konto(b, 'duenger', 'd-fl', [], 'l')
    assert.deepEqual([k.einheit, k.verbrauch, k.bestand], ['l', 50, -50])
  })

  test('ohne Düngermenge und Aufwand bzw. Düngermenge in l bei Düngemittel in kg → Hinweis, kein Abzug', () => {
    const b = [
      duengung('b-leer', BIOSOL),
      duengung('b-l', BIOSOL, { datum: '2026-06-02', menge_gesamt: 50, menge_einheit: 'l' }),
    ]
    const k = konto(b, 'duenger', 'd-bi', [buchung('2026-01-01', 100, 'kg')], 'kg')
    assert.deepEqual([k.verbrauch, k.bestand], [0, 100])
    assert.deepEqual(k.hinweise.map(h => h.behandlungId), ['b-leer', 'b-l'])
    assert.match(k.hinweise[0].text, /ohne Düngermenge und Aufwand – nicht abgezogen\.$/)
    assert.match(k.hinweise[1].text, /Düngermenge in l, Düngemittel nicht in l geführt – nicht abgezogen\.$/)
  })

  test('Spritzungen zählen nicht im Düngerlager', () => {
    assert.equal(lv.verbrauchJeMittel([funguran()], 'duenger').size, 0)
  })
})

// ── Lager-Einheit ───────────────────────────────────────────────────────────

describe('lagerEinheit', nurMitHooks, () => {
  const posten = (einheit) => ({ behandlungId: 'b', datum: '2026-01-01', menge: 1, einheit, basis: 'x', warnung: null, kurz: 'x' })
  test('Buchungen vor Stammdaten und Mittelmenge; gemischt → Grundeinheit der jüngsten Buchung', () => {
    assert.equal(lv.lagerEinheit([buchung('2026-01-01', 1, 'g')], [posten('kg')], 'kg'), 'g')
    assert.equal(lv.lagerEinheit([buchung('2026-01-01', 1, 'ml'), buchung('2026-02-01', 1, 'l')]), 'l')
    assert.equal(lv.lagerEinheit([buchung('2026-02-01', 1, 'g'), buchung('2026-01-01', 1, 'l')]), 'kg')
    assert.equal(lv.lagerEinheit([], [posten('kg')], 'l'), 'l')
    assert.equal(lv.lagerEinheit([], [posten(null), posten('l')]), 'l')
    assert.equal(lv.lagerEinheit([buchung('2026-01-01', 1, null)]), 'kg')
  })

  test('preisEinheit (Material-Vorschlag): Preis je kg bzw. l, auch wenn alle Buchungen in g bzw. ml sind', () => {
    assert.equal(lv.preisEinheit([buchung('2026-01-01', 500, 'g')]), 'kg')
    assert.equal(lv.preisEinheit([buchung('2026-01-01', 250, 'ml'), buchung('2026-02-01', 500, 'ml')]), 'l')
    assert.equal(lv.preisEinheit([buchung('2026-01-01', 0.5, 'kg'), buchung('2026-02-01', 500, 'g')]), 'kg')
    assert.equal(lv.preisEinheit([buchung('2026-02-01', 500, 'ml'), buchung('2026-01-01', 1, 'kg')]), 'l')
    assert.equal(lv.preisEinheit([]), null)
    assert.equal(lv.preisEinheit([buchung('2026-01-01', 1, null)]), null)
    // Steward 180 €/kg, einzige Buchung 500 g: 0,125 kg/ha × 4,75 ha = 0,594 kg × 180 €/kg = 106,92 € (nicht 594 g × 180 €)
    const steward = spritzung('b-st', STEWARD, {
      aufwandmenge: 0.125, aufwandmenge_einheit: 'kg_ha', menge_gesamt: 2375, menge_einheit: 'l', wasseraufwand_l_ha: 500,
      behandlung_grundstuecke: [gst('1', 4.75)],
    })
    const mm = psm.mittelmenge(steward)
    assert.deepEqual([mm.menge, mm.einheit], [0.594, 'kg'])
    const menge = psm.mengeInEinheit(mm.menge, mm.einheit, lv.preisEinheit([buchung('2026-01-01', 500, 'g')]))
    assert.equal(menge, 0.594)
    assert.equal(Math.round(menge * 180 * 100) / 100, 106.92)
  })
})

// ── Abnahme Musterhof (Demo, SELECT 26.09.2026) ─────────────────────────────

describe('Musterhof: Bestände bleiben gleich (Abnahme KAN-133)', nurMitHooks, () => {
  // je Jahr (2025 und 2026) dieselben 15 Spritzungen: [Datum, Mittel, Aufwand, Einheit, Σ GST-Fläche, Wasser l/ha]
  const SPRITZ = [
    ['05-06', 'Netzschwefel Stulln', 3.6, 'kg_ha', 14.1, 200], ['05-19', 'Folpan 80 WDG', 1.0, 'kg_ha', 14.1, 300],
    ['05-19', 'Netzschwefel Stulln', 3.6, 'kg_ha', 14.1, 300], ['06-03', 'Mildicut', 3.0, 'l_ha', 14.1, 400],
    ['06-03', 'Topas', 0.2, 'l_ha', 14.1, 400], ['06-14', 'Folpan 80 WDG', 1.2, 'kg_ha', 14.1, 400],
    ['06-14', 'Netzschwefel Stulln', 3.6, 'kg_ha', 14.1, 400], ['06-26', 'Luna Experience', 0.4, 'l_ha', 14.1, 500],
    ['06-26', 'Mildicut', 3.5, 'l_ha', 14.1, 500], ['07-02', 'Steward', 0.125, 'kg_ha', 4.75, 500],
    ['07-10', 'Cuprozin progress', 1.5, 'kg_ha', 14.1, 600], ['07-10', 'Topas', 0.25, 'l_ha', 14.1, 600],
    ['07-24', 'Bordeaux Manica 20', 2.5, 'kg_ha', 14.1, 600], ['07-24', 'Netzschwefel Stulln', 2.4, 'kg_ha', 14.1, 600],
    ['08-12', 'Cuprozin progress', 1.2, 'kg_ha', 14.1, 600],
  ]
  const DUENG = [['03-25', 'Biosol', 500, 6.55], ['04-08', 'Patentkali', 200, 3.8]]
  // Anfangsbestand + Einkäufe [Einheit, Summe]; erwarteter Bestand laut Ticket
  const LAGER = {
    'Bordeaux Manica 20': ['kg', 10, 80, 19.5], 'Cuprozin progress': ['kg', 5, 90, 18.86],
    'Folpan 80 WDG': ['kg', 10, 80, 27.96], 'Luna Experience': ['l', 3, 20, 11.72], 'Mildicut': ['l', 15, 200, 31.7],
    'Netzschwefel Stulln': ['kg', 40, 400, 67.76], 'Steward': ['kg', 0.5, 2, 1.312], 'Topas': ['l', 2, 20, 9.31],
  }
  const DUENGER_LAGER = { Biosol: ['kg', 500, 7000, 950], Patentkali: ['kg', 200, 1600, 280] }

  /** menge_gesamt: 'alt' = Seed (Aufwand × Fläche in kg bzw. l), 'bruehe' = nach Demo-Migration Nr. 16 (Wasser × Fläche, l) */
  function massnahmen(mengeGesamt) {
    const liste = []
    let n = 0
    for (const jahr of [2025, 2026]) {
      for (const [tag, mittel, aufwand, einheit, ha, wasser] of SPRITZ) {
        const alt = mengeGesamt === 'alt'
        liste.push(spritzung(`b-${++n}`, { id: mittel, name: mittel }, {
          datum: `${jahr}-${tag}`, aufwandmenge: aufwand, aufwandmenge_einheit: einheit, wasseraufwand_l_ha: wasser,
          menge_gesamt: alt ? Math.round(aufwand * ha * 1000) / 1000 : Math.round(wasser * ha * 1000) / 1000,
          menge_einheit: alt ? (einheit === 'kg_ha' ? 'kg' : 'l') : 'l',
          behandlung_grundstuecke: [gst('1', ha)],
        }))
      }
      for (const [tag, dm, aufwand, ha] of DUENG) {
        liste.push(duengung(`b-${++n}`, { id: dm, name: dm, einheit: 'kg' }, {
          datum: `${jahr}-${tag}`, aufwandmenge: aufwand, aufwandmenge_einheit: 'kg_ha',
          menge_gesamt: aufwand * ha, menge_einheit: 'kg', behandlung_grundstuecke: [gst('1', ha)],
        }))
      }
    }
    return liste
  }

  for (const variante of ['alt', 'bruehe']) {
    test(`Bestände mit „Menge gesamt“ ${variante === 'alt' ? 'wie im Seed (Altwerte in kg)' : 'als Spritzbrühe (nach Nr. 16)'}`, () => {
      const b = massnahmen(variante)
      assert.equal(b.length, 34)
      const psmJe = lv.verbrauchJeMittel(b, 'psm')
      const dmJe = lv.verbrauchJeMittel(b, 'duenger')
      for (const [mittel, [einheit, anfang, einkauf, soll]] of Object.entries(LAGER)) {
        const k = lv.lagerKonto([buchung('2025-01-01', anfang, einheit), buchung('2025-02-01', einkauf, einheit)], psmJe.get(mittel) ?? [])
        assert.deepEqual([mittel, k.einheit, k.bestand, k.hinweise.length], [mittel, einheit, soll, 0])
      }
      for (const [dm, [einheit, anfang, einkauf, soll]] of Object.entries(DUENGER_LAGER)) {
        const k = lv.lagerKonto([buchung('2025-01-01', anfang, einheit), buchung('2025-02-01', einkauf, einheit)], dmJe.get(dm) ?? [], 'kg')
        assert.deepEqual([dm, k.einheit, k.bestand, k.hinweise.length], [dm, einheit, soll, 0])
      }
    })
  }
})
