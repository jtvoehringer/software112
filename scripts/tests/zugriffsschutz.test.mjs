// Zugriffsschutz in der App (STABILITAET.md, Lücke 3; 08.10.2026): Die Wächter prüfen nur, DASS die Prüfungen
// aufgerufen werden – dieser Test prüft, OB sie richtig entscheiden. Echte Module (lib/auth/roles, mfa, sperren,
// seitenBetrieb, lib/api/zweiFaktor); ersetzt sind nur Supabase-Client, Cookie, Subdomain, Request-Header, React
// cache, Tenant-Kopf (Abo-Status) und 'server-only'.
//
// Aufruf:  npm run -s test:csv   (alle scripts/tests/*.test.mjs; Node ≥ 22.15 wegen module.registerHooks)

import { test, describe, beforeEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import * as nodeModule from 'node:module'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { datenbank } from './buchung-attrappe.mjs'

const HIER = path.dirname(fileURLToPath(import.meta.url))
const SRC = path.resolve(HIER, '../../src')
const SRC_URL = pathToFileURL(SRC).href
const hooksMoeglich = typeof nodeModule.registerHooks === 'function'
const nurMitHooks = { skip: hooksMoeglich ? false : 'Node ohne module.registerHooks' }
const modul = code => `data:text/javascript,${encodeURIComponent(code)}`

// Ersatzmodule – Zustand je Test über globalThis.__z
const DOPPEL = {
  'server-only': modul(''),
  'react': modul('export const cache = fn => fn'),
  'next/cache': modul('export const unstable_cache = fn => fn; export const revalidateTag = () => {}; export const revalidatePath = () => {}'),
  'next/headers': modul('export const headers = async () => ({ get: n => (globalThis.__z.header ?? {})[n.toLowerCase()] ?? null })'),
  '@/lib/supabase/server': modul('export const createSupabaseServerClient = async () => globalThis.__z.server'),
  '@/lib/supabase/admin': modul('export const createSupabaseAdminClient = () => globalThis.__z.server'),
  '@/lib/auth/activeTenant': modul('export const getActiveTenantCookie = async () => globalThis.__z.cookie ?? null'),
  '@/lib/tenant/subdomainServer': modul('export const aktiveSubdomain = async () => globalThis.__z.sub ?? null'),
  '@/lib/tenant/kopf': modul(`
    const k = () => ({ tenant: globalThis.__z.abo ?? { stripe_status: 'active', stripe_trial_ends_at: null, stripe_subscription_id: 'sub_1' }, ladefehler: false })
    export const ladeTenantKopf = async () => k()
    export const ladeTenantKopfFrisch = async () => k()`),
}
if (hooksMoeglich) {
  nodeModule.registerHooks({
    resolve(s, kontext, weiter) {
      // nur Importe aus src ersetzen – Next selbst lädt react usw. per CommonJS (kein data:-URL)
      if (DOPPEL[s] && kontext.parentURL?.startsWith(SRC_URL)) return { url: DOPPEL[s], shortCircuit: true }
      if (s === 'next/server') return weiter('next/server.js', kontext)   // Paket ohne „exports“ – ESM braucht die Endung
      let basis = null
      if (s.startsWith('@/')) basis = path.join(SRC, s.slice(2))
      else if (/^\.\.?\//.test(s) && !path.extname(s) && kontext.parentURL?.startsWith('file:')) basis = path.resolve(path.dirname(fileURLToPath(kontext.parentURL)), s)
      if (basis) for (const k of [basis + '.ts', basis + '.tsx', path.join(basis, 'index.ts')]) if (existsSync(k)) return weiter(pathToFileURL(k).href, kontext)
      return weiter(s, kontext)
    },
  })
}
const laden = rel => import(pathToFileURL(path.join(SRC, rel)).href)
const roles = hooksMoeglich ? await laden('lib/auth/roles.ts') : null
const mfa = hooksMoeglich ? await laden('lib/auth/mfa.ts') : null
const zf = hooksMoeglich ? await laden('lib/api/zweiFaktor.ts') : null
const sperren = hooksMoeglich ? await laden('lib/auth/sperren.ts') : null
const sb = hooksMoeglich ? await laden('lib/auth/seitenBetrieb.ts') : null

const U = 'user-1', A = '00000000-0000-4000-8000-00000000000a', B = '00000000-0000-4000-8000-00000000000b'

/** Supabase-Attrappe mit Auth: user (null = keine Sitzung), Faktoren, Stufe, Fehler von getUser */
function server({ user = { id: U, factors: [] }, aal = 'aal1', fehler = null, mitglieder = [] } = {}) {
  const db = datenbank({ tenant_memberships: mitglieder })
  db.auth = {
    getUser: async () => ({ data: { user }, error: fehler }),
    mfa: {
      getAuthenticatorAssuranceLevel: async () => ({ data: { currentLevel: aal } }),
      listFactors: async () => ({ data: { totp: user?.factors ?? [] } }),
    },
  }
  return db
}
const mitglied = (tenant_id, role, extra = {}) => ({ user_id: U, tenant_id, role, aktiv: true, schreibmodule: null, created_at: '2026-01-01T00:00:00Z', tenants: { subdomain: null }, ...extra })
const FAKTOR = [{ status: 'verified' }]

beforeEach(() => { globalThis.__z = { header: {} } })

describe('Rechte nach Rolle und Modul (roles.ts)', nurMitHooks, () => {
  test('moduleAusMembership: Admins alle, Leser keine, Mitarbeiter nur gültige Module der Matrix', () => {
    assert.deepEqual(roles.moduleAusMembership('system_admin', null), roles.ALLE_MODULE)
    assert.deepEqual(roles.moduleAusMembership('tenant_admin', []), roles.ALLE_MODULE)
    assert.deepEqual(roles.moduleAusMembership('leser', ['crm']), [])
    assert.deepEqual(roles.moduleAusMembership('winzer', ['crm', 'gibtsnicht', 'kellerbuch', 7]), ['crm', 'kellerbuch'])
    assert.deepEqual(roles.moduleAusMembership('winzer', 'crm'), [])
    assert.deepEqual(roles.moduleAusMembership(null, ['crm']), [])
  })

  test('canWrite: Admins immer, Leser/ohne Rolle nie, Mitarbeiter nur in freigegebenen Modulen; „betrieb“ für jeden Mitarbeiter', () => {
    const m = (role, schreibmodule) => ({ tenantId: A, role, schreibmodule })
    for (const r of ['system_admin', 'tenant_admin']) assert.equal(roles.canWrite(m(r, []), 'ea'), true, r)
    assert.equal(roles.canWrite(m('leser', roles.ALLE_MODULE), 'crm'), false)
    assert.equal(roles.canWrite(m(null, roles.ALLE_MODULE), 'crm'), false)
    const w = m('winzer', ['rieden', 'kellerbuch'])
    assert.equal(roles.canWrite(w, 'kellerbuch'), true)
    assert.equal(roles.canWrite(w, 'ea'), false)
    assert.equal(roles.canWrite(w, 'betrieb'), true)
    assert.equal(roles.canWrite(w), true)                          // irgendwo schreiben
    assert.equal(roles.canWrite(m('winzer', [])), false)          // nirgends
    assert.equal(roles.canWrite(m('winzer', []), 'betrieb'), true)
    // nur die Rolle (Client, ohne gemerkte Matrix): Mitarbeiter darf – die DB prüft die Matrix selbst
    assert.equal(roles.canWrite('winzer', 'ea'), true)
    assert.equal(roles.canWrite('leser'), false)
  })

  test('canSeeAuswertungen, canAdmin, canManageUsers, isSystemAdmin, roleLabel', () => {
    const m = (role, schreibmodule) => ({ tenantId: A, role, schreibmodule })
    assert.equal(roles.canSeeAuswertungen(m('leser', [])), true)
    assert.equal(roles.canSeeAuswertungen(m('winzer', ['auswertungen'])), true)
    assert.equal(roles.canSeeAuswertungen(m('winzer', ['crm'])), false)
    assert.equal(roles.canSeeAuswertungen(m(null, [])), false)
    for (const [r, admin, sys] of [['system_admin', true, true], ['tenant_admin', true, false], ['winzer', false, false], ['leser', false, false], [null, false, false]]) {
      assert.equal(roles.canAdmin(r), admin, `canAdmin ${r}`)
      assert.equal(roles.canManageUsers(r), admin, `canManageUsers ${r}`)
      assert.equal(roles.isSystemAdmin(r), sys, `isSystemAdmin ${r}`)
    }
    assert.deepEqual(['system_admin', 'tenant_admin', 'winzer', 'leser', null].map(roles.roleLabel), ['Super-Admin', 'Betriebs-Manager', 'Mitarbeiter', 'Leser', '–'])
  })

  test('Sandbox-Sonderfreigabe nur in der Sandbox und nur für die Liste (Groß-/Kleinschreibung egal)', () => {
    assert.equal(roles.isSandboxAdminUnlock('JG@Weingut-Gebeshuber.at', true), true)
    assert.equal(roles.isSandboxAdminUnlock('jg@weingut-gebeshuber.at', false), false)   // echter Betrieb: nie
    assert.equal(roles.isSandboxAdminUnlock('fremd@example.at', true), false)
    assert.equal(roles.isSandboxAdminUnlock(null, true), false)
  })
})

describe('Aktive Mitgliedschaft (getCurrentMembership)', nurMitHooks, () => {
  test('ohne Sitzung keine Mitgliedschaft', async () => {
    globalThis.__z.server = server({ user: null, mitglieder: [mitglied(A, 'tenant_admin')] })
    assert.equal(await roles.getCurrentMembership(), null)
  })

  test('Faktor eingerichtet: nur mit aal2 (KAN-136) – sonst keine Mitgliedschaft', async () => {
    globalThis.__z.server = server({ user: { id: U, factors: FAKTOR }, aal: 'aal1', mitglieder: [mitglied(A, 'tenant_admin')] })
    assert.equal(await roles.getCurrentMembership(), null)
    globalThis.__z.server = server({ user: { id: U, factors: FAKTOR }, aal: 'aal2', mitglieder: [mitglied(A, 'tenant_admin')] })
    assert.equal((await roles.getCurrentMembership())?.tenantId, A)
  })

  test('Cookie: nur eigene, aktive Mitgliedschaft; fremde Zeilen desselben Betriebs zählen nie', async () => {
    const fremdeZeile = { ...mitglied(B, 'system_admin'), user_id: 'anderer' }   // Admins sehen per RLS alle Zeilen ihres Betriebs
    globalThis.__z.server = server({ mitglieder: [fremdeZeile, mitglied(B, 'leser', { schreibmodule: ['crm'] }), mitglied(A, 'tenant_admin')] })
    globalThis.__z.cookie = B
    assert.deepEqual(await roles.getCurrentMembership(), { tenantId: B, role: 'leser', schreibmodule: [] })
    // deaktivierte Mitgliedschaft im Cookie-Betrieb → Rückfall auf die älteste aktive
    globalThis.__z.server = server({ mitglieder: [mitglied(B, 'tenant_admin', { aktiv: false }), mitglied(A, 'winzer', { schreibmodule: ['crm'], created_at: '2026-02-01T00:00:00Z' })] })
    assert.deepEqual(await roles.getCurrentMembership(), { tenantId: A, role: 'winzer', schreibmodule: ['crm'] })
  })

  test('ohne Cookie: deterministisch die älteste aktive Mitgliedschaft (KAN-33)', async () => {
    globalThis.__z.server = server({ mitglieder: [mitglied(B, 'winzer', { created_at: '2026-03-01T00:00:00Z' }), mitglied(A, 'leser', { created_at: '2026-01-15T00:00:00Z' })] })
    assert.equal((await roles.getCurrentMembership())?.tenantId, A)
  })

  test('Subdomain: nur dieser Betrieb, kein Rückfall auf Cookie oder anderen Betrieb (KAN-31)', async () => {
    const mitSub = (t, sub, role) => mitglied(t, role, { tenants: { subdomain: sub } })
    globalThis.__z.server = server({ mitglieder: [mitSub(A, 'gebeshuber', 'tenant_admin'), mitSub(B, 'spaetrot', 'winzer')] })
    globalThis.__z.cookie = A
    globalThis.__z.sub = 'spaetrot'
    assert.equal((await roles.getCurrentMembership())?.tenantId, B)
    globalThis.__z.sub = 'fremderbetrieb'
    assert.equal(await roles.getCurrentMembership(), null)
  })
})

describe('Zwei-Faktor (mfa.ts, api/zweiFaktor.ts)', nurMitHooks, () => {
  test('hatBestaetigtenFaktor: nur verifizierte Faktoren des geprüften Users', () => {
    assert.equal(mfa.hatBestaetigtenFaktor({ factors: [{ status: 'unverified' }] }), false)
    assert.equal(mfa.hatBestaetigtenFaktor({ factors: [{ status: 'unverified' }, { status: 'verified' }] }), true)
    assert.equal(mfa.hatBestaetigtenFaktor({ factors: null }), false)
    assert.equal(mfa.hatBestaetigtenFaktor(null), false)
  })

  test('mfaPflichtAktiv: nur Super-Admin und Betriebs-Manager, ab dem Stichtag (Wiener Kalendertag)', () => {
    const [j, m, t] = mfa.MFA_PFLICHT_AB.split('-').map(Number)
    mock.timers.enable({ apis: ['Date'], now: Date.UTC(j, m - 1, t - 1, 12) })   // Vortag mittags
    try {
      assert.equal(mfa.mfaPflichtAktiv('tenant_admin'), false)
      mock.timers.setTime(Date.UTC(j, m - 1, t, 12))                              // Stichtag mittags
      assert.equal(mfa.mfaPflichtAktiv('system_admin'), true)
      assert.equal(mfa.mfaPflichtAktiv('tenant_admin'), true)
      assert.equal(mfa.mfaPflichtAktiv('winzer'), false)
      assert.equal(mfa.mfaPflichtAktiv('leser'), false)
      // 00:30 Wiener Zeit am Stichtag = 22:30 UTC am Vortag (Sommerzeit): KAN-237 – schon Pflicht
      mock.timers.setTime(Date.UTC(j, m - 1, t - 1, 22, 30))
      assert.equal(mfa.mfaPflichtAktiv('tenant_admin'), true)
    } finally {
      mock.timers.reset()
    }
  })

  test('pruefeZweiFaktor: ohne Sitzung weiter, unbestätigte Sitzung 401, aal2 weiter, Faktor ohne Code 401', async () => {
    globalThis.__z.server = server({ user: null })
    assert.equal(await zf.pruefeZweiFaktor(), null)
    globalThis.__z.server = server({ user: null, fehler: { name: 'AuthApiError', message: 'invalid JWT', status: 403 } })
    const r1 = await zf.pruefeZweiFaktor()
    assert.equal(r1?.status, 401)
    assert.match((await r1.json()).fehler, /neu anmelden/)
    globalThis.__z.server = server({ user: { id: U, factors: FAKTOR }, aal: 'aal2' })
    assert.equal(await zf.pruefeZweiFaktor(), null)
    globalThis.__z.server = server({ user: { id: U, factors: FAKTOR }, aal: 'aal1' })
    const r2 = await zf.pruefeZweiFaktor()
    assert.equal(r2?.status, 401)
    assert.match((await r2.json()).fehler, /Code aus der Authenticator-App/)
    assert.equal(r2.headers.get('Cache-Control'), 'no-store')
  })

  test('pruefeZweiFaktor: Pflicht in Kraft und noch kein Faktor → 401; Mitarbeiter ohne Faktor → weiter', async () => {
    const [j, m, t] = mfa.MFA_PFLICHT_AB.split('-').map(Number)
    mock.timers.enable({ apis: ['Date'], now: Date.UTC(j, m - 1, t, 12) })
    try {
      globalThis.__z.server = server({ mitglieder: [mitglied(A, 'tenant_admin')] })
      const r = await zf.pruefeZweiFaktor()
      assert.equal(r?.status, 401)
      assert.match((await r.json()).fehler, /Pflicht/)
      globalThis.__z.server = server({ mitglieder: [mitglied(A, 'winzer')] })
      assert.equal(await zf.pruefeZweiFaktor(), null)
    } finally {
      mock.timers.reset()
    }
  })
})

describe('Schreibsperre und Sitzungssperre (sperren.ts)', nurMitHooks, () => {
  test('Abo gesperrt: Server Action wirft, { error }-Variante meldet, Route antwortet 403 mit Nur-Lesen-Kennung', async () => {
    globalThis.__z.abo = { stripe_status: 'unpaid', stripe_trial_ends_at: null, stripe_subscription_id: 'sub_1' }
    const m = { tenantId: A, role: 'tenant_admin' }
    assert.equal(await sperren.schreibSperre(m), 'abo')
    await assert.rejects(sperren.pruefeSchreibzugriff(m), e => e.name === 'AktionsFehler' && /Nur-Lesen-Modus/.test(e.message))
    assert.match(await sperren.schreibSperreFehler(m), /Nur-Lesen-Modus/)
    const r = await sperren.schreibSperreKonflikt(m)
    assert.equal(r?.status, 403)
    assert.equal(r.headers.get('X-S112-Nur-Lesen'), '1')
    const k = await r.json()
    assert.equal(k.nurLesen, true)
    assert.equal(k.fehler, k.error)
    const ki = await (await sperren.schreibSperreKonflikt(m, 'ki')).json()
    assert.match(ki.fehler, /KI-Abfragen/)
  })

  test('Abo aktiv, Super-Admin, ohne Betrieb: keine Sperre', async () => {
    globalThis.__z.abo = { stripe_status: 'active', stripe_trial_ends_at: null, stripe_subscription_id: 'sub_1' }
    assert.equal(await sperren.schreibSperre({ tenantId: A, role: 'winzer' }), null)
    assert.equal(await sperren.schreibSperreKonflikt({ tenantId: A, role: 'winzer' }), null)
    globalThis.__z.abo = { stripe_status: 'unpaid', stripe_trial_ends_at: null, stripe_subscription_id: 'sub_1' }
    assert.equal(await sperren.schreibSperre({ tenantId: A, role: 'system_admin' }), null)
    assert.equal(await sperren.schreibSperre({ tenantId: null, role: 'tenant_admin' }), null)
    await sperren.pruefeSchreibzugriff({ tenantId: A, role: 'system_admin' })
  })

  test('sitzungsSperre: „mfa“ nur bei Pflicht ohne Faktor – die Abo-Sperre gehört nicht dazu (Export im Nur-Lesen-Modus)', async () => {
    const [j, m, t] = mfa.MFA_PFLICHT_AB.split('-').map(Number)
    mock.timers.enable({ apis: ['Date'], now: Date.UTC(j, m - 1, t, 12) })
    try {
      globalThis.__z.abo = { stripe_status: 'unpaid', stripe_trial_ends_at: null, stripe_subscription_id: 'sub_1' }
      assert.equal(await sperren.sitzungsSperre(server(), { role: 'tenant_admin' }), 'mfa')
      assert.equal(await sperren.sitzungsSperre(server({ user: { id: U, factors: FAKTOR } }), { role: 'tenant_admin' }), null)
      assert.equal(await sperren.sitzungsSperre(server(), { role: 'winzer' }), null)
    } finally {
      mock.timers.reset()
    }
  })
})

describe('Betrieb der Seite (seitenBetrieb.ts, KAN-30)', nurMitHooks, () => {
  const H = 'x-s112-seiten-betrieb'
  test('abweichender Betrieb: Action wirft, { error } meldet, Route antwortet 409 im gewünschten Feld', async () => {
    globalThis.__z.header = { [H]: B }
    await assert.rejects(sb.pruefeSeitenBetrieb(A), e => e.name === 'AktionsFehler' && /anderen Tab gewechselt/.test(e.message))
    assert.match(await sb.seitenBetriebFehler(A), /anderen Tab gewechselt/)
    const r = await sb.seitenBetriebKonflikt(A, 'error')
    assert.equal(r?.status, 409)
    assert.match((await r.json()).error, /anderen Tab gewechselt/)
  })

  test('gleicher Betrieb, fehlender Header oder kein aktiver Betrieb: keine Ablehnung (Header kann nie freischalten)', async () => {
    globalThis.__z.header = { [H]: A }
    await sb.pruefeSeitenBetrieb(A)
    assert.equal(await sb.seitenBetriebFehler(A), null)
    assert.equal(await sb.seitenBetriebKonflikt(A), null)
    globalThis.__z.header = {}
    assert.equal(await sb.seitenBetriebFehler(A), null)
    globalThis.__z.header = { [H]: B }
    assert.equal(await sb.seitenBetriebFehler(null), null)
    assert.equal(await sb.seitenBetriebKonflikt(undefined), null)
  })

  test('Konstante des Headers wie im Wächter', async () => {
    const w = await laden('lib/tenant/waechter.ts')
    assert.equal(w.SEITEN_BETRIEB_HEADER.toLowerCase(), H)
  })
})
