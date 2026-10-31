// KAN-388 (Epic KAN-386): „Dashboard anpassen“ – eigene Anordnung je Benutzer über alle Betriebe (Tabelle
// benutzer_dashboard, RLS nur eigene Zeile, DB-Test 87). Hier: Prüfen und Zusammenführen von gespeichertem Layout,
// Register und Rechten (src/lib/dashboard/widgets.ts) sowie die Verdrahtung von Seite, Server Actions und Fenster.
//
// Aufruf:  npm run -s test:csv   (alle scripts/tests/*.test.mjs)

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
// @ts-expect-error TS5097 – node:test lädt die .ts-Datei direkt
import * as W from '../../src/lib/dashboard/widgets.ts'

const quelle = p => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')
const ALLES = { modulEa: true, schnellaktionen: true }
const LESER_OHNE_EA = { modulEa: false, schnellaktionen: false }
const ids = l => l.map(e => e.id)

describe('layoutPruefen', () => {
  test('keine Liste → null (Standard)', () => {
    for (const roh of [null, undefined, {}, 'x', 1]) assert.equal(W.layoutPruefen(roh), null)
  })
  test('unbekannte, doppelte und kaputte Einträge fallen weg', () => {
    assert.deepEqual(W.layoutPruefen([{ id: 'morgenbericht' }, { id: 'gibts-nicht' }, null, 'finanzen', { id: 'morgenbericht' }, { id: 'finanzen' }]),
      [{ id: 'morgenbericht' }, { id: 'finanzen' }])
  })
  test('nur wählbare Größen; Standardgröße wird nicht mitgespeichert', () => {
    assert.deepEqual(W.layoutPruefen([{ id: 'morgenbericht', groesse: 'breit' }, { id: 'kellerbestand', groesse: 'breit' }, { id: 'naechste-schritte', groesse: 'mittel' }]),
      [{ id: 'morgenbericht', groesse: 'breit' }, { id: 'kellerbestand' }, { id: 'naechste-schritte' }])
  })
  test('höchstens LAYOUT_MAX Einträge (wie der CHECK der Datenbank)', () => {
    assert.equal(W.LAYOUT_MAX, 50)
    const roh = Array.from({ length: 60 }, () => ({ id: 'kellerbestand' }))
    assert.equal(W.layoutPruefen(roh).length, 1)
  })
  test('sichtbareWidgets ignoriert eine nicht wählbare Größe aus der DB', () => {
    const [w] = W.sichtbareWidgets([{ id: 'kellerbestand', groesse: 'breit' }], ALLES)
    assert.equal(w.groesse, 'klein')
  })
})

describe('editorEintraege', () => {
  test('ohne eigenes Layout: Standard, alles an', () => {
    const e = W.editorEintraege(null, ALLES)
    assert.deepEqual(ids(e), W.STANDARD_LAYOUT.map(x => x.id))
    assert.ok(e.every(x => x.an && x.verfuegbar))
  })
  test('eigenes Layout zuerst, dann die übrigen verfügbaren aus – neue Widgets nie ungefragt an', () => {
    const e = W.editorEintraege([{ id: 'morgenbericht', groesse: 'breit' }, { id: 'kellerbestand' }], ALLES)
    assert.deepEqual(ids(e).slice(0, 2), ['morgenbericht', 'kellerbestand'])
    assert.equal(e[0].groesse, 'breit')
    assert.ok(e.slice(2).every(x => !x.an))
    assert.equal(e.length, W.WIDGETS.length)
  })
  test('Leser ohne E&A: Finanzen und Schnellaktionen nicht angeboten, aber im Layout behalten', () => {
    const e = W.editorEintraege([{ id: 'finanzen' }, { id: 'kellerbestand' }], LESER_OHNE_EA)
    assert.deepEqual(e.filter(x => !x.verfuegbar).map(x => x.id), ['finanzen'])
    assert.ok(!ids(e).includes('schnellaktionen'), 'ausgeblendet und nicht verfügbar → gar nicht angeboten')
    assert.deepEqual(W.layoutAusEditor(e), [{ id: 'finanzen' }, { id: 'kellerbestand' }])
  })
  test('Größenwahl nur bei Widgets mit mehreren Größen', () => {
    const e = Object.fromEntries(W.editorEintraege(null, ALLES).map(x => [x.id, x.groessen]))
    assert.deepEqual(e['morgenbericht'], ['mittel', 'breit'])
    assert.deepEqual(e['kellerbestand'], ['klein'])
    assert.deepEqual(e['finanzen'], ['breit'])
  })
})

