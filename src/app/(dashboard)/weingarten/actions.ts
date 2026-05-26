'use server'

import { createSupabaseServerClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRecord = Record<string, any>

async function getTenantId(): Promise<string | null> {
  const supabase = await createSupabaseServerClient()
  const { data } = await supabase
    .from('tenant_memberships')
    .select('tenant_id')
    .limit(1)
    .single()
  return (data as AnyRecord | null)?.tenant_id ?? null
}

export async function createWeingarten(formData: FormData) {
  const supabase = await createSupabaseServerClient()
  const tenantId = await getTenantId()
  if (!tenantId) throw new Error('Kein Betrieb gefunden')

  const payload: AnyRecord = {
    tenant_id:       tenantId,
    name:            formData.get('name') as string,
    ried:            (formData.get('ried') as string) || null,
    rebsorte:        (formData.get('rebsorte') as string) || null,
    flaeche_ha:      formData.get('flaeche_ha') ? Number(formData.get('flaeche_ha')) : null,
    pflanzjahr:      formData.get('pflanzjahr') ? Number(formData.get('pflanzjahr')) : null,
    bewirtschaftung: (formData.get('bewirtschaftung') as string) || null,
    notizen:         (formData.get('notizen') as string) || null,
    aktiv:           true,
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.from('weingarten') as any).insert(payload)
  if (error) throw new Error((error as AnyRecord).message)

  revalidatePath('/weingarten')
}

export async function updateWeingarten(id: string, formData: FormData) {
  const supabase = await createSupabaseServerClient()

  const payload: AnyRecord = {
    name:            formData.get('name') as string,
    ried:            (formData.get('ried') as string) || null,
    rebsorte:        (formData.get('rebsorte') as string) || null,
    flaeche_ha:      formData.get('flaeche_ha') ? Number(formData.get('flaeche_ha')) : null,
    pflanzjahr:      formData.get('pflanzjahr') ? Number(formData.get('pflanzjahr')) : null,
    bewirtschaftung: (formData.get('bewirtschaftung') as string) || null,
    notizen:         (formData.get('notizen') as string) || null,
    aktiv:           formData.get('aktiv') === 'true',
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.from('weingarten') as any).update(payload).eq('id', id)
  if (error) throw new Error((error as AnyRecord).message)

  revalidatePath('/weingarten')
}

export async function deactivateWeingarten(id: string) {
  const supabase = await createSupabaseServerClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.from('weingarten') as any).update({ aktiv: false }).eq('id', id)
  if (error) throw new Error((error as AnyRecord).message)
  revalidatePath('/weingarten')
}

export async function deleteWeingarten(id: string) {
  const supabase = await createSupabaseServerClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.from('weingarten') as any).delete().eq('id', id)
  if (error) throw new Error((error as AnyRecord).message)
  revalidatePath('/weingarten')
}
