'use server'

import { createSupabaseServerClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AR = Record<string, any>

async function getTenantId(): Promise<string> {
  const supabase = await createSupabaseServerClient()
  const { data } = await supabase.from('tenant_memberships').select('tenant_id').limit(1).single()
  const id = (data as AR | null)?.tenant_id
  if (!id) throw new Error('Kein Betrieb gefunden')
  return id
}

// ── Jahrgänge ─────────────────────────────────────────────────────────────────

export async function createJahrgang(formData: FormData) {
  const supabase = await createSupabaseServerClient()
  const tenantId = await getTenantId()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.from('weinjahrgaenge') as any).insert({
    tenant_id:   tenantId,
    jahrgang:    Number(formData.get('jahrgang')),
    ernte_beginn: (formData.get('ernte_beginn') as string) || null,
    ernte_ende:   (formData.get('ernte_ende') as string) || null,
    notizen:      (formData.get('notizen') as string) || null,
  })
  if (error) throw new Error((error as AR).message)
  revalidatePath('/erntemeldung')
}

export async function updateJahrgang(id: string, formData: FormData) {
  const supabase = await createSupabaseServerClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.from('weinjahrgaenge') as any).update({
    ernte_beginn:        (formData.get('ernte_beginn') as string) || null,
    ernte_ende:          (formData.get('ernte_ende') as string) || null,
    qualitaet_gesamt:    (formData.get('qualitaet_gesamt') as string) || null,
    witterungscharakter: (formData.get('witterungscharakter') as string) || null,
    notizen:             (formData.get('notizen') as string) || null,
  }).eq('id', id)
  if (error) throw new Error((error as AR).message)
  revalidatePath('/erntemeldung')
  revalidatePath(`/erntemeldung/${id}`)
}

// ── Ernte-Parzellen ───────────────────────────────────────────────────────────

export async function upsertErnteParzelle(jahrgangId: string, formData: FormData) {
  const supabase = await createSupabaseServerClient()
  const weingartenId = formData.get('weingarten_id') as string
  const mengeKg = formData.get('menge_kg') ? Number(formData.get('menge_kg')) : null
  const mengeHl = mengeKg ? mengeKg / 130 : null  // 1 hl ≈ 130 kg

  const payload: AR = {
    jahrgang_id:    jahrgangId,
    weingarten_id:  weingartenId,
    ernte_datum:    (formData.get('ernte_datum') as string) || null,
    menge_kg:       mengeKg,
    menge_hl:       mengeHl,
    oechsle:        formData.get('oechsle') ? Number(formData.get('oechsle')) : null,
    klosterneuburger: formData.get('klosterneuburger') ? Number(formData.get('klosterneuburger')) : null,
    qualitaetsstufe: (formData.get('qualitaetsstufe') as string) || null,
    lesemethode:    (formData.get('lesemethode') as string) || null,
    notizen:        (formData.get('notizen') as string) || null,
  }

  const existingId = formData.get('existing_id') as string | null
  if (existingId) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase.from('ernte_parzellen') as any).update(payload).eq('id', existingId)
    if (error) throw new Error((error as AR).message)
  } else {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase.from('ernte_parzellen') as any).insert(payload)
    if (error) throw new Error((error as AR).message)
  }
  revalidatePath(`/erntemeldung/${jahrgangId}`)
}

export async function deleteErnteParzelle(id: string, jahrgangId: string) {
  const supabase = await createSupabaseServerClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.from('ernte_parzellen') as any).delete().eq('id', id)
  if (error) throw new Error((error as AR).message)
  revalidatePath(`/erntemeldung/${jahrgangId}`)
}

// ── AMA Meldung ───────────────────────────────────────────────────────────────

export async function createOrUpdateAMAMeldung(jahrgangId: string) {
  const supabase = await createSupabaseServerClient()
  const tenantId = await getTenantId()

  // Ernte-Parzellen laden mit Weingarten+Rebsorte
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: parzellen } = await (supabase.from('ernte_parzellen') as any)
    .select('menge_kg, menge_hl, weingarten:weingarten_id(name, rebsorte, flaeche_ha)')
    .eq('jahrgang_id', jahrgangId)

  const gesamtKg = (parzellen as AR[] ?? []).reduce((s: number, p: AR) => s + (p.menge_kg ?? 0), 0)
  const gesamtHl = gesamtKg / 130

  // Tenant-Daten (Betriebsnummer)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: tenant } = await (supabase.from('tenants') as any)
    .select('name, betriebsnummer, weinbaugebiet').eq('id', tenantId).single()

  // Meldung anlegen oder aktualisieren
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: existing } = await (supabase.from('ama_erntemeldungen') as any)
    .select('id').eq('jahrgang_id', jahrgangId).eq('tenant_id', tenantId).maybeSingle()

  const meldungPayload: AR = {
    tenant_id:       tenantId,
    jahrgang_id:     jahrgangId,
    betriebsnummer:  (tenant as AR)?.betriebsnummer ?? null,
    weinbaugebiet:   (tenant as AR)?.weinbaugebiet ?? null,
    gesamtmenge_kg:  gesamtKg,
    gesamtmenge_hl:  gesamtHl,
    status:          'bereit',
  }

  let meldungId: string
  if (existing) {
    meldungId = (existing as AR).id
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase.from('ama_erntemeldungen') as any).update(meldungPayload).eq('id', meldungId)
    // Positionen löschen und neu aufbauen
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase.from('ama_meldepositionen') as any).delete().eq('meldung_id', meldungId)
  } else {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: neu } = await (supabase.from('ama_erntemeldungen') as any)
      .insert(meldungPayload).select('id').single()
    meldungId = (neu as AR).id
  }

  // Positionen je Rebsorte aggregieren
  const rebsortenMap = new Map<string, AR>()
  for (const p of (parzellen as AR[] ?? [])) {
    const wg = p.weingarten as AR
    const key = wg?.rebsorte ?? 'Unbekannt'
    const curr = rebsortenMap.get(key) ?? { rebsorte_name: key, flaeche_ha: 0, menge_kg: 0 }
    curr.flaeche_ha += wg?.flaeche_ha ?? 0
    curr.menge_kg   += p.menge_kg ?? 0
    rebsortenMap.set(key, curr)
  }

  const positionen = Array.from(rebsortenMap.values()).map(r => ({
    meldung_id:     meldungId,
    rebsorte_name:  r.rebsorte_name,
    flaeche_ha:     r.flaeche_ha,
    menge_kg:       r.menge_kg,
    qualitaetsstufe: 'qualitaetswein',
  }))

  if (positionen.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase.from('ama_meldepositionen') as any).insert(positionen)
  }

  revalidatePath(`/erntemeldung/${jahrgangId}`)
}
