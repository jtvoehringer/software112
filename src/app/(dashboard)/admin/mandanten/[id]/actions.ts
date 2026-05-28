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

// ── Branding + Module + Brevo speichern ───────────────────────────────────────

export async function saveTenantSettings(tenantId: string, formData: FormData) {
  await assertSystemAdmin()
  const admin = createSupabaseAdminClient()

  const num = (key: string) => {
    const v = formData.get(key) as string
    const n = parseInt(v)
    return isNaN(n) ? null : n
  }

  const payload = {
    tenant_id:          tenantId,
    anzeigename:        (formData.get('anzeigename') as string) || null,
    logo_url:           (formData.get('logo_url') as string) || null,
    primary_color:      (formData.get('primary_color') as string) || '#2a7c6f',
    secondary_color:    (formData.get('secondary_color') as string) || '#f5c842',
    modul_newsletter:   formData.get('modul_newsletter') === 'true',
    modul_crm:          formData.get('modul_crm') === 'true',
    modul_kellerbuch:   formData.get('modul_kellerbuch') === 'true',
    modul_weingarten:   formData.get('modul_weingarten') === 'true',
    brevo_api_key:      (formData.get('brevo_api_key') as string) || null,
    brevo_sender_mail:  (formData.get('brevo_sender_mail') as string) || null,
    brevo_sender_name:  (formData.get('brevo_sender_name') as string) || null,
    brevo_list_privat:  num('brevo_list_privat'),
    brevo_list_gastro:  num('brevo_list_gastro'),
    brevo_list_handel:  num('brevo_list_handel'),
    brevo_list_export:  num('brevo_list_export'),
    brevo_list_grossh:  num('brevo_list_grossh'),
    aktualisiert_am:    new Date().toISOString(),
  }

  const { error } = await (admin.from('tenant_einstellungen') as any)
    .upsert(payload, { onConflict: 'tenant_id' })

  if (error) throw new Error((error as R).message)
  revalidatePath(`/admin/mandanten/${tenantId}`)
  revalidatePath('/admin/mandanten')
}

// ── Benutzer: Einladung ───────────────────────────────────────────────────────

export async function inviteUserToTenant(tenantId: string, email: string, role: string) {
  await assertSystemAdmin()
  const admin = createSupabaseAdminClient()

  // Prüfen ob User schon existiert
  const { data: { users } } = await admin.auth.admin.listUsers({ perPage: 1000 })
  let userId = users.find(u => u.email === email)?.id

  if (!userId) {
    const { data, error } = await admin.auth.admin.inviteUserByEmail(email)
    if (error || !data.user) return { error: error?.message ?? 'Einladung fehlgeschlagen' }
    userId = data.user.id
  }

  // Prüfen ob Membership schon existiert
  const { data: existing } = await (admin.from('tenant_memberships') as any)
    .select('id').eq('user_id', userId).eq('tenant_id', tenantId).maybeSingle()

  if (existing) return { error: 'Benutzer ist bereits Mitglied dieses Mandanten.' }

  const { error: memberError } = await (admin.from('tenant_memberships') as any)
    .insert({ tenant_id: tenantId, user_id: userId, role })

  if (memberError) return { error: (memberError as R).message }

  revalidatePath(`/admin/mandanten/${tenantId}`)
  return { success: true }
}

// ── Benutzer: Rolle ändern ────────────────────────────────────────────────────

export async function updateMemberRoleAdmin(membershipId: string, role: string, tenantId: string) {
  await assertSystemAdmin()
  const admin = createSupabaseAdminClient()

  const { error } = await (admin.from('tenant_memberships') as any)
    .update({ role }).eq('id', membershipId)

  if (error) return { error: (error as R).message }
  revalidatePath(`/admin/mandanten/${tenantId}`)
  return { success: true }
}

// ── Benutzer: Entfernen ───────────────────────────────────────────────────────

export async function removeMemberAdmin(membershipId: string, tenantId: string) {
  await assertSystemAdmin()
  const admin = createSupabaseAdminClient()

  const { error } = await (admin.from('tenant_memberships') as any)
    .delete().eq('id', membershipId)

  if (error) return { error: (error as R).message }
  revalidatePath(`/admin/mandanten/${tenantId}`)
  return { success: true }
}

// ── Tenant umbenennen ─────────────────────────────────────────────────────────

export async function renameTenantAdmin(tenantId: string, name: string) {
  await assertSystemAdmin()
  const admin = createSupabaseAdminClient()

  const { error } = await (admin.from('tenants') as any)
    .update({ name }).eq('id', tenantId)

  if (error) throw new Error((error as R).message)
  revalidatePath(`/admin/mandanten/${tenantId}`)
  revalidatePath('/admin/mandanten')
}
