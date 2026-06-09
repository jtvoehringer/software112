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

export async function createZukauf(formData: FormData) {
  const supabase = await createSupabaseServerClient()
  const tenantId = await getTenantId()

  const datum              = (formData.get('datum')                as string) || new Date().toISOString().split('T')[0]
  const art                = (formData.get('art')                  as string) || 'trauben'
  const lieferantKontaktId = (formData.get('lieferant_kontakt_id') as string) || null
  const lieferantFirmaId   = (formData.get('lieferant_firma_id')   as string) || null
  const menge              = parseFloat(formData.get('menge')      as string) || 0
  const einheit            = (formData.get('einheit')              as string) || 'kg'
  const preisGesamt        = parseFloat(formData.get('preis_gesamt') as string) || null
  const rebsorte           = (formData.get('rebsorte')             as string).trim() || null
  const jahrgang           = parseInt(formData.get('jahrgang')     as string) || null
  const notizen            = (formData.get('notizen')              as string).trim() || null
  const zielWeinausbauId   = (formData.get('ziel_weinausbau_id')   as string) || null

  if (menge <= 0) throw new Error('Menge muss ößer als 0 sein')

  const { error } = await (supabase.from('zukauf_posten') as any)
    .insert({
      tenant_id:            tenantId,
      datum,
      art,
      lieferant_kontakt_id: lieferantKontaktId || null,
      lieferant_firma_id:   lieferantFirmaId   || null,
      menge,
      einheit,
      preis_gesamt:         preisGesamt ?? null,
      rebsorte,
      jahrgang,
      notizen,
      ziel_weinausbau_id:   zielWeinausbauId   || null,
    })
    .select('id')
    .single()

  if (error) throw new Error((error as AR).message)

  // Wein oder Most: Bestand in Weinausbau-Charge erhoehen
  if ((art === 'wein' || art === 'most') && zielWeinausbauId) {
    const { data: wein } = await (supabase.from('weinausbau') as any)
      .select('menge_liter')
      .eq('id', zielWeinausbauId)
      .single()
    const aktuell = parseFloat((wein as AR | null)?.menge_liter ?? '0') || 0
    await (supabase.from('weinausbau') as any)
      .update({ menge_liter: aktuell + menge })
      .eq('id', zielWeinausbauId)
  }

  revalidatePath('/weinhandel/zukauf')
  revalidatePath('/weinhandel')
  revalidatePath('/kellerbuch')
  redirect('/weinhandel/zukauf')
}

export async function updateZukauf(id: string, formData: FormData) {
  const supabase = await createSupabaseServerClient()

  const datum              = (formData.get('datum')                as string) || new Date().toISOString().split('T')[0]
  const art                = (formData.get('art')                  as string) || 'trauben'
  const lieferantKontaktId = (formData.get('lieferant_kontakt_id') as string) || null
  const lieferantFirmaId   = (formData.get('lieferant_firma_id')   as string) || null
  const menge              = parseFloat(formData.get('menge')      as string) || 0
  const einheit            = (formData.get('einheit')              as string) || 'kg'
  const preisGesamt        = parseFloat(formData.get('preis_gesamt') as string) || null
  const rebsorte           = (formData.get('rebsorte')             as string).trim() || null
  const jahrgang           = parseInt(formData.get('jahrgang')     as string) || null
  const notizen            = (formData.get('notizen')              as string).trim() || null
  const zielWeinausbauId   = (formData.get('ziel_weinausbau_id')   as string) || null

  if (menge <= 0) throw new Error('Menge muss größer als 0 sein')

  const { error } = await (supabase.from('zukauf_posten') as any).update({
    datum,
    art,
    lieferant_kontakt_id: lieferantKontaktId || null,
    lieferant_firma_id:   lieferantFirmaId   || null,
    menge,
    einheit,
    preis_gesamt:         preisGesamt ?? null,
    rebsorte,
    jahrgang,
    notizen,
    ziel_weinausbau_id:   zielWeinausbauId   || null,
  }).eq('id', id)

  if (error) throw new Error((error as AR).message)

  revalidatePath('/weinhandel/zukauf')
  revalidatePath('/weinhandel')
  redirect('/weinhandel/zukauf')
}

export async function deleteZukauf(id: string) {
  const supabase = await createSupabaseServerClient()

  const { error } = await (supabase.from('zukauf_posten') as any)
    .update({ aktiv: false })
    .eq('id', id)

  if (error) throw new Error((error as AR).message)

  revalidatePath('/weinhandel/zukauf')
  revalidatePath('/weinhandel')
}
