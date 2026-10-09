// KAN-103 (08.10.2026) – Verkauf als Lieferschein, Rechnung sofort oder später; getrennter Storno.
// Formular „Rechnung sofort erstellen“ (Standard an), Rechnung erstellen (Preise je Position), Rechnungsstorno, Lieferschein-
// storno nur unberechnet, Versand nur mit Rechnung, Liste „nicht berechnet“.
//
// Aufruf:  npm run -s test:csv   (alle scripts/tests/*.test.mjs)
// DB-Seite: DB-Test 70 (RPCs, Sperre, Sammelrechnung, Spiegel), 47 (Eindeutigkeit jetzt an rechnungen).

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { rechnungPreiseAusFormular } from '../../src/lib/verkauf/rechnungen.ts'

const quelle = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const migration = () => {
  const f = readdirSync(new URL('../../supabase/migrations', import.meta.url)).find(n => n.endsWith('_kan103_rechnung_spaeter.sql'))
  return quelle(f ? `supabase/migrations/${f}` : 'supabase/entwurf/kan103_rechnung_spaeter.sql')
}
const ID1 = '11111111-1111-4111-8111-111111111111'
const ID2 = '22222222-2222-4222-8222-222222222222'
const fd = (eintraege) => ({ forEach: (cb) => eintraege.forEach(([k, v]) => cb(v, k)) })

describe('KAN-103: Preise aus dem Formular „Rechnung erstellen“', () => {
  test('Dezimalkomma, Rabatt zur Position, leere Felder bleiben unverändert', () => {
    assert.deepEqual(rechnungPreiseAusFormular(fd([[`preis_${ID1}`, '12,50'], [`rabatt_${ID1}`, '10'], [`preis_${ID2}`, ''], ['rechnungsdatum', '2026-10-08']])),
      [{ position_id: ID1, preis_brutto: 12.5, rabatt_pct: 10 }])
    // Tausenderpunkt wie in lib/format (dezimal): „1.250,50“ = 1250,50, nicht 1,2505
    assert.deepEqual(rechnungPreiseAusFormular(fd([[`preis_${ID2}`, '1.250,50']])), [{ position_id: ID2, preis_brutto: 1250.5 }])
  })
  test('ungültige Werte werden abgelehnt', () => {
    assert.throws(() => rechnungPreiseAusFormular(fd([[`preis_${ID1}`, '-1']])), /gültige Preise/)
    assert.throws(() => rechnungPreiseAusFormular(fd([[`preis_${ID1}`, 'abc']])), /gültige Preise/)
    assert.throws(() => rechnungPreiseAusFormular(fd([[`preis_${ID1}`, '5'], [`rabatt_${ID1}`, '120']])), /100 %/)
  })
})

describe('KAN-103: Datenbank', () => {
  const m = migration()
  test('„Rechnung später“: keine Nummer im Insert; Eindeutigkeit nur noch an rechnungen', () => {
    assert.match(m, /IF NEW\.rechnungsnummer IS NULL AND NOT coalesce\(NEW\.rechnung_spaeter, false\) THEN/)
    assert.match(m, /DROP INDEX public\.verkaufsposten_rechnungsnummer_eindeutig;/)
  })
  test('RPCs mit Zugriff, Abo-Sperre und Schreibmodul; Storno nur ohne Zahlung und vor BMD', () => {
    assert.equal((m.match(/PERFORM public\.pruefe_tenant_zugriff\(p_tenant_id, ARRAY\['system_admin', 'tenant_admin', 'winzer'\]\);/g) ?? []).length, 2)
    assert.equal((m.match(/PERFORM public\.s112_pruefe_abo_schreibsperre\(p_tenant_id\);/g) ?? []).length, 2)
    assert.equal((m.match(/PERFORM public\.s112_pruefe_schreibmodul\(p_tenant_id, 'warenwirtschaft'\);/g) ?? []).length, 2)
    assert.match(m, /HINT = 'rechnung_zahlungen'/)
    assert.match(m, /HINT = 'rechnung_bmd'/)
    assert.match(m, /RAISE EXCEPTION 'Eine Rechnung hat genau einen Empfänger/)
  })
  test('Lieferschein-Storno-Sperre nur für eigene (nicht gespiegelte) Rechnungen', () => {
    assert.match(m, /WHERE r\.id = NEW\.rechnung_id AND NOT r\.spiegel AND NOT r\.storniert;/)
    assert.match(m, /CREATE TRIGGER a_lieferschein_storno_sperre BEFORE UPDATE OF storniert ON public\.verkaufsposten/)
  })
})

describe('KAN-103: Oberfläche', () => {
  test('Formular: „Rechnung sofort erstellen“ standardmäßig an, Feld an createVerkauf', () => {
    const f = quelle('src/app/(dashboard)/weinhandel/verkauf/neu/page.tsx')
    assert.match(f, /const \[rechnungSofort,  setRechnungSofort\]  = useState\(true\)/)
    assert.match(f, /formData\.set\('rechnung_sofort',  rechnungSofort \? 'true' : 'false'\)/)
    const a = quelle('src/app/(dashboard)/weinhandel/verkauf/actions.ts')
    assert.match(a, /const rechnungSpaeter = formData\.get\('rechnung_sofort'\) === 'false'/)
    assert.match(a, /rechnung_spaeter: rechnungSpaeter,/)
    assert.match(a, /await rpc\('s112_rechnung_erstellen'/)
    assert.match(a, /await rpc\('s112_rechnung_stornieren'/)
  })
  test('Detail: Rechnung erstellen ohne Rechnung; Verkaufsstorno nur ohne eigene Rechnung; Rechnungsdruck nur berechnet', () => {
    const d = quelle('src/app/(dashboard)/weinhandel/verkauf/[id]/page.tsx')
    assert.match(d, /\{writeOk && !posten\.storniert && !berechnet && \(\n\s+<RechnungErstellenPanel/)
    assert.match(d, /\{writeOk && !posten\.storniert && !eigeneRechnung && \(\n\s+<StornoKnopf/)
    assert.match(d, /const isRechnung       = modusRechnung && berechnet/)
    assert.match(d, /Datum: \{new Date\(rechnungsDatum\)\.toLocaleDateString\('de-AT', \{ timeZone: 'Europe\/Vienna' \}\)\}/)   // Sweep 78
  })
  test('Versand nur mit gültiger Rechnung; Vermerk auch an der Rechnung', () => {
    const s = quelle('src/app/api/weinhandel/verkauf/[id]/send/route.ts')
    assert.match(s, /if \(!rechnung \|\| rechnung\.storniert \|\| !posten\.rechnungsnummer\) \{/)
    assert.match(s, /admin\.from\('rechnungen' as never\) as unknown as Aktualisieren\)\n\s+\.update\(\{ rechnung_versendet_am: sentAt, rechnung_versendet_an: recipient \}\)/)
  })
  test('Liste: „nicht berechnet“', () => {
    assert.match(quelle('src/app/(dashboard)/weinhandel/verkauf/page.tsx'), /\{!p\.rechnungsnummer && !p\.storniert && <div className="text-xs font-medium text-s112-warn-fg mt-0\.5">nicht berechnet<\/div>\}/)
  })
})
