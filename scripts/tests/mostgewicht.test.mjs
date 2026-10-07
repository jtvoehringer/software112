// KAN-128 Teil A, S1 (26.09.2026): Rechenkern Mostgewicht °KMW/°Oe (src/lib/wein/mostgewicht.ts)
//
// Aufruf:  node --experimental-strip-types --disable-warning=ExperimentalWarning --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test scripts/tests/mostgewicht.test.mjs
//          (Node ≥ 22.6, ohne Datenbank; läuft auch über npm run test:csv)
//
// (1) Schwellentabelle (Variante B verbindlich, Entscheidung 6; Variante A als Vergleich)
// (2) Beispiele der Akzeptanzkriterien (Teil A)
// (3) Hin- und Rückrechnung ohne Drift, Öffnen und Speichern ohne Änderung
// (4) Mittelwerte (Rechenregel 7), Grenzbereich, Anzeige, Abrunden (Entscheidung 8)
// (5) Eingaben (parseEingabe) und ungültige Werte
// (6) JavaScript-Gleitkomma-Fallen
// (7) Golden-Tabelle: scripts/tests/golden/mostgewicht_golden.csv vollständig gegen ausMessung(),
//     dazu der Gesamtbereich 0–350 °Oe / 0–60 °KMW per md5 gegen dieselbe Rechnung in SQL
//
// Golden-Tabelle: am 26.09.2026 per SELECT in Supabase (zwcsgnemijkpyxrqykul) erzeugt – dieselbe
// Formel wie die Funktionen der Migration A (s112_oechsle_aus_kmw, s112_kmw_aus_oechsle), inline:
//
//   with oe as (select n, (n/10.0)::numeric(5,1) as p from generate_series(500,2500) n),
//   oe_a as (select n, p, floor(((sqrt(20.6116 + 0.088 * p) - 4.54) / 0.044) * 100 + 0.000000001) / 100 as a from oe),
//   oe_b as (select n, p, case when round((a + 0.01) * (0.022 * (a + 0.01) + 4.54), 1) <= p then a + 0.01 else a end as b from oe_a),
//   km as (select n, (n/100.0)::numeric(5,2) as k from generate_series(1000,4000) n),
//   zeilen as (
//     select 1 as teil, n, 'oechsle;' || p::text || ';' || b::numeric(5,2)::text || ';' || p::text as z from oe_b
//     union all
//     select 2, n, 'kmw;' || k::text || ';' || k::text || ';' || round(k * (0.022 * k + 4.54), 1)::numeric(5,1)::text from km)
//   select 'einheit;wert;kmw;oechsle' || E'\n' || string_agg(z || E'\n', '' order by teil, n) from zeilen
//
// Ergebnis (5.002 Zeilen, 116.066 Zeichen, LF) = Datei byte-genau: SHA-256 in SQL
// (encode(sha256(convert_to(…, 'UTF8')), 'hex')) und md5 stimmen mit der Datei überein. In SQL
// außerdem geprüft: B ist für alle 2.001 °Oe-Werte maximal (f(B + 0,01) gerundet > °Oe) und
// verlustfrei (f(B) gerundet = °Oe). Nach einem Wechsel der Formel (Entscheidung 6) neu erzeugen
// und GOLDEN_SHA256 anpassen.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const mg = await import('../../src/lib/wein/mostgewicht.ts')
const { kmwZuQualitaet } = await import('../../src/lib/weinqualitaet.ts')
const {
  oechsleAusKmw, kmwAusOechsle, ausMessung, kmwVarianteA, abrunden, runden, mindestOechsle,
  mischen, imGrenzbereich, parseEingabe, format, formatKmw, formatOechsle,
  KMW_MAX, OECHSLE_MAX, GRENZ_BAND_OECHSLE, istMostgewichtEinheit,
} = mg

const HIER = path.dirname(fileURLToPath(import.meta.url))
const GOLDEN = path.join(HIER, 'golden', 'mostgewicht_golden.csv')
const GOLDEN_SHA256 = '024f1aac426fed9ff38e76c7a6392ceaa2018b38f8a763b1dcc0a56b6fd6953b'

/** Mindest-°KMW der Stufen (§§ 9–11 WeinG, wie kmwZuQualitaet) */
const SCHWELLEN = [14, 15, 17, 19, 21, 25, 30]

const oe = wert => ausMessung(wert, 'oechsle')
const kmw = wert => ausMessung(wert, 'kmw')
const stufe = m => kmwZuQualitaet(m.kmw)
/** °Oe zu °KMW über die Gleitkomma-Formel mit kaufmännischem runden() – auch über KMW_MAX */
const fOe = k => runden(oechsleAusKmw(k), 1)
/** exakt in ganzen Zahlen (unabhängig vom Kern): °Oe-Zehntel zu °KMW-Hundertstel h */
function oeZehntelExakt(h) {
  const x = 22 * h * h + 454000 * h + 500000
  return (x - (x % 1000000)) / 1000000
}

/** alle Werte eines Rasters als ganze Einheiten → Zahl (ohne Gleitkomma-Summen) */
function raster(von, bis, stellen) {
  const f = 10 ** stellen
  const werte = []
  for (let i = Math.round(von * f); i <= Math.round(bis * f); i++) werte.push(i / f)
  return werte
}

// ── (1) Schwellentabelle ────────────────────────────────────────────────────

