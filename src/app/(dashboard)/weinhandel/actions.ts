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

// ── Neue Füllung anlegen ──────────────────────────────────────────────────────

export async function createFuellung(formData: FormData) {
  const supabase  = await createSupabaseServerClient()
  const tenantId  = await getTenantId()

  const weinausbauId = (formData.get('weinausbau_id') as string) || null
  const anzahl       = parseInt(formData.get('anzahl_flaschen') as string)

  const payload: AR = {
    tenant_id:            tenantId,
    weinausbau_id:        weinausbauId,
    name:                 formData.get('name') as string,
    jahrgang:             parseInt(formData.get('jahrgang') as string) || null,
    rebsorte:             (formData.get('rebsorte') as string) || null,
    qualitaet:            formData.get('qualitaet') as string,
    anbaugebiet:          (formData.get('anbaugebiet') as string) || null,
    bezeichnung:          (formData.get('bezeichnung') as string) || null,
    datum:                formData.get('datum') as string,
    flaschengroesse_ml:   parseInt(formData.get('flaschengroesse_ml') as string) || 750,
    anzahl_flaschen:      anzahl,
    bestand_flaschen:     anzahl,                              // Startbestand = Abfüllmenge
    menge_liter_gefuellt: parseFloat(formData.get('menge_liter_gefuellt') as string) || null,
    vk_preis_brutto:      parseFloat(formData.get('vk_preis_brutto') as string) || null,
    einstandspreis:       parseFloat(formData.get('einstandspreis') as string) || null,
    notizen:              (formData.get('notizen') as string) || null,
  }

  const { error } = await (supabase.from('fuellungen') as any).insert(payload)
  if (error) throw new Error((error as AR).message)

  // Weinausbau-Status auf 'abfuellung' setzen (falls noch nicht abgeschlossen)
  if (weinausbauId) {
    await (supabase.from('weinausbau') as any)
      .update({ status: 'abfuellung' })
      .eq('id', weinausbauId)
      .not('status', 'eq', 'abgeschlossen')
  }

  revalidatePath('/weinhandel')
  revalidatePath('/kellerbuch')
  redirect('/weinhandel')
}

// ── Füllung bearbeiten ────────────────────────────────────────────────────────

export async function updateFuellung(id: string, formData: FormData) {
  const supabase = await createSupabaseServerClient()

  const anzahl = parseInt(formData.get('anzahl_flaschen') as string)
  const payload: AR = {
    name:                 formData.get('name') as string,
    jahrgang:             parseInt(formData.get('jahrgang') as string) || null,
    rebsorte:             (formData.get('rebsorte') as string) || null,
    qualitaet:            formData.get('qualitaet') as string,
    anbaugebiet:          (formData.get('anbaugebiet') as string) || null,
    bezeichnung:          (formData.get('bezeichnung') as string) || null,
    datum:                formData.get('datum') as string,
    flaschengroesse_ml:   parseInt(formData.get('flaschengroesse_ml') as string) || 750,
    anzahl_flaschen:      anzahl,
    bestand_flaschen:     parseInt(formData.get('bestand_flaschen') as string) || anzahl,
    menge_liter_gefuellt: parseFloat(formData.get('menge_liter_gefuellt') as string) || null,
    vk_preis_brutto:      parseFloat(formData.get('vk_preis_brutto') as string) || null,
    einstandspreis:       parseFloat(formData.get('einstandspreis') as string) || null,
    notizen:              (formData.get('notizen') as string) || null,
    aktualisiert_am:      new Date().toISOString(),
  }

  const { error } = await (supabase.from('fuellungen') as any).update(payload).eq('id', id)
  if (error) throw new Error((error as AR).message)
  revalidatePath('/weinhandel')
  redirect('/weinhandel')
}

// ── Bestand manuell korrigieren ───────────────────────────────────────────────

export async function updateFuellungBestand(id: string, bestand: number) {
  const supabase = await createSupabaseServerClient()
  const { error } = await (supabase.from('fuellungen') as any)
    .update({ bestand_flaschen: bestand, aktualisiert_am: new Date().toISOString() })
    .eq('id', id)
  if (error) throw new Error((error as AR).message)
  revalidatePath('/weinhandel')
}

// ── Füllung deaktivieren ──────────────────────────────────────────────────────

export async function deactivateFuellung(id: string) {
  const supabase = await createSupabaseServerClient()
  const { error } = await (supabase.from('fuellungen') as any)
    .update({ aktiv: false, aktualisiert_am: new Date().toISOString() })
    .eq('id', id)
  if (error) throw new Error((error as AR).message)
  revalidatePath('/weinhandel')
}
