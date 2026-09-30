// KAN-128 Teil A, S5 (26.09.2026): Mostgewicht bei Lese und Traubenverkauf erfassen
//
// Aufruf:  node --experimental-strip-types --disable-warning=ExperimentalWarning --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test scripts/tests/mostgewicht-erfassung.test.mjs
//          (Node ≥ 22.6, ohne Datenbank; läuft auch über npm run test:csv)
//
// (1) mostgewichtAusWert()/messwertText(): Messwert + Einheit aus JSON (Sammelerfassung je
//     Grundstück, Verkaufsformular, Assistent) – dieselben Regeln wie die Formularfelder
// (2) Verdrahtung (Quelltext): Lese (drei Erfassungsarten, Bearbeiten), Traubenverkauf an drei
//     Stellen, Vorbelegung aus Lese und Zukauf, Assistent-Tool ernte_erfassen
//
// Die Server Actions selbst brauchen Next und Supabase – deshalb hier Quelltext-Prüfungen der
// Verdrahtung; die Rechenregeln der Actions (mostgewichtAusFormular, mostgewichtSpalten) prüft
// scripts/tests/mostgewicht-eingabe.test.mjs.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { register } from 'node:module'

register('./ernte.aufloesung.mjs', import.meta.url)

const { ausMessung } = await import('../../src/lib/wein/mostgewicht.ts')
const { mostgewichtAusWert, messwertText, mostgewichtSpalten } = await import('../../src/lib/wein/mostgewichtFormular.ts')
const { kmwZuQualitaet } = await import('../../src/lib/weinqualitaet.ts')

const quelle = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')

// ── (1) JSON-Eingaben ───────────────────────────────────────────────────────

describe('mostgewichtAusWert()', () => {
  test('Text wie eingegeben oder Zahl – beide Werte serverseitig (84 °Oe → 17,09 °KMW)', () => {
    assert.deepEqual(mostgewichtAusWert('84', 'oechsle'), { ok: true, wert: { kmw: 17.09, oechsle: 84, einheit: 'oechsle' } })
    assert.deepEqual(mostgewichtAusWert(84, 'oechsle'), { ok: true, wert: { kmw: 17.09, oechsle: 84, einheit: 'oechsle' } })
    assert.deepEqual(mostgewichtAusWert('17,4', 'kmw'), { ok: true, wert: { kmw: 17.4, oechsle: 85.7, einheit: 'kmw' } })
    assert.deepEqual(mostgewichtAusWert(17.4, 'kmw'), { ok: true, wert: { kmw: 17.4, oechsle: 85.7, einheit: 'kmw' } })
  })

  test('leer, null, undefined = kein Mostgewicht (auch ohne Einheit)', () => {
    for (const roh of [null, undefined, '', '  ']) assert.deepEqual(mostgewichtAusWert(roh, null), { ok: true, wert: null }, String(roh))
  })

  test('ungültig: Einheit, Stellen (83,55 °Oe), Bereich, Typ, NaN – Fehler mit Bezeichnung', () => {
    const faelle = [
      [84, null, /°KMW oder °Oe/],
      [84, 'brix', /°KMW oder °Oe/],
      [83.55, 'oechsle', /höchstens einer Nachkommastelle/],
      ['83,55', 'oechsle', /höchstens einer Nachkommastelle/],
      [17.456, 'kmw', /höchstens 2 Nachkommastellen/],
      [61, 'kmw', /zwischen 0 und 60 °KMW/],
      [-1, 'kmw', /nicht negativ/],
      [NaN, 'kmw', /keine gültige Zahl/],
      [{ wert: 1 }, 'kmw', /keine gültige Eingabe/],
    ]
    for (const [roh, einheit, muster] of faelle) {
      const r = mostgewichtAusWert(roh, einheit, 'GST 88')
      assert.equal(r.ok, false, `${String(roh)} ${einheit}`)
      assert.match(r.fehler, /^GST 88: /)
      assert.match(r.fehler, muster, `${String(roh)} ${einheit}`)
    }
  })

  test('messwertText → mostgewichtAusWert ergibt dieselben Werte (ganzes Raster 50,0–250,0 °Oe, 10,00–40,00 °KMW)', () => {
    for (let z = 500; z <= 2500; z++) {
      const m = ausMessung(z / 10, 'oechsle')
      assert.deepEqual(mostgewichtAusWert(messwertText(m), m.einheit).wert, m, `${z / 10} °Oe`)
    }
    for (let h = 1000; h <= 4000; h++) {
      const m = ausMessung(h / 100, 'kmw')
      assert.deepEqual(mostgewichtAusWert(messwertText(m), m.einheit).wert, m, `${h / 100} °KMW`)
    }
    assert.equal(messwertText(null), '')
    assert.equal(messwertText({ kmw: 17, oechsle: 83.5, einheit: 'oechsle' }), '83.5')
  })

  test('Stufe nur aus dem gespeicherten °KMW (Rechenregel 5): 83,5 °Oe → Kabinett, 73 °Oe → Landwein', () => {
    assert.equal(kmwZuQualitaet(mostgewichtAusWert('83,5', 'oechsle').wert.kmw), 'kabinett')
    assert.equal(kmwZuQualitaet(mostgewichtAusWert('73', 'oechsle').wert.kmw), 'landwein')
    assert.equal(kmwZuQualitaet(mostgewichtAusWert('94,2', 'oechsle').wert.kmw), 'spaetlese')
  })

  test('Löschen eines °Oe-Messwerts: beide Spalten NULL in einem Schreibvorgang', () => {
    assert.deepEqual(mostgewichtSpalten(mostgewichtAusWert('', 'oechsle').wert, 'kmw_grad'), { kmw_grad: null, oechsle: null, mostgewicht_einheit: 'kmw' })
  })
})