// Stufe, °KMW, °Oe exakt (2 Stellen), BKI Anl. Ia (null = nicht in der Tabelle),
// ab B (0,1 / ganz), ab A (0,1 / ganz) – KAN-128, Abschnitt „Schwellen in °Oe“
const TABELLE = [
  ['landwein',             14,  67.87,  67.9,   67.9, 68,   67.9, 68],
  ['qualitaetswein',       15,  73.05,  73.1,   73.1, 74,   73.1, 74],
  ['kabinett',             17,  83.54,  83.5,   83.5, 84,   83.6, 84],
  ['spaetlese',            19,  94.20,  94.2,   94.2, 95,   94.3, 95],
  ['auslese',              21, 105.04, 105.0,  105.0, 105, 105.1, 106],
  ['beerenauslese',        25, 127.25,  null,  127.3, 128, 127.3, 128],
  ['trockenbeerenauslese', 30, 156.00,  null,  156.0, 156, 156.0, 156],
]

/** kleinster Wert auf dem Raster (Schritt 10^-stellen), dessen Umrechnung mindestens `schwelle` ergibt */
function abScan(schwelle, stellen, umrechnen) {
  for (const w of raster(0, OECHSLE_MAX, stellen)) if (umrechnen(w) >= schwelle) return w
  return null
}

describe('(1) Schwellentabelle', () => {
  for (const [name, s, exakt, bki, abB1, abB0, abA1, abA0] of TABELLE) {
    test(`${name} (${s} °KMW)`, () => {
      assert.equal(kmwZuQualitaet(s), name, 'Schwelle passt zu kmwZuQualitaet')
      assert.equal(runden(oechsleAusKmw(s), 2), exakt, '°Oe exakt')
      if (bki != null) assert.equal(kmw(s).oechsle, bki, 'BKI Anl. Ia = f(°KMW) auf 0,1')
      // Variante B (verbindlich)
      assert.equal(mindestOechsle(s, 1), abB1, 'ab B, 0,1 °Oe')
      assert.equal(mindestOechsle(s, 0), abB0, 'ab B, ganze °Oe')
      assert.equal(abScan(s, 1, w => oe(w).kmw), abB1, 'ab B per Rasterscan (0,1)')
      assert.equal(abScan(s, 0, w => oe(w).kmw), abB0, 'ab B per Rasterscan (ganz)')
      assert.equal(stufe(oe(abB1)), name, 'ab B ergibt die Stufe')
      assert.notEqual(stufe(oe(runden(abB1 - 0.1, 1))), name, '0,1 °Oe darunter nicht')
      assert.equal(stufe(oe(abB0)), name)
      assert.notEqual(stufe(oe(abB0 - 1)), name)
      // Variante A (nur Vergleich)
      assert.equal(abScan(s, 1, kmwVarianteA), abA1, 'ab A, 0,1 °Oe')
      assert.equal(abScan(s, 0, kmwVarianteA), abA0, 'ab A, ganze °Oe')
    })
  }

  test('B = BKI-Tabelle: 83,5 / 94,2 / 105,0 °Oe = 17,00 / 19,00 / 21,00 °KMW; A knapp darunter', () => {
    assert.deepEqual([83.5, 94.2, 105.0].map(w => oe(w).kmw), [17, 19, 21])
    assert.deepEqual([83.5, 94.2, 105.0].map(kmwVarianteA), [16.99, 18.99, 20.99])
  })
})

// ── (2) Akzeptanzkriterien ──────────────────────────────────────────────────

