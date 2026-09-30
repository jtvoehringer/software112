// KAN-132: Maßnahmen aliquot auf die GST verteilen – src/lib/wein/massnahmeAnteile.ts (Regeln im Dateikopf dort)
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { hooksRegistrieren, laden, nurMitHooks } from './buchung-attrappe.mjs'

hooksRegistrieren()

const lage = (id, name) => ({ lage_id: id, lagen: { name } })
const WG = {
  sgv: { id: 'wg-sgv', name: 'Sandgrube Grüner Veltliner', ...lage('lage-sg', 'Sandgrube') },
  smu: { id: 'wg-smu', name: 'Sandgrube Muskateller', ...lage('lage-sg', 'Sandgrube') },
  kre: { id: 'wg-kre', name: 'Kremsleithen Grüner Veltliner', ...lage('lage-kl', 'Kremsleithen') },
  eik: { id: 'wg-eik', name: 'EICHKOGEL', lage_id: null, lagen: null },
}

/** Rohzeile wie aus ladeBehandlungen() */
function roh(id, felder, gst) {
  return {
    id, datum: '2026-06-10', art: 'spritzung', aufwandmenge: null, aufwandmenge_einheit: null, menge_gesamt: null, menge_einheit: null,
    wasseraufwand_l_ha: null, psm: { id: 'psm', name: 'Mittel', cu_gehalt_pct: null }, duengemittel: null, weingarten: null, ...felder,
    behandlung_grundstuecke: gst.map(([gid, nr, ha, wg, extra = {}]) => ({
      grundstueck_id: gid, flaeche_ha: ha,
      grundstueck: { id: gid, gst_nr: nr, katastralgemeinde: extra.kg ?? '12119', flaeche_ha: extra.aktuell ?? ha, weingarten: wg },
    })),
  }
}

describe('KAN-132 verteileMitRest', nurMitHooks, () => {
  test('Summe exakt, größter Rest, Gleitkomma 1049,9999… = 1050, Gleichstand größere Fläche', async () => {
    const { verteileMitRest } = await laden('lib/wein/massnahmeAnteile.ts')
    assert.deepEqual(verteileMitRest(21.15, [0.7, 14.1 - 0.7], 3), [1.05, 20.1])
    assert.deepEqual(verteileMitRest(60, [1, 1, 1], 2), [20, 20, 20])
    assert.deepEqual(verteileMitRest(100, [1, 1, 1], 2), [33.34, 33.33, 33.33])
    assert.deepEqual(verteileMitRest(0.0001, [0.25, 0.55], 4), [0, 0.0001])          // Gleichstand .5: größeres Gewicht
    assert.deepEqual(verteileMitRest(5, [0, 0], 0), [3, 2])                            // ohne Gewicht gleich
    assert.deepEqual(verteileMitRest(-1, [1, 1], 2), [-0.5, -0.5])
    assert.deepEqual(verteileMitRest(1, [], 2), [])
  })
  test('Zufalls-Invariante: Σ = Gesamt, alle ≥ 0, unabhängig von der Reihenfolge der Gewichte (Mehrfachmengen)', async () => {
    const { verteileMitRest } = await laden('lib/wein/massnahmeAnteile.ts')
    let saat = 42
    const zufall = () => ((saat = (saat * 1103515245 + 12345) % 2147483648) / 2147483648)
    for (let k = 0; k < 300; k++) {
      const n = 1 + Math.floor(zufall() * 12)
      const gewichte = Array.from({ length: n }, () => Math.round(zufall() * 30000) / 10000)
      const gesamt = Math.round(zufall() * 1e6) / 1000
      const erg = verteileMitRest(gesamt, gewichte, 3)
      assert.equal(Math.round(erg.reduce((s, x) => s + x, 0) * 1000), Math.round(gesamt * 1000))
      assert.ok(erg.every(x => x >= 0))
      // gleiche Gewichte als Multimenge → gleiche Werte je Gewicht (umgekehrte Reihenfolge)
      const umgekehrt = verteileMitRest(gesamt, [...gewichte].reverse(), 3).reverse()
      const jeGewicht = e => gewichte.map((w, i) => `${w}:${e[i]}`).sort().join()
      if (new Set(gewichte).size === gewichte.length) assert.equal(jeGewicht(umgekehrt), jeGewicht(erg))
    }
  })
})

