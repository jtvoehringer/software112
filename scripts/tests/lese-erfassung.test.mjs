// Tests „Lesedaten erfassen“ (KAN-160 Ried-Auswahl, KAN-161 Verteilung der Menge, KAN-162 Suche)
//
// Aufruf:  node --experimental-strip-types --disable-warning=ExperimentalWarning --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test scripts/tests/lese-erfassung.test.mjs
//
// Geprüft werden die reinen Funktionen in src/lib/wein/leseErfassung.ts und riedAuswahl.ts sowie die Verdrahtung
// in ErnteDetailClient.tsx und der Server Action createMultipleErnteParzellen (Quelltext).

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { register } from 'node:module'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

register('./ernte.aufloesung.mjs', import.meta.url)

const lese = await import('../../src/lib/wein/leseErfassung.ts')
const ried = await import('../../src/lib/wein/riedAuswahl.ts')
const absenden = await import('../../src/app/(dashboard)/behandlungen/neu/absenden.ts')

const WURZEL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const quelle = (rel) => readFileSync(path.join(WURZEL, rel), 'utf8').replace(/\r\n/g, '\n')
const summe = (xs) => Math.round(xs.reduce((s, x) => s + (x ?? 0), 0) * 100) / 100

// ── KAN-161: Verteilung ─────────────────────────────────────────────────────────

describe('KAN-161 – verteileKg', () => {
  test('nach Fläche, abgerundet in ganzen kg, Rest auf die größte Fläche – Summe exakt = Eingabe', () => {
    const r = lese.verteileKg(1000, [0.1, 0.2, 0.3])
    assert.deepEqual(r, [166, 333, 501])
    assert.equal(summe(r), 1000)
    // größte Fläche nicht an erster Stelle
    assert.deepEqual(lese.verteileKg(100, [0.3, 0.3, 0.9]), [20, 20, 60])
  })

  test('bei Gleichstand der größten Fläche bekommt die erste den Rest', () => {
    assert.deepEqual(lese.verteileKg(10, [1, 1, 1]), [4, 3, 3])
  })

  test('Dezimaleingabe: Genauigkeit der Eingabe (Zehntel/Hundertstel), Summe exakt', () => {
    const z = lese.verteileKg(1000.5, [1, 1, 1])
    assert.deepEqual(z, [333.5, 333.5, 333.5])
    const h = lese.verteileKg(100.25, [1, 2])
    assert.equal(summe(h), 100.25)
    assert.deepEqual(h, [33.41, 66.84])
    // viele Grundstücke mit krummen Flächen – Summe bleibt exakt
    const flaechen = Array.from({ length: 37 }, (_, i) => 0.0137 * (i + 1) + (i % 3) * 0.0011)
    for (const kg of [12345, 9876.5, 777.77, 1]) {
      const r = lese.verteileKg(kg, flaechen)
      assert.equal(summe(r), kg, `Summe für ${kg}`)
      assert.ok(r.every(v => v != null && v >= 0))
    }
  })

  test('leer, ungültig, negativ → alle null; 0 kg → alle 0; keine Ziele → []', () => {
    assert.deepEqual(lese.verteileKg(null, [1, 2]), [null, null])
    assert.deepEqual(lese.verteileKg(undefined, [1]), [null])
    assert.deepEqual(lese.verteileKg(Number.NaN, [1]), [null])
    assert.deepEqual(lese.verteileKg(-5, [1, 2]), [null, null])
    assert.deepEqual(lese.verteileKg(0, [1, null]), [0, 0])
    assert.deepEqual(lese.verteileKg(500, []), [])
  })

  test('Grundstücke ohne Fläche: kein Anteil (null), solange andere eine Fläche haben; sonst gleichmäßig', () => {
    const r = lese.verteileKg(900, [0.5, null, 0, 0.25])
    assert.deepEqual(r, [600, null, null, 300])
    assert.equal(summe(r), 900)
    assert.deepEqual(lese.verteileKg(10, [null, 0, null]), [4, 3, 3])
    // numeric aus der Datenbank auch als Text
    assert.deepEqual(lese.verteileKg(100, ['1.0000', '3']), [25, 75])
    assert.equal(lese.bezugsflaeche('abc'), null)
    assert.equal(lese.bezugsflaeche(-1), null)
  })

  test('Hinweis zur Vorschau bei fehlender Fläche', () => {
    assert.equal(lese.verteilungsHinweis([1, 2]), null)
    assert.equal(lese.verteilungsHinweis([]), null)
    assert.match(lese.verteilungsHinweis([1, null]), /^1 Grundstück hat keine Fläche und bekommt keinen Anteil/)
    assert.match(lese.verteilungsHinweis([1, null, 0]), /^2 Grundstücke haben keine Fläche/)
    assert.match(lese.verteilungsHinweis([null, 0]), /gleichmäßig aufgeteilt/)
  })
})