describe('(2) Beispiele der Akzeptanzkriterien', () => {
  test('83,5 °Oe → 17,00 °KMW → Kabinett mit Grenzfall-Hinweis', () => {
    const m = oe(83.5)
    assert.deepEqual(m, { kmw: 17, oechsle: 83.5, einheit: 'oechsle' })
    assert.equal(stufe(m), 'kabinett')
    assert.equal(imGrenzbereich(m.kmw, SCHWELLEN), 17)
    assert.equal(imGrenzbereich(m, SCHWELLEN), 17)
  })

  test('94,2 → 19,00 → Spätlese; 105,0 → 21,00 → Auslese', () => {
    assert.equal(oe(94.2).kmw, 19)
    assert.equal(stufe(oe(94.2)), 'spaetlese')
    assert.equal(oe(105.0).kmw, 21)
    assert.equal(stufe(oe(105.0)), 'auslese')
  })

  test('73 °Oe → 14,99 °KMW → Landwein', () => {
    assert.equal(oe(73).kmw, 14.99)
    assert.equal(stufe(oe(73)), 'landwein')
    assert.equal(imGrenzbereich(14.99, SCHWELLEN), 15)
  })

  test('156,0 °Oe → 30,00 °KMW → Trockenbeerenauslese (imGrenzbereich, mindestOechsle)', () => {
    assert.equal(oe(156.0).kmw, 30)
    assert.equal(stufe(oe(156.0)), 'trockenbeerenauslese')
    assert.equal(imGrenzbereich(oe(156.0).kmw, SCHWELLEN), 30)
    assert.equal(mindestOechsle(30), 156)
    assert.equal(mindestOechsle(30, 0), 156)
    assert.equal(oe(155.9).kmw < 30, true)
  })

  test('17,0 °KMW → ≈ 83,5 °Oe', () => {
    assert.deepEqual(kmw(17.0), { kmw: 17, oechsle: 83.5, einheit: 'kmw' })
    assert.equal(format(kmw(17.0)), '17,0 °KMW · ≈ 83,5 °Oe')
  })

  test('Vergleich Variante A: 94,2 → 18,99 → Kabinett, 94,3 → 19,01 → Spätlese, 83,5 → 16,99 → Qualitätswein', () => {
    assert.equal(kmwVarianteA(94.2), 18.99)
    assert.equal(kmwZuQualitaet(kmwVarianteA(94.2)), 'kabinett')
    assert.equal(kmwVarianteA(94.3), 19.01)
    assert.equal(kmwZuQualitaet(kmwVarianteA(94.3)), 'spaetlese')
    assert.equal(kmwVarianteA(83.5), 16.99)
    assert.equal(kmwZuQualitaet(kmwVarianteA(83.5)), 'qualitaetswein')
    // B dagegen
    assert.equal(oe(94.3).kmw, 19.02)
  })

  test('Betrieb mit °Oe: 84 °Oe → 84,0 °Oe, 17,09 °KMW, oechsle; 83,5 eingebbar, 83,55 abgelehnt', () => {
    assert.deepEqual(oe(84), { kmw: 17.09, oechsle: 84, einheit: 'oechsle' })
    assert.equal(format(oe(84), 'oechsle'), '84,0 °Oe · ≈ 17,09 °KMW')
    assert.deepEqual(parseEingabe('83,5', 'oechsle'), { ok: true, wert: 83.5 })
    assert.equal(parseEingabe('83,55', 'oechsle').ok, false)
    assert.deepEqual(parseEingabe('84', 'oechsle'), { ok: true, wert: 84 })
  })

  test('überschriebenes ≈ 83,5 °Oe (aus 16,99 °KMW) wechselt die Stufe Qualitätswein → Kabinett', () => {
    const vorher = kmw(16.99)
    assert.equal(vorher.oechsle, 83.5)
    assert.equal(stufe(vorher), 'qualitaetswein')
    const nachher = oe(vorher.oechsle)
    assert.equal(nachher.kmw, 17)
    assert.equal(stufe(nachher), 'kabinett')
  })

  test('Öffnen und Speichern ohne Änderung ändert nichts (73 °Oe, 94,2 °Oe, 14,9 °KMW)', () => {
    for (const [wert, einheit] of [[73, 'oechsle'], [94.2, 'oechsle'], [14.9, 'kmw']]) {
      const gespeichert = ausMessung(wert, einheit)
      const wieder = ausMessung(einheit === 'kmw' ? gespeichert.kmw : gespeichert.oechsle, einheit)
      assert.deepEqual(wieder, gespeichert, `${wert} ${einheit}`)
    }
    assert.deepEqual(oe(73), { kmw: 14.99, oechsle: 73, einheit: 'oechsle' })
    assert.deepEqual(oe(94.2), { kmw: 19, oechsle: 94.2, einheit: 'oechsle' })
    assert.deepEqual(kmw(14.9), { kmw: 14.9, oechsle: 72.5, einheit: 'kmw' })
  })

  test('Abrunden (Entscheidung 8): 94 °Oe (18,97 °KMW) → „18,9“, 83,5 °Oe → „17,0“, 18,95 °KMW → „18,9“', () => {
    assert.equal(oe(94).kmw, 18.97)                       // Rechenregel 8: nicht 19,0
    assert.equal(abrunden(oe(94).kmw, 1), 18.9)
    assert.equal(formatKmw(oe(94).kmw, 1), '18,9')
    assert.equal(formatKmw(oe(83.5).kmw, 1), '17,0')
    assert.equal(formatKmw(18.95, 1), '18,9')
    assert.equal(runden(18.95, 1), 19)                    // kaufmännisch wäre es 19,0
    assert.equal(format(kmw(18.95), 'kmw', { kmwStellen: 1 }), '18,9 °KMW · ≈ 93,9 °Oe')
  })

  test('19,0 °KMW gemessen: 1 Stelle ohne Stufenwechsel', () => {
    const m = kmw(19.0)
    assert.equal(abrunden(m.kmw, 1), 19)
    assert.equal(kmwZuQualitaet(abrunden(m.kmw, 1)), stufe(m))
    assert.equal(formatKmw(m.kmw, 1), '19,0')
  })
})

// ── (3) Hin- und Rückrechnung ───────────────────────────────────────────────