describe('KAN-132 verteileMassnahme', nurMitHooks, () => {
  test('Cuprozin progress (1,5 kg/ha, Σf 14,1 ha, 35 % Cu): GST, Ried (Weingarten), Lage, je 0,525 kg Cu/ha', async () => {
    const psm = await laden('lib/behoerden/psm.ts')
    const { verteileMassnahme, summiereJe, hoechsteGstBelastung } = await laden('lib/wein/massnahmeAnteile.ts')
    const b = psm.normalisiereBehandlung(roh('m2c', { aufwandmenge: 1.5, aufwandmenge_einheit: 'kg_ha', psm: { id: 'cu', name: 'Cuprozin progress', cu_gehalt_pct: 35 } }, [
      ['g1', '1305/1', 1.5, WG.sgv], ['g2', '1305/2', 0.9, WG.sgv], ['g3', '1307/3', 0.55, WG.smu], ['g4', '1021/5', 0.25, WG.kre],
      ['g5', '1021/6', 2, WG.kre], ['g6', '1021/7', 2, WG.kre], ['g7', '1021/8', 2, WG.kre], ['g8', '1021/9', 2, WG.kre],
      ['g9', '1022/1', 1, WG.kre], ['g10', '1022/2', 0.9, WG.kre], ['g11', '1022/3', 1, WG.kre],
    ]))
    const v = verteileMassnahme(b, { cuPct: 35 })
    const je = new Map(v.anteile.map(a => [a.gstNr, a]))
    assert.equal(je.get('1305/1').mittel, 2.25); assert.equal(je.get('1305/1').cuKg, 0.7875)
    assert.equal(je.get('1305/2').mittel, 1.35); assert.equal(je.get('1305/2').cuKg, 0.4725)
    assert.equal(je.get('1307/3').cuKg, 0.2888)                       // Rest .5: größere Fläche vor 1021/5 (0,25 ha)
    assert.equal(je.get('1021/5').cuKg, 0.1312)
    const wg = summiereJe([v], 'weingarten').get('wg-sgv')
    assert.equal(wg.mittel.get('Cuprozin progress|kg').menge, 3.6)
    assert.equal(wg.cuKg, 1.26)
    const lg = summiereJe([v], 'lage').get('lage-sg')
    assert.equal(lg.mittel.get('Cuprozin progress|kg').menge, 4.425)
    assert.equal(lg.cuKg, 1.5488)
    assert.equal(summiereJe([v], 'betrieb').get('betrieb').cuKg, 7.4025)
    for (const a of v.anteile) assert.ok(Math.abs(a.cuKgHa - 0.525) < 1e-12)
    assert.ok(Math.abs(hoechsteGstBelastung([v], 'weingarten').get('wg-sgv') - 0.525) < 1e-12)
  })

  test('Steward (0,125 kg/ha auf 4,75 ha = 0,594 kg): Σ der Anteile 0,594 statt einzeln gerundet 0,596', async () => {
    const psm = await laden('lib/behoerden/psm.ts')
    const { verteileMassnahme } = await laden('lib/wein/massnahmeAnteile.ts')
    const b = psm.normalisiereBehandlung(roh('m2a', { aufwandmenge: 0.125, aufwandmenge_einheit: 'kg_ha', psm: { id: 'st', name: 'Steward' } }, [
      ['k1', '1021/5', 0.7, WG.kre], ['k2', '1021/6', 0.7, WG.kre], ['k3', '1021/7', 0.7, WG.kre], ['k4', '1021/8', 0.7, WG.kre],
      ['k5', '1022/1', 0.95, WG.kre], ['k6', '1022/2', 1, WG.kre],
    ]))
    const v = verteileMassnahme(b)
    assert.equal(Math.round(v.anteile.reduce((s, a) => s + a.mittel, 0) * 1000), 594)
    const einzeln = v.anteile.reduce((s, a) => s + Math.round(0.594 * a.flaecheHa / 4.75 * 1000), 0)
    assert.equal(einzeln, 596)                                         // so rechnete „Menge anteilig (GST)“ bisher
  })

  test('EICHKOGEL (8 WI-Zeilen, 0,4368 ha, 1,5 kg/ha, 60,00 €): Σ 0,655 kg und 60,00 €; 2233 = 0,024 kg; 1921 = 1,08 €', async () => {
    const psm = await laden('lib/behoerden/psm.ts')
    const { verteileMassnahme } = await laden('lib/wein/massnahmeAnteile.ts')
    const b = psm.normalisiereBehandlung(roh('eik', { aufwandmenge: 1.5, aufwandmenge_einheit: 'kg_ha', psm: { id: 'cu', name: 'Cuprozin progress', cu_gehalt_pct: 35 } }, [
      ['e1', '2230', 0.1371, WG.eik], ['e2', '2231', 0.1, WG.eik], ['e3', '2232', 0.0888, WG.eik], ['e4', '2234', 0.047, WG.eik],
      ['e5', '2235', 0.0233, WG.eik], ['e6', '2233', 0.016, WG.eik], ['e7', '1921', 0.0079, WG.eik], ['e8', '2236', 0.0167, WG.eik],
    ]))
    const v = verteileMassnahme(b, { cuPct: 35, kostenEur: 60 })
    const je = new Map(v.anteile.map(a => [a.gstNr, a]))
    assert.equal(Math.round(v.anteile.reduce((s, a) => s + a.mittel, 0) * 1000), 655)
    assert.equal(Math.round(v.anteile.reduce((s, a) => s + a.kostenEur, 0) * 100), 6000)
    assert.equal(je.get('2233').mittel, 0.024)
    assert.equal(je.get('1921').kostenEur, 1.08)
  })

  test('Brühe-Fall (2 l/ha, Menge gesamt 480 l Brühe, 1,2 ha): Mittel 2,4 (l), Brühe 480 l anteilig – nie 480 als Mittel', async () => {
    const psm = await laden('lib/behoerden/psm.ts')
    const { verteileMassnahme } = await laden('lib/wein/massnahmeAnteile.ts')
    const b = psm.normalisiereBehandlung(roh('br', { aufwandmenge: 2, aufwandmenge_einheit: 'l_ha', menge_gesamt: 480, menge_einheit: 'l', psm: { id: 'x', name: 'Flüssig', cu_gehalt_pct: 10 } }, [
      ['b1', '1', 0.8, WG.kre], ['b2', '2', 0.4, WG.kre],
    ]))
    const v = verteileMassnahme(b, { cuPct: 10, literAlsKg: true })
    assert.deepEqual(v.anteile.map(a => [a.mittel, a.mittelEinheit, a.menge, a.mengeEinheit]), [[1.6, 'l', 320, 'l'], [0.8, 'l', 160, 'l']])
    assert.equal(Math.round(v.anteile.reduce((s, a) => s + a.cuKg, 0) * 10000), 2400)   // 2,4 kg (1 kg/l) × 10 %
  })

  test('Kleinstfläche 0,0001 ha mit zwei Cu-Spritzungen: kg/ha je GST = kg/ha der Maßnahmen (Regel 6)', async () => {
    const psm = await laden('lib/behoerden/psm.ts')
    const { verteileMassnahme, hoechsteGstBelastung } = await laden('lib/wein/massnahmeAnteile.ts')
    const sp = id => psm.normalisiereBehandlung(roh(id, { aufwandmenge: 1.5, aufwandmenge_einheit: 'kg_ha', psm: { id: 'cu', name: 'Cu', cu_gehalt_pct: 35 } }, [
      ['klein', '99/1', 0.0001, WG.eik], ['gross', '99/2', 1, WG.eik],
    ]))
    const vs = [verteileMassnahme(sp('a'), { cuPct: 35 }), verteileMassnahme(sp('b'), { cuPct: 35 })]
    const klein = vs[0].anteile.find(a => a.gstNr === '99/1')
    assert.ok(Math.abs(klein.cuKgHa - 0.525) < 1e-9)
    assert.ok(klein.cuKg === 0 || klein.cuKg === 0.0001)               // gerundet unbrauchbar – daher cuKgHa
    assert.ok(Math.abs(hoechsteGstBelastung(vs, 'weingarten').get('wg-eik') - 1.05) < 1e-9)
  })

  test('Randfälle: 1 GST, Σf = 0, einzelnes GST ohne Fläche, Aufwand kg gesamt, g/hl mit Wasser, gleiche GST-Nr. zweimal', async () => {
    const psm = await laden('lib/behoerden/psm.ts')
    const { verteileMassnahme, WARNUNG_GLEICH, WARNUNG_GST_OHNE_FLAECHE } = await laden('lib/wein/massnahmeAnteile.ts')
    const n = (f, gst) => psm.normalisiereBehandlung(roh('r', f, gst))
    const eins = verteileMassnahme(n({ aufwandmenge: 3, aufwandmenge_einheit: 'kg' }, [['a', '1', 0.5, WG.kre]]))
    assert.deepEqual(eins.anteile.map(a => [a.anteil, a.mittel]), [[1, 3]])
    const nullF = verteileMassnahme(n({ aufwandmenge: 3, aufwandmenge_einheit: 'kg' }, [['a', '1', 0, WG.kre, { aktuell: 0 }], ['b', '2', 0, WG.kre, { aktuell: 0 }], ['c', '3', 0, WG.kre, { aktuell: 0 }]]))
    assert.deepEqual(nullF.anteile.map(a => [a.flaechenQuelle, a.mittel]), [['gleich', 1], ['gleich', 1], ['gleich', 1]])
    assert.deepEqual(nullF.warnungen, [WARNUNG_GLEICH])
    const teil = verteileMassnahme(n({ aufwandmenge: 3, aufwandmenge_einheit: 'kg' }, [['a', '1', 1, WG.kre], ['b', '2', null, WG.kre, { aktuell: null }]]))
    assert.deepEqual(teil.anteile.map(a => [a.gstNr, a.anteil, a.mittel]), [['1', 1, 3], ['2', 0, 0]])
    assert.deepEqual(teil.warnungen, [WARNUNG_GST_OHNE_FLAECHE])
    // g/hl: 150 g/hl × Wasser 400 l/ha × 1,5 ha = 600 l Brühe → 0,9 kg
    const ghl = verteileMassnahme(n({ aufwandmenge: 150, aufwandmenge_einheit: 'g_hl', wasseraufwand_l_ha: 400 }, [['a', '1', 1, WG.kre], ['b', '2', 0.5, WG.kre]]))
    assert.deepEqual(ghl.anteile.map(a => a.mittel), [0.6, 0.3])
    // Teilflächen: zwei Zeilen mit derselben KG+GST-Nr. und Fläche werden je Zeile gerechnet
    const doppelt = verteileMassnahme(n({ aufwandmenge: 1, aufwandmenge_einheit: 'kg' }, [['x1', '5/1', 0.5, WG.kre], ['x2', '5/1', 0.5, WG.kre]]))
    assert.deepEqual(doppelt.anteile.map(a => [a.grundstueckId, a.mittel]), [['x1', 0.5], ['x2', 0.5]])
    // Snapshot vor aktueller Fläche; ohne Snapshot die aktuelle
    const snap = verteileMassnahme(n({ aufwandmenge: 1, aufwandmenge_einheit: 'kg' }, [['s1', '1', 1, WG.kre, { aktuell: 3 }], ['s2', '2', null, WG.kre, { aktuell: 1 }]]))
    assert.deepEqual(snap.anteile.map(a => [a.flaechenQuelle, a.anteil]), [['snapshot', 0.5], ['aktuell', 0.5]])
  })

  test('Maßnahme nur am Weingarten: ohne WI-GST-Liste eine Zeile, mit Liste auf die WI-GST verteilt (Vermerk); ganz ohne Ort nicht verteilbar', async () => {
    const psm = await laden('lib/behoerden/psm.ts')
    const { verteileMassnahme, summiereJe, VERMERK_AM_WEINGARTEN } = await laden('lib/wein/massnahmeAnteile.ts')
    const nurWg = psm.normalisiereBehandlung({ ...roh('w', { aufwandmenge: 1, aufwandmenge_einheit: 'kg_ha', behandelte_flaeche_ha: 2, weingarten_id: WG.kre.id, weingarten: { ...WG.kre, flaeche_ha: 2 } }, []) })
    const ohneListe = verteileMassnahme(nurWg)
    assert.deepEqual(ohneListe.anteile.map(a => [a.grundstueckId, a.weingarten, a.mittel, a.vermerk]), [[null, 'Kremsleithen Grüner Veltliner', 2, VERMERK_AM_WEINGARTEN]])
    const wi = new Map([[WG.kre.id, [
      { grundstueckId: 'w1', gstNr: '7/1', kgNr: '1', weingartenId: WG.kre.id, weingarten: WG.kre.name, ried: 'Kremsleithen', lageId: 'lage-kl', flaecheHa: 1.5 },
      { grundstueckId: 'w2', gstNr: '7/2', kgNr: '1', weingartenId: WG.kre.id, weingarten: WG.kre.name, ried: 'Kremsleithen', lageId: 'lage-kl', flaecheHa: 0.5 },
    ]]])
    const mitListe = verteileMassnahme(nurWg, { wiGstJeWeingarten: wi, kostenEur: 10 })
    assert.deepEqual(mitListe.anteile.map(a => [a.gstNr, a.mittel, a.kostenEur, a.flaechenQuelle]), [['7/1', 1.5, 7.5, 'weingarten'], ['7/2', 0.5, 2.5, 'weingarten']])
    assert.equal(summiereJe([mitListe], 'weingarten').get(WG.kre.id).kostenEur, 10)
    const ohneOrt = verteileMassnahme(psm.normalisiereBehandlung(roh('o', { aufwandmenge: 1, aufwandmenge_einheit: 'kg' }, [])))
    assert.equal(ohneOrt.ohneOrt, true)
    assert.deepEqual(ohneOrt.anteile, [])
  })

  test('Düngung: Düngermenge anteilig, N/P je GST mit Restausgleich', async () => {
    const psm = await laden('lib/behoerden/psm.ts')
    const { verteileMassnahme, summiereJe } = await laden('lib/wein/massnahmeAnteile.ts')
    const b = psm.normalisiereBehandlung(roh('d', {
      art: 'duengung', psm: null, menge_gesamt: 100, menge_einheit: 'kg',
      duengemittel: { id: 'dm', name: 'Biosol', einheit: 'kg', naehrstoff_n_pct: 7, naehrstoff_p_pct: 1 },
    }, [['a', '1', 1, WG.kre], ['b', '2', 1, WG.kre], ['c', '3', 1, WG.kre]]))
    const v = verteileMassnahme(b)
    assert.deepEqual(v.anteile.map(a => [a.menge, a.mittel, a.nKg, a.pKg]), [[33.334, 33.334, 2.334, 0.334], [33.333, 33.333, 2.333, 0.333], [33.333, 33.333, 2.333, 0.333]])
    const s = summiereJe([v], 'betrieb').get('betrieb')
    assert.equal(s.nKg, 7); assert.equal(s.pKg, 1)
  })
})

