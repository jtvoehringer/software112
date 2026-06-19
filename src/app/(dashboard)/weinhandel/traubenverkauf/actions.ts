'use server'
import { revalidatePath } from 'next/cache'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentMembership } from '@/lib/auth/roles'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AR = Record<string, any>

export async function upsertTraubenverkauf(formData: FormData) {
  const supabase = await createSupabaseServerClient()
  const membership = await getCurrentMembership()
  if (!membership) throw new Error('Nicht angemeldet')

  const existing_id = formData.get('existing_id') as string | null

  function getNum(key: string): number | null {
    const val = formData.get(key) as string | null
    if (!val || val.trim() === '') return null
    return Number(val.replace(',', '.'))
  }

  const payload: AR = {
    tenant_id:       membership.tenantId,
    weingarten_id:   formData.get('weingarten_id') as string,
    jahrgang_id:     (formData.get('jahrgang_id') as string) || null,
    kontakt_id:      (formData.get('kontakt_id') as string) || null,
    firma_id:        (formData.get('firma_id') as string) || null,
    datum:           formData.get('datum') as string,
    menge_kg:        Number((formData.get('menge_kg') as string).replace(',', '.')),
    preis_per_kg:    getNum('preis_per_kg'),
    kmw_grad:        getNum('kmw_grad'),
    qualitaetsstufe: (formData.get('qualitaetsstufe') as string) || null,
    herkunft_code:   (formData.get('herkunft_code') as string) || null,
    gesundheit:      (formData.get('gesundheit') as string) || 'G',
    notizen:         (formData.get('notizen') as string) || null,
    updated_at:      new Date().toISOString(),
  }

  if (existing_id) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase.from('traubenverkauf') as any)
      .update(payload)
      .eq('id', existing_id)
      .eq('tenant_id', membership.tenantId)
    if (error) throw new Error((error as AR).message)
  } else {
    // Liefernummer bei Neuanlage auto-generieren
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: lnData } = await (supabase.rpc as any)('get_next_liefernummer', { p_tenant_id: membership.tenantId })
    if (lnData) payload.liefernummer = lnData
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase.from('traubenverkauf') as any).insert(payload)
    if (error) throw new Error((error as AR).message)
  }
  revalidatePath('/weinhandel/traubenverkauf')
}

export async function deleteTraubenverkauf(id: string) {
  const supabase = await createSupabaseServerClient()
  const membership = await getCurrentMembership()
  if (!membership) throw new Error('Nicht angemeldet')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.from('traubenverkauf') as any)
    .delete()
    .eq('id', id)
    .eq('tenant_id', membership.tenantId)
  if (error) throw new Error((error as AR).message)
  revalidatePath('/weinhandel/traubenverkauf')
}
