// KAN-212 (06.10.2026): CRM-Gemeinschaft – Partner lesen das CRM des Eigentümers und verwenden Kontakte/Firmen in
// eigenen Belegen; ändern nur der Eigentümer; Konditionen/Kundennummer des Eigentümers nicht vorbelegt.
// Die Datenbank-Seite (RLS, Fremdverweis 'crm', Momentaufnahme) prüft DB-Test 43.
//
// Aufruf:  npm run -s test:csv  (Node ≥ 22.15 wegen module.registerHooks)

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { hooksRegistrieren, laden, nurMitHooks, hooksMoeglich } from './buchung-attrappe.mjs'

hooksRegistrieren()
const WURZEL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const quelle = rel => readFileSync(path.join(WURZEL, rel), 'utf8').replace(/\r\n/g, '\n')
const gm = hooksMoeglich ? await laden('lib/crm/gemeinschaft.ts') : null

const G = { alsEigentuemer: [{ tenant_id: 'c', name: 'Weingut C' }], alsNutzer: [{ tenant_id: 'a', name: 'Weingut A' }] }

describe('KAN-212 Helfer', nurMitHooks, () => {
  test('sichtbare Betriebe: eigener zuerst, dann die freigebenden (nicht die, denen ich freigebe)', () => {
    assert.deepEqual(gm.sichtbareBetriebe('b', G), ['b', 'a'])
    assert.deepEqual(gm.sichtbareBetriebe('b', { alsEigentuemer: [], alsNutzer: [] }), ['b'])
  })
  test('fremderBetrieb: Name des Eigentümers, null bei eigenen', () => {
    assert.equal(gm.fremderBetrieb('a', 'b', G), 'Weingut A')
    assert.equal(gm.fremderBetrieb('b', 'b', G), null)
    assert.equal(gm.fremderBetrieb('x', 'b', G), 'anderer Betrieb')
  })
  test('ladeCrmGemeinschaft: RPC lade_crmgemeinschaft, Fehler → leere Gemeinschaft', async () => {
    const rpc = (rows, error = null) => ({ rpc: async (name, p) => { assert.equal(name, 'lade_crmgemeinschaft'); assert.equal(p.p_tenant_id, 'b'); return { data: rows, error } } })
    const r = await gm.ladeCrmGemeinschaft(rpc([{ rolle: 'nutzer', partner_tenant_id: 'a', partner_name: 'Weingut A' }]), 'b')
    assert.deepEqual(r, { alsEigentuemer: [], alsNutzer: [{ tenant_id: 'a', name: 'Weingut A' }] })
    assert.deepEqual(await gm.ladeCrmGemeinschaft(rpc(null, { message: 'x' }), 'b'), { alsEigentuemer: [], alsNutzer: [] })
    assert.deepEqual(await gm.ladeCrmGemeinschaft(rpc([]), null), { alsEigentuemer: [], alsNutzer: [] })
  })
})

describe('KAN-212 Verdrahtung', () => {
  test('Kunden-/Lieferantensuche: eigener Betrieb und Partner, ohne Konditionen des Eigentümers, Hinweis „aus …“', () => {
    const s = quelle('src/app/api/crm/suche/route.ts')
    assert.match(s, /select\(K_SPALTEN\)\.in\('tenant_id', betriebe\)/)
    assert.match(s, /select\(F_SPALTEN\)\.in\('tenant_id', betriebe\)/)
    assert.match(s, /if \(fremd\) return \{ typ, firma_id: [^}]*rabatt_pct: null, sonderrabatt_pct: 0, skonto_pct: 0/)
    assert.match(s, /aus \? `aus \$\{aus\}` : null/)
  })
  test('Pflichtprüfung der Belege lädt Partner auch aus der Gemeinschaft', () => {
    assert.match(quelle('src/lib/handel/partnerLaden.ts'), /\.in\('tenant_id', betriebe\)\.maybeSingle\(\)/)
  })
  test('Administration › Gemeinschaften mit Keller- und CRM-Gemeinschaft, alte Adresse leitet weiter', () => {
    const a = quelle('src/app/(dashboard)/admin/gemeinschaften/actions.ts')
    assert.match(a, /keller: 'keller_freigaben', crm: 'crm_freigaben'/)
    assert.match(a, /await pruefePlattformAdmin\(\)/)
    assert.match(quelle('src/app/(dashboard)/admin/kellergemeinschaft/page.tsx'), /redirect\('\/admin\/gemeinschaften'\)/)
    assert.match(quelle('src/lib/navigation/index.ts'), /href: '\/admin\/gemeinschaften', label: 'Gemeinschaften'/)
  })
  test('Gemeinsames CRM: nur lesen, nur die freigebenden Betriebe, Link aus den Listen', () => {
    const p = quelle('src/app/(dashboard)/crm/gemeinsam/page.tsx')
    assert.match(p, /\.in\('tenant_id', eigentuemer\)/)
    assert.doesNotMatch(p, /\.(insert|update|delete|upsert)\(/)
    for (const rel of ['crm/kontakte/page.tsx', 'crm/firmen/page.tsx']) {
      assert.match(quelle(`src/app/(dashboard)/${rel}`), /href="\/crm\/gemeinsam\?art=/, rel)
    }
  })
  test('Migration: Partner-Policies nur SELECT, private Aktivitäten ausgenommen, Modus crm an Verkauf/Zukauf/Traubenverkauf', () => {
    const f = readdirSync(path.join(WURZEL, 'supabase/migrations')).find(n => n.endsWith('_kan212_crm_gemeinschaft.sql'))
    const m = quelle(f ? path.join('supabase/migrations', f) : 'supabase/entwurf/kan212_crm_gemeinschaft.sql')
    for (const pol of ['kontakte_crm_partner', 'firmen_crm_partner', 'akt_crm_partner', 'pipe_crm_partner']) {
      assert.match(m, new RegExp(`CREATE POLICY ${pol} ON public\\.\\w+ FOR SELECT TO authenticated`), pol)
    }
    assert.match(m, /akt_crm_partner[^;]*NOT coalesce\(ist_privat, false\)/)
    assert.equal(m.match(/s112_fremdverweis_pruefen\('[a-z_]+', '(kontakte|firmen)', 'crm'/g)?.length, 8)
    assert.match(m, /'accountnummer', NULL, 'debitor_nr', NULL, 'kreditor_nr', NULL/)
  })
})
