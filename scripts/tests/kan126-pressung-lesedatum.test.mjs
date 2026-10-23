// KAN-126 (29.09.2026) – Lesedatum und Mostgewicht je Pressungszeile
//
// Aufruf:  npm run -s test:csv   (alle scripts/tests/*.test.mjs)
//
// Geprüft: Lesetage je Ort (Ortsregel wie der Ersatz der Rückverfolgung), Vorbelegung, Prüfregel (Pflicht,
// nicht nach der Pressung, 01.01. des Jahrgangs bis 31.03. des Folgejahres) sowie die Verdrahtung in
// Formular, Server Action (Zukaufsdatum, Sync nur gleicher Lesetag, Traubenzeile n) und Blend-Protokoll.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const L = await import('../../src/lib/wein/pressungLesedatum.ts')
const quelle = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')

const e = (weingarten_id, grundstueck_id, ernte_datum, kmw = null, oechsle = null, mostgewicht_einheit = null) =>
  ({ weingarten_id, grundstueck_id, ernte_datum, kmw, oechsle, mostgewicht_einheit })

describe('lesetageFuerOrt', () => {
  const eintraege = [
    e('wg1', 'g1', '2026-09-20', 18.5, 90.1, 'kmw'),
    e('wg1', 'g1', '2026-09-20', 18.5, 90.1, 'kmw'),     // zweite Zeile desselben Tages, gleiches Mostgewicht
    e('wg1', 'g2', '2026-09-22', 19, 92.9, 'kmw'),
    e('wg1', null, '2026-09-25', null, 95, 'oechsle'),   // ohne GST am selben Weingarten
    e('wg1', 'g1', '2027-01-15', 30, 145, 'kmw'),        // Eiswein im Jänner
    e('wg1', 'g3', null, 17, 85, 'kmw'),                  // ohne Lesedatum → kein Lesetag
    e('wg2', 'g9', '2026-09-20', 20, 97, 'kmw'),
  ]

  test('mit GST: Einträge des GST plus die ohne GST am selben Weingarten, aufsteigend', () => {
    assert.deepEqual(L.lesetageFuerOrt(eintraege, 'wg1', 'g1').map(t => t.datum), ['2026-09-20', '2026-09-25', '2027-01-15'])
    assert.deepEqual(L.lesetageFuerOrt(eintraege, 'wg1', 'g2').map(t => t.datum), ['2026-09-22', '2026-09-25'])
  })

  test('ohne GST: alle Einträge des Weingartens', () => {
    assert.deepEqual(L.lesetageFuerOrt(eintraege, 'wg1', null).map(t => t.datum), ['2026-09-20', '2026-09-22', '2026-09-25', '2027-01-15'])
  })

  test('Einträge ohne Lesedatum zählen nicht; fremder Weingarten nicht', () => {
    assert.deepEqual(L.lesetageFuerOrt(eintraege, 'wg1', 'g3').map(t => t.datum), ['2026-09-25'])
    assert.deepEqual(L.lesetageFuerOrt(eintraege, 'wg2', 'g9').map(t => t.datum), ['2026-09-20'])
  })

  test('Mostgewicht des Tages nur, wenn eindeutig; Einheit wie gemessen', () => {
    const [t1] = L.lesetageFuerOrt(eintraege, 'wg1', 'g1')
    assert.deepEqual(t1, { datum: '2026-09-20', kmw: 18.5, oechsle: 90.1, einheit: 'kmw' })
    const oe = L.lesetageFuerOrt(eintraege, 'wg1', 'g2').find(t => t.datum === '2026-09-25')
    assert.deepEqual(oe, { datum: '2026-09-25', kmw: null, oechsle: 95, einheit: 'oechsle' })
    const zwei = L.lesetageFuerOrt([e('w', 'g', '2026-09-20', 18), e('w', 'g', '2026-09-20', 19)], 'w', 'g')
    assert.deepEqual(zwei, [{ datum: '2026-09-20', kmw: null, oechsle: null, einheit: null }], 'verschieden → keine Vorbelegung')
    const teil = L.lesetageFuerOrt([e('w', 'g', '2026-09-20', 18), e('w', 'g', '2026-09-20')], 'w', 'g')
    assert.equal(teil[0].kmw, null, 'ein Eintrag ohne Messwert → nicht eindeutig')
  })

  test('Vorbelegung nur bei genau einem Lesetag', () => {
    assert.equal(L.vorbelegterLesetag([]), null)
    assert.equal(L.vorbelegterLesetag(L.lesetageFuerOrt(eintraege, 'wg2', 'g9')).datum, '2026-09-20')
    assert.equal(L.vorbelegterLesetag(L.lesetageFuerOrt(eintraege, 'wg1', 'g1')), null)
  })
})