describe('verschieben', () => {
  const liste = W.editorEintraege([{ id: 'kellerbestand' }, { id: 'finanzen' }, { id: 'morgenbericht' }], LESER_OHNE_EA)
  test('über nicht verfügbare hinweg, die an ihrem Platz bleiben', () => {
    const l = W.verschieben(liste, 'morgenbericht', -1)
    assert.deepEqual(ids(l).slice(0, 3), ['morgenbericht', 'finanzen', 'kellerbestand'])
  })
  test('am Rand und für nicht verfügbare unverändert', () => {
    assert.deepEqual(ids(W.verschieben(liste, 'kellerbestand', -1)), ids(liste))
    assert.deepEqual(ids(W.verschieben(liste, 'finanzen', 1)), ids(liste))
  })
  test('Ziehen an die Stelle eines anderen', () => {
    const l = W.verschiebenNach(liste, 'morgenbericht', 'kellerbestand')
    assert.equal(l[0].id, 'morgenbericht')
    assert.deepEqual(ids(W.verschiebenNach(liste, 'morgenbericht', 'finanzen')), ids(liste), 'nicht auf nicht verfügbare')
  })
  test('layoutAusEditor: nur eingeblendete in Reihenfolge, Größe nur bei Abweichung', () => {
    const l = W.editorEintraege(null, ALLES).map(x => x.id === 'morgenbericht' ? { ...x, an: false } : x.id === 'naechste-schritte' ? { ...x, groesse: 'breit' } : x)
    const lay = W.layoutAusEditor(l)
    assert.ok(!ids(lay).includes('morgenbericht'))
    assert.deepEqual(lay.find(x => x.id === 'naechste-schritte'), { id: 'naechste-schritte', groesse: 'breit' })
    assert.deepEqual(lay.find(x => x.id === 'kellerbestand'), { id: 'kellerbestand' })
  })
})

describe('Verdrahtung', () => {
  test('Seite: eigenes Layout je Benutzer, Fehler → Standard mit Hinweis', () => {
    const p = quelle('src/app/(dashboard)/dashboard/page.tsx')
    assert.match(p, /ctx\.q\('benutzer_dashboard'\)\.select\('layout'\)\.eq\('user_id', ctx\.userId\)\.maybeSingle\(\)/)
    assert.match(p, /const eigenesLayout = layoutRes\.error \? null : layoutPruefen\(/)
    assert.match(p, /sichtbareWidgets\(eigenesLayout \?\? STANDARD_LAYOUT, kontext\)/)
    assert.match(p, /<DashboardAnpassen eintraege=\{editorEintraege\(eigenesLayout, kontext\)\}/)
  })
  test('Server Actions: nur eigene Zeile (user_id aus getUser), Layout geprüft, 0 Zeilen = nicht gespeichert', () => {
    const a = quelle('src/app/(dashboard)/dashboard/actions.ts')
    assert.match(a, /^'use server'/)
    assert.equal((a.match(/supabase\.auth\.getUser\(\)/g) ?? []).length, 2)
    assert.match(a, /\.upsert\(\{ user_id: user\.id, layout,/)
    assert.match(a, /\.delete\(\)\.eq\('user_id', user\.id\)/)
    assert.match(a, /const layout = layoutPruefen\(roh\)/)
    assert.match(a, /if \(!data \|\| data\.length === 0\) return \{ ok: false, fehler: NICHT_GESPEICHERT \}/)
    assert.doesNotMatch(a, /createSupabaseAdminClient/, 'kein Service-Role-Client – die RLS entscheidet')
  })
  test('Fenster: Rückfrage beim Zurücksetzen, Laden mit finally, Speichern über layoutAusEditor', () => {
    const f = quelle('src/app/(dashboard)/dashboard/_widgets/DashboardAnpassen.tsx')
    assert.match(f, /await rueckfrage\(\{ titel: 'Dashboard auf Standard zurücksetzen\?'/)
    assert.match(f, /dashboardSpeichern\(layoutAusEditor\(liste\)\)/)
    assert.equal((f.match(/finally \{\s*setLaeuft\(false\)/g) ?? []).length, 2)
    assert.match(f, /useDialog\(true,/)
  })
  test('Migrationsentwurf bzw. Migration: eigene Zeile, TO authenticated, zwei_faktor_aal, CHECK', () => {
    // eingespielt: supabase/migrations/<version>_kan388_…; davor nur der (nicht eingecheckte) Entwurf
    const mig = readdirSync(new URL('../../supabase/migrations/', import.meta.url)).find(n => n.endsWith('_kan388_benutzer_dashboard.sql'))
    const pfad = mig ? `supabase/migrations/${mig}` : 'supabase/entwurf/kan388_benutzer_dashboard.sql'
    if (!mig && !existsSync(new URL(`../../${pfad}`, import.meta.url))) return
    const m = quelle(pfad)
    assert.match(m, /CREATE POLICY benutzer_dashboard_eigen ON public\.benutzer_dashboard FOR ALL TO authenticated\s+USING \(user_id = \(SELECT auth\.uid\(\)\)\)\s+WITH CHECK \(user_id = \(SELECT auth\.uid\(\)\)\)/)
    assert.match(m, /CREATE POLICY zwei_faktor_aal ON public\.benutzer_dashboard AS RESTRICTIVE FOR ALL TO authenticated/)
    assert.match(m, /jsonb_array_length\(layout\) <= 50/)
  })
})

