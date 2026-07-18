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


function parseDecimal(val: FormDataEntryValue | null): number | null {
  if (!val) return null
  const s = (val as string).replace(',', '.')
  const n = Number(s)
  return isNaN(n) ? null : n
}

// Optionale Kosten-Vorschlagsfunktion: legt (best effort) einen Kosteneintrag +
// anteilige Weingarten-Splits an, wenn im Formular "Kosten erfassen" aktiviert wurde.
// Scheitert dieser Teil, wird die Behandlung trotzdem gespeichert (kein Blocker).
async function ggfKostenEintragAnlegen(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  tenantId: string,
  formData: FormData,
  datum: string,
  // Fläche je betroffenem Weingarten (aggregiert aus Ried- und GST-Einzelauswahl)
  haByWeingarten: Map<string, number>,
) {
  if (formData.get('kosten_aktiv') !== 'on') return
  const kostenartId = (formData.get('kosten_kostenart_id') as string) || null
  const betrag = parseDecimal(formData.get('kosten_betrag'))
  const beschreibung = (formData.get('kosten_beschreibung') as string) || null
  if (!betrag || betrag <= 0 || haByWeingarten.size === 0) return

  try {
    const { data: transaktionsNr } = await (supabase.rpc as any)('get_next_transaktionsnr', {
      p_tenant_id: tenantId, p_typ: 'kosteneintrag',
    })

    const { data: eintrag, error: keErr } = await (supabase.from('kosteneintraege') as any)
      .insert({
        tenant_id:       tenantId,
        transaktions_nr: transaktionsNr ?? null,
        kostenstelle_id: null,
        kostenart_id:    kostenartId,
        datum,
        betrag,
        beschreibung:    beschreibung ?? 'Maßnahme (automatisch vorgeschlagen)',
        periode:         datum?.slice(0, 7) ?? null,
        objekt_typ:      'weingarten',
        weingarten_id:   null,
        behaelter_id:    null,
      })
      .select('id')
      .single()
    if (keErr) throw keErr

    const gesamtHa = Array.from(haByWeingarten.values()).reduce((s, h) => s + h, 0)
    if (gesamtHa > 0) {
      const splitRows = Array.from(haByWeingarten.entries()).map(([weingartenId, ha]) => {
        const pct = Math.round((ha / gesamtHa) * 10000) / 100
        return {
          kosteneintrag_id: (eintrag as AR).id,
          weingarten_id:    weingartenId,
          anteil_pct:       pct,
          betrag_anteil:    Math.round(betrag * pct / 100 * 100) / 100,
        }
      })
      await (supabase.from('kosteneintrag_weingaerten') as any).insert(splitRows)
    }

    revalidatePath('/controlling/kostenrechnung')
  } catch {
    // Kosten-Vorschlag ist optional/best effort – die Maßnahme selbst bleibt gültig.
  }
}

