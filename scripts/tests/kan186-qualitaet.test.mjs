// KAN-186 Etappe 2b/2c (02.10.2026): Reserve, Große Reserve, Erste Lage, Großes Gewächs, Sekt und Perlwein raus aus dem
// Qualitätsfeld – Zusatzbezeichnung (zusatzbezeichnung) und Erzeugnis (erzeugnis) als eigene Angaben.
//
// Aufruf:  node --experimental-strip-types --test scripts/tests/kan186-qualitaet.test.mjs
//          (läuft auch über npm run test:csv)
//
// Geprüft: Normalisierung (Altwerte tolerant), Mischung mit Zusatzbezeichnung, Aufwertungssperre (nur Stufe), Abstufungsvermerk
// samt Rücklesen (Storno), Momentaufnahmen und Storno-Rückführung (neu und Altdaten), Serverprüfung, Formulare ohne
// Altwerte und Schreibpfade, die normalisiert schreiben.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'

// @ts-expect-error TS5097 – node:test lädt die .ts-Dateien direkt (wie bmd.ts)
const r = await import('../../src/lib/wein/qualitaetsrang.ts')
// @ts-expect-error TS5097 – siehe oben
const w = await import('../../src/lib/weinqualitaet.ts')
// @ts-expect-error TS5097 – siehe oben
const q = await import('../../src/lib/wein/qualitaet.ts')
// @ts-expect-error TS5097 – siehe oben
const m = await import('../../src/lib/kellerbuch/qualitaetMomentaufnahme.ts')
// @ts-expect-error TS5097 – siehe oben
const kat = await import('../../src/lib/katalog/bki.ts')

const quelle = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const A = (stufe, zusatz = null, erzeugnis = null) => ({ stufe, zusatz, erzeugnis })
const ALTWERTE = ['reserve', 'erste_lage', 'grosses_gewachs', 'sekt', 'perlwein']

describe('Normalisierung (Altdaten tolerant)', () => {
  test('Altwerte im Qualitätsfeld → Qualitätswein + Zusatzbezeichnung bzw. Erzeugnis', () => {
    assert.deepEqual(r.normalisiereQualitaet({ qualitaetsstufe: 'reserve' }), A('qualitaetswein', 'reserve'))
    assert.deepEqual(r.normalisiereQualitaet({ qualitaetsstufe: 'erste_lage' }), A('qualitaetswein', 'erste_lage'))
    assert.deepEqual(r.normalisiereQualitaet({ qualitaetsstufe: 'grosses_gewachs' }), A('qualitaetswein', 'grosses_gewachs'))
    assert.deepEqual(r.normalisiereQualitaet({ qualitaetsstufe: 'sekt' }), A('qualitaetswein', null, 'SEKTGU'))
    assert.deepEqual(r.normalisiereQualitaet({ qualitaet: 'perlwein' }), A('qualitaetswein', null, 'PERLWEIN'))
  })
  test('neue Spalten haben Vorrang; Stufen bleiben; leer → null', () => {
    assert.deepEqual(r.normalisiereQualitaet({ qualitaetsstufe: 'qualitaetswein', zusatzbezeichnung: 'grosse_reserve' }), A('qualitaetswein', 'grosse_reserve'))
    assert.deepEqual(r.normalisiereQualitaet({ qualitaetsstufe: 'reserve', zusatzbezeichnung: 'grosse_reserve' }), A('qualitaetswein', 'grosse_reserve'))
    assert.deepEqual(r.normalisiereQualitaet({ qualitaetsstufe: 'sekt', erzeugnis: 'SEKTGU' }), A('qualitaetswein', null, 'SEKTGU'))
    assert.deepEqual(r.normalisiereQualitaet({ qualitaetsstufe: 'kabinett', zusatzbezeichnung: 'xyz' }), A('kabinett'))
    assert.deepEqual(r.normalisiereQualitaet({ qualitaetsstufe: '', erzeugnis: ' ' }), A(null))
    assert.deepEqual(r.normalisiereQualitaet(null), A(null))
    // fuellungen: Qualitätsfeld heißt qualitaet
    assert.deepEqual(r.normalisiereQualitaet({ qualitaet: 'dac' }), A('dac'))
  })
  test('Spalten zum Schreiben enthalten nie einen Altwert', () => {
    for (const alt of ALTWERTE) {
      assert.ok(!ALTWERTE.includes(r.qualitaetsSpalten(r.qualitaetsAngabe(alt)).qualitaetsstufe), alt)
      assert.ok(!ALTWERTE.includes(r.fuellungsQualitaetsSpalten(r.qualitaetsAngabe(alt)).qualitaet), alt)
    }
    assert.deepEqual(r.qualitaetsSpalten(r.qualitaetsAngabe('reserve')), { qualitaetsstufe: 'qualitaetswein', zusatzbezeichnung: 'reserve', erzeugnis: null })
  })
  test('Zusatzbezeichnungen: lib/wein/qualitaetsrang = lib/katalog/bki (inkl. Große Reserve)', () => {
    assert.deepEqual([...r.ZUSATZ_WERTE], [...kat.ZUSATZBEZEICHNUNGEN])
    assert.ok(r.ZUSATZ_WERTE.includes('grosse_reserve'))
  })
})

