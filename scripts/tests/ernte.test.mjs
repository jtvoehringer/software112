// Tests der Meldungsgruppe „Ernte & Lese“ (Behördenmeldungen als CSV, 24.09.2026)
//
// Aufruf:  node --experimental-strip-types --disable-warning=ExperimentalWarning --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test scripts/tests/ernte.test.mjs
//          (Node ≥ 22.6, keine zusätzliche Abhängigkeit; ohne Datenbank)
//
// Geprüft werden die echten Module unter src/lib/behoerden (Ladefunktionen mit einem
// Supabase-Doppel, Spalten, Register-Parameter) und der KAN-36-Fix in lib/wein/bki_kuerzel.ts.
// Die Auflösung von '@/…' und endungslosen Importen übernimmt scripts/tests/ernte.aufloesung.mjs.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { register } from 'node:module'

register('./ernte.aufloesung.mjs', import.meta.url)

const csv = await import('../../src/lib/csv/index.ts')
const kuerzel = await import('../../src/lib/wein/bki_kuerzel.ts')
const ernte = await import('../../src/lib/behoerden/erntemeldung.ts')
const bestand = await import('../../src/lib/behoerden/bestandsmeldung.ts')
const tv = await import('../../src/lib/behoerden/traubenverkauf.ts')
const { KATALOG_ERNTE } = await import('../../src/lib/behoerden/katalog/ernte.ts')
const { MELDUNGEN_ERNTE } = await import('../../src/lib/behoerden/register/ernte.ts')
const { istParameterFehler, MeldungsFehler } = await import('../../src/lib/behoerden/typen.ts')

const BOM = String.fromCharCode(0xfeff)
const T = 'tenant-1'
const FREMD = 'tenant-2'

// ── Supabase-Doppel: from(tabelle).select().eq()… mit Filterprotokoll ─────────

const GESCHUETZT = new Set(['weinjahrgaenge', 'ama_erntemeldungen', 'grundstuecke', 'traubenverkauf', 'fuellungen', 'weinausbau', 'tenant_einstellungen'])

function supabaseDoppel(tabellen, rpc = {}) {
  const abfragen = []
  class Abfrage {
    constructor(tabelle) {
      if (typeof tabelle !== 'string') throw new Error('Kopie nicht unterstützt – alle() fällt auf .range() zurück')
      this.tabelle = tabelle
      this.filter = []
      this.einzeln = false
      this.bereich = null
      abfragen.push(this)
    }
    select() { return this }
    order() { return this }
    limit() { return this }
    eq(f, w) { this.filter.push(r => r[f] === w); this.filter[`eq:${f}`] = w; return this }
    neq(f, w) { this.filter.push(r => r[f] !== null && r[f] !== undefined && r[f] !== w); return this }
    gt(f, w) { this.filter.push(r => r[f] !== null && r[f] !== undefined && Number(r[f]) > w); return this }
    is(f, w) { this.filter.push(r => (r[f] ?? null) === w); return this }   // KAN-148: .is('storniert_am', null)
    range(a, b) { this.bereich = [a, b]; return this }
    maybeSingle() { this.einzeln = true; return this }
    then(ok, fehler) { return Promise.resolve(this.ausfuehren()).then(ok, fehler) }
    ausfuehren() {
      let rows = (tabellen[this.tabelle] ?? []).filter(r => this.filter.every(f => f(r)))
      if (this.bereich) rows = rows.slice(this.bereich[0], this.bereich[1] + 1)
      if (this.einzeln) return rows.length > 1 ? { data: null, error: { message: 'mehrere Zeilen' } } : { data: rows[0] ?? null, error: null }
      return { data: rows, error: null }
    }
  }
  return {
    from: t => new Abfrage(t),
    rpc: async (name, args) => ({ data: rpc[name] ? rpc[name](args) : [], error: null }),
    abfragen,
  }
}

function mandantengefiltert(db) {
  for (const a of db.abfragen) {
    if (GESCHUETZT.has(a.tabelle)) assert.equal(a.filter[`eq:tenant_id`], T, `Abfrage auf ${a.tabelle} ohne .eq('tenant_id')`)
  }
}

// ── Testdaten ───────────────────────────────────────────────────────────────

const WG = {
  w1: { name: 'Ried Kaiserberg', rebsorte: 'Grüner Veltliner', flaeche_ha: 2.5 },
  w2: { name: 'Ried Hochstraß', rebsorte: 'Zweigelt', flaeche_ha: 0.8 },
  w3: { name: 'Ried Satz', rebsorte: null, flaeche_ha: 0.6 },
}
const GST = {
  g1: { gst_nr: '1234/5', katastralgemeinde: '04023', rebsorte: 'Grüner Veltliner', flaeche_ha: 1 },
  g3: { gst_nr: '88', katastralgemeinde: '12003', rebsorte: 'Gemischer Satz', flaeche_ha: 0.25 },
}

const TABELLEN_ERNTE = {
  weinjahrgaenge: [
    { id: 'jg26', tenant_id: T, jahrgang: 2026 },
    { id: 'jg25', tenant_id: T, jahrgang: 2025 },
    { id: 'jgX', tenant_id: FREMD, jahrgang: 2026 },
  ],
  ernte_parzellen: [
    { id: 'p1', jahrgang_id: 'jg26', weingarten_id: 'w1', grundstueck_id: 'g1', ernte_datum: '2026-09-10', menge_kg: 9000, menge_hl: null, oechsle: null, klosterneuburger: 17.4, qualitaetsstufe: 'qualitaetswein', lesemethode: 'handlese', notizen: null, weingarten: WG.w1, grundstueck: GST.g1 },
    { id: 'p2', jahrgang_id: 'jg26', weingarten_id: 'w1', grundstueck_id: 'g1', ernte_datum: '2026-09-24', menge_kg: 2500, menge_hl: null, oechsle: null, klosterneuburger: 19.25, qualitaetsstufe: 'qualitaetswein', lesemethode: 'selektionslese', notizen: '=Achtung', weingarten: WG.w1, grundstueck: GST.g1 },
    { id: 'p3', jahrgang_id: 'jg26', weingarten_id: 'w2', grundstueck_id: null, ernte_datum: '2026-10-02', menge_kg: 6000, menge_hl: null, oechsle: null, klosterneuburger: 19, qualitaetsstufe: 'kabinett', lesemethode: 'maschinenlese', notizen: null, weingarten: WG.w2, grundstueck: null },
    { id: 'p4', jahrgang_id: 'jg26', weingarten_id: 'w3', grundstueck_id: 'g3', ernte_datum: '2026-09-15', menge_kg: 1000, menge_hl: null, oechsle: null, klosterneuburger: null, qualitaetsstufe: 'qualitaetswein', lesemethode: null, notizen: null, weingarten: WG.w3, grundstueck: GST.g3 },
    { id: 'p9', jahrgang_id: 'jg25', weingarten_id: 'w1', grundstueck_id: 'g1', ernte_datum: '2025-09-12', menge_kg: 7777, qualitaetsstufe: 'qualitaetswein', weingarten: WG.w1, grundstueck: GST.g1 },
  ],
  grundstuecke: [
    { id: 'g1', tenant_id: T, nutzart: 'WI', flaeche_ha: 1 },
    { id: 'g3', tenant_id: T, nutzart: 'WI', flaeche_ha: 0.25 },
    { id: 'g4', tenant_id: T, nutzart: 'WI', flaeche_ha: 2 },
    { id: 'g5', tenant_id: T, nutzart: 'AC', flaeche_ha: 9 },
    { id: 'g9', tenant_id: FREMD, nutzart: 'WI', flaeche_ha: 5 },
  ],
  traubenverkauf: [
    { id: 't1', tenant_id: T, jahrgang_id: 'jg26', weingarten_id: 'w1', menge_kg: 800, weingarten: { rebsorte: 'Grüner Veltliner' }, grundstueck: { rebsorte: 'Grüner Veltliner' } },
    { id: 't2', tenant_id: T, jahrgang_id: 'jg26', weingarten_id: null, menge_kg: 300, weingarten: null, grundstueck: null },
    { id: 't9', tenant_id: FREMD, jahrgang_id: 'jgX', weingarten_id: 'w1', menge_kg: 999, weingarten: { rebsorte: 'Zweigelt' } },
  ],
  ama_erntemeldungen: [],
  ama_meldepositionen: [],
}

// ── KAN-36: amtliche Kürzel ─────────────────────────────────────────────────

