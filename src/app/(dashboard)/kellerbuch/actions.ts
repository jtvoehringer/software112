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

// BEHAELTER
export async function createBehaelter(formData: FormData) {
  const supabase  = await createSupabaseServerClient()
  const tenantId  = await getTenantId()
  if (!tenantId) throw new Error('Kein Betrieb gefunden')

  const payload: R = {
    tenant_id:     tenantId,
    name:          formData.get('name') as string,
    typ:           (formData.get('typ') as string) || null,
    volumen_liter: formData.get('volumen_liter') ? Number((formData.get('volumen_liter') as string).replace(',', '.')) : null,
    standort:      (formData.get('standort') as string) || null,
    aktiv:         true,
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.from('behaelter') as any).insert(payload)
  if (error) throw new Error((error as R).message)
  revalidatePath('/kellerbuch')
}

export async function updateBehaelter(id: string, formData: FormData) {
  const supabase = await createSupabaseServerClient()
  const payload: R = {
    name:          formData.get('name') as string,
    typ:           (formData.get('typ') as string) || null,
    volumen_liter: formData.get('volumen_liter') ? Number((formData.get('volumen_liter') as string).replace(',', '.')) : null,
    standort:      (formData.get('standort') as string) || null,
    aktiv:         formData.get('aktiv') === 'true',
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.from('behaelter') as any).update(payload).eq('id', id)
  if (error) throw new Error((error as R).message)
  revalidatePath('/kellerbuch')
}

// WEINAUSBAU
export async function createWeinausbau(formData: FormData) {
  const supabase  = await createSupabaseServerClient()
  const tenantId  = await getTenantId()
  if (!tenantId) throw new Error('Kein Betrieb gefunden')

  const payload: R = {
    tenant_id:       tenantId,
    name:            formData.get('name') as string,
    jahrgang:        formData.get('jahrgang') ? Number(formData.get('jahrgang')) : null,
    rebsorte:        (formData.get('rebsorte') as string) || null,
    weingarten_id:   (formData.get('weingarten_id') as string) || null,
    behaelter_id:    (formData.get('behaelter_id') as string) || null,
    menge_liter:          formData.get('menge_liter') ? Number((formData.get('menge_liter') as string).replace(',', '.')) : null,
    anfangsbestand_liter: formData.get('menge_liter') ? Number((formData.get('menge_liter') as string).replace(',', '.')) : null,
    qualitaetsstufe:      (formData.get('qualitaetsstufe') as string) || null,
    status:               (formData.get('status') as string) || 'ernte',
    notizen:              (formData.get('notizen') as string) || null,
    einstandspreis_pro_liter: formData.get('einstandspreis_pro_liter')
      ? Number((formData.get('einstandspreis_pro_liter') as string).replace(',', '.'))
      : null,
    aktiv:           true,
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.from('weinausbau') as any).insert(payload)
  if (error) throw new Error((error as R).message)
  revalidatePath('/kellerbuch')
}

export async function updateWeinausbau(id: string, formData: FormData) {
  const supabase = await createSupabaseServerClient()
  const neueMenge = formData.get('menge_liter')
    ? Number((formData.get('menge_liter') as string).replace(',', '.'))
    : null
  const payload: R = {
    name:            formData.get('name') as string,
    jahrgang:        formData.get('jahrgang') ? Number(formData.get('jahrgang')) : null,
    rebsorte:        (formData.get('rebsorte') as string) || null,
    weingarten_id:   (formData.get('weingarten_id') as string) || null,
    behaelter_id:    (formData.get('behaelter_id') as string) || null,
    menge_liter:     neueMenge,
    qualitaetsstufe:      (formData.get('qualitaetsstufe') as string) || null,
    status:               formData.get('status') as string,
    notizen:              (formData.get('notizen') as string) || null,
    einstandspreis_pro_liter: formData.get('einstandspreis_pro_liter')
      ? Number((formData.get('einstandspreis_pro_liter') as string).replace(',', '.'))
      : null,
    aktiv:           formData.get('aktiv') === 'true',
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.from('weinausbau') as any).update(payload).eq('id', id)
  if (error) throw new Error((error as R).message)

  // KEIN Sync auf pressung_behaelter.menge_liter – das ist der historische Pressbetrag
  // und darf nicht mit dem laufenden Bestand überschrieben werden.

  revalidatePath('/kellerbuch')
  revalidatePath(`/kellerbuch/weinausbau/${id}`)
}
