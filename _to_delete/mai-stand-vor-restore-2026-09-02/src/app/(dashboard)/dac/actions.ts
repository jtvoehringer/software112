'use server'

import { createSupabaseServerClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

async function getTenantId(): Promise<string | null> {
  const supabase = await createSupabaseServerClient()
  const { data } = await supabase.from('tenant_memberships').select('tenant_id').limit(1).single()
  return (data as R | null)?.tenant_id ?? null
}

export async function createDacAntrag(formData: FormData) {
  const supabase  = await createSupabaseServerClient()
  const tenantId  = await getTenantId()
  if (!tenantId) throw new Error('Kein Betrieb gefunden')

  const payload: R = {
    tenant_id:       tenantId,
    weinausbau_id:   (formData.get('weinausbau_id') as string) || null,
    bezeichnung:     formData.get('bezeichnung') as string,
    dac_region:      formData.get('dac_region') as string,
    jahrgang:        formData.get('jahrgang') ? Number(formData.get('jahrgang')) : null,
    rebsorte:        (formData.get('rebsorte') as string) || null,
    menge_liter:     formData.get('menge_liter') ? Number((formData.get('menge_liter') as string).replace(',', '.')) : null,
    alkohol_prozent: formData.get('alkohol_prozent') ? Number((formData.get('alkohol_prozent') as string).replace(',', '.')) : null,
    status:          (formData.get('status') as string) || 'entwurf',
    pruefnummer:     (formData.get('pruefnummer') as string) || null,
    eingereicht_am:  (formData.get('eingereicht_am') as string) || null,
    bescheid_am:     (formData.get('bescheid_am') as string) || null,
    notizen:         (formData.get('notizen') as string) || null,
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.from('dac_antrag') as any).insert(payload)
  if (error) throw new Error((error as R).message)
  revalidatePath('/dac')
}

export async function updateDacAntrag(id: string, formData: FormData) {
  const supabase = await createSupabaseServerClient()
  const payload: R = {
    weinausbau_id:   (formData.get('weinausbau_id') as string) || null,
    bezeichnung:     formData.get('bezeichnung') as string,
    dac_region:      formData.get('dac_region') as string,
    jahrgang:        formData.get('jahrgang') ? Number(formData.get('jahrgang')) : null,
    rebsorte:        (formData.get('rebsorte') as string) || null,
    menge_liter:     formData.get('menge_liter') ? Number((formData.get('menge_liter') as string).replace(',', '.')) : null,
    alkohol_prozent: formData.get('alkohol_prozent') ? Number((formData.get('alkohol_prozent') as string).replace(',', '.')) : null,
    status:          formData.get('status') as string,
    pruefnummer:     (formData.get('pruefnummer') as string) || null,
    eingereicht_am:  (formData.get('eingereicht_am') as string) || null,
    bescheid_am:     (formData.get('bescheid_am') as string) || null,
    notizen:         (formData.get('notizen') as string) || null,
    aktiv:           formData.get('aktiv') === 'true',
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.from('dac_antrag') as any).update(payload).eq('id', id)
  if (error) throw new Error((error as R).message)
  revalidatePath('/dac')
}
