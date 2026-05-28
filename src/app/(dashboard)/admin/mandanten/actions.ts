'use server'

import { createSupabaseServerClient } from '@/lib/supabase/server'
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
  const supabase = await createSupabaseServerClient()
  const name = formData.get('name') as string
  const { error } = await (supabase.from('tenants') as any).insert({ name })
  if (error) throw new Error((error as AR).message)
  revalidatePath('/admin/mandanten')
}

export async function renameMandant(id: string, name: string) {
  await assertSystemAdmin()
  const supabase = await createSupabaseServerClient()
  const { error } = await (supabase.from('tenants') as any).update({ name }).eq('id', id)
  if (error) throw new Error((error as AR).message)
  revalidatePath('/admin/mandanten')
}
