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

export async function createBehandlung(formData: FormData) {
  const supabase = await createSupabaseServerClient()
  const tenantId = await getTenantId()

  // Weingarten-IDs aus Checkboxen
  const weingartenIds = formData.getAll('weingarten_ids') as string[]
  if (weingartenIds.length === 0) throw new Error('Mindestens einen Weingarten auswählen')

  const datum           = formData.get('datum') as string
  const datumBis        = (formData.get('datum_bis') as string) || null
  const art             = (formData.get('art') as string) || 'spritzung'
  const psmId           = (formData.get('psm_id') as string) || null
  const wartezeit       = formData.get('wartezeit_tage') ? Number(formData.get('wartezeit_tage')) : null
  const aufwandmenge    = formData.get('aufwandmenge') ? Number(formData.get('aufwandmenge')) : null
  const aufwandEinheit  = (formData.get('aufwandmenge_einheit') as string) || null
  const mengeGesamt     = formData.get('menge_gesamt') ? Number(formData.get('menge_gesamt')) : null
  const mengeEinheit    = (formData.get('menge_einheit') as string) || null
  const konzentration   = formData.get('konzentration') ? Number(formData.get('konzentration')) : null
  const wasseraufwand   = formData.get('wasseraufwand_l_ha') ? Number(formData.get('wasseraufwand_l_ha')) : null
  const bbch            = (formData.get('bbch_stadium') as string) || null
  const schaderreger    = (formData.get('schaderreger') as string) || null
  const witterung       = (formData.get('witterung') as string) || null
  const temperatur      = formData.get('temperatur_c') ? Number(formData.get('temperatur_c')) : null
  const notizen         = (formData.get('notizen') as string) || null

  // Frühester Erntetermin berechnen
  let ernteFruehesteins: string | null = null
  if (datum && wartezeit != null) {
    const d = new Date(datum)
    d.setDate(d.getDate() + wartezeit)
    ernteFruehesteins = d.toISOString().split('T')[0]
  }

  // 1. Behandlung anlegen
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: beh, error: behErr } = await (supabase.from('behandlungen') as any)
    .insert({
      tenant_id:            tenantId,
      art,
      psm_id:               psmId,
      datum,
      datum_bis:            datumBis,
      aufwandmenge,
      aufwandmenge_einheit: aufwandEinheit,
      menge_gesamt:         mengeGesamt,
      menge_einheit:        mengeEinheit,
      konzentration,
      wasseraufwand_l_ha:   wasseraufwand,
      bbch_stadium:         bbch,
      schaderreger,
      witterung,
      temperatur_c:         temperatur,
      ernte_fruehesteins:   ernteFruehesteins,
      notizen,
    })
    .select('id')
    .single()

  if (behErr) throw new Error((behErr as AR).message)
  const behandlungId = (beh as AR).id

  // 2. Aktive Grundstücke der ausgewählten Weingärten holen (mit flaeche_ha)
  //    Brache + Gerodet werden automatisch übersprungen
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: grundstuecke, error: gErr } = await (supabase.from('grundstuecke') as any)
    .select('id, flaeche_ha')
    .in('weingarten_id', weingartenIds)
    .eq('status', 'aktiv')

  if (gErr) throw new Error((gErr as AR).message)

  // 3. Junction-Records anlegen (aktive Grundstücke + flaeche_ha Snapshot)
  if (grundstuecke && grundstuecke.length > 0) {
    const junctionRows = (grundstuecke as AR[]).map(g => ({
      behandlung_id:  behandlungId,
      grundstueck_id: g.id,
      flaeche_ha:     g.flaeche_ha ?? null,
    }))
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: jErr } = await (supabase.from('behandlung_grundstuecke') as any).insert(junctionRows)
    if (jErr) throw new Error((jErr as AR).message)
  }

  revalidatePath('/behandlungen')
}

export async function updateBehandlung(id: string, formData: FormData) {
  const supabase = await createSupabaseServerClient()

  const datum          = formData.get('datum') as string
  const datumBis       = (formData.get('datum_bis') as string) || null
  const art            = (formData.get('art') as string) || 'spritzung'
  const psmId          = (formData.get('psm_id') as string) || null
  const wartezeit      = formData.get('wartezeit_tage') ? Number(formData.get('wartezeit_tage')) : null
  const aufwandmenge   = formData.get('aufwandmenge') ? Number(formData.get('aufwandmenge')) : null
  const aufwandEinheit = (formData.get('aufwandmenge_einheit') as string) || null
  const mengeGesamt    = formData.get('menge_gesamt') ? Number(formData.get('menge_gesamt')) : null
  const mengeEinheit   = (formData.get('menge_einheit') as string) || null
  const konzentration  = formData.get('konzentration') ? Number(formData.get('konzentration')) : null
  const wasseraufwand  = formData.get('wasseraufwand_l_ha') ? Number(formData.get('wasseraufwand_l_ha')) : null
  const bbch           = (formData.get('bbch_stadium') as string) || null
  const schaderreger   = (formData.get('schaderreger') as string) || null
  const witterung      = (formData.get('witterung') as string) || null
  const temperatur     = formData.get('temperatur_c') ? Number(formData.get('temperatur_c')) : null
  const notizen        = (formData.get('notizen') as string) || null

  let ernteFruehesteins: string | null = null
  if (datum && wartezeit != null) {
    const d = new Date(datum)
    d.setDate(d.getDate() + wartezeit)
    ernteFruehesteins = d.toISOString().split('T')[0]
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.from('behandlungen') as any)
    .update({
      art, psm_id: psmId, datum, datum_bis: datumBis,
      aufwandmenge, aufwandmenge_einheit: aufwandEinheit,
      menge_gesamt: mengeGesamt, menge_einheit: mengeEinheit,
      konzentration, wasseraufwand_l_ha: wasseraufwand,
      bbch_stadium: bbch, schaderreger, witterung, temperatur_c: temperatur,
      ernte_fruehesteins: ernteFruehesteins, notizen,
    })
    .eq('id', id)
  if (error) throw new Error((error as AR).message)
  revalidatePath('/behandlungen')
  revalidatePath('/behandlungen/berichte')
}

export async function deleteBehandlung(id: string) {
  const supabase = await createSupabaseServerClient()
  // CASCADE löscht behandlung_grundstuecke automatisch mit
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.from('behandlungen') as any).delete().eq('id', id)
  if (error) throw new Error((error as AR).message)
  revalidatePath('/behandlungen')
}
