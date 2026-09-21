'use server'

import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentMembership } from '@/lib/auth/roles'
import { revalidatePath } from 'next/cache'
import { AktionsFehler } from '@/lib/fehler'
import { dezimal } from '@/lib/format'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AR = Record<string, any>

async function getTenantId(): Promise<string> {
  const membership = await getCurrentMembership()
  if (!membership) throw new AktionsFehler('Kein aktiver Mandant gefunden')
  return membership.tenantId
}


function parseDecimal(val: FormDataEntryValue | null): number | null {
  if (!val) return null
  const s = dezimal((val as string))
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
  // Verknüpfung zur auslösenden Maßnahme (für spätere Bearbeitung/Anzeige, Migration 139)
  behandlungId: string,
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
        behandlung_id:   behandlungId,
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
      { const { error: e } = await (supabase.from('kosteneintrag_weingaerten') as any).insert(splitRows)
        if (e) throw new AktionsFehler(`Speichern fehlgeschlagen (kosteneintrag_weingaerten): ${e.message}`) }
    }

    revalidatePath('/controlling/kostenrechnung')
  } catch {
    // Kosten-Vorschlag ist optional/best effort – die Maßnahme selbst bleibt gültig.
  }
}

// Kosten beim Bearbeiten einer Maßnahme anlegen/aktualisieren/entfernen (Punkte 6, 9).
// Ermittelt die Fläche je Weingarten aus der bestehenden Grundstück-Verknüpfung
// (behandlung_grundstuecke) – die Weingarten-/GST-Auswahl selbst ist beim Bearbeiten
// nicht änderbar.
async function ggfKostenEintragAktualisieren(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  tenantId: string,
  formData: FormData,
  datum: string,
  behandlungId: string,
) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: bestehend } = await (supabase.from('kosteneintraege') as any)
    .select('id')
    .eq('behandlung_id', behandlungId)
    .eq('tenant_id', tenantId)
    .maybeSingle()
  const bestehendId = (bestehend as AR | null)?.id as string | undefined

  const kostenAktiv = formData.get('kosten_aktiv') === 'on'

  if (!kostenAktiv) {
    if (bestehendId) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { const { error: e } = await (supabase.from('kosteneintraege') as any).delete().eq('id', bestehendId).eq('tenant_id', tenantId)
        if (e) throw new AktionsFehler(`Speichern fehlgeschlagen (kosteneintraege): ${e.message}`) }
      revalidatePath('/controlling/kostenrechnung')
    }
    return
  }

  const kostenartId = (formData.get('kosten_kostenart_id') as string) || null
  const betrag = parseDecimal(formData.get('kosten_betrag'))
  const beschreibung = (formData.get('kosten_beschreibung') as string) || null
  // Kein gültiger Betrag angegeben: bestehenden Eintrag unverändert lassen (kein Blocker).
  if (!betrag || betrag <= 0) return

  try {
    // Fläche je Weingarten aus der bestehenden Grundstück-Verknüpfung dieser Maßnahme ermitteln
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: rawBG } = await (supabase.from('behandlung_grundstuecke') as any)
      .select('flaeche_ha, grundstueck:grundstueck_id(weingarten_id)')
      .eq('behandlung_id', behandlungId)
    const haByWeingarten = new Map<string, number>()
    for (const bg of ((rawBG ?? []) as AR[])) {
      const wgId = bg.grundstueck?.weingarten_id
      if (!wgId) continue
      haByWeingarten.set(wgId, (haByWeingarten.get(wgId) ?? 0) + (bg.flaeche_ha ?? 0))
    }

    let eintragId = bestehendId
    if (eintragId) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: updErr } = await (supabase.from('kosteneintraege') as any)
        .update({
          kostenart_id: kostenartId,
          datum,
          betrag,
          beschreibung: beschreibung ?? 'Maßnahme (automatisch vorgeschlagen)',
          periode:      datum?.slice(0, 7) ?? null,
        })
        .eq('id', eintragId)
        .eq('tenant_id', tenantId)
      if (updErr) throw updErr
      // Weingarten-Splits neu berechnen (bestehende ersetzen)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { const { error: e } = await (supabase.from('kosteneintrag_weingaerten') as any).delete().eq('kosteneintrag_id', eintragId)
        if (e) throw new AktionsFehler(`Speichern fehlgeschlagen (kosteneintrag_weingaerten): ${e.message}`) }
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: transaktionsNr } = await (supabase.rpc as any)('get_next_transaktionsnr', {
        p_tenant_id: tenantId, p_typ: 'kosteneintrag',
      })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: neu, error: insErr } = await (supabase.from('kosteneintraege') as any)
        .insert({
          tenant_id:       tenantId,
          behandlung_id:   behandlungId,
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
      if (insErr) throw insErr
      eintragId = (neu as AR).id
    }

    const gesamtHa = Array.from(haByWeingarten.values()).reduce((s, h) => s + h, 0)
    if (gesamtHa > 0 && eintragId) {
      const splitRows = Array.from(haByWeingarten.entries()).map(([weingartenId, ha]) => {
        const pct = Math.round((ha / gesamtHa) * 10000) / 100
        return {
          kosteneintrag_id: eintragId,
          weingarten_id:    weingartenId,
          anteil_pct:       pct,
          betrag_anteil:    Math.round(betrag * pct / 100 * 100) / 100,
        }
      })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { const { error: e } = await (supabase.from('kosteneintrag_weingaerten') as any).insert(splitRows)
        if (e) throw new AktionsFehler(`Speichern fehlgeschlagen (kosteneintrag_weingaerten): ${e.message}`) }
    }

    revalidatePath('/controlling/kostenrechnung')
  } catch {
    // Kosten-Update ist optional/best effort – die Maßnahme selbst bleibt gültig.
  }
}

