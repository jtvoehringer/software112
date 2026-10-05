// Wächter gegen still gekappte Vollabfragen (scripts/check-alle.js, 05.10.2026)
// Hintergrund: PostgREST liefert höchstens 1.000 Zeilen je Anfrage; der Datenimport ordnete deshalb bei Gebeshuber
// 4.164 Kontakte keiner Firma zu (PR #232). Vollständig gebrauchte Mengen laufen über alle() aus src/lib/supabase/alle.ts.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'

const require = createRequire(import.meta.url)
const c = require('../check-alle.js')
// Schnipsel in eine async-Funktion: ein Top-Level-await ohne import/export liest TypeScript sonst als Aufruf von „await“
const inFn = t => `async function f() {
${t}
}`
const regeln = t => c.pruefeText(inFn(t), 'src/x.ts').funde.map(f => [f.regel, f.tabelle])

test('Vollabfrage auf großer Tabelle ist ein Fund, kleine Tabelle und Schreibzugriffe nicht', () => {
  assert.deepEqual(regeln(`const { data } = await (supabase.from('firmen') as any).select('id, name').eq('tenant_id', t)`),
    [['VOLLABFRAGE', 'firmen']])
  assert.deepEqual(regeln(`await supabase.from('rabattgruppen').select('id').eq('tenant_id', t)`), [])
  assert.deepEqual(regeln(`await supabase.from('kontakte').update({ aktiv: false }).eq('tenant_id', t).select()`), [])
  assert.deepEqual(regeln(`await supabase.from('kontakte').insert({ tenant_id: t }).select('id').single()`), [])
})

test('Datums-, Status- und Ja/Nein-Filter schränken nicht ein', () => {
  const t = `await (supabase.from('verkaufsposten') as any).select('id').eq('tenant_id', t).eq('aktiv', true).eq('storniert', false).gte('datum', von).lte('datum', bis)`
  assert.deepEqual(regeln(t), [['VOLLABFRAGE', 'verkaufsposten']])
})

test('alle() direkt, über tf(), über eine Variable oder eine Hilfsfunktion der Datei gilt als gepaged', () => {
  assert.deepEqual(regeln(`await alle((supabase.from('firmen') as any).select('id').eq('tenant_id', t).order('id'))`), [])
  assert.deepEqual(regeln(`await alle<R>(tf((supabase.from('kontakte') as any).select('id').order('nachname').order('id')))`), [])
  assert.deepEqual(regeln(`let q = (supabase.from('kontakte') as any).select('id').eq('tenant_id', t)\nif (x) q = q.eq('aktiv', true)\nconst r = await alle(q.order('id'))`), [])
  assert.deepEqual(regeln(`async function liste(query: any, tab: string) { const { data } = await alle<R>(query); return data }\nawait liste((supabase.from('verkauf_positionen') as any).select('id').eq('tenant_id', t).order('id'), 'vp')`), [])
  // Hilfsfunktion ohne alle() bleibt ein Fund
  assert.deepEqual(regeln(`async function holen(query: any) { const { data } = await query; return data }\nawait holen((supabase.from('firmen') as any).select('id').eq('tenant_id', t))`),
    [['VOLLABFRAGE', 'firmen']])
})

test('alle() ohne .order() ist ein eigener Fund (Blöcke brauchen stabile Reihenfolge)', () => {
  assert.deepEqual(regeln(`await alle((supabase.from('firmen') as any).select('id').eq('tenant_id', t))`), [['ALLE_OHNE_ORDER', 'firmen']])
})