describe('(3) Hin- und Rückrechnung ohne Drift', () => {
  const alleOe = raster(0, OECHSLE_MAX, 1)
  const alleKmw = raster(0, KMW_MAX, 2)
  // °KMW, deren ≈ °Oe als Messwert eingebbar ist (0–59,78 °KMW; 59,79–60 °KMW ergeben über 350 °Oe)
  const kmwMitOe = alleKmw.filter(k => kmw(k).oechsle <= OECHSLE_MAX)

  test('°Oe → °KMW (B) → °Oe verlustfrei für 0,0–350,0 °Oe; B ist maximal', () => {
    for (const w of alleOe) {
      const m = oe(w)
      assert.equal(m.oechsle, w)
      assert.equal(fOe(m.kmw), w, `${w} °Oe → ${m.kmw} °KMW → zurück`)
      if (m.kmw <= KMW_MAX) assert.equal(kmw(m.kmw).oechsle, w)
      assert.ok(fOe(runden(m.kmw + 0.01, 2)) > w, `${w}: B nicht maximal`)
    }
  })

  test('B liegt höchstens zwei Schritte über A – zwei nur bei 20 Werten unter 42,1 °Oe', () => {
    // Unter ≈ 9 °KMW steigt f je 0,01 °KMW um weniger als 0,05 °Oe; dann runden zwei
    // aufeinanderfolgende °KMW-Werte über A auf dasselbe Zehntel. Die Skizze von
    // s112_kmw_aus_oechsle in KAN-128 prüft nur a + 0,01 und läge dort 0,01 °KMW zu tief –
    // die SQL-Funktion muss a + 0,02 mitprüfen (in SQL nachgerechnet, siehe (7) Gesamtbereich).
    const zwei = []
    for (const w of alleOe) {
      const d = runden(oe(w).kmw - kmwVarianteA(w), 2)
      assert.ok(d === 0 || d === 0.01 || d === 0.02, `${w} °Oe: B − A = ${d}`)
      if (d === 0.02) zwei.push(w)
    }
    assert.deepEqual(zwei, [1.5, 2, 2.5, 3.6, 4.1, 5.8, 10, 11.3, 14.8, 15.5, 16.3, 18.7, 20.4, 21.3, 25.3, 26.4, 28.8, 33.1, 34.8, 42])
    assert.equal(oe(42).kmw, 8.88)
    assert.equal(kmwVarianteA(42), 8.86)
  })

  test('°KMW → °Oe → °KMW: nie tiefer, ab 10,5 °KMW höchstens +0,01; danach Fixpunkt', () => {
    assert.equal(kmwMitOe.at(-1), 59.78)
    for (const k of kmwMitOe) {
      const zurueck = oe(kmw(k).oechsle).kmw
      const d = runden(zurueck - k, 2)
      assert.ok(d >= 0 && d <= (k >= 10.5 ? 0.01 : 0.02), `${k} °KMW → ${zurueck}`)
      assert.equal(oe(kmw(zurueck).oechsle).kmw, zurueck, `${k}: zweite Runde driftet`)
    }
  })

  test('°KMW mit 1 Stelle über die °Oe-Anzeige zurück: unter B nie ein Stufenwechsel, unter A genau 17,0/19,0/21,0', () => {
    const wechselA = []
    for (const k of raster(0, KMW_MAX, 1).filter(k => kmw(k).oechsle <= OECHSLE_MAX)) {
      const anzeige = kmw(k).oechsle
      assert.equal(kmwZuQualitaet(oe(anzeige).kmw), kmwZuQualitaet(k), `${k} °KMW`)
      if (kmwZuQualitaet(kmwVarianteA(anzeige)) !== kmwZuQualitaet(k)) wechselA.push(k)
    }
    assert.deepEqual(wechselA, [17, 19, 21])
  })

  test('°KMW mit 2 Stellen: unter B kippen genau 16,99 und 20,99 nach oben (Rechenregel 5)', () => {
    const kippt = kmwMitOe.filter(k => kmwZuQualitaet(oe(kmw(k).oechsle).kmw) !== kmwZuQualitaet(k))
    assert.deepEqual(kippt, [16.99, 20.99])
  })

  test('ausMessung ist idempotent für jeden gespeicherten Wert', () => {
    for (const k of alleKmw) assert.deepEqual(kmw(kmw(k).kmw), kmw(k))
    for (const w of alleOe) assert.deepEqual(oe(oe(w).oechsle), oe(w))
  })

  test('runden(oechsleAusKmw()) mit Toleranz = exakte Ganzzahlrechnung für 0,00–62,00 °KMW', () => {
    for (const k of raster(0, 62, 2)) {
      const exakt = oeZehntelExakt(Math.round(k * 100)) / 10
      assert.equal(fOe(k), exakt, `${k} °KMW`)
      if (k <= KMW_MAX) assert.equal(kmw(k).oechsle, exakt, `${k} °KMW`)
    }
  })

  test('Formel: kmwAusOechsle ist die Umkehrung von oechsleAusKmw (ungerundet)', () => {
    for (const k of raster(0, KMW_MAX, 1)) assert.ok(Math.abs(kmwAusOechsle(oechsleAusKmw(k)) - k) < 1e-9, `${k}`)
    assert.ok(Math.abs(oechsleAusKmw(17) - 83.538) < 1e-12)
  })
})

// ── (4) Mittelwerte, Grenzbereich, Anzeige ──────────────────────────────────

