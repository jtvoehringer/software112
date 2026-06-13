'use server'

import { createSupabaseServerClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

async function getTenantId(): Promise<string | null> {
  const supabase = await createSupabaseServerClient()
  const { data } = await supabase.from('tenant_memberships').select('tenant_id').limit(1).single()
  return (data as R | null)?.tenant_id ?? null
}

// BEHAELTER
export async function createBehaelter(formData: FormData) {
  const supabase  = await createSupabaseServerClient()
  const tenantId  = await getTenantId()
  if (!tenantId) throw new Error('Kein Betrieb gefunden')

  const payload: R = {
    tenant_id:     tenantId,
    name:          formData.get('name') as string,
    typ:           (formData.get('typ') as string) || null,
    volumen_liter: formData.get('volumen_liter') ? Number((formData.get('volumen_liter') as string).replace(',', '.')) : null,
    standort:      (formData.get('standort') as string) || null,
    aktiv:         true,
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.from('behaelter') as any).insert(payload)
  if (error) throw new Error((error as R).message)
  revalidatePath('/kellerbuch')
}

export async function updateBehaelter(id: string, formData: FormData) {
  const supabase = await createSupabaseServerClient()
  const payload: R = {
    name:          formData.get('name') as string,
    typ:           (formData.get('typ') as string) || null,
    volumen_liter: formData.get('volumen_liter') ? Number((formData.get('volumen_liter') as string).replace(',', '.')) : null,
    standort:      (formData.get('standort') as string) || null,
    aktiv:         formData.get('aktiv') === 'true',
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.from('behaelter') as any).update(payload).eq('id', id)
  if (error) throw new Error((error as R).message)
  revalidatePath('/kellerbuch')
}

// WEINAUSBAU
export async function createWeinausbau(formData: FormData) {
  const supabase  = await createSupabaseServerClient()
  const tenantId  = await getTenantId()
  if (!tenantId) throw new Error('Kein Betrieb gefunden')

  const wgIds = formData.getAll('weingarten_ids').map(v => v.toString()).filter(Boolean)
  const payload: R = {
    tenant_id:       tenantId,
    name:            formData.get('name') as string,
    jahrgang:        formData.get('jahrgang') ? Number(formData.get('jahrgang')) : null,
    rebsorte:        (formData.get('rebsorte') as string) || null,
    weingarten_id:   wgIds[0] ?? null,
    behaelter_id:    (formData.get('behaelter_id') as string) || null,
    menge_liter:          formData.get('menge_liter') ? Number((formData.get('menge_liter') as string).replace(',', '.')) : null,
    anfangsbestand_liter: formData.get('menge_liter') ? Number((formData.get('menge_liter') as string).replace(',', '.')) : null,
    qualitaetsstufe:      (formData.get('qualitaetsstufe') as string) || null,
    status:               (formData.get('status') as string) || 'ernte',
    notizen:              (formData.get('notizen') as string) || null,
    einstandspreis_pro_liter: formData.get('einstandspreis_pro_liter')
      ? Number((formData.get('einstandspreis_pro_liter') as string).replace(',', '.'))
      : null,
    aktiv:           true,
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: newWA, error } = await (supabase.from('weinausbau') as any).insert(payload).select('id').single()
  if (error) throw new Error((error as R).message)
  // Junction-Tabelle: Rieden/Weingärten verknüpfen
  if (wgIds.length > 0 && (newWA as R)?.id) {
    const waId = (newWA as R).id as string
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase.from('weinausbau_weingaerten') as any).insert(
      wgIds.map(wgId => ({ tenant_id: tenantId, weinausbau_id: waId, weingarten_id: wgId }))
    )
  }
  revalidatePath('/kellerbuch')
}

export async function updateWeinausbau(id: string, formData: FormData) {
  const supabase = await createSupabaseServerClient()
  const tenantId = await getTenantId()
  if (!tenantId) throw new Error('Kein Betrieb gefunden')

  const wgIds = formData.getAll('weingarten_ids').map(v => v.toString()).filter(Boolean)
  const neueMenge = formData.get('menge_liter')
    ? Number((formData.get('menge_liter') as string).replace(',', '.'))
    : null
  const payload: R = {
    name:            formData.get('name') as string,
    jahrgang:        formData.get('jahrgang') ? Number(formData.get('jahrgang')) : null,
    rebsorte:        (formData.get('rebsorte') as string) || null,
    weingarten_id:   wgIds[0] ?? null,
    behaelter_id:    (formData.get('behaelter_id') as string) || null,
    menge_liter:     neueMenge,
    qualitaetsstufe:      (formData.get('qualitaetsstufe') as string) || null,
    status:               formData.get('status') as string,
    notizen:              (formData.get('notizen') as string) || null,
    einstandspreis_pro_liter: formData.get('einstandspreis_pro_liter')
      ? Number((formData.get('einstandspreis_pro_liter') as string).replace(',', '.'))
      : null,
    aktiv:           formData.get('aktiv') === 'true',
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.from('weinausbau') as any).update(payload).eq('id', id)
  if (error) throw new Error((error as R).message)

  // Junction-Tabelle: Rieden/Weingärten neu setzen (delete + insert)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (supabase.from('weinausbau_weingaerten') as any).delete().eq('weinausbau_id', id)
  if (wgIds.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase.from('weinausbau_weingaerten') as any).insert(
      wgIds.map(wgId => ({ tenant_id: tenantId, weinausbau_id: id, weingarten_id: wgId }))
    )
  }

  // KEIN Sync auf pressung_behaelter.menge_liter – das ist der historische Pressbetrag
  // und darf nicht mit dem laufenden Bestand überschrieben werden.

  revalidatePath('/kellerbuch')
  revalidatePath(`/kellerbuch/weinausbau/${id}`)
}

