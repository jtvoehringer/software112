// KAN-392 (Epic KAN-391): „Ernte abgeschlossen“ je Grundstück und Jahrgang. Abgeschlossene Grundstücke schlägt das
// Lese-Formular nicht mehr vor (Ried ganz weg, wenn alle abgeschlossen); „anzeigen“ blendet sie für eine Nachlese ein.
// Formular und Server Action filtern mit derselben Funktion (ohneAbgeschlossene, lib/wein/leseErfassung.ts).
//
// Aufruf:  npm run -s test:csv   (alle scripts/tests/*.test.mjs)

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
// @ts-expect-error TS5097 – node:test lädt die .ts-Datei direkt
import { abgeschlossenHinweis, leseZiele, ohneAbgeschlossene } from '../../src/lib/wein/leseErfassung.ts'

const quelle = p => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')
const E = 'src/app/(dashboard)/erntemeldung'

const GST = {
  a: [{ id: 'a1', flaeche_ha: 1 }, { id: 'a2', flaeche_ha: 1 }],
  b: [{ id: 'b1', flaeche_ha: 2 }],
  c: [],
}

describe('ohneAbgeschlossene', () => {
  test('abgeschlossene Grundstücke fallen weg, Zähler und Rieden ohne offenes Grundstück', () => {
    const r = ohneAbgeschlossene(GST, new Set(['a2', 'b1']))
    assert.deepEqual(r.gst, { a: [{ id: 'a1', flaeche_ha: 1 }], b: [], c: [] })
    assert.equal(r.ausgeblendet, 2)
    assert.deepEqual([...r.rieden], ['b'])
  })
  test('ohne Abschluss bleibt alles, eine Ried ohne Grundstücke wird nie ausgeblendet', () => {
    const r = ohneAbgeschlossene(GST, new Set())
    assert.deepEqual(r.gst, GST)
    assert.equal(r.ausgeblendet, 0)
    assert.equal(r.rieden.size, 0)
  })
  test('ganz gewählte Ried verteilt nur auf ihre offenen Grundstücke, einzeln gewählte bleiben', () => {
    const offen = ohneAbgeschlossene(GST, new Set(['a2'])).gst
    assert.deepEqual(leseZiele(['a'], [], offen).map(z => z.grundstueck_id), ['a1'])
    // Nachlese: abgeschlossenes Grundstück einzeln gewählt (Server ergänzt es wie bisher als Einzelwahl)
    const mitEinzel = { ...offen, a: [...offen.a, { id: 'a2', flaeche_ha: 1 }] }
    assert.deepEqual(leseZiele(['a'], [{ gst_id: 'a2', weingarten_id: 'a' }], mitEinzel).map(z => z.grundstueck_id), ['a1', 'a2'])
  })
})

test('Hinweis zählt die Grundstücke, aus- bzw. eingeblendet', () => {
  assert.equal(abgeschlossenHinweis(0), null)
  assert.equal(abgeschlossenHinweis(1), '1 GST mit abgeschlossener Ernte ausgeblendet')
  assert.equal(abgeschlossenHinweis(3, true), '3 GST mit abgeschlossener Ernte eingeblendet')
})

describe('Verdrahtung', () => {
  test('Lese-Kontext lädt die abgeschlossenen Grundstücke vollständig und mandantengefiltert', () => {
    const k = quelle(`${E}/[id]/leseKontext.ts`)
    assert.match(k, /alle<AR>\(tf\(\(supabase\.from\('ernte_gst_abgeschlossen'\) as any\)\.select\('id, grundstueck_id'\)\.eq\('jahrgang_id', id\)\.order\('id'\)\)\)/)
    assert.match(k, /verkauefe, tvQuelleOptions, abgeschlosseneGst,/)
  })
  test('Formular: ausblenden mit „anzeigen“, Kästchen je Zeile, Ansicht und Haken gehen an die Action', () => {
    const f = quelle(`${E}/[id]/ErnteDetailClient.tsx`)
    assert.match(f, /const gstByWeingarten = abgeschlosseneZeigen \? alleGstJeWg : offen\.gst/)
    assert.match(f, /w\.erntebar && \(abgeschlosseneZeigen \|\| !offen\.rieden\.has\(w\.id\)\)/)
    assert.match(f, /if \(abgeschlosseneZeigen\) fd\.set\('mit_abgeschlossenen', '1'\)/)
    assert.match(f, /fd\.append\('abschliessen_gst', z\.grundstueck_id\)/)
    assert.match(f, /aria-label=\{`Ernte abgeschlossen \$\{name\.ried\} \$\{name\.gst\}`\}/)
    assert.match(f, /<ErnteAbschlussUmschalter jahrgangId=\{jahrgang\.id\}/)
    assert.match(f, /<ErnteAbschlussUmschalter jahrgangId=\{jahrgangId\}/)
  })
  test('Action: ganze Ried ohne abgeschlossene (wie das Formular), Haken nach dem Speichern, Umschalter mit Zeilenprüfung', () => {
    const a = quelle(`${E}/actions.ts`)
    assert.match(a, /if \(formData\.get\('mit_abgeschlossenen'\) !== '1' && ganzOderOhneGst\.length > 0\) \{\s+const offen = ohneAbgeschlossene\(wiJeWg, await ladeAbgeschlosseneGst\(supabase, tenantId, jahrgangId\)\)/)
    assert.match(a, /formData\.getAll\('abschliessen_gst'\)[\s\S]{0,120}\.filter\(id => ziele\.some\(z => z\.grundstueck_id === id\)\)/)
    // Umschalter in eigener Datei (actions.ts löscht nichts – Wächter KAN-148 C1b)
    const fn = quelle(`${E}/ernteAbschluss.ts`)
    assert.match(fn, /await pruefeSeitenBetrieb\(membership\.tenantId\)[\s\S]{0,120}await pruefeSchreibzugriff\(membership\)[\s\S]{0,60}if \(!canWrite\(membership, 'rieden'\) && !canWrite\(membership, 'kellerbuch'\)\)/)
    assert.match(fn, /\.delete\(\)\.eq\('tenant_id', tenantId\)\.eq\('jahrgang_id', jahrgangId\)\.eq\('grundstueck_id', grundstueckId\)\.select\('id'\)/)
    assert.match(fn, /if \(!data\?\.length\) throw new AktionsFehler\(NICHT_GESPEICHERT\)/)
  })
})
