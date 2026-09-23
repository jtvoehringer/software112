// ── Zwei-Faktor-Anmeldung (Sicherheits-Welle 2, Befund S3, 23.9.2026) ─────────
// Authenticator-App (TOTP) über Supabase Auth MFA.
//  - Wer einen Faktor eingerichtet hat, muss nach dem Passwort den Code eingeben
//    (Stufe aal2) – erzwungen im Proxy (src/proxy.ts) für alle Seiten.
//  - Pflicht für Super-Admin und Betriebs-Manager ab MFA_PFLICHT_AB; davor ein Hinweis.
//  - Für alle anderen Rollen freiwillig (Profil → Zwei-Faktor-Anmeldung).
// Verlorenes Handy: Super-Admin entfernt den Faktor in Supabase (Authentication →
// Users → Benutzer → MFA-Faktoren löschen); danach richtet der Benutzer neu ein.

import type { UserRole } from '@/lib/auth/roles'

export const MFA_PFLICHT_AB = '2026-10-15'
export const MFA_PFLICHT_ROLLEN: UserRole[] = ['system_admin', 'tenant_admin']

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

export type MfaStand = { hatFaktor: boolean; stufe: 'aal1' | 'aal2' | null; pflicht: boolean; pflichtAktiv: boolean }

/** Stand der Zwei-Faktor-Anmeldung für den angemeldeten Benutzer (Server) */
export async function ladeMfaStand(supabase: R, role: UserRole): Promise<MfaStand> {
  const [{ data: aal }, { data: faktoren }] = await Promise.all([
    supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
    supabase.auth.mfa.listFactors(),
  ])
  const hatFaktor = ((faktoren?.totp ?? []) as R[]).some(f => f.status === 'verified')
  const pflicht = MFA_PFLICHT_ROLLEN.includes(role)
  const heute = new Date().toISOString().slice(0, 10)
  return { hatFaktor, stufe: (aal?.currentLevel ?? null) as MfaStand['stufe'], pflicht, pflichtAktiv: pflicht && heute >= MFA_PFLICHT_AB }
}
