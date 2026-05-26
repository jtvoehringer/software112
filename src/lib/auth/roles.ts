import { createSupabaseServerClient } from '@/lib/supabase/server'

export type UserRole = 'system_admin' | 'tenant_admin' | 'winzer' | 'leser' | null

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

/**
 * Gibt die Rolle des eingeloggten Users im ersten verfügbaren Tenant zurück.
 * Cached per Request durch Next.js deduplizierung.
 */
export async function getCurrentUserRole(): Promise<UserRole> {
  const supabase = await createSupabaseServerClient()
  const { data } = await supabase
    .from('tenant_memberships')
    .select('role')
    .limit(1)
    .single()
  return ((data as R | null)?.role as UserRole) ?? null
}

/** Gibt Tenant-ID + Rolle zurück */
export async function getCurrentMembership(): Promise<{ tenantId: string; role: UserRole } | null> {
  const supabase = await createSupabaseServerClient()
  const { data } = await supabase
    .from('tenant_memberships')
    .select('tenant_id, role')
    .limit(1)
    .single()
  if (!data) return null
  return {
    tenantId: (data as R).tenant_id,
    role: (data as R).role as UserRole,
  }
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
