'use server'

import { createSupabaseServerClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AR = Record<string, any>

async function getTenantId(): Promise<string> {
  const supabase = await createSupabaseServerClient()
  const { data } = await (supabase.from('tenant_memberships') as any).select('tenant_id').limit(1).single()
  const id = (data as AR | null)?.tenant_id
  if (!id) throw new Error('Kein Betrieb gefunden')
  return id
}

export async function createRabattgruppe(formData: FormData) {
  const supabase = await createSupabaseServerClient()
  const tenantId = await getTenantId()
  const { error } = await (supabase.from('rabattgruppen') as any).insert({
    tenant_id:  tenantId,
    name:       formData.get('name') as string,
    rabatt_pct: parseFloat(formData.get('rabatt_pct') as string) || 0,
    notizen:    (formData.get('notizen') as string) || null,
  })
  if (error) throw new Error((error as AR).message)
  revalidatePath('/weinhandel/rabattgruppen')
}

export async function updateRabattgruppe(id: string, formData: FormData) {
  const supabase = await createSupabaseServerClient()
  const { error } = await (supabase.from('rabattgruppen') as any)
    .update({
      name:       formData.get('name') as string,
      rabatt_pct: parseFloat(formData.get('rabatt_pct') as string) || 0,
      notizen:    (formData.get('notizen') as string) || null,
    })
    .eq('id', id)
  if (error) throw new Error((error as AR).message)
  revalidatePath('/weinhandel/rabattgruppen')
}

export async function deleteRabattgruppe(id: string) {
  const supabase = await createSupabaseServerClient()
  const { error } = await (supabase.from('rabattgruppen') as any).delete().eq('id', id)
  if (error) throw new Error((error as AR).message)
  revalidatePath('/weinhandel/rabattgruppen')
}