// ── (2) Verdrahtung ─────────────────────────────────────────────────────────

describe('Verdrahtung Lese (Quelltext)', () => {
  const client = quelle('src/app/(dashboard)/erntemeldung/[id]/ErnteDetailClient.tsx')
  const actions = quelle('src/app/(dashboard)/erntemeldung/actions.ts')
  const fn = (name) => actions.slice(actions.indexOf(`export async function ${name}(`), actions.indexOf('\nexport async function ', actions.indexOf(`export async function ${name}(`) + 10))

  test('Formular: kein Hidden-Feld oechsle, kein °KMW-Einzelfeld mehr – Eingabe-Komponente in allen Erfassungsarten', () => {
    assert.doesNotMatch(client, /name="oechsle"/)
    assert.doesNotMatch(client, /name="klosterneuburger"/)
    // gemeinsam (nur ganze Rieden) mit Qualitätsvorschau, je Grundstück, Bearbeiten
    assert.match(client, /<MostgewichtEingabe name="mostgewicht" label="Mostgewicht & Qualitätsstufe" qualitaetsVorschau \/>/)
    assert.match(client, /name=\{`gst_\$\{gstId\}_mostgewicht`\}/)
    assert.match(client, /<MostgewichtEingabe name="mostgewicht" startwert=\{mgStart\}/)
    // je Grundstück: Messwert + Einheit ins JSON, ungültige Eingabe blockiert das Absenden
    assert.match(client, /const mg = data\?\.mg\.wert \?\? null/)
    assert.match(client, /mostgewicht_wert: mg \? messwertText\(mg\) : null/)
    assert.match(client, /mostgewicht_einheit: mg\?\.einheit \?\? null/)
    assert.match(client, /gstData\.get\(gstId\)\?\.mg\.fehler/)
    // Review 26.09.2026 III: Zeile zu- und aufklappen – Eingabezustand zurück, Fehler nur zur aktuellen Eingabe
    assert.match(client, /anfangsZustand=\{zeile\.zustand\}/)
    assert.match(client, /mg: zeileMostgewichtAendern\(alt\.mg, zustand\)/)
    assert.doesNotMatch(client, /mgFehler/)
  })

  test('Lese bearbeiten behält die gewählte Stufe (Rechenregel 6), höchstens ein Prüfhinweis', () => {
    const form = client.slice(client.indexOf('function ParzellForm('), client.indexOf('// ── Hauptkomponente'))
    assert.match(form, /if \(!parzelle\) setQualitaetEdit\(null\)/)
    assert.match(form, /die gewählte Stufe bleibt/)
    assert.match(form, /einheit: parzelle\.mostgewicht_einheit/)
  })

  test('upsertErnteParzelle: Messwert + Einheit, beide Spalten, Formular ohne Feld lässt das Gespeicherte stehen', () => {
    const f = fn('upsertErnteParzelle')
    assert.match(f, /mostgewichtAusFormular\(formData, 'mostgewicht', \{ altesFeld: 'klosterneuburger' \}\)/)
    assert.match(f, /mostgewicht\.uebermittelt \|\| !formData\.get\('existing_id'\) \? mostgewichtSpalten\(mostgewicht\.wert, 'klosterneuburger'\)/)
    assert.doesNotMatch(f, /formData\.get\('oechsle'\)/)
    assert.doesNotMatch(f, /kmwZuQualitaet/)                                   // keine Ableitung beim Bearbeiten
  })

  test('createMultipleErnteParzellen: Stufe nur aus ausMessung().kmw, je Grundstück eigener Messwert', () => {
    const f = fn('createMultipleErnteParzellen')
    assert.match(f, /mostgewichtAusFormular\(formData, 'mostgewicht', \{ altesFeld: 'klosterneuburger' \}\)/)
    assert.match(f, /kmwZuQualitaet\(mgGemeinsam\.kmw\)/)
    assert.match(f, /kmwZuQualitaet\(perMg\.kmw\)/)
    assert.match(f, /mostgewichtAusWert\(g\.mostgewicht_wert, g\.mostgewicht_einheit, bezeichnung\)/)
    assert.match(f, /mostgewichtAusWert\(g\.kmw, 'kmw', bezeichnung\)/)        // älteres JSON-Format
    assert.doesNotMatch(f, /oechsle: null/)
    // alle Prüfungen vor dem Schreiben
    assert.ok(f.indexOf('mgJeGst.set') < f.indexOf(".insert(rows)"))
  })

  test('Assistent ernte_erfassen: °KMW ODER °Oe, geprüft wie das Formular, Feld-Matrix nennt beides', () => {
    const t = quelle('src/lib/assistent/tools/ernte.ts')
    assert.match(t, /oechsle: \{ type: 'number', description: 'Gemeinsames Mostgewicht in °Oe/)
    assert.match(t, /oechsle: \{ type: 'number', description: 'Mostgewicht in °Oe \(nicht zusammen mit kmw\)' \}/)
    assert.match(t, /ENTWEDER klosterneuburger \(in °KMW/)
    assert.match(t, /bitte nur EINEN Messwert angeben/)
    // Bestätigungspflicht nennt das Mostgewicht mit Einheit (Beschreibung, Feld-Matrix, Hinweis ohne Bestätigung)
    assert.match(t, /jedes ' \+\s+'Mostgewicht mit der Einheit, in der er es genannt hat \(z\. B\. „Mostgewicht 17,4 °KMW“ ' \+\s+'bzw\. „Mostgewicht 84 °Oe“\)/)
    assert.match(t, /nachdem du dem User in einer normalen Textnachricht eine Zusammenfassung aller ' \+\s+'Positionen gezeigt hast – /)
    assert.match(t, /Die Zusammenfassung zur Bestätigung nennt jedes Mostgewicht mit der Einheit/)
    assert.match(t, /jedes Mostgewicht mit Einheit wie vom User genannt – ' \+\s+'z\. B\. „17,4 °KMW“ bzw\. „84 °Oe“\)/)
    assert.match(t, /höchstens 1 Nachkommastelle, 0–350\)/)
    assert.match(t, /mostgewichtAusWert\(roh, einheit, bezeichnung\)/)
    assert.match(t, /fd\.set\('mostgewicht_einheit', gemeinsam\.einheit\)/)
    assert.doesNotMatch(t, /fd\.set\('klosterneuburger'/)
  })
})

describe('Verdrahtung Traubenverkauf (Quelltext)', () => {
  test('Weinhandel › Traubenverkauf: Feldname-Fehler behoben (Eingabe + Action lesen dasselbe Feld)', () => {
    const c = quelle('src/app/(dashboard)/weinhandel/traubenverkauf/TraubenverkaufClient.tsx')
    assert.doesNotMatch(c, /name="klosterneuburger"/)
    assert.match(c, /<MostgewichtEingabe key=\{editRow\?\.id \?\? 'neu'\} name="mostgewicht" startwert=\{mgStart\} \/>/)
    // Vorbelegung aus Lese und Zukauf mit Messwert und Einheit
    assert.match(c, /mostgewichtVon\(match\.klosterneuburger, match\.oechsle, match\.mostgewicht_einheit\)/)
    assert.match(c, /mostgewichtVon\(opt\.kmw, opt\.oechsle, opt\.mostgewicht_einheit\)/)
    const a = quelle('src/app/(dashboard)/weinhandel/traubenverkauf/actions.ts')
    assert.match(a, /mostgewichtAusFormular\(formData, 'mostgewicht', \{ altesFeld: 'kmw_grad' \}\)/)
    assert.match(a, /mostgewicht\.uebermittelt \|\| !existing_id \? mostgewichtSpalten\(mostgewicht\.wert, 'kmw_grad'\)/)
    assert.doesNotMatch(a, /getNum\('kmw_grad'\)/)
    const p = quelle('src/app/(dashboard)/weinhandel/traubenverkauf/page.tsx')
    assert.match(p, /id, klosterneuburger, oechsle, mostgewicht_einheit, qualitaetsstufe/)
    assert.match(p, /herkunft, kmw, oechsle, mostgewicht_einheit,/)
  })

  test('Lese › Traubenverkauf: versteckte Felder ins FormData, Vorbelegung aus Lese und Zukauf', () => {
    const s = quelle('src/app/(dashboard)/erntemeldung/[id]/TraubenverkaufSection.tsx')
    assert.match(s, /<MostgewichtEingabe name="mostgewicht" startwert=\{mgStart\} \/>/)
    assert.match(s, /for \(const feld of \['mostgewicht_wert', 'mostgewicht_einheit'\]\)/)
    assert.doesNotMatch(s, /fd\.append\('kmw_grad'/)
    assert.match(s, /setMgStart\(\{ kmw: opt\.klosterneuburger, oechsle: opt\.oechsle, einheit: opt\.mostgewicht_einheit \}\)/)
    assert.match(s, /setMgStart\(\{ kmw: opt\.kmw_grad, oechsle: opt\.oechsle \?\? null, einheit: opt\.mostgewicht_einheit \?\? null \}\)/)
    const a = quelle('src/app/(dashboard)/erntemeldung/actions.ts')
    const f = a.slice(a.indexOf('export async function createTraubenverkauf('), a.indexOf('export async function updateTraubenverkauf('))
    assert.match(f, /mostgewichtAusFormular\(fd, 'mostgewicht', \{ altesFeld: 'kmw_grad' \}\)/)
    assert.ok(f.indexOf('mostgewichtAusFormular') < f.indexOf('get_next_liefernummer'))   // vor der Liefernummer
    const page = (quelle('src/app/(dashboard)/erntemeldung/[id]/page.tsx') + quelle('src/app/(dashboard)/erntemeldung/[id]/leseKontext.ts'))   /* Laden seit dem Pilottest in leseKontext.ts */
    assert.match(page, /klosterneuburger: p\.klosterneuburger, oechsle: p\.oechsle, mostgewicht_einheit: p\.mostgewicht_einheit/)
    assert.match(page, /qualitaetsstufe, kmw, oechsle, mostgewicht_einheit,/)
  })

  test('Verkauf › Weintrauben-Position: Eingabe je Position, Action rechnet, Stammdaten mit Einheit', () => {
    const v = quelle('src/app/(dashboard)/weinhandel/verkauf/neu/page.tsx')
    assert.match(v, /<MostgewichtEingabe name=\{`trauben_\$\{pos\.id\}_mostgewicht`\} startwert=\{pos\.trauben_mostgewicht\} \/>/)
    assert.match(v, /trauben_mostgewicht_wert: {4}p\.typ === 'trauben' \? mgFeld\(p, 'wert'\) : null/)
    assert.doesNotMatch(v, /trauben_kmw_grad/)
    const a = quelle('src/app/(dashboard)/weinhandel/verkauf/actions.ts')
    assert.match(a, /mostgewichtAusWert\(p\.trauben_mostgewicht_wert, p\.trauben_mostgewicht_einheit, nr\)/)
    assert.match(a, /\.\.\.mostgewichtSpalten\(mostgewichtJePosition\[i\] \?\? null, 'kmw_grad'\)/)
    const r = quelle('src/app/api/verkauf-stammdaten/route.ts')
    assert.match(r, /menge_kg, klosterneuburger, oechsle, mostgewicht_einheit, qualitaetsstufe/)
    // KAN-129: Mostgewicht je Lese und Ort (neuester Eintrag der Lese), Einheit bleibt dabei
    assert.match(r, /mostgewicht: {11}standard\?\.mostgewicht \?\? null/)
    assert.match(r, /mostgewicht: mgAus\(l\)/)
  })
})
