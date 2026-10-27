// KAN-356 (27.10.2026) – Verkauf samt Rechnung stornieren: ein Knopf, eine Transaktion (RPC
// s112_verkauf_samt_rechnung_stornieren), nur eigene Rechnung mit genau einem Lieferschein, nicht bei ausgestellter
// Transportbescheinigung.
//
// Aufruf:  npm run -s test:csv   (alle scripts/tests/*.test.mjs)
// DB-Seite: DB-Test 85 (Ablehnungen, Abbruch ohne Teilstorno, Bestand zurück, Charge wieder aktiv).

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'

const quelle = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const migration = () => {
  const f = readdirSync(new URL('../../supabase/migrations', import.meta.url)).find(n => n.endsWith('_kan356_verkauf_samt_rechnung_stornieren.sql'))
  return quelle(f ? `supabase/migrations/${f}` : 'supabase/entwurf/kan356_verkauf_samt_rechnung_stornieren.sql')
}

describe('KAN-356: RPC', () => {
  const m = migration()
  test('Zugriff, Abo-Sperre, Warenwirtschaft, Grund; nur authenticated', () => {
    assert.match(m, /SECURITY DEFINER\nSET search_path = public/)
    assert.match(m, /PERFORM public\.pruefe_tenant_zugriff\(p_tenant_id, ARRAY\['system_admin', 'tenant_admin', 'winzer'\]\);/)
    assert.match(m, /PERFORM public\.s112_pruefe_abo_schreibsperre\(p_tenant_id\);/)
    assert.match(m, /PERFORM public\.s112_pruefe_schreibmodul\(p_tenant_id, 'warenwirtschaft'\);/)
    assert.match(m, /length\(v_grund\) < 10/)
    assert.match(m, /REVOKE EXECUTE ON FUNCTION public\.s112_verkauf_samt_rechnung_stornieren\(uuid, uuid, text\) FROM PUBLIC, anon;/)
  })
  test('nur eigene Rechnung mit genau einem Lieferschein, ohne ausgestellte Transportbescheinigung', () => {
    assert.match(m, /IF v_r\.spiegel THEN[\s\S]*?HINT = 'spiegel'/)
    assert.match(m, /IF v_anzahl <> 1 THEN[\s\S]*?HINT = 'sammelrechnung'/)
    assert.match(m, /t\.status = 'ausgestellt' AND t\.storniert_am IS NULL\)[\s\S]*?HINT = 'transportbescheinigung'/)
  })
  test('Rechnung über die bestehende RPC, danach Bestand, Lieferschein, Sonstige Produkte, Traubenverkauf', () => {
    const reihenfolge = [
      'PERFORM public.s112_rechnung_stornieren(',
      'PERFORM public.s112_fuellung_verkauf_buchen(',
      'UPDATE public.weinausbau',
      'UPDATE public.verkaufsposten SET storniert = true',
      'PERFORM public.s112_artikel_verkauf_stornieren(',
      'UPDATE public.traubenverkauf t',
    ].map(t => m.indexOf(t))
    assert.ok(reihenfolge.every(i => i > 0), 'alle Schritte vorhanden')
    assert.deepEqual([...reihenfolge].sort((a, b) => a - b), reihenfolge)
  })
  test('Tank-Rückbuchung nur mit Kellerbuch oder Rieden; abgeschlossene Charge wird wieder aktiv', () => {
    assert.match(m, /s112_darf_schreiben\(p_tenant_id, 'kellerbuch', 'rieden'\)/)
    assert.match(m, /aktiv = true, status = CASE WHEN v_w\.status = 'abgeschlossen' THEN 'ausbau'/)
  })
})

describe('KAN-356: App', () => {
  const action = quelle('src/app/(dashboard)/weinhandel/verkauf/actions.ts')
  const seite = quelle('src/app/(dashboard)/weinhandel/verkauf/[id]/page.tsx')
  test('Action: Rechte vorab mit der Mitgliedschaft, Periodensperre, eine RPC, Ablehnungen als { error }', () => {
    const fn = action.slice(action.indexOf('export async function verkaufSamtRechnungStornieren'))
    const body = fn.slice(0, fn.indexOf('\n}\n'))
    assert.match(body, /canWrite\(m, 'warenwirtschaft'\)/)
    assert.match(body, /rechnungStornoFehler\(/)
    assert.match(body, /rpc\('s112_verkauf_samt_rechnung_stornieren'/)
    assert.match(body, /erwarteteDbAblehnung\(error\)\) return \{ error:/)
    assert.doesNotMatch(body, /verkaufspostenStornieren|s112_rechnung_stornieren/)
  })
  test('Knopf nur bei eigener Rechnung mit einem Lieferschein, ohne ausgestellte Transportbescheinigung, ohne Sperre', () => {
    assert.match(seite, /const samtStornoAction = eigeneRechnung && !sammelrechnung && !posten\.storniert && !tbAusgestellt/)
    assert.match(seite, /\{writeOk && samtStornoAction && !stornoGesperrt && <VerkaufSamtRechnungStornoKnopf action=\{samtStornoAction\} \/>\}/)
    const knopf = quelle('src/app/(dashboard)/weinhandel/verkauf/[id]/VerkaufSamtRechnungStornoKnopf.tsx')
    assert.match(knopf, /label="Verkauf samt Rechnung stornieren"/)
  })
})