export async function createBehandlung(formData: FormData) {
  const supabase = await createSupabaseServerClient()
  const tenantId = await getTenantId()

  // Weingarten-IDs (ganze Rieden) und Grundstück-IDs (einzelne GST) aus Checkboxen
  const weingartenIds = formData.getAll('weingarten_ids') as string[]
  const grundstueckIds = formData.getAll('grundstueck_ids') as string[]
  if (weingartenIds.length === 0 && grundstueckIds.length === 0) {
    throw new AktionsFehler('Mindestens eine Ried oder ein Grundstück auswählen')
  }

  const datum           = formData.get('datum') as string
  const datumBis        = (formData.get('datum_bis') as string) || null
  const art             = (formData.get('art') as string) || 'spritzung'
  const psmId           = (formData.get('psm_id') as string) || null
  const duengemittelId  = (formData.get('duengemittel_id') as string) || null
  const wartezeit       = formData.get('wartezeit_tage') ? Number(dezimal(formData.get('wartezeit_tage'))) : null
  const aufwandmenge    = formData.get('aufwandmenge') ? Number(dezimal(formData.get('aufwandmenge'))) : null
  const aufwandEinheit  = (formData.get('aufwandmenge_einheit') as string) || null
  const mengeGesamt     = formData.get('menge_gesamt') ? Number(dezimal(formData.get('menge_gesamt'))) : null
  const mengeEinheit    = (formData.get('menge_einheit') as string) || null
  const konzentration   = parseDecimal(formData.get('konzentration'))
  const wasseraufwand   = formData.get('wasseraufwand_l_ha') ? Number(dezimal(formData.get('wasseraufwand_l_ha'))) : null
  const bbch            = (formData.get('bbch_stadium') as string) || null
  const schaderreger    = (formData.get('schaderreger') as string) || null
  const witterung       = (formData.get('witterung') as string) || null
  const temperatur      = formData.get('temperatur_c') ? Number(dezimal(formData.get('temperatur_c'))) : null
  const notizen         = (formData.get('notizen') as string) || null
  const bearbeitungstiefe = formData.get('bearbeitungstiefe_cm') ? Number(dezimal(formData.get('bearbeitungstiefe_cm'))) : null
  const bearbeitungsgeraet = (formData.get('bearbeitungsgeraet') as string) || null
  const schnittart      = (formData.get('schnittart') as string) || null
  const laubarbeitArt   = (formData.get('laubarbeit_art') as string) || null
  const einarbeitung    = formData.has('einarbeitung') ? formData.get('einarbeitung') === 'on' : null
  const einarbeitungZeitpunkt = (formData.get('einarbeitung_zeitpunkt') as string) || null

  // Bio-Sperre serverseitig durchsetzen (bisher nur clientseitig in
  // NeueBehandlungForm.tsx geprüft – das reicht nicht mehr, seit auch der
  // Prozess-Assistent (Bot) diese Action direkt aufruft, ohne über das
  // Formular zu gehen). Bei Bio-EU/biodynamisch harte Sperre für nicht
  // öko-zugelassene Mittel, analog zur Client-Logik ("Analyse Maßnahmen.docx", 4.3).
  if (psmId || duengemittelId) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const [{ data: tenantRow }, { data: mittelRow }] = await Promise.all([
      (supabase.from('tenants') as any).select('bio_status').eq('id', tenantId).maybeSingle(),
      psmId
        ? (supabase.from('pflanzenschutzmittel') as any).select('oeko_zugelassen').eq('id', psmId).or(`tenant_id.eq.${tenantId},tenant_id.is.null`).maybeSingle()
        : (supabase.from('duengemittel') as any).select('oeko_zugelassen').eq('id', duengemittelId).or(`tenant_id.eq.${tenantId},tenant_id.is.null`).maybeSingle(),
    ])
    const bioStatus = (tenantRow as AR | null)?.bio_status ?? 'konventionell'
    const mittelOeko = (mittelRow as AR | null)?.oeko_zugelassen ?? false
    if (['bio_eu', 'biodynamisch'].includes(bioStatus) && !mittelOeko) {
      throw new AktionsFehler('Dieses Mittel ist nicht öko-zugelassen und passt nicht zum Bio-Status des Betriebs.')
    }
  }

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

  if (behErr) throw new AktionsFehler((behErr as AR).message)
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
      .eq('nutzart', 'WI')
      .eq('tenant_id', tenantId)
    if (gErr) throw new AktionsFehler((gErr as AR).message)
    for (const g of ((gVonRieden ?? []) as AR[])) {
      grundstueckeById.set(g.id, { id: g.id, weingarten_id: g.weingarten_id, flaeche_ha: g.flaeche_ha ?? null })
    }
  }

  if (grundstueckIds.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: gEinzeln, error: gErr2 } = await (supabase.from('grundstuecke') as any)
      .select('id, weingarten_id, flaeche_ha')
      .in('id', grundstueckIds)
      .eq('nutzart', 'WI')
      .eq('tenant_id', tenantId)
    if (gErr2) throw new AktionsFehler((gErr2 as AR).message)
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
    if (jErr) throw new AktionsFehler((jErr as AR).message)
  }

  // 4. Kosten-Vorschlagsfunktion (optional, best effort): Fläche je Weingarten aggregieren
  //    und – falls im Formular aktiviert – einen Kosteneintrag + Weingarten-Splits anlegen.
  const haByWeingarten = new Map<string, number>()
  for (const g of grundstueckeById.values()) {
    const curr = haByWeingarten.get(g.weingarten_id) ?? 0
    haByWeingarten.set(g.weingarten_id, curr + (g.flaeche_ha ?? 0))
  }
  await ggfKostenEintragAnlegen(supabase, tenantId, formData, datum, haByWeingarten, behandlungId)

  revalidatePath('/behandlungen')
  return { id: behandlungId }
}

