// KAN-131 (05.10.2026): Mostgewicht Teil C – Anzeigen, Meldungen, KI, Absicherung.
// Entscheidungen Jörgen (05.10.2026): Prüfnummernantrag mit °KMW als Information (wie gespeichert); nur die Meldungen des
// Tickets bekommen Mostgewicht-Spalten; ama_meldepositionen.oechsle geleert, die KI liest Mostgewicht nur aus den
// Mostgewichtsspalten; Reife-/Gärmessungen eigenes Ticket (KAN-203).
//
// Aufruf:  npm run -s test:csv  (Node ≥ 22.15 wegen module.registerHooks)

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { hooksRegistrieren, laden, nurMitHooks, hooksMoeglich } from './buchung-attrappe.mjs'

hooksRegistrieren()
const WURZEL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const quelle = rel => readFileSync(path.join(WURZEL, rel), 'utf8').replace(/\r\n/g, '\n')
const mg = hooksMoeglich ? await laden('lib/behoerden/mostgewicht_export.ts') : null
const csv = hooksMoeglich ? await laden('lib/csv/index.ts') : null
const misch = hooksMoeglich ? await laden('lib/wein/mischungsrechnung.ts') : null
const pna = hooksMoeglich ? await laden('lib/behoerden/pruefnummernantrag.ts') : null

const zellen = text => text.replace(/^﻿/, '').split('\r\n').filter(Boolean).map(z => z.split(';'))

describe('KAN-131 drei Mostgewicht-Spalten', nurMitHooks, () => {
  const spalten2 = () => mg.mostgewichtCsvSpalten(z => z, 2)
  test('Kopf, °KMW vor °Oe, gemessene Einheit', () => {
    const [kopf, a, b, c] = zellen(csv.csvText([
      { kmw: 18.97, oechsle: 94, einheit: 'oechsle' },
      { kmw: 17.4, oechsle: null, einheit: 'kmw' },
      null,
    ], spalten2()))
    assert.deepEqual(kopf, ['Mostgewicht (°KMW)', 'Mostgewicht (°Oe)', 'Mostgewicht gemessen in'])
    assert.deepEqual(a, ['18,97', '94,0', '°Oe'])
    assert.deepEqual(b, ['17,40', '85,7', '°KMW'])
    assert.deepEqual(c ?? ['', '', ''], ['', '', ''])
  })
  test('1 Stelle: °KMW abgerundet, nie über die Stufenschwelle (94 °Oe = 18,97 → 18,9)', () => {
    const [, a] = zellen(csv.csvText([{ kmw: 18.97, oechsle: 94, einheit: 'oechsle' }], mg.mostgewichtCsvSpalten(z => z, 1)))
    assert.deepEqual(a, ['18,9', '94,0', '°Oe'])
  })
  test('Weinbuch-Text: beide Werte, umgerechneter mit „≈“', () => {
    assert.equal(mg.mostgewichtWeinbuchText({ kmw: 17.4, oechsle: 85.7, einheit: 'kmw' }), '17,4 °KMW · ≈ 85,7 °Oe')
    assert.equal(mg.mostgewichtWeinbuchText({ kmw: 17.09, oechsle: 84, einheit: 'oechsle' }), '≈ 17,09 °KMW · 84,0 °Oe')
  })
})

describe('KAN-131 Blend-Komposition: Mostgewicht derselben Herkunft gemittelt', nurMitHooks, () => {
  test('mehrere Lesetage eines Grundstücks: literngewichtetes °KMW statt des ersten Eintrags', () => {
    assert.equal(misch.kmwGemittelt(300, 18, 100, 22), 19)
    assert.equal(misch.kmwGemittelt(100, 17.5, 200, 17.5), 17.5)
    assert.equal(misch.kmwGemittelt(100, null, 200, 18.2), 18.2)
    assert.equal(misch.kmwGemittelt(100, 18.2, 200, null), 18.2)
    assert.equal(misch.kmwGemittelt(1, 17.99, 2, 18), 17.99)   // abgerundet, nicht aufgerundet
  })
})

describe('KAN-131 Prüfnummernantrag', nurMitHooks, () => {
  test('Lesegradation: °KMW der Charge wie gespeichert, abgerundet (Information)', () => {
    const f = pna.pnaVorbelegung({ jahrgang: 2025, rebsorte: 'Zweigelt', menge_liter: 1500, dac_region: 'sonstiges' }, { betrieb_name: 'X' }, { kmw: 18.999, weinart: 'rot' })
    assert.equal(f.lesegradation, '18,99 °KMW')
  })
})