test('Seitenweise Liste, Top-N, Einzelsatz, Zählung, Elternzeile und Suche sind keine Funde', () => {
  assert.deepEqual(regeln(`let q = (client.from('kontakte') as any).select('id', { count: 'exact' }).eq('tenant_id', t)\nq = q.eq('aktiv', true)\nconst { data } = await q.order('nachname').order('id').range(0, f.n - 1)`), [])
  assert.deepEqual(regeln(`await supabase.from('kontakte').select('id').eq('tenant_id', t).order('nachname').limit(50)`), [])
  assert.deepEqual(regeln(`await supabase.from('firmen').select('*').eq('id', id).eq('tenant_id', t).maybeSingle()`), [])
  assert.deepEqual(regeln(`await supabase.from('kontakte').select('id', { count: 'exact', head: true }).eq('tenant_id', t)`), [])
  assert.deepEqual(regeln(`await supabase.from('aktivitaeten').select('id').eq('tenant_id', t).eq('kontakt_id', k)`), [])
  assert.deepEqual(regeln(`await supabase.from('kontakte').select('id').eq('tenant_id', t).ilike('nachname', q + '%')`), [])
  assert.deepEqual(regeln('await supabase.from(\'firmen\').select(\'id\').eq(\'tenant_id\', t).or(`name.ilike.%${q}%,ort.ilike.%${q}%`)'), [])
  // tenant_id ist keine Einschränkung im Sinn des Wächters
  assert.deepEqual(regeln(`await supabase.from('firmen').select('id').in('tenant_id', ids)`), [['VOLLABFRAGE', 'firmen']])
})

test('Ausnahme mit Grund ≥ 15 Zeichen in der Zeile davor; zu kurz ist ein Fund', () => {
  const ok = c.pruefeText(inFn(`// alle-ausnahme: nur Spritzungen der letzten 45 Tage\nawait supabase.from('behandlungen').select('id').eq('tenant_id', t)`), 'src/z.ts')
  assert.equal(ok.funde.length, 0)
  assert.equal(ok.ausnahmen.length, 1)
  const kurz = c.pruefeText(inFn(`await supabase.from('behandlungen').select('id').eq('tenant_id', t) // alle-ausnahme: klein`), 'src/z.ts')
  assert.match(kurz.funde[0].text, /ohne ausreichenden Grund/)
})

test('ganzes Projekt ohne Fund, im prebuild, große Tabellen enthalten den Befund vom 05.10.2026', () => {
  const r = c.pruefeWurzel()
  assert.deepEqual(r.funde, [])
  // Stand 05.10.2026: 1 Vollabfrage (Wetter) + 15 kleine .in()-Listen – jede neue Ausnahme bewusst hier nachziehen
  assert.ok(r.ausnahmen.length <= 16, `neue alle-ausnahme? ${JSON.stringify(r.ausnahmen)}`)
  for (const a of r.ausnahmen) assert.ok(a.grund.length >= c.MIN_GRUND, `${a.datei}:${a.zeile}`)
  const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'))
  assert.match(pkg.scripts.prebuild, /check-alle\.js/)
  for (const t of ['kontakte', 'firmen', 'grundstuecke', 'behandlung_grundstuecke', 'verkaufsposten', 'ea_transaktionen'])
    assert.ok(c.GROSSE_TABELLEN.includes(t), t)
})

test('Kellertabellen (05.10.2026) sind große Tabellen, lesen bewusst nicht', () => {
  for (const t of ['weinausbau', 'behaelter', 'fuellungen', 'fuellung_chargen', 'zukauf_posten', 'traubenverkauf',
    'keller_umzuege', 'keller_behandlungen', 'weinanalysen', 'verschneidungen', 'pressungen', 'pressung_weingaerten',
    'ernte_parzellen', 'dac_antrag'])
    assert.ok(c.GROSSE_TABELLEN.includes(t), t)
  assert.ok(!c.GROSSE_TABELLEN.includes('lesen'))
  assert.deepEqual(regeln(`await tf((supabase.from('weinausbau') as any).select('id').eq('aktiv', true).order('name'))`),
    [['VOLLABFRAGE', 'weinausbau']])
})

test('Fabrik ohne Parameter: gepaged, wenn jede Aufrufstelle über alle() läuft', () => {
  const fabrik = `const tvAbfrage = () => (supabase.from('traubenverkauf') as any).select('id').eq('tenant_id', t)\n`
  assert.deepEqual(regeln(fabrik + `const a = await alle(tvAbfrage().eq('lese_id', l).order('id'))\nlet q = tvAbfrage()\nq = q.eq('x', 1)\nawait alle(q.order('id'))`), [])
  // eine ungepagte Aufrufstelle reicht für einen Fund
  assert.deepEqual(regeln(fabrik + `await alle(tvAbfrage().order('id'))\nconst { data } = await tvAbfrage()`), [['VOLLABFRAGE', 'traubenverkauf']])
  // Fabrik ohne Aufruf ist ein Fund (nichts belegt die Begrenzung)
  assert.deepEqual(regeln(fabrik), [['VOLLABFRAGE', 'traubenverkauf']])
})

