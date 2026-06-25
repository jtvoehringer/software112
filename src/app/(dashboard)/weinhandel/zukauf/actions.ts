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

// Hilfsfunktion: Neue Charge pro Zukauf anlegen (kein Merging mit bestehenden Chargen)
async function createZukaufCharge(
  supabase: any,
  tenantId: string,
  behaelterId: string,
  rebsorte: string | null,
  jahrgang: number | null,
  menge: number,
  einstandspreisProLiter: number | null,
  weinart: string | null,
): Promise<string> {
  const name = [rebsorte, jahrgang].filter(Boolean).join(' ') || 'Zukauf'
  const { data: neu, error } = await (supabase.from('weinausbau') as any)
    .insert({
      tenant_id:   tenantId,
      name,
      behaelter_id: behaelterId,
      jahrgang,
      menge_liter:  menge,
      einstandspreis_pro_liter: einstandspreisProLiter ?? null,
      anfangsbestand_liter: null,
      status:      'ausbau',
      aktiv:       true,
      weinart:     weinart ?? 'unbekannt',
    })
    .select('id')
    .single()
  if (error) throw new Error((error as AR).message)
  return (neu as AR).id
}

// Hilfsfunktion: Zukauf-Charge bereinigen (deaktivieren wenn keine weiteren Transaktionen)
async function bereinigCharge(supabase: any, weinausbauId: string): Promise<void> {
  // Prüfen ob Umzüge oder Füllungen auf diese Charge referenzieren
  const [{ count: umzugCount }, { count: fuellungCount }] = await Promise.all([
    (supabase.from('keller_umzuege') as any)
      .select('id', { count: 'exact', head: true })
      .or(`von_weinausbau_id.eq.${weinausbauId},nach_weinausbau_id.eq.${weinausbauId}`),
    (supabase.from('fuellungen') as any)
      .select('id', { count: 'exact', head: true })
      .eq('weinausbau_id', weinausbauId),
  ])
  if ((umzugCount ?? 0) > 0 || (fuellungCount ?? 0) > 0) {
    // Bereits verwendet → menge auf 0 setzen, Status abschließen
    await (supabase.from('weinausbau') as any)
      .update({ menge_liter: 0, status: 'abgeschlossen' })
      .eq('id', weinausbauId)
  } else {
    // Keine weiteren Transaktionen → deaktivieren + abschließen
    await (supabase.from('weinausbau') as any)
      .update({ aktiv: false, status: 'abgeschlossen' })
      .eq('id', weinausbauId)
  }
}

export async function createZukauf(formData: FormData) {
  const supabase = await createSupabaseServerClient()
  const tenantId = await getTenantId()

  const datum                 = (formData.get('datum')                    as string) || new Date().toISOString().split('T')[0]
  const art                   = (formData.get('art')                      as string) || 'trauben'
  const lieferantKontaktId    = (formData.get('lieferant_kontakt_id')     as string) || null
  const lieferantFirmaId      = (formData.get('lieferant_firma_id')       as string) || null
  const menge                 = parseFloat(formData.get('menge')          as string) || 0
  const einheit               = (formData.get('einheit')                  as string) || 'kg'
  const preisGesamt           = parseFloat(formData.get('preis_gesamt')   as string) || null
  const einstandspreisLiter   = parseFloat(formData.get('einstandspreis_pro_liter') as string) || null
  const rebsorte              = (formData.get('rebsorte')                 as string)?.trim() || null
  const jahrgang              = parseInt(formData.get('jahrgang')         as string) || null
  const notizen               = (formData.get('notizen')                  as string)?.trim() || null
  const zielBehaelterId       = (formData.get('ziel_behaelter_id')        as string) || null
  const weinart               = (formData.get('weinart')                  as string) || 'unbekannt'

  if (menge <= 0) throw new Error('Menge muss größer als 0 sein')

  // Wein/Most → eigene Charge pro Zukauf anlegen
  let zielWeinausbauId: string | null = null
  if ((art === 'wein' || art === 'most') && zielBehaelterId) {
    zielWeinausbauId = await createZukaufCharge(
      supabase, tenantId, zielBehaelterId, rebsorte, jahrgang, menge, einstandspreisLiter, weinart,
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
      einstandspreis_pro_liter: einstandspreisLiter ?? null,
      rebsorte,
      jahrgang,
      notizen,
      weinart,
      ziel_weinausbau_id:   zielWeinausbauId,
    })

  if (error) throw new Error((error as AR).message)

  revalidatePath('/weinhandel/zukauf')
  revalidatePath('/weinhandel')
  revalidatePath('/kellerbuch')

  // Rebsortenmix prüfen: neue Charge in Behälter mit anderen Rebsorten?
  if (zielWeinausbauId && zielBehaelterId && rebsorte) {
    const { data: andereChargen } = await (supabase.from('weinausbau') as any)
      .select('id')
      .eq('behaelter_id', zielBehaelterId)
      .eq('aktiv', true)
      .neq('id', zielWeinausbauId)
      .neq('rebsorte', rebsorte)
      .limit(1)
    if ((andereChargen as any[])?.length > 0) {
      const existierendeId = (andereChargen as any[])[0].id
      redirect(`/kellerbuch/weinausbau/${existierendeId}?form=verschneiden&quelle=${zielWeinausbauId}&menge=${menge}`)
    }
  }

  redirect('/weinhandel/zukauf')
}

