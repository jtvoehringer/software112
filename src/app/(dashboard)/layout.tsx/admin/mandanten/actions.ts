'use server'

import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { getCurrentUserRole } from '@/lib/auth/roles'
import { revalidatePath } from 'next/cache'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AR = Record<string, any>

async function assertSystemAdmin() {
  const role = await getCurrentUserRole()
  if (role !== 'system_admin') throw new Error('Nur system_admin erlaubt')
}

export async function createMandant(formData: FormData) {
  await assertSystemAdmin()
  const supabase = createSupabaseAdminClient()
  const name = formData.get('name') as string

  // Slug aus Name generieren: Kleinbuchstaben, Leerzeichen → Bindestrich, Sonderzeichen entfernen
  const baseSlug = name
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')  // Umlaute: ä→a, ö→o, ü→u
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

  // Eindeutigkeit sicherstellen: ggf. Timestamp-Suffix anhängen
  const slug = `${baseSlug}-${Date.now().toString(36)}`

  const { error } = await (supabase.from('tenants') as any).insert({ name, slug })
  if (error) throw new Error((error as AR).message)
  revalidatePath('/admin/mandanten')
}

export async function renameMandant(id: string, name: string) {
  await assertSystemAdmin()
  const supabase = createSupabaseAdminClient()
  const { error } = await (supabase.from('tenants') as any).update({ name }).eq('id', id)
  if (error) throw new Error((error as AR).message)
  revalidatePath('/admin/mandanten')
}

export async function saveBranding(tenantId: string, formData: FormData) {
  await assertSystemAdmin()
  const supabase = createSupabaseAdminClient()

  const payload = {
    tenant_id:        tenantId,
    anzeigename:      (formData.get('anzeigename') as string) || null,
    logo_url:         (formData.get('logo_url') as string) || null,
    primary_color:    (formData.get('primary_color') as string) || '#2a7c6f',
    secondary_color:  (formData.get('secondary_color') as string) || '#f5c842',
    modul_newsletter: formData.get('modul_newsletter') === 'true',
    aktualisiert_am:  new Date().toISOString(),
  }

  const { error } = await (supabase.from('tenant_einstellungen') as any)
    .upsert(payload, { onConflict: 'tenant_id' })

  if (error) throw new Error((error as AR).message)
  revalidatePath('/admin/mandanten')
}
