// KAN-36 (Rest): Herkunft im BKI-Datenblatt Traubenverkauf nur noch als amtliches BKI-Kürzel
//
// Aufruf:  node --experimental-strip-types --disable-warning=ExperimentalWarning --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test scripts/tests/kan36-herkunft.test.mjs
//          (Node ≥ 22.6, ohne Datenbank; läuft auch über npm run test:csv)
//
// Geprüft: herkunftBki() in lib/wein/bki_kuerzel.ts (Kürzelliste der BKI, Stand 01.10.2024,
// Abschnitt „Herkunft“) und herkunftDerLieferung() bzw. bkiZeilen() in lib/behoerden/traubenverkauf.ts.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { register } from 'node:module'

register('./ernte.aufloesung.mjs', import.meta.url)

const csv = await import('../../src/lib/csv/index.ts')
const kuerzel = await import('../../src/lib/wein/bki_kuerzel.ts')
const tv = await import('../../src/lib/behoerden/traubenverkauf.ts')
const { HERKUNFT_ORDER } = await import('../../src/lib/herkunft.ts')

describe('herkunftBki()', () => {
  test('Kürzelliste vollständig (32 Einträge), Kürzel eindeutig', () => {
    const werte = Object.values(kuerzel.HERKUNFT_BKI)
    assert.equal(werte.length, 32)
    assert.equal(new Set(werte).size, 32)
    for (const k of werte) assert.match(k, /^[A-Z]{4}$/, k)
  })

  test('amtliches Kürzel unverändert, ohne Hinweis (Groß-/Kleinschreibung und Leerzeichen egal)', () => {
    for (const k of ['WLWV', 'WLTH', 'WLNO', 'WIEN', 'OEST', 'EUXX', 'SLVL', 'BLXX']) {
      assert.deepEqual(kuerzel.herkunftBki(k), { kuerzel: k, hinweis: null }, k)
    }
    assert.deepEqual(kuerzel.herkunftBki(' wlwv '), { kuerzel: 'WLWV', hinweis: null })
  })

  test('Bezeichnung laut Kürzelliste → Kürzel', () => {
    assert.equal(kuerzel.herkunftBki('Weinviertel').kuerzel, 'WLWV')
    assert.equal(kuerzel.herkunftBki('Kamptal').kuerzel, 'WLKA')
    assert.equal(kuerzel.herkunftBki('Kremstal').kuerzel, 'WLKT')
    assert.equal(kuerzel.herkunftBki('niederösterreich').kuerzel, 'WLNO')
    assert.equal(kuerzel.herkunftBki('Vulkanland  Steiermark').kuerzel, 'SLVL')
    assert.equal(kuerzel.herkunftBki('Österreich').kuerzel, 'OEST')
    assert.equal(kuerzel.herkunftBki('Wien').kuerzel, 'WIEN')
  })

  test('interne Herkunftsstufen (Migration 132): nur mit eindeutigem Weinbaugebiet', () => {
    assert.deepEqual(kuerzel.herkunftBki('wlnoe'), { kuerzel: 'WLNO', hinweis: null })
    for (const s of ['thermenregion_gebietswein', 'thermenregion_ortswein', 'thermenregion_riedenwein']) {
      assert.deepEqual(kuerzel.herkunftBki(s), { kuerzel: 'WLTH', hinweis: null }, s)
    }
    const wein = kuerzel.herkunftBki('wein')
    assert.equal(wein.kuerzel, '')
    assert.match(wein.hinweis, /^Herkunft „Wein \/ Landwein“ ist keinem BKI-Herkunftskürzel eindeutig zuzuordnen .* – Spalte leer gelassen$/)
    assert.deepEqual(kuerzel.herkunftBki('sonstiges'), { kuerzel: '', hinweis: 'Herkunft „Sonstiges“ ist kein BKI-Herkunftskürzel – Spalte leer gelassen' })
    // jede Stufe aus lib/herkunft.ts ist entschieden: Kürzel oder bewusst leer mit Hinweis
    for (const s of [...HERKUNFT_ORDER, 'sonstiges']) {
      const r = kuerzel.herkunftBki(s)
      assert.ok(r.kuerzel ? r.hinweis === null : r.hinweis !== null, s)
    }
  })

  test('Freitext, eigene Weinbaugebiete, Altwerte → leer mit Hinweis', () => {
    for (const w of ['Kremstal DAC', 'Neckenmarkt', 'Südburgenland', 'WLNÖ', 'DAC', 'NÖ-G1', 'constructor', 'toString']) {
      assert.deepEqual(kuerzel.herkunftBki(w), { kuerzel: '', hinweis: `Herkunft „${w}“ ist kein BKI-Herkunftskürzel – Spalte leer gelassen` }, w)
    }
  })

  test('leer → leer, kein Hinweis', () => {
    for (const w of [null, undefined, '', '   ']) assert.deepEqual(kuerzel.herkunftBki(w), { kuerzel: '', hinweis: null })
  })
})