describe('KAN-131 Verdrahtung', () => {
  test('Anzeigen: Charge, Weinbuch-Kopf und Pressung, Jahrgangs-Ø kg-gewichtet', () => {
    assert.match(quelle('src/app/(dashboard)/kellerbuch/weinausbau/[id]/page.tsx'), /Mostgewicht <MostgewichtAnzeige wert=\{\{ kmw: weinausbau\.kmw, oechsle: weinausbau\.oechsle, einheit: weinausbau\.mostgewicht_einheit \}\} \/>/)
    assert.match(quelle('src/app/(dashboard)/kellerbuch/weinausbau/[id]/buch/page.tsx'), /<MostgewichtAnzeige wert=\{\{ kmw: wa\.kmw, oechsle: wa\.oechsle, einheit: wa\.mostgewicht_einheit \}\} \/>/)
    assert.match(quelle('src/lib/wein/weinbuch.ts'), /mostgewichtWeinbuchText\(\{ kmw: p\.kmw_grad, oechsle: p\.oechsle, einheit: p\.mostgewicht_einheit \}\)/)
    assert.match(quelle('src/app/(dashboard)/erntemeldung/page.tsx'), /mischen\(d\.teile\)\?\.kmw/)
    const pr = quelle('src/app/(dashboard)/erntemeldung/[id]/PressungSection.tsx')
    assert.match(pr, /<MostgewichtAnzeige wert=\{\{ kmw: p\.kmw_grad, oechsle: p\.oechsle \?\? null, einheit: p\.mostgewicht_einheit \?\? null \}\} \/>/)
    assert.doesNotMatch(pr, /p\.kmw_grad\.toString\(\)\.replace/)
  })
  test('Rückverfolgung: beide Werte, ohne Pressung das Mostgewicht der Charge', () => {
    const rv = quelle('src/lib/behoerden/rueckverfolgung.ts')
    assert.match(rv, /kmw: numOderNull\(wa\?\.kmw\), oechsle: numOderNull\(wa\?\.oechsle\), mostgewichtEinheit: text\(wa\?\.mostgewicht_einheit\)/)
    assert.match(rv, /\.\.\.mostgewichtCsvSpalten<RueckverfolgungZeile>/)
    assert.match(quelle('src/lib/behoerden/rv-weingarten.ts'), /\.\.\.mostgewichtCsvSpalten<RvZeile>/)
    assert.doesNotMatch(quelle('src/app/(dashboard)/kellerbuch/rueckverfolgung/page.tsx'), /\{wg\.kmw\} °KMW/)
  })
  test('Weinpass /w/[charge]: Betrieb der Füllung, bevorzugte Einheit, Charge ohne Pressung', () => {
    const w = quelle('src/app/w/[charge]/page.tsx')
    assert.match(w, /weinausbau_id, tenant_id/)
    assert.match(w, /await ladeMostgewichtEinheit\(String\(f\.tenant_id\)\)/)
    assert.match(w, /\.eq\('id', f\.weinausbau_id\)\.eq\('tenant_id', f\.tenant_id\)/)
    assert.doesNotMatch(w, /\{wg\.kmw\} °KMW/)
  })
  test('Blend: Zukauf und Eröffnungsbestand mit Mostgewicht, CSV mit drei Spalten', () => {
    const bk = quelle('src/lib/wein/blendKomposition.ts')
    assert.match(bk, /typ: 'eroeffnungsbestand', rebsorte: c\.rebsorte \?\? null, jahrgang: c\.jahrgang \?\? null, \.\.\.mg\(c\)/)
    assert.match(bk, /zukauf_von: von, \.\.\.mg\(z\)/)
    assert.match(quelle('src/lib/behoerden/blend.ts'), /\.\.\.mostgewichtCsvSpalten<BlendZeile>/)
  })
  test('Transportbescheinigung: Formblatt mit eigener °KMW-Spalte, CSV getrennt', () => {
    assert.match(quelle('src/app/(dashboard)/weinhandel/verkauf/[id]/transportbescheinigung/TBFormular.tsx'), /\{tbKmwFormblatt\(pos\)\}/)
    const tb = quelle('src/lib/behoerden/transportbescheinigung.ts')
    assert.match(tb, /\{ kopf: 'Alkohol \(% vol\)', typ: 'text', wert: z => z\.alkohol \}/)
    assert.match(tb, /\.\.\.mostgewichtCsvSpalten<TBZeile>\(z => \(\{ kmw: z\.kmw, oechsle: z\.oechsle, einheit: z\.mostgewichtEinheit \}\), 1\)/)
  })
  test('KI: Mostgewichtsspalten beschrieben, ama_meldepositionen.oechsle ausgeschlossen; Assistent mit Einheit', () => {
    const ki = quelle('src/app/api/ki-abfrage/route.ts')
    assert.match(ki, /MOSTGEWICHT \(KAN-128\/KAN-131\)/)
    assert.match(ki, /ama_meldepositionen\.oechsle ist leer und wird NICHT verwendet/)
    assert.match(quelle('src/lib/assistent/kontext.ts'), /MOSTGEWICHT: bevorzugte Einheit des Betriebs/)
  })
})