describe('Rangfolge, Mischung, Aufwertungssperre', () => {
  test('Mischung: Zusatzbezeichnung bleibt nur, wenn alle Teile dieselbe tragen (KAN-74)', () => {
    assert.deepEqual(r.mischeQualitaet([A('qualitaetswein', 'reserve'), A('qualitaetswein', 'reserve')]), A('qualitaetswein', 'reserve'))
    assert.deepEqual(r.mischeQualitaet([A('qualitaetswein', 'reserve'), A('qualitaetswein')]), A('qualitaetswein'))
    assert.deepEqual(r.mischeQualitaet([A('qualitaetswein', 'reserve'), A('qualitaetswein', 'grosse_reserve')]), A('qualitaetswein'))
    assert.deepEqual(r.mischeQualitaet([A('qualitaetswein', 'reserve'), A('kabinett')]), A('qualitaetswein'))
    assert.deepEqual(r.mischeQualitaet([A('qualitaetswein', 'reserve'), A('landwein')]), A('landwein'))
    // Altwert und neue Form mischen sich wie gleiche Angaben
    assert.deepEqual(r.mischeQualitaet([r.qualitaetsAngabe('reserve'), A('qualitaetswein', 'reserve')]), A('qualitaetswein', 'reserve'))
    // DAC + DAC bleibt DAC, leere Teile zählen nicht, ohne jeden Wert → null
    assert.deepEqual(r.mischeQualitaet([A('dac'), A('dac'), null, A(null)]), A('dac'))
    assert.equal(r.mischeQualitaet([null, A(null)]), null)
  })
  test('Mischung: Erzeugnis nur, wenn alle es tragen; Sekt nie unter Qualitätswein', () => {
    assert.deepEqual(r.mischeQualitaet([A('qualitaetswein', null, 'SEKTGU'), A('qualitaetswein', null, 'SEKTGU')]), A('qualitaetswein', null, 'SEKTGU'))
    assert.deepEqual(r.mischeQualitaet([A('qualitaetswein', null, 'SEKTGU'), A('qualitaetswein')]), A('qualitaetswein'))
    assert.deepEqual(r.mischeQualitaet([A('landwein', null, 'PERLWEIN'), A('qualitaetswein', null, 'PERLWEIN')]), A('landwein', null, 'PERLWEIN'))
    assert.deepEqual(r.mischeQualitaet([A('landwein', null, 'SEKTGU'), A('qualitaetswein', null, 'SEKTGU')]), A('landwein'))
  })
  test('Aufwertung: nur eine höhere Stufe – Zusatzbezeichnung setzen oder wechseln ist KEINE Aufwertung (Korrektur 02.10.2026)', () => {
    assert.ok(r.istAufwertungQualitaet(A('landwein'), A('kabinett')))
    assert.ok(r.istAufwertungQualitaet(A('qualitaetswein', 'reserve'), A('kabinett')))
    assert.ok(r.istAufwertungQualitaet(A('landwein'), A('qualitaetswein', 'reserve')), 'Landwein → Qualitätswein Reserve: höhere Stufe')
    assert.ok(!r.istAufwertungQualitaet(A('qualitaetswein'), A('qualitaetswein', 'reserve')), 'Qualitätswein → Reserve (nach dem Ausbau)')
    assert.ok(!r.istAufwertungQualitaet(A('qualitaetswein', 'reserve'), A('qualitaetswein', 'grosse_reserve')))
    assert.ok(!r.istAufwertungQualitaet(A('qualitaetswein', 'reserve'), A('qualitaetswein', 'erste_lage')))
    assert.ok(!r.istAufwertungQualitaet(A('qualitaetswein', 'reserve'), A('qualitaetswein')), 'Reserve → Qualitätswein')
    assert.ok(!r.istAufwertungQualitaet(A('qualitaetswein', 'grosse_reserve'), A('qualitaetswein', 'reserve')))
    assert.ok(!r.istAufwertungQualitaet(A('qualitaetswein'), A('qualitaetswein', null, 'SEKTGU')), 'Erzeugnis allein ist keine Aufwertung')
    assert.ok(!r.istAufwertungQualitaet(A('qualitaetswein'), A('landwein', null, 'PERLWEIN')))
    assert.ok(!r.istAufwertungQualitaet(A(null), A('qualitaetswein', 'reserve')), 'ohne bisherige Stufe nie')
    assert.ok(!r.istAufwertungQualitaet(r.qualitaetsAngabe('reserve'), A('qualitaetswein', 'reserve')))
    // Sekt-Regel wie bisher: Sekt g.U. verlangt Qualitätswein (Serverprüfung), Landwein → Sekt ist über die Stufe gesperrt
    assert.ok(r.istAufwertungQualitaet(A('landwein'), A('qualitaetswein', null, 'SEKTGU')))
  })
  test('Abstufung: niedrigere Stufe, verlorene Zusatzbezeichnung, verlorenes Sekt/Perlwein', () => {
    assert.ok(r.istAbstufungQualitaet(A('qualitaetswein', 'reserve'), A('qualitaetswein')))
    assert.ok(r.istAbstufungQualitaet(A('qualitaetswein', 'grosse_reserve'), A('qualitaetswein', 'reserve')))
    assert.ok(r.istAbstufungQualitaet(A('qualitaetswein', null, 'SEKTGU'), A('qualitaetswein')))
    assert.ok(r.istAbstufungQualitaet(A('kabinett'), A('qualitaetswein')))
    assert.ok(!r.istAbstufungQualitaet(A('qualitaetswein'), A('qualitaetswein', 'reserve')), 'Zusatz setzen ist keine Abstufung')
    assert.ok(!r.istAbstufungQualitaet(A('qualitaetswein', 'reserve'), A('qualitaetswein', 'erste_lage')), 'Wechsel ist keine Abstufung')
    assert.ok(!r.istAbstufungQualitaet(A('qualitaetswein', 'reserve'), A('qualitaetswein', 'reserve')))
    assert.deepEqual(r.hoechsteQualitaetsAngabe([A('qualitaetswein'), A('qualitaetswein', 'reserve'), A('landwein')]), A('qualitaetswein', 'reserve'))
  })
})

