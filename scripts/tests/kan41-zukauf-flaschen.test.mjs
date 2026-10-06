// KAN-41 Paket 2b (06.10.2026) – Zukauf Flaschen als Handelsware
//
// Aufruf:  npm run -s test:csv   (alle scripts/tests/*.test.mjs)
//
// Entscheidungen Jörgen (06.10.2026, „alles wie empfohlen“): jeder Flaschenzukauf legt einen eigenen Weinlager-Artikel
// (Füllung ohne Charge, fuellungen.zukauf_posten_id) an – Zukauf und Füllung bucht EINE RPC (s112_zukauf_buchen,
// p_fuellung); Prüfnummer des Erzeugers ab Qualitätswein Pflicht (E2); nach einer Bewegung kein Storno (E3); Altfälle
// ohne Zukauf bleiben Rückfall ZK_FLA mit Prüfwarnung (E5). BSM: kan43-bsm.test.mjs (Test 1c), DB: DB-Test 51.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { register } from 'node:module'

register('./ernte.aufloesung.mjs', import.meta.url)

const w = await import('../../src/lib/zukauf/ware.ts')
const quelle = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')

const FLASCHEN = {
  art: 'flaschen', weinart: 'weiss', rebsorte: 'Grüner Veltliner', jahrgang: 2025, qualitaetsstufe: 'qualitaetswein',
  herkunft: 'kamptal_gebietswein', mostgewicht: false, alkohol: 12.5, pruefnummer: 'N 1234/26',
}
const ARTIKEL = {
  name: 'GV Kamptal (Weingut X)', flaschengroesseMl: 750, menge: 120, einheit: 'Stk', qualitaetsstufe: 'qualitaetswein',
  zusatzbezeichnung: null, erzeugnis: null, pruefnummer: 'N 1234/26',
}

describe('Regeln', () => {
  test('istFlaschenArt, Label, Flaschengrößen wie der CHECK der Füllung', () => {
    assert.equal(w.istFlaschenArt('flaschen'), true)
    for (const a of ['wein', 'most', 'trauben', 'maische', null, undefined]) assert.equal(w.istFlaschenArt(a), false, String(a))
    assert.equal(w.istTraubenArt('flaschen'), false)
    assert.equal(w.ZUKAUF_ART_LABEL.flaschen, 'Flaschen (Handelsware)')
    assert.deepEqual([...w.FLASCHEN_GROESSEN_ML], [187, 375, 500, 750, 1000, 1500, 3000, 6000])
  })
  test('Ware: Flaschen wie Wein – Alkohol Pflicht, kein Mostgewicht', () => {
    assert.equal(w.zukaufWareFehler(FLASCHEN, []), null)
    assert.match(w.zukaufWareFehler({ ...FLASCHEN, alkohol: null }, []), /Alkoholgehalt/)
    assert.equal(w.zukaufWareFehler({ ...FLASCHEN, mostgewicht: false }, []), null)
  })
  test('Weinlager-Artikel: Name, Größe, ganze Stückzahl, Einheit Stk', () => {
    assert.equal(w.flaschenZukaufFehler(ARTIKEL), null)
    assert.match(w.flaschenZukaufFehler({ ...ARTIKEL, name: '  ' }), /Produktnamen/)
    assert.match(w.flaschenZukaufFehler({ ...ARTIKEL, flaschengroesseMl: 700 }), /Flaschengröße/)
    assert.match(w.flaschenZukaufFehler({ ...ARTIKEL, flaschengroesseMl: null }), /Flaschengröße/)
    assert.match(w.flaschenZukaufFehler({ ...ARTIKEL, menge: 12.5 }), /ganze Zahl/)
    assert.match(w.flaschenZukaufFehler({ ...ARTIKEL, menge: 0 }), /ganze Zahl/)
    assert.match(w.flaschenZukaufFehler({ ...ARTIKEL, einheit: 'L' }), /Stück/)
  })
  test('E2: Prüfnummer des Erzeugers ab Qualitätswein, mit Zusatzbezeichnung oder als Sekt – sonst optional', () => {
    const ohne = { ...ARTIKEL, pruefnummer: ' ' }
    assert.match(w.flaschenZukaufFehler(ohne), /Prüfnummer des Erzeugers/)
    assert.match(w.flaschenZukaufFehler({ ...ohne, qualitaetsstufe: 'dac' }), /Prüfnummer/)
    assert.match(w.flaschenZukaufFehler({ ...ohne, qualitaetsstufe: 'landwein', zusatzbezeichnung: 'reserve' }), /Prüfnummer/)
    assert.match(w.flaschenZukaufFehler({ ...ohne, qualitaetsstufe: 'wein', erzeugnis: 'SEKTGU' }), /Prüfnummer/)
    assert.equal(w.flaschenZukaufFehler({ ...ohne, qualitaetsstufe: 'landwein' }), null)
    assert.equal(w.flaschenZukaufFehler({ ...ohne, qualitaetsstufe: 'wein' }), null)
  })
})