export async function updateZukauf(id: string, formData: FormData) {
  const supabase = await createSupabaseServerClient()
  const tenantId = await getTenantId()

  const datum                 = (formData.get('datum')                    as string) || new Date().toISOString().split('T')[0]
  const art                   = (formData.get('art')                      as string) || 'trauben'
  const lieferantKontaktId    = (formData.get('lieferant_kontakt_id')     as string) || null
  const lieferantFirmaId      = (formData.get('lieferant_firma_id')       as string) || null
  const menge                 = parseFloat(formData.get('menge')          as string) || 0
  const einheit               = (formData.get('einheit')                  as string) || 'kg'
  const preisGesamt           = parseFloat(formData.get('preis_gesamt')   as string) || null
  const einstandspreisLiter   = parseFloat(formData.get('einstandspreis_pro_liter') as string) || null
  const rebsorte              = (formData.get('rebsorte')                 as string)?.trim() || null
  const jahrgang              = parseInt(formData.get('jahrgang')         as string) || null
  const notizen               = (formData.get('notizen')                  as string)?.trim() || null
  const zielBehaelterId       = (formData.get('ziel_behaelter_id')        as string) || null
  const weinart               = (formData.get('weinart')                  as string) || 'unbekannt'

  if (menge <= 0) throw new Error('Menge muss größer als 0 sein')

  // Bestehende ziel_weinausbau_id laden
  const { data: alt } = await (supabase.from('zukauf_posten') as any)
    .select('ziel_weinausbau_id')
    .eq('id', id)
    .single()
  const altWeinausbauId: string | null = (alt as AR | null)?.ziel_weinausbau_id ?? null

  let zielWeinausbauId: string | null = altWeinausbauId

  // Wenn Behälter neu oder geändert: neue Charge anlegen (alte ggf. bereinigen)
  if ((art === 'wein' || art === 'most') && zielBehaelterId) {
    // Alte Charge bereinigen falls Behälter gewechselt
    if (altWeinausbauId) {
      await bereinigCharge(supabase, altWeinausbauId)
    }
    zielWeinausbauId = await createZukaufCharge(
      supabase, tenantId, zielBehaelterId, rebsorte, jahrgang, menge, einstandspreisLiter, weinart,
    )
  } else if (!(art === 'wein' || art === 'most')) {
    if (altWeinausbauId) await bereinigCharge(supabase, altWeinausbauId)
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
    einstandspreis_pro_liter: einstandspreisLiter ?? null,
    rebsorte,
    jahrgang,
    notizen,
    weinart,
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

  // Zuerst verknüpfte Charge laden
  const { data: zukauf } = await (supabase.from('zukauf_posten') as any)
    .select('ziel_weinausbau_id')
    .eq('id', id)
    .single()
  const weinausbauId: string | null = (zukauf as AR | null)?.ziel_weinausbau_id ?? null

  // Zukauf deaktivieren
  const { error } = await (supabase.from('zukauf_posten') as any)
    .update({ aktiv: false })
    .eq('id', id)
  if (error) throw new Error((error as AR).message)

  // Zugehörige Charge bereinigen
  if (weinausbauId) {
    await bereinigCharge(supabase, weinausbauId)
  }

  revalidatePath('/weinhandel/zukauf')
  revalidatePath('/weinhandel')
  revalidatePath('/kellerbuch')
}