describe('herkunftDerLieferung()', () => {
  const lieferung = (x = {}) => ({ herkunft_code: null, grundstueck: null, weingarten: null, zukauf: null, ...x })

  test('Reihenfolge: Traubenverkauf → Grundstück → Ried → Grundstücke des Rieds → Zukauf', () => {
    const alle = {
      herkunft_code: 'WLWV',
      grundstueck: { trauben_herkunft_code: 'thermenregion_riedenwein' },
      weingarten: { trauben_herkunft_code: 'Kamptal', grundstuecke: [{ trauben_herkunft_code: 'Wachau' }] },
      zukauf: { herkunft: 'Wagram' },
    }
    assert.deepEqual(tv.herkunftDerLieferung(lieferung(alle)), { kuerzel: 'WLWV', hinweis: null })
    assert.equal(tv.herkunftDerLieferung(lieferung({ ...alle, herkunft_code: null })).kuerzel, 'WLTH')
    assert.equal(tv.herkunftDerLieferung(lieferung({ ...alle, herkunft_code: null, grundstueck: null })).kuerzel, 'WLKA')
    assert.equal(tv.herkunftDerLieferung(lieferung({ ...alle, herkunft_code: null, grundstueck: null, weingarten: { grundstuecke: alle.weingarten.grundstuecke } })).kuerzel, 'WLWA')
    assert.deepEqual(tv.herkunftDerLieferung(lieferung({ zukauf: { herkunft: 'Wagram' } })), { kuerzel: 'WLWG', hinweis: null })
  })

  test('Freitext-Fallback des Zukaufs wird verworfen – Spalte leer, EIN Hinweis', () => {
    const r = tv.herkunftDerLieferung(lieferung({ zukauf: { herkunft: 'Neckenmarkt' } }))
    assert.deepEqual(r, { kuerzel: null, hinweis: 'Herkunft „Neckenmarkt“ (Zukauf) ist kein BKI-Herkunftskürzel – Spalte leer gelassen.' })
  })

  test('kein gültiger Wert: Hinweis nennt den genauesten erfassten Wert', () => {
    const r = tv.herkunftDerLieferung(lieferung({
      herkunft_code: 'Kremstal DAC',
      grundstueck: { trauben_herkunft_code: 'Kremstal DAC' },
      weingarten: { trauben_herkunft_code: 'sonstiges', grundstuecke: [{ trauben_herkunft_code: 'wein' }] },
      zukauf: { herkunft: 'Neckenmarkt' },
    }))
    assert.deepEqual(r, { kuerzel: null, hinweis: 'Herkunft „Kremstal DAC“ (Traubenverkauf) ist kein BKI-Herkunftskürzel – Spalte leer gelassen.' })
  })

  test('ungültiger genauerer Wert, gültiger späterer: Spalte leer, KEIN Ersatz aus der gröberen Quelle', () => {
    const r = tv.herkunftDerLieferung(lieferung({
      grundstueck: { trauben_herkunft_code: 'Kremstal DAC' },
      weingarten: { trauben_herkunft_code: 'wlnoe', grundstuecke: [] },
    }))
    assert.deepEqual(r, { kuerzel: null, hinweis: 'Herkunft „Kremstal DAC“ (Grundstück) ist kein BKI-Herkunftskürzel – Spalte leer gelassen, nicht ersatzweise WLNO (Ried) gemeldet, bitte prüfen.' })
  })

  test('bewusst abgestufte Lieferung („wein“) wird nicht über Grundstück bzw. Ried aufgestuft', () => {
    // traubenverkauf.herkunft_code ist die Kopie zum Erfassungszeitpunkt – weicht sie ab, wurde abgestuft
    const a = tv.herkunftDerLieferung(lieferung({
      herkunft_code: 'wein',
      grundstueck: { trauben_herkunft_code: 'thermenregion_ortswein' },
      weingarten: { trauben_herkunft_code: 'wlnoe', grundstuecke: [] },
    }))
    assert.equal(a.kuerzel, null)
    assert.match(a.hinweis, /^Herkunft „Wein \/ Landwein“ \(Traubenverkauf\) ist keinem BKI-Herkunftskürzel eindeutig zuzuordnen .* – Spalte leer gelassen, nicht ersatzweise WLTH \(Grundstück\) gemeldet, bitte prüfen\.$/)
    const b = tv.herkunftDerLieferung(lieferung({ grundstueck: { trauben_herkunft_code: 'sonstiges' }, weingarten: { trauben_herkunft_code: 'wlnoe' } }))
    assert.deepEqual(b, { kuerzel: null, hinweis: 'Herkunft „Sonstiges“ (Grundstück) ist kein BKI-Herkunftskürzel – Spalte leer gelassen, nicht ersatzweise WLNO (Ried) gemeldet, bitte prüfen.' })
  })

  test('nichts erfasst: Hinweis „Keine Herkunft“', () => {
    assert.deepEqual(tv.herkunftDerLieferung(lieferung({ weingarten: { trauben_herkunft_code: '  ', grundstuecke: [{ trauben_herkunft_code: null }] } })), {
      kuerzel: null,
      hinweis: 'Keine Herkunft (weder Traubenverkauf noch Grundstück, Ried bzw. Zukauf) – Spalte leer gelassen.',
    })
  })

  test('Grundstücke des Rieds: einheitliches Kürzel zählt, unterschiedliche nicht (reihenfolgeunabhängig)', () => {
    const gst = codes => lieferung({ weingarten: { trauben_herkunft_code: null, grundstuecke: codes.map(c => ({ trauben_herkunft_code: c })) } })
    assert.deepEqual(tv.herkunftDerLieferung(gst([null, 'thermenregion_ortswein', 'Thermenregion', 'WLTH'])), { kuerzel: 'WLTH', hinweis: null })
    const a = tv.herkunftDerLieferung(gst(['wlnoe', 'thermenregion_ortswein']))
    const b = tv.herkunftDerLieferung(gst(['thermenregion_ortswein', 'wlnoe']))
    assert.deepEqual(a, b)
    assert.deepEqual(a, { kuerzel: null, hinweis: 'Die Grundstücke des Rieds haben unterschiedliche Herkunft (WLNO, WLTH) – Spalte leer gelassen.' })
    const c = tv.herkunftDerLieferung({ ...gst(['wlnoe', 'thermenregion_ortswein']), zukauf: { herkunft: 'Kamptal' } })
    assert.deepEqual(c, { kuerzel: null, hinweis: 'Die Grundstücke des Rieds haben unterschiedliche Herkunft (WLNO, WLTH) – Spalte leer gelassen, nicht ersatzweise WLKA (Zukauf) gemeldet, bitte prüfen.' })
  })

  test('Grundstücke des Rieds: nicht abbildbarer Wert neben gültigem = uneinheitlich (keine Aufstufung)', () => {
    const gst = codes => lieferung({ weingarten: { trauben_herkunft_code: null, grundstuecke: codes.map(c => ({ trauben_herkunft_code: c })) } })
    const a = tv.herkunftDerLieferung(gst(['wein', 'wlnoe']))
    assert.deepEqual(a, tv.herkunftDerLieferung(gst(['wlnoe', 'wein'])))
    assert.deepEqual(a, { kuerzel: null, hinweis: 'Die Grundstücke des Rieds haben unterschiedliche Herkunft (WLNO, „Wein / Landwein“) – Spalte leer gelassen.' })
    assert.deepEqual(tv.herkunftDerLieferung(gst(['thermenregion_ortswein', 'Kremstal DAC'])), {
      kuerzel: null, hinweis: 'Die Grundstücke des Rieds haben unterschiedliche Herkunft (WLTH, „Kremstal DAC“) – Spalte leer gelassen.',
    })
    // nur ein nicht abbildbarer Wert (auch mehrfach) → dessen Grund
    assert.deepEqual(tv.herkunftDerLieferung(gst(['sonstiges', 'sonstiges', null])), {
      kuerzel: null, hinweis: 'Herkunft „Sonstiges“ (Grundstücke des Rieds) ist kein BKI-Herkunftskürzel – Spalte leer gelassen.',
    })
    // Prototyp-Schlüssel landen nicht als Funktionstext im Hinweis
    assert.match(tv.herkunftDerLieferung(gst(['constructor', 'wlnoe'])).hinweis, /\(WLNO, „constructor“\)/)
  })
})

