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

// Neue Fuellung anlegen

export async function createFuellung(formData: FormData) {
  const supabase  = await createSupabaseServerClient()
  const tenantId  = await getTenantId()

  const weinausbauId    = (formData.get('weinausbau_id') as string) || null
  const anzahl          = parseInt(formData.get('anzahl_flaschen') as string)
  const flGroesseML     = parseInt(formData.get('flaschengroesse_ml') as string) || 750
  const mengeFormular   = parseFloat(formData.get('menge_liter_gefuellt') as string) || null
  // Falls kein Literfeld ausgefuellt: aus Flaschenzahl berechnen
  const mengeGefuellt   = mengeFormular ?? (anzahl * flGroesseML / 1000)

  // Bestandspruefung: nicht mehr fuellen als vorhanden
  if (weinausbauId) {
    const { data: wa } = await (supabase.from('weinausbau') as any)
      .select('menge_liter, status')
      .eq('id', weinausbauId)
      .single()
    const verfuegbar = parseFloat((wa as AR | null)?.menge_liter ?? '0') || 0
    // Toleranz = eine Flaschengröße (Rundung beim Abfüllen)
    if (mengeGefuellt > verfuegbar + (flGroesseML / 1000)) {
      throw new Error(`Abfüllmenge (${mengeGefuellt} L) übersteigt verfügbaren Bestand (${verfuegbar} L)`)
    }
  }

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
    flaschengroesse_ml:   flGroesseML,
    anzahl_flaschen:      anzahl,
    bestand_flaschen:     anzahl,
    menge_liter_gefuellt: mengeGefuellt,
    pruefnummer:          (formData.get('pruefnummer') as string) || null,
    dac_antrag_id:        (formData.get('dac_antrag_id') as string) || null,
    chargennummer:        await (async () => {
      const manuell = (formData.get('chargennummer') as string) || null
      if (manuell) return manuell
      const { data } = await (supabase.rpc as any)('get_next_chargennummer', { p_tenant_id: tenantId })
      return (data as string) ?? null
    })(),
    vk_preis_brutto:      parseFloat(formData.get('vk_preis_brutto') as string) || null,
    einstandspreis:       parseFloat(formData.get('einstandspreis') as string) || null,
    notizen:              (formData.get('notizen') as string) || null,
  }

  const { error, data: fuellungData } = await (supabase.from('fuellungen') as any)
    .insert(payload).select('id').single()
  if (error) throw new Error((error as AR).message)

  // fuellung_chargen: Charge-Verknüpfung anlegen
  if (weinausbauId && fuellungData?.id) {
    await (supabase.from('fuellung_chargen') as any).insert({
      tenant_id:     tenantId,
      fuellung_id:   fuellungData.id,
      weinausbau_id: weinausbauId,
      anteil_liter:  mengeGefuellt,
    })
  }

  // Weinausbau: Liter abziehen + Status aktualisieren
  if (weinausbauId) {
    const { data: wa } = await (supabase.from('weinausbau') as any)
      .select('menge_liter')
      .eq('id', weinausbauId)
      .single()
    const aktuell        = parseFloat((wa as AR | null)?.menge_liter ?? '0') || 0
    const neuMenge       = Math.max(0, aktuell - mengeGefuellt)
    const abschliessen   = formData.get('abschliessen') === 'true'
    // Charge abschließen wenn: Restwein ≤ 0,01 L ODER explizit angehakt
    const wirdAbgeschlossen = neuMenge <= 0.01 || abschliessen
    const neuStatus      = wirdAbgeschlossen ? 'abgeschlossen' : 'abfuellung'
    const neuAktiv       = !wirdAbgeschlossen
    const finalMenge     = wirdAbgeschlossen ? 0 : neuMenge

    await (supabase.from('weinausbau') as any)
      .update({ menge_liter: finalMenge, status: neuStatus, aktiv: neuAktiv })
      .eq('id', weinausbauId)
  }

  revalidatePath('/weinhandel')
  revalidatePath('/kellerbuch')
  redirect('/weinhandel')
}

// Fuellung bearbeiten

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
    weinausbau_id:        (formData.get('weinausbau_id') as string) || null,
    einstandspreis:       parseFloat(formData.get('einstandspreis') as string) || null,
    notizen:              (formData.get('notizen') as string) || null,
    aktualisiert_am:      new Date().toISOString(),
  }

  const { error } = await (supabase.from('fuellungen') as any).update(payload).eq('id', id)
  if (error) throw new Error((error as AR).message)
  revalidatePath('/weinhandel')
  redirect('/weinhandel')
}

// Bestand manuell korrigieren

export async function updateFuellungBestand(id: string, bestand: number) {
  const supabase = await createSupabaseServerClient()
  const { error } = await (supabase.from('fuellungen') as any)
    .update({ bestand_flaschen: bestand, aktualisiert_am: new Date().toISOString() })
    .eq('id', id)
  if (error) throw new Error((error as AR).message)
  revalidatePath('/weinhandel')
}

// Fuellung deaktivieren

export async function deactivateFuellung(id: string) {
  const supabase = await createSupabaseServerClient()
  const { error } = await (supabase.from('fuellungen') as any)
    .update({ aktiv: false, aktualisiert_am: new Date().toISOString() })
    .eq('id', id)
  if (error) throw new Error((error as AR).message)
  revalidatePath('/weinhandel')
}
