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

async function createZukaufCharge(
  supabase: any,
  tenantId: string,
  behaelterId: string,
  rebsorte: string | null,
  jahrgang: number | null,
  menge: number,
  einstandspreisProLiter: number | null,
  weinart: string | null,
  qualitaetsstufe: string | null,
): Promise<string> {
  const name = rebsorte || 'Zukauf'
  const { data: neu, error } = await (supabase.from('weinausbau') as any)
    .insert({
      tenant_id:   tenantId,
      name,
      rebsorte:    rebsorte ?? null,
      behaelter_id: behaelterId,
      jahrgang,
      menge_liter:  menge,
      einstandspreis_pro_liter: einstandspreisProLiter ?? null,
      anfangsbestand_liter: null,
      status:      'ausbau',
      aktiv:       true,
      weinart:     weinart ?? 'unbekannt',
      qualitaetsstufe: qualitaetsstufe ?? null,
    })
    .select('id')
    .single()
  if (error) throw new Error((error as AR).message)
  return (neu as AR).id
}

async function bereinigCharge(supabase: any, weinausbauId: string): Promise<void> {
  const [{ count: umzugCount }, { count: fuellungCount }] = await Promise.all([
    (supabase.from('keller_umzuege') as any)
      .select('id', { count: 'exact', head: true })
      .or(`von_weinausbau_id.eq.${weinausbauId},nach_weinausbau_id.eq.${weinausbauId}`),
    (supabase.from('fuellungen') as any)
      .select('id', { count: 'exact', head: true })
      .eq('weinausbau_id', weinausbauId),
  ])
  if ((umzugCount ?? 0) > 0 || (fuellungCount ?? 0) > 0) {
    await (supabase.from('weinausbau') as any)
      .update({ menge_liter: 0, status: 'abgeschlossen' })
      .eq('id', weinausbauId)
  } else {
    await (supabase.from('weinausbau') as any)
      .update({ aktiv: false, status: 'abgeschlossen' })
      .eq('id', weinausbauId)
  }
}

function parseZukaufFormData(formData: FormData) {
  return {
    datum:               (formData.get('datum')                    as string) || new Date().toISOString().split('T')[0],
    lieferungUhrzeit:    (formData.get('lieferung_uhrzeit')        as string)?.trim() || null,
    art:                 (formData.get('art')                      as string) || 'wein',
    lieferantKontaktId:  (formData.get('lieferant_kontakt_id')     as string) || null,
    lieferantFirmaId:    (formData.get('lieferant_firma_id')       as string) || null,
    zugmaschine:         (formData.get('transport_zugmaschine')    as string)?.trim() || null,
    anhaenger1:          (formData.get('transport_anhaenger1')     as string)?.trim() || null,
    anhaenger2:          (formData.get('transport_anhaenger2')     as string)?.trim() || null,
    weinart:             (formData.get('weinart')                  as string) || 'unbekannt',
    rebsorte:            (formData.get('rebsorte')                 as string)?.trim() || null,
    qualitaetsstufe:     (formData.get('qualitaetsstufe')          as string)?.trim() || null,
    jahrgang:            parseInt(formData.get('jahrgang')         as string) || null,
    herkunft:            (formData.get('herkunft')                 as string)?.trim() || null,
    anreicherung:        formData.get('anreicherung') === 'true',
    kmw:                 parseFloat(formData.get('kmw')            as string) || null,
    alkohol:             parseFloat(formData.get('alkohol_pct')    as string) || null,
    pruefnummer:         (formData.get('staatliche_pruefnummer')   as string)?.trim() || null,
    menge:               parseFloat(formData.get('menge')          as string) || 0,
    einheit:             (formData.get('einheit')                  as string) || 'kg',
    preisGesamt:         parseFloat(formData.get('preis_gesamt')   as string) || null,
    einstandspreisLiter: parseFloat(formData.get('einstandspreis_pro_liter') as string) || null,
    notizen:             (formData.get('notizen')                  as string)?.trim() || null,
    zielBehaelterId:     (formData.get('ziel_behaelter_id')        as string) || null,
  }
}