describe('BKI-Datenblatt: Spalte „Herkunft“ und X-Warnungen', () => {
  const basis = { datum: '2026-09-05', menge_kg: 100, qualitaetsstufe: 'qualitaetswein', grundstueck: { rebsorte: 'Zweigelt' }, weingarten: null, zukauf: null, kontakt: null, firma: { betrieb_nr: '1', name: 'Käufer' }, jahrgang: { jahrgang: 2026 } }

  test('Kürzel in der Spalte, Freitext leer; ein Hinweis je Lieferung, gleiche Hinweise zusammengefasst', () => {
    const { zeilen, warnungen } = tv.bkiZeilen([
      { ...basis, liefernummer: 'TV-1', herkunft_code: 'wlnoe' },
      { ...basis, liefernummer: 'TV-2', herkunft_code: null, zukauf: { herkunft: 'Neckenmarkt' } },
      { ...basis, liefernummer: 'TV-3', herkunft_code: null, zukauf: { herkunft: 'Neckenmarkt' } },
      { ...basis, liefernummer: 'TV-4', herkunft_code: 'Weinviertel' },
    ], { betrieb_betriebsnummer: '9' })
    assert.deepEqual(zeilen.map(z => z.herkunft), ['WLNO', null, null, 'WLWV'])
    const herkunft = warnungen.filter(w => w.includes('Herkunft'))
    assert.deepEqual(herkunft, ['Herkunft „Neckenmarkt“ (Zukauf) ist kein BKI-Herkunftskürzel – Spalte leer gelassen. (2 Lieferungen: TV-2, TV-3)'])
    const text = csv.csvText(zeilen, tv.SPALTEN_BKI_TRAUBENVERKAUF, csv.PROFIL_BKI).split('\r\n')
    const spalte = text[2].split(';').indexOf('Herkunft')
    assert.deepEqual(text.slice(3).map(z => z.split(';')[spalte]), ['WLNO', '', '', 'WLWV'])
  })
})

describe('qualitaetBki() – nur eigene Einträge', () => {
  test('Prototyp-Schlüssel („constructor“, „toString“) liefern kein Kürzel, sondern „unbekannt“', () => {
    for (const q of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
      const e = kuerzel.qualitaetBki(q)
      assert.equal(e.kuerzel, '', q)
      assert.match(e.hinweis ?? '', /ist unbekannt/, q)
    }
    assert.deepEqual(kuerzel.qualitaetBki('Spaetlese'), { kuerzel: 'SPL', hinweis: null })
  })
})