// ANALYSEN
export async function createAnalyse(formData: FormData) {
  const supabase = await createSupabaseServerClient()
  const tenantId = await getTenantId()
  if (!tenantId) throw new Error('Kein Betrieb gefunden')

  const weinausbauId = formData.get('weinausbau_id') as string
  if (!weinausbauId) throw new Error('Keine Charge angegeben')

  function numOrNull(key: string): number | null {
    const v = (formData.get(key) as string)?.replace(',', '.').trim()
    if (!v) return null
    const n = parseFloat(v)
    return isNaN(n) ? null : n
  }

  const payload: R = {
    tenant_id:            tenantId,
    weinausbau_id:        weinausbauId,
    analyse_datum:        formData.get('analyse_datum') as string,
    labor:                (formData.get('labor') as string) || null,
    probe_nr:             (formData.get('probe_nr') as string) || null,
    alkohol_vol:          numOrNull('alkohol_vol'),
    restzucker_gl:        numOrNull('restzucker_gl'),
    gesamtsaeure_gl:      numOrNull('gesamtsaeure_gl'),
    ph_wert:              numOrNull('ph_wert'),
    // Spaltenname im DB hat Umlaut – via Alias im Formular (fluechtige_saeure_gl)
    'flüchtige_saeure_gl': numOrNull('fluechtige_saeure_gl'),
    freie_so2_mgl:        numOrNull('freie_so2_mgl'),
    gesamt_so2_mgl:       numOrNull('gesamt_so2_mgl'),
    bewertung:            (formData.get('bewertung') as string) || null,
    notizen:              (formData.get('notizen') as string) || null,
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.from('weinanalysen') as any).insert(payload)
  if (error) throw new Error((error as R).message)

  revalidatePath(`/kellerbuch/weinausbau/${weinausbauId}/analysen`)
  revalidatePath(`/kellerbuch/weinausbau/${weinausbauId}/buch`)
}

// VERSCHNEIDUNG
export async function createVerschneidung(formData: FormData) {
  const supabase  = await createSupabaseServerClient()
  const tenantId  = await getTenantId()
  if (!tenantId) throw new Error('Kein Betrieb gefunden')

  const datum        = formData.get('datum') as string
  const zielId       = formData.get('ziel_weinausbau_id') as string
  const notizen      = (formData.get('notizen') as string) || null
  const quellenJson  = formData.get('quellen_json') as string
  const quellen: { weinausbau_id: string; menge_liter: number }[] = JSON.parse(quellenJson || '[]')

  if (!datum || !zielId || quellen.length === 0) throw new Error('Pflichtfelder fehlen')

  // Verschneidungs-Datensatz anlegen
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: neu, error: ve } = await (supabase.from('verschneidungen') as any)
    .insert({ tenant_id: tenantId, datum, ziel_weinausbau_id: zielId, notizen })
    .select('id').single()
  if (ve) throw new Error((ve as R).message)
  const vId = (neu as R).id as string

  // Quellen anlegen + anteil_pct berechnen
  const gesamtLiter = quellen.reduce((s, q) => s + q.menge_liter, 0)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (supabase.from('verschneidung_quellen') as any).insert(
    quellen.map(q => ({
      verschneidung_id:    vId,
      quell_weinausbau_id: q.weinausbau_id,
      menge_liter:         q.menge_liter,
      anteil_pct:          gesamtLiter > 0 ? Math.round((q.menge_liter / gesamtLiter) * 1000) / 10 : null,
    }))
  )

  // Ziel-Charge: Bestand um die Summe der Quellen erhöhen
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: ziel } = await (supabase.from('weinausbau') as any)
    .select('menge_liter').eq('id', zielId).single()
  const aktuell = parseFloat((ziel as R)?.menge_liter ?? '0') || 0
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (supabase.from('weinausbau') as any)
    .update({ menge_liter: aktuell + gesamtLiter })
    .eq('id', zielId)

  // Quell-Chargen: Bestand reduzieren
  for (const q of quellen) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: src } = await (supabase.from('weinausbau') as any)
      .select('menge_liter').eq('id', q.weinausbau_id).single()
    const srcLiter = parseFloat((src as R)?.menge_liter ?? '0') || 0
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase.from('weinausbau') as any)
      .update({ menge_liter: Math.max(0, srcLiter - q.menge_liter) })
      .eq('id', q.weinausbau_id)
  }

  revalidatePath('/kellerbuch')
  quellen.forEach(q => revalidatePath(`/kellerbuch/weinausbau/${q.weinausbau_id}/buch`))
  revalidatePath(`/kellerbuch/weinausbau/${zielId}/buch`)
  revalidatePath(`/kellerbuch/weinausbau/${zielId}`)
}