export async function createZukauf(formData: FormData) {
  const supabase = await createSupabaseServerClient()
  const tenantId = await getTenantId()
  const f = parseZukaufFormData(formData)

  if (f.menge <= 0) throw new Error('Menge muss größer als 0 sein')

  let zielWeinausbauId: string | null = null
  if ((f.art === 'wein' || f.art === 'most') && f.zielBehaelterId) {
    zielWeinausbauId = await createZukaufCharge(
      supabase, tenantId, f.zielBehaelterId, f.rebsorte, f.jahrgang, f.menge, f.einstandspreisLiter, f.weinart, f.qualitaetsstufe,
    )
  }

  const { error } = await (supabase.from('zukauf_posten') as any)
    .insert({
      tenant_id:                tenantId,
      datum:                    f.datum,
      lieferung_uhrzeit:        f.lieferungUhrzeit,
      art:                      f.art,
      lieferant_kontakt_id:     f.lieferantKontaktId || null,
      lieferant_firma_id:       f.lieferantFirmaId   || null,
      transport_zugmaschine:    f.zugmaschine,
      transport_anhaenger1:     f.anhaenger1,
      transport_anhaenger2:     f.anhaenger2,
      weinart:                  f.weinart,
      rebsorte:                 f.rebsorte,
      qualitaetsstufe:          f.qualitaetsstufe,
      jahrgang:                 f.jahrgang,
      herkunft:                 f.herkunft,
      anreicherung:             f.anreicherung,
      kmw:                      f.kmw,
      alkohol_pct:              f.alkohol,
      staatliche_pruefnummer:   f.pruefnummer,
      menge:                    f.menge,
      einheit:                  f.einheit,
      preis_gesamt:             f.preisGesamt ?? null,
      einstandspreis_pro_liter: f.einstandspreisLiter ?? null,
      notizen:                  f.notizen,
      ziel_weinausbau_id:       zielWeinausbauId,
    })

  if (error) throw new Error((error as AR).message)

  revalidatePath('/weinhandel/zukauf')
  revalidatePath('/weinhandel')
  revalidatePath('/kellerbuch')

  if (zielWeinausbauId && f.zielBehaelterId && f.rebsorte) {
    // Prüfung 1: Andere Rebsorte im Gebinde → Verschneidung (Sortenverschnitt)
    const { data: andereRebsorte } = await (supabase.from('weinausbau') as any)
      .select('id')
      .eq('behaelter_id', f.zielBehaelterId)
      .eq('aktiv', true)
      .neq('id', zielWeinausbauId)
      .neq('rebsorte', f.rebsorte)
      .limit(1)
    if ((andereRebsorte as any[])?.length > 0) {
      const existierendeId = (andereRebsorte as any[])[0].id
      redirect(`/kellerbuch/weinausbau/${existierendeId}?form=verschneiden&quelle=${zielWeinausbauId}&menge=${f.menge}`)
    }

    // Prüfung 2: Gleiche Rebsorte, andere Qualitätsstufe → Verschneidung (ggf. Abstufung)
    if (f.qualitaetsstufe) {
      const { data: gleicheRebsorte } = await (supabase.from('weinausbau') as any)
        .select('id, qualitaetsstufe')
        .eq('behaelter_id', f.zielBehaelterId)
        .eq('aktiv', true)
        .neq('id', zielWeinausbauId)
        .eq('rebsorte', f.rebsorte)
        .not('qualitaetsstufe', 'is', null)
        .limit(10)
      const treffer = ((gleicheRebsorte as any[]) ?? []).find(
        (c: any) => c.qualitaetsstufe !== f.qualitaetsstufe
      )
      if (treffer) {
        redirect(`/kellerbuch/weinausbau/${treffer.id}?form=verschneiden&quelle=${zielWeinausbauId}&menge=${f.menge}`)
      }
    }
  }

  redirect('/weinhandel/zukauf')
}

export async function updateZukauf(id: string, formData: FormData) {
  const supabase = await createSupabaseServerClient()
  const tenantId = await getTenantId()
  const f = parseZukaufFormData(formData)

  if (f.menge <= 0) throw new Error('Menge muss größer als 0 sein')

  const { data: alt } = await (supabase.from('zukauf_posten') as any)
    .select('ziel_weinausbau_id')
    .eq('id', id)
    .single()
  const altWeinausbauId: string | null = (alt as AR | null)?.ziel_weinausbau_id ?? null

  let zielWeinausbauId: string | null = altWeinausbauId

  if ((f.art === 'wein' || f.art === 'most') && f.zielBehaelterId) {
    if (altWeinausbauId) await bereinigCharge(supabase, altWeinausbauId)
    zielWeinausbauId = await createZukaufCharge(
      supabase, tenantId, f.zielBehaelterId, f.rebsorte, f.jahrgang, f.menge, f.einstandspreisLiter, f.weinart, f.qualitaetsstufe,
    )
  } else if (!(f.art === 'wein' || f.art === 'most')) {
    if (altWeinausbauId) await bereinigCharge(supabase, altWeinausbauId)
    zielWeinausbauId = null
  }

  const { error } = await (supabase.from('zukauf_posten') as any).update({
    datum:                    f.datum,
    lieferung_uhrzeit:        f.lieferungUhrzeit,
    art:                      f.art,
    lieferant_kontakt_id:     f.lieferantKontaktId || null,
    lieferant_firma_id:       f.lieferantFirmaId   || null,
    transport_zugmaschine:    f.zugmaschine,
    transport_anhaenger1:     f.anhaenger1,
    transport_anhaenger2:     f.anhaenger2,
    weinart:                  f.weinart,
    rebsorte:                 f.rebsorte,
    qualitaetsstufe:          f.qualitaetsstufe,
    jahrgang:                 f.jahrgang,
    herkunft:                 f.herkunft,
    anreicherung:             f.anreicherung,
    kmw:                      f.kmw,
    alkohol_pct:              f.alkohol,
    staatliche_pruefnummer:   f.pruefnummer,
    menge:                    f.menge,
    einheit:                  f.einheit,
    preis_gesamt:             f.preisGesamt ?? null,
    einstandspreis_pro_liter: f.einstandspreisLiter ?? null,
    notizen:                  f.notizen,
    ziel_weinausbau_id:       zielWeinausbauId,
  }).eq('id', id)

  if (error) throw new Error((error as AR).message)

  revalidatePath('/weinhandel/zukauf')
  revalidatePath('/weinhandel')
  revalidatePath('/kellerbuch')
  redirect('/weinhandel/zukauf')
}

export async function deleteZukauf(id: string) {
  const supabase = await createSupabaseServerClient()

  const { data: zukauf } = await (supabase.from('zukauf_posten') as any)
    .select('ziel_weinausbau_id')
    .eq('id', id)
    .single()
  const weinausbauId: string | null = (zukauf as AR | null)?.ziel_weinausbau_id ?? null

  const { error } = await (supabase.from('zukauf_posten') as any)
    .update({ aktiv: false })
    .eq('id', id)
  if (error) throw new Error((error as AR).message)

  if (weinausbauId) await bereinigCharge(supabase, weinausbauId)

  revalidatePath('/weinhandel/zukauf')
  revalidatePath('/weinhandel')
  revalidatePath('/kellerbuch')
}
