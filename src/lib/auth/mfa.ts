// ── Zwei-Faktor-Anmeldung (Sicherheits-Welle 2, Befund S3, 23.9.2026) ─────────
// Authenticator-App (TOTP) über Supabase Auth MFA.
//  - Wer einen Faktor eingerichtet hat, muss nach dem Passwort den Code eingeben
//    (Stufe aal2) – erzwungen im Proxy (src/proxy.ts) für alle Seiten und seit
//    KAN-54 (24.9.2026) per pruefeZweiFaktor() (src/lib/api/zweiFaktor.ts) in den
//    API-Routen, die der Proxy-Matcher ausschließt. Seit KAN-136 zusätzlich in der
//    Datenbank (s112_aal_ok(): Policy zwei_faktor_aal auf allen Tabellen und Storage,
//    pruefe_tenant_zugriff, PostgREST-Pre-Request) und in getCurrentMembership().
//    Die PFLICHT (unten) prüft nur die App – in der DB wäre sie wirkungslos, weil eine
//    aal1-Sitzung ohne Faktor selbst einen Faktor einrichten und aal2 erreichen kann.
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
  return { hatFaktor, stufe: (aal?.currentLevel ?? null) as MfaStand['stufe'], pflicht, pflichtAktiv: mfaPflichtAktiv(role) }
}

// ── Prüfung für Proxy und API-Routen (KAN-54, 24.9.2026) ─────────────────────
// Ob ein Faktor eingerichtet ist, NUR aus dem vom Auth-Server geprüften User von
// supabase.auth.getUser() lesen. getAuthenticatorAssuranceLevel() ohne JWT-Argument
// leitet nextLevel aus der Faktorenliste im Sitzungs-Cookie ab – die ist nicht
// signiert: wer das Cookie um die Faktoren kürzt, wäre ohne Code durchgekommen.
// Die erreichte Stufe (currentLevel) steht dagegen im signierten Zugriffstoken, das
// getUser() im selben Request beim Auth-Server bestätigt hat.

type MfaUser = { factors?: { status: string }[] | null } | null | undefined

/** Bestätigter Faktor vorhanden? `user` muss aus supabase.auth.getUser() stammen. */
export function hatBestaetigtenFaktor(user: MfaUser): boolean {
  return (user?.factors ?? []).some(f => f.status === 'verified')
}

/** Zwei-Faktor-Pflicht für diese Rolle bereits in Kraft? */
export function mfaPflichtAktiv(role: UserRole): boolean {
  return MFA_PFLICHT_ROLLEN.includes(role) && new Date().toISOString().slice(0, 10) >= MFA_PFLICHT_AB
}
