// KAN-216 (06.10.2026) – E-Label je Füllung: Nährwertrechner, Rundung, Eingabeprüfung, Zutatenliste, Verdrahtung
//
// Aufruf:  npm run -s test:csv   (alle scripts/tests/*.test.mjs)

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const { berechneNaehrwerte, rundeNaehrwert, naehrwertFehler, geringfuegigeMengen, etikettEnergie } = await import('../../src/lib/elabel/naehrwerte.ts')
const { elabelZeile, freigabeFehler } = await import('../../src/lib/elabel/eingabe.ts')
const { zutatenGruppen, allergeneDerListe, zutatenText } = await import('../../src/lib/elabel/katalog.ts')
const quelle = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')

const U1 = '11111111-1111-4111-8111-111111111111'
const U2 = '22222222-2222-4222-8222-222222222222'
const U3 = '33333333-3333-4333-8333-333333333333'

describe('berechneNaehrwerte()', () => {
  test('trockener Weißwein 12,5 % vol, 2 g/l Zucker, 6 g/l Säure', () => {
    // Alkohol 12,5 × 0,789 = 9,8625 g; Zucker 0,2 g; Säure 0,6 g
    // kJ = 9,8625·29 + 0,2·17 + 0,6·13 = 286,0125 + 3,4 + 7,8 = 297,2 → 297
    // kcal = 9,8625·7 + 0,2·4 + 0,6·3 = 69,0375 + 0,8 + 1,8 = 71,6 → 72
    const n = berechneNaehrwerte({ alkoholVol: 12.5, restzuckerGl: 2, gesamtsaeureGl: 6 })
    assert.deepEqual(n, { energieKj: 297, energieKcal: 72, fettG: 0, fettGesaettigtG: 0, kohlenhydrateG: 0, zuckerG: 0, eiweissG: 0, salzG: 0 })
  })

  test('Süßwein: Kohlenhydrate = Zucker, ab 10 g ganzzahlig', () => {
    const n = berechneNaehrwerte({ alkoholVol: 10, restzuckerGl: 120, gesamtsaeureGl: 7 })
    assert.equal(n.kohlenhydrateG, 12)
    assert.equal(n.zuckerG, 12)
    // kcal = 7,89·7 + 12·4 + 0,7·3 = 55,23 + 48 + 2,1 = 105,33 → 105
    assert.equal(n.energieKcal, 105)
  })

  test('Glycerin wird mit 10 kJ / 2,4 kcal je g eingerechnet', () => {
    const ohne = berechneNaehrwerte({ alkoholVol: 13, restzuckerGl: 4, gesamtsaeureGl: 5 })
    const mit = berechneNaehrwerte({ alkoholVol: 13, restzuckerGl: 4, gesamtsaeureGl: 5, glycerinGl: 8 })
    assert.equal(mit.energieKj - ohne.energieKj, 8)
    assert.ok(mit.energieKcal >= ohne.energieKcal + 1 && mit.energieKcal <= ohne.energieKcal + 2)
  })

  test('fehlende Eingangswerte → null, mit Liste der Felder', () => {
    assert.equal(berechneNaehrwerte({ alkoholVol: 12, restzuckerGl: null, gesamtsaeureGl: 6 }), null)
    assert.deepEqual(naehrwertFehler({ alkoholVol: null, restzuckerGl: 1, gesamtsaeureGl: null }), ['Alkohol (% vol)', 'Gesamtsäure (g/l)'])
  })
})

describe('rundeNaehrwert() – Leitfaden der Kommission', () => {
  test('Makronährstoffe', () => {
    assert.equal(rundeNaehrwert('makro', 12.6), 13)
    assert.equal(rundeNaehrwert('makro', 4.25), 4.3)
    assert.equal(rundeNaehrwert('makro', 0.5), 0)
    assert.equal(rundeNaehrwert('makro', 0.51), 0.5)
  })
  test('gesättigte Fettsäuren und Salz', () => {
    assert.equal(rundeNaehrwert('gesaettigt', 0.1), 0)
    assert.equal(rundeNaehrwert('gesaettigt', 0.15), 0.2)
    assert.equal(rundeNaehrwert('salz', 1.26), 1.3)
    assert.equal(rundeNaehrwert('salz', 0.034), 0.03)
    assert.equal(rundeNaehrwert('salz', 0.0125), 0)
  })
  test('Energie ganzzahlig, negativ/ungültig → 0', () => {
    assert.equal(rundeNaehrwert('energie', 71.5), 72)
    assert.equal(rundeNaehrwert('energie', -3), 0)
    assert.equal(rundeNaehrwert('energie', NaN), 0)
  })
  test('geringfügige Mengen und Etikettangabe', () => {
    assert.deepEqual(geringfuegigeMengen({ fettG: 0, fettGesaettigtG: 0, eiweissG: 0.6, salzG: 0 }), ['fett', 'gesaettigt', 'salz'])
    assert.equal(etikettEnergie(72), 'E = 72 kcal')
    assert.equal(etikettEnergie(null), null)
  })
})