// ── Regel IN_OHNE_BLOECKE: .in()-Listen mit Werten aus großen Tabellen ──────────────────────────────────────────
const LADEN = `const { data } = await alle(supabase.from('kontakte').select('id').eq('tenant_id', t).order('id'))\nconst ids = (data ?? []).map(k => k.id)\n`

test('IN_OHNE_BLOECKE: Liste aus einer Abfrage auf großer Tabelle ohne Blöcke ist ein Fund', () => {
  assert.deepEqual(regeln(LADEN + `await supabase.from('aktivitaeten').select('id').in('kontakt_id', ids)`), [['IN_OHNE_BLOECKE', 'kontakte']])
  // auch über mehrere Zuweisungen und Promise.all-Destrukturierung
  const pa = `const [{ data: a }, { data: f }] = await Promise.all([alle(supabase.from('rabattgruppen').select('id').order('id')), alle(supabase.from('firmen').select('id').eq('tenant_id', t).order('id'))])\nconst roh = (f ?? []) as R[]\nconst fIds = [...new Set(roh.map(x => x.id))]\n`
  assert.deepEqual(regeln(pa + `await supabase.from('kontakte').select('id').in('firma_id', fIds)`), [['IN_OHNE_BLOECKE', 'firmen']])
  // die Quelle aus der kleinen Tabelle (Index 0) ist kein Fund
  assert.deepEqual(regeln(pa.replace('const roh = (f ?? [])', 'const roh = (a ?? [])') + `await supabase.from('kontakte').select('id').in('firma_id', fIds)`), [])
  // auch update/delete stehen in der URL
  assert.deepEqual(regeln(LADEN + `await supabase.from('kontakte').update({ aktiv: false }).in('id', ids)`), [['IN_OHNE_BLOECKE', 'kontakte']])
})

test('IN_OHNE_BLOECKE: inBloecken, Schleife über bloecke() und slice(i, i + ≤ 100) gelten als geblockt', () => {
  assert.deepEqual(regeln(LADEN + `await inBloecken(ids, b => alle(supabase.from('aktivitaeten').select('id').in('kontakt_id', b).order('id')))`), [])
  assert.deepEqual(regeln(LADEN + `for (const block of bloecke(ids)) await supabase.from('kontakte').delete().in('id', block)`), [])
  assert.deepEqual(regeln(LADEN + `for (let i = 0; i < ids.length; i += 100) await supabase.from('kontakte').delete().in('id', ids.slice(i, i + 100))`), [])
  // Blöcke zu 500 (≈ 18 KB URL) sind zu groß
  assert.deepEqual(regeln(LADEN + `for (let i = 0; i < ids.length; i += 500) await supabase.from('kontakte').delete().in('id', ids.slice(i, i + 500))`), [['IN_OHNE_BLOECKE', 'kontakte']])
})

test('IN_OHNE_BLOECKE: kleine Quellen (limit ≤ 300, Einzelsatz), Parameter und kleine Tabellen sind keine Funde', () => {
  assert.deepEqual(regeln(`const { data } = await supabase.from('kontakte').select('id').eq('tenant_id', t).order('nachname').limit(50)\nconst ids = (data ?? []).map(k => k.id)\nawait supabase.from('aktivitaeten').select('id').in('kontakt_id', ids)`), [])
  assert.deepEqual(regeln(`async function g(ids: string[]) { await supabase.from('aktivitaeten').select('id').in('kontakt_id', ids) }`), [])
  assert.deepEqual(regeln(`const { data } = await supabase.from('rabattgruppen').select('id').eq('tenant_id', t)\nconst ids = (data ?? []).map(k => k.id)\nawait supabase.from('kontakte').select('id').in('rabattgruppe_id', ids)`), [])
})

test('Ausnahme über einem eslint-disable-next-line (Kommentarblock bis 3 Zeilen) wird erkannt', () => {
  const t = LADEN + `// alle-ausnahme: nur Benutzer des Betriebs, wenige\n// eslint-disable-next-line @typescript-eslint/no-explicit-any\nawait (supabase.from('profiles') as any).select('id').in('id', ids)`
  const r = c.pruefeText(inFn(t), 'src/z.ts')
  assert.equal(r.funde.length, 0)
  assert.equal(r.ausnahmen.length, 1)
})