describe('(4) mischen, imGrenzbereich, format', () => {
  test('Mischbeispiel: je 50 % 14 und 22 °KMW = 18,00 °KMW = 88,8 °Oe (°Oe-Mittel wäre 89,2)', () => {
    assert.deepEqual(mischen([{ menge: 50, kmw: 14 }, { menge: 50, kmw: 22 }]), { kmw: 18, oechsle: 88.8, einheit: 'kmw' })
    assert.equal(runden((oechsleAusKmw(14) + oechsleAusKmw(22)) / 2, 1), 89.2)
  })

  test('massegewichtet, auf 2 Stellen abgerundet', () => {
    assert.deepEqual(mischen([{ menge: 1, kmw: 17 }, { menge: 2, kmw: 17.01 }]), { kmw: 17, oechsle: 83.5, einheit: 'kmw' })
    assert.deepEqual(mischen([{ menge: 300, kmw: 18.4 }, { menge: 100, kmw: 20 }]), { kmw: 18.8, oechsle: 93.1, einheit: 'kmw' })
    assert.deepEqual(mischen([{ menge: 1234, kmw: 17.4 }]), kmw(17.4))
    assert.deepEqual(mischen([{ menge: 0.3, kmw: 17.4 }, { menge: 0.7, kmw: 17.4 }]), kmw(17.4))
  })

  test('KAN-130 (07.10.2026): Liter direkt gewichtet – gleiche Volumina ergeben das einfache Mittel', () => {
    const l = mischen([{ menge: 50, kmw: 14 }, { menge: 50, kmw: 22 }], 'l')
    assert.equal(l.kmw, 18)
    assert.equal(l.oechsle, 88.8)
    assert.equal(l.einheit, 'kmw')
  })

  test('Teile ohne Menge oder °KMW zählen nicht; nichts Zählendes → null', () => {
    assert.equal(mischen([]), null)
    assert.equal(mischen([{ menge: 100, kmw: null }, { menge: 0, kmw: 18 }]), null)
    assert.deepEqual(
      mischen([{ menge: 100, kmw: 18 }, { menge: 50, kmw: null }, { menge: 0, kmw: 25 }, { menge: -5, kmw: 25 }, { menge: NaN, kmw: 25 }]),
      kmw(18),
    )
    assert.throws(() => mischen([{ menge: 1, kmw: 18 }], 'hl'), RangeError)
  })

  // KAN-134 (Jörgen, 26.09.2026): Band ±0,5 °Oe statt ±0,2 °KMW, verglichen in °Oe –
  // °Oe des Werts (gemessen, sonst aus °KMW nach der Formel) gegen °Oe der Schwelle (17 °KMW = 83,5 °Oe)
  test('imGrenzbereich: Band ±0,5 °Oe, das alte °KMW-Band gibt es nicht mehr', () => {
    assert.equal(GRENZ_BAND_OECHSLE, 0.5)
    assert.equal('GRENZ_BAND_KMW' in mg, false)
  })

  test('imGrenzbereich (KAN-134): 83,0–84,0 °Oe gemessen um Kabinett (83,5 °Oe) → Grenzfall, einschließlich', () => {
    for (const w of [83.0, 83.1, 83.4, 83.5, 83.6, 83.9, 84.0]) assert.equal(imGrenzbereich(oe(w), SCHWELLEN), 17, `${w} °Oe`)
    assert.equal(imGrenzbereich(oe(82.9), SCHWELLEN), null)
    assert.equal(imGrenzbereich(oe(84.1), SCHWELLEN), null)
  })

  test('imGrenzbereich (KAN-134): °KMW über den umgerechneten °Oe-Wert – 16,9 ja, 16,8 und 17,2 nein', () => {
    assert.equal(kmw(16.9).oechsle, 83.0)
    assert.equal(imGrenzbereich(kmw(16.9), SCHWELLEN), 17)
    assert.equal(imGrenzbereich(16.9, SCHWELLEN), 17)                 // Zahl = °KMW
    assert.equal(kmw(16.8).oechsle, 82.5)
    assert.equal(imGrenzbereich(kmw(16.8), SCHWELLEN), null)          // bis KAN-134 ein Grenzfall
    assert.equal(imGrenzbereich(16.8, SCHWELLEN), null)
    assert.equal(kmw(17.2).oechsle, 84.6)
    assert.equal(imGrenzbereich(kmw(17.2), SCHWELLEN), null)
    // Rand: 16,89 °KMW = 83,0 °Oe (ja), 16,88 = 82,9 (nein); 17,09 = 84,0 (ja), 17,10 = 84,1 (nein)
    assert.equal(imGrenzbereich(16.89, SCHWELLEN), 17)
    assert.equal(imGrenzbereich(16.88, SCHWELLEN), null)
    assert.equal(imGrenzbereich(17.09, SCHWELLEN), 17)
    assert.equal(imGrenzbereich(17.1, SCHWELLEN), null)
    assert.equal(imGrenzbereich(16.79, SCHWELLEN), null)
    assert.equal(imGrenzbereich(18, SCHWELLEN), null)
  })

  test('imGrenzbereich: gemessener °Oe-Wert zählt, bei Messung in °KMW nur die Formel (nicht der gespeicherte °Oe)', () => {
    // Werte konstruiert, damit sich °KMW und °Oe widersprechen
    assert.equal(imGrenzbereich({ kmw: 17.2, oechsle: 84.0, einheit: 'oechsle' }, SCHWELLEN), 17)
    assert.equal(imGrenzbereich({ kmw: 16.8, oechsle: 83.0, einheit: 'kmw' }, SCHWELLEN), null)
    // ohne gültigen °Oe-Messwert: aus °KMW
    assert.equal(imGrenzbereich({ kmw: 16.9, oechsle: NaN, einheit: 'oechsle' }, SCHWELLEN), 17)
  })

  test('imGrenzbereich: jede Stufenschwelle ±0,5 °Oe einschließlich, ±0,6 °Oe nicht mehr', () => {
    for (const s of SCHWELLEN) {
      const z = mindestOechsle(s, 1)                                   // °Oe der Schwelle nach der Formel
      assert.equal(z, fOe(s), `${s} °KMW`)
      for (const d of [-0.5, -0.1, 0, 0.1, 0.5]) assert.equal(imGrenzbereich(oe(runden(z + d, 1)), SCHWELLEN), s, `${s} °KMW, ${d} °Oe`)
      for (const d of [-0.6, 0.6]) assert.equal(imGrenzbereich(oe(runden(z + d, 1)), SCHWELLEN), null, `${s} °KMW, ${d} °Oe`)
    }
    assert.equal(imGrenzbereich(14.99, SCHWELLEN), 15)                // 73,0 gegen 73,1 °Oe
    assert.equal(imGrenzbereich(oe(156.5), SCHWELLEN), 30)
    assert.equal(imGrenzbereich(oe(156.6), SCHWELLEN), null)
  })

  test('imGrenzbereich: eigenes Band in °Oe, nächste Schwelle, ungültige Werte', () => {
    assert.equal(imGrenzbereich(oe(70), [14, 15], 3), 14)             // 70,0: 2,1 von 67,9 und 3,1 von 73,1 °Oe
    assert.equal(imGrenzbereich(oe(71), [14, 15], 3), 15)             // 71,0: 3,1 bzw. 2,1 °Oe
    assert.equal(imGrenzbereich(oe(70), [14, 15]), null)
    assert.equal(imGrenzbereich(oe(83.5), SCHWELLEN, 0), 17)
    assert.equal(imGrenzbereich(oe(83.6), SCHWELLEN, 0), null)
    assert.equal(imGrenzbereich(oe(83.2), SCHWELLEN, 0.3), 17)
    assert.equal(imGrenzbereich(oe(83.1), SCHWELLEN, 0.3), null)
    assert.throws(() => imGrenzbereich(oe(83.5), SCHWELLEN, -0.1), RangeError)
    assert.equal(imGrenzbereich(null, SCHWELLEN), null)
    assert.equal(imGrenzbereich(undefined, SCHWELLEN), null)
    assert.equal(imGrenzbereich(NaN, SCHWELLEN), null)
    assert.equal(imGrenzbereich(-1, SCHWELLEN), null)
    assert.equal(imGrenzbereich(17, []), null)
  })

  test('format: bevorzugte Einheit zuerst, umgerechneter Wert mit ≈', () => {
    assert.equal(format(oe(84), 'oechsle'), '84,0 °Oe · ≈ 17,09 °KMW')
    assert.equal(format(kmw(17.4), 'kmw'), '17,4 °KMW · ≈ 85,7 °Oe')
    assert.equal(format(oe(84)), '84,0 °Oe · ≈ 17,09 °KMW')          // ohne Angabe: gemessene zuerst
    assert.equal(format(oe(84), 'kmw'), '≈ 17,09 °KMW · 84,0 °Oe')
    assert.equal(format(kmw(17.4), 'oechsle'), '≈ 85,7 °Oe · 17,4 °KMW')
    assert.equal(format(oe(84), 'oechsle', { kmwStellen: 1 }), '84,0 °Oe · ≈ 17,0 °KMW')
    assert.equal(format(null), '')
    assert.equal(format(undefined, 'kmw'), '')
  })

  test('formatKmw/formatOechsle: Dezimalkomma, °KMW 1–2 Stellen abgerundet, °Oe 1 Stelle', () => {
    assert.equal(formatKmw(17.4), '17,4')
    assert.equal(formatKmw(17), '17,0')
    assert.equal(formatKmw(17.09), '17,09')
    assert.equal(formatKmw(18.95), '18,95')
    assert.equal(formatKmw(18.99, 1), '18,9')
    assert.equal(formatOechsle(84), '84,0')
    assert.equal(formatOechsle(83.5), '83,5')
    assert.equal(formatOechsle(0), '0,0')
  })
})