export async function createBehandlung(formData: FormData) {
  const supabase = await createSupabaseServerClient()
  const tenantId = await getTenantId()

  // Weingarten-IDs (ganze Rieden) und Grundstück-IDs (einzelne GST) aus Checkboxen
  const weingartenIds = formData.getAll('weingarten_ids') as string[]
  const grundstueckIds = formData.getAll('grundstueck_ids') as string[]
  if (weingartenIds.length === 0 && grundstueckIds.length === 0) {
    throw new Error('Mindestens eine Ried oder ein Grundstück auswählen')
  }

  const datum           = formData.get('datum') as string
  const datumBis        = (formData.get('datum_bis') as string) || null
  const art             = (formData.get('art') as string) || 'spritzung'
  const psmId           = (formData.get('psm_id') as string) || null
  const duengemittelId  = (formData.get('duengemittel_id') as string) || null
  const wartezeit       = formData.get('wartezeit_tage') ? Number(formData.get('wartezeit_tage')) : null
  const aufwandmenge    = formData.get('aufwandmenge') ? Number(formData.get('aufwandmenge')) : null
  const aufwandEinheit  = (formData.get('aufwandmenge_einheit') as string) || null
  const mengeGesamt     = formData.get('menge_gesamt') ? Number(formData.get('menge_gesamt')) : null
  const mengeEinheit    = (formData.get('menge_einheit') as string) || null
  const konzentration   = parseDecimal(formData.get('konzentration'))
  const wasseraufwand   = formData.get('wasseraufwand_l_ha') ? Number(formData.get('wasseraufwand_l_ha')) : null
  const bbch            = (formData.get('bbch_stadium') as string) || null
  const schaderreger    = (formData.get('schaderreger') as string) || null
  const witterung       = (formData.get('witterung') as string) || null
  const temperatur      = formData.get('temperatur_c') ? Number(formData.get('temperatur_c')) : null
  const notizen         = (formData.get('notizen') as string) || null
  const bearbeitungstiefe = formData.get('bearbeitungstiefe_cm') ? Number(formData.get('bearbeitungstiefe_cm')) : null
  const bearbeitungsgeraet = (formData.get('bearbeitungsgeraet') as string) || null
  const schnittart      = (formData.get('schnittart') as string) || null
  const laubarbeitArt   = (formData.get('laubarbeit_art') as string) || null
  const einarbeitung    = formData.has('einarbeitung') ? formData.get('einarbeitung') === 'on' : null
  const einarbeitungZeitpunkt = (formData.get('einarbeitung_zeitpunkt') as string) || null

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
      duengemittel_id:      duengemittelId,
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
      bearbeitungstiefe_cm: bearbeitungstiefe,
      bearbeitungsgeraet:   bearbeitungsgeraet,
      schnittart,
      laubarbeit_art:       laubarbeitArt,
      einarbeitung,
      einarbeitung_zeitpunkt: einarbeitungZeitpunkt,
    })
    .select('id')
    .single()

  if (behErr) throw new Error((behErr as AR).message)
  const behandlungId = (beh as AR).id

  // 2. Betroffene Grundstücke ermitteln:
  //    a) alle aktiven Grundstücke der ganz ausgewählten Weingärten (Ried-Auswahl)
  //    b) die einzeln ausgewählten Grundstücke (GST-Feinauswahl)
  //    Brache + Gerodet werden automatisch übersprungen
  const grundstueckeById = new Map<string, { id: string; weingarten_id: string; flaeche_ha: number | null }>()

  if (weingartenIds.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: gVonRieden, error: gErr } = await (supabase.from('grundstuecke') as any)
      .select('id, weingarten_id, flaeche_ha')
      .in('weingarten_id', weingartenIds)
      .eq('status', 'aktiv')
    if (gErr) throw new Error((gErr as AR).message)
    for (const g of ((gVonRieden ?? []) as AR[])) {
      grundstueckeById.set(g.id, { id: g.id, weingarten_id: g.weingarten_id, flaeche_ha: g.flaeche_ha ?? null })
    }
  }

  if (grundstueckIds.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: gEinzeln, error: gErr2 } = await (supabase.from('grundstuecke') as any)
      .select('id, weingarten_id, flaeche_ha')
      .in('id', grundstueckIds)
      .eq('status', 'aktiv')
    if (gErr2) throw new Error((gErr2 as AR).message)
    for (const g of ((gEinzeln ?? []) as AR[])) {
      grundstueckeById.set(g.id, { id: g.id, weingarten_id: g.weingarten_id, flaeche_ha: g.flaeche_ha ?? null })
    }
  }

  // 3. Junction-Records anlegen (betroffene Grundstücke + flaeche_ha Snapshot, dedupliziert)
  if (grundstueckeById.size > 0) {
    const junctionRows = Array.from(grundstueckeById.values()).map(g => ({
      behandlung_id:  behandlungId,
      grundstueck_id: g.id,
      flaeche_ha:     g.flaeche_ha ?? null,
    }))
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: jErr } = await (supabase.from('behandlung_grundstuecke') as any).insert(junctionRows)
    if (jErr) throw new Error((jErr as AR).message)
  }

  // 4. Kosten-Vorschlagsfunktion (optional, best effort): Fläche je Weingarten aggregieren
  //    und – falls im Formular aktiviert – einen Kosteneintrag + Weingarten-Splits anlegen.
  const haByWeingarten = new Map<string, number>()
  for (const g of grundstueckeById.values()) {
    const curr = haByWeingarten.get(g.weingarten_id) ?? 0
    haByWeingarten.set(g.weingarten_id, curr + (g.flaeche_ha ?? 0))
  }
  await ggfKostenEintragAnlegen(supabase, tenantId, formData, datum, haByWeingarten)

  revalidatePath('/behandlungen')
}