describe('KAN-161 – leseZiele (mehrere Rieden, einzelne GST, gemischt)', () => {
  const gst = {
    A: [{ id: 'a1', flaeche_ha: 0.5 }, { id: 'a2', flaeche_ha: 0.5 }],
    B: [{ id: 'b1', flaeche_ha: 1 }, { id: 'b2', flaeche_ha: 2 }],
  }

  test('mehrere ganze Rieden → alle WI-GST aller Rieden, EINE Menge über alle (nicht je Ried die volle Menge)', () => {
    const z = lese.leseZiele(['A', 'B'], [], gst)
    assert.deepEqual(z.map(x => x.grundstueck_id), ['a1', 'a2', 'b1', 'b2'])
    const kg = lese.verteileKg(4000, z.map(x => x.flaeche_ha))
    assert.deepEqual(kg, [500, 500, 1000, 2000])
    assert.equal(summe(kg), 4000)
  })

  test('einzelne GST aus verschiedenen Rieden und gemischte Auswahl; doppelte GST nur einmal', () => {
    const z = lese.leseZiele(['A'], [{ gst_id: 'b2', weingarten_id: 'B' }, { gst_id: 'a1', weingarten_id: 'A' }], gst)
    assert.deepEqual(z.map(x => [x.weingarten_id, x.grundstueck_id, x.flaeche_ha]), [['A', 'a1', 0.5], ['A', 'a2', 0.5], ['B', 'b2', 2]])
    assert.deepEqual(lese.verteileKg(300, z.map(x => x.flaeche_ha)), [50, 50, 200])
  })

  test('Weingarten ohne Grundstücke → eine Zeile am Weingarten mit dessen Fläche', () => {
    const z = lese.leseZiele(['C', 'C'], [], gst, { C: 0.8 })
    assert.deepEqual(z, [{ weingarten_id: 'C', grundstueck_id: null, flaeche_ha: 0.8 }])
    assert.deepEqual(lese.leseZiele(['C'], [], gst), [{ weingarten_id: 'C', grundstueck_id: null, flaeche_ha: null }])
  })

  test('erntebar: mind. ein WI-Grundstück oder gar keine Grundstücke', () => {
    assert.equal(lese.istErntebar(3, 1), true)
    assert.equal(lese.istErntebar(0, 0), true)
    assert.equal(lese.istErntebar(5, 0), false)   // nur Acker/Grünland/Brache
  })
})

// ── KAN-162: Suche ──────────────────────────────────────────────────────────────

describe('KAN-162 – leseSuche', () => {
  const wg = [
    { id: 'g', name: 'GENDL II', lage_name: null, ama_feldnummer: '49' },
    { id: 'h', name: 'Hausberg I', lage_name: 'Hausberg', ama_feldnummer: '050' },
    { id: 'k', name: 'Katzbühel', lage_name: 'Katzbühel', ama_feldnummer: '29' },
  ]
  const gst = {
    g: [{ id: 'g1', gst_nr: '1234/5' }, { id: 'g2', gst_nr: '777' }],
    h: [{ id: 'h1', gst_nr: '49' }],
    k: [{ id: 'k1', gst_nr: '12' }],
  }

  test('leer → nicht aktiv, alles sichtbar', () => {
    const s = lese.leseSuche('   ', wg, gst)
    assert.equal(s.aktiv, false)
    assert.deepEqual([...s.weingaerten], ['g', 'h', 'k'])
  })

  test('Ried-Name und Lage (ohne Groß-/Kleinschreibung, Umlaute) → ganzer Weingarten', () => {
    assert.deepEqual([...lese.leseSuche('gendl', wg, gst).weingaerten], ['g'])
    const s = lese.leseSuche('KATZBÜ', wg, gst)
    assert.deepEqual([...s.weingaerten], ['k'])
    assert.equal(s.gstTreffer.size, 0)
    assert.deepEqual([...lese.leseSuche('hausberg', wg, gst).weingaerten], ['h'])
  })

  test('AMA-Feldstücknummer exakt (führende Nullen egal, „FS 50“), GST-Nummer als Teiltext', () => {
    assert.deepEqual([...lese.leseSuche('50', wg, gst).weingaerten], ['h'])
    assert.deepEqual([...lese.leseSuche('FS 050', wg, gst).weingaerten], ['h'])
    assert.deepEqual([...lese.leseSuche('Feldstück 29', wg, gst).weingaerten], ['k'])
    // „49“: Feldstück von GENDL II (ganz) und GST 49 in Hausberg I (nur dieses Grundstück)
    const s = lese.leseSuche('49', wg, gst)
    assert.deepEqual([...s.weingaerten].sort(), ['g', 'h'])
    assert.equal(s.gstTreffer.has('g'), false)
    assert.deepEqual([...s.gstTreffer.get('h')], ['h1'])
    // „1234“ ist keine Feldstücknummer, trifft aber GST 1234/5 (Teiltext)
    const t = lese.leseSuche('1234', wg, gst)
    assert.deepEqual([...t.weingaerten], ['g'])
    assert.deepEqual([...t.gstTreffer.get('g')], ['g1'])
    assert.deepEqual([...lese.leseSuche('xyz', wg, gst).weingaerten], [])
  })
})