describe('Texte und Anzeige', () => {
  test('Kurztext für Vermerke und Rücklesen beim Storno', () => {
    assert.equal(w.qualitaetText(A('qualitaetswein', 'reserve')), 'Qualitätswein Reserve')
    assert.equal(w.qualitaetText(A('qualitaetswein', 'grosse_reserve')), 'Qualitätswein Große Reserve')
    assert.equal(w.qualitaetText(A('qualitaetswein', null, 'SEKTGU')), 'Sekt g.U. (Qualitätswein)')
    assert.equal(w.qualitaetText({ qualitaetsstufe: 'perlwein' }), 'Perlwein (Qualitätswein)')
    assert.equal(w.qualitaetText('kabinett'), 'Kabinett')
    assert.equal(w.qualitaetText(null), '–')
    const faelle = [A('qualitaetswein', 'reserve'), A('qualitaetswein', 'grosse_reserve'), A('qualitaetswein', 'erste_lage'),
      A('qualitaetswein', 'grosses_gewachs'), A('qualitaetswein', null, 'SEKTGU'), A('landwein', null, 'PERLWEIN'), A('dac'), A('wein')]
    for (const a of faelle) assert.deepEqual(w.qualitaetAusText(w.qualitaetText(a)), a, w.qualitaetText(a))
    // ältere Vermerke (Bezeichnungen vor KAN-186) und Codes
    assert.deepEqual(w.qualitaetAusText('Reserve'), A('qualitaetswein', 'reserve'))
    assert.deepEqual(w.qualitaetAusText('Großes Gewächs'), A('qualitaetswein', 'grosses_gewachs'))
    assert.deepEqual(w.qualitaetAusText('Sekt'), A('qualitaetswein', null, 'SEKTGU'))
    assert.deepEqual(w.qualitaetAusText('qualitaetswein'), A('qualitaetswein'))
    assert.equal(w.qualitaetAusText('Unbekannt'), null)
  })
  test('Anzeige (Listen, Berichte): Stufe + Zusatz (+ Erzeugnis), Altwerte normalisiert', () => {
    assert.equal(q.qualitaetAnzeige({ qualitaetsstufe: 'qualitaetswein', zusatzbezeichnung: 'erste_lage' }), 'Qualitätswein Erste Lage (ÖTW)')
    assert.equal(q.qualitaetAnzeige({ qualitaetsstufe: 'sekt' }), 'Sekt g.U. (Qualitätswein)')
    assert.equal(q.qualitaetAnzeige({ qualitaet: 'landwein', erzeugnis: 'PERLWEIN' }), 'Perlwein (Landwein)')
    assert.equal(q.qualitaetAnzeige({ qualitaetsstufe: 'wein' }), 'Wein (ohne Herkunft)')
    assert.equal(q.qualitaetLabel('reserve'), 'Qualitätswein Reserve')
    assert.equal(q.qualitaetAnzeigeOderNull({ qualitaetsstufe: null }), null)
  })
})

