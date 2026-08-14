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

  if (activeTenantId) {
    // Validiere Cookie gegen tatsächliche Memberships (RLS schützt automatisch).
    // aktiv=true: eine deaktivierte Mitgliedschaft (Migration 159, Toggle in der
    // Benutzerverwaltung) zählt für den gesamten App-Zugriff wie "kein Zugriff".
    const { data } = await (supabase.from('tenant_memberships') as any)
      .select('tenant_id, role')
      .eq('tenant_id', activeTenantId)
      .eq('aktiv', true)
      .limit(1)
      .maybeSingle()
    if (data) return { tenantId: (data as R).tenant_id, role: (data as R).role as UserRole }
  }

  // Fallback: erste (aktive) Membership (kein Cookie gesetzt oder Cookie veraltet)
  const { data } = await (supabase.from('tenant_memberships') as any)
    .select('tenant_id, role')
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
