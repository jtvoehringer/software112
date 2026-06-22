'use server'

import { createSupabaseServerClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRecord = Record<string, any>

async function getTenantId(): Promise<string | null> {
  const supabase = await createSupabaseServerClient()
  const { data } = await supabase
    .from('tenant_memberships')
    .select('tenant_id')
    .limit(1)
    .single()
  return (data as AnyRecord | null)?.tenant_id ?? null
}

export async function createWeingarten(formData: FormData) {
  const supabase = await createSupabaseServerClient()
  const tenantId = await getTenantId()
  if (!tenantId) throw new Error('Kein Betrieb gefunden')

  const payload: AnyRecord = {
    tenant_id:            tenantId,
    name:                 formData.get('name') as string,
    notizen:              (formData.get('notizen') as string) || null,
    aktiv:                true,
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.from('weingarten') as any).insert(payload)
  if (error) throw new Error((error as AnyRecord).message)
  revalidatePath('/weingarten')
}

export async function updateWeingarten(id: string, formData: FormData) {
  const supabase = await createSupabaseServerClient()

  const payload: AnyRecord = {
    name:                 formData.get('name') as string,
    notizen:              (formData.get('notizen') as string) || null,
    aktiv:                formData.get('aktiv') === 'true',
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.from('weingarten') as any).update(payload).eq('id', id)
  if (error) throw new Error((error as AnyRecord).message)
  revalidatePath('/weingarten')
}

export async function deactivateWeingarten(id: string) {
  const supabase = await createSupabaseServerClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.from('weingarten') as any).update({ aktiv: false }).eq('id', id)
  if (error) throw new Error((error as AnyRecord).message)
  revalidatePath('/weingarten')
}

export async function deleteWeingarten(id: string) {
  const supabase = await createSupabaseServerClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.from('weingarten') as any).delete().eq('id', id)
  if (error) throw new Error((error as AnyRecord).message)
  revalidatePath('/weingarten')
}

// ── Grundstücke ─────────────────────────────────────────────────────────────────────────────────

export async function createGrundstueck(weingartenId: string, formData: FormData) {
  const supabase = await createSupabaseServerClient()
  const tenantId = await getTenantId()
  if (!tenantId) throw new Error('Kein Betrieb gefunden')

  const status = formData.get('status') as string || 'aktiv'
  const payload: AnyRecord = {
    tenant_id:             tenantId,
    weingarten_id:         weingartenId,
    gst_nr:                formData.get('gst_nr') as string,
    katastralgemeinde:     (formData.get('katastralgemeinde') as string) || null,
    einlagezahl:           (formData.get('einlagezahl') as string) || null,
    ama_feldnummer:        (formData.get('ama_feldnummer') as string) || null,
    kg_bezeichnung:        (formData.get('kg_bezeichnung') as string) || null,
    boden:                 (formData.get('boden') as string) || null,
    rechtsverhaeltnis:     (formData.get('rechtsverhaeltnis') as string) || null,
    unterlagsrebe:         (formData.get('unterlagsrebe') as string) || null,
    rebsorte:              (formData.get('rebsorte') as string) || null,
    pflanzjahr:            formData.get('pflanzjahr') ? Number(formData.get('pflanzjahr')) : null,
    weinart:               (formData.get('weinart') as string) || null,
    bewirtschaftung:       (formData.get('bewirtschaftung') as string) || null,
    bewirtschaftung_seit:  (formData.get('bewirtschaftung_seit') as string) || null,
    flaeche_ha:            formData.get('flaeche_ha') ? Number(formData.get('flaeche_ha')) : null,
    flaeche_ha_kataster:   formData.get('flaeche_ha_kataster') ? Number(formData.get('flaeche_ha_kataster')) : null,
    trauben_herkunft_code: (formData.get('trauben_herkunft_code') as string) || null,
    status,
    spritzbar:             status === 'aktiv',
    notizen:               (formData.get('notizen') as string) || null,
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.from('grundstuecke') as any).insert(payload)
  if (error) throw new Error((error as AnyRecord).message)
  revalidatePath('/weingarten')
}