// ── KAN-160/162: „Alle (Treffer) auswählen“ ↔ „… abwählen“ ─────────────────────

describe('KAN-160/162 – Treffer auswählen und abwählen', () => {
  const gst = { A: [{ id: 'a1' }, { id: 'a2' }], B: [{ id: 'b1' }, { id: 'b2' }] }
  const leer = { weingaerten: new Set(), gst: new Map() }
  const ohneSuche = { aktiv: false, weingaerten: new Set(['A', 'B']), gstTreffer: new Map() }
  const gstSuche = { aktiv: true, weingaerten: new Set(['A', 'B']), gstTreffer: new Map([['B', new Set(['b2'])]]) }

  test('leseTreffer: ohne Suche alle ganz, mit GST-Treffer nur diese Grundstücke; nicht Sichtbares fällt weg', () => {
    assert.deepEqual(lese.leseTreffer(['A', 'B', 'X'], ohneSuche), { ganze: ['A', 'B'], einzeln: [] })
    assert.deepEqual(lese.leseTreffer(['A', 'B'], gstSuche), { ganze: ['A'], einzeln: [{ gst_id: 'b2', weingarten_id: 'B' }] })
  })

  test('hinzufügen/entfernen: nur die Treffer, Knopf schaltet um', () => {
    const t = lese.leseTreffer(['A', 'B'], gstSuche)
    assert.equal(lese.trefferAusgewaehlt(t, leer), false)
    const an = lese.trefferHinzufuegen(t, leer)
    assert.deepEqual([...an.weingaerten], ['A'])
    assert.deepEqual([...an.gst], [['b2', 'B']])
    assert.equal(lese.trefferAusgewaehlt(t, an), true)
    assert.equal(lese.alleKnopfText(true, true), 'Alle Treffer abwählen')
    assert.equal(lese.alleKnopfText(false, true), 'Alle Treffer auswählen')
    assert.equal(lese.alleKnopfText(true, false), 'Alle abwählen')
    assert.equal(lese.alleKnopfText(false, false), 'Alle auswählen')
    const aus = lese.trefferEntfernen(t, an, gst)
    assert.equal(aus.weingaerten.size + aus.gst.size, 0)
  })

  test('ganzer Weingarten ersetzt einzeln gewählte GST; GST-Treffer aus ganz gewähltem Weingarten → Rest bleibt einzeln', () => {
    const vorher = { weingaerten: new Set(), gst: new Map([['a1', 'A']]) }
    const an = lese.trefferHinzufuegen({ ganze: ['A'], einzeln: [] }, vorher)
    assert.deepEqual([...an.weingaerten], ['A'])
    assert.equal(an.gst.size, 0)
    const ganzB = { weingaerten: new Set(['B']), gst: new Map() }
    const t = { ganze: [], einzeln: [{ gst_id: 'b2', weingarten_id: 'B' }] }
    assert.equal(lese.trefferAusgewaehlt(t, ganzB), true)
    const aus = lese.trefferEntfernen(t, ganzB, gst)
    assert.equal(aus.weingaerten.has('B'), false)
    assert.deepEqual([...aus.gst], [['b1', 'B']])
  })

  test('alle GST einzeln gewählt zählt wie der ganze Weingarten; teilweise für den halben Haken', () => {
    const einzeln = { weingaerten: new Set(), gst: new Map([['a1', 'A'], ['a2', 'A']]) }
    assert.equal(lese.trefferAusgewaehlt({ ganze: ['A'], einzeln: [] }, einzeln, gst), true)
    assert.equal(lese.trefferAusgewaehlt({ ganze: ['A'], einzeln: [] }, einzeln), false)
    assert.equal(lese.trefferTeilweise({ ganze: ['A', 'B'], einzeln: [] }, { weingaerten: new Set(), gst: new Map([['a1', 'A']]) }), true)
    assert.equal(lese.trefferTeilweise({ ganze: ['B'], einzeln: [] }, einzeln), false)
    assert.equal(lese.trefferAusgewaehlt({ ganze: [], einzeln: [] }, einzeln), false)
  })
})

