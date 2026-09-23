// ── Prüfwert für Microsoft-Graph-Webhooks (Sicherheit S8, 23.9.2026) ─────────
// Bisher war clientState = tenant_id. Betriebs-IDs sind kein Geheimnis, wer eine kannte,
// konnte dem Webhook gefälschte Benachrichtigungen schicken. Jetzt:
//   clientState = "<tenant_id>.<HMAC(tenant_id)>"  (Schlüssel aus EMAIL_CRYPT_SECRET_V2)
// Alte Abonnements (clientState nur tenant_id) werden bis zu ihrer Neuanlage nur noch
// akzeptiert, wenn die subscriptionId zur gespeicherten passt (zufällige GUID von Microsoft).
import { createHmac, timingSafeEqual } from 'crypto'
import { unterschluessel } from '@/lib/email/crypto'

const sig = (tenantId: string) =>
  createHmac('sha256', unterschluessel('m365-webhook-clientstate')).update(tenantId).digest('base64url')

/** Für neue Abonnements (max. 128 Zeichen, hier ca. 80). */
export function erzeugeClientState(tenantId: string): string {
  return `${tenantId}.${sig(tenantId)}`
}

/**
 * Liefert die tenant_id, wenn der Prüfwert gültig ist.
 * `legacy: true` = altes Format; der Aufrufer muss dann die subscriptionId abgleichen.
 */
export function pruefeClientState(wert: unknown): { tenantId: string; legacy: boolean } | null {
  if (typeof wert !== 'string' || wert.length > 128) return null
  const punkt = wert.indexOf('.')
  if (punkt < 0) {
    return /^[0-9a-f-]{36}$/i.test(wert) ? { tenantId: wert, legacy: true } : null
  }
  const tenantId = wert.slice(0, punkt)
  const a = Buffer.from(wert.slice(punkt + 1))
  const b = Buffer.from(sig(tenantId))
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null
  return { tenantId, legacy: false }
}