export async function updateGrundstueck(id: string, weingartenId: string, formData: FormData) {
  const supabase = await createSupabaseServerClient()
  const status = formData.get('status') as string || 'aktiv'
  const payload: AnyRecord = {
    gst_nr:                formData.get('gst_nr') as string,
    katastralgemeinde:     (formData.get('katastralgemeinde') as string) || null,
    einlagezahl:           (formData.get('einlagezahl') as string) || null,
    ama_feldnummer:        (formData.get('ama_feldnummer') as string) || null,
    kg_bezeichnung:        (formData.get('kg_bezeichnung') as string) || null,
    boden:                 (formData.get('boden') as string) || null,
    rechtsverhaeltnis:     (formData.get('rechtsverhaeltnis') as string) || null,
    unterlagsrebe:         (formData.get('unterlagsrebe') as string) || null,
    rebsorte:              (formData.get('rebsorte') as string) || null,
    pflanzjahr:            formData.get('pflanzjahr') ? Number(formData.get('pflanzjahr')) : null,
    weinart:               (formData.get('weinart') as string) || null,
    bewirtschaftung:       (formData.get('bewirtschaftung') as string) || null,
    bewirtschaftung_seit:  (formData.get('bewirtschaftung_seit') as string) || null,
    flaeche_ha:            formData.get('flaeche_ha') ? Number(formData.get('flaeche_ha')) : null,
    flaeche_ha_kataster:   formData.get('flaeche_ha_kataster') ? Number(formData.get('flaeche_ha_kataster')) : null,
    trauben_herkunft_code: (formData.get('trauben_herkunft_code') as string) || null,
    status,
    spritzbar:             status === 'aktiv',
    notizen:               (formData.get('notizen') as string) || null,
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.from('grundstuecke') as any).update(payload).eq('id', id)
  if (error) throw new Error((error as AnyRecord).message)
  revalidatePath('/weingarten')
  revalidatePath(`/weingarten/${weingartenId}`)
}

export async function deleteGrundstueck(id: string, weingartenId: string) {
  const supabase = await createSupabaseServerClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.from('grundstuecke') as any).delete().eq('id', id)
  if (error) throw new Error((error as AnyRecord).message)
  revalidatePath('/weingarten')
  revalidatePath(`/weingarten/${weingartenId}`)
}

// ── BEV Kataster-API ────────────────────────────────────────────────────────────────────────────

export type BevResult = {
  ok: true; ha: number
  nutzungen: Array<{ nutzung: string; ha: number }>
} | { ok: false; message: string }

export async function fetchBevFlaeche(kgnr: string, gstNr: string): Promise<BevResult> {
  if (!kgnr || !gstNr) return { ok: false, message: 'KGNr und GST-Nr erforderlich' }
  try {
    const url = 'https://kataster.bev.gv.at/api/gst/' + encodeURIComponent(kgnr) + '/' + gstNr
    const res = await fetch(url, { cache: 'no-store' })
    if (!res.ok) return { ok: false, message: 'BEV-API Fehler: ' + res.status }
    const data = await res.json() as Record<string, unknown>
    if ('message' in data) return { ok: false, message: String(data.message) }
    type Nutzung = { nutzung: string; fl: number }
    const props = (data.properties as { nutzungen?: Nutzung[] } | undefined)
    const nutzungen: Nutzung[] = props?.nutzungen ?? []
    const totalM2 = nutzungen.reduce((s, n) => s + (n.fl ?? 0), 0)
    return {
      ok: true,
      ha: Math.round(totalM2) / 10000,
      nutzungen: nutzungen.map(n => ({ nutzung: n.nutzung, ha: Math.round(n.fl) / 10000 })),
    }
  } catch {
    return { ok: false, message: 'BEV-API nicht erreichbar' }
  }
}