describe('Auswahllisten und Serverprüfung', () => {
  test('Qualitätsauswahl ohne die fünf Altwerte; Zusatz- und Erzeugnis-Auswahl', () => {
    const werte = q.QUALITAET_OPTS.map(o => o.value)
    for (const alt of ALTWERTE) assert.ok(!werte.includes(alt), alt)
    assert.ok(werte.includes('dac') && werte.includes('sonstiges'))
    assert.deepEqual(q.ZUSATZ_OPTS.map(o => o.value), ['reserve', 'grosse_reserve', 'erste_lage', 'grosses_gewachs'])
    assert.deepEqual(q.ZUSATZ_OPTS.map(o => o.label), ['Reserve', 'Große Reserve', 'Erste Lage (ÖTW)', 'Großes Gewächs'])
    assert.deepEqual(q.ERZEUGNIS_OPTS.slice(0, 2).map(o => o.value), ['SEKTGU', 'PERLWEIN'])
    const codes = new Set(kat.KAT_ERZEUGNIS.map(e => e.code))
    for (const o of q.ERZEUGNIS_OPTS) {
      assert.ok(codes.has(o.value), o.value)
      assert.ok(kat.KAT_ERZEUGNIS.find(e => e.code === o.value).bsmRelevant, o.value)
    }
    assert.ok(!q.ERZEUGNIS_OPTS.some(o => o.value === 'TRAUBSFT'))
    for (const alt of ALTWERTE) assert.ok(!(alt in w.QUALITAET_LABEL), alt)
  })
  test('qualitaetsAngabeFehler: Zusatz nur auf Qualitätswein und nur bei Stillwein, Sekt ab Qualitätswein', () => {
    assert.equal(q.qualitaetsAngabeFehler(A('qualitaetswein', 'grosse_reserve')), null)
    assert.equal(q.qualitaetsAngabeFehler(A('qualitaetswein', null, 'SEKTGU')), null)
    assert.equal(q.qualitaetsAngabeFehler(A('landwein', null, 'PERLWEIN')), null)
    assert.match(q.qualitaetsAngabeFehler(A('dac', 'reserve')), /setzt die Qualitätsstufe „Qualitätswein“ voraus \(auch bei DAC-Herkunft\)/)
    assert.match(q.qualitaetsAngabeFehler(A('kabinett', 'reserve')), /„Qualitätswein“/)
    assert.match(q.qualitaetsAngabeFehler(A('qualitaetswein', 'reserve', 'SEKTGU')), /nur bei Stillwein – nicht bei Sekt g\.U\./)
    assert.match(q.qualitaetsAngabeFehler(A('landwein', null, 'SEKTGU')), /Sekt g\.U\. setzt mindestens/)
    assert.match(q.qualitaetsAngabeFehler(A('qualitaetswein', null, 'XYZ')), /„XYZ“ ist unbekannt/)
    assert.match(q.qualitaetsAngabeFehler(A('qualitaetswein', 'premium')), /„premium“ ist unbekannt/)
  })
  test('qualitaetsAngabeAusFormular: Altwert normalisiert, unbekannte Zusatzbezeichnung bleibt für die Meldung', () => {
    const fd = (o) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, v); return f }
    assert.deepEqual(q.qualitaetsAngabeAusFormular(fd({ qualitaetsstufe: 'sekt', zusatzbezeichnung: '', erzeugnis: '' })), A('qualitaetswein', null, 'SEKTGU'))
    assert.deepEqual(q.qualitaetsAngabeAusFormular(fd({ qualitaet: 'qualitaetswein', zusatzbezeichnung: 'reserve' }), 'qualitaet'), A('qualitaetswein', 'reserve'))
    assert.deepEqual(q.qualitaetsAngabeAusFormular(fd({ qualitaetsstufe: 'kabinett' })), A('kabinett'))
    assert.equal(q.qualitaetsAngabeAusFormular(fd({ qualitaetsstufe: 'qualitaetswein', zusatzbezeichnung: 'premium' })).zusatz, 'premium')
    // Ein Altwert direkt (ohne Normalisierung) ist keine Stufe der Charge mehr
    assert.match(q.qualitaetFehler('charge', 'reserve'), /unbekannt|nicht zulässig/)
  })
})

