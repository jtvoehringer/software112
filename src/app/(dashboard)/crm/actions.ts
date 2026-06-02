'use server'

import { createSupabaseServerClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AR = Record<string, any>

async function getTenantId(): Promise<string> {
  const supabase = await createSupabaseServerClient()
  const { data } = await (supabase.from('tenant_memberships') as any).select('tenant_id').limit(1).single()
  const id = (data as AR | null)?.tenant_id
  if (!id) throw new Error('Kein Betrieb gefunden')
  return id
}

async function generateKundennummer(tenantId: string): Promise<string | null> {
  const supabase = await createSupabaseServerClient()
  const { data, error } = await (supabase.rpc as any)('get_next_kundennummer', {
    p_tenant_id: tenantId,
  })
  if (error) { console.error('generateKundennummer:', error.message); return null }
  return data as string | null
}

// ── Kontakte ──────────────────────────────────────────────────────────────────

export async function createKontakt(formData: FormData) {
  const supabase = await createSupabaseServerClient()
  const tenantId = await getTenantId()
  const payload: AR = {
    tenant_id:   tenantId,
    vorname:     (formData.get('vorname') as string) || null,
    nachname:    formData.get('nachname') as string,
    segment:     formData.get('segment') as string,
    firma_id:    (formData.get('firma_id') as string) || null,
    email:       (formData.get('email') as string) || null,
    telefon:          (formData.get('telefon')          as string) || null,
    telefon_vorwahl:  (formData.get('telefon_vorwahl') as string) || '+43',
    mobil:            (formData.get('mobil')            as string) || null,
    mobil_vorwahl:    (formData.get('mobil_vorwahl')    as string) || '+43',
    strasse:     (formData.get('strasse') as string) || null,
    plz:         (formData.get('plz')     as string) || null,
    ort:         (formData.get('ort')     as string) || null,
    land:        (formData.get('land') as string) || 'AT',
    stammkunde:  formData.get('stammkunde') === 'true',
    notizen:         (formData.get('notizen')         as string) || null,
    ...(formData.get('rabattgruppe_id') ? { rabattgruppe_id: formData.get('rabattgruppe_id') as string } : {}),
    sonderrabatt_pct: parseFloat(formData.get('sonderrabatt_pct') as string) || 0,
    is_lead: formData.get('is_lead') === 'true',
  }
  payload.kundennummer = await generateKundennummer(tenantId)
  const { error } = await (supabase.from('kontakte') as any).insert(payload)
  if (error) throw new Error((error as AR).message)
  revalidatePath('/crm/kontakte')
}

export async function updateKontakt(id: string, formData: FormData) {
  const supabase = await createSupabaseServerClient()
  const payload: AR = {
    vorname:    (formData.get('vorname') as string) || null,
    nachname:   formData.get('nachname') as string,
    segment:    formData.get('segment') as string,
    firma_id:   (formData.get('firma_id') as string) || null,
    email:      (formData.get('email') as string) || null,
    telefon:          (formData.get('telefon')          as string) || null,
    telefon_vorwahl:  (formData.get('telefon_vorwahl') as string) || '+43',
    mobil:            (formData.get('mobil')            as string) || null,
    mobil_vorwahl:    (formData.get('mobil_vorwahl')    as string) || '+43',
    strasse:    (formData.get('strasse') as string) || null,
    plz:        (formData.get('plz')     as string) || null,
    ort:        (formData.get('ort')     as string) || null,
    land:       (formData.get('land') as string) || 'AT',
    stammkunde: formData.get('stammkunde') === 'true',
    notizen:         (formData.get('notizen')         as string) || null,
    ...(formData.get('rabattgruppe_id') !== undefined ? { rabattgruppe_id: (formData.get('rabattgruppe_id') as string) || null } : {}),
    sonderrabatt_pct: parseFloat(formData.get('sonderrabatt_pct') as string) || 0,
    is_lead: formData.get('is_lead') === 'true',
    aktualisiert_am: new Date().toISOString(),
  }
  const { error } = await (supabase.from('kontakte') as any).update(payload).eq('id', id)
  if (error) throw new Error((error as AR).message)
  revalidatePath('/crm/kontakte')
  revalidatePath('/crm/kontakte/[id]', 'page')
}

export async function deleteKontakt(id: string) {
  const supabase = await createSupabaseServerClient()
  const { error } = await (supabase.from('kontakte') as any).delete().eq('id', id)
  if (error) throw new Error((error as AR).message)
  revalidatePath('/crm/kontakte')
}

// ── Firmen ────────────────────────────────────────────────────────────────────

export async function createFirma(formData: FormData) {
  const supabase = await createSupabaseServerClient()
  const tenantId = await getTenantId()
  const payload: AR = {
    tenant_id:          tenantId,
    name:               formData.get('name') as string,
    segment:            formData.get('segment') as string,
    strasse:            (formData.get('strasse') as string) || null,
    plz:                (formData.get('plz') as string) || null,
    ort:                (formData.get('ort') as string) || null,
    land:               (formData.get('land') as string) || 'AT',
    telefon:            (formData.get('telefon')          as string) || null,
    telefon_vorwahl:    (formData.get('telefon_vorwahl') as string) || '+43',
    email:              (formData.get('email') as string) || null,
    website:            (formData.get('website') as string) || null,
    uid_nummer:         (formData.get('uid_nummer') as string) || null,
    zahlungsziel_tage:  parseInt(formData.get('zahlungsziel_tage') as string) || 30,
    waehrung:           (formData.get('waehrung') as string) || 'EUR',
    notizen:            (formData.get('notizen')         as string) || null,
    ...(formData.get('rabattgruppe_id') ? { rabattgruppe_id: formData.get('rabattgruppe_id') as string } : {}),
    sonderrabatt_pct: parseFloat(formData.get('sonderrabatt_pct') as string) || 0,
    is_lead: formData.get('is_lead') === 'true',
  }
  payload.kundennummer = await generateKundennummer(tenantId)
  const { error } = await (supabase.from('firmen') as any).insert(payload)
  if (error) throw new Error((error as AR).message)
  revalidatePath('/crm/firmen')
}

export async function updateFirma(id: string, formData: FormData) {
  const supabase = await createSupabaseServerClient()
  const payload: AR = {
    name:               formData.get('name') as string,
    segment:            formData.get('segment') as string,
    strasse:            (formData.get('strasse') as string) || null,
    plz:                (formData.get('plz') as string) || null,
    ort:                (formData.get('ort') as string) || null,
    land:               (formData.get('land') as string) || 'AT',
    telefon:            (formData.get('telefon')          as string) || null,
    telefon_vorwahl:    (formData.get('telefon_vorwahl') as string) || '+43',
    email:              (formData.get('email') as string) || null,
    website:            (formData.get('website') as string) || null,
    uid_nummer:         (formData.get('uid_nummer') as string) || null,
    zahlungsziel_tage:  parseInt(formData.get('zahlungsziel_tage') as string) || 30,
    waehrung:           (formData.get('waehrung') as string) || 'EUR',
    notizen:            (formData.get('notizen')         as string) || null,
    ...(formData.get('rabattgruppe_id') !== undefined ? { rabattgruppe_id: (formData.get('rabattgruppe_id') as string) || null } : {}),
    sonderrabatt_pct: parseFloat(formData.get('sonderrabatt_pct') as string) || 0,
    is_lead: formData.get('is_lead') === 'true',
    aktualisiert_am:    new Date().toISOString(),
  }
  const { error } = await (supabase.from('firmen') as any).update(payload).eq('id', id)
  if (error) throw new Error((error as AR).message)
  revalidatePath('/crm/firmen')
  revalidatePath('/crm/firmen/[id]', 'page')
}

export async function deleteFirma(id: string) {
  const supabase = await createSupabaseServerClient()
  const { error } = await (supabase.from('firmen') as any).delete().eq('id', id)
  if (error) throw new Error((error as AR).message)
  revalidatePath('/crm/firmen')
}

// ── Aktivitäten ───────────────────────────────────────────────────────────────

export async function moveAktivitaet(id: string, datum: string, uhrzeit_von: string, uhrzeit_bis: string) {
  const supabase = await createSupabaseServerClient()
  const { error } = await (supabase.from('aktivitaeten') as any)
    .update({ datum, ganztags: !uhrzeit_von && !uhrzeit_bis, uhrzeit_von: uhrzeit_von || null, uhrzeit_bis: uhrzeit_bis || null })
    .eq('id', id)
  if (error) { console.error('[updateAktivitaet] ERROR:', error.message, error.code); throw new Error((error as AR).message) }
  console.log('[updateAktivitaet] OK')
  revalidatePath('/crm')
  revalidatePath('/crm/kontakte/[id]', 'page')
  revalidatePath('/crm/firmen/[id]', 'page')
}


export async function createAktivitaet(formData: FormData) {
  const supabase = await createSupabaseServerClient()
  const tenantId = await getTenantId()
  const ganztags = formData.get('ganztags') !== 'false'
  const payload: AR = {
    tenant_id:    tenantId,
    kontakt_id:   (formData.get('kontakt_id') as string) || null,
    firma_id:     (formData.get('firma_id') as string) || null,
    art:          formData.get('art') as string,
    betreff:      (formData.get('betreff') as string) || null,
    beschreibung: (formData.get('beschreibung') as string) || null,
    datum:        formData.get('datum') as string,
    erledigt:     formData.get('erledigt') === 'true',
    ganztags,
    uhrzeit_von:  ganztags ? null : ((formData.get('uhrzeit_von') as string) || null),
    uhrzeit_bis:  ganztags ? null : ((formData.get('uhrzeit_bis') as string) || null),
  }
  const { error } = await (supabase.from('aktivitaeten') as any).insert(payload)
  if (error) throw new Error((error as AR).message)
  revalidatePath('/crm')
  revalidatePath('/crm/kontakte')
  revalidatePath('/crm/firmen')
  revalidatePath('/crm/kontakte/[id]', 'page')
  revalidatePath('/crm/firmen/[id]', 'page')
}

export async function updateAktivitaet(id: string, formData: FormData) {
  console.log('[updateAktivitaet] id:', id, 'art:', formData.get('art'))
  const supabase = await createSupabaseServerClient()
  const ganztags = formData.get('ganztags') !== 'false'
  const payload: AR = {
    art:          formData.get('art') as string,
    betreff:      (formData.get('betreff') as string) || null,
    beschreibung: (formData.get('beschreibung') as string) || null,
    datum:        formData.get('datum') as string,
    erledigt:     formData.get('erledigt') === 'true',
    ganztags,
    uhrzeit_von:  ganztags ? null : ((formData.get('uhrzeit_von') as string) || null),
    uhrzeit_bis:  ganztags ? null : ((formData.get('uhrzeit_bis') as string) || null),
  }
  const { error } = await (supabase.from('aktivitaeten') as any).update(payload).eq('id', id)
  if (error) throw new Error((error as AR).message)
  revalidatePath('/crm')
  revalidatePath('/crm/kontakte/[id]', 'page')
  revalidatePath('/crm/firmen/[id]', 'page')
}

export async function deleteAktivitaet(id: string) {
  const supabase = await createSupabaseServerClient()
  const { error } = await (supabase.from('aktivitaeten') as any).delete().eq('id', id)
  if (error) throw new Error((error as AR).message)
  revalidatePath('/crm')
  revalidatePath('/crm/kontakte/[id]', 'page')
  revalidatePath('/crm/firmen/[id]', 'page')
}

export async function toggleAktivitaetErledigt(id: string, erledigt: boolean) {
  const supabase = await createSupabaseServerClient()
  const { error } = await (supabase.from('aktivitaeten') as any)
    .update({ erledigt })
    .eq('id', id)
  if (error) throw new Error((error as AR).message)
  revalidatePath('/crm')
  revalidatePath('/crm/kontakte/[id]', 'page')
  revalidatePath('/crm/firmen/[id]', 'page')
}

// ── Pipeline ──────────────────────────────────────────────────────────────────

export async function createPipelineEintrag(formData: FormData) {
  const supabase = await createSupabaseServerClient()
  const tenantId = await getTenantId()
  const ganztags = formData.get('ganztags') !== 'false'
  const payload: AR = {
    tenant_id:           tenantId,
    titel:               formData.get('titel') as string,
    stufe:               formData.get('stufe') as string,
    kontakt_id:          (formData.get('kontakt_id') as string) || null,
    firma_id:            (formData.get('firma_id') as string) || null,
    kategorie:           (formData.get('kategorie') as string) || null,
    wert_euro:           parseFloat(formData.get('wert_euro') as string) || null,
    wahrscheinlichkeit:  parseInt(formData.get('wahrscheinlichkeit') as string) || null,
    erwartetes_datum:    (formData.get('erwartetes_datum') as string) || null,
    notizen:             (formData.get('notizen') as string) || null,
    ganztags,
    uhrzeit_von:         ganztags ? null : ((formData.get('uhrzeit_von') as string) || null),
    uhrzeit_bis:         ganztags ? null : ((formData.get('uhrzeit_bis') as string) || null),
  }
  const { error } = await (supabase.from('pipeline_eintraege') as any).insert(payload)
  if (error) throw new Error((error as AR).message)
  revalidatePath('/crm')
  revalidatePath('/crm/pipeline')
  revalidatePath('/crm/kontakte/[id]', 'page')
  revalidatePath('/crm/firmen/[id]', 'page')
}

export async function updatePipelineStufe(id: string, stufe: string) {
  const supabase = await createSupabaseServerClient()
  const { error } = await (supabase.from('pipeline_eintraege') as any)
    .update({ stufe, aktualisiert_am: new Date().toISOString() })
    .eq('id', id)
  if (error) throw new Error((error as AR).message)
  revalidatePath('/crm/pipeline')
}

export async function togglePipelineErledigt(id: string, erledigt: boolean) {
  const supabase = await createSupabaseServerClient()
  const { error } = await (supabase.from('pipeline_eintraege') as any)
    .update({
      erledigt,
      erledigt_am:     erledigt ? new Date().toISOString() : null,
      aktualisiert_am: new Date().toISOString(),
    })
    .eq('id', id)
  if (error) throw new Error((error as AR).message)
  revalidatePath('/crm/pipeline')
  revalidatePath('/crm/kontakte/[id]', 'page')
  revalidatePath('/crm/firmen/[id]', 'page')
}

export async function updatePipelineEintrag(id: string, formData: FormData) {
  const supabase = await createSupabaseServerClient()
  const ganztags = formData.get('ganztags') !== 'false'
  const payload: AR = {
    titel:               formData.get('titel') as string,
    stufe:               formData.get('stufe') as string,
    kontakt_id:          (formData.get('kontakt_id') as string) || null,
    firma_id:            (formData.get('firma_id') as string) || null,
    kategorie:           (formData.get('kategorie') as string) || null,
    wert_euro:           parseFloat(formData.get('wert_euro') as string) || null,
    wahrscheinlichkeit:  parseInt(formData.get('wahrscheinlichkeit') as string) || null,
    erwartetes_datum:    (formData.get('erwartetes_datum') as string) || null,
    notizen:             (formData.get('notizen') as string) || null,
    ganztags,
    uhrzeit_von:         ganztags ? null : ((formData.get('uhrzeit_von') as string) || null),
    uhrzeit_bis:         ganztags ? null : ((formData.get('uhrzeit_bis') as string) || null),
    aktualisiert_am:     new Date().toISOString(),
  }
  const { error } = await (supabase.from('pipeline_eintraege') as any).update(payload).eq('id', id)
  if (error) throw new Error((error as AR).message)
  revalidatePath('/crm/pipeline')
}

export async function deletePipelineEintrag(id: string) {
  const supabase = await createSupabaseServerClient()
  const { error } = await (supabase.from('pipeline_eintraege') as any).delete().eq('id', id)
  if (error) throw new Error((error as AR).message)
  revalidatePath('/crm/pipeline')
}
