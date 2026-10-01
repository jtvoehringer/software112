// KAN-10 (Rest), KAN-24, KAN-25, KAN-26 (01.10.2026): Mandantenverwaltung, Sandbox-Erkennung, M365-Subscribe
//
// Aufruf:  node --test scripts/tests/kan10-24-25-26-mandantenverwaltung.test.mjs   (läuft auch über npm run test:csv)
//
// Quelltext-Prüfungen – die Regeln sollen nicht still wieder verschwinden.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const quelle = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')
const MANDANT = 'src/app/(dashboard)/admin/mandanten/[id]/actions.ts'
const CLIENT = 'src/app/(dashboard)/admin/mandanten/[id]/MandantDetailClient.tsx'

/** Rumpf einer exportierten Funktion bis zur nächsten exportierten Funktion */
function rumpf(q, fn) {
  const i = q.indexOf(`export async function ${fn}(`)
  assert.ok(i >= 0, fn)
  const j = q.indexOf('\nexport ', i + 1)
  return q.slice(i, j < 0 ? undefined : j)
}

describe('KAN-10: Stripe-IDs serverseitig, Preis nur über das Paket', () => {
  const q = quelle(MANDANT)

  test('Portal und Kündigung nehmen keine Stripe-ID mehr vom Client', () => {
    assert.match(q, /export async function createStripePortalSession\(tenantId: string\)/)
    assert.match(q, /export async function cancelStripeSubscription\(tenantId: string\)/)
    for (const fn of ['createStripePortalSession', 'cancelStripeSubscription', 'createStripeCheckoutSession']) {
      assert.match(rumpf(q, fn), /await ladeStripeIds\(tenantId\)/, fn)
    }
  })

  test('ladeStripeIds liest stripe_customer_id und stripe_subscription_id aus tenants des Ziel-Betriebs', () => {
    const i = q.indexOf('async function ladeStripeIds(')
    assert.ok(i >= 0)
    const f = q.slice(i, q.indexOf('\n}\n', i) > 0 ? q.indexOf('\n}\n', i) : q.indexOf('\r\n}\r\n', i))
    assert.match(f, /from\('tenants'\)/)
    assert.match(f, /stripe_customer_id, stripe_subscription_id/)
    assert.match(f, /\.eq\('id', tenantId\)/)
  })

  test('Checkout nur mit Paket-Schlüssel, Preis-ID über paketPriceId, ohne Sandbox-Freigabe', () => {
    const f = rumpf(q, 'createStripeCheckoutSession')
    assert.match(f, /export async function createStripeCheckoutSession\(tenantId: string, paket: string\)/)
    assert.match(f, /await assertSystemAdmin\(tenantId, \{ sandboxFreigabe: false \}\)/)
    assert.match(f, /istPaketKey\(paket\)/)
    assert.match(f, /paketPriceId\(paket\)/)
    assert.doesNotMatch(f, /customerId: string|priceId: string/)
  })

  test('Client schickt nur Betrieb bzw. Paket-Schlüssel', () => {
    const c = quelle(CLIENT)
    assert.match(c, /createStripeCheckoutSession\(tenant\.id, paket\)/)
    assert.match(c, /createStripePortalSession\(tenant\.id\)/)
    assert.match(c, /cancelStripeSubscription\(tenant\.id\)/)
    assert.doesNotMatch(c, /stripe_customer_id!,|stripe_subscription_id!\)/)
  })
})

describe('KAN-10: Sandbox über die feste ID statt über Name oder Slug', () => {
  for (const p of [
    'src/app/(dashboard)/layout.tsx',
    'src/app/(dashboard)/admin/benutzer/page.tsx',
    'src/app/(dashboard)/admin/release-notes/page.tsx',
    'src/lib/morgenbericht/pruefungen.ts',
  ]) {
    test(p, () => {
      const q = quelle(p)
      assert.match(q, /SANDBOX_TENANT_ID/, p)
      assert.doesNotMatch(q, /=== 'Sandbox'/, p)
      assert.doesNotMatch(q, /\.eq\('name', 'Sandbox'\)/, p)
      assert.doesNotMatch(q, /slug === 'sandbox'/, p)
    })
  }
})

describe('KAN-24: saveTenantSettings schreibt nur übergebene Felder', () => {
  const f = rumpf(quelle(MANDANT), 'saveTenantSettings')
  test('session_timeout_minuten nur, wenn mitgeschickt', () => {
    assert.match(f, /formData\.has\(key\) \? \{ \[key\]: wert\(\) \} : \{\}/)
    assert.match(f, /\.\.\.zahl\('session_timeout_minuten'\)/)
    assert.doesNotMatch(f, /session_timeout_minuten:\s+num\(/)
  })
  test('auch Branding-, Modul- und Brevo-Felder bedingt', () => {
    for (const k of ['anzeigename', 'logo_url', 'brevo_sender_mail', 'brevo_sender_name']) assert.match(f, new RegExp(`\\.\\.\\.text\\('${k}'\\)`), k)
    for (const k of ['modul_newsletter', 'modul_crm', 'modul_ea', 'modul_controlling', 'assistent_aktiv']) assert.match(f, new RegExp(`\\.\\.\\.schalter\\('${k}'\\)`), k)
    for (const k of ['brevo_list_privat', 'brevo_list_grossh']) assert.match(f, new RegExp(`\\.\\.\\.zahl\\('${k}'\\)`), k)
  })
})

describe('KAN-25: /api/m365/subscribe verlangt im Sitzungszweig Admin-Rechte', () => {
  const q = quelle('src/app/api/m365/subscribe/route.ts')
  test('canAdmin im Sitzungszweig, 403 sonst', () => {
    assert.match(q, /if \(!membership \|\| !canAdmin\(membership\.role\)\) return NextResponse\.json\(\{ fehler: 'Keine Berechtigung' \}, \{ status: 403 \}\)/)
    const sitzung = q.indexOf('if (!hasCronAuth) {\n      // KAN-25') >= 0 ? q.indexOf('if (!hasCronAuth) {\n      // KAN-25') : q.indexOf('if (!hasCronAuth) {\r\n      // KAN-25')
    assert.ok(sitzung > 0, 'Prüfung liegt im Sitzungszweig')
  })
})

describe('KAN-26: toter Code saveBranding entfernt', () => {
  test('keine Funktion saveBranding in der Mandantenliste', () => {
    assert.doesNotMatch(quelle('src/app/(dashboard)/admin/mandanten/actions.ts'), /export async function saveBranding\(/)
  })
})