describe('Momentaufnahmen und Storno-Rückführung', () => {
  test('Umzug: Spalten der Momentaufnahme, Rückführung nur bei Charge auf „nachher“', () => {
    const vorher = A('qualitaetswein', 'reserve'), nachher = A('qualitaetswein')
    const z = m.umzugQualitaetsSpalten(vorher, nachher)
    assert.deepEqual(z, { qualitaet_vorher: 'qualitaetswein', qualitaet_nachher: 'qualitaetswein', zusatz_vorher: 'reserve', zusatz_nachher: null, erzeugnis_vorher: null, erzeugnis_nachher: null })
    assert.deepEqual(m.umzugQualitaetZurueck(z, { qualitaetsstufe: 'qualitaetswein' }), { qualitaetsstufe: 'qualitaetswein', zusatzbezeichnung: 'reserve', erzeugnis: null })
    assert.equal(m.umzugQualitaetZurueck(z, { qualitaetsstufe: 'landwein' }), null)
    assert.equal(m.umzugQualitaetZurueck(m.umzugQualitaetsSpalten(nachher, nachher), { qualitaetsstufe: 'qualitaetswein' }), null)
  })
  test('Umzug Altdaten: Altwert im Snapshot bzw. alter Vermerk', () => {
    assert.deepEqual(m.umzugQualitaetZurueck({ qualitaet_vorher: 'sekt', qualitaet_nachher: 'qualitaetswein' }, { qualitaetsstufe: 'qualitaetswein' }),
      { qualitaetsstufe: 'qualitaetswein', zusatzbezeichnung: null, erzeugnis: 'SEKTGU' })
    const charge = { qualitaetsstufe: 'landwein', notizen: 'x\nAbstufung von Erste Lage auf Landwein (Zusammenführung per Umziehen)' }
    assert.deepEqual(m.umzugQualitaetZurueck({ notizen: 'Abstufung von Erste Lage auf Landwein' }, charge),
      { qualitaetsstufe: 'qualitaetswein', zusatzbezeichnung: 'erste_lage', erzeugnis: null })
    assert.equal(m.umzugQualitaetZurueck({ notizen: 'Abstufung von Erste Lage auf Landwein' }, { ...charge, notizen: '' }), null)
  })
  test('Verschnitt: Snapshot samt Zusatz/Erzeugnis, Altwert normalisiert, ohne Stufe unverändert', () => {
    assert.deepEqual(m.verschnittQualitaetsSpalten(A('qualitaetswein', 'grosse_reserve')), { ziel_qualitaet_vorher: 'qualitaetswein', ziel_zusatz_vorher: 'grosse_reserve', ziel_erzeugnis_vorher: null })
    assert.deepEqual(m.verschnittQualitaetZurueck({ ziel_qualitaet_vorher: 'reserve' }), { qualitaetsstufe: 'qualitaetswein', zusatzbezeichnung: 'reserve', erzeugnis: null })
    assert.deepEqual(m.verschnittQualitaetZurueck({ ziel_qualitaet_vorher: 'kabinett', ziel_zusatz_vorher: null, ziel_erzeugnis_vorher: null }), { qualitaetsstufe: 'kabinett', zusatzbezeichnung: null, erzeugnis: null })
    assert.equal(m.verschnittQualitaetZurueck({ ziel_qualitaet_vorher: null }), null)
  })
})

