'use server'

import { createSupabaseServerClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AR = Record<string, any>

async function getTenantId(): Promise<string> {
  const supabase = await createSupabaseServerClient()
  const { data } = await (supabase.from('tenant_memberships') as any).select('tenant_id').limit(1).single()
  const id = (data as AR | null)?.tenant_id
  if (!id) throw new Error('Kein Betrieb gefunden')
  return id
}

// ── Neuen Kellerplan anlegen ──────────────────────────────────────────────────

export async function createKellerplan(formData: FormData) {
  const supabase  = await createSupabaseServerClient()
  const tenantId  = await getTenantId()

  const { data, error } = await (supabase.from('kellerplaene') as any).insert({
    tenant_id: tenantId,
    name:      formData.get('name') as string,
    breite_m:  parseFloat(formData.get('breite_m') as string) || 20,
    laenge_m:  parseFloat(formData.get('laenge_m') as string) || 10,
    notizen:   (formData.get('notizen') as string) || null,
  }).select('id').single()

  if (error) throw new Error((error as AR).message)
  revalidatePath('/kellerbuch/kellerplan')
  redirect(`/kellerbuch/kellerplan/${(data as AR).id}`)
}

// ── Kellerplan-Metadaten bearbeiten ───────────────────────────────────────────

export async function updateKellerplan(id: string, formData: FormData) {
  const supabase = await createSupabaseServerClient()
  const { error } = await (supabase.from('kellerplaene') as any).update({
    name:     formData.get('name') as string,
    breite_m: parseFloat(formData.get('breite_m') as string) || 20,
    laenge_m: parseFloat(formData.get('laenge_m') as string) || 10,
    notizen:  (formData.get('notizen') as string) || null,
    aktualisiert_am: new Date().toISOString(),
  }).eq('id', id)
  if (error) throw new Error((error as AR).message)
  revalidatePath('/kellerbuch/kellerplan')
  revalidatePath(`/kellerbuch/kellerplan/${id}`)
}

// ── Behälter auf Plan platzieren / verschieben ────────────────────────────────

export async function upsertKellerplanPosition(
  kellerplanId: string,
  behaelterId: string,
  pos: { pos_x_pct: number; pos_y_pct: number; breite_pct: number; hoehe_pct: number }
) {
  const supabase  = await createSupabaseServerClient()
  const tenantId  = await getTenantId()

  const { error } = await (supabase.from('kellerplan_positionen') as any)
    .upsert({
      tenant_id:     tenantId,
      kellerplan_id: kellerplanId,
      behaelter_id:  behaelterId,
      ...pos,
      aktualisiert_am: new Date().toISOString(),
    }, { onConflict: 'kellerplan_id,behaelter_id' })

  if (error) throw new Error((error as AR).message)
  revalidatePath(`/kellerbuch/kellerplan/${kellerplanId}`)
}

// ── Behälter vom Plan entfernen ───────────────────────────────────────────────

export async function deleteKellerplanPosition(kellerplanId: string, behaelterId: string) {
  const supabase = await createSupabaseServerClient()
  const { error } = await (supabase.from('kellerplan_positionen') as any)
    .delete()
    .eq('kellerplan_id', kellerplanId)
    .eq('behaelter_id', behaelterId)
  if (error) throw new Error((error as AR).message)
  revalidatePath(`/kellerbuch/kellerplan/${kellerplanId}`)
}

// ── Kellerplan löschen ────────────────────────────────────────────────────────

export async function deleteKellerplan(id: string) {
  const supabase = await createSupabaseServerClient()
  const { error } = await (supabase.from('kellerplaene') as any).delete().eq('id', id)
  if (error) throw new Error((error as AR).message)
  revalidatePath('/kellerbuch/kellerplan')
  redirect('/kellerbuch/kellerplan')
}