describe('KAN-132 Cu-Bilanz über die GST-Anteile', nurMitHooks, () => {
  const stamm = (w, gst) => ({
    id: w.id, name: w.name, ried: w.lagen?.name ?? null, lageId: w.lage_id, flaecheHa: null, aktiv: true,
    wiFlaecheHa: gst.reduce((s, g) => s + g.flaecheHa, 0),
    wiGst: gst.map(g => ({ weingartenId: w.id, weingarten: w.name, ried: w.lagen?.name ?? null, lageId: w.lage_id, kgNr: '1', kgName: null, ...g })),
  })
  test('Kleinst-GST: Ried-Schnitt im Rahmen, höchste GST-Belastung über 4 kg/ha → Status GST', async () => {
    const psm = await laden('lib/behoerden/psm.ts')
    const cu = await laden('lib/behoerden/cu.ts')
    // 8 Spritzungen je 1,5 kg/ha × 35 % = 4,2 kg Cu/ha nur auf dem Kleinst-GST; das große GST bekommt nur eine
    const klein = n => psm.normalisiereBehandlung(roh(`k${n}`, { datum: `2026-0${n}-01`, aufwandmenge: 1.5, aufwandmenge_einheit: 'kg_ha', psm: { id: 'cu', name: 'Cu', cu_gehalt_pct: 35 } },
      [['klein', '99/1', 0.0001, WG.eik]]))
    const gross = psm.normalisiereBehandlung(roh('g', { aufwandmenge: 1.5, aufwandmenge_einheit: 'kg_ha', psm: { id: 'cu', name: 'Cu', cu_gehalt_pct: 35 } }, [['gross', '99/2', 1, WG.eik]]))
    const b = [1, 2, 3, 4, 5, 6, 7, 8].map(klein).concat(gross)
    const wg = [stamm(WG.eik, [{ grundstueckId: 'klein', gstNr: '99/1', flaecheHa: 0.0001 }, { grundstueckId: 'gross', gstNr: '99/2', flaecheHa: 1 }])]
    const z = cu.cuBilanz(b, wg, { jahre: [2026] }).weingartenZeilen[0]
    assert.equal(z.flaecheHa, 1.0001)
    assert.equal(z.status, 'im Rahmen')
    assert.equal(z.gstMaxKgHa, 4.2)
    assert.equal(z.gstStatus, 'über Grenzwert')
  })
  test('Maßnahme nur am Weingarten: in der Cu-Bilanz auf die WI-GST der Ried verteilt', async () => {
    const psm = await laden('lib/behoerden/psm.ts')
    const cu = await laden('lib/behoerden/cu.ts')
    const nurWg = psm.normalisiereBehandlung(roh('w', { aufwandmenge: 2, aufwandmenge_einheit: 'kg', weingarten_id: WG.kre.id, weingarten: { ...WG.kre, flaeche_ha: null }, psm: { id: 'cu', name: 'Cu', cu_gehalt_pct: 50 } }, []))
    const wg = [stamm(WG.kre, [{ grundstueckId: 'a', gstNr: '1', flaecheHa: 0.5 }, { grundstueckId: 'b', gstNr: '2', flaecheHa: 1.5 }])]
    const z = cu.cuBilanz([nurWg], wg, { jahre: [2026] }).weingartenZeilen[0]
    assert.deepEqual([z.weingarten, z.flaecheHa, z.cuKg, z.cuKgHa, z.gstMaxKgHa], ['Kremsleithen Grüner Veltliner', 2, 1, 0.5, 0.5])
  })
})