// ── (5) Eingaben ────────────────────────────────────────────────────────────

describe('(5) parseEingabe und ungültige Werte', () => {
  const gut = (text, einheit, wert) => assert.deepEqual(parseEingabe(text, einheit), { ok: true, wert }, `${JSON.stringify(text)} ${einheit}`)
  const schlecht = (text, einheit, muster) => {
    const r = parseEingabe(text, einheit)
    assert.equal(r.ok, false, `${JSON.stringify(text)} ${einheit} sollte abgelehnt werden`)
    assert.match(r.fehler, muster)
  }

  test('leer = null', () => {
    gut('', 'kmw', null)
    gut('   ', 'oechsle', null)
    gut(null, 'kmw', null)
    gut(undefined, 'oechsle', null)
  })

  test('Komma oder Punkt, Stellen je Einheit, Nullen am Ende zählen nicht', () => {
    gut('17,4', 'kmw', 17.4)
    gut('17.4', 'kmw', 17.4)
    gut(' 17,45 ', 'kmw', 17.45)
    gut('17,450', 'kmw', 17.45)
    gut('17,', 'kmw', 17)
    gut(',5', 'kmw', 0.5)
    gut('017', 'kmw', 17)
    gut('0', 'kmw', 0)
    gut('60', 'kmw', 60)
    gut('60,00', 'kmw', 60)
    gut('84', 'oechsle', 84)
    gut('83,5', 'oechsle', 83.5)
    gut('83,50', 'oechsle', 83.5)
    gut('350', 'oechsle', 350)
    gut('350,0', 'oechsle', 350)
  })

  test('zu viele Stellen', () => {
    schlecht('17,456', 'kmw', /°KMW.*höchstens 2 Nachkommastellen/)
    schlecht('83,55', 'oechsle', /°Oe.*höchstens einer Nachkommastelle/)
    schlecht('84,01', 'oechsle', /°Oe/)
  })

  test('Bereich 0–60 °KMW bzw. 0–350 °Oe, nicht negativ', () => {
    schlecht('60,01', 'kmw', /zwischen 0 und 60 °KMW/)
    schlecht('61', 'kmw', /zwischen 0 und 60 °KMW/)
    schlecht('350,1', 'oechsle', /zwischen 0 und 350 °Oe/)
    schlecht('351,6', 'oechsle', /zwischen 0 und 350 °Oe/)   // = 60 °KMW, gemessen nicht mehr zulässig
    schlecht('360', 'oechsle', /zwischen 0 und 350 °Oe/)     // bis 26.09.2026 die Grenze
    schlecht('-3', 'kmw', /negativ/)
    schlecht('−3', 'oechsle', /negativ/)
    schlecht('99999999999999999999999', 'kmw', /zwischen 0 und 60 °KMW/)
  })

  test('keine Zahl', () => {
    for (const t of ['abc', '17,4,5', '1.000,5', '1e2', 'Infinity', 'NaN', '0x10', '+17', '17 4', '.', ',', '17,4 °KMW', '١٧']) {
      schlecht(t, 'kmw', /als Zahl in °KMW/)
    }
    schlecht('84 Oe', 'oechsle', /als Zahl in °Oe/)
  })

  test('unbekannte Einheit wirft', () => {
    assert.throws(() => parseEingabe('17', 'brix'), RangeError)
    assert.equal(istMostgewichtEinheit('kmw'), true)
    assert.equal(istMostgewichtEinheit('oechsle'), true)
    assert.equal(istMostgewichtEinheit('Oechsle'), false)
  })

  test('ausMessung: null → null, ungültige Werte werfen', () => {
    assert.equal(ausMessung(null, 'kmw'), null)
    assert.equal(ausMessung(undefined, 'oechsle'), null)
    assert.throws(() => ausMessung(NaN, 'kmw'), RangeError)
    assert.throws(() => ausMessung(Infinity, 'oechsle'), RangeError)
    assert.throws(() => ausMessung(-0.1, 'kmw'), RangeError)
    assert.throws(() => ausMessung(-1, 'oechsle'), RangeError)
    assert.throws(() => ausMessung(60.01, 'kmw'), RangeError)
    assert.throws(() => ausMessung(350.1, 'oechsle'), RangeError)
    assert.throws(() => ausMessung(351.6, 'oechsle'), RangeError)
    assert.throws(() => ausMessung('17', 'kmw'), RangeError)
    assert.throws(() => ausMessung(17, 'brix'), RangeError)
    assert.deepEqual(ausMessung(0, 'kmw'), { kmw: 0, oechsle: 0, einheit: 'kmw' })
    // B am Rand: f(0,01) = 0,0454 rundet auf 0,0 °Oe – größter °KMW-Wert dazu ist 0,01 (SQL ebenso)
    assert.deepEqual(ausMessung(0, 'oechsle'), { kmw: 0.01, oechsle: 0, einheit: 'oechsle' })
    assert.deepEqual(ausMessung(60, 'kmw'), { kmw: 60, oechsle: 351.6, einheit: 'kmw' })
    assert.deepEqual(ausMessung(350, 'oechsle'), { kmw: 59.78, oechsle: 350, einheit: 'oechsle' })
  })

  test('Grenzen passen zusammen (Review 26.09.2026 III): °Oe-Messung nie über 60 °KMW, °KMW-Messung nie über 351,6 °Oe', () => {
    // wie die CHECKs der Migration A: °KMW 0–60, °Oe gemessen 0–350, bei Einheit kmw gerechnet bis 351,6
    assert.equal(KMW_MAX, 60)
    assert.equal(OECHSLE_MAX, 350)
    assert.equal(oe(OECHSLE_MAX).kmw, 59.78)
    assert.equal(kmw(KMW_MAX).oechsle, 351.6)
    assert.ok(raster(0, OECHSLE_MAX, 1).every(w => oe(w).kmw <= KMW_MAX))
    assert.ok(raster(0, KMW_MAX, 2).every(k => kmw(k).oechsle <= 351.6))
    // nur 59,79–60,00 °KMW ergeben gerechnet mehr als 350 °Oe
    assert.deepEqual(raster(59, KMW_MAX, 2).filter(k => kmw(k).oechsle > OECHSLE_MAX), raster(59.79, KMW_MAX, 2))
  })

  test('mindestOechsle, runden, abrunden: ungültige Parameter werfen', () => {
    assert.throws(() => mindestOechsle(17, 2), RangeError)
    assert.throws(() => mindestOechsle(-1), RangeError)
    assert.throws(() => mindestOechsle(NaN), RangeError)
    assert.throws(() => runden(1, -1), RangeError)
    assert.throws(() => abrunden(1, 1.5), RangeError)
    assert.throws(() => formatKmw(17, 3), RangeError)
    assert.equal(mindestOechsle(16.995), 83.5)          // Schwelle zählt ab dem nächsten 0,01-Wert
  })
})