describe('KAN-160 – gemeinsame Gruppierung (riedAuswahl.ts)', () => {
  test('„Ohne Ried-Zuordnung“ am Ende statt „Alle“; Maßnahmen reichen dieselben Funktionen weiter', () => {
    const g = ried.riedGruppen([{ id: '1', lage_name: null }, { id: '2', lage_name: 'Zwirch' }, { id: '3', lage_name: 'Alt' }])
    assert.deepEqual(g.map(x => x.name), ['Alt', 'Zwirch', 'Ohne Ried-Zuordnung'])
    assert.equal(absenden.riedGruppen, ried.riedGruppen)
    assert.equal(absenden.alleAuswahlModus, ried.alleAuswahlModus)
    assert.equal(absenden.OHNE_RIED_GRUPPE, ried.OHNE_RIED_GRUPPE)
  })
})

// ── Verdrahtung (Quelltext) ─────────────────────────────────────────────────────

describe('Verdrahtung Lese-Erfassung (Quelltext)', () => {
  const client = quelle('src/app/(dashboard)/erntemeldung/[id]/ErnteDetailClient.tsx')
  const form = client.slice(client.indexOf('function NeueParzellenForm('), client.indexOf('// ── Edit-Formular'))
  const edit = client.slice(client.indexOf('function ParzellForm('), client.indexOf('// ── Hauptkomponente'))
  const actions = quelle('src/app/(dashboard)/erntemeldung/actions.ts')
  const start = actions.indexOf('export async function createMultipleErnteParzellen(')
  const action = actions.slice(start, actions.indexOf('\nexport async function ', start + 10))
  const page = quelle('src/app/(dashboard)/erntemeldung/[id]/page.tsx')

  test('KAN-160: keine Gruppe „Alle“/„(Keine Lage)“ mehr, Gruppen aus riedGruppen, nur erntebare wählbar', () => {
    assert.doesNotMatch(client, /lage_name \?\? 'Alle'/)
    assert.doesNotMatch(client, /\(Keine Lage\)/)
    assert.match(form, /const gruppen = riedGruppen\(weingaerten\)/)
    assert.match(edit, /const lagen = riedGruppen\(weingaerten\.filter\(w => w\.erntebar \|\| w\.id === parzelle\?\.weingarten_id\)\)/)   // seit 29.09.2026 nur erntebare
    assert.match(form, /disabled=\{!w\.erntebar\}/)
    assert.match(form, /\{alleKnopfText\(alleAbwaehlen, sucheErg\.aktiv\)\}/)
    assert.match(page, /erntebar: istErntebar\(/)
  })

  test('KAN-161: Vorschau und Action rechnen mit leseZiele + verteileKg, Flächen der Action aus der Datenbank', () => {
    assert.match(form, /const ziele = leseZiele\(/)
    assert.match(form, /verteileKg\(/)
    assert.match(form, /Mengen je Grundstück einzeln erfassen/)
    assert.match(action, /const ziele = leseZiele\(/)
    assert.match(action, /verteileKg\(mengeKg, /)
    // kein Aufteilen je Ried mehr (vorher bekam jede ganz gewählte Ried die volle Menge)
    assert.doesNotMatch(action, /function splitKg/)
    assert.doesNotMatch(action, /for \(const wgId of weingartenIds\)/)
    // Fläche nie aus dem Formular
    assert.doesNotMatch(action, /(gstEntries|wgGsts)\.map\(g => g\.flaeche_ha\)/)
    assert.match(action, /verteileKg\(mengeKg, zuVerteilen\.map\(i => ziele\[i\]\.flaeche_ha\)\)/)
    assert.match(action, /select\(gstSpalten\)\.in\('id', einzelIds\)\.eq\('tenant_id', tenantId\)/)
    assert.match(action, /await ladeJahrgang\(supabase, tenantId, jahrgangId\)/)
    // alle Prüfungen vor dem Schreiben
    assert.ok(action.indexOf('verteileKg(') < action.indexOf('.insert(rows)'))
    assert.ok(action.indexOf('istErntebar(') < action.indexOf('.insert(rows)'))
  })

  test('KAN-162: Suchfeld mit Ried, Lage, Feldstück und GST; Weingärten laden die AMA-Feldstücknummer', () => {
    assert.match(form, /const sucheErg = leseSuche\(suche, weingaerten, gstByWeingarten\)/)
    assert.match(form, /placeholder="Suchen: Ried, Lage, AMA-Feldstück-Nr\. oder GST-Nr\."/)
    assert.match(page, /select\('id, name, rebsorte, flaeche_ha, ama_feldnummer, /)
  })
})