export async function updateBehandlung(id: string, formData: FormData) {
  const supabase = await createSupabaseServerClient()

  const datum          = formData.get('datum') as string
  const datumBis       = (formData.get('datum_bis') as string) || null
  const art            = (formData.get('art') as string) || 'spritzung'
  const psmId          = (formData.get('psm_id') as string) || null
  const duengemittelId = (formData.get('duengemittel_id') as string) || null
  const wartezeit      = formData.get('wartezeit_tage') ? Number(formData.get('wartezeit_tage')) : null
  const aufwandmenge   = formData.get('aufwandmenge') ? Number(formData.get('aufwandmenge')) : null
  const aufwandEinheit = (formData.get('aufwandmenge_einheit') as string) || null
  const mengeGesamt    = formData.get('menge_gesamt') ? Number(formData.get('menge_gesamt')) : null
  const mengeEinheit   = (formData.get('menge_einheit') as string) || null
  const konzentration  = parseDecimal(formData.get('konzentration'))
  const wasseraufwand  = formData.get('wasseraufwand_l_ha') ? Number(formData.get('wasseraufwand_l_ha')) : null
  const bbch           = (formData.get('bbch_stadium') as string) || null
  const schaderreger   = (formData.get('schaderreger') as string) || null
  const witterung      = (formData.get('witterung') as string) || null
  const temperatur     = formData.get('temperatur_c') ? Number(formData.get('temperatur_c')) : null
  const notizen        = (formData.get('notizen') as string) || null
  const bearbeitungstiefe = formData.get('bearbeitungstiefe_cm') ? Number(formData.get('bearbeitungstiefe_cm')) : null
  const bearbeitungsgeraet = (formData.get('bearbeitungsgeraet') as string) || null
  const schnittart      = (formData.get('schnittart') as string) || null
  const laubarbeitArt   = (formData.get('laubarbeit_art') as string) || null
  const einarbeitung    = formData.has('einarbeitung') ? formData.get('einarbeitung') === 'on' : null
  const einarbeitungZeitpunkt = (formData.get('einarbeitung_zeitpunkt') as string) || null

  let ernteFruehesteins: string | null = null
  if (datum && wartezeit != null) {
    const d = new Date(datum)
    d.setDate(d.getDate() + wartezeit)
    ernteFruehesteins = d.toISOString().split('T')[0]
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.from('behandlungen') as any)
    .update({
      art, psm_id: psmId, duengemittel_id: duengemittelId, datum, datum_bis: datumBis,
      aufwandmenge, aufwandmenge_einheit: aufwandEinheit,
      menge_gesamt: mengeGesamt, menge_einheit: mengeEinheit,
      konzentration, wasseraufwand_l_ha: wasseraufwand,
      bbch_stadium: bbch, schaderreger, witterung, temperatur_c: temperatur,
      ernte_fruehesteins: ernteFruehesteins, notizen,
      bearbeitungstiefe_cm: bearbeitungstiefe, bearbeitungsgeraet,
      schnittart, laubarbeit_art: laubarbeitArt,
      einarbeitung, einarbeitung_zeitpunkt: einarbeitungZeitpunkt,
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