describe('Verdrahtung', () => {
  const A = quelle('src/app/(dashboard)/weinhandel/zukauf/actions.ts')
  test('createZukauf: Prüfung vor der RPC, Weinlager-Artikel als p_fuellung, danach zur neuen Füllung', () => {
    const start = A.indexOf('export async function createZukauf')
    const fn = A.slice(start, A.indexOf('export async function updateZukauf'))
    const pruefung = fn.indexOf('flaschenZukaufFehler({')
    const rpc = fn.indexOf("'s112_zukauf_buchen'")
    assert.ok(pruefung > 0 && pruefung < rpc, 'Prüfung vor dem Buchen')
    assert.match(fn, /p_fuellung: flaschen\n\s+\? \{ name: f\.fuellungName, flaschengroesse_ml: f\.flaschengroesseMl, vk_preis_brutto: f\.vkPreisBrutto, mwst_pct: f\.mwstPct \}\n\s+: null,/)
    assert.match(fn, /if \(flaschen && fuellungId\) redirect\(`\/weinhandel\/fuellungen\/\$\{fuellungId\}\/edit`\)/)   // es gibt keine Detailseite
    assert.match(A, /einheit: {13}istFlaschenArt\(art\) \? 'Stk' :/)
  })
  test('updateZukauf: Art, Anzahl und Merkmale eines Flaschenzukaufs fest, nur Beleg/Preis/Notizen speichern', () => {
    const fn = A.slice(A.indexOf('export async function updateZukauf'), A.indexOf('async function verschnittDesZukaufs'))
    assert.match(fn, /if \(istFlaschenArt\(a\.art\) \|\| istFlaschenArt\(f\.art\)\) \{/)
    assert.match(fn, /\.\.\.geaenderteMerkmale\(a, f\)\]/)
    assert.match(fn, /if \(merkmaleFest\) for \(const k of ZUKAUF_MERKMALE\) delete zukaufPatch\[k\]/)
  })
  test('Handelsware nur über den Zukauf stornieren (App wie Trigger)', () => {
    const W = quelle('src/app/(dashboard)/weinhandel/actions.ts')
    const fn = W.slice(W.indexOf('export async function deactivateFuellung'))
    const sperre = fn.indexOf('if (f.zukauf_posten_id) {')
    assert.ok(sperre > 0 && sperre < fn.indexOf('folgebuchungenDerFuellung('), 'Sperre vor allem anderen')
    const P = quelle('src/app/(dashboard)/weinhandel/page.tsx')
    assert.match(P, /\.neq\('art', 'flaschen'\)/)
    assert.match(P, /if \(f\.zukauf_posten_id\) loeschSperre\.set\(f\.id,/)
  })
  test('Bewegungsbuch: Flaschenzukauf als Zugang ohne Tankabgang; Rückverfolgung ohne Auto-Zuordnung', () => {
    const B = quelle('src/lib/behoerden/bewegungsbuch.ts')
    assert.match(B, /if \(!f\.weinausbau_id && f\.zukauf_posten_id\) \{[\s\S]{0,200}art: 'zukauf',[\s\S]{0,300}menge: 0,/)
    const R = quelle('src/lib/behoerden/rueckverfolgung.ts')
    const zk = R.indexOf('} else if (fuellung.zukauf_posten_id) {')
    const auto = R.indexOf('// Auto-Match: Rebsorte + Jahrgang')
    assert.ok(zk > 0 && zk < auto, 'Zukauf-Zweig vor dem Auto-Match')
  })
  test('Migration: Art, Bezug mit Fremdverweis, Journal ZK_FLA mit Bezug, RPC mit p_fuellung, Freeze und Storno', () => {
    const f = readdirSync(new URL('../../supabase/migrations', import.meta.url)).find(n => n.endsWith('_kan41_zukauf_flaschen.sql'))
    const m = quelle(f ? `supabase/migrations/${f}` : 'supabase/entwurf/kan41_zukauf_flaschen.sql')
    assert.match(m, /'maische'::text, 'flaschen'::text\]\)\)/)
    assert.match(m, /ADD COLUMN zukauf_posten_id uuid REFERENCES public\.zukauf_posten \(id\)/)
    assert.match(m, /CREATE UNIQUE INDEX fuellungen_zukauf_posten_uq/)
    assert.match(m, /s112_fremdverweis_pruefen\('zukauf_posten_id', 'zukauf_posten', '', '', ''\)/)
    assert.match(m, /'zukauf_posten_id', f ->> 'zukauf_posten_id', 'hinweis', 'Flaschenzukauf \(Handelsware\)'/)
    assert.match(m, /p_fuellung jsonb DEFAULT NULL\)/)
    assert.match(m, /DROP FUNCTION public\.s112_zukauf_buchen\(uuid, jsonb, jsonb, jsonb\);/)
    assert.match(m, /REVOKE EXECUTE ON FUNCTION public\.s112_zukauf_buchen\(uuid, jsonb, jsonb, jsonb, jsonb\) FROM PUBLIC, anon;/)
    assert.match(m, /o\.art = 'flaschen' OR o\.ziel_weinausbau_id IS NOT NULL/)
    assert.match(m, /HINT = 'flaschenzukauf_bewegung'/)
    assert.match(m, /HINT = 'flaschenzukauf_ueber_zukauf'/)
    // derselbe Hinweistext wie die BSM-Rekonstruktion (HANDELSWARE_HINWEIS), sonst warnte die BSM aus dem Journal
    assert.match(quelle('src/lib/behoerden/bsm.ts'), /export const HANDELSWARE_HINWEIS = 'Flaschenzukauf \(Handelsware\)'/)
  })
})

