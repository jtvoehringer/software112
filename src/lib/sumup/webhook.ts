// ── Signierte Webhook-URL für SumUp-Checkouts (Befund aus KAN-54, 24.9.2026) ──
// SumUp signiert Checkout-Webhooks nicht: kein HMAC, kein Signatur-Header, kein
// Webhook-Secret. SumUp ruft nur die return_url des Checkouts per POST auf, Body
// { "event_type": "CHECKOUT_STATUS_CHANGED", "id": "<SumUp-Checkout-ID>" }, und die
// Doku verlangt, das Ereignis danach immer über die SumUp-API zu bestätigen.
// Die frühere Prüfung von X-SumUp-Signature mit dem API-Key lief daher ins Leere –
// und ohne Header wurde jede Meldung angenommen. Jetzt:
//   return_url = /api/sumup/webhook?tenant_id=…&checkout=<sumup_checkouts.id>&sig=<HMAC>
//   HMAC über "<tenant_id>:<checkout>" mit Unterschlüssel aus EMAIL_CRYPT_SECRET_V2
//   (wie M365-clientState und Abmeldelink) – kein eigenes Secret je Mandant nötig.
// Wird EMAIL_CRYPT_SECRET_V2 getauscht, werden die URLs offener Checkouts ungültig;
// deren Status lässt sich weiter über GET /api/sumup/checkout bzw. SumUp abfragen.
import { createHmac, timingSafeEqual } from 'crypto'
import { unterschluessel } from '@/lib/email/crypto'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const sig = (tenantId: string, checkoutId: string) =>
  createHmac('sha256', unterschluessel('sumup-webhook')).update(`${tenantId}:${checkoutId}`).digest('base64url')

/** return_url für POST /v0.1/checkouts – gilt nur für genau diesen lokalen Checkout. */
export function sumupWebhookUrl(basis: string, tenantId: string, checkoutId: string): string {
  const q = new URLSearchParams({ tenant_id: tenantId, checkout: checkoutId, sig: sig(tenantId, checkoutId) })
  return `${basis.replace(/\/$/, '')}/api/sumup/webhook?${q}`
}

/** Liefert Mandant und lokalen Checkout nur, wenn die Signatur in der URL stimmt (zeitkonstanter Vergleich). */
export function pruefeSumupWebhook(params: URLSearchParams): { tenantId: string; checkoutId: string } | null {
  const tenantId   = params.get('tenant_id') ?? ''
  const checkoutId = params.get('checkout') ?? ''
  const signatur   = params.get('sig') ?? ''
  if (!UUID.test(tenantId) || !UUID.test(checkoutId) || !signatur) return null
  const a = Buffer.from(signatur), b = Buffer.from(sig(tenantId, checkoutId))
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null
  return { tenantId, checkoutId }
}
