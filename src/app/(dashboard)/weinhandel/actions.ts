'use server'

import { createSupabaseServerClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { istNiedrigerAls, QUALITAET_LABEL } from '@/lib/weinqualitaet'
import { istNiedrigerAls as herkunftIstNiedrigerAls, HERKUNFT_LABEL } from '@/lib/herkunft'
import { getCurrentMembership } from '@/lib/auth/roles'
import { AktionsFehler } from '@/lib/fehler'
import { dezimal } from '@/lib/format'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AR = Record<string, any>

async function getTenantId(): Promise<string> {
  const membership = await getCurrentMembership()
  if (!membership) throw new AktionsFehler('Kein aktiver Mandant gefunden')
  return membership.tenantId
}

// Neue Fuellung anlegen

export async function createFuellung(formData: FormData) {
  const supabase  = await createSupabaseServerClient()
  const tenantId  = await getTenantId()

  const weinausbauId    = (formData.get('weinausbau_id') as string) || null
  const anzahl          = parseInt(dezimal(formData.get('anzahl_flaschen') as string))
  const flGroesseML     = parseInt(dezimal(formData.get('flaschengroesse_ml') as string)) || 750
  const mengeFormular   = parseFloat(dezimal(formData.get('menge_liter_gefuellt') as string)) || null
  // Falls kein Literfeld ausgefuellt: aus Flaschenzahl berechnen
  const mengeGefuellt   = mengeFormular ?? (anzahl * flGroesseML / 1000)

  const qualitaetInput     = (formData.get('qualitaet') as string) || null
  const herkunftCodeInput  = (formData.get('herkunft_code') as string) || null
  let notizenZusatz = ''

  // Bestandspruefung: nicht mehr fuellen als vorhanden
  // + Downgrade-only-Pruefung: 'Qualitätswein' und 'Herkunft-Code (BKI)' dürfen beim Füllen nur
  // abgestuft, NIEMALS aufgestuft werden gegenüber der verknüpften Kellerbuch-Charge (hart blockiert).
  if (weinausbauId) {
    const { data: wa } = await (supabase.from('weinausbau') as any)
      .select('menge_liter, status, qualitaetsstufe, herkunft_code')
      .eq('id', weinausbauId)
      .eq('tenant_id', tenantId)
      .single()
    const verfuegbar = parseFloat((wa as AR | null)?.menge_liter ?? '0') || 0
    // Toleranz = eine Flaschengröße (Rundung beim Abfüllen)
    if (mengeGefuellt > verfuegbar + (flGroesseML / 1000)) {
      throw new AktionsFehler(`Abfüllmenge (${mengeGefuellt} L) übersteigt verfügbaren Bestand (${verfuegbar} L)`)
    }

    const chargeQualitaet = (wa as AR | null)?.qualitaetsstufe as string | null ?? null
    const chargeHerkunft  = (wa as AR | null)?.herkunft_code as string | null ?? null

    if (qualitaetInput && chargeQualitaet && istNiedrigerAls(chargeQualitaet, qualitaetInput)) {
      throw new AktionsFehler(
        `Qualitätswein kann nicht von ${QUALITAET_LABEL[chargeQualitaet] ?? chargeQualitaet} auf ${QUALITAET_LABEL[qualitaetInput] ?? qualitaetInput} AUFgestuft werden. Nur Abstufungen sind zulässig.`
      )
    }
    if (herkunftCodeInput && chargeHerkunft && herkunftIstNiedrigerAls(chargeHerkunft, herkunftCodeInput)) {
      throw new AktionsFehler(
        `Herkunft-Code (BKI) kann nicht von ${HERKUNFT_LABEL[chargeHerkunft] ?? chargeHerkunft} auf ${HERKUNFT_LABEL[herkunftCodeInput] ?? herkunftCodeInput} AUFgestuft werden. Nur Abstufungen sind zulässig.`
      )
    }
    if (qualitaetInput && chargeQualitaet && qualitaetInput !== chargeQualitaet && istNiedrigerAls(qualitaetInput, chargeQualitaet)) {
      notizenZusatz += `Qualität manuell abgestuft von ${QUALITAET_LABEL[chargeQualitaet] ?? chargeQualitaet} auf ${QUALITAET_LABEL[qualitaetInput] ?? qualitaetInput}. `
    }
    if (herkunftCodeInput && chargeHerkunft && herkunftCodeInput !== chargeHerkunft && herkunftIstNiedrigerAls(herkunftCodeInput, chargeHerkunft)) {
      notizenZusatz += `Herkunft-Code (BKI) manuell abgestuft von ${HERKUNFT_LABEL[chargeHerkunft] ?? chargeHerkunft} auf ${HERKUNFT_LABEL[herkunftCodeInput] ?? herkunftCodeInput}. `
    }
  }

  const notizenInput = (formData.get('notizen') as string) || null
  const notizen = notizenZusatz ? [notizenInput, notizenZusatz.trim()].filter(Boolean).join('\n') : notizenInput

  const payload: AR = {
    tenant_id:            tenantId,
    weinausbau_id:        weinausbauId,
    name:                 formData.get('name') as string,
    jahrgang:             parseInt(dezimal(formData.get('jahrgang') as string)) || null,
    rebsorte:             (formData.get('rebsorte') as string) || null,
    qualitaet:            formData.get('qualitaet') as string,
    herkunft_code:        herkunftCodeInput,
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
    vk_preis_brutto:      parseFloat(dezimal(formData.get('vk_preis_brutto') as string)) || null,
    einstandspreis:       parseFloat(dezimal(formData.get('einstandspreis') as string)) || null,
    zolltarifnummer:      (formData.get('zolltarifnummer') as string) || null,
    notizen:              notizen,
  }

  const { error, data: fuellungData } = await (supabase.from('fuellungen') as any)
    .insert(payload).select('id').single()
  if (error) throw new AktionsFehler((error as AR).message)

  // fuellung_chargen: Charge-Verknüpfung anlegen
  if (weinausbauId && fuellungData?.id) {
    { const { error: e } = await (supabase.from('fuellung_chargen') as any).insert({
      tenant_id:     tenantId,
      fuellung_id:   fuellungData.id,
      weinausbau_id: weinausbauId,
      anteil_liter:  mengeGefuellt,
    })
      if (e) throw new AktionsFehler(`Speichern fehlgeschlagen (fuellung_chargen): ${e.message}`) }
  }

  // Weinausbau: Liter abziehen + Status aktualisieren
  if (weinausbauId) {
    const { data: wa } = await (supabase.from('weinausbau') as any)
      .select('menge_liter, behaelter_id')
      .eq('id', weinausbauId)
      .eq('tenant_id', tenantId)
      .single()
    const aktuell        = parseFloat((wa as AR | null)?.menge_liter ?? '0') || 0
    const behaelterId    = (wa as AR | null)?.behaelter_id as string | null
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
      .eq('tenant_id', tenantId)

    // Schwund automatisch ausbuchen wenn Charge abgeschlossen und Restmenge > 0
    if (wirdAbgeschlossen && neuMenge > 0.01 && behaelterId) {
      { const { error: e } = await (supabase.from('keller_umzuege') as any).insert({
        tenant_id:         tenantId,
        von_weinausbau_id: weinausbauId,
        nach_behaelter_id: behaelterId,
        menge_liter:       0,
        brutto_liter:      neuMenge,
        schwund_liter:     neuMenge,
        datum:             payload.datum,
        umzug_typ:         'schwund',
        notizen:           'Schwund bei Abfüllung',
      })
        if (e) throw new AktionsFehler(`Speichern fehlgeschlagen (keller_umzuege): ${e.message}`) }
    }
  }

  revalidatePath('/weinhandel')
  revalidatePath('/kellerbuch')
  return { id: (fuellungData as AR).id as string }
}

// Fuellung bearbeiten

export async function updateFuellung(id: string, formData: FormData) {
  const supabase = await createSupabaseServerClient()
  const tenantId  = await getTenantId()

  const anzahl = parseInt(dezimal(formData.get('anzahl_flaschen') as string))
  const weinausbauId     = (formData.get('weinausbau_id') as string) || null
  const qualitaetInput    = (formData.get('qualitaet') as string) || null
  const herkunftCodeInput = (formData.get('herkunft_code') as string) || null
  let notizenZusatz = ''

  // Downgrade-only-Pruefung wie bei createFuellung: 'Qualitätswein' und 'Herkunft-Code (BKI)'
  // dürfen beim Bearbeiten einer Füllung nur abgestuft, nie aufgestuft werden (hart blockiert).
  if (weinausbauId) {
    const { data: wa } = await (supabase.from('weinausbau') as any)
      .select('qualitaetsstufe, herkunft_code')
      .eq('id', weinausbauId)
      .eq('tenant_id', tenantId)
      .single()
    const chargeQualitaet = (wa as AR | null)?.qualitaetsstufe as string | null ?? null
    const chargeHerkunft  = (wa as AR | null)?.herkunft_code as string | null ?? null

    if (qualitaetInput && chargeQualitaet && istNiedrigerAls(chargeQualitaet, qualitaetInput)) {
      throw new AktionsFehler(
        `Qualitätswein kann nicht von ${QUALITAET_LABEL[chargeQualitaet] ?? chargeQualitaet} auf ${QUALITAET_LABEL[qualitaetInput] ?? qualitaetInput} AUFgestuft werden. Nur Abstufungen sind zulässig.`
      )
    }
    if (herkunftCodeInput && chargeHerkunft && herkunftIstNiedrigerAls(chargeHerkunft, herkunftCodeInput)) {
      throw new AktionsFehler(
        `Herkunft-Code (BKI) kann nicht von ${HERKUNFT_LABEL[chargeHerkunft] ?? chargeHerkunft} auf ${HERKUNFT_LABEL[herkunftCodeInput] ?? herkunftCodeInput} AUFgestuft werden. Nur Abstufungen sind zulässig.`
      )
    }
    if (qualitaetInput && chargeQualitaet && qualitaetInput !== chargeQualitaet && istNiedrigerAls(qualitaetInput, chargeQualitaet)) {
      notizenZusatz += `Qualität manuell abgestuft von ${QUALITAET_LABEL[chargeQualitaet] ?? chargeQualitaet} auf ${QUALITAET_LABEL[qualitaetInput] ?? qualitaetInput}. `
    }
    if (herkunftCodeInput && chargeHerkunft && herkunftCodeInput !== chargeHerkunft && herkunftIstNiedrigerAls(herkunftCodeInput, chargeHerkunft)) {
      notizenZusatz += `Herkunft-Code (BKI) manuell abgestuft von ${HERKUNFT_LABEL[chargeHerkunft] ?? chargeHerkunft} auf ${HERKUNFT_LABEL[herkunftCodeInput] ?? herkunftCodeInput}. `
    }
  }

  const notizenInput = (formData.get('notizen') as string) || null
  const notizen = notizenZusatz ? [notizenInput, notizenZusatz.trim()].filter(Boolean).join('\n') : notizenInput

  const payload: AR = {
    name:                 formData.get('name') as string,
    jahrgang:             parseInt(dezimal(formData.get('jahrgang') as string)) || null,
    rebsorte:             (formData.get('rebsorte') as string) || null,
    qualitaet:            formData.get('qualitaet') as string,
    herkunft_code:        herkunftCodeInput,
    anbaugebiet:          (formData.get('anbaugebiet') as string) || null,
    bezeichnung:          (formData.get('bezeichnung') as string) || null,
    datum:                formData.get('datum') as string,
    flaschengroesse_ml:   parseInt(dezimal(formData.get('flaschengroesse_ml') as string)) || 750,
    anzahl_flaschen:      anzahl,
    bestand_flaschen:     parseInt(dezimal(formData.get('bestand_flaschen') as string)) || anzahl,
    menge_liter_gefuellt: parseFloat(dezimal(formData.get('menge_liter_gefuellt') as string)) || null,
    vk_preis_brutto:      parseFloat(dezimal(formData.get('vk_preis_brutto') as string)) || null,
    weinausbau_id:        weinausbauId,
    einstandspreis:       parseFloat(dezimal(formData.get('einstandspreis') as string)) || null,
    zolltarifnummer:      (formData.get('zolltarifnummer') as string) || null,
    notizen:              notizen,
    aktualisiert_am:      new Date().toISOString(),
  }

  const { error } = await (supabase.from('fuellungen') as any).update(payload).eq('id', id).eq('tenant_id', tenantId)
  if (error) throw new AktionsFehler((error as AR).message)
  revalidatePath('/weinhandel')
  redirect('/weinhandel')
}

// Bestand manuell korrigieren

export async function updateFuellungBestand(id: string, bestand: number) {
  const supabase = await createSupabaseServerClient()
  const tenantId  = await getTenantId()
  const { error } = await (supabase.from('fuellungen') as any)
    .update({ bestand_flaschen: bestand, aktualisiert_am: new Date().toISOString() })
    .eq('id', id)
    .eq('tenant_id', tenantId)
  if (error) throw new AktionsFehler((error as AR).message)
  revalidatePath('/weinhandel')
}

// Restmenge einer Weinausbau-Charge als Schwund ausbuchen + Charge abschließen

export async function schwundAusbuchen(fuellungId: string) {
  const supabase = await createSupabaseServerClient()
  const tenantId  = await getTenantId()

  const { data: f } = await (supabase.from('fuellungen') as any)
    .select('weinausbau_id').eq('id', fuellungId).eq('tenant_id', tenantId).single()
  const weinausbauId = (f as AR | null)?.weinausbau_id
  if (!weinausbauId) throw new AktionsFehler('Keine Charge verknüpft')

  const { error } = await (supabase.from('weinausbau') as any)
    .update({ menge_liter: 0, status: 'abgeschlossen', aktiv: false })
    .eq('id', weinausbauId)
    .eq('tenant_id', tenantId)
  if (error) throw new AktionsFehler((error as AR).message)

  revalidatePath('/weinhandel')
  revalidatePath('/kellerbuch')
  redirect('/weinhandel')
}

// Fuellung deaktivieren

export async function deactivateFuellung(id: string) {
  const supabase = await createSupabaseServerClient()
  const tenantId  = await getTenantId()

  // Menge + Charge lesen bevor wir deaktivieren
  const { data: f } = await (supabase.from('fuellungen') as any)
    .select('menge_liter_gefuellt, weinausbau_id').eq('id', id).eq('tenant_id', tenantId).single()
  const menge       = parseFloat((f as AR | null)?.menge_liter_gefuellt ?? '0') || 0
  const weinausbauId = (f as AR | null)?.weinausbau_id as string | null

  const { error } = await (supabase.from('fuellungen') as any)
    .update({ aktiv: false, aktualisiert_am: new Date().toISOString() })
    .eq('id', id)
    .eq('tenant_id', tenantId)
  if (error) throw new AktionsFehler((error as AR).message)

  // Weinausbau-Bestand wiederherstellen
  if (weinausbauId && menge > 0) {
    const { data: wa } = await (supabase.from('weinausbau') as any)
      .select('menge_liter').eq('id', weinausbauId).eq('tenant_id', tenantId).single()
    const aktuell = parseFloat((wa as AR | null)?.menge_liter ?? '0') || 0
    { const { error: e } = await (supabase.from('weinausbau') as any)
      .update({ menge_liter: aktuell + menge })
      .eq('id', weinausbauId)
      .eq('tenant_id', tenantId)
      if (e) throw new AktionsFehler(`Speichern fehlgeschlagen (weinausbau): ${e.message}`) }
  }

  revalidatePath('/weinhandel')
  revalidatePath('/kellerbuch')
}