export async function updateBehandlung(id: string, formData: FormData) {
  const supabase = await createSupabaseServerClient()
  const tenantId = await getTenantId()

  const datum          = formData.get('datum') as string
  const datumBis       = (formData.get('datum_bis') as string) || null
  const art            = (formData.get('art') as string) || 'spritzung'
  const psmId          = (formData.get('psm_id') as string) || null
  const duengemittelId = (formData.get('duengemittel_id') as string) || null
  const wartezeit      = formData.get('wartezeit_tage') ? Number(dezimal(formData.get('wartezeit_tage'))) : null
  const aufwandmenge   = formData.get('aufwandmenge') ? Number(dezimal(formData.get('aufwandmenge'))) : null
  const aufwandEinheit = (formData.get('aufwandmenge_einheit') as string) || null
  const mengeGesamt    = formData.get('menge_gesamt') ? Number(dezimal(formData.get('menge_gesamt'))) : null
  const mengeEinheit   = (formData.get('menge_einheit') as string) || null
  const konzentration  = parseDecimal(formData.get('konzentration'))
  const wasseraufwand  = formData.get('wasseraufwand_l_ha') ? Number(dezimal(formData.get('wasseraufwand_l_ha'))) : null
  const bbch           = (formData.get('bbch_stadium') as string) || null
  const schaderreger   = (formData.get('schaderreger') as string) || null
  const witterung      = (formData.get('witterung') as string) || null
  const temperatur     = formData.get('temperatur_c') ? Number(dezimal(formData.get('temperatur_c'))) : null
  const notizen        = (formData.get('notizen') as string) || null
  const bearbeitungstiefe = formData.get('bearbeitungstiefe_cm') ? Number(dezimal(formData.get('bearbeitungstiefe_cm'))) : null
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
    .eq('tenant_id', tenantId)
  if (error) throw new AktionsFehler((error as AR).message)

  await ggfKostenEintragAktualisieren(supabase, tenantId, formData, datum, id)

  revalidatePath('/behandlungen')
  revalidatePath('/behandlungen/berichte')
}

export async function deleteBehandlung(id: string) {
  const supabase = await createSupabaseServerClient()
  const tenantId = await getTenantId()
  // CASCADE löscht behandlung_grundstuecke automatisch mit
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.from('behandlungen') as any).delete().eq('id', id).eq('tenant_id', tenantId)
  if (error) throw new AktionsFehler((error as AR).message)
  revalidatePath('/behandlungen')
}
