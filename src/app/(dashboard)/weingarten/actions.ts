'use server'

import { createSupabaseServerClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import type { Bewirtschaftung } from '@/lib/types/database.types'

export type WeingartenFormData = {
  name: string
  ried: string
  rebsorte: string
  flaeche_ha: string
  pflanzjahr: string
  bewirtschaftung: string
  notizen: string
  aktiv: string
}

// ── Tenant-ID des eingeloggten Users holen ────────────────────────────────────
async function getTenantId(): Promise<string | null> {
  const supabase = await createSupabaseServerClient()
  const { data } = await supabase
    .from('tenant_memberships')
    .select('tenant_id')
    .limit(1)
    .single()
  return (data as { tenant_id: string } | null)?.tenant_id ?? null
}

// ── CREATE ────────────────────────────────────────────────────────────────────
export async function createWeingarten(formData: FormData) {
  const supabase  = await createSupabaseServerClient()
  const tenantId  = await getTenantId()
  if (!tenantId) throw new Error('Kein Betrieb gefunden')

  const { error } = await supabase.from('weingarten').insert({
    tenant_id:       tenantId,
    name:            formData.get('name') as string,
    ried:            (formData.get('ried') as string) || null,
    rebsorte:        (formData.get('rebsorte') as string) || null,
    flaeche_ha:      formData.get('flaeche_ha') ? Number(formData.get('flaeche_ha')) : null,
    pflanzjahr:      formData.get('pflanzjahr') ? Number(formData.get('pflanzjahr')) : null,
    bewirtschaftung: (formData.get('bewirtschaftung') as Bewirtschaftung) || null,
    notizen:         (formData.get('notizen') as string) || null,
    aktiv:           true,
  })

  if (error) throw new Error(error.message)
  revalidatePath('/weingarten')
  redirect('/weingarten')
}

// ── UPDATE ────────────────────────────────────────────────────────────────────
export async function updateWeingarten(id: string, formData: FormData) {
  const supabase = await createSupabaseServerClient()

  const { error } = await supabase
    .from('weingarten')
    .update({
      name:            formData.get('name') as string,
      ried:            (formData.get('ried') as string) || null,
      rebsorte:        (formData.get('rebsorte') as string) || null,
      flaeche_ha:      formData.get('flaeche_ha') ? Number(formData.get('flaeche_ha')) : null,
      pflanzjahr:      formData.get('pflanzjahr') ? Number(formData.get('pflanzjahr')) : null,
      bewirtschaftung: (formData.get('bewirtschaftung') as Bewirtschaftung) || null,
      notizen:         (formData.get('notizen') as string) || null,
      aktiv:           formData.get('aktiv') === 'true',
    })
    .eq('id', id)

  if (error) throw new Error(error.message)
  revalidatePath('/weingarten')
  redirect('/weingarten')
}

// ── DELETE (Soft: aktiv = false) ──────────────────────────────────────────────
export async function deactivateWeingarten(id: string) {
  const supabase = await createSupabaseServerClient()
  const { error } = await supabase
    .from('weingarten')
    .update({ aktiv: false })
    .eq('id', id)

  if (error) throw new Error(error.message)
  revalidatePath('/weingarten')
}
