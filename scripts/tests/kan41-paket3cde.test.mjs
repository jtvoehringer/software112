// KAN-41 Paket 3c/3d/3e (06.10.2026) – Traubenverkauf in der BSM, Etikettierung, Aufwertungssperre
//
// Aufruf:  npm run -s test:csv   (alle scripts/tests/*.test.mjs)
//
// Entscheidung Jörgen (06.10.2026): Umsetzung nach bestem Wissen ohne BKI-Abnahme.
//  3c Traubenverkauf: nur nachrichtlich in kg im Kontrolljournal (TRAUBVK, keine BSM-Buchungsart) – BSM-Test 1f.
//  3d Etikettierung: unetikettiert abgefüllte Flaschen, Vorgang „Etikettieren“; Verkauf/Ausbuchen nur etikettierter
//     Flaschen (DB) – DB-Test 54.
//  3e Aufwertungssperre: nach Folgebuchungen keine höhere/entfernte Qualitätsstufe (DB) – DB-Test 54.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'

const e = await import('../../src/lib/handel/etikettierung.ts')
const quelle = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const migration = () => {
  const f = readdirSync(new URL('../../supabase/migrations', import.meta.url)).find(n => n.endsWith('_kan41_aufwertung_etikettierung.sql'))
  return quelle(f ? `supabase/migrations/${f}` : 'supabase/entwurf/kan41_aufwertung_etikettierung.sql')
}

describe('3d Etikettierung – Regeln', () => {
  test('unetikettiertFehler: leer/0 frei, ganze Zahl bis zur Anzahl', () => {
    assert.equal(e.unetikettiertFehler(null, 100), null)
    assert.equal(e.unetikettiertFehler(0, 100), null)
    assert.equal(e.unetikettiertFehler(100, 100), null)
    assert.match(e.unetikettiertFehler(101, 100), /höchstens alle 100/)
    assert.match(e.unetikettiertFehler(2.5, 100), /ganze Zahl/)
    assert.match(e.unetikettiertFehler(Number.NaN, 100), /ganze Zahl/)
  })
  test('etikettierenFehler: Stückzahl, Bestand ohne Etikett, Datum', () => {
    const ok = { menge: 10, bestandUnetikettiert: 20, datum: '2026-10-05', heute: '2026-10-06', abfuelldatum: '2026-10-01' }
    assert.equal(e.etikettierenFehler(ok), null)
    assert.match(e.etikettierenFehler({ ...ok, menge: 0 }), /ganze Zahl über 0/)
    assert.match(e.etikettierenFehler({ ...ok, menge: 1.5 }), /ganze Zahl über 0/)
    assert.match(e.etikettierenFehler({ ...ok, menge: 21 }), /nur noch 20 Flaschen ohne Etikett/)
    assert.match(e.etikettierenFehler({ ...ok, datum: '2026-10-07' }), /Zukunft/)
    assert.match(e.etikettierenFehler({ ...ok, datum: '2026-09-30' }), /frühestens am Tag der Füllung/)
  })
  test('etikettierterBestand: verkaufbar ist nur Etikettiertes', () => {
    assert.equal(e.etikettierterBestand(100, 30), 70)
    assert.equal(e.etikettierterBestand(20, 30), 0)
    assert.equal(e.etikettierterBestand(50, null), 50)
  })
})

describe('Verdrahtung', () => {
  test('Füllung anlegen: „davon unetikettiert“ geprüft und gespeichert', () => {
    const a = quelle('src/app/(dashboard)/weinhandel/actions.ts')
    assert.match(a, /anzahl_unetikettiert: unetikettiert \?\? 0,/)
    assert.match(a, /const unetikettiertFehlerText = unetikettiertFehler\(/)
    assert.match(quelle('src/app/(dashboard)/weinhandel/fuellungen/neu/FuellungFormClient.tsx'), /name="anzahl_unetikettiert"/)
  })
  test('Etikettieren/Stornieren über die RPCs, Prüfung vor dem Aufruf', () => {
    const a = quelle('src/app/(dashboard)/weinhandel/actions.ts')
    const fn = a.slice(a.indexOf('export async function fuellungEtikettieren'), a.indexOf('export async function etikettierungStornieren'))
    assert.ok(fn.indexOf('pruefeFuellungsRecht(membership)') > 0)
    assert.ok(fn.indexOf('etikettierenFehler(') < fn.indexOf("rpc('s112_fuellung_etikettieren'"))
    const st = a.slice(a.indexOf('export async function etikettierungStornieren'))
    assert.ok(st.indexOf('stornoGrundFehler(grund)') < st.indexOf("rpc('s112_etikettierung_stornieren'"))
    const p = quelle('src/app/(dashboard)/weinhandel/fuellungen/[id]/edit/page.tsx')
    assert.match(p, /\{anzahlUnetikettiert > 0 && \(\n\s+<section id="etikettierung"/)
  })
  test('BSM: Traubenverkauf nur nachrichtlich (TRAUBVK, liter 0), nicht stornierte', () => {
    const b = quelle('src/lib/behoerden/bsm.ts')
    assert.match(b, /\(supabase\.from\('traubenverkauf'\) as any\)[\s\S]{0,700}\.is\('storniert_am', null\)/)
    assert.match(b, /code: 'TRAUBVK', liter: 0, kg,/)
  })
})

describe('Migration', () => {
  test('3e: Rang wie die App, Sperre mit den Ausnahmen', () => {
    const m = migration()
    assert.match(m, /WHEN 'qualitaetswein' THEN 2 WHEN 'dac' THEN 2/)
    assert.doesNotMatch(m, /WHEN 'sonstiges' THEN/)
    assert.match(m, /CREATE TRIGGER a_aufwertung BEFORE UPDATE OF qualitaetsstufe ON public\.weinausbau/)
    assert.match(m, /current_setting\('s112\.freeze_frei', true\) = 'weinausbau'/)
    assert.match(m, /v\.ziel_qualitaet_vorher IS NOT DISTINCT FROM NEW\.qualitaetsstufe/)
    assert.match(m, /IF NOT public\.s112_charge_hat_folgebuchung\(NEW\.id\) THEN/)
  })
  test('3d: Spalten, Bestandsregel, Tabelle nur per RPC', () => {
    const m = migration()
    assert.match(m, /CREATE TRIGGER a_etikett_bestand BEFORE INSERT OR UPDATE OF bestand_flaschen, bestand_unetikettiert ON public\.fuellungen/)
    assert.match(m, /NEW\.bestand_unetikettiert > NEW\.bestand_flaschen/)
    assert.doesNotMatch(m, /CREATE POLICY \w+ ON public\.fuellung_etikettierungen FOR (INSERT|UPDATE|DELETE)/)
  })
})
