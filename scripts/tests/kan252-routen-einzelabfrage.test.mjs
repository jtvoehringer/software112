// KAN-252 (09.10.2026): Einzelabfragen in Route-Handlern (route.ts) werten ihren Fehler aus – Folge von KAN-251.
// Webhooks antworteten bei einem Lesefehler mit 2xx/4xx; der Anbieter stellte das Ereignis dann nicht erneut zu.
// Hier: der Wächter erfasst route.ts, und der SumUp-Webhook antwortet bei einem Lesefehler 500 statt 403/404
// (ohne den Fix rot).
//
// Aufruf:  npm run -s test:csv   (Node ≥ 22.15 wegen module.registerHooks)

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { DOPPEL, hooksRegistrieren, laden, nurMitHooks, hooksMoeglich, datenbank } from './buchung-attrappe.mjs'

const HIER = path.dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)
const { pruefeText } = require(path.join(HIER, '..', 'check-einzelabfrage.js'))

describe('check-einzelabfrage: Route-Handler', () => {
  const abfrage = `export async function GET() {\n  const { data } = await s.from('t').select('id').maybeSingle()\n}\n`
  test('route.ts wird geprüft, auch ohne \'use server\'; andere Dateien ohne Direktive nicht', () => {
    assert.deepEqual(pruefeText(abfrage, { route: true }).funde.map(f => f.zeile), [2])
    assert.deepEqual(pruefeText(abfrage).funde, [])
  })
})

// ── SumUp-Webhook ────────────────────────────────────────────────────────────

const SCHLUESSEL = 'test-schluessel-mit-mindestens-32-zeichen-lang'
process.env.EMAIL_CRYPT_SECRET_V2 = process.env.EMAIL_CRYPT_SECRET_V2 || SCHLUESSEL
const modul = code => 'data:text/javascript,' + encodeURIComponent(code)
DOPPEL['next/server'] = modul('export class NextResponse { static json(body, init) { return { status: init?.status ?? 200, body } } }; export class NextRequest {}')
// Der Webhook legt seinen Service-Role-Client beim Laden an – die Attrappe reicht an globalThis.__adminFake weiter
DOPPEL['@supabase/supabase-js'] = modul('export const createClient = () => ({ from: t => globalThis.__adminFake.from(t), rpc: (...a) => globalThis.__adminFake.rpc(...a) })')
hooksRegistrieren()
const wh = hooksMoeglich ? await laden('lib/sumup/webhook.ts') : null
const route = hooksMoeglich ? await laden('app/api/sumup/webhook/route.ts') : null

const TEN = '11111111-1111-4111-8111-111111111111'
const CO = '22222222-2222-4222-8222-222222222222'
const anfrage = () => ({
  nextUrl: new URL(wh.sumupWebhookUrl('https://x.at', TEN, CO)),
  text: async () => JSON.stringify({ event_type: 'CHECKOUT_STATUS_CHANGED', id: 'sumup-1' }),
})
const daten = () => ({
  tenant_einstellungen: [{ tenant_id: TEN, modul_sumup: true, sumup_api_key: 'klartext-key' }],
  sumup_checkouts: [{ id: CO, tenant_id: TEN, sumup_checkout_id: 'sumup-1' }],
})

describe('KAN-252: SumUp-Webhook bei Lesefehler 500 (SumUp stellt erneut zu)', nurMitHooks, () => {
  for (const tab of ['tenant_einstellungen', 'sumup_checkouts']) {
    test(`Lesefehler ${tab} → 500, nicht 403/404`, async () => {
      const orig = console.error
      console.error = () => {}
      try {
        globalThis.__adminFake = datenbank(daten(), { vorher: e => (e.tabelle === tab ? { error: { message: 'Zeitüberschreitung' } } : null) })
        const r = await route.POST(anfrage())
        assert.equal(r.status, 500)
      } finally { console.error = orig; globalThis.__adminFake = null }
    })
  }

  test('wirklich nicht aktiviert bzw. Checkout fehlt: weiterhin 403 bzw. 404', async () => {
    const aus = daten(); aus.tenant_einstellungen[0].modul_sumup = false
    globalThis.__adminFake = datenbank(aus)
    assert.equal((await route.POST(anfrage())).status, 403)
    const ohne = daten(); ohne.sumup_checkouts = []
    globalThis.__adminFake = datenbank(ohne)
    assert.equal((await route.POST(anfrage())).status, 404)
    globalThis.__adminFake = null
  })
})
