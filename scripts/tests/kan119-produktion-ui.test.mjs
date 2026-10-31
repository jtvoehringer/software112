// KAN-119 (08.10.2026) – Produktion: Assistent in drei Schritten (Art → Eingänge → neue Charge), Einträge im Schnellzugriff
// und in Strg K nur für schreibberechtigte Rollen, Demo-Sekt des Musterhofs über die Produktion.
//
// Aufruf:  npm run -s test:csv   (alle scripts/tests/*.test.mjs)
// BSM-Seite (Abgang Weinspalte, Zugang „Perlwein und Schaumwein“/„Sonstige“): kan43-bsm.test.mjs Test 1g; Demo: DB-Test 66.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { PRODUKTION_SCHRITTE, produktionFehler } from '../../src/lib/kellerbuch/produktion.ts'

const quelle = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const migration = () => {
  const f = readdirSync(new URL('../../supabase/migrations', import.meta.url)).find(n => n.endsWith('_kan119_demo_sekt_produktion.sql'))
  return quelle(f ? `supabase/migrations/${f}` : 'supabase/entwurf/kan119_demo_sekt_produktion.sql')
}

const gv = { weinausbauId: 'w1', menge: 600, bestand: 600, weinart: 'weiss', name: 'GV' }
const leer = { art: 'spritzer', name: '', behaelterId: '', datum: '2026-10-08', heute: '2026-10-08', wein: [], zutaten: [] }

describe('KAN-119: Assistent – Prüfung je Schritt', () => {
  test('drei Schritte mit Namen', () => {
    assert.deepEqual(PRODUKTION_SCHRITTE, { 1: 'Art', 2: 'Eingänge', 3: 'Neue Charge' })
  })
  test('Schritt 1 prüft nur Art, Erzeugnis und Datum', () => {
    assert.deepEqual(produktionFehler(leer, 1), [])
    assert.ok(produktionFehler({ ...leer, datum: '2026-10-09' }, 1).some(f => /Zukunft/.test(f)))
    assert.ok(produktionFehler({ ...leer, art: 'perlwein', erzeugnis: 'WEINHALT' }, 1).some(f => /Erzeugnis/.test(f)))
  })
  test('Schritt 2 prüft Wein und Zutaten, nicht Name und Gebinde', () => {
    assert.ok(produktionFehler(leer, 2).some(f => /Quell-Charge/.test(f)))
    assert.deepEqual(produktionFehler({ ...leer, wein: [gv] }, 2), [])
    assert.ok(produktionFehler({ ...leer, wein: [{ ...gv, menge: 300 }], zutaten: [{ art: 'wasser', menge: 400, einheit: 'l' }] }, 2)
      .some(f => /mindestens 50 % Wein/.test(f)))
    assert.ok(!produktionFehler({ ...leer, datum: '2026-10-09', wein: [gv] }, 2).some(f => /Zukunft/.test(f)))
  })
  test('Schritt 3 prüft Name und Gebinde; ohne Schritt alles wie bisher', () => {
    assert.deepEqual(produktionFehler({ ...leer, wein: [gv] }, 3), ['Bitte Name und Gebinde der neuen Charge angeben.'])
    assert.deepEqual(produktionFehler({ ...leer, name: 'Spritzer', behaelterId: 'b1' }, 3), [])
    const alle = produktionFehler({ ...leer, datum: '2026-10-09' })
    for (const m of [/Zukunft/, /Name und Gebinde/, /Quell-Charge/]) assert.ok(alle.some(f => m.test(f)), String(m))
  })
})