describe('Schreibpfade (Quelltext)', () => {
  const PFADE = {
    'src/app/(dashboard)/kellerbuch/actions.ts': [/\.\.\.qualitaetsSpalten\(chargenQualitaetAusFormular\(formData\)\)/, /\.\.\.qualitaetsSpalten\(neueQualitaet\)/, /\.\.\.verschnittQualitaetsSpalten\(zielQualitaetVorher\)/, /mischeQualitaet\(alleQualitaeten\)/],
    'src/app/(dashboard)/kellerbuch/umziehen/actions.ts': [/\.\.\.umzugQualitaetsSpalten\(vonQual, minQual\)/, /\.\.\.umzugQualitaetsSpalten\(zielVorher, zielNachher\)/, /\.\.\.qualitaetsSpalten\(minQual\)/],
    'src/app/(dashboard)/kellerbuch/gebinde-actions.ts': [/\.\.\.qualitaetsSpalten\(angabe\)/, /\.\.\.qualitaetsSpalten\(normalisiereQualitaet\(hauptQuelle\)\)/],
    'src/app/(dashboard)/weinhandel/actions.ts': [/\.\.\.fuellungsQualitaetsSpalten\(qualitaetInput\)/],
    'src/app/(dashboard)/weinhandel/zukauf/actions.ts': [/\.\.\.qualitaetsSpalten\(qualitaet\)/, /\.\.\.zukaufQualitaetsSpalten\(f\)/, /\.\.\.qualitaetsSpalten\(f\.qualitaet\)/],
  }
  test('jeder Schreibpfad schreibt die normalisierte Angabe (keine Rohwerte aus dem Formular)', () => {
    for (const [datei, muster] of Object.entries(PFADE)) {
      const text = quelle(datei)
      for (const re of muster) assert.match(text, re, `${datei}: ${re}`)
      // kein Qualitätsfeld mehr direkt aus FormData bzw. aus einer ungeprüften Zeile
      assert.doesNotMatch(text, /qualitaet(?:sstufe)?:\s+(?:qualitaetsstufe|qualitaetInput|hauptQuelle\?\.qualitaetsstufe|minQualStufe|neueQualitaet),|qualitaetsstufe:\s{2,}f\.qualitaetsstufe,/, datei)
    }
  })
  test('Verschnitt-Ergebnis und Storno lesen die Zusatz-/Erzeugnis-Spalten', () => {
    const s = quelle('src/lib/kellerbuch/storno.ts')
    assert.match(s, /zusatz_vorher, zusatz_nachher, erzeugnis_vorher, erzeugnis_nachher/)
    assert.match(s, /ziel_qualitaet_vorher, ziel_zusatz_vorher, ziel_erzeugnis_vorher/)
    const schema = JSON.parse(readFileSync(new URL('../../scripts/schema.json', import.meta.url), 'utf8'))
    for (const sp of ['zusatz_vorher', 'zusatz_nachher', 'erzeugnis_vorher', 'erzeugnis_nachher']) assert.ok(schema.keller_umzuege.includes(sp), sp)
    for (const sp of ['ziel_zusatz_vorher', 'ziel_erzeugnis_vorher']) assert.ok(schema.verschneidungen.includes(sp), sp)
  })
  test('Formulare: Zusatzbezeichnung und Erzeugnis bei Charge, Füllung, Zukauf, Eröffnungsbestand und Import; Land beim Zukauf', () => {
    for (const datei of [
      'src/components/kellerbuch/WeinausbauForm.tsx',
      'src/app/(dashboard)/weinhandel/fuellungen/neu/FuellungFormClient.tsx',
      'src/app/(dashboard)/weinhandel/fuellungen/[id]/edit/page.tsx',
      'src/app/(dashboard)/weinhandel/zukauf/neu/page.tsx',
      'src/app/(dashboard)/weinhandel/zukauf/[id]/edit/ZukaufEditForm.tsx',
      'src/app/(dashboard)/kellerbuch/eroeffnungsbestand/[id]/edit/page.tsx',
      'src/app/(dashboard)/kellerbuch/gebinde/page.tsx',
      'src/app/(dashboard)/admin/import/ImportClient.tsx',
    ]) assert.match(quelle(datei), /<ZusatzErzeugnisFelder\b/, datei)
    for (const datei of ['src/app/(dashboard)/weinhandel/zukauf/neu/page.tsx', 'src/app/(dashboard)/weinhandel/zukauf/[id]/edit/ZukaufEditForm.tsx']) {
      assert.match(quelle(datei), /<LandSelect\b/, datei)
      assert.match(quelle(datei), /fd\.set\('land_iso',/, datei)
    }
    const felder = quelle('src/components/wein/ZusatzErzeugnisFelder.tsx')
    assert.match(felder, /name="zusatzbezeichnung"/)
    assert.match(felder, /name="erzeugnis"/)
  })
  // kan186c kommt erst nach dem Deploy (Code läuft vorher und nachher) – bis die Datei da ist, wird übersprungen
  const dir = new URL('../../supabase/migrations/', import.meta.url)
  const dateien = readdirSync(dir).filter(f => /^\d{14}_.*\.sql$/.test(f)).sort()
  const kan186c = dateien.some(f => /_kan186c_qualitaet_umstellen\.sql$/.test(f))
  test('Migration: Zusatzbezeichnungs-CHECKs kennen grosse_reserve (letzte Definition)', { skip: kan186c ? false : 'Migration kan186c_qualitaet_umstellen noch nicht in supabase/migrations' }, () => {
    for (const name of ['weinausbau_zusatzbezeichnung_check', 'fuellungen_zusatzbezeichnung_check', 'zukauf_posten_zusatzbezeichnung_check']) {
      let letzte = null
      for (const d of dateien) {
        const sql = readFileSync(new URL(d, dir), 'utf8')
        for (const t of sql.matchAll(new RegExp(`CONSTRAINT ${name}\\s+CHECK \\(([^;]*?)\\)\\s*[;,)]`, 'g'))) letzte = t[1]
      }
      assert.ok(letzte, `${name} fehlt`)
      assert.match(letzte, /'grosse_reserve'/, name)
    }
  })
})
