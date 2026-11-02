// KAN-394 Nachtrag 3 (02.11.2026, Entscheidung Jörgen: „die Verteilung hat auf die GST zu erfolgen. Der Schritt bei der
// Ernte, wo man die ganze Ried auf einmal ernten kann, ist lediglich Komfort – die Pressungen gehen dann von den GST weg“).
// Nebenbefunde: „Storno nicht möglich“ (Prüfung zählte am GST nur direkt erfasste kg) und „scrollen“ (Stift/Storno erst nach
// waagrechtem Scrollen sichtbar).
//
// Aufruf:  npm run -s test:csv   (alle scripts/tests/*.test.mjs)

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { gstLeseMinderung, gstWaehlenText } from '../../src/lib/wein/leseBilanz.ts'

const WURZEL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const quelle = (p) => readFileSync(path.join(WURZEL, p), 'utf8').replace(/\r\n/g, '\n')

describe('KAN-394 Nachtrag 3: Storno/Kürzen prüft am GST mit dem Anteil der Ried-Lese', () => {
  // Musterhof, Wachtberg Weißburgunder (nur GST 977/1): Ried-Lese 4.000 kg ohne GST, Lese 5.000 kg auf 977/1, Pressung 4.000 kg
  const wachtberg = [{ id: 'ried', grundstueck_id: null, kg: 4000 }, { id: 'neu', grundstueck_id: 'g977_1', kg: 5000 }]
  test('Regression Screenshot „Storno nicht möglich“: nach dem Storno bleiben 4.000 kg am GST (vorher gerechnet: 0)', () => {
    const m = gstLeseMinderung(wachtberg, 'neu', 0, [{ id: 'g977_1', flaeche_ha: 0.8 }])
    assert.deepEqual(m.get('g977_1'), { vorher: 9000, nachher: 4000 })   // 4.000 kg verpresst → gedeckt, Storno geht
  })
  test('Storno einer Ried-Lese mindert jedes GST um seinen Anteil', () => {
    const gst = [{ id: 'a', flaeche_ha: 0.8 }, { id: 'b', flaeche_ha: 0.6 }]
    const m = gstLeseMinderung([{ id: 'ried', grundstueck_id: null, kg: 4000 }, { id: 'x', grundstueck_id: 'a', kg: 100 }], 'ried', 0, gst)
    assert.deepEqual(m.get('a'), { vorher: 2386, nachher: 100 })
    assert.deepEqual(m.get('b'), { vorher: 1714, nachher: 0 })
  })
  test('Kürzen auf mehr als bisher bzw. ein anderes GST: nur die geminderten GST', () => {
    const gst = [{ id: 'a', flaeche_ha: 1 }, { id: 'b', flaeche_ha: 1 }]
    const zeilen = [{ id: 'x', grundstueck_id: 'a', kg: 500 }, { id: 'y', grundstueck_id: 'b', kg: 300 }]
    assert.equal(gstLeseMinderung(zeilen, 'x', 600, gst).size, 0)
    assert.deepEqual([...gstLeseMinderung(zeilen, 'x', 200, gst).keys()], ['a'])
  })
  test('Server: pruefeLesemengeGedeckt lädt die Weinbau-GST der Ried und prüft je GST mit gstLeseMinderung', () => {
    const a = quelle('src/app/(dashboard)/erntemeldung/actions.ts')
    const f = a.slice(a.indexOf('async function pruefeLesemengeGedeckt('), a.indexOf('// Mehrfacherfassung'))
    assert.match(f, /alle<AR>\(supabase\.from\('grundstuecke'\)\s*\.select\('id, gst_nr, flaeche_ha, aktiv, deaktiviert_am'\)\.eq\('tenant_id', tenantId\)\.eq\('weingarten_id', alt\.weingarten_id\)\s*\.eq\('nutzart', 'WI'\)/)
    assert.match(f, /const gstRied = \(\(gstRes\.data \?\? \[\]\) as AR\[\]\)\.filter\(g => gstImJahr\(g, jahr\)\)/)
    assert.match(f, /const minderungJeGst = gstLeseMinderung\(/)
    assert.match(f, /\.select\('id, grundstueck_id, menge_kg'\)/)
  })
})

describe('KAN-394 Nachtrag 3: Lese, Pressung und Traubenverkauf je GST', () => {
  test('Lese bearbeiten/erfassen: an einer Ried mit GST nur mit GST (Altdaten ohne GST bleiben bearbeitbar)', () => {
    const a = quelle('src/app/(dashboard)/erntemeldung/actions.ts')
    const f = a.slice(a.indexOf('export async function upsertErnteParzelle('), a.indexOf('// ── Lesemenge gegen Verpresstes'))
    assert.match(f, /if \(weingartenId && !grundstueckId && !\(alt && alt\.weingarten_id === weingartenId && !alt\.grundstueck_id\)\s*&& \(await riedenMitGst\(supabase, tenantId, \[weingartenId\], Number\(jgRow\.jahrgang\)\)\)\.has\(weingartenId\)\) \{\s*throw new AktionsFehler\(GST_PFLICHT_MELDUNG\)/)
    // vor dem Schreiben
    assert.ok(f.indexOf('GST_PFLICHT_MELDUNG') < f.indexOf(".update(payload)"))
    const e = quelle('src/app/(dashboard)/erntemeldung/[id]/ErnteDetailClient.tsx')
    assert.match(e, /const ohneGstErlaubt = !!parzelle && !parzelle\.grundstueck_id && parzelle\.weingarten_id === selWgId/)
    assert.match(e, /required=\{!ohneGstErlaubt\}/)
    assert.doesNotMatch(e, /<option value="">– kein GST –<\/option>/)
  })
  test('Pressung: neue bzw. umgehängte Traubenzeilen ohne GST an einer Ried mit GST werden abgelehnt', () => {
    const a = quelle('src/app/(dashboard)/erntemeldung/actions.ts')
    const f = a.slice(a.indexOf('export async function upsertPressung('), a.indexOf('export async function stornoPressung('))
    assert.match(f, /const ohneGst = weingaerten\.filter\(w => w\.weingarten_id && !w\.grundstueck_id && !w\.zukauf_posten_id\s*&& !pwAlt\.some\(a => a\.id === w\.id && a\.weingarten_id === w\.weingarten_id && !a\.grundstueck_id\)\)/)
    assert.match(f, /riedenMitGst\(supabase, tenantId, ohneGst\.map/)
    assert.ok(f.indexOf('riedenMitGst(') < f.indexOf('// ── Schreiben'))
  })
  test('Traubenverkauf (beide Wege über traubenverkaufLese): ohne GST nur an Rieden ohne GST', () => {
    const s = quelle('src/lib/wein/leseBilanz.ts')
    const f = s.slice(s.indexOf('export async function traubenverkaufLese('))
    assert.match(f, /if \(!p\.grundstueckId && !\(alt && alt\.weingarten_id === p\.weingartenId && !alt\.grundstueck_id\)\s*&& \(await riedenMitGst\(supabase, tenantId, \[p\.weingartenId\], jahrgang\)\)\.has\(p\.weingartenId\)\)/)
    assert.match(gstWaehlenText('Gebling'), /^Bitte das Grundstück \(GST\) wählen – „Gebling“ hat Grundstücke/)
    assert.match(s, /\.eq\('nutzart', 'WI'\)\s*\.in\('weingarten_id', b\)\.order\('id'\)\)\)/)
  })
  test('Auswahllisten: Lese ohne GST erscheint als GST-Anteile (Pressung, Traubenverkauf, Lesetage), „ganzer Weingarten“ nur ohne GST', () => {
    const k = quelle('src/app/(dashboard)/erntemeldung/[id]/leseKontext.ts')
    for (const re of [/for \(const p of parzellenJeGst\) \{\n\s+if \(p\.grundstueck_id && !gstRowsMap\.has/, /for \(const p of parzellenJeGst\) \{\n\s+const key = /, /const leseEintraege: LeseEintrag\[\] = parzellenJeGst\.map/]) {
      assert.match(k, re)
    }
    assert.match(k, /return g \? \{ \.\.\.p, menge_kg: kg, grundstueck_nr: g\.gst_nr, grundstueck_rebsorte: g\.rebsorte \} : \{ \.\.\.p, menge_kg: kg \}/)
  })
})

describe('KAN-394 Nachtrag 3: Demo-Musterhof legt Lese und Pressung je GST an (Migration)', () => {
  const m = quelle('supabase/migrations/20261102114052_kan394_musterhof_lese_je_gst.sql')
  test('Funktion nur für den Demo-Mandanten, ohne Rechte für API-Rollen, Freeze nur im Lauf frei', () => {
    assert.match(m, /c_t constant uuid := '33333333-3333-4333-8333-333333333333'/)
    assert.match(m, /SECURITY DEFINER\nSET search_path = public/)
    assert.match(m, /REVOKE EXECUTE ON FUNCTION public\.demo_musterhof_lese_je_gst\(\) FROM PUBLIC, anon, authenticated;/)
    assert.match(m, /set_config\('s112\.freeze_frei', '\*', true\)[^]*set_config\('s112\.freeze_frei', '', true\)/)
    // nichts wird gelöscht (Lesedaten und Pressungen sind berichtsrelevant)
    assert.doesNotMatch(m, /\bDELETE\b/i)
    // ohne Hilfstabellen (Probelauf auf Produktion ohne COMMIT)
    assert.doesNotMatch(m, /COMMIT|pg_temp|TEMP TABLE/i)
  })
  test('Aufteilung wie riedLeseVerteilen: Fläche (sonst gleich), Rest an das letzte GST nach gst_nr, id; feste IDs', () => {
    assert.match(m, /CASE WHEN bool_and\(x\.flaeche > 0\) OVER \(\) THEN x\.flaeche ELSE 1 END AS gewicht/)
    assert.match(m, /row_number\(\) OVER \(ORDER BY g2\.gst_nr, g2\.id\)/)
    assert.match(m, /CASE WHEN g\.nr = g\.n THEN v_rest ELSE round\(r\.menge_kg \* g\.gewicht \/ g\.summe, 0\) END/)
    assert.match(m, /md5\(r\.id::text \|\| g\.id::text\)::uuid/)
  })
  test('Aufruf am Ende von Schritt 1 und nach demo_musterhof_kellerbuch() in Schritt 2, mit Selbstprüfung', () => {
    assert.match(m, /pg_get_functiondef\('public\.demo_musterhof_zuruecksetzen\(\)'::regprocedure\)/)
    assert.match(m, /c_alt constant text := '  perform demo_musterhof_kellerbuch\(\);'/)
    assert.match(m, /RAISE EXCEPTION 'KAN-394: Aufruf fehlt in demo_musterhof_y2_kette'/)
    assert.match(quelle('scripts/db-tests/_helfer.sql'), /\('intern', +'--S', false, 'demo_musterhof_lese_je_gst\(\)'\)/)
  })
})

describe('KAN-394 Nachtrag 3: Demo-Musterhof Lesedaten zu den Vorjahres-Pressungen (Migration)', () => {
  const m = quelle('supabase/migrations/20261102120750_kan394_musterhof_lese_2024.sql')
  test('je Traubenzeile der drei Vorjahres-Pressungen eine Lesezeile mit Ried, GST und kg, feste IDs, ohne Doppel', () => {
    assert.match(m, /insert into ernte_parzellen \(id, jahrgang_id, lese_id, weingarten_id, grundstueck_id,/)
    assert.match(m, /p\.lese_id, pw\.weingarten_id, pw\.grundstueck_id,/)
    assert.match(m, /pw\.ernte_datum, pw\.trauben_kg,/)
    assert.match(m, /p\.id in \(demo_musterhof_id\(9,40\), demo_musterhof_id\(9,41\), demo_musterhof_id\(9,42\)\)/)
    assert.match(m, /on conflict \(id\) do nothing;/)
    // vor dem Kellerbuch-Abschluss (Periodensperre) – Selbstprüfung in der Migration
    assert.match(m, /position\('demo_musterhof_id\(38, 240 \+' in v_def\) > position\('perform demo_musterhof_kellerbuch\(\);' in v_def\)/)
    assert.doesNotMatch(m, /COMMIT|pg_temp/i)
  })
  test('demo_musterhof_lesen räumt auch die GST-Anteile der Vorjahres-Lesen ab Nr. 2 weg (zweiter Aufruf von y2_kette)', () => {
    assert.match(m, /or lese_id in \(select id from lesen where tenant_id = c_t and jahrgang_id = jg_y1 and lfd_nr > 1\)\);/)
  })
})

describe('KAN-394 Nachtrag 3: Stift und Storno ohne waagrechtes Scrollen', () => {
  test('Tabelle erst ab lg, „Ernte abgeschlossen öffnen“ bricht um; Aktionen bleiben unfixiert (KAN-328/339)', () => {
    const e = quelle('src/app/(dashboard)/erntemeldung/[id]/ErnteDetailClient.tsx')
    assert.match(e, /<div className="hidden lg:block print:block border border-s112-border rounded-xl overflow-x-auto/)
    assert.match(e, /<div className="lg:hidden print:hidden space-y-2">/)
    const u = e.slice(e.indexOf('function ErnteAbschlussUmschalter('), e.indexOf('function RiedName('))
    assert.match(u, /<span className="block font-sans text-\[11px\] leading-tight" data-print="hide">/)
    assert.doesNotMatch(u, /whitespace-nowrap/)
  })
})
