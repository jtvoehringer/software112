import 'server-only'
import { STRIPE_BLOCKED_STATUSES, istTrialAbgelaufen } from '@/lib/stripe/client'
import { ladeTenantKopf } from '@/lib/tenant/kopf'
import { ladeMfaStand } from '@/lib/auth/mfa'
import type { Membership, UserRole } from '@/lib/auth/roles'

// ── Sitzungssperren: Abo und Zwei-Faktor-Einrichtungspflicht (server-only, 25.09.2026) ──
//
// Beide Sperren erzwingt das Dashboard-Layout ((dashboard)/layout.tsx) per Umleitung auf
// /abo bzw. /zwei-faktor?pflicht=1. Route-Handler unter (dashboard) – v. a. die zentrale
// CSV-Route /meldungen/<id>/csv – durchlaufen das Layout nicht; der Proxy verlangt aal2 nur
// von Konten, die schon einen Faktor eingerichtet haben. Deshalb prüfen Layout UND Route
// über diese Datei (eine Regel, zwei Aufrufer).
//
// Abo: gesperrt bei STRIPE_BLOCKED_STATUSES oder abgelaufener Testphase – ausgenommen
// system_admin (Plattformbetreiber) und der Sandbox-Mandant; 'past_due' nur Warnung.
// MFA: Super-Admin und Betriebs-Manager ohne eingerichteten Faktor ab MFA_PFLICHT_AB.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

export type AboStand = { gesperrt: boolean; warnung: boolean }

/** Abo-Stand aus tenants.stripe_status / stripe_trial_ends_at (reine Funktion, wie bisher im Layout) */
export function aboStand(tenant: R | null | undefined, role: UserRole | null | undefined): AboStand {
  const stripeStatus = (tenant?.stripe_status as string | null | undefined) ?? null
  const trialEndsAt = (tenant?.stripe_trial_ends_at as string | null | undefined) ?? null
  const isSandbox = tenant?.name === 'Sandbox'
  if (!stripeStatus || role === 'system_admin' || isSandbox) return { gesperrt: false, warnung: false }
  if (STRIPE_BLOCKED_STATUSES.includes(stripeStatus) || istTrialAbgelaufen(stripeStatus, trialEndsAt)) return { gesperrt: true, warnung: false }
  return { gesperrt: false, warnung: stripeStatus === 'past_due' }
}

export type SitzungsSperre = 'abo' | 'mfa' | null

/**
 * Sperre der aktiven Sitzung: 'mfa' (2FA-Pflicht, Faktor fehlt), 'abo' (Zugang gesperrt)
 * oder null. Reihenfolge wie im Layout: erst Zwei-Faktor, dann Abo.
 */
export async function sitzungsSperre(supabase: R, membership: Pick<Membership, 'role' | 'tenantId'>): Promise<SitzungsSperre> {
  const mfa = await ladeMfaStand(supabase, membership.role)
  if (mfa.pflichtAktiv && !mfa.hatFaktor) return 'mfa'
  if (!membership.tenantId) return null
  const kopf = await ladeTenantKopf(membership.tenantId)
  return aboStand(kopf.tenant, membership.role).gesperrt ? 'abo' : null
}

/** Deutsche Meldung für die JSON-Antwort { fehler } (HTTP 403) */
export const SPERR_TEXT: Record<Exclude<SitzungsSperre, null>, string> = {
  mfa: 'Für deine Rolle ist die Zwei-Faktor-Anmeldung Pflicht – bitte zuerst unter „Profil › Zwei-Faktor-Anmeldung“ (/zwei-faktor) einrichten und den Export danach erneut starten.',
  abo: 'Der Zugang dieses Betriebs ist gesperrt (Abo abgelaufen oder gekündigt) – Exporte sind erst nach Klärung unter /abo wieder möglich.',
}
