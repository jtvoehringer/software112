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