// ── (6) Gleitkomma-Fallen ───────────────────────────────────────────────────

describe('(6) JavaScript-Gleitkomma-Fallen', () => {
  test('f⁻¹(156,0) = 29,99999999999999 – die Stufe kommt trotzdem aus 30,00 (Rechenregel 5)', () => {
    assert.notEqual(kmwAusOechsle(156), 30)
    assert.ok(kmwAusOechsle(156) < 30)
    assert.equal(kmwZuQualitaet(kmwAusOechsle(156)), 'beerenauslese')        // der Fehler, den ausMessung vermeidet
    assert.equal(Math.floor(kmwAusOechsle(156) * 100) / 100, 29.99)          // ohne Toleranz
    assert.equal(kmwVarianteA(156), 30)                                      // mit Toleranz 1e-9
    assert.equal(oe(156).kmw, 30)
    assert.equal(stufe(oe(156)), 'trockenbeerenauslese')
    // alle °Oe-Werte (0,1-Raster), bei denen das Abrunden ohne Toleranz eine Stelle verliert
    const ohneToleranz = raster(0, OECHSLE_MAX, 1).filter(w => Math.floor(kmwAusOechsle(w) * 100) / 100 !== kmwVarianteA(w))
    assert.deepEqual(ohneToleranz, [47.6, 156])
    assert.deepEqual([47.6, 156].map(kmwVarianteA), [10, 30])
    assert.deepEqual([47.6, 156].map(w => oe(w).kmw), [10.01, 30])   // B: f(10,01) = 47,65 → 47,6
    // über dem Eingabebereich (bis 26.09.2026: 0–360 °Oe) ebenso 351,6 °Oe = 60 °KMW
    assert.equal(Math.floor(kmwAusOechsle(351.6) * 100) / 100, 59.99)
    assert.equal(kmwVarianteA(351.6), 60)
  })

  test('exakte Mitten (x,x5 °Oe) runden auf wie numeric in PostgreSQL: 15 → 73,1, 25 → 127,3', () => {
    const mitten = raster(0, KMW_MAX, 2).filter(k => {
      const h = Math.round(k * 100)
      return (22 * h * h + 454000 * h) % 1000000 === 500000
    })
    assert.deepEqual(mitten, [5, 15, 25, 35, 45, 55])
    for (const k of mitten) {
      const exakt = oeZehntelExakt(Math.round(k * 100)) / 10
      assert.equal(kmw(k).oechsle, exakt, `${k} °KMW`)
      assert.equal(runden(oechsleAusKmw(k), 1), exakt, `${k} °KMW (runden mit Toleranz)`)
    }
    assert.equal(kmw(15).oechsle, 73.1)
    assert.equal(kmw(25).oechsle, 127.3)
    // toFixed rundet die Binärzahl 73,04999… ab – falsch bei 15 und 35 °KMW
    assert.equal(oechsleAusKmw(15).toFixed(1), '73.0')
    assert.deepEqual(raster(0, KMW_MAX, 2).filter(k => Number(oechsleAusKmw(k).toFixed(1)) !== kmw(k).oechsle), [15, 35])
  })

  test('runden/abrunden mit Toleranz', () => {
    assert.equal(runden(1.005, 2), 1.01)
    assert.equal(runden(2.675, 2), 2.68)
    assert.equal(runden(0.1 + 0.2, 1), 0.3)
    assert.equal(runden(-2.5, 0), -3)
    assert.equal(runden(-0.04, 1), 0)
    assert.ok(Object.is(runden(-0.04, 1), 0))
    assert.equal(abrunden(17.4, 2), 17.4)                                    // 17.4 · 100 = 1739,9999999999998
    assert.equal(abrunden(0.29, 2), 0.29)
    assert.equal(abrunden(18.95, 1), 18.9)                                   // 18.95 · 10 = 189,49999999999997
    assert.equal(abrunden(18.99, 1), 18.9)
    assert.equal(abrunden(19, 1), 19)
    assert.equal(abrunden(16.999999999999996, 2), 17)
  })
})