describe('KAN-119: Verdrahtung', () => {
  test('Assistent unter /kellerbuch/produktion/neu; Liste verlinkt dorthin, alte ?quelle=-Links leiten weiter', () => {
    const neu = quelle('src/app/(dashboard)/kellerbuch/produktion/neu/page.tsx')
    assert.match(neu, /canWrite\(membership, 'kellerbuch'\) && !\(await schreibSperre\(membership\)\)/)
    assert.match(neu, /<ProduktionForm /)
    const liste = quelle('src/app/(dashboard)/kellerbuch/produktion/page.tsx')
    assert.doesNotMatch(liste, /<ProduktionForm /)
    assert.match(liste, /href="\/kellerbuch\/produktion\/neu"/)
    assert.match(liste, /if \(quelle\) redirect\(`\/kellerbuch\/produktion\/neu\?quelle=/)
    assert.match(quelle('src/app/(dashboard)/kellerbuch/weinausbau/[id]/page.tsx'), /\/kellerbuch\/produktion\/neu\?quelle=\$\{weinausbau\.id\}/)
    const form = quelle('src/app/(dashboard)/kellerbuch/produktion/ProduktionForm.tsx')
    assert.match(form, /produktionFehler\(eingabe, schritt\)/)
    assert.match(form, /aria-current=\{s === schritt \? 'step' : undefined\}/)
  })
  test('Schnellzugriff: „Produktion“ nur mit Schreibrecht im Kellerbuch', () => {
    const d = quelle('src/app/(dashboard)/dashboard/_widgets/schnell.tsx') // seit KAN-387 Widget der Übersicht
    assert.match(d, /\.\.\.\(canWrite\(ctx\.role, 'kellerbuch'\) \? \[\{ href: '\/kellerbuch\/produktion\/neu', icon: Sparkles, label: 'Produktion' \}\] : \[\]\)/)
    assert.match(d, /\{schnellzugriff\.map\(item =>/)
  })
  test('Strg K: Aktion „Produktion“ nur bei darfSchreiben, mit den Suchwörtern aus dem Ticket', () => {
    const c = quelle('src/components/CommandPalette.tsx')
    const zeile = c.split('\n').find(z => z.includes("id: 'a:produktion'"))
    assert.ok(zeile, 'Eintrag a:produktion fehlt')
    assert.match(zeile, /href: '\/kellerbuch\/produktion\/neu'/)
    for (const w of ['spritzer', 'perlwein', 'sekt', 'petnat', 'mischgetränk']) assert.ok(zeile.includes(w), w)
    // steht in der Aktionsliste, die es nur mit darfSchreiben gibt (Leser: leere Liste)
    const start = c.indexOf('const aktionen: Eintrag[] = darfSchreiben ? [')
    const ende = c.indexOf('] : []', start)
    assert.ok(start > 0 && c.indexOf("id: 'a:produktion'") > start && c.indexOf("id: 'a:produktion'") < ende)
  })
  test('Demo-Sekt: Grundwein → Produktion Schaumwein/Sekt g.U. → Tirage-Charge → Füllung', () => {
    const m = migration()
    assert.match(m, /CREATE OR REPLACE FUNCTION public\.demo_musterhof_y2_kette\(\)/)
    assert.match(m, /insert into produktionen .*\n\s+erstellt_von_name, erstellt_am\)\n\s+values \(demo_musterhof_id\(66,1\), c_t, make_date\(y1,3,20\), 'schaumwein', 'SEKTGU', demo_musterhof_id\(11,43\)/)
    assert.match(m, /update fuellungen set weinausbau_id = demo_musterhof_id\(11, v_ch\)/)
    assert.match(m, /delete from produktionen where tenant_id = c_t and id = demo_musterhof_id\(66,1\);  -- storno-ausnahme:/)
    assert.match(m, /REVOKE EXECUTE ON FUNCTION public\.demo_musterhof_y2_kette\(\) FROM PUBLIC, anon, authenticated;/)
  })
})

// UAT 23.10.2026 (Testfall 4.20): „Wie storniere ich eine Produktion?“ – der Storno lag nur in /kellerbuch/produktion,
// die über keinen Menüpunkt erreichbar war; auf der Seite der erzeugten Charge gab es keinen Hinweis.
describe('UAT 4.20: Produktion stornieren ist auffindbar', () => {
  test('Kellerbuch-Navigation hat den Reiter „Produktion“ (Liste mit Storno)', () => {
    const n = quelle('src/lib/navigation/index.ts')
    const kb = n.slice(n.indexOf("key: 'kellerbuch'"), n.indexOf("key: 'warenwirtschaft'"))
    assert.match(kb, /\{ href: '\/kellerbuch\/produktion',\s+label: 'Produktion',[^}]*keywords: '[^']*storno[^']*' \}/)
  })
  test('Seite der erzeugten Charge: „Entstanden durch Produktion“ mit Storno (nur Schreibrecht, ohne Nur-Lesen-Modus)', () => {
    const s = quelle('src/app/(dashboard)/kellerbuch/weinausbau/[id]/page.tsx')
    assert.match(s, /\.from\('produktionen'\) as any\)\s*\.select\('id, datum, art'\)\s*\.eq\('tenant_id', tenantId\)\.eq\('ziel_weinausbau_id', weinausbau\.id\)\.is\('storniert_am', null\)/)
    assert.match(s, /\.order\('id'\)\.limit\(1\), 'Produktion der Charge'\)/, 'Ladefehler über geladen()')
    assert.match(s, /const produktionStornoErlaubt = !!entstandenDurch && writeOk && !!membership && !\(await schreibSperre\(membership\)\)/)
    assert.match(s, /Entstanden durch Produktion/)
    assert.match(s, /\{produktionStornoErlaubt && \(\s*<StornoButton action=\{produktionStornieren\.bind\(null, String\(entstandenDurch\.id\)\)\}/)
  })
  test('Storno lädt auch die Chargen-Seiten neu', () => {
    const a = quelle('src/app/(dashboard)/kellerbuch/produktion/actions.ts')
    const storno = a.slice(a.indexOf('export async function produktionStornieren'))
    assert.match(storno, /revalidatePath\('\/kellerbuch\/weinausbau', 'layout'\)/)
  })
})
