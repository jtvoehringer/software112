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

// Hilfsfunktion: Charge in Behälter finden oder neu anlegen
async function findOrCreateCharge(
  supabase: any,
  tenantId: string,
  behaelterId: string,
  rebsorte: string | null,
  jahrgang: number | null,
  menge: number,
): Promise<string> {
  const name = [rebsorte, jahrgang].filter(Boolean).join(' ') || 'Zukauf'

  // Bestehende Charge mit gleicher Bezeichnung + Jahrgang im Behälter suchen
  const { data: existing } = await (supabase.from('weinausbau') as any)
    .select('id, menge_liter')
    .eq('tenant_id', tenantId)
    .eq('behaelter_id', behaelterId)
    .eq('name', name)
    .eq('aktiv', true)
    .neq('status', 'abgeschlossen')
    .limit(1)
    .single()

  if (existing) {
    const aktuell = parseFloat((existing as AR).menge_liter ?? '0') || 0
    await (supabase.from('weinausbau') as any)
      .update({ menge_liter: aktuell + menge })
      .eq('id', (existing as AR).id)
    return (existing as AR).id
  }

  // Neue Charge anlegen
  const { data: neu, error } = await (supabase.from('weinausbau') as any)
    .insert({
      tenant_id:   tenantId,
      name,
      behaelter_id: behaelterId,
      jahrgang,
      menge_liter:  menge,
      anfangsbestand_liter: null,
      status:      'ausbau',
      aktiv:       true,
    })
    .select('id')
    .single()
  if (error) throw new Error((error as AR).message)
  return (neu as AR).id
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
  const rebsorte           = (formData.get('rebsorte')             as string)?.trim() || null
  const jahrgang           = parseInt(formData.get('jahrgang')     as string) || null
  const notizen            = (formData.get('notizen')              as string)?.trim() || null
  const zielBehaelterId    = (formData.get('ziel_behaelter_id')    as string) || null

  if (menge <= 0) throw new Error('Menge muss größer als 0 sein')

  // Wein/Most → Charge in Behälter anlegen oder erhöhen
  let zielWeinausbauId: string | null = null
  if ((art === 'wein' || art === 'most') && zielBehaelterId) {
    zielWeinausbauId = await findOrCreateCharge(
      supabase, tenantId, zielBehaelterId, rebsorte, jahrgang, menge,
    )
  }

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
      ziel_weinausbau_id:   zielWeinausbauId,
    })

  if (error) throw new Error((error as AR).message)

  revalidatePath('/weinhandel/zukauf')
  revalidatePath('/weinhandel')
  revalidatePath('/kellerbuch')
  redirect('/weinhandel/zukauf')
}

export async function updateZukauf(id: string, formData: FormData) {
  const supabase = await createSupabaseServerClient()
  const tenantId = await getTenantId()

  const datum              = (formData.get('datum')                as string) || new Date().toISOString().split('T')[0]
  const art                = (formData.get('art')                  as string) || 'trauben'
  const lieferantKontaktId = (formData.get('lieferant_kontakt_id') as string) || null
  const lieferantFirmaId   = (formData.get('lieferant_firma_id')   as string) || null
  const menge              = parseFloat(formData.get('menge')      as string) || 0
  const einheit            = (formData.get('einheit')              as string) || 'kg'
  const preisGesamt        = parseFloat(formData.get('preis_gesamt') as string) || null
  const rebsorte           = (formData.get('rebsorte')             as string)?.trim() || null
  const jahrgang           = parseInt(formData.get('jahrgang')     as string) || null
  const notizen            = (formData.get('notizen')              as string)?.trim() || null
  const zielBehaelterId    = (formData.get('ziel_behaelter_id')    as string) || null

  if (menge <= 0) throw new Error('Menge muss größer als 0 sein')

  // Bestehende ziel_weinausbau_id laden
  const { data: alt } = await (supabase.from('zukauf_posten') as any)
    .select('ziel_weinausbau_id')
    .eq('id', id)
    .single()
  const altWeinausbauId: string | null = (alt as AR | null)?.ziel_weinausbau_id ?? null

  let zielWeinausbauId: string | null = altWeinausbauId

  // Wenn Behälter neu oder geändert: neue/bestehende Charge verwenden
  if ((art === 'wein' || art === 'most') && zielBehaelterId) {
    zielWeinausbauId = await findOrCreateCharge(
      supabase, tenantId, zielBehaelterId, rebsorte, jahrgang, menge,
    )
  } else if (!(art === 'wein' || art === 'most')) {
    zielWeinausbauId = null
  }

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
    ziel_weinausbau_id:   zielWeinausbauId,
  }).eq('id', id)

  if (error) throw new Error((error as AR).message)

  revalidatePath('/weinhandel/zukauf')
  revalidatePath('/weinhandel')
  revalidatePath('/kellerbuch')
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
