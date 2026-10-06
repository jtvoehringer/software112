// KAN-41 Paket 3a (06.10.2026) – Verarbeitung einer Charge (BSM AB_VERAR)
//
// Aufruf:  npm run -s test:csv   (alle scripts/tests/*.test.mjs)
//
// Entscheidung Jörgen (06.10.2026): Umsetzung nach bestem Wissen ohne BKI-Abnahme. Eine Menge verlässt die Charge durch
// Verarbeitung (Traubensaft, Essig, Brennerei, Sonstiges) – nur über die RPC s112_verarbeitung_buchen, Storno über
// s112_verarbeitung_stornieren. DB-Regeln: DB-Test 52.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'

const v = await import('../../src/lib/kellerbuch/verarbeitung.ts')
const quelle = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')

describe('Regeln', () => {
  test('Zwecke wie der CHECK der Tabelle', () => {
    assert.deepEqual(v.VERARBEITUNG_ZWECKE.map(z => z.value), ['traubensaft', 'essig', 'brennerei', 'sonstiges'])
    assert.equal(v.VERARBEITUNG_ZWECK_LABEL.brennerei, 'Brennerei / Destillation')
    assert.equal(v.istVerarbeitungZweck('essig'), true)
    assert.equal(v.istVerarbeitungZweck('saft'), false)
  })
  test('verarbeitungFehler: Zweck, Menge bis zum Bestand, Datum nicht in der Zukunft', () => {
    const ok = { zweck: 'traubensaft', menge: 200, bestand: 500, datum: '2026-10-05', heute: '2026-10-06' }
    assert.equal(v.verarbeitungFehler(ok), null)
    assert.equal(v.verarbeitungFehler({ ...ok, menge: 500.004 }), null)   // Toleranz 0,005 L wie die RPC
    assert.match(v.verarbeitungFehler({ ...ok, zweck: '' }), /Zweck/)
    assert.match(v.verarbeitungFehler({ ...ok, menge: 0 }), /größer als 0/)
    assert.match(v.verarbeitungFehler({ ...ok, menge: null }), /größer als 0/)
    assert.match(v.verarbeitungFehler({ ...ok, menge: 500.01 }), /übersteigt den Bestand/)
    assert.match(v.verarbeitungFehler({ ...ok, datum: '2026-10-07' }), /Zukunft/)
    assert.match(v.verarbeitungFehler({ ...ok, datum: '05.10.2026' }), /gültiges Datum/)
  })
})

