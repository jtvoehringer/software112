'use server'

import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { getCurrentUserRole } from '@/lib/auth/roles'
import { revalidatePath } from 'next/cache'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

async function assertSystemAdmin() {
  const role = await getCurrentUserRole()
  if (role !== 'system_admin') throw new Error('Nur system_admin erlaubt')
}

export async function inviteSystemAdmin(email: string) {
  await assertSystemAdmin()
  const admin = createSupabaseAdminClient()

  // Prüfen ob User schon existiert
  const { data: { users } } = await admin.auth.admin.listUsers({ perPage: 1000 })
  let userId = users.find(u => u.email === email)?.id

  if (!userId) {
    // Neuen User via Supabase Invite anlegen
    const { data, error } = await admin.auth.admin.inviteUserByEmail(email)
    if (error || !data.user) return { error: error?.message ?? 'Einladung fehlgeschlagen' }
    userId = data.user.id
  }

  // System-Admin Membership auf Haupt-Tenant (fa22dc07) anlegen
  // Alle bestehenden Tenants holen und ersten nehmen
  const { data: tenants } = await (admin.from('tenants') as any)
    .select('id').order('created_at').limit(1)

  const tenantId = (tenants as R[])?.[0]?.id
  if (!tenantId) return { error: 'Kein Tenant gefunden' }

  // Prüfen ob Membership schon existiert
  const { data: existing } = await (admin.from('tenant_memberships') as any)
    .select('id').eq('user_id', userId).eq('tenant_id', tenantId).maybeSingle()

  if (existing) {
    // Rolle auf system_admin hochstufen
    await (admin.from('tenant_memberships') as any)
      .update({ role: 'system_admin' })
      .eq('user_id', userId).eq('tenant_id', tenantId)
  } else {
    const { error: memberError } = await (admin.from('tenant_memberships') as any)
      .insert({ tenant_id: tenantId, user_id: userId, role: 'system_admin' })
    if (memberError) return { error: (memberError as R).message }
  }

  revalidatePath('/admin/benutzer')
  return { success: true }
}

export async function removeSystemAdmin(membershipId: string) {
  await assertSystemAdmin()
  const admin = createSupabaseAdminClient()

  const { error } = await (admin.from('tenant_memberships') as any)
    .delete().eq('id', membershipId)

  if (error) return { error: (error as R).message }
  revalidatePath('/admin/benutzer')
  return { success: true }
}