// ── (7) Golden-Tabelle ──────────────────────────────────────────────────────

describe('(7) Golden-Tabelle (SQL, Variante B)', () => {
  const text = readFileSync(GOLDEN, 'utf8')

  test('Datei unverändert (SHA-256 der SQL-Abfrage)', () => {
    assert.equal(createHash('sha256').update(text, 'utf8').digest('hex'), GOLDEN_SHA256)
  })

  test('TypeScript = SQL für 50,0–250,0 °Oe und 10,00–40,00 °KMW', () => {
    const zeilen = text.split(/\r?\n/).filter(z => z !== '')
    assert.equal(zeilen.shift(), 'einheit;wert;kmw;oechsle')
    assert.equal(zeilen.length, 2001 + 3001)
    const gesehen = { kmw: new Set(), oechsle: new Set() }
    const abweichungen = []
    for (const z of zeilen) {
      const [einheit, wert, k, o] = z.split(';')
      gesehen[einheit].add(wert)
      const soll = { kmw: Number(k), oechsle: Number(o), einheit }
      const ist = ausMessung(Number(wert), einheit)
      if (ist.kmw !== soll.kmw || ist.oechsle !== soll.oechsle || ist.einheit !== soll.einheit) abweichungen.push(`${z} ≠ ${JSON.stringify(ist)}`)
    }
    assert.deepEqual(abweichungen.slice(0, 10), [])
    assert.equal(gesehen.oechsle.size, 2001)
    assert.equal(gesehen.kmw.size, 3001)
    assert.deepEqual([...gesehen.oechsle].map(Number), raster(50, 250, 1))
    assert.deepEqual([...gesehen.kmw].map(Number), raster(10, 40, 2))
  })

  // Gesamtbereich 0,0–350,0 °Oe und 0,00–60,00 °KMW (26.09.2026, SQL wie oben, B mit ZWEI
  // Schritten – siehe (3); mit nur einem Schritt weichen 20 Werte unter 42,1 °Oe ab):
  //   oe_b: case when round((a + 0.02) * (0.022 * (a + 0.02) + 4.54), 1) <= p then a + 0.02
  //              when round((a + 0.01) * (0.022 * (a + 0.01) + 4.54), 1) <= p then a + 0.01 else a end
  //   md5(string_agg(p::text || ';' || b::numeric(5,2)::text || E'\n', '' order by n))       – generate_series(0,3500)
  //   md5(string_agg(k::text || ';' || round(k * (0.022 * k + 4.54), 1)::numeric(5,1)::text || E'\n', '' order by n)) – generate_series(0,6000)
  // Review 26.09.2026 III: Eingabebereich 0–350 °Oe (vorher 0–360, md5 29e4a694…). Neuer md5 per SELECT
  // in Supabase und lokal mit s112_kmw_aus_oechsle() der Migration A nachgerechnet – gleich.
  test('Gesamtbereich 0–350 °Oe und 0–60 °KMW = SQL (md5)', () => {
    let oeText = ''
    for (const w of raster(0, OECHSLE_MAX, 1)) oeText += `${w.toFixed(1)};${oe(w).kmw.toFixed(2)}\n`
    let kmwText = ''
    for (const k of raster(0, KMW_MAX, 2)) kmwText += `${k.toFixed(2)};${kmw(k).oechsle.toFixed(1)}\n`
    assert.equal(createHash('md5').update(oeText, 'utf8').digest('hex'), 'c7e2de30814117fa5231bbd68d663c70')
    assert.equal(createHash('md5').update(kmwText, 'utf8').digest('hex'), '7ce2c7f20528af665c0b9d2dd929c8ad')
  })
})
