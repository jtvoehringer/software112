'use server'

import { revalidatePath } from 'next/cache'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentMembership, canManageUsers } from '@/lib/auth/roles'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

/** Lädt alle Mitglieder des eigenen Tenants */
export async function getTenantMembers() {
  const membership = await getCurrentMembership()
  if (!membership) return []

  const supabase = await createSupabaseServerClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (supabase.from('tenant_memberships') as any)
    .select('id, user_id, role, created_at')
    .eq('tenant_id', membership.tenantId)
    .order('created_at')

  return (data ?? []) as R[]
}

/** Rollenänderung: nur tenant_admin/system_admin */
export async function updateMemberRole(
  membershipId: string,
  newRole: string
) {
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

/** Mitglied entfernen: nur tenant_admin/system_admin, nicht sich selbst */
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
