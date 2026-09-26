// Tests der Behördenmeldungen „Weinverkehr & Export“ (Transportbescheinigung, Prüfnummernantrag,
// DAC-Anträge, Weinexport) – ohne Datenbank (24.09.2026)
//
// Aufruf:  node --experimental-strip-types --disable-warning=ExperimentalWarning --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test scripts/tests/verkehr.test.mjs
//          (Node ≥ 22.15 wegen module.registerHooks; keine zusätzliche Abhängigkeit)
//
// Die Ladefunktionen in src/lib/behoerden/*.ts importieren über den Alias '@/…'. Ein
// Auflösungs-Hook (module.registerHooks) bildet '@/…' auf src/… ab, ergänzt '.ts' bei
// relativen Importen und ersetzt 'server-only' durch ein leeres Modul. Supabase wird durch
// einen kleinen Fake-Client ersetzt, der eq/in/gte/lte filtert und jede Abfrage mitschreibt
// (so lässt sich auch der Mandantenfilter .eq('tenant_id', …) prüfen).

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { existsSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'

const HIER = path.dirname(fileURLToPath(import.meta.url))
const SRC = path.resolve(HIER, '../../src')

function tsDatei(basis) {
  for (const k of [basis, `${basis}.ts`, `${basis}.tsx`, path.join(basis, 'index.ts')]) {
    if (existsSync(k) && !k.endsWith(path.sep) && path.extname(k)) return k
  }
  return null
}

registerHooks({
  resolve(spezifizierer, kontext, weiter) {
    if (spezifizierer === 'server-only') return { url: 'data:text/javascript,export {}', shortCircuit: true }
    if (spezifizierer.startsWith('@/')) {
      const datei = tsDatei(path.join(SRC, spezifizierer.slice(2)))
      if (datei) return { url: pathToFileURL(datei).href, shortCircuit: true }
    }
    if ((spezifizierer.startsWith('./') || spezifizierer.startsWith('../')) && kontext.parentURL?.startsWith('file:') && !path.extname(spezifizierer)) {
      const datei = tsDatei(path.resolve(path.dirname(fileURLToPath(kontext.parentURL)), spezifizierer))
      if (datei) return { url: pathToFileURL(datei).href, shortCircuit: true }
    }
    return weiter(spezifizierer, kontext)
  },
})

const csv = await import('../../src/lib/csv/index.ts')
const hilfen = await import('../../src/lib/behoerden/verkehr-hilfen.ts')
const tb = await import('../../src/lib/behoerden/transportbescheinigung.ts')
const pna = await import('../../src/lib/behoerden/pruefnummernantrag.ts')
const dac = await import('../../src/lib/behoerden/dac.ts')
const exp = await import('../../src/lib/behoerden/exportauftrag.ts')
const { KATALOG_VERKEHR } = await import('../../src/lib/behoerden/katalog/verkehr.ts')
const { MELDUNGEN_VERKEHR } = await import('../../src/lib/behoerden/register/verkehr.ts')
const { istParameterFehler, MeldungsFehler } = await import('../../src/lib/behoerden/typen.ts')

const { csvDatei, csvDateiname, PROFIL_EXCEL_AT } = csv
const BOM = '\uFEFF'
const T = '11111111-1111-4111-8111-111111111111'        // eigener Betrieb
const FREMD = '99999999-9999-4999-8999-999999999999'    // anderer Betrieb derselben Person

// ── Fake-Supabase ────────────────────────────────────────────────────────────

function fakeSupabase(tabellen) {
  const abfragen = []
  return {
    abfragen,
    from(tabelle) {
      const a = { tabelle, filter: [], select: null }
      abfragen.push(a)
      const zeilen = () => (tabellen[tabelle] ?? []).filter(z => a.filter.every(f => f(z)))
      const b = {
        select(s) { a.select = s; return b },
        eq(k, v) { a.filter.push(z => !(k in z) || z[k] === v); a.eq = { ...(a.eq ?? {}), [k]: v }; return b },
        in(k, liste) { a.filter.push(z => !(k in z) || liste.includes(z[k])); return b },
        gte(k, v) { a.filter.push(z => z[k] >= v); return b },
        lte(k, v) { a.filter.push(z => z[k] <= v); return b },
        not() { return b },
        is() { return b },
        order() { return b },
        limit() { return b },
        maybeSingle() { return Promise.resolve({ data: zeilen()[0] ?? null, error: null }) },
        single() { const z = zeilen()[0]; return Promise.resolve(z ? { data: z, error: null } : { data: null, error: { message: 'nicht gefunden' } }) },
        range(von, bis) { return Promise.resolve({ data: zeilen().slice(von, bis + 1), error: null }) },
        then(ok, fehler) { return Promise.resolve({ data: zeilen(), error: null }).then(ok, fehler) },
      }
      return b
    },
  }
}

/** Jede Abfrage auf eine mandantenbezogene Tabelle muss .eq('tenant_id', T) tragen */
function mandantGefiltert(sb, tabellen) {
  for (const a of sb.abfragen) {
    if (tabellen.includes(a.tabelle)) assert.equal(a.eq?.tenant_id, T, `Abfrage auf ${a.tabelle} ohne Mandantenfilter`)
  }
}

const zeilenVon = text => text.replace(/^\uFEFF/, '').split('\r\n')
/** Eine CSV-Zeile in Rohzellen (Anführungszeichen bleiben erhalten, ; in "…" trennt nicht) */
function rohzellen(linie) {
  const out = []
  let akt = '', inQuote = false
  for (const c of linie) {
    if (c === '"') inQuote = !inQuote
    if (c === ';' && !inQuote) { out.push(akt); akt = ''; continue }
    akt += c
  }
  out.push(akt)
  return out
}
const zelle = (text, zeile, kopf) => {
  const z = zeilenVon(text)
  const i = rohzellen(z[0]).indexOf(kopf)
  assert.ok(i >= 0, `Spalte „${kopf}“ fehlt`)
  const zellen = rohzellen(z[zeile])
  assert.equal(zellen.length, rohzellen(z[0]).length, `Zeile ${zeile}: Spaltenzahl weicht vom Kopf ab`)
  return zellen[i]
}

// ── Testdaten ────────────────────────────────────────────────────────────────

const CFG = { tenant_id: T, betrieb_name: 'Weingut Muster', betrieb_strasse: 'Kellergasse 12', betrieb_plz: '2170', betrieb_ort: 'Poysdorf', betrieb_telefon: '+43 2552 123', betrieb_betriebsnummer: '1234567', betrieb_email: 'office@muster.at', betrieb_uid: 'ATU12345678' }

const POSTEN_ID = '22222222-2222-4222-8222-222222222222'
const WA1 = 'aaaaaaaa-0000-4000-8000-000000000001'
// KAN-72: Prüfnummer der Charge nur aus einem genehmigten, aktiven Antrag ohne Zugang seit der Einreichung
const DAC_WA1 = { id: 'dac-wa1', tenant_id: T, weinausbau_id: WA1, status: 'genehmigt', aktiv: true, pruefnummer: 'N 1234/25', menge_liter: '5000', eingereicht_am: '2026-03-01', bescheid_am: '2026-04-01', created_at: '2026-03-01T08:00:00+00:00' }
const PN_WA1 = {
  chargeId: WA1, bestandLiter: 2000, bestandAm: '2026-09-24', zugaenge: [], abfuellungen: [],
  antraege: [{ id: 'dac-wa1', weinausbauId: WA1, status: 'genehmigt', aktiv: true, pruefnummer: 'N 1234/25', mengeLiter: 5000, eingereichtAm: '2026-03-01', bescheidAm: '2026-04-01', angelegtAm: '2026-03-01' }],
}
const POSTEN = {
  id: POSTEN_ID, tenant_id: T, aktiv: true, rechnungsnummer: 'RE-2026-0042', datum: '2026-09-10', storniert: false,
  kontakt: null,
  firma: { name: 'Heuriger Huber; Wien', telefon: '01 234', strasse: 'Hauptstraße 5a', plz: '1190', ort: 'Wien', betrieb_nr: '7654321' },
  positionen: [
    { id: 'p1', typ: 'tank', name: 'ZW Tank', menge: 1500.5, einheit: 'l', weinausbau: { id: WA1, name: 'ZW 2025', jahrgang: 2025, qualitaetsstufe: 'Qualitätswein', rebsorte: 'Zweigelt', weinart: 'rot' } },
    { id: 'p2', typ: 'flasche', name: 'GV Klassik', menge: 7, einheit: 'Stk', fuellung: { id: 'f1', name: 'GV', jahrgang: 2025, qualitaet: 'Qualitätswein', rebsorte: 'Grüner Veltliner', anbaugebiet: 'Weinviertel', flaschengroesse_ml: 375, pruefnummer: null, dac_antrag_id: 'dac-f1' } },
    { id: 'p3', typ: 'trauben', name: 'Trauben', menge: 1200, einheit: 'kg', traubenverkauf: { id: 't1', datum: '2026-09-10', kmw_grad: 18.5, qualitaetsstufe: 'Qualitätswein', herkunft_code: 'WV', grundstueck: { rebsorte: 'Blaufränkisch' } } },
    { id: 'p4', typ: 'sonstiges', name: 'Karton', menge: 1 },
  ],
}

// ── Hilfen ───────────────────────────────────────────────────────────────────

describe('verkehr-hilfen', () => {
  test('Zahlen aus Formularfeldern (zahlAus) mit Warnung bei Unlesbarem', () => {
    const w = []
    assert.equal(hilfen.zahlFeld('1.500,5', 'Menge', w), 1500.5)
    assert.equal(hilfen.zahlFeld('12.5', 'Menge', w), 12.5)
    assert.equal(hilfen.zahlFeld('', 'Menge', w), null)
    assert.deepEqual(w, [])
    assert.equal(hilfen.zahlFeld('=1+1', 'Position 1: Menge', w), null)
    assert.match(w[0], /Position 1: Menge: „=1\+1“ ist keine Zahl/)
  })
  test('Datum aus Tag/Monat/Jahr und aus „TT/MM/JJJJ“', () => {
    const w = []
    assert.equal(hilfen.datumAusTeilen('5', '3', '2026', 'Lieferung', w), '2026-03-05')
    assert.equal(hilfen.datumAusTeilen('', '', '', 'Lieferung', w), null)
    assert.equal(hilfen.datumAusEingabe('05/03/2026', 'Eingang', w), '2026-03-05')
    assert.equal(hilfen.datumAusEingabe('2026-03-05', 'Eingang', w), '2026-03-05')
    assert.deepEqual(w, [])
    assert.equal(hilfen.datumAusTeilen('31', '2', '2026', 'Lieferung', w), null)
    assert.equal(hilfen.datumAusEingabe('morgen', 'Eingang', w), null)
    assert.equal(w.length, 2)
  })
  test('Formularzahl mit Dezimalkomma, ohne Tausenderpunkt, gerundet', () => {
    assert.equal(hilfen.formularZahl(2.625), '2,63')
    assert.equal(hilfen.formularZahl(1500), '1500')
    assert.equal(hilfen.formularZahl(4.5), '4,5')
    assert.equal(hilfen.formularZahl(null), '')
  })
  test('Straße und Hausnummer', () => {
    assert.deepEqual(hilfen.strasseTeilen('Kellergasse 12'), { strasse: 'Kellergasse', hausnr: '12' })
    assert.deepEqual(hilfen.strasseTeilen('Kellergasse'), { strasse: 'Kellergasse', hausnr: '' })
    assert.equal(hilfen.istDatum('2026-02-29'), false)
    assert.equal(hilfen.istDatum('2028-02-29'), true)
  })
})

// ── Transportbescheinigung ───────────────────────────────────────────────────

describe('transportbescheinigung', () => {
  test('Vorbelegung: Farbe aus Weinart/Rebsorte, Prüfnummer der Füllung, Trauben in kg mit KMW', () => {
    const hinweise = []
    const DAC_F1 = { id: 'dac-f1', weinausbauId: null, status: 'genehmigt', aktiv: true, pruefnummer: 'N 5678/25', mengeLiter: null, eingereichtAm: null, bescheidAm: null, angelegtAm: null }
    const f = tb.tbVorbelegung(POSTEN, CFG, { jeWeinausbau: { [WA1]: PN_WA1 }, jeDacAntrag: { 'dac-f1': DAC_F1 } }, '2026-09-24', hinweise)
    assert.equal(f.positionen.length, 3)                          // „sonstiges“ braucht keine TB
    const [tank, flasche, trauben] = f.positionen
    assert.equal(tank.art, 'Rot')                                 // bisher fix „Weiß“
    assert.equal(tank.menge_liter, '1500,5')
    assert.equal(tank.pruefnummer, 'N 1234/25')
    assert.equal(flasche.art, 'Weiß')
    assert.equal(flasche.menge_liter, '2,63')                     // 7 × 0,375 l
    assert.equal(flasche.pruefnummer, 'N 5678/25')                // bisher leer
    assert.equal(trauben.art, 'Rot')
    assert.equal(trauben.einheit, 'kg')
    assert.equal(trauben.jahrgang, '2026')
    assert.equal(trauben.alkohol_pct, '18,5 °KMW')
    assert.equal(f.anreicherung, undefined)
    assert.equal(tank.anreicherung, 'N')
    assert.equal(f.e_betriebsnummer, '7654321')
    assert.equal(f.v_strasse, 'Kellergasse')
    assert.equal(f.v_hausnr, '12')
    assert.deepEqual([f.datum_tag, f.datum_monat, f.datum_jahr], ['24', '09', '2026'])
    assert.deepEqual(hinweise, [])
  })

  test('KAN-128: °KMW der Traubenlieferung auf 1 Stelle abgerundet (94 °Oe = 18,97 °KMW → „18,9“, nicht „19,0“)', () => {
    const trauben = (kmw_grad) => ({ id: 'q', typ: 'trauben', menge: 100, traubenverkauf: { id: 't', datum: '2026-09-10', kmw_grad, grundstueck: { rebsorte: 'Zweigelt' } } })
    const posten = { ...POSTEN, positionen: [trauben(18.97), trauben(18.95), trauben(19), trauben(null)] }
    const pos = tb.tbVorbelegung(posten, CFG, { jeWeinausbau: {}, jeDacAntrag: {} }, '2026-09-24', []).positionen
    assert.deepEqual(pos.map(p => p.alkohol_pct), ['18,9 °KMW', '18,9 °KMW', '19 °KMW', ''])   // Formblatt ohne Nachkomma-Null wie bisher
  })

  test('Farbe nur aus der amtlichen Kürzelliste; Traubensorte über Grundstück → Ried → Zukauf; kein Ersatzkürzel', () => {
    const posten = {
      ...POSTEN,
      positionen: [
        // Rosenmuskateller: Kürzel RM, Farbe laut Liste nicht eindeutig → „Weiß“ nur mit Hinweis
        { id: 'q1', typ: 'trauben', menge: 100, traubenverkauf: { id: 't1', datum: '2026-09-10', grundstueck: { rebsorte: 'Rosenmuskateller' } } },
        // kein Grundstück: Rebsorte vom Ried
        { id: 'q2', typ: 'trauben', menge: 200, traubenverkauf: { id: 't2', datum: '2026-09-11', grundstueck: null, weingarten: { rebsorte: 'Zweigelt' } } },
        // Zukauf ohne amtliches Kürzel: Sorte ohne Fantasiekürzel
        { id: 'q3', typ: 'trauben', menge: 300, traubenverkauf: { id: 't3', datum: '2026-09-12', grundstueck: null, weingarten: null, zukauf: { rebsorte: 'Uhudler' } } },
      ],
    }
    const hinweise = []
    const [rm, zw, uh] = tb.tbVorbelegung(posten, CFG, { jeWeinausbau: {}, jeDacAntrag: {} }, '2026-09-24', hinweise).positionen
    assert.deepEqual([rm.art, rm.traubensorte], ['Weiß', 'Rosenmuskateller (RM)'])
    assert.deepEqual([zw.art, zw.traubensorte], ['Rot', 'Zweigelt (ZW)'])           // früher leer und „Weiß“
    assert.deepEqual([uh.art, uh.traubensorte], ['Weiß', 'Uhudler'])                // früher „Uhudler (UHUD)“
    assert.equal(hinweise.length, 2)
    assert.match(hinweise[0], /^Position 1: Farbe .* nicht bestimmbar \(Rebsorte „Rosenmuskateller“ hat laut BKI-Kürzelliste keine eindeutige Farbe\) – „Weiß“ vorbelegt, bitte prüfen$/)
    assert.match(hinweise[1], /^Position 3: .*„Uhudler“/)
  })

  test('CSV: eine Zeile je Weinposition, Kopf in jeder Zeile, Formularstand gekennzeichnet', () => {
    const w = []
    const f = tb.tbVorbelegung(POSTEN, CFG, { jeWeinausbau: {}, jeDacAntrag: {} }, '2026-09-24', w)
    const zeilen = tb.tbZeilen(f, { verkaufspostenId: POSTEN_ID, rechnungsnummer: 'RE-2026-0042', verkaufsdatum: '2026-09-10', gespeichert: false, gespeichertAm: null, einheitStandard: null }, w)
    const d = csvDatei(zeilen, tb.SPALTEN_TRANSPORTBESCHEINIGUNG, PROFIL_EXCEL_AT)
    assert.ok(d.text.startsWith(BOM))
    assert.ok(d.text.endsWith('\r\n'))
    assert.equal(d.zeilen, 3)
    const z = zeilenVon(d.text)
    assert.equal(z.length, 5)                                     // Kopf + 3 + leeres Ende
    assert.equal(z[0].split(';').length, tb.SPALTEN_TRANSPORTBESCHEINIGUNG.length)
    assert.equal(zelle(d.text, 1, 'Formularstand'), 'nicht gespeicherte Vorbelegung')
    assert.equal(zelle(d.text, 1, 'Datum der Lieferung'), '24.09.2026')
    assert.equal(zelle(d.text, 1, 'Verkaufsdatum'), '10.09.2026')
    assert.equal(zelle(d.text, 1, 'Menge (Liter/kg)'), '1500,50')
    assert.equal(zelle(d.text, 2, 'Menge (Liter/kg)'), '2,63')
    assert.equal(zelle(d.text, 3, 'Einheit'), 'kg')
    assert.equal(zelle(d.text, 1, 'Art (Rot/Weiß/Rosé)'), 'Rot')
    assert.equal(zelle(d.text, 1, 'Angereichert'), 'Nein')
    assert.equal(zelle(d.text, 3, 'Alkohol (% vol) / KMW (°)'), '18,5 °KMW')
    assert.equal(zelle(d.text, 1, 'Empfänger Betriebsnummer'), '7654321')
    assert.match(z[1], /"Heuriger Huber; Wien"/)                  // Trenner im Text → gequotet
    assert.deepEqual(d.warnungen, [])
  })

  test('Formelschutz und Zahlprüfung bei gespeicherten Formularen, leere Positionen entfallen', () => {
    const w = []
    const f = {
      laufende_nr: '17', jahr: '2026', datum_tag: '1', datum_monat: '10', datum_jahr: '2026', uhrzeit: '08:30',
      e_name: '=HYPERLINK("http://x")', v_name: '+43 Test',
      positionen: [
        { ...tb.TB_LEERE_POSITION, menge_liter: '=1+1', traubensorte: 'Zweigelt (ZW)', anreicherung: 'J', fremd_sorten_pct: '10,5' },
        { ...tb.TB_LEERE_POSITION },
        { ...tb.TB_LEERE_POSITION, menge_liter: '300', einheit: undefined, jahrgang: '2025', anreicherung: 'x' },
      ],
    }
    const zeilen = tb.tbZeilen(f, { verkaufspostenId: POSTEN_ID, rechnungsnummer: null, verkaufsdatum: null, gespeichert: true, gespeichertAm: '2026-09-24T21:30:00+00:00', einheitStandard: null }, w)
    assert.equal(zeilen.length, 2)
    assert.deepEqual(zeilen.map(z => z.position), [1, 3])        // Positionsnummer wie im Formular
    const d = csvDatei(zeilen, tb.SPALTEN_TRANSPORTBESCHEINIGUNG)
    assert.equal(zelle(d.text, 1, 'Empfänger Firmen- oder Familienname'), `"'=HYPERLINK(""http://x"")"`)
    assert.equal(zelle(d.text, 1, 'Versender Firmen- oder Familienname'), "'+43 Test")
    assert.equal(zelle(d.text, 1, 'Menge (Liter/kg)'), '')
    assert.equal(zelle(d.text, 1, 'Angereichert'), 'Ja')
    assert.equal(zelle(d.text, 1, 'Fremdsortenanteil (%)'), '10,50')
    assert.equal(zelle(d.text, 1, 'Gespeichert am'), '24.09.2026 23:30')   // Wiener Sommerzeit
    assert.equal(zelle(d.text, 1, 'Datum der Lieferung'), '01.10.2026')
    assert.equal(zelle(d.text, 2, 'Einheit'), '')
    assert.ok(w.some(x => /Position 1: Menge: „=1\+1“ ist keine Zahl/.test(x)))
    assert.ok(w.some(x => /Position 3: Angereichert/.test(x)))
    assert.ok(w.some(x => /1 leere Weinposition nicht ausgegeben/.test(x)))
    assert.ok(w.some(x => /1 Position ohne Einheit/.test(x)))
  })

  test('Leermeldung: gespeichertes Formular ohne Weinposition → nur Kopfzeile', () => {
    const w = []
    const zeilen = tb.tbZeilen({ positionen: [] }, { verkaufspostenId: POSTEN_ID, rechnungsnummer: null, verkaufsdatum: null, gespeichert: true, gespeichertAm: null, einheitStandard: 'l' }, w)
    const d = csvDatei(zeilen, tb.SPALTEN_TRANSPORTBESCHEINIGUNG)
    assert.equal(d.zeilen, 0)
    assert.equal(zeilenVon(d.text).length, 2)
    assert.ok(w.some(x => /keine Weinposition ausgefüllt/.test(x)))
  })

  test('Ladefunktion: Vorbelegung mit Warnung, Mandantenfilter, fremder Betrieb und ungültige id → null', async () => {
    const sb = fakeSupabase({
      verkaufsposten: [POSTEN, { ...POSTEN, id: '33333333-3333-4333-8333-333333333333', tenant_id: FREMD }],
      tenant_einstellungen: [{ ...CFG, tenant_id: FREMD, betrieb_name: 'Fremd' }, CFG],
      transportbescheinigungen: [],
      dac_antrag: [DAC_WA1, { id: 'dac-f1', tenant_id: T, status: 'genehmigt', aktiv: true, pruefnummer: 'N 5678/25' }],
      weinausbau: [{ id: WA1, tenant_id: T, menge_liter: '2000' }],
    })
    const r = await tb.ladeTransportbescheinigung(sb, T, { id: POSTEN_ID })
    assert.ok(r)
    assert.equal(r.gespeichert, false)
    assert.equal(r.formular.v_name, 'Weingut Muster')
    assert.equal(r.zeilen.length, 3)
    assert.equal(r.zeilen[0].pruefnummer, 'N 1234/25')
    assert.equal(r.zeilen[1].pruefnummer, 'N 5678/25')
    assert.match(r.warnungen[0], /nicht gespeicherte Vorbelegung/)
    mandantGefiltert(sb, ['verkaufsposten', 'tenant_einstellungen', 'transportbescheinigungen', 'dac_antrag', 'weinausbau', 'verschneidungen', 'zukauf_posten', 'keller_umzuege', 'fuellungen', 'fuellung_chargen'])
    assert.ok(sb.abfragen.some(x => x.tabelle === 'verschneidungen'))   // KAN-72: Zugänge der Charge geprüft
    assert.equal(await tb.ladeTransportbescheinigung(sb, T, { id: '33333333-3333-4333-8333-333333333333' }), null)
    assert.equal(await tb.ladeTransportbescheinigung(sb, T, { id: 'abc' }), null)
  })

  test('Ladefunktion: gespeichertes Formular hat Vorrang (keine Vorbelegungs-Warnung)', async () => {
    const gespeichert = { ...tb.tbVorbelegung(POSTEN, CFG, { jeWeinausbau: {}, jeDacAntrag: {} }, '2026-09-20', []), laufende_nr: '5' }
    const sb = fakeSupabase({
      verkaufsposten: [POSTEN], tenant_einstellungen: [CFG], dac_antrag: [],
      transportbescheinigungen: [{ tenant_id: T, verkaufsposten_id: POSTEN_ID, formular_daten: gespeichert, erstellt_am: '2026-09-20T08:00:00Z', aktualisiert_am: '2026-09-21T08:00:00Z' }],
    })
    const r = await tb.ladeTransportbescheinigung(sb, T, { id: POSTEN_ID })
    assert.equal(r.gespeichert, true)
    assert.equal(r.gespeichertAm, '2026-09-21T08:00:00Z')
    assert.equal(r.zeilen[0].formularstand, 'gespeichert')
    assert.equal(r.zeilen[0].laufendeNr, '5')
    assert.deepEqual(r.warnungen, [])
    assert.ok(!sb.abfragen.some(a => a.tabelle === 'dac_antrag'))   // Prüfnummern nur für die Vorbelegung
  })

  test('Zeitraumliste: nur TB-pflichtige, nicht stornierte Verkäufe im Zeitraum', async () => {
    const storno = { ...POSTEN, id: '44444444-4444-4444-8444-444444444444', rechnungsnummer: 'RE-2026-0043', storniert: true }
    const nurKarton = { ...POSTEN, id: '55555555-5555-4555-8555-555555555555', rechnungsnummer: 'RE-2026-0044', positionen: [POSTEN.positionen[3]] }
    const spaeter = { ...POSTEN, id: '66666666-6666-4666-8666-666666666666', datum: '2026-10-02' }
    const sb = fakeSupabase({
      verkaufsposten: [POSTEN, storno, nurKarton, spaeter], tenant_einstellungen: [CFG], dac_antrag: [], transportbescheinigungen: [],
    })
    const r = await tb.ladeTransportbescheinigungen(sb, T, { von: '2026-09-01', bis: '2026-09-30' })
    assert.equal(new Set(r.zeilen.map(z => z.verkaufspostenId)).size, 1)
    assert.equal(r.zeilen.length, 3)
    assert.match(r.warnungen[0], /1 von 1 Transportbescheinigungen sind nicht gespeichert.*RE-2026-0042/)
    assert.ok(r.warnungen.some(x => /1 stornierter Verkaufsposten nicht enthalten/.test(x)))
    mandantGefiltert(sb, ['verkaufsposten', 'tenant_einstellungen', 'transportbescheinigungen', 'dac_antrag'])

    // Filter „nur gespeicherte“: Vorbelegungen entfallen (mit Hinweis) → Leermeldung
    const nur = await tb.ladeTransportbescheinigungen(sb, T, { von: '2026-09-01', bis: '2026-09-30', nurGespeichert: true })
    assert.equal(nur.zeilen.length, 0)
    assert.ok(nur.warnungen.some(x => /1 Verkauf ohne gespeicherte Transportbescheinigung ausgeblendet/.test(x)))
    assert.equal(csvDatei(nur.zeilen, tb.SPALTEN_TRANSPORTBESCHEINIGUNG).zeilen, 0)
  })
})

// ── Prüfnummernantrag ────────────────────────────────────────────────────────

describe('pruefnummernantrag', () => {
  const DAC_ID = '77777777-7777-4777-8777-777777777777'
  const DAC = { id: DAC_ID, tenant_id: T, bezeichnung: 'GV Ried Hölle 2025', dac_region: 'weinviertel', jahrgang: 2025, rebsorte: 'Grüner Veltliner', menge_liter: 2400.4, weinausbau_id: null }

  test('Vorbelegung wie bisher, Kopffelder in jeder Zeile, eine Zeile je Mostcharge', () => {
    const f = pna.pnaVorbelegung(DAC, CFG)
    assert.equal(f.einreichmenge, '2400')
    assert.equal(f.rebsorte, 'Grüner Veltliner (GV)')
    assert.equal(f.qualitaetsstufe, 'weinviertel')
    assert.equal(f.mostchargen.length, 3)
    const w = []
    const ohne = pna.pnaZeilen(f, { dacBezeichnung: DAC.bezeichnung, gespeichert: false, gespeichertAm: null }, w)
    assert.equal(ohne.length, 1)                                  // ohne Mostcharge genau eine Zeile
    assert.equal(ohne[0].mostchargeNr, null)
    const mit = pna.pnaZeilen({ ...f, eingangsdatum: '05/03/2026', angereichert: true, mostchargen: [
      { betriebsnummer: '1234567', laufende_nr: '0042', jahr: '2025', teilmenge: '1.200,5' },
      { betriebsnummer: '', laufende_nr: '', jahr: '', teilmenge: '' },
      { betriebsnummer: '1234567', laufende_nr: '0043', jahr: '2025', teilmenge: '800' },
    ] }, { dacBezeichnung: DAC.bezeichnung, gespeichert: true, gespeichertAm: null }, w)
    assert.deepEqual(mit.map(z => z.mostchargeNr), [1, 3])
    const d = csvDatei(mit, pna.SPALTEN_PRUEFNUMMERNANTRAG)
    assert.equal(zelle(d.text, 1, 'Mostcharge Laufende Nummer'), '0042')   // Code bleibt unverändert
    assert.equal(zelle(d.text, 1, 'Mostcharge Teilmenge (l)'), '1200,50')
    assert.equal(zelle(d.text, 2, 'Mostcharge Teilmenge (l)'), '800,00')
    assert.equal(zelle(d.text, 1, 'Eingangsdatum'), '05.03.2026')
    assert.equal(zelle(d.text, 1, 'Angereichert'), 'Ja')
    assert.equal(zelle(d.text, 2, 'Gesüßt'), 'Nein')
    assert.equal(zelle(d.text, 1, 'Einreichmenge (l)'), '2400,00')
    assert.equal(zelle(d.text, 2, 'Betriebsnummer'), '1234567')
    assert.equal(zelle(d.text, 1, 'Formularstand'), 'gespeichert')
    assert.deepEqual(w, [])
  })

  test('Ladefunktion: Vorbelegung gekennzeichnet, Mandantenfilter, nicht gefunden → null', async () => {
    const sb = fakeSupabase({ dac_antrag: [DAC], tenant_einstellungen: [CFG], pruefnummernantraege: [] })
    const r = await pna.ladePruefnummernantrag(sb, T, { id: DAC_ID })
    assert.equal(r.gespeichert, false)
    assert.equal(r.zeilen.length, 1)
    assert.equal(r.zeilen[0].formularstand, 'nicht gespeicherte Vorbelegung')
    assert.match(r.warnungen[0], /nicht gespeicherte Vorbelegung/)
    mandantGefiltert(sb, ['dac_antrag', 'tenant_einstellungen', 'pruefnummernantraege'])
    assert.equal(await pna.ladePruefnummernantrag(sb, FREMD, { id: DAC_ID }), null)
  })
})

// ── DAC-Anträge ──────────────────────────────────────────────────────────────

describe('dac-antraege', () => {
  test('Liste mit Labels, gerundeten Zahlen und DATE ohne Verschiebung', async () => {
    const sb = fakeSupabase({ dac_antrag: [
      { id: 'a', tenant_id: T, bezeichnung: 'ZW Reserve', dac_region: 'carnuntum', jahrgang: 2024, rebsorte: 'Zweigelt', menge_liter: '1500.005', alkohol_prozent: 13.5, status: 'genehmigt', pruefnummer: 'N 1/24', eingereicht_am: '2025-03-01', bescheid_am: '2025-04-15', aktiv: true },
      { id: 'b', tenant_id: T, bezeichnung: 'Entwurf', dac_region: 'unbekannt_neu', jahrgang: null, rebsorte: null, menge_liter: null, alkohol_prozent: null, status: 'entwurf', pruefnummer: null, eingereicht_am: null, bescheid_am: null, aktiv: false },
      { id: 'c', tenant_id: FREMD, bezeichnung: 'Fremd', status: 'entwurf', aktiv: true },
    ] })
    const { zeilen } = await dac.ladeDacAntraege(sb, T)
    mandantGefiltert(sb, ['dac_antrag'])
    assert.equal(zeilen.length, 2)
    const d = csvDatei(zeilen, dac.SPALTEN_DAC_ANTRAEGE)
    assert.equal(zeilenVon(d.text)[0], 'Bezeichnung;DAC-Region;Jahrgang;Rebsorte;Menge (l);Alkohol (% vol);Status;Eingereicht am;Staatliche Prüfnummer;Bescheid am;Aktiv')
    assert.equal(zeilenVon(d.text)[1], 'ZW Reserve;Carnuntum;2024;Zweigelt;1500,01;13,50;Genehmigt;01.03.2025;N 1/24;15.04.2025;Ja')
    assert.equal(zeilenVon(d.text)[2], 'Entwurf;unbekannt_neu;;;;;Entwurf;;;;Nein')
  })
})

// ── Weinexport ───────────────────────────────────────────────────────────────

describe('exportauftrag / exportauftraege', () => {
  const A_ID = '88888888-8888-4888-8888-888888888888'
  const AUFTRAG = { id: A_ID, tenant_id: T, aktiv: true, referenz: 'EXP-2026-001', datum: '2026-09-01', lieferdatum: '2026-09-15', incoterms: 'DAP', transport_art: 'LKW', destination_land: 'Schweiz', destination_stadt: 'Zürich', eori_kunde: 'CHE123456789', taric_code: '2204.21', ursprungsland: null, versicherungswert: 5000, status: 'bestaetigt', emcs_arc_nummer: '26AT000000000000001', emcs_status: 'submitted', emcs_datum: '2026-09-02', created_at: '2026-09-01T10:00:00Z', kontakte: null, firmen: { name: 'Vinothek Zürich AG' } }
  const POS = [
    { id: 'x1', exportauftrag_id: A_ID, beschreibung: null, menge: 120, einheit: 'Fl', preis_eur: 8.335, taric_code: '2204.21.79', sort_order: 1, fuellungen: { bezeichnung: 'GV Klassik 2025', flaschengroesse_ml: 750 } },
    { id: 'x2', exportauftrag_id: A_ID, beschreibung: 'Fassware', menge: 2.5, einheit: 'HL', preis_eur: 300, taric_code: null, sort_order: 2, fuellungen: null },
    { id: 'x3', exportauftrag_id: A_ID, beschreibung: 'Geschenkkisten', menge: 3, einheit: 'Kiste', preis_eur: 0.335, taric_code: null, sort_order: 3, fuellungen: null },
  ]
  const DOK = [
    { id: 'd1', exportauftrag_id: A_ID, dokument_art: 'v1v2', status: 'ausgestellt' },
    { id: 'd2', exportauftrag_id: A_ID, dokument_art: 'phytosanitaer', status: 'beantragt' },
    { id: 'd3', exportauftrag_id: A_ID, dokument_art: 'cmr', status: 'nicht_erforderlich' },
  ]

  test('Liter aus Einheit, Wert kaufmännisch gerundet, Summe aus gerundeten Werten', () => {
    assert.deepEqual(exp.literAus(120, 'Fl', 750), { liter: 90 })
    assert.deepEqual(exp.literAus(2.5, 'HL', null), { liter: 250 })
    assert.equal(exp.literAus(3, 'Kiste', null).liter, null)
    assert.equal(exp.literAus(3, 'Fl', null).liter, null)
    assert.equal(exp.positionsWert(3, 0.335), 1.01)                   // 1,005 → 1,01 (kaufmännisch)
    assert.equal(exp.positionsWert(120, 8.335), 1000.2)
    assert.equal(exp.summeGerundet([1000.2, 750, 1.01, null]), 1751.21)
  })

  test('Positionsliste: Ursprung AT, TARIC aus Auftrag als Rückfall, Warnung für Kiste', async () => {
    const sb = fakeSupabase({ exportauftraege: [AUFTRAG], exportauftrag_positionen: POS, export_dokumente: DOK, tenant_einstellungen: [CFG] })
    const r = await exp.ladeExportauftrag(sb, T, { id: A_ID })
    mandantGefiltert(sb, ['exportauftraege', 'tenant_einstellungen'])
    assert.equal(r.zeilen.length, 3)
    assert.equal(r.gesamtEur, 1751.21)
    const d = csvDatei(r.zeilen, exp.SPALTEN_EXPORTAUFTRAG)
    assert.equal(zelle(d.text, 1, 'Bezeichnung'), 'GV Klassik 2025')
    assert.equal(zelle(d.text, 1, 'Volumen (l)'), '90,00')
    assert.equal(zelle(d.text, 1, 'Wert (€)'), '1000,20')
    assert.equal(zelle(d.text, 1, 'Preis je Einheit (€)'), '8,34')
    assert.equal(zelle(d.text, 2, 'TARIC'), '2204.21')
    assert.equal(zelle(d.text, 2, 'Volumen (l)'), '250,00')
    assert.equal(zelle(d.text, 3, 'Volumen (l)'), '')
    assert.equal(zelle(d.text, 1, 'Ursprungsland'), 'AT')
    assert.equal(zelle(d.text, 1, 'EORI Importeur'), 'CHE123456789')
    assert.equal(zelle(d.text, 1, 'UID Versender'), 'ATU12345678')
    assert.match(r.warnungen[0], /EXP-2026-001: Volumen \(l\) leer gelassen – Pos\. 3: Einheit „Kiste“/)
    assert.equal(await exp.ladeExportauftrag(sb, FREMD, { id: A_ID }), null)
  })

  test('Auftragsliste mit Dokument- und EMCS-Status', async () => {
    const sb = fakeSupabase({
      exportauftraege: [AUFTRAG, { ...AUFTRAG, id: 'inaktiv', aktiv: false }, { ...AUFTRAG, id: 'fremd', tenant_id: FREMD }],
      exportauftrag_positionen: POS, export_dokumente: DOK,
    })
    const r = await exp.ladeExportauftraege(sb, T)
    mandantGefiltert(sb, ['exportauftraege'])
    assert.equal(r.zeilen.length, 1)
    const z = r.zeilen[0]
    assert.equal(z.warenwertEur, 1751.21)
    assert.equal(z.literGesamt, null)                                // Kiste nicht umrechenbar
    assert.equal(z.dokAusgestellt, 1)
    assert.equal(z.dokErforderlich, 2)
    const d = csvDatei(r.zeilen, exp.SPALTEN_EXPORTAUFTRAEGE)
    assert.equal(zelle(d.text, 1, 'Phytosanitäres Zertifikat'), 'Beantragt')
    assert.equal(zelle(d.text, 1, 'V1/V2 Begleitdokument'), 'Ausgestellt')
    assert.equal(zelle(d.text, 1, 'EUR.1 Ursprungszeugnis'), '')
    assert.equal(zelle(d.text, 1, 'EMCS-Status'), 'Eingereicht')
    assert.equal(zelle(d.text, 1, 'EMCS ARC-Nummer'), '26AT000000000000001')
    assert.equal(zelle(d.text, 1, 'Status'), 'Bestätigt')
    assert.equal(zelle(d.text, 1, 'Versicherungswert (€)'), '5000,00')
  })

  test('Leere Auftragsliste → Leermeldung nur mit Kopfzeile', async () => {
    const r = await exp.ladeExportauftraege(fakeSupabase({}), T)
    const d = csvDatei(r.zeilen, exp.SPALTEN_EXPORTAUFTRAEGE)
    assert.equal(d.zeilen, 0)
    assert.equal(d.text, BOM + zeilenVon(d.text)[0] + '\r\n')
  })
})

// ── Katalog und Register ─────────────────────────────────────────────────────

describe('Katalog und Register „verkehr“', () => {
  test('Register deckt genau den Katalog ab, Zugriff und Modul wie die Seiten', () => {
    assert.deepEqual(Object.keys(MELDUNGEN_VERKEHR).sort(), Object.keys(KATALOG_VERKEHR).sort())
    assert.deepEqual(Object.keys(KATALOG_VERKEHR).sort(), ['dac-antraege', 'exportauftraege', 'exportauftrag', 'pruefnummernantrag', 'transportbescheinigung', 'transportbescheinigungen'])
    for (const m of Object.values(MELDUNGEN_VERKEHR)) {
      assert.equal(m.gruppe, 'verkehr')
      assert.equal(m.zugriff, 'mitglied')
      assert.ok(m.druckPfad?.startsWith('/'))
      assert.ok(m.spalten.length > 0)
    }
    assert.equal(MELDUNGEN_VERKEHR.exportauftrag.modul, 'modul_export')
    assert.equal(MELDUNGEN_VERKEHR.exportauftraege.modul, 'modul_export')
    assert.equal(MELDUNGEN_VERKEHR.transportbescheinigung.modul, undefined)
  })

  test('Parameter: id als UUID, Zeitraum als DATE, Dateiname mit Beleg', () => {
    const m = MELDUNGEN_VERKEHR.transportbescheinigung
    assert.ok(istParameterFehler(m.parameter(new URLSearchParams('id=abc'))))
    const p = m.parameter(new URLSearchParams(`id=${POSTEN_ID}&beleg=RE-2026-0042`))
    assert.deepEqual(p, { id: POSTEN_ID, beleg: 'RE-2026-0042' })
    assert.equal(csvDateiname(m.dateiteile(p, { name: null, betriebsnummer: '1234567' }), '2026-09-24').utf8, 'Transportbescheinigung_1234567_RE-2026-0042_2026-09-24.csv')

    const z = MELDUNGEN_VERKEHR.transportbescheinigungen
    assert.ok(istParameterFehler(z.parameter(new URLSearchParams('von=2026-02-30&bis=2026-03-01'))))
    assert.ok(istParameterFehler(z.parameter(new URLSearchParams('von=2026-09-30&bis=2026-09-01'))))
    const pz = z.parameter(new URLSearchParams('von=2026-01-01&bis=2026-09-24'))
    assert.deepEqual(pz, { von: '2026-01-01', bis: '2026-09-24', nurGespeichert: false })
    assert.equal(csvDateiname(z.dateiteile(pz, { name: null, betriebsnummer: null }), '2026-09-24').ascii, 'Transportbescheinigungen_2026-01-01_bis_2026-09-24_2026-09-24.csv')
    const pg = z.parameter(new URLSearchParams('von=2026-01-01&bis=2026-09-24&nur=gespeichert'))
    assert.equal(pg.nurGespeichert, true)
    assert.equal(csvDateiname(z.dateiteile(pg, { name: null, betriebsnummer: '1234567' }), '2026-09-24').utf8, 'Transportbescheinigungen_1234567_2026-01-01_bis_2026-09-24_gespeichert_2026-09-24.csv')

    const pn = MELDUNGEN_VERKEHR.pruefnummernantrag
    const pp = pn.parameter(new URLSearchParams(`id=${POSTEN_ID}&bez=GV Ried Hölle`))
    const name = csvDateiname(pn.dateiteile(pp, { name: null, betriebsnummer: '1234567' }), '2026-09-24')
    assert.equal(name.utf8, 'Prüfnummernantrag_1234567_GV-Ried-Hölle_2026-09-24.csv')
    assert.equal(name.ascii, 'Pruefnummernantrag_1234567_GV-Ried-Hoelle_2026-09-24.csv')
  })

  test('Nicht gefunden → MeldungsFehler 404 (kein Systemfehler)', async () => {
    const ctx = { supabase: fakeSupabase({}), tenantId: T, membership: { tenantId: T, role: 'winzer', schreibmodule: [] }, betrieb: { name: null, betriebsnummer: null } }
    for (const [id, p] of [['transportbescheinigung', { id: POSTEN_ID }], ['pruefnummernantrag', { id: POSTEN_ID }], ['exportauftrag', { id: POSTEN_ID }]]) {
      await assert.rejects(MELDUNGEN_VERKEHR[id].laden(ctx, p), e => e instanceof MeldungsFehler && e.status === 404)
    }
    const leer = await MELDUNGEN_VERKEHR['dac-antraege'].laden(ctx, {})
    assert.deepEqual(leer.zeilen, [])
  })
})