describe('lesedatumFehler', () => {
  const o = (teil) => ({ pressungDatum: '2026-09-28', jahrgang: 2026, pflicht: true, ...teil })

  test('Pflicht: leer → Fehler; ohne Pflicht (unveränderte Altzeile) → in Ordnung', () => {
    assert.match(L.lesedatumFehler('', o()), /Bitte das Lesedatum angeben/)
    assert.match(L.lesedatumFehler(null, o()), /Bitte das Lesedatum angeben/)
    assert.equal(L.lesedatumFehler(null, o({ pflicht: false })), null)
  })

  test('am oder vor dem Pressungsdatum in Ordnung, danach Fehler', () => {
    assert.equal(L.lesedatumFehler('2026-09-28', o()), null)
    assert.equal(L.lesedatumFehler('2026-09-01', o()), null)
    assert.equal(L.lesedatumFehler('2026-09-29', o()), 'Das Lesedatum 29.09.2026 liegt nach dem Pressungsdatum 28.09.2026.')
  })

  test('Jahrgang: ab 01.01., Eiswein bis 31.03. des Folgejahres', () => {
    assert.match(L.lesedatumFehler('2025-12-31', o()), /vor dem 01\.01\.2026 \(Jahrgang 2026\)/)
    assert.equal(L.lesedatumFehler('2026-01-01', o()), null)
    assert.equal(L.lesedatumFehler('2027-01-15', o({ pressungDatum: '2027-01-16' })), null)
    assert.equal(L.lesedatumFehler('2027-03-31', o({ pressungDatum: '2027-04-02' })), null)
    assert.match(L.lesedatumFehler('2027-04-01', o({ pressungDatum: '2027-04-02' })), /nach dem 31\.03\.2027/)
    assert.equal(L.lesedatumFehler('2027-04-01', o({ pressungDatum: '2027-04-02', jahrgang: null })), null, 'ohne Jahrgang (Formular) nur die Pressungsgrenze')
  })

  test('ungültiges Datum', () => {
    assert.equal(L.lesedatumFehler('2026-02-30', o()), 'Das Lesedatum ist kein gültiges Datum.')
    assert.equal(L.lesedatumFehler('28.09.2026', o()), 'Das Lesedatum ist kein gültiges Datum.')
  })
})

describe('behaelterPruefung (Most vollständig in Behälter, kein Überlauf)', () => {
  const beh = [{ id: 'b1', name: 'Tank 1', volumen_liter: 500 }, { id: 'b2', name: 'Immervolltank 10', volumen_liter: 400 }]
  const z = (nr, behaelter_id, menge_liter, alt = null) => ({ nr, behaelter_id, menge_liter, alt })

  test('Summe = Mostausbeute (±0,5 L) in Ordnung', () => {
    assert.equal(L.behaelterPruefung({ mostLiter: 360, zeilen: [z(1, 'b2', 360)], behaelter: beh, fuellstand: {} }), null)
    assert.equal(L.behaelterPruefung({ mostLiter: 360, zeilen: [z(1, 'b1', 200), z(2, 'b2', 160.4)], behaelter: beh, fuellstand: {} }), null)
  })

  test('Rückmeldung: 360 L gepresst, 380 L eingefüllt → abgelehnt', () => {
    const f = L.behaelterPruefung({ mostLiter: 360, zeilen: [z(1, 'b2', 380)], behaelter: beh, fuellstand: {} })
    assert.match(f, /Die Behälterzeilen ergeben 380 L, gepresst wurden 360 L/)
    assert.match(L.behaelterPruefung({ mostLiter: 360, zeilen: [z(1, 'b2', 300)], behaelter: beh, fuellstand: {} }), /ergeben 300 L/)
  })

  test('ohne Mostausbeute → Hinweis', () => {
    assert.equal(L.behaelterPruefung({ mostLiter: null, zeilen: [], behaelter: beh, fuellstand: {} }), 'Bitte die Mostausbeute gesamt (L) angeben.')
  })

  test('Kapazität: Inhalt + neuer Most > Volumen → Behälterzeile n', () => {
    const f = L.behaelterPruefung({ mostLiter: 300, zeilen: [z(1, 'b2', 300)], behaelter: beh, fuellstand: { b2: 150 } })
    // KAN-381: gemeinsame Meldung aller Zugangswege, mit der Behälterzeile davor
    assert.equal(f, 'Behälterzeile 1: Die Charge (300 l) passt nicht in „Immervolltank 10“ (Fassungsvermögen 400 l, frei 250 l).')
    assert.equal(L.behaelterPruefung({ mostLiter: 300, zeilen: [z(1, 'b2', 300)], behaelter: beh, fuellstand: { b2: 100 } }), null, 'genau voll')
  })

  test('Bearbeiten: der schon enthaltene Most derselben Zeile zählt nicht doppelt', () => {
    // Zeile war 300 L in b2 (Füllstand 380 inkl. dieser 300), jetzt 320 L → Zugang +20 → 400 L passt
    assert.equal(L.behaelterPruefung({ mostLiter: 320, zeilen: [z(1, 'b2', 320, { behaelter_id: 'b2', menge_liter: 300 })], behaelter: beh, fuellstand: { b2: 380 } }), null)
    assert.match(L.behaelterPruefung({ mostLiter: 330, zeilen: [z(1, 'b2', 330, { behaelter_id: 'b2', menge_liter: 300 })], behaelter: beh, fuellstand: { b2: 380 } }), /Die Charge \(30 l\) passt nicht in „Immervolltank 10“ \(Fassungsvermögen 400 l, frei 20 l\)/)
    // KAN-381: Volumen 0 = unbekannt – keine Sperre
    assert.equal(L.behaelterPruefung({ mostLiter: 300, zeilen: [z(1, 'b0', 300)], behaelter: [{ id: 'b0', name: 'Fass', volumen_liter: 0 }], fuellstand: {} }), null)
  })
})

