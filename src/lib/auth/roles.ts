import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getActiveTenantCookie } from '@/lib/auth/activeTenant'

export type UserRole = 'system_admin' | 'tenant_admin' | 'winzer' | 'leser' | null

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

/**
 * Gibt die Rolle des eingeloggten Users im aktiven Tenant zurück.
 */
export async function getCurrentUserRole(): Promise<UserRole> {
  const m = await getCurrentMembership()
  return m?.role ?? null
}

/** Gibt Tenant-ID + Rolle zurück – liest aktiven Tenant aus Cookie */
export async function getCurrentMembership(): Promise<{ tenantId: string; role: UserRole } | null> {
  const supabase = await createSupabaseServerClient()
  const activeTenantId = await getActiveTenantCookie()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  if (activeTenantId) {
    // Validiere Cookie gegen tatsächliche Memberships. WICHTIG: zusätzlich zu RLS explizit
    // auf user_id filtern - die RLS-Policy "memberships: tenant_admin can view all in
    // tenant" lässt system_admin/tenant_admin absichtlich ALLE Mitgliedschafts-Zeilen ihres
    // Tenants sehen (für die Nutzerverwaltung), nicht nur ihre eigene. Ohne .eq('user_id',
    // user.id) könnte .limit(1).maybeSingle() bei einem Tenant mit mehreren Mitgliedern
    // eine BELIEBIGE dieser sichtbaren Zeilen zurückgeben - und damit einem system_admin/
    // tenant_admin fälschlich die Rolle eines ANDEREN Mitglieds zuweisen (z.B. 'leser'
    // statt der eigenen 'system_admin'-Rolle), abhängig von einer nicht garantierten
    // Zeilenreihenfolge ohne ORDER BY.
    const { data } = await (supabase.from('tenant_memberships') as any)
      .select('tenant_id, role')
      .eq('tenant_id', activeTenantId)
      .eq('user_id', user.id)
      .eq('aktiv', true)   // deaktivierte Mitgliedschaft (Migration 159) zählt nicht - wie in RLS
      .limit(1)
      .maybeSingle()
    if (data) return { tenantId: (data as R).tenant_id, role: (data as R).role as UserRole }
  }

  // Fallback: erste Membership (kein Cookie gesetzt oder Cookie veraltet). Das IST hier
  // die kanonische "irgendeine Mitgliedschaft"-Fallback-Logik selbst, auf die sich
  // getCurrentMembership() als Ganzes stützt - jede andere Stelle im Code soll
  // stattdessen getCurrentMembership() aufrufen statt diese Query zu duplizieren. Auch
  // hier auf user_id gefiltert (siehe Kommentar oben) - ansonsten dieselbe Gefahr einer
  // fremden Mitgliedschaftszeile, nur diesmal sogar potenziell eines FREMDEN Mandanten.
  // tenant-isolation-ignore: kanonischer Fallback ohne aktiven Tenant-Cookie, siehe Kommentar oben
  const { data } = await (supabase.from('tenant_memberships') as any)
    .select('tenant_id, role')
    .eq('user_id', user.id)
    .eq('aktiv', true)
    .limit(1)
    .maybeSingle()
  if (!data) return null
  return { tenantId: (data as R).tenant_id, role: (data as R).role as UserRole }
}

// ── Berechtigungsprüfungen ─────────────────────────────────────────────────

/** Darf anlegen + bearbeiten (alle außer leser) */
export function canWrite(role: UserRole): boolean {
  return role === 'system_admin' || role === 'tenant_admin' || role === 'winzer'
}

/** Darf löschen + deaktivieren (nur Admins) */
export function canAdmin(role: UserRole): boolean {
  return role === 'system_admin' || role === 'tenant_admin'
}

/** Darf Benutzerverwaltung (nur Admins) */
export function canManageUsers(role: UserRole): boolean {
  return role === 'system_admin' || role === 'tenant_admin'
}

/** Ist Plattform-Admin */
export function isSystemAdmin(role: UserRole): boolean {
  return role === 'system_admin'
}

/** Lesbare Rollenbezeichnung auf Deutsch */
export function roleLabel(role: UserRole): string {
  const labels: Record<string, string> = {
    system_admin: 'System-Admin',
    tenant_admin: 'Betriebsleiter',
    winzer:       'Winzer/Kellermeister',
    leser:        'Nur-Lesen',
  }
  return role ? (labels[role] ?? role) : '–'
}

// ── Sandbox-Sonderfreigabe für den Administration-Menübaum ─────────────────
//
// paul.derstroff@outlook.com und jg@weingut-gebeshuber.at sollen den
// Administration-Menübaum (Mandanten/Release Notes/Datenimport/System-Admin/
// Onboarding Guide/Zeiterfassung) sehen und nutzen können, aber AUSSCHLIESSLICH
// solange ihr aktiver Betrieb der Mandant "Sandbox" ist - in jedem anderen
// Mandanten (auch dem echten Weingut Gebeshuber) NIE (Rückmeldung 19.8.2026).
// Das gilt unabhängig von ihrer tatsächlichen Rolle im jeweiligen Mandanten.
//
// WICHTIG: Diese Liste schaltet nur die MENÜSICHTBARKEIT frei (Sidebar.tsx).
// Die dahinterliegenden Seiten /admin/mandanten, /admin/mandanten/[id] und
// /admin/benutzer sind zusätzlich selbst gehärtet, damit die Sonderfreigabe
// NIEMALS echte Kundendaten (u.a. Stripe/Brevo/SMTP-IMAP/M365/SumUp-
// Zugangsdaten oder System-Admin-Listen anderer Mandanten) ausliefert, egal
// welche URL direkt aufgerufen wird - siehe isSandboxAdminUnlock()-Aufrufe in
// den jeweiligen page.tsx/actions.ts-Dateien. /admin/import und
// /admin/onboarding sind bereits von sich aus ungefährlich (tenant-gescopt
// bzw. rein statischer Inhalt) und brauchen keine zusätzliche Härtung.
export const SANDBOX_ADMIN_ALLOWLIST = ['paul.derstroff@outlook.com', 'jg@weingut-gebeshuber.at']

/** true, wenn diese E-Mail zur Sandbox-Sonderfreigabe gehört UND der aktuell
 *  aktive/betroffene Mandant tatsächlich "Sandbox" ist. */
export function isSandboxAdminUnlock(email: string | null | undefined, isSandbox: boolean): boolean {
  if (!isSandbox || !email) return false
  return SANDBOX_ADMIN_ALLOWLIST.includes(email.toLowerCase())
}