// Regression (06.10.2026): Links auf /weinhandel/fuellungen/<id> ohne Unterseite führten ins Leere – es gibt nur
// /edit und /elabel (bzw. /neu). Weiterleitung nach dem Flaschenzukauf, Zukauf-Hinweis und globale Suche waren betroffen.
describe('Füllungs-Links', () => {
  test('kein Link auf die nicht vorhandene Detailseite /weinhandel/fuellungen/<id>', async () => {
    const { readdirSync: rd, statSync } = await import('node:fs')
    const { join } = await import('node:path')
    const wurzel = new URL('../../src', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
    const dateien = []
    const lauf = (d) => { for (const n of rd(d)) { const p = join(d, n); if (statSync(p).isDirectory()) lauf(p); else if (/\.(ts|tsx)$/.test(n)) dateien.push(p) } }
    lauf(decodeURIComponent(wurzel))
    const funde = []
    for (const p of dateien) {
      const s = readFileSync(p, 'utf8')
      for (const m of s.matchAll(/\/weinhandel\/fuellungen\/\$\{[^}]+\}(?!\/(edit|elabel))/g)) funde.push(`${p}: ${m[0]}`)
    }
    assert.deepEqual(funde, [])
    assert.ok(statSync(new URL('../../src/app/(dashboard)/weinhandel/fuellungen/[id]/edit/page.tsx', import.meta.url)).isFile())
  })
})