describe('Verdrahtung', () => {
  const actions = quelle('src/app/(dashboard)/erntemeldung/actions.ts')
  const upsert = actions.slice(actions.indexOf('export async function upsertPressung'), actions.indexOf('export async function deletePressung'))

  test('Server: Lesedatum und Mostgewicht werden gelesen, geprüft (Traubenzeile n), geschrieben und beim Bearbeiten verglichen', () => {
    assert.match(actions, /const PW_FELDER = \[[^\]]*'ernte_datum', 'kmw', 'oechsle', 'mostgewicht_einheit'\]/)
    assert.match(upsert, /lesedatumFehler\(w\.ernte_datum, \{ pressungDatum: datum, jahrgang: /)
    assert.match(upsert, /throw new AktionsFehler\(`Traubenzeile \$\{w\.nr\}: \$\{f\}`\)/)
    assert.match(upsert, /ernte_datum: w\.ernte_datum, kmw: w\.kmw, oechsle: w\.oechsle, mostgewicht_einheit: w\.mostgewicht_einheit/)
    assert.match(upsert, /\.select\('id, weingarten_id, grundstueck_id, zukauf_posten_id, trauben_kg, rebsorte, notizen, ernte_datum, kmw, oechsle, mostgewicht_einheit'\)/)
  })

  test('Server: Zukauf-Zeilen bekommen das Zukaufsdatum; Sync nur für denselben Lesetag', () => {
    assert.match(upsert, /w\.ernte_datum = zkDatum\.get\(w\.zukauf_posten_id\) \?\? null/)
    assert.match(upsert, /if \(w\.ernte_datum\) q = q\.eq\('ernte_datum', w\.ernte_datum\)/)
  })

  test('Formular: Option je Ort und Lesetag, Lesedatum und Mostgewicht je Zeile, gesendet', () => {
    const f = quelle('src/app/(dashboard)/erntemeldung/[id]/PressungSection.tsx')
    assert.match(f, /lesetageFuerOrt\(leseEintraege, p\.weingarten_id, p\.grundstueck_id\)/)
    assert.match(f, /compositeId: `\$\{ort\}\|\$\{t\.datum\}`/)
    assert.match(f, /ernte_datum: opt\.tag\?\.datum \?\? ''/)
    assert.match(f, /mostgewicht_wert: r\.mg \? messwertText\(r\.mg\) : null/)
    assert.match(f, /aria-label=\{`Lesedatum Traubenzeile \$\{i \+ 1\}`\}/)
  })

  test('Server: Press-/Lesedatum eingefroren bei Folgebuchungen, Most- und Kapazitätsprüfung', () => {
    assert.ok(upsert.includes('if (datumGeaendert || lesedatumGeaendert) {'))
    assert.ok(upsert.includes('await sperreBeiFolgebuchungen(supabase, pb.weinausbau_id as string,'))
    assert.ok(upsert.includes('const fehlerText = behaelterPruefung({'))
  })

  test('Formular: Checkbox-Liste je Ried (mehrere GST gemeinsam), Ried-Haken wählt alle', () => {
    const f = quelle('src/app/(dashboard)/erntemeldung/[id]/PressungSection.tsx')
    assert.ok(f.includes('aria-label={`${g.name}: alle GST auswählen`}'))
    assert.ok(f.includes('onChange={() => optionUmschalten(opt.compositeId)}'))
    assert.ok(f.includes('function riedUmschalten('))
  })

  test('Seite lädt Lesedatum und Mostgewicht der Traubenzeilen; Blend-Jahrgang aus der Pressung', () => {
    assert.match((quelle('src/app/(dashboard)/erntemeldung/[id]/page.tsx') + quelle('src/app/(dashboard)/erntemeldung/[id]/leseKontext.ts'))   /* Laden seit dem Pilottest in leseKontext.ts */, /pressung_weingaerten\([^)]*ernte_datum, kmw, oechsle, mostgewicht_einheit/)
    const b = quelle('src/lib/wein/blendKomposition.ts')
    assert.match(b, /jahrgang:jahrgang_id\(jahrgang\)/)
    assert.doesNotMatch(b, /new Date\(wg\.ernte_datum\)\.getFullYear\(\)/)
  })
})

// Nachtrag 29.09.2026: Abstufen der Qualitätsstufe bei der Pressung (KAN-81, Pressungsteil)
describe('Abstufen bei der Pressung', async () => {
  const Q = await import('../../src/lib/wein/qualitaet.ts')

  test('Optionen: Lese-Stufen bis zur Obergrenze, Obergrenze zuerst', () => {
    assert.deepEqual(Q.abstufungsOptionen('kabinett').map(o => o.value), ['kabinett', 'qualitaetswein', 'landwein', 'wein'])
    assert.deepEqual(Q.abstufungsOptionen('landwein').map(o => o.value), ['landwein', 'wein'])
  })

  test('Kabinett → Landwein erlaubt, höher als die Obergrenze abgelehnt', () => {
    assert.equal(Q.abstufungFehler('landwein', 'kabinett'), null)
    assert.equal(Q.abstufungFehler('kabinett', 'kabinett'), null)
    assert.equal(Q.abstufungFehler(null, 'kabinett'), null)
    assert.match(Q.abstufungFehler('spaetlese', 'kabinett'), /liegt über „Kabinett“ aus dem Mostgewicht – nur Abstufen ist möglich/)
  })

  test('Verdrahtung: Formular schickt nur eine Abstufung, Server prüft gegen die °KMW-Stufe', () => {
    const f = quelle('src/app/(dashboard)/erntemeldung/[id]/PressungSection.tsx')
    assert.ok(f.includes("if (stufeWert) fd.append('qualitaetsstufe', stufeWert)"))
    assert.ok(f.includes('aria-label="Qualitätsstufe der neuen Charge"'))
    const a = quelle('src/app/(dashboard)/erntemeldung/actions.ts')
    assert.ok(a.includes('const ueberObergrenze = abstufungFehler(qualitaetsstufeInput,'))
  })
})

// Nachtrag 29.09.2026 (offene Fragen 4 und 7 laut Jira-Kommentar Jörgen)
describe('Einfrieren verpresster Lesedaten und Weinbuch je Pressung', () => {
  test('Lese-Eintrag: Lesedatum fest, sobald eine Pressungszeile desselben Orts diesen Lesetag trägt', () => {
    const a = quelle('src/app/(dashboard)/erntemeldung/actions.ts')
    assert.ok(a.includes('async function pruefeLesedatumNichtVerpresst('))
    assert.ok(a.includes('await pruefeLesedatumNichtVerpresst(supabase, tenantId, jahrgangId, alt, (payload.ernte_datum as string | null) ?? null)'))
    assert.ok(a.includes(".eq('weingarten_id', alt.weingarten_id).eq('ernte_datum', altesDatum)"))
  })

  // KAN-127: Lesen nur noch aus den Lesezeilen der Charge (und ihrer Vorgänger) – Lesedatum der Traubenzeile,
  // sonst laut Erntemeldung (Fensterende), sonst Pressungsdatum; keine Erntemeldungs-Einträge aller Weingärten mehr
  test('Weinbuch: Lesen aus den Lesezeilen der Charge (Lesedatum je Traubenzeile zuerst)', () => {
    const w = quelle('src/lib/wein/weinbuch.ts')
    assert.ok(w.includes('const datum = l.lesedatum ?? ausErnte ?? tag(l.pressung.datum)'))
    assert.doesNotMatch(w, /from('ernte_parzellen')/)
    assert.ok(quelle('src/lib/behoerden/rv-weingarten.ts').includes('grundstueck:grundstueck_id(gst_nr, katastralgemeinde, ama_feldnummer)'))
  })
})