describe('KAN-36 – BKI-Kürzel (lib/wein/bki_kuerzel.ts)', () => {
  test('Qualitätsstufen auf die amtlichen Kürzel', () => {
    const soll = { wein: 'WEI', landwein: 'LDW', qualitaetswein: 'QUW', dac: 'DAC', kabinett: 'KAB', spaetlese: 'SPL', auslese: 'ALW', beerenauslese: 'BAL', trockenbeerenauslese: 'TBA', tba: 'TBA', eiswein: 'EIW', strohwein: 'STW' }
    for (const [q, k] of Object.entries(soll)) {
      assert.deepEqual(kuerzel.qualitaetBki(q), { kuerzel: k, hinweis: null }, q)
      assert.equal(kuerzel.getQualitaetBki(q), k)
    }
  })

  test('kein Ersatzkürzel mehr: Sekt, Unbekanntes leer mit Hinweis; Ausbruch vorläufig AUB; Reserve & Co. als QUW', () => {
    // Ausbruch fehlt in der Liste – AUB als Vorschlag (KAN-36, 25.09.2026), immer mit Hinweis
    for (const q of ['ausbruch', ' Ausbruch ']) {
      const ausbruch = kuerzel.qualitaetBki(q)
      assert.equal(ausbruch.kuerzel, 'AUB', q)
      assert.match(ausbruch.hinweis, /„Ausbruch“ steht nicht in der BKI-Kürzelliste – vorläufig als AUB gemeldet \(Vorschlag/)
    }
    for (const q of ['sekt', 'perlwein', 'sonstiges']) {
      const r = kuerzel.qualitaetBki(q)
      assert.equal(r.kuerzel, '', q)
      assert.match(r.hinweis, /steht nicht in der BKI-Kürzelliste – Qualitätsstufe leer gelassen/, q)
    }
    // KAN-73: der alte Lese-Wert „tafelwein“ ist abgeschafft (einheitlich 'wein' → WEI) und
    // gilt jetzt wie jeder Fantasiewert als unbekannt – leer mit Hinweis, kein Ersatzkürzel
    for (const q of ['tafelwein', 'Phantasie']) {
      const r = kuerzel.qualitaetBki(q)
      assert.equal(r.kuerzel, '', q)
      assert.match(r.hinweis, /ist unbekannt – Qualitätsstufe leer gelassen/, q)
    }
    assert.deepEqual(kuerzel.qualitaetBki('wein'), { kuerzel: 'WEI', hinweis: null })
    for (const q of ['reserve', 'erste_lage', 'grosses_gewachs']) {
      const r = kuerzel.qualitaetBki(q)
      assert.equal(r.kuerzel, 'QUW', q)
      assert.match(r.hinweis, /als Qualitätswein \(QUW\)/)
    }
    assert.deepEqual(kuerzel.qualitaetBki(null), { kuerzel: '', hinweis: null })
    assert.equal(kuerzel.getQualitaetBki('trockenbeerenauslese'), 'TBA')   // früher „TROC“
    assert.equal(kuerzel.getQualitaetBki('ausbruch'), 'AUB')               // früher „AUSB“, dann leer
  })

  test('Rebsorten streng (Behörde) vs. Anzeige (Oberfläche)', () => {
    assert.equal(kuerzel.bkiRebsorteKuerzel('Grüner Veltliner'), 'GV')
    assert.equal(kuerzel.bkiRebsorteKuerzel('  grüner   veltliner '), 'GV')
    assert.equal(kuerzel.bkiRebsorteKuerzel('Gru\u0308ner Veltliner'), 'GV')     // NFD aus macOS/iOS
    assert.equal(kuerzel.bkiRebsorteKuerzel('Souvignier Gris'), 'SG')
    assert.equal(kuerzel.bkiRebsorteKuerzel('Gemischer Satz'), null)
    assert.equal(kuerzel.bkiRebsorteKuerzel(''), null)
    assert.equal(kuerzel.getRebsorteKuerzel('Gemischer Satz'), 'GEMI')        // Anzeige behält den Notbehelf
    assert.equal(kuerzel.getRebsorteKuerzel('St. Laurent'), 'SL')
  })

  test('formatRebsorteMitKuerzel nur mit amtlichem Kürzel (TB, PNA, Weinbuch)', () => {
    assert.equal(kuerzel.formatRebsorteMitKuerzel('Zweigelt'), 'Zweigelt (ZW)')
    assert.equal(kuerzel.formatRebsorteMitKuerzel('grüner veltliner'), 'grüner veltliner (GV)')
    assert.equal(kuerzel.formatRebsorteMitKuerzel('Uhudler'), 'Uhudler')          // früher „Uhudler (UHUD)“
    assert.equal(kuerzel.formatRebsorteMitKuerzel('Rösler'), 'Rösler')            // Liste führt „Roesler“
    assert.equal(kuerzel.formatRebsorteMitKuerzel(null), '–')
  })

  test('fehlendeKuerzelHinweise: je Sorte ohne amtliches Kürzel, Schreibweisen tolerant', () => {
    const w = kuerzel.fehlendeKuerzelHinweise(['Uhudler', 'grüner veltliner', 'Uhudler', null, '', 'Rösler'], { einheit: ['Charge', 'Chargen'], stammdaten: 'Charge' })
    assert.equal(w.length, 2)
    assert.match(w[0], /^Rebsorte „Rösler“ steht nicht in der BKI-Kürzelliste – Spalte „BKI-Kürzel“ leer gelassen \(1 Charge\)\. Schreibweise in den Stammdaten \(Charge\) prüfen\.$/)
    assert.match(w[1], /„Uhudler“ .* \(2 Chargen\)/)
  })

  test('Farbe aus dem Kürzel (Weiss/Rot im Datenblatt)', () => {
    assert.equal(kuerzel.bkiFarbe('Grüner Veltliner'), 'weiss')
    assert.equal(kuerzel.bkiFarbe('Roter Veltliner'), 'weiss')
    assert.equal(kuerzel.bkiFarbe('Blauer Zweigelt'), 'rot')
    assert.equal(kuerzel.bkiFarbe('Cabernet Franc'), 'rot')
    assert.equal(kuerzel.bkiFarbe('Rathay'), 'rot')
    assert.equal(kuerzel.bkiFarbe('Direktträger'), null)
    assert.equal(kuerzel.bkiFarbe('Uhudler'), null)
    assert.equal(kuerzel.isRotwein('Cabernet Franc'), true)                   // früher false
    assert.equal(kuerzel.isRotwein('Zweigelt'), true)
    assert.equal(kuerzel.isRotwein('Welschriesling'), false)
  })
})

// ── Lesedaten ───────────────────────────────────────────────────────────────

describe('lesedaten', () => {
  test('Ladefunktion + Spalten: chronologisch, Codes unverändert, KMW 2 Stellen (verlustfrei), °Oe, gemessene Einheit, Formelschutz', async () => {
    const db = supabaseDoppel(TABELLEN_ERNTE)
    const jg = await ernte.jahrgangPflicht(db, T, 2026)
    const { zeilen, warnungen } = await ernte.ladeLesedaten(db, jg.id)
    mandantengefiltert(db)
    assert.deepEqual(zeilen.map(z => z.id), ['p1', 'p4', 'p2', 'p3'])
    const text = csv.csvText(zeilen, ernte.SPALTEN_LESEDATEN)
    // KAN-128: Zeilen vor Migration A (ohne Einheit, ohne °Oe) – °Oe aus dem °KMW, gemessen in °KMW
    assert.equal(text, BOM + [
      'Lesedatum;Ried;KG-Nr.;GST-Nr.;Rebsorte;BKI-Kürzel;Menge (kg);Mostgewicht (°KMW);Mostgewicht (°Oe);Mostgewicht gemessen in;Qualitätsstufe;Lesemethode;Notizen;Lese;Storniert am;Storno-Grund',
      '10.09.2026;Ried Kaiserberg;04023;1234/5;Grüner Veltliner;GV;9000,00;17,40;85,7;°KMW;Qualitätswein;Handlese;;;;',
      '15.09.2026;Ried Satz;12003;88;Gemischer Satz;;1000,00;;;;Qualitätswein;;;;;',
      '24.09.2026;Ried Kaiserberg;04023;1234/5;Grüner Veltliner;GV;2500,00;19,25;95,5;°KMW;Qualitätswein;Selektionslese;\'=Achtung;;;',
      '02.10.2026;Ried Hochstraß;;;Zweigelt;ZW;6000,00;19,00;94,2;°KMW;Kabinett;Maschinenlese;;;;',
    ].join('\r\n') + '\r\n')
    assert.equal(warnungen.length, 1)
    assert.match(warnungen[0], /„Gemischer Satz“ steht nicht in der BKI-Kürzelliste/)
    assert.equal(zeilen.find(z => z.id === 'p2').kmw, 19.25)                  // Bearbeiten bekommt den gespeicherten Wert
  })

  test('KAN-128: Messwert in °Oe – °KMW verlustfrei, °Oe wie erfasst, gemessene Einheit; X-Warnung nur bei Stufenwechsel', async () => {
    const lese = [
      // 83,5 °Oe gemessen (Variante B: 17,00 °KMW, Kabinett), 94 °Oe (18,97 °KMW), 19,0 °KMW gemessen
      { id: 'q1', jahrgang_id: 'jg26', weingarten_id: 'w1', grundstueck_id: 'g1', ernte_datum: '2026-09-10', menge_kg: 1000, menge_hl: null, oechsle: 83.5, klosterneuburger: 17, mostgewicht_einheit: 'oechsle', qualitaetsstufe: 'kabinett', weingarten: WG.w1, grundstueck: GST.g1 },
      { id: 'q2', jahrgang_id: 'jg26', weingarten_id: 'w1', grundstueck_id: 'g1', ernte_datum: '2026-09-11', menge_kg: 1000, menge_hl: null, oechsle: 94, klosterneuburger: 18.97, mostgewicht_einheit: 'oechsle', qualitaetsstufe: 'kabinett', weingarten: WG.w1, grundstueck: GST.g1 },
      { id: 'q3', jahrgang_id: 'jg26', weingarten_id: 'w2', grundstueck_id: null, ernte_datum: '2026-09-12', menge_kg: 1000, menge_hl: null, oechsle: 94.2, klosterneuburger: 19, mostgewicht_einheit: 'kmw', qualitaetsstufe: 'spaetlese', weingarten: WG.w2, grundstueck: null },
      // nur °Oe gespeichert (vor Migration A möglich): °KMW nach Variante B ergänzt
      { id: 'q4', jahrgang_id: 'jg26', weingarten_id: 'w2', grundstueck_id: null, ernte_datum: '2026-09-13', menge_kg: 500, menge_hl: null, oechsle: 73, klosterneuburger: null, mostgewicht_einheit: null, qualitaetsstufe: 'landwein', weingarten: WG.w2, grundstueck: null },
    ]
    const db = supabaseDoppel({ ...TABELLEN_ERNTE, ernte_parzellen: lese })
    const { zeilen, warnungen } = await ernte.ladeLesedaten(db, 'jg26')
    const zeile = csv.csvText(zeilen, ernte.SPALTEN_LESEDATEN).slice(1).split('\r\n')
    assert.equal(zeile[1], '10.09.2026;Ried Kaiserberg;04023;1234/5;Grüner Veltliner;GV;1000,00;17,00;83,5;°Oe;Kabinett;;;;;')
    assert.equal(zeile[2], '11.09.2026;Ried Kaiserberg;04023;1234/5;Grüner Veltliner;GV;1000,00;18,97;94,0;°Oe;Kabinett;;;;;')
    assert.equal(zeile[3], '12.09.2026;Ried Hochstraß;;;Zweigelt;ZW;1000,00;19,00;94,2;°KMW;Spätlese;;;;;')
    assert.equal(zeile[4], '13.09.2026;Ried Hochstraß;;;Zweigelt;ZW;500,00;14,99;73,0;°Oe;Landwein;;;;;')
    // gespeicherte Werte bleiben für das Bearbeiten-Formular unverändert
    assert.deepEqual(zeilen.map(z => [z.kmw, z.oechsle, z.mostgewichtEinheit]), [[17, 83.5, 'oechsle'], [18.97, 94, 'oechsle'], [19, 94.2, 'kmw'], [null, 73, null]])
    assert.ok(!warnungen.some(w => /Mostgewicht/.test(w)), warnungen.join('\n'))   // 19,0 °KMW: keine X-Warnung
  })

  test('KAN-148: stornierte Lesedaten – ohne Option nicht geladen, mit mitStornierten gekennzeichnet in der CSV', async () => {
    const lese = [
      { id: 's1', jahrgang_id: 'jg26', weingarten_id: 'w2', grundstueck_id: null, ernte_datum: '2026-09-10', menge_kg: 800, menge_hl: null, oechsle: null, klosterneuburger: null, qualitaetsstufe: null, weingarten: WG.w2, grundstueck: null, storniert_am: null },
      { id: 's2', jahrgang_id: 'jg26', weingarten_id: 'w2', grundstueck_id: null, ernte_datum: '2026-09-11', menge_kg: 500, menge_hl: null, oechsle: null, klosterneuburger: null, qualitaetsstufe: null, weingarten: WG.w2, grundstueck: null,
        storniert_am: '2026-09-30T10:15:00+00:00', storno_grund: 'Doppelt erfasst', storniert_von_name: 'Karin' },
    ]
    const db = supabaseDoppel({ ...TABELLEN_ERNTE, ernte_parzellen: lese })
    const ohne = await ernte.ladeLesedaten(db, 'jg26')
    assert.deepEqual(ohne.zeilen.map(z => z.id), ['s1'])
    const mit = await ernte.ladeLesedaten(db, 'jg26', { mitStornierten: true })
    assert.deepEqual(mit.zeilen.map(z => z.id), ['s1', 's2'])
    assert.deepEqual(ernte.ohneStornierteLese(mit.zeilen).map(z => z.id), ['s1'])
    const z2 = mit.zeilen.find(z => z.id === 's2')
    assert.deepEqual([z2.storniertAm, z2.stornoGrund, z2.storniertVon], ['2026-09-30T10:15:00+00:00', 'Doppelt erfasst', 'Karin'])
    const linien = csv.csvText(mit.zeilen, ernte.SPALTEN_LESEDATEN).slice(1).split('\r\n')
    assert.match(linien[2], /;30\.09\.2026 12:15;Doppelt erfasst$/)   // Zeitpunkt in Europe/Vienna
    assert.match(linien[1], /;;$/)
  })

  test('KAN-128: widersprüchliche Altzeile (°Oe gemessen, °KMW passt nicht) → X-Warnung mit Bezug', async () => {
    const lese = [{ id: 'q9', jahrgang_id: 'jg26', weingarten_id: 'w1', grundstueck_id: 'g1', ernte_datum: '2026-09-10', menge_kg: 1000, oechsle: 83.4, klosterneuburger: 17, mostgewicht_einheit: 'oechsle', qualitaetsstufe: 'kabinett', weingarten: WG.w1, grundstueck: GST.g1 }]
    const { warnungen } = await ernte.ladeLesedaten(supabaseDoppel({ ...TABELLEN_ERNTE, ernte_parzellen: lese }), 'jg26')
    const w = warnungen.join('\n')
    assert.match(w, /Mostgewicht gemessen in °Oe: exportiert 83,4 °Oe ergibt rechnerisch Qualitätswein, der gespeicherte Wert 17,0 °KMW Kabinett – Mostgewicht bitte prüfen\. \(1 Lese: 10\.09\.2026 Ried Kaiserberg GST 1234\/5\)/)
  })

  test('KAN-144: Notizen als letzte Spalte – 0 kg mit Grund, leer ohne Notiz, „;“, Umbruch und Formelzeichen maskiert', async () => {
    const lese = (id, notizen, menge_kg = 500) => ({ id, jahrgang_id: 'jg26', weingarten_id: 'w2', grundstueck_id: null, ernte_datum: '2026-09-26', menge_kg, menge_hl: null, oechsle: null, klosterneuburger: null, qualitaetsstufe: null, lesemethode: null, notizen, weingarten: WG.w2, grundstueck: null })
    const db = supabaseDoppel({ ...TABELLEN_ERNTE, ernte_parzellen: [
      lese('n1', 'Wildschaden', 0),                                   // Musterhof 2026: Frechau St. Laurent, GST 2214
      lese('n2', null),
      lese('n3', '   '),                                              // nur Leerzeichen = keine Notiz
      lese('n4', 'Hagel; 30 % Ausfall'),
      lese('n5', 'Zeile 1\r\nZeile 2\nZeile 3'),
      lese('n6', '=HYPERLINK("http://x")'),
      lese('n7', '+43 664 1234567'),
      lese('n8', '-5 % Fäulnis'),
      lese('n9', '@Summe'),
      lese('na', '\n=1+1'),                                           // Umbruch vor dem Formelzeichen
    ] })
    const { zeilen } = await ernte.ladeLesedaten(db, 'jg26')
    assert.equal(zeilen.find(z => z.id === 'n3').notizen, null)
    const text = csv.csvText(zeilen, ernte.SPALTEN_LESEDATEN)
    const linien = text.slice(1).split('\r\n')
    // KAN-129 (Frage 8): „Lese“ hinter „Notizen“; KAN-148: danach nur die beiden Storno-Spalten
    assert.deepEqual(linien[0].split(';').slice(-4), ['Notizen', 'Lese', 'Storniert am', 'Storno-Grund'])
    assert.equal(linien[0].split(';').length, 16)                   // bisherige 12 Spalten unverändert davor
    const notiz = id => {
      const i = zeilen.findIndex(z => z.id === id)
      // ohne die (hier leeren) Spalten „Lese“, „Storniert am“, „Storno-Grund“ am Ende
      return linien[i + 1].slice('26.09.2026;Ried Hochstraß;;;Zweigelt;ZW;'.length).replace(/;;;$/, '')
    }
    assert.equal(notiz('n1'), '0,00;;;;;;Wildschaden')
    assert.equal(notiz('n2'), '500,00;;;;;;')
    assert.equal(notiz('n3'), '500,00;;;;;;')
    assert.equal(notiz('n4'), '500,00;;;;;;"Hagel; 30 % Ausfall"')
    assert.equal(notiz('n5'), '500,00;;;;;;Zeile 1 Zeile 2 Zeile 3')
    assert.equal(notiz('n6'), '500,00;;;;;;"\'=HYPERLINK(""http://x"")"')
    assert.equal(notiz('n7'), "500,00;;;;;;'+43 664 1234567")
    assert.equal(notiz('n8'), "500,00;;;;;;'-5 % Fäulnis")
    assert.equal(notiz('n9'), "500,00;;;;;;'@Summe")
    assert.equal(notiz('na'), "500,00;;;;;;'=1+1")
    assert.equal(linien.length, zeilen.length + 2)                  // CRLF auch nach der letzten Zeile, kein Umbruch aus einer Notiz
  })

  test('fremder oder unbekannter Jahrgang → 400', async () => {
    const db = supabaseDoppel(TABELLEN_ERNTE)
    await assert.rejects(ernte.jahrgangPflicht(db, T, 2031), e => e instanceof MeldungsFehler && e.status === 400)
    assert.equal(await ernte.jahrgangFinden(db, FREMD, 2025), null)
  })
})

// ── Weinerntemeldung ────────────────────────────────────────────────────────

describe('erntemeldung', () => {
  test('Vorschau aus Lesedaten: je Rebsorte, Fläche je GST einmal, hl ÷ 130, Übermenge, Traubenverkauf', async () => {
    const db = supabaseDoppel(TABELLEN_ERNTE)
    const daten = await ernte.ladeErntemeldung(db, T, { id: 'jg26', jahrgang: 2026 })
    mandantengefiltert(db)
    assert.equal(daten.quelle, 'lesedaten')
    const text = csv.csvText(daten.zeilen, ernte.SPALTEN_ERNTEMELDUNG)
    assert.equal(text, BOM + [
      'Rebsorte;BKI-Kürzel;Fläche (ha);Menge (kg);davon als Trauben verkauft (kg);Menge (hl);Mostgewicht (°KMW);Mostgewicht (°Oe);Qualitätsstufe;Ertrag (kg/ha);Höchstertrag (kg/ha);Übermenge (kg)',
      'Gemischer Satz;;0,2500;1000;0;7,69;;;Qualitätswein;4000;10000;0',
      // °KMW mengengewichtet: (9000 × 17,4 + 2500 × 19,25) / 11500 = 17,802… → 17,80; °Oe = f(17,80) = 87,8
      'Grüner Veltliner;GV;1,0000;11500;800;88,46;17,80;87,8;Qualitätswein;11500;10000;1500',
      'Zweigelt;ZW;0,8000;6000;0;46,15;19,00;94,2;Kabinett;7500;;',
    ].join('\r\n') + '\r\n')
    // Ausdruck summiert die gerundeten Zeilenwerte
    assert.deepEqual(daten.summe, { flaecheHa: 2.05, mengeKg: 18500, verkauftKg: 800, mengeHl: 142.3 })
    // betriebsweit: 12.500 kg Qualitätswein ≤ 10.000 × 3,25 ha (fremde und Nicht-WI-Grundstücke zählen nicht)
    assert.deepEqual(daten.hektarhoechstertrag, { gesamtFlaecheHaBetrieb: 3.25, gesamtKgQualitaetswein: 12500, maxKg: 32500, ueberschreitungKg: 0, ueberschritten: false })
    const w = daten.warnungen.join('\n')
    assert.match(w, /noch keine AMA-Meldung erstellt/)
    assert.match(w, /Menge \(hl\) bei 3 Rebsorten aus Menge \(kg\) ÷ 130/)
    assert.match(w, /„Gemischer Satz“ steht nicht in der BKI-Kürzelliste/)
    assert.match(w, /Hektarhöchstertrag betriebsweit \(maßgeblich\): 12\.500 kg .* – eingehalten/)
  })

  test('gespeicherte Meldung: Positionen, Abweichung zu den Lesedaten, Überschreitung betriebsweit', async () => {
    const db = supabaseDoppel({
      ...TABELLEN_ERNTE,
      grundstuecke: [{ id: 'g1', tenant_id: T, nutzart: 'WI', flaeche_ha: 1 }],
      ama_erntemeldungen: [{ id: 'm1', tenant_id: T, jahrgang_id: 'jg26', status: 'bereit', gesamtmenge_kg: 18000, gesamtmenge_hl: 138.46 }],
      ama_meldepositionen: [
        { id: 'a', meldung_id: 'm1', rebsorte_name: 'Grüner Veltliner', flaeche_ha: 1.23456, menge_kg: 11500.4, menge_hl: 88.5, qualitaetsstufe: 'qualitaetswein' },
        { id: 'b', meldung_id: 'm1', rebsorte_name: 'Zweigelt', flaeche_ha: 0.8, menge_kg: 6500, menge_hl: null, qualitaetsstufe: 'qualitaetswein' },
        { id: 'x', meldung_id: 'm9', rebsorte_name: 'Fremd', flaeche_ha: 9, menge_kg: 9, qualitaetsstufe: 'qualitaetswein' },
      ],
    })
    const daten = await ernte.ladeErntemeldung(db, T, { id: 'jg26', jahrgang: 2026 })
    assert.equal(daten.quelle, 'meldung')
    assert.deepEqual(daten.zeilen.map(z => [z.rebsorte, z.flaecheHa, z.mengeKg, z.mengeHl, z.hlGeschaetzt, z.uebermengeKg]), [
      ['Grüner Veltliner', 1.2346, 11500, 88.5, false, 0],
      ['Zweigelt', 0.8, 6500, 50, true, 0],
    ])
    const w = daten.warnungen.join('\n')
    assert.match(w, /nach dem Erstellen der AMA-Meldung geändert \(Meldung 18\.000 kg, Lesedaten 18\.500 kg\)/)
    // betriebsweit: 12.500 kg Qualitätswein (Lesedaten) > 10.000 kg/ha × 1 ha
    assert.match(w, /12\.500 kg Qualitätswein von max\. 10\.000 kg .* – ÜBERSCHRITTEN um 2\.500 kg/)
    assert.equal(daten.hektarhoechstertrag.ueberschreitungKg, 2500)
    assert.equal(daten.zeilen[0].verkauftKg, 800)
    // Meldung vor dem 25.09.2026: fest „Qualitätswein“ – die Lesedaten sagen Kabinett
    assert.match(w, /gespeicherte AMA-Meldung weicht von den Lesedaten ab: „Zweigelt“ \(Qualitätsstufe „Qualitätswein“, Lesedaten: Kabinett\)/)
    assert.doesNotMatch(w, /„Grüner Veltliner“ \(Qualitätsstufe/)
    assert.equal(daten.zeilen[0].kmw, 17.8)                                    // Mostgewicht aus den Lesedaten
    assert.equal(daten.zeilen[0].oechsle, 87.8)
  })

  test('KAN-128: Ø °KMW abgerundet (nie über die Schwelle), °Oe = f(Ø °KMW), °Oe-Messungen über ihren °KMW', async () => {
    const lese = [
      // (1000 × 19,00 + 1 × 14,00) / 1001 = 18,995… → 18,99 (kaufmännisch wäre 19,00 = Spätlese)
      { id: 'r1', jahrgang_id: 'jg26', weingarten_id: 'w2', grundstueck_id: null, ernte_datum: '2026-09-10', menge_kg: 1000, klosterneuburger: 19, oechsle: 94.2, mostgewicht_einheit: 'kmw', qualitaetsstufe: 'spaetlese', weingarten: WG.w2, grundstueck: null },
      { id: 'r2', jahrgang_id: 'jg26', weingarten_id: 'w2', grundstueck_id: null, ernte_datum: '2026-09-11', menge_kg: 1, klosterneuburger: 14, oechsle: 67.9, mostgewicht_einheit: 'kmw', qualitaetsstufe: 'landwein', weingarten: WG.w2, grundstueck: null },
      // je 50 % 14 und 22 °KMW: 18,00 °KMW = 88,8 °Oe (°Oe-Mittel wäre 89,2) – 22 °KMW als °Oe gemessen
      { id: 'r3', jahrgang_id: 'jg26', weingarten_id: 'w1', grundstueck_id: 'g1', ernte_datum: '2026-09-12', menge_kg: 500, klosterneuburger: 14, oechsle: 67.9, mostgewicht_einheit: 'kmw', qualitaetsstufe: 'landwein', weingarten: WG.w1, grundstueck: GST.g1 },
      { id: 'r4', jahrgang_id: 'jg26', weingarten_id: 'w1', grundstueck_id: 'g1', ernte_datum: '2026-09-13', menge_kg: 500, klosterneuburger: 22, oechsle: 110.5, mostgewicht_einheit: 'oechsle', qualitaetsstufe: 'auslese', weingarten: WG.w1, grundstueck: GST.g1 },
    ]
    const daten = await ernte.ladeErntemeldung(supabaseDoppel({ ...TABELLEN_ERNTE, ernte_parzellen: lese }), T, { id: 'jg26', jahrgang: 2026 })
    const je = Object.fromEntries(daten.zeilen.map(z => [z.rebsorte, [z.kmw, z.oechsle]]))
    assert.deepEqual(je.Zweigelt, [18.99, 94.1])
    assert.deepEqual(je['Grüner Veltliner'], [18, 88.8])
    const text = csv.csvText(daten.zeilen, ernte.SPALTEN_ERNTEMELDUNG)
    assert.match(text, /\r\nZweigelt;ZW;0,8000;1001;0;7,70;18,99;94,1;;/)
    assert.ok(!daten.warnungen.some(w => /exportiert/.test(w)))                // Mittelwerte sind keine Messwerte
  })

  test('gespeicherte Meldung mit erfassten hl: nicht übernommene hl werden gemeldet', async () => {
    const lese = TABELLEN_ERNTE.ernte_parzellen.map(p => (p.id === 'p3' ? { ...p, menge_hl: 45 } : p))
    const db = supabaseDoppel({
      ...TABELLEN_ERNTE,
      ernte_parzellen: lese,
      ama_erntemeldungen: [{ id: 'm1', tenant_id: T, jahrgang_id: 'jg26', status: 'bereit', gesamtmenge_kg: 18500 }],
      ama_meldepositionen: [{ id: 'b', meldung_id: 'm1', rebsorte_name: 'Zweigelt', flaeche_ha: 0.8, menge_kg: 6000, menge_hl: null, qualitaetsstufe: 'kabinett' }],
    })
    const daten = await ernte.ladeErntemeldung(db, T, { id: 'jg26', jahrgang: 2026 })
    const w = daten.warnungen.join('\n')
    assert.match(w, /„Zweigelt“ \(erfasste 45 hl nicht übernommen \(Meldung rechnet kg ÷ 130\)\)/)
    assert.match(w, /nicht in die AMA-Meldung übernommen/)
  })

  test('stornierte Traubenverkäufe zählen nicht als „davon verkauft“ (wie im BKI-Datenblatt)', async () => {
    const db = supabaseDoppel({
      ...TABELLEN_ERNTE,
      traubenverkauf: [
        ...TABELLEN_ERNTE.traubenverkauf,
        { id: 't3', tenant_id: T, jahrgang_id: 'jg26', weingarten_id: 'w1', liefernummer: 'TV-0009', menge_kg: 500, weingarten: { rebsorte: 'Grüner Veltliner' }, grundstueck: null, verkaufsposten: { storniert: true, rechnungsnummer: 'RE-1' } },
      ],
    })
    const daten = await ernte.ladeErntemeldung(db, T, { id: 'jg26', jahrgang: 2026 })
    assert.equal(daten.zeilen.find(z => z.rebsorte === 'Grüner Veltliner').verkauftKg, 800)
    assert.match(daten.warnungen.join('\n'), /1 stornierter Traubenverkauf ist nicht enthalten \(TV-0009\)/)
  })

  test('Aggregation: zwei Lesedurchgänge auf demselben Grundstück zählen die Fläche einmal', () => {
    const s = ernte.aggregiereJeRebsorte([
      { weingartenId: 'w1', grundstueckId: 'g1', rebsorte: 'Riesling', flaecheHa: 0.5, mengeKg: 3000, qualitaetsstufe: 'qualitaetswein' },
      { weingartenId: 'w1', grundstueckId: 'g1', rebsorte: 'Riesling', flaecheHa: 0.5, mengeKg: 1000, qualitaetsstufe: 'spaetlese' },
      { weingartenId: 'w1', grundstueckId: 'g2', rebsorte: 'Riesling', flaecheHa: 0.25, mengeKg: 500, mengeHl: 4, qualitaetsstufe: 'qualitaetswein' },
      { weingartenId: 'w7', grundstueckId: null, rebsorte: null, flaecheHa: 1, mengeKg: 10, qualitaetsstufe: null },
    ])
    assert.deepEqual(s.map(x => [x.rebsorte, x.flaecheHa, x.mengeKg, x.qualitaetsstufen]), [
      ['Riesling', 0.75, 4500, ['qualitaetswein', 'spaetlese']],
      ['Unbekannt', 1, 10, []],
    ])
    assert.equal(s[0].hlGeschaetzt, true)
  })
})

// ── Weinbestandsmeldung ─────────────────────────────────────────────────────

describe('bestandsmeldung', () => {
  const TABELLEN = {
    fuellungen: [
      { id: 'f1', tenant_id: T, aktiv: true, name: 'Grüner Veltliner Federspiel', jahrgang: 2025, rebsorte: 'Grüner Veltliner', qualitaet: 'qualitaetswein', flaschengroesse_ml: 750, bestand_flaschen: 120 },
      { id: 'f2', tenant_id: T, aktiv: true, name: 'Rosé', jahrgang: 2025, rebsorte: 'Zweigelt', flaschengroesse_ml: null, bestand_flaschen: 13, weinausbau: { weinart: 'rose' } },
      { id: 'f3', tenant_id: T, aktiv: true, name: 'Leer', jahrgang: 2024, rebsorte: 'Zweigelt', flaschengroesse_ml: 750, bestand_flaschen: 0 },
      { id: 'f9', tenant_id: FREMD, aktiv: true, name: 'Fremd', jahrgang: 2025, rebsorte: 'Zweigelt', flaschengroesse_ml: 750, bestand_flaschen: 99 },
    ],
    weinausbau: [
      { id: 'w1', tenant_id: T, aktiv: true, status: 'gaerung', name: 'ZW 26/1', jahrgang: 2026, rebsorte: 'Zweigelt', qualitaetsstufe: 'kabinett', menge_liter: 1234.567, behaelter_id: 'b1', behaelter: { name: 'T1' } },
      { id: 'w2', tenant_id: T, aktiv: true, status: 'abgeschlossen', name: 'Alt', jahrgang: 2024, rebsorte: 'Zweigelt', menge_liter: 50, behaelter_id: 'b1', behaelter: { name: 'T1' } },
      { id: 'w3', tenant_id: T, aktiv: true, status: 'lagerung', name: 'RR 25', jahrgang: 2025, rebsorte: 'Riesling', menge_liter: 500, behaelter_id: 'b9', behaelter: null },
    ],
  }
  const RPC = {
    lade_behaelter: () => [
      { id: 'b1', tenant_id: T, name: 'T1', fremd: false, eigentuemer_name: 'Weingut Muster' },
      { id: 'b9', tenant_id: FREMD, name: 'a1', fremd: true, eigentuemer_name: 'Weingut Partner' },
    ],
  }

  test('genau der Ausdruck: A Flaschen + B Gebinde, Bestand am Abrufdatum, Summen aus gerundeten Zeilen', async () => {
    const db = supabaseDoppel(TABELLEN, RPC)
    const d = await bestand.ladeBestandsmeldung(db, T, { bestandAm: '2026-09-24' })
    mandantengefiltert(db)
    const text = csv.csvText(d.zeilen, bestand.SPALTEN_BESTANDSMELDUNG)
    assert.equal(text, BOM + [
      'Bestand am;Abschnitt;Bezeichnung;Jahrgang;Rebsorte;BKI-Kürzel;Farbe;Qualitätsstufe;Behälter;Flaschengröße (ml);Flaschen;Menge (l);Menge (hl)',
      '24.09.2026;A – Flaschenwein;Grüner Veltliner Federspiel;2025;Grüner Veltliner;GV;Weiß;Qualitätswein;;750;120;90,00;0,900',
      // Farbe: Weinart der Charge vor der Rebsorte (Rosé aus Zweigelt)
      '24.09.2026;A – Flaschenwein;Rosé;2025;Zweigelt;ZW;Rosé;;;750;13;9,75;0,098',
      '24.09.2026;B – Wein in Gebinden (Tank / Fass);ZW 26/1;2026;Zweigelt;ZW;Rot;Kabinett;T1;;;1234,57;12,346',
      '24.09.2026;B – Wein in Gebinden (Tank / Fass);RR 25;2025;Riesling;RR;Weiß;;a1 · Weingut Partner;;;500,00;5,000',
    ].join('\r\n') + '\r\n')
    assert.deepEqual(d.summe, { flaschen: 133, flaschenHl: 0.998, gebindeHl: 17.346, gesamtHl: 18.344 })
    assert.match(d.warnungen[0], /Bestand am 24\.09\.2026 \(Abrufdatum\) – KEIN Stichtagsbestand zum 31\. Juli/)
    assert.ok(d.warnungen.some(w => /1 Füllung ohne Flaschengröße – 750 ml angenommen/.test(w)))
  })

  test('Leermeldung: nur Kopfzeile, Hinweis auf das Abrufdatum bleibt', async () => {
    const d = await bestand.ladeBestandsmeldung(supabaseDoppel({}), T, { bestandAm: '2026-09-24' })
    const datei = csv.csvDatei(d.zeilen, bestand.SPALTEN_BESTANDSMELDUNG)
    assert.equal(datei.zeilen, 0)
    assert.equal(datei.text.split('\r\n').length, 2)
    assert.equal(d.warnungen.length, 1)
  })
})

// ── BKI-Datenblatt Traubenverkauf ───────────────────────────────────────────

describe('bki-traubenverkauf', () => {
  const TABELLEN = {
    tenant_einstellungen: [
      { tenant_id: T, betrieb_betriebsnummer: '9988776', betrieb_name: 'Weingut Muster', betrieb_strasse: 'Rebenweg 1', betrieb_plz: '3500', betrieb_ort: 'Krems' },
      { tenant_id: FREMD, betrieb_betriebsnummer: '1111111', betrieb_name: 'Fremd' },
    ],
    weinjahrgaenge: TABELLEN_ERNTE.weinjahrgaenge,
    traubenverkauf: [
      {
        id: 'v1', tenant_id: T, jahrgang_id: 'jg26', datum: '2026-09-05', liefernummer: 'TV-0001', menge_kg: 1250.5, kmw_grad: 17.4, qualitaetsstufe: 'qualitaetswein', herkunft_code: null,
        weingarten: { name: 'Kaiserberg', rebsorte: 'Grüner Veltliner', trauben_herkunft_code: 'wlnoe', grundstuecke: [] },
        grundstueck: { rebsorte: 'Riesling', trauben_herkunft_code: 'thermenregion_ortswein' }, zukauf: null,
        kontakt: null, firma: { betrieb_nr: '7654321', name: 'Weingut Huber, Stiftung', strasse: 'Hauptstraße 3a', plz: '2170', ort: 'Poysdorf' },
        jahrgang: { jahrgang: 2026 },
      },
      {
        id: 'v2', tenant_id: T, jahrgang_id: 'jg26', datum: '2026-09-18', liefernummer: 'TV-0002', menge_kg: 980, kmw_grad: 21, qualitaetsstufe: 'ausbruch', herkunft_code: 'Weinviertel',
        weingarten: { name: 'Hochstraß', rebsorte: 'Zweigelt', trauben_herkunft_code: null, grundstuecke: [{ trauben_herkunft_code: null }] },
        grundstueck: null, zukauf: null,
        kontakt: { betrieb_nr: null, vorname: 'Hans', nachname: 'Gruber', strasse: 'Kellergasse', plz: '3491', ort: 'Straß im Straßertale' }, firma: null,
        jahrgang: { jahrgang: 2026 },
      },
      {
        id: 'v3', tenant_id: T, jahrgang_id: 'jg26', datum: '2026-09-20', liefernummer: null, menge_kg: 300, kmw_grad: null, qualitaetsstufe: 'reserve', herkunft_code: null,
        weingarten: null, grundstueck: null, zukauf: { rebsorte: 'Uhudler', herkunft: 'Südburgenland' },
        kontakt: null, firma: null, jahrgang: { jahrgang: 2026 },
      },
      { id: 'v4', tenant_id: T, jahrgang_id: 'jg25', datum: '2025-09-20', menge_kg: 1, jahrgang: { jahrgang: 2025 } },
      // Rechnung storniert: nicht melden (Ersatz würde sonst doppelt gemeldet)
      { id: 'v5', tenant_id: T, jahrgang_id: 'jg26', datum: '2026-09-21', liefernummer: 'TV-0005', menge_kg: 700, jahrgang: { jahrgang: 2026 }, verkaufsposten: { storniert: true, rechnungsnummer: 'RE-2026-0005' } },
      { id: 'v9', tenant_id: FREMD, jahrgang_id: 'jgX', datum: '2026-09-20', menge_kg: 1, jahrgang: { jahrgang: 2026 } },
    ],
  }

  test('EDV-Liste: Vorspann, Format wie bisher, Sorte vom Grundstück, Farbe aus dem Kürzel, Hinweise', async () => {
    const db = supabaseDoppel(TABELLEN)
    const { zeilen, warnungen } = await tv.ladeBkiTraubenverkauf(db, T, { jahrgang: 2026 })
    mandantengefiltert(db)
    const text = csv.csvText(zeilen, tv.SPALTEN_BKI_TRAUBENVERKAUF, csv.PROFIL_BKI)
    const vers = '9988776;Weingut Muster;;Rebenweg;1;3500;Krems'
    assert.equal(text, BOM + [
      'EDV-Liste zum automatischen Einlesen in die Weindatenbank',
      '',
      'Betriebsnr_Empf;Name_Empf;Vorname_Empf;Strasse_Empf;Hausnr_Empf;PLZ_Empf;Ort_Empf;Betriebsnr_Vers;Name_Vers;Vorname_Vers;Strasse_Vers;Hausnr_Vers;PLZ_Vers;Ort_Vers;Datum_Lieferung;Menge_kg;Art;Weiss;Rot;Sorte1;Sorte2;Sorte3;Qualitaetsstufe;Jahrgang;Herkunft;KMW_Grad;Oechsle',
      // Menge_kg: ganze kg wie bisher ohne Komma (Schnittstelle „Menge int“), Bruchteil mit Dezimalkomma
      // Herkunft nur als BKI-Kürzel (KAN-36): Stufe des Grundstücks → WLTH, Bezeichnung → WLWV, Freitext leer
      // KAN-128: KMW_Grad UND Oechsle immer befüllt – °Oe aus dem °KMW mit 1 Stelle, ohne Nachkomma-Null (105,0 → 105)
      `7654321;"Weingut Huber, Stiftung";;Hauptstraße;3a;2170;Poysdorf;${vers};05.09.2026;"1250,5";TB;J;;RR;;;QUW;2026;WLTH;"17,4";"85,7"`,
      `;Gruber;Hans;Kellergasse;;3491;Straß im Straßertale;${vers};18.09.2026;980;TB;;J;ZW;;;AUB;2026;WLWV;"21,0";105`,   // Ausbruch: AUB als Vorschlag
      `;;;;;;;${vers};20.09.2026;300;TB;;;;;;QUW;2026;;;`,
    ].join('\r\n'))
    const w = warnungen.join('\n')
    assert.match(w, /Abnehmer „Hans Gruber“ ohne BKI-Betriebsnummer .* \(1 Lieferung: TV-0002\)/)
    assert.match(w, /„Ausbruch“ steht nicht in der BKI-Kürzelliste – vorläufig als AUB gemeldet .* \(1 Lieferung: TV-0002\)/)
    assert.match(w, /Rebsorte „Uhudler“ steht nicht in der BKI-Kürzelliste – Sorte1, Weiss und Rot leer gelassen\. \(1 Lieferung: Lieferung vom 20\.09\.2026\)/)
    assert.match(w, /„Reserve“ hat kein eigenes BKI-Kürzel – als Qualitätswein \(QUW\) gemeldet/)
    assert.match(w, /Kein Abnehmer erfasst/)
    assert.match(w, /Menge mit Nachkommastellen .* ganze kg .* \(1 Lieferung: TV-0001\)/)
    assert.match(w, /1 stornierter Traubenverkauf ist nicht enthalten \(TV-0005\)/)
    assert.match(w, /Herkunft „Südburgenland“ \(Zukauf\) ist kein BKI-Herkunftskürzel – Spalte leer gelassen\. \(1 Lieferung: Lieferung vom 20\.09\.2026\)/)
    assert.doesNotMatch(w, /Herkunft[^\n]*TV-000[12]/)                         // WLTH und WLWV ohne Hinweis
  })

  test('KAN-128: Mostgewicht – beide Spalten, °KMW abgerundet, °Oe wie erfasst; X-Warnung nur bei Stufenwechsel', () => {
    const basis = { datum: '2026-09-05', menge_kg: 100, qualitaetsstufe: 'qualitaetswein', grundstueck: { rebsorte: 'Grüner Veltliner' }, jahrgang: { jahrgang: 2026 } }
    const faelle = [
      [{ liefernummer: 'M1', kmw_grad: 16.33, oechsle: 80, mostgewicht_einheit: 'oechsle' }, '"16,3";80'],        // 80 → „80“
      [{ liefernummer: 'M2', kmw_grad: 17, oechsle: 83.5, mostgewicht_einheit: 'oechsle' }, '"17,0";"83,5"'],     // 83,5 °Oe = 17,00 °KMW
      [{ liefernummer: 'M3', kmw_grad: 18.97, oechsle: 94, mostgewicht_einheit: 'oechsle' }, '"18,9";94'],        // abgerundet, nicht „19,0“
      [{ liefernummer: 'M4', kmw_grad: 18.95, oechsle: 93.9, mostgewicht_einheit: 'kmw' }, '"18,9";"93,9"'],      // gemessene 18,95 °KMW → „18,9“
      [{ liefernummer: 'M5', kmw_grad: 19, oechsle: 94.2, mostgewicht_einheit: 'kmw' }, '"19,0";"94,2"'],         // 19,0 °KMW: gleiche Stufe
      [{ liefernummer: 'M6', kmw_grad: 20.9, oechsle: 104.5, mostgewicht_einheit: 'oechsle' }, '"20,9";"104,5"'], // nie auf ganze °Oe (105 = Auslese)
      [{ liefernummer: 'M7', kmw_grad: null, oechsle: 73, mostgewicht_einheit: 'oechsle' }, '"14,9";73'],         // nur °Oe gespeichert: °KMW nach Variante B
      [{ liefernummer: 'M8', kmw_grad: 17.4, oechsle: null, mostgewicht_einheit: null }, '"17,4";"85,7"'],        // Altzeile ohne °Oe und Einheit
    ]
    const { zeilen, warnungen } = tv.bkiZeilen(faelle.map(([v]) => ({ ...basis, ...v })), { betrieb_betriebsnummer: '9' })
    const text = csv.csvText(zeilen, tv.SPALTEN_BKI_TRAUBENVERKAUF, csv.PROFIL_BKI).split('\r\n').slice(3)
    faelle.forEach(([v, soll], i) => assert.ok(text[i].endsWith(`;${soll}`), `${v.liefernummer}: ${text[i]}`))
    assert.ok(!warnungen.some(w => /Mostgewicht/.test(w)), warnungen.join('\n'))
    // widersprüchliche Altzeile: gemessene 83,4 °Oe ergäben Qualitätswein, gespeichert 17,0 °KMW = Kabinett
    const wider = tv.bkiZeilen([{ ...basis, liefernummer: 'M9', kmw_grad: 17, oechsle: 83.4, mostgewicht_einheit: 'oechsle' }], { betrieb_betriebsnummer: '9' })
    assert.match(wider.warnungen.join('\n'), /Mostgewicht gemessen in °Oe: exportiert 83,4 °Oe ergibt rechnerisch Qualitätswein, der gespeicherte Wert 17,0 °KMW Kabinett .* \(1 Lieferung: M9\)/)
  })

  test('Formelzeichen in Stammdaten: am Feldanfang entfernt und gemeldet (kein Apostroph im Upload)', () => {
    const { zeilen } = tv.bkiZeilen([{
      datum: '2026-09-05', liefernummer: 'TV-1', menge_kg: 10, qualitaetsstufe: 'landwein', herkunft_code: null,
      grundstueck: { rebsorte: 'Blauer Zweigelt' }, weingarten: null, zukauf: null,
      firma: { betrieb_nr: '1', name: '=HYPERLINK("https://x.example")', strasse: ' +Hauptstraße 1', plz: '2170', ort: '@Poysdorf' }, kontakt: null,
      jahrgang: { jahrgang: 2026 },
    }], { betrieb_betriebsnummer: '9' })
    const d = csv.csvDatei(zeilen, tv.SPALTEN_BKI_TRAUBENVERKAUF, csv.PROFIL_BKI)
    const zeile = d.text.split('\r\n')[3].split(';')
    assert.equal(zeile[1], '"HYPERLINK(""https://x.example"")"')
    assert.equal(zeile[3], 'Hauptstraße')
    assert.equal(zeile[6], 'Poysdorf')
    assert.equal(zeile[19], 'ZW')                                              // Synonym „Blauer Zweigelt“
    assert.deepEqual([zeile[17], zeile[18]], ['', 'J'])                        // Rot
    assert.equal(zeile[22], 'LDW')
    assert.ok(d.warnungen.some(w => /^Spalte „Name_Empf“: 1 Wert mit Formelzeichen am Anfang .* – Zeichen entfernt, Stammdaten prüfen \(Datensatz 1\)$/.test(w)))
    assert.ok(d.warnungen.some(w => /^Spalte „Ort_Empf“/.test(w)))
  })

  test('ohne Jahrgang alle Jahrgänge des Betriebs; unbekannter Jahrgang → 400', async () => {
    const alle = await tv.ladeBkiTraubenverkauf(supabaseDoppel(TABELLEN), T, { jahrgang: null })
    assert.equal(alle.zeilen.length, 4)                                         // v1–v4, ohne stornierte v5
    await assert.rejects(tv.ladeBkiTraubenverkauf(supabaseDoppel(TABELLEN), T, { jahrgang: 2031 }), e => e instanceof MeldungsFehler && e.status === 400)
  })

  test('Leermeldung: Vorspann + Kopf, ohne abschließendes CRLF (PROFIL_BKI)', async () => {
    const { zeilen } = await tv.ladeBkiTraubenverkauf(supabaseDoppel({ ...TABELLEN, traubenverkauf: [] }), T, { jahrgang: 2026 })
    const t = csv.csvText(zeilen, tv.SPALTEN_BKI_TRAUBENVERKAUF, csv.PROFIL_BKI)
    assert.equal(t.split('\r\n').length, 3)
    assert.ok(!t.endsWith('\r\n'))
  })

  test('interne Traubenverkauf-Liste: Umlaute im Kopf, Betrag, null-sicher', () => {
    const t = csv.csvText([
      { liefernummer: 'TV-0001', datum: '2026-09-05', jahrgang: 2026, quelle: 'Kaiserberg', gstNr: '1234/5', mengeKg: 1250.5, preisProKg: 0.655, kmw: 17.4, qualitaet: 'Qualitätswein', gesundheit: 'G', herkunftscode: 'NÖ', kaeufer: '+43 Genossenschaft', rechnungsnummer: 'RE-2026-0001', notizen: null },
      { liefernummer: null, datum: null, jahrgang: null, quelle: null, gstNr: null, mengeKg: null, preisProKg: null, kmw: null, qualitaet: null, gesundheit: null, herkunftscode: null, kaeufer: null, rechnungsnummer: null, notizen: null },
    ], tv.SPALTEN_TRAUBENVERKAUF_LISTE)
    const zeilen = t.slice(1).split('\r\n')
    assert.equal(zeilen[0], 'Liefernummer;Lieferdatum;Jahrgang;Quelle (Ried bzw. Zukauf);GST-Nr.;Menge (kg);Preis (€/kg);Betrag (€);Mostgewicht (°KMW);Mostgewicht (°Oe);Mostgewicht gemessen in;Qualitätsstufe;Gesundheit (G/K);Herkunftscode;Käufer;Rechnung;Notizen;Storniert am;Storno-Grund')
    assert.equal(zeilen[1], "TV-0001;05.09.2026;2026;Kaiserberg;1234/5;1250,50;0,6550;819,08;17,4;85,7;°KMW;Qualitätswein;G;NÖ;'+43 Genossenschaft;RE-2026-0001;;;")   // 1 Stelle, °Oe aus dem °KMW
    assert.equal(zeilen[2], ';;;;;;;;;;;;;;;;;;')
    // KAN-128: °KMW auf 1 Stelle ABGERUNDET (18,95 → 18,9, nicht 19,0), °Oe-Messung mit Einheit
    const t2 = csv.csvText([
      { liefernummer: 'TV-2', datum: null, jahrgang: null, quelle: null, gstNr: null, mengeKg: null, preisProKg: null, kmw: 18.95, oechsle: 93.9, mostgewichtEinheit: 'kmw', qualitaet: null, gesundheit: null, herkunftscode: null, kaeufer: null, rechnungsnummer: null, notizen: null },
      { liefernummer: 'TV-3', datum: null, jahrgang: null, quelle: null, gstNr: null, mengeKg: null, preisProKg: null, kmw: 18.97, oechsle: 94, mostgewichtEinheit: 'oechsle', qualitaet: null, gesundheit: null, herkunftscode: null, kaeufer: null, rechnungsnummer: null, notizen: null },
    ], tv.SPALTEN_TRAUBENVERKAUF_LISTE).slice(1).split('\r\n')
    assert.equal(t2[1], 'TV-2;;;;;;;;18,9;93,9;°KMW;;;;;;;;')
    assert.equal(t2[2], 'TV-3;;;;;;;;18,9;94,0;°Oe;;;;;;;;')
    // X-Warnung nur für eine widersprüchliche Messung (83,4 °Oe gemessen, 17,0 °KMW gespeichert)
    const zeile = (liefernummer, kmw, oechsle, mostgewichtEinheit) => ({ liefernummer, datum: null, jahrgang: null, quelle: null, gstNr: null, mengeKg: null, preisProKg: null, kmw, oechsle, mostgewichtEinheit, qualitaet: null, gesundheit: null, herkunftscode: null, kaeufer: null, rechnungsnummer: null, notizen: null })
    assert.deepEqual(tv.traubenverkaufListenHinweise([zeile('TV-2', 18.95, 93.9, 'kmw'), zeile('TV-3', 18.97, 94, 'oechsle'), zeile('TV-4', null, null, null)]), [])
    const w = tv.traubenverkaufListenHinweise([zeile('TV-5', 17, 83.4, 'oechsle')])
    assert.equal(w.length, 1)
    assert.match(w[0], /exportiert 83,4 °Oe ergibt rechnerisch Qualitätswein.*\(1 Lieferung: TV-5\)$/)
  })

  test('interne Traubenverkauf-Liste: °KMW auf 1 Stelle abgerundet kippt nie über eine Stufenschwelle (Entscheidung 8)', async () => {
    const { abrunden, ausMessung, KMW_MAX, OECHSLE_MAX } = await import('../../src/lib/wein/mostgewicht.ts')
    const { kmwZuQualitaet } = await import('../../src/lib/weinqualitaet.ts')
    const zeile = (m) => ({ liefernummer: `TV ${m.kmw}`, datum: null, jahrgang: null, quelle: null, gstNr: null, mengeKg: null, preisProKg: null, kmw: m.kmw, oechsle: m.oechsle, mostgewichtEinheit: m.einheit, qualitaet: null, gesundheit: null, herkunftscode: null, kaeufer: null, rechnungsnummer: null, notizen: null })
    const gemessen = []
    for (let h = 0; h <= KMW_MAX * 100; h++) gemessen.push(ausMessung(h / 100, 'kmw'))             // 2-stellige °KMW-Messungen
    for (let z = 0; z <= OECHSLE_MAX * 10; z++) gemessen.push(ausMessung(z / 10, 'oechsle'))      // °Oe-Messungen (°KMW nach B)
    const spalte = tv.SPALTEN_TRAUBENVERKAUF_LISTE.find(s => s.kopf === 'Mostgewicht (°KMW)')
    const gekippt = gemessen.filter(m => kmwZuQualitaet(spalte.wert(zeile(m))) !== kmwZuQualitaet(m.kmw))
    assert.deepEqual(gekippt, [])
    assert.deepEqual(tv.traubenverkaufListenHinweise(gemessen.map(zeile)), [])
    // an den Schwellen: abgerundet, nie aufgerundet
    assert.equal(spalte.wert(zeile(ausMessung(16.99, 'kmw'))), 16.9)
    assert.equal(kmwZuQualitaet(16.9), 'qualitaetswein')
    assert.equal(spalte.wert(zeile(ausMessung(17.09, 'kmw'))), 17)
    assert.equal(spalte.wert(zeile(ausMessung(94, 'oechsle'))), 18.9)                          // 18,97 °KMW
    assert.equal(abrunden(18.97, 1), 18.9)
  })
})

// ── Register und Katalog ────────────────────────────────────────────────────

describe('Register „Ernte & Lese“', () => {
  test('Register ↔ Katalog, Zugriff Betriebsleitung, BKI-Profil', () => {
    assert.deepEqual(Object.keys(MELDUNGEN_ERNTE).sort(), Object.keys(KATALOG_ERNTE).sort())
    for (const m of Object.values(MELDUNGEN_ERNTE)) {
      assert.equal(m.zugriff, 'betriebsleitung', m.id)
      assert.equal(m.pflicht, true, m.id)
      assert.ok(m.druckPfad?.startsWith('/'), m.id)
    }
    assert.equal(MELDUNGEN_ERNTE['bki-traubenverkauf'].profil, csv.PROFIL_BKI)
    assert.equal(MELDUNGEN_ERNTE.erntemeldung.profil, undefined)
  })

  test('Parameter wie die Druckseite; Fehler → 400', () => {
    const sp = q => new URLSearchParams(q)
    assert.deepEqual(MELDUNGEN_ERNTE.erntemeldung.parameter(sp('jahrgang=2026')), { jahrgang: 2026 })
    for (const q of ['', 'jahrgang=', 'jahrgang=26', 'jahrgang=2026abc', 'jahrgang=1850', 'jahrgang=%3DSUM(1)']) {
      assert.ok(istParameterFehler(MELDUNGEN_ERNTE.lesedaten.parameter(sp(q))), q)
    }
    assert.deepEqual(MELDUNGEN_ERNTE['bki-traubenverkauf'].parameter(sp('')), { jahrgang: null })
    assert.deepEqual(MELDUNGEN_ERNTE['bki-traubenverkauf'].parameter(sp('jahrgang=2025')), { jahrgang: 2025 })
    assert.ok(istParameterFehler(MELDUNGEN_ERNTE['bki-traubenverkauf'].parameter(sp('jahrgang=abc'))))
    assert.ok(istParameterFehler(MELDUNGEN_ERNTE.bestandsmeldung.parameter(sp('stichtag=2026-07-31'))))
    assert.match(MELDUNGEN_ERNTE.bestandsmeldung.parameter(sp('')).bestandAm, /^\d{4}-\d{2}-\d{2}$/)
  })

  test('Dateinamen: Betriebsnummer, Jahrgang bzw. „kein Stichtagsbestand“', () => {
    const b = { name: 'Weingut Muster', betriebsnummer: '9988776' }
    const n = m => csv.csvDateiname(m.dateiteile(m.parameter(new URLSearchParams('jahrgang=2026')), b), '2026-09-24')
    assert.equal(n(MELDUNGEN_ERNTE.erntemeldung).ascii, 'Erntemeldung_9988776_2026_2026-09-24.csv')
    assert.equal(n(MELDUNGEN_ERNTE.lesedaten).ascii, 'Lesedaten_9988776_2026_2026-09-24.csv')
    assert.equal(n(MELDUNGEN_ERNTE['bki-traubenverkauf']).ascii, 'BKI_Traubenverkauf_9988776_2026_2026-09-24.csv')
    const bsm = MELDUNGEN_ERNTE.bestandsmeldung
    assert.equal(csv.csvDateiname(bsm.dateiteile({ bestandAm: '2026-09-24' }, b), '2026-09-24').ascii,
      'Weinbestand_9988776_Bestand-am-2026-09-24-kein-Stichtagsbestand_2026-09-24.csv')
    const alle = MELDUNGEN_ERNTE['bki-traubenverkauf']
    assert.equal(csv.csvDateiname(alle.dateiteile({ jahrgang: null }, b), '2026-09-24').utf8, 'BKI_Traubenverkauf_9988776_alle-Jahrgänge_2026-09-24.csv')
  })

  test('Register-Laden über den Kontext der Route (Leermeldung für einen Jahrgang ohne Lese)', async () => {
    const db = supabaseDoppel(TABELLEN_ERNTE)
    const ctx = { supabase: db, tenantId: T, membership: { tenantId: T, role: 'winzer', schreibmodule: [] }, betrieb: { name: null, betriebsnummer: null } }
    const e = await MELDUNGEN_ERNTE.erntemeldung.laden(ctx, { jahrgang: 2025 })
    assert.equal(e.zeilen.length, 1)
    const l = await MELDUNGEN_ERNTE.lesedaten.laden(ctx, { jahrgang: 2026 })
    assert.equal(l.zeilen.length, 4)
    // Jahrgang nicht angelegt (z. B. Totalausfall): Leermeldung mit Hinweis statt HTTP 400
    for (const m of [MELDUNGEN_ERNTE.lesedaten, MELDUNGEN_ERNTE.erntemeldung]) {
      const leer = await m.laden(ctx, { jahrgang: 2031 })
      assert.equal(leer.zeilen.length, 0, m.id)
      assert.match(leer.warnungen[0], /Den Jahrgang 2031 gibt es in diesem Betrieb nicht .* Leermeldung/)
      assert.equal(csv.csvDatei(leer.zeilen, m.spalten).text.split('\r\n').length, 2)
    }
    mandantengefiltert(db)
  })
})
