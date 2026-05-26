'use server'

import { revalidatePath } from 'next/cache'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { getCurrentMembership, canManageUsers } from '@/lib/auth/roles'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

export type MemberWithEmail = {
  id: string
  user_id: string
  role: string
  created_at: string
  email: string
}

export type UnassignedUser = {
  user_id: string
  email: string
}

/** Mitglieder des Tenants + Email aus auth.users */
export async function getTenantMembers(): Promise<MemberWithEmail[]> {
  const membership = await getCurrentMembership()
  if (!membership) return []

  const supabase = await createSupabaseServerClient()
  const admin    = createSupabaseAdminClient()

  // Memberships laden
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: memberships } = await (supabase.from('tenant_memberships') as any)
    .select('id, user_id, role, created_at')
    .eq('tenant_id', membership.tenantId)
    .order('created_at')

  if (!memberships || memberships.length === 0) return []

  // Alle Auth-User laden (admin API) um Emails zu bekommen
  const { data: { users } } = await admin.auth.admin.listUsers({ perPage: 1000 })
  const emailMap: Record<string, string> = {}
  users.forEach(u => { emailMap[u.id] = u.email ?? '–' })

  return (memberships as R[]).map(m => ({
    id:         m.id,
    user_id:    m.user_id,
    role:       m.role,
    created_at: m.created_at,
    email:      emailMap[m.user_id] ?? m.user_id,
  }))
}

/** Auth-User die noch NICHT im Tenant sind (für Zuweisung) */
export async function getUnassignedUsers(): Promise<UnassignedUser[]> {
  const membership = await getCurrentMembership()
  if (!membership || !canManageUsers(membership.role)) return []

  const supabase = await createSupabaseServerClient()
  const admin    = createSupabaseAdminClient()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: memberships } = await (supabase.from('tenant_memberships') as any)
    .select('user_id')
    .eq('tenant_id', membership.tenantId)

  const assignedIds = new Set((memberships ?? []).map((m: R) => m.user_id as string))

  const { data: { users } } = await admin.auth.admin.listUsers({ perPage: 1000 })

  return users
    .filter(u => !assignedIds.has(u.id))
    .map(u => ({ user_id: u.id, email: u.email ?? '–' }))
}

/** Bestehenden Auth-User dem Tenant zuweisen */
export async function assignUserToTenant(userId: string, role: string) {
  const membership = await getCurrentMembership()
  if (!membership || !canManageUsers(membership.role)) {
    return { error: 'Keine Berechtigung' }
  }

  const supabase = await createSupabaseServerClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.from('tenant_memberships') as any)
    .insert({ tenant_id: membership.tenantId, user_id: userId, role })

  if (error) return { error: error.message }
  revalidatePath('/benutzer')
  return { success: true }
}

/** Rollenänderung */
export async function updateMemberRole(membershipId: string, newRole: string) {
  const membership = await getCurrentMembership()
  if (!membership || !canManageUsers(membership.role)) {
    return { error: 'Keine Berechtigung' }
  }

  const supabase = await createSupabaseServerClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.from('tenant_memberships') as any)
    .update({ role: newRole })
    .eq('id', membershipId)
    .eq('tenant_id', membership.tenantId)

  if (error) return { error: error.message }
  revalidatePath('/benutzer')
  return { success: true }
}

/** Mitglied entfernen */
export async function removeMember(membershipId: string) {
  const membership = await getCurrentMembership()
  if (!membership || !canManageUsers(membership.role)) {
    return { error: 'Keine Berechtigung' }
  }

  const supabase = await createSupabaseServerClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.from('tenant_memberships') as any)
    .delete()
    .eq('id', membershipId)
    .eq('tenant_id', membership.tenantId)

  if (error) return { error: error.message }
  revalidatePath('/benutzer')
  return { success: true }
}
