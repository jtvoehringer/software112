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

// ── Preisliste anlegen ────────────────────────────────────────────────────────

export async function createPreisliste(formData: FormData) {
  const supabase  = await createSupabaseServerClient()
  const tenantId  = await getTenantId()

  // UUID selbst generieren – vermeidet das fragile .select().single() nach INSERT
  const newId = crypto.randomUUID()

  const { error } = await (supabase.from('preislisten') as any).insert({
    id:           newId,
    tenant_id:    tenantId,
    name:         formData.get('name') as string,
    beschreibung: (formData.get('beschreibung') as string) || null,
    gueltig_von:  (formData.get('gueltig_von') as string)  || null,
    gueltig_bis:  (formData.get('gueltig_bis') as string)  || null,
  })

  if (error) {
    console.error('createPreisliste:', error.message)
    revalidatePath('/weinhandel/preisliste')
    redirect('/weinhandel/preisliste')
  }
  revalidatePath('/weinhandel/preisliste')
  redirect(`/weinhandel/preisliste/${newId}`)
}

// ── Preisliste bearbeiten ─────────────────────────────────────────────────────

export async function updatePreisliste(id: string, formData: FormData) {
  const supabase = await createSupabaseServerClient()
  const { error } = await (supabase.from('preislisten') as any).update({
    name:         formData.get('name') as string,
    beschreibung: (formData.get('beschreibung') as string) || null,
    gueltig_von:  (formData.get('gueltig_von') as string)  || null,
    gueltig_bis:  (formData.get('gueltig_bis') as string)  || null,
    aktualisiert_am: new Date().toISOString(),
  }).eq('id', id)
  if (error) throw new Error((error as AR).message)
  revalidatePath('/weinhandel/preisliste')
  revalidatePath(`/weinhandel/preisliste/${id}`)
}

// ── Preisliste deaktivieren ───────────────────────────────────────────────────

export async function deactivatePreisliste(id: string) {
  const supabase = await createSupabaseServerClient()
  const { error } = await (supabase.from('preislisten') as any)
    .update({ aktiv: false, aktualisiert_am: new Date().toISOString() })
    .eq('id', id)
  if (error) throw new Error((error as AR).message)
  revalidatePath('/weinhandel/preisliste')
  redirect('/weinhandel/preisliste')
}

// ── Position anlegen ──────────────────────────────────────────────────────────

export async function createPosition(preislisteId: string, formData: FormData) {
  const supabase  = await createSupabaseServerClient()
  const tenantId  = await getTenantId()

  const fuellungId = (formData.get('fuellung_id') as string) || null
  const { error }  = await (supabase.from('preislisten_positionen') as any).insert({
    tenant_id:         tenantId,
    preisliste_id:     preislisteId,
    fuellung_id:       fuellungId,
    name:              formData.get('name') as string,
    jahrgang:          parseInt(formData.get('jahrgang') as string) || null,
    rebsorte:          (formData.get('rebsorte') as string) || null,
    flaschengroesse_ml: parseInt(formData.get('flaschengroesse_ml') as string) || null,
    einheit:           (formData.get('einheit') as string) || 'Flasche',
    preis_brutto:      parseFloat(formData.get('preis_brutto') as string) || null,
    sort_order:        parseInt(formData.get('sort_order') as string) || 0,
  })
  if (error) throw new Error((error as AR).message)
  revalidatePath(`/weinhandel/preisliste/${preislisteId}`)
}

// ── Position aktualisieren ────────────────────────────────────────────────────

export async function updatePosition(positionId: string, preislisteId: string, formData: FormData) {
  const supabase = await createSupabaseServerClient()
  const { error } = await (supabase.from('preislisten_positionen') as any).update({
    name:              formData.get('name') as string,
    jahrgang:          parseInt(formData.get('jahrgang') as string) || null,
    rebsorte:          (formData.get('rebsorte') as string) || null,
    flaschengroesse_ml: parseInt(formData.get('flaschengroesse_ml') as string) || null,
    einheit:           (formData.get('einheit') as string) || 'Flasche',
    preis_brutto:      parseFloat(formData.get('preis_brutto') as string) || null,
    sort_order:        parseInt(formData.get('sort_order') as string) || 0,
    aktualisiert_am:   new Date().toISOString(),
  }).eq('id', positionId)
  if (error) throw new Error((error as AR).message)
  revalidatePath(`/weinhandel/preisliste/${preislisteId}`)
}

// ── Position löschen ──────────────────────────────────────────────────────────

export async function deletePosition(positionId: string, preislisteId: string) {
  const supabase = await createSupabaseServerClient()
  const { error } = await (supabase.from('preislisten_positionen') as any)
    .delete()
    .eq('id', positionId)
  if (error) throw new Error((error as AR).message)
  revalidatePath(`/weinhandel/preisliste/${preislisteId}`)
}