describe('elabelZeile() / freigabeFehler()', () => {
  const basis = { zutatenIds: [U1, U2], analyseId: null, alkoholVol: 12.5, restzuckerGl: 2, gesamtsaeureGl: 6, glycerinGl: null, manuell: false, manuellGrund: null, werte: null }

  test('berechnet die Nährwerte serverseitig', () => {
    const r = elabelZeile(basis)
    assert.ok('zeile' in r)
    assert.equal(r.zeile.energie_kcal, 72)
    assert.equal(r.zeile.manuell, false)
    assert.equal(r.zeile.manuell_grund, null)
    assert.deepEqual(freigabeFehler(r.zeile), [])
  })

  test('lehnt doppelte oder ungültige Zutaten und Werte außerhalb des Bereichs ab', () => {
    assert.match(elabelZeile({ ...basis, zutatenIds: [U1, U1] }).fehler, /doppelt/)
    assert.match(elabelZeile({ ...basis, zutatenIds: ['x'] }).fehler, /Ungültige Zutat/)
    assert.match(elabelZeile({ ...basis, alkoholVol: 30 }).fehler, /Alkohol/)
  })

  test('von Hand: Grund ≥ 10 Zeichen, Pflichtwerte, Zucker ≤ Kohlenhydrate, gerundet', () => {
    const hand = { ...basis, manuell: true, manuellGrund: 'Laborbefund 2026-10', werte: { energieKj: 301.4, energieKcal: 72.2, kohlenhydrateG: 0.64, zuckerG: 0.6 } }
    const r = elabelZeile(hand)
    assert.ok('zeile' in r)
    assert.equal(r.zeile.energie_kj, 301)
    assert.equal(r.zeile.kohlenhydrate_g, 0.6)
    assert.match(elabelZeile({ ...hand, manuellGrund: 'kurz' }).fehler, /mindestens 10 Zeichen/)
    assert.match(elabelZeile({ ...hand, werte: { energieKj: 300 } }).fehler, /Pflicht/)
    assert.match(elabelZeile({ ...hand, werte: { ...hand.werte, zuckerG: 2 } }).fehler, /Zucker/)
  })

  test('Freigabe braucht Zutaten und rechenbare Werte', () => {
    const r = elabelZeile({ ...basis, zutatenIds: [], restzuckerGl: null })
    assert.deepEqual(freigabeFehler(r.zeile), ['Zutatenliste', 'Restzucker (g/l)'])
  })
})

describe('Zutatenliste', () => {
  const katalog = [
    { id: U1, kategorie: 'zutat', name_de: 'Trauben', name_en: 'Grapes', e_nummer: null, allergen: null, sortierung: 10 },
    { id: U2, kategorie: 'konservierung', name_de: 'Sulfite', name_en: 'Sulphites', e_nummer: 'E220', allergen: 'sulfite', sortierung: 10 },
    { id: U3, kategorie: 'allergen_hilfsstoff', name_de: 'Ei (Eiklar)', name_en: 'Egg (egg white)', e_nummer: null, allergen: 'ei', sortierung: 10 },
  ]
  test('gruppiert Zusatzstoffe nach Kategorie, in der gespeicherten Reihenfolge', () => {
    assert.deepEqual(zutatenGruppen([U2, U1], katalog).map(g => g.kategorie), ['konservierung', 'zutat'])
    assert.equal(zutatenText([U1, U2], katalog, 'de'), 'Trauben; Konservierungsstoffe und Antioxidationsmittel: Sulfite')
    assert.equal(zutatenText([U1, U2], katalog, 'en'), 'Grapes; Preservatives and antioxidants: Sulphites')
  })
  test('Allergene ohne Doppelte, unbekannte IDs ignoriert', () => {
    assert.deepEqual(allergeneDerListe([U1, U2, U3, U2, 'unbekannt'], katalog), ['sulfite', 'ei'])
  })
})

describe('Verdrahtung', () => {
  test('Server Action prüft Betrieb, Abo und rechnet über elabelZeile', () => {
    const a = quelle('src/app/(dashboard)/weinhandel/fuellungen/[id]/elabel/actions.ts')
    assert.match(a, /pruefeSeitenBetrieb\(membership\.tenantId\)/)
    assert.match(a, /pruefeSchreibzugriff\(membership\)/)
    assert.match(a, /const erg = elabelZeile\(e\)/)
    assert.match(a, /freezeSperreAus\(error\)/)
  })
  test('Füllung bearbeiten verlinkt das E-Label', () => {
    assert.match(quelle('src/app/(dashboard)/weinhandel/fuellungen/[id]/edit/page.tsx'), /\/weinhandel\/fuellungen\/\$\{id\}\/elabel/)
  })
  test('Migration: freigegeben gesperrt, Kennung unveränderlich, Katalog nur Plattform-Admins', () => {
    const m = quelle('supabase/entwurf/kan216_elabel_daten.sql')
    assert.match(m, /CREATE TRIGGER a_freeze BEFORE UPDATE OR DELETE ON public\.elabels/)
    assert.match(m, /Die Kennung eines E-Labels ist unveränderlich/)
    assert.match(m, /CREATE POLICY elabel_zutaten_pa ON public\.elabel_zutaten FOR ALL TO authenticated\s+USING \(EXISTS \(SELECT 1 FROM public\.plattform_admins/)
  })
})
