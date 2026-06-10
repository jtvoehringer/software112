'use server'

import { createSupabaseServerClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

async function getTenantId(): Promise<string> {
  const supabase = await createSupabaseServerClient()
  const { data } = await (supabase.from('tenant_memberships') as any).select('tenant_id').limit(1).single()
  const id = (data as R | null)?.tenant_id
  if (!id) throw new Error('Kein Betrieb gefunden')
  return id
}

// EROEFFNUNGSBESTAND

export async function createEroeffnungsbestand(formData: FormData) {
  const supabase  = await createSupabaseServerClient()
  const tenantId  = await getTenantId()
  const menge     = parseFloat(formData.get('menge_liter') as string)
  const jahr      = new Date().getFullYear()

  const payload: R = {
    tenant_id:            tenantId,
    name:                 formData.get('name') as string,
    jahrgang:             parseInt(formData.get('jahrgang') as string) || null,
    kmw:                  parseFloat(formData.get('kmw') as string) || null,
    menge_liter:          menge,
    anfangsbestand_liter: menge,
    qualitaetsstufe:      (formData.get('qualitaetsstufe') as string) || null,
    behaelter_id:         (formData.get('behaelter_id') as string) || null,
    notizen:              (formData.get('notizen') as string) || null,
    status:               'ausbau',
    ist_eroeffnungsbestand: true,
    created_at:           new Date(`${jahr}-01-01T00:00:00`).toISOString(),
    aktiv:                true,
  }

  const { error } = await (supabase.from('weinausbau') as any).insert(payload)
  if (error) {
    // Fehler sichtbar machen statt cryptic 500: Redirect mit Fehlermeldung
    console.error('[createEroeffnungsbestand] DB Fehler:', (error as R).message, (error as R).code)
    redirect(`/kellerbuch/gebinde?tab=eroeffnungsbestand&err=${encodeURIComponent((error as R).message)}`)
  }
  revalidatePath('/kellerbuch/gebinde')
  redirect('/kellerbuch/gebinde?tab=eroeffnungsbestand')
}

export async function updateEroeffnungsbestand(id: string, formData: FormData) {
  const supabase = await createSupabaseServerClient()
  const menge    = parseFloat(formData.get('menge_liter') as string)

  const payload: R = {
    name:            formData.get('name') as string,
    jahrgang:        parseInt(formData.get('jahrgang') as string) || null,
    kmw:             parseFloat(formData.get('kmw') as string) || null,
    menge_liter:     menge,
    qualitaetsstufe: (formData.get('qualitaetsstufe') as string) || null,
    behaelter_id:    (formData.get('behaelter_id') as string) || null,
    notizen:         (formData.get('notizen') as string) || null,
  }

  const { error } = await (supabase.from('weinausbau') as any).update(payload).eq('id', id)
  if (error) {
    console.error('[updateEroeffnungsbestand] DB Fehler:', (error as R).message)
    redirect(`/kellerbuch/gebinde?tab=eroeffnungsbestand&err=${encodeURIComponent((error as R).message)}`)
  }
  revalidatePath('/kellerbuch/gebinde')
  redirect('/kellerbuch/gebinde?tab=eroeffnungsbestand')
}

export async function deleteEroeffnungsbestand(id: string) {
  const supabase = await createSupabaseServerClient()
  const { error } = await (supabase.from('weinausbau') as any)
    .update({ aktiv: false })
    .eq('id', id)
    .eq('ist_eroeffnungsbestand', true)
  if (error) throw new Error((error as R).message)
  revalidatePath('/kellerbuch/gebinde')
}

// UMZIEHEN

export async function createUmzug(formData: FormData) {
  const supabase      = await createSupabaseServerClient()
  const tenantId      = await getTenantId()
  const vonId         = formData.get('von_weinausbau_id') as string
  const nachId        = formData.get('nach_behaelter_id') as string
  const menge         = parseFloat(formData.get('menge_liter') as string)
  const schwund       = parseFloat(formData.get('schwund_liter') as string) || 0

  // Bestandspruefung
  const { data: wa } = await (supabase.from('weinausbau') as any)
    .select('menge_liter').eq('id', vonId).single()
  const verfuegbar = parseFloat((wa as R | null)?.menge_liter ?? '0') || 0
  if (menge + schwund > verfuegbar + 0.01) {
    throw new Error(`Menge (${menge + schwund} L) übersteigt Bestand (${verfuegbar} L)`)
  }

  const payload: R = {
    tenant_id:          tenantId,
    von_weinausbau_id:  vonId,
    nach_behaelter_id:  nachId,
    datum:              formData.get('datum') as string,
    menge_liter:        menge,
    schwund_liter:      schwund,
    notizen:            (formData.get('notizen') as string) || null,
  }

  const { error } = await (supabase.from('keller_umzuege') as any).insert(payload)
  if (error) throw new Error((error as R).message)

  // Bestand reduzieren
  const neuMenge = Math.max(0, verfuegbar - menge - schwund)
  await (supabase.from('weinausbau') as any)
    .update({ menge_liter: neuMenge, behaelter_id: nachId })
    .eq('id', vonId)

  revalidatePath('/kellerbuch')
  revalidatePath('/kellerbuch/gebinde')
}

export async function updateUmzug(id: string, formData: FormData) {
  const supabase  = await createSupabaseServerClient()
  const menge     = parseFloat(formData.get('menge_liter') as string)
  const schwund   = parseFloat(formData.get('schwund_liter') as string) || 0

  // Alte Werte laden um Bestandsdiff zu berechnen
  const { data: alt } = await (supabase.from('keller_umzuege') as any)
    .select('menge_liter, schwund_liter, von_weinausbau_id').eq('id', id).single()
  const altMenge   = parseFloat((alt as R | null)?.menge_liter ?? '0') || 0
  const altSchwund = parseFloat((alt as R | null)?.schwund_liter ?? '0') || 0
  const vonId      = (alt as R | null)?.von_weinausbau_id

  const { error } = await (supabase.from('keller_umzuege') as any).update({
    datum:             formData.get('datum') as string,
    nach_behaelter_id: formData.get('nach_behaelter_id') as string,
    menge_liter:       menge,
    schwund_liter:     schwund,
    notizen:           (formData.get('notizen') as string) || null,
  }).eq('id', id)
  if (error) throw new Error((error as R).message)

  // Bestand korrigieren: +alt -neu
  if (vonId) {
    const { data: wa } = await (supabase.from('weinausbau') as any)
      .select('menge_liter').eq('id', vonId).single()
    const aktuell  = parseFloat((wa as R | null)?.menge_liter ?? '0') || 0
    const neuMenge = Math.max(0, aktuell + altMenge + altSchwund - menge - schwund)
    await (supabase.from('weinausbau') as any)
      .update({ menge_liter: neuMenge }).eq('id', vonId)
  }

  revalidatePath('/kellerbuch')
  revalidatePath('/kellerbuch/gebinde')
  redirect('/kellerbuch/gebinde?tab=umziehen')
}

export async function deleteUmzug(id: string) {
  const supabase = await createSupabaseServerClient()

  // Bestand wiederherstellen
  const { data: u } = await (supabase.from('keller_umzuege') as any)
    .select('menge_liter, schwund_liter, von_weinausbau_id').eq('id', id).single()
  const menge  = parseFloat((u as R | null)?.menge_liter ?? '0') || 0
  const schwund= parseFloat((u as R | null)?.schwund_liter ?? '0') || 0
  const vonId  = (u as R | null)?.von_weinausbau_id

  if (vonId) {
    const { data: wa } = await (supabase.from('weinausbau') as any)
      .select('menge_liter').eq('id', vonId).single()
    const aktuell  = parseFloat((wa as R | null)?.menge_liter ?? '0') || 0
    await (supabase.from('weinausbau') as any)
      .update({ menge_liter: aktuell + menge + schwund }).eq('id', vonId)
  }

  const { error } = await (supabase.from('keller_umzuege') as any).delete().eq('id', id)
  if (error) throw new Error((error as R).message)
  revalidatePath('/kellerbuch')
  revalidatePath('/kellerbuch/gebinde')
}