describe('Verdrahtung', () => {
  test('Server Actions: Prüfung vor der RPC, Storno mit Pflichtgrund', () => {
    const a = quelle('src/app/(dashboard)/kellerbuch/actions.ts')
    const fn = a.slice(a.indexOf('export async function verarbeitungBuchen'), a.indexOf('export async function verarbeitungStornieren'))
    assert.ok(fn.indexOf('await kellerbuchSchreibrecht()') > 0)
    const pruefung = fn.indexOf('verarbeitungFehler({')
    assert.ok(pruefung > 0 && pruefung < fn.indexOf("rpc('s112_verarbeitung_buchen'"))
    const st = a.slice(a.indexOf('export async function verarbeitungStornieren'))
    assert.ok(st.indexOf('stornoGrundFehler(grund)') < st.indexOf("rpc('s112_verarbeitung_stornieren'"))
  })
  test('Folgebuchungen, Storno-Prüfung und Bewegungsbuch kennen die Verarbeitung; BSM bucht AB_VERAR', () => {
    assert.match(quelle('src/lib/kellerbuch/folgebuchungen.ts'), /\(supabase\.from\('keller_verarbeitungen'\) as R\)/)
    assert.match(quelle('src/lib/kellerbuch/storno.ts'), /\['verarbeitung', verarbeitungAnzahl\]/)
    const b = quelle('src/lib/behoerden/bewegungsbuch.ts')
    assert.equal((b.match(/supabase\.from\('keller_verarbeitungen'\)/g) ?? []).length, 2, 'je Gebinde und betriebsweit')
    assert.match(b, /art: 'verarbeitung',[\s\S]{0,120}menge: -liter\(num\(v\.menge_liter\)\)/)
    assert.match(quelle('src/lib/behoerden/bsm.ts'), /case 'verarbeitung': return 'AB_VERAR'/)
  })
  test('Charge: Knopf „Verarbeiten“ nur mit Schreibrecht und Bestand', () => {
    const p = quelle('src/app/(dashboard)/kellerbuch/weinausbau/[id]/page.tsx')
    assert.match(p, /\{writeOk && aktuell > 0\.01 && \(\n\s+<Link href=\{`\/kellerbuch\/weinausbau\/\$\{weinausbau\.id\}\/verarbeiten`\}/)
  })
  test('Migration: Tabelle nur per RPC, Löschsperre, Journal AB_VERAR, Folgebuchung', () => {
    const f = readdirSync(new URL('../../supabase/migrations', import.meta.url)).find(n => n.endsWith('_kan41_verarbeitung_zugang.sql'))
    const m = quelle(f ? `supabase/migrations/${f}` : 'supabase/entwurf/kan41_verarbeitung_zugang.sql')
    assert.match(m, /CHECK \(zweck IN \('traubensaft', 'essig', 'brennerei', 'sonstiges'\)\)/)
    assert.doesNotMatch(m, /CREATE POLICY \w+ ON public\.keller_verarbeitungen FOR (INSERT|UPDATE|DELETE)/)
    assert.match(m, /EXECUTE FUNCTION public\.s112_loeschsperre\('storno'\)/)
    assert.match(m, /'code', 'AB_VERAR'/)
    assert.equal((m.match(/OR EXISTS \(SELECT 1 FROM public\.keller_verarbeitungen kv WHERE kv\.weinausbau_id = p_charge AND kv\.storniert_am IS NULL\)/g) ?? []).length, 2)
    const st = JSON.parse(quelle('scripts/storno-tabellen.json'))
    assert.ok(st.scharf.includes('keller_verarbeitungen') && st.berichtsrelevant.includes('keller_verarbeitungen'))
  })
})

// ── Paket 3b: Volumenzugang durch Behandlung (BSM ZU_BEH) ─────────────────────────────────────────────────────────────
describe('Paket 3b: Volumenzugang durch Behandlung', async () => {
  const b = await import('../../src/lib/kellerbuch/behandlungRegeln.ts')
  test('behandlungZugangFehler: leer erlaubt, sonst > 0 und nur mit Charge', () => {
    assert.equal(b.behandlungZugangFehler(null, null), null)
    assert.equal(b.behandlungZugangFehler(30, 'c1'), null)
    assert.match(b.behandlungZugangFehler(0, 'c1'), /größer als 0/)
    assert.match(b.behandlungZugangFehler(Number.NaN, 'c1'), /größer als 0/)
    assert.match(b.behandlungZugangFehler(30, null), /braucht die Charge/)
    assert.equal(b.BEHANDLUNG_FELDNAMEN.zugang_liter, 'Volumenzugang')
  })
  test('Verdrahtung: Server Action, Formular, Bewegungsbuch und BSM', () => {
    const a = quelle('src/app/(dashboard)/kellerbuch/actions.ts')
    const fn = a.slice(a.indexOf('export async function speichereKellerbehandlung'))
    assert.ok(fn.indexOf('behandlungZugangFehler(') > 0 && fn.indexOf('behandlungZugangFehler(') < fn.indexOf(".from('keller_behandlungen') as any)\n      .insert("))
    assert.match(fn, /\.\.\.\(formData\.has\('zugang_liter'\) \? \{ zugang_liter: zugangLiter \} : \{\}\)/)
    assert.match(quelle('src/app/(dashboard)/kellerbuch/behaelter/[id]/behandlungen/page.tsx'), /fd\.set\('zugang_liter', formZugang\)/)
    const bb = quelle('src/lib/behoerden/bewegungsbuch.ts')
    assert.match(bb, /menge: num\(b\.zugang_liter\) > 0 \? liter\(num\(b\.zugang_liter\)\) : 0,/)
    assert.match(bb, /\.not\('zugang_liter', 'is', null\)/)
    assert.match(quelle('src/lib/behoerden/bsm.ts'), /case 'behandlung': return 'ZU_BEH'/)
  })
  test('Migration: Spalte mit CHECK, Bestand per Trigger, Journal ZU_BEH', () => {
    const f = readdirSync(new URL('../../supabase/migrations', import.meta.url)).find(n => n.endsWith('_kan41_verarbeitung_zugang.sql'))
    const m = quelle(f ? `supabase/migrations/${f}` : 'supabase/entwurf/kan41_verarbeitung_zugang.sql')
    assert.match(m, /CHECK \(zugang_liter IS NULL OR \(zugang_liter > 0 AND weinausbau_id IS NOT NULL\)\)/)
    assert.match(m, /CREATE TRIGGER z_zugang_bestand AFTER INSERT OR UPDATE OF zugang_liter, weinausbau_id, storniert_am ON public\.keller_behandlungen/)
    assert.match(m, /'code', 'ZU_BEH'/)
  })
})
