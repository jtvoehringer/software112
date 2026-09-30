'use server'

import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentMembership } from '@/lib/auth/roles'
import { pruefeSeitenBetrieb } from '@/lib/auth/seitenBetrieb'
import { pruefeSchreibzugriff } from '@/lib/auth/sperren'
import { revalidatePath } from 'next/cache'
import { AktionsFehler } from '@/lib/fehler'
import { dezimal, zahlAus } from '@/lib/format'
import { pruefeMassnahmeMengen, summeFlaecheHa, type MassnahmeMengenEingabe } from '@/lib/behandlungen/massnahmeMengen'
import {
  LAUBARBEIT_ART_FEHLT, MASSNAHMEN_ARTEN, MASSNAHMEN_ART_LABEL, istMassnahmenArt, laubarbeitArtFehlt, laubarbeitArtFuer,
  artMitPsm, mittelFuerArt, type MassnahmenArt,
} from '@/lib/behandlungen/arten'
import { einarbeitungAus } from './neu/feldMatrix'
import { kostenAufteilung } from '@/lib/wein/massnahmeAnteile'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AR = Record<string, any>

async function getTenantId(): Promise<string> {
  const membership = await getCurrentMembership()
  if (!membership) throw new AktionsFehler('Kein aktiver Mandant gefunden')
  await pruefeSeitenBetrieb(membership.tenantId)   // KAN-30: Seite aus einem anderen Betrieb? (PSM-Abgang, Transaktionsnummer)
  await pruefeSchreibzugriff(membership)   // KAN-5: Nur-Lesen-Modus bei gesperrtem Abo
  return membership.tenantId
}


/**
 * Maßnahmenart aus dem Formular (ohne Angabe Spritzung wie bisher). Unbekannte Werte lehnt die Action mit
 * lesbarem Text ab, statt am DB-CHECK behandlungen_art_check zu scheitern (KAN-143).
 */
function massnahmenArtAus(formData: FormData): MassnahmenArt {
  const art = (formData.get('art') as string) || 'spritzung'
  if (!istMassnahmenArt(art)) {
    throw new AktionsFehler(`Unbekannte Maßnahmenart „${art}“ – erlaubt: ${MASSNAHMEN_ARTEN.map(a => MASSNAHMEN_ART_LABEL[a]).join(', ')}.`)
  }
  return art
}

function parseDecimal(val: FormDataEntryValue | null): number | null {
  if (!val) return null
  const s = dezimal((val as string))
  const n = Number(s)
  return isNaN(n) ? null : n
}

// ── Mengen einer Maßnahme (KAN-133 Soll 10) ──────────────────────────────────
// Bei einer Spritzung ist „Menge gesamt“ die Spritzbrühe (l), nie die Mittelmenge. Die Prüfung und
// Ergänzung (Spritzbrühe ↔ Wasseraufwand × Fläche, Wasseraufwand aus Aufwand und Konzentration – KAN-155 –,
// reinkupfer_kg_ha) steckt in pruefeMassnahmeMengen()
// (lib/behandlungen/massnahmeMengen.ts) – dieselbe Regel für Formular, Bearbeiten und Assistent; die
// Fläche (Σ der Grundstücke) über summeFlaecheHa() von dort, wie die Bearbeiten-Seite.

function zahlOderNull(v: unknown): number | null {
  if (v == null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/**
 * Stammdaten für die Mengenprüfung: Cu-Gehalt des Pflanzenschutzmittels (Reinkupfer) bzw. Einheit des
 * Düngemittels (Düngermenge in l nur bei Düngemitteln in l). Katalogeinträge haben tenant_id NULL.
 */
async function ladeMengenStamm(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  tenantId: string,
  art: string,
  psmId: string | null,
  duengemittelId: string | null,
): Promise<Pick<MassnahmeMengenEingabe, 'psm' | 'duengemittelEinheit'>> {
  if (artMitPsm(art) && psmId) {   // Spritzung und Sonstiges (KAN-154): Cu-Gehalt für Reinkupfer
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase.from('pflanzenschutzmittel') as any)
      .select('cu_gehalt_pct, wirkstoff, wirkstoffgehalt_pct')
      .eq('id', psmId)
      .or(`tenant_id.eq.${tenantId},tenant_id.is.null`)
      .maybeSingle()
    if (error) throw new AktionsFehler((error as AR).message)
    if (!data) throw new AktionsFehler('Das gewählte Pflanzenschutzmittel wurde nicht gefunden – bitte die Auswahl neu laden.')
    const p = data as AR
    return { psm: { cuGehaltPct: zahlOderNull(p.cu_gehalt_pct), wirkstoff: p.wirkstoff ?? null, wirkstoffgehaltPct: zahlOderNull(p.wirkstoffgehalt_pct) } }
  }
  if (art === 'duengung' && duengemittelId) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase.from('duengemittel') as any)
      .select('einheit')
      .eq('id', duengemittelId)
      .or(`tenant_id.eq.${tenantId},tenant_id.is.null`)
      .maybeSingle()
    if (error) throw new AktionsFehler((error as AR).message)
    if (!data) throw new AktionsFehler('Das gewählte Düngemittel wurde nicht gefunden – bitte die Auswahl neu laden.')
    return { duengemittelEinheit: (data as AR).einheit ?? null }
  }
  return {}
}

// Bio-Sperre serverseitig durchsetzen (bisher nur clientseitig in NeueBehandlungForm.tsx geprüft – das reicht
// nicht mehr, seit auch der Prozess-Assistent (Bot) createBehandlung direkt aufruft, ohne über das Formular zu
// gehen; seit KAN-154 auch beim Bearbeiten). Bei Bio-EU/biodynamisch harte Sperre für nicht öko-zugelassene
// Mittel, analog zur Client-Logik ("Analyse Maßnahmen.docx", 4.3). psmId/duengemittelId nach mittelFuerArt.
async function pruefeBioSperre(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  tenantId: string,
  psmId: string | null,
  duengemittelId: string | null,
) {
  if (!psmId && !duengemittelId) return
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
      // KAN-132: Restausgleich – Σ betrag_anteil = betrag, Σ anteil_pct = 100,00
      const splitRows = kostenAufteilung(betrag, Array.from(haByWeingarten.entries()).map(([weingartenId, ha]) => ({ weingartenId, gewicht: ha })))
        .map(a => ({ kosteneintrag_id: (eintrag as AR).id, weingarten_id: a.weingartenId, anteil_pct: a.anteil_pct, betrag_anteil: a.betrag_anteil }))
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
      // KAN-132: Restausgleich – Σ betrag_anteil = betrag, Σ anteil_pct = 100,00
      const splitRows = kostenAufteilung(betrag, Array.from(haByWeingarten.entries()).map(([weingartenId, ha]) => ({ weingartenId, gewicht: ha })))
        .map(a => ({ kosteneintrag_id: eintragId, weingarten_id: a.weingartenId, anteil_pct: a.anteil_pct, betrag_anteil: a.betrag_anteil }))
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
  const art             = massnahmenArtAus(formData)
  // Mittel und Wartezeit nur, wenn die Art sie kennt (Assistent schickt sie sonst auch bei Laubschneiden mit)
  const { psmId, duengemittelId, wartezeitTage: wartezeit } = mittelFuerArt(art, {
    psmId:          (formData.get('psm_id') as string) || null,
    duengemittelId: (formData.get('duengemittel_id') as string) || null,
    wartezeitTage:  formData.get('wartezeit_tage') ? Number(dezimal(formData.get('wartezeit_tage'))) : null,
  })
  const aufwandmenge    = formData.get('aufwandmenge') ? Number(dezimal(formData.get('aufwandmenge'))) : null
  const aufwandEinheit  = (formData.get('aufwandmenge_einheit') as string) || null
  const mengeGesamt     = formData.get('menge_gesamt') ? Number(dezimal(formData.get('menge_gesamt'))) : null
  const mengeEinheit    = (formData.get('menge_einheit') as string) || null
  const konzentration   = parseDecimal(formData.get('konzentration'))
  const wasseraufwand   = formData.get('wasseraufwand_l_ha') ? Number(dezimal(formData.get('wasseraufwand_l_ha'))) : null
  const bbch            = (formData.get('bbch_stadium') as string) || null
  const schaderreger    = (formData.get('schaderreger') as string) || null
  const witterung       = (formData.get('witterung') as string) || null
  const temperatur      = zahlAus(formData.get('temperatur_c'))   // 0 °C bleibt 0, leer → null
  const notizen         = (formData.get('notizen') as string) || null
  const bearbeitungstiefe = formData.get('bearbeitungstiefe_cm') ? Number(dezimal(formData.get('bearbeitungstiefe_cm'))) : null
  const bearbeitungsgeraet = (formData.get('bearbeitungsgeraet') as string) || null
  const schnittart      = (formData.get('schnittart') as string) || null
  // nur bei einer Laubarbeit – bei Laubschneiden (KAN-143) und allen anderen Arten null
  const laubarbeitArt   = laubarbeitArtFuer(art, (formData.get('laubarbeit_art') as string) || null)
  if (laubarbeitArtFehlt(art, laubarbeitArt)) throw new AktionsFehler(LAUBARBEIT_ART_FEHLT)   // Feld-Matrix: Pflicht
  const einarbeitung    = einarbeitungAus(formData)   // KAN-154: nicht angehakt = false, nicht gesendet = null
  const einarbeitungZeitpunkt = (formData.get('einarbeitung_zeitpunkt') as string) || null

  await pruefeBioSperre(supabase, tenantId, psmId, duengemittelId)

  // Frühester Erntetermin berechnen
  let ernteFruehesteins: string | null = null
  if (datum && wartezeit != null) {
    const d = new Date(datum)
    d.setDate(d.getDate() + wartezeit)
    ernteFruehesteins = d.toISOString().split('T')[0]
  }

  // 1. Betroffene Grundstücke ermitteln (vor dem Anlegen – ihre Fläche braucht die Mengenprüfung):
  //    a) alle aktiven Grundstücke der ganz ausgewählten Weingärten (Ried-Auswahl)
  //    b) die einzeln ausgewählten Grundstücke (GST-Feinauswahl)
  //    nur Grundstücke mit Nutzart WI (Weingarten) – alle anderen Nutzarten (z. B. Grünbrache) werden übersprungen
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

  // KAN-132 (Frage 6): keine Maßnahme ohne Grundstück – sie wäre auf kein GST verteilbar (Auswertungen, Cu, N/P,
  // Kosten); gilt für Formular und Assistent (der ruft diese Action)
  if (grundstueckeById.size === 0) {
    throw new AktionsFehler('Die gewählten Rieden bzw. Grundstücke haben kein Grundstück mit Nutzart WI (Weingarten) – eine Maßnahme ohne Grundstück lässt sich nicht auswerten. Bitte eine Ried mit Weingarten-Grundstücken wählen oder die Nutzart der Grundstücke prüfen.')
  }

  // 2. Mengen prüfen und ergänzen (KAN-133): Fläche = Σ der gewählten WI-GST
  const mengen = pruefeMassnahmeMengen({
    art, psmId, duengemittelId,
    ...(await ladeMengenStamm(supabase, tenantId, art, psmId, duengemittelId)),
    aufwand: aufwandmenge, aufwandEinheit,
    mengeGesamt, mengeEinheit,
    wasserLHa: wasseraufwand, konzentrationPct: konzentration,
    flaecheHa: summeFlaecheHa(Array.from(grundstueckeById.values(), g => g.flaeche_ha)),
  })
  if (!mengen.ok) throw new AktionsFehler(mengen.fehler)

  // 3. Behandlung anlegen – Aufwand, Spritzbrühe/Düngermenge, Wasseraufwand und Reinkupfer aus der Prüfung
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: beh, error: behErr } = await (supabase.from('behandlungen') as any)
    .insert({
      tenant_id:            tenantId,
      art,
      psm_id:               psmId,
      duengemittel_id:      duengemittelId,
      datum,
      datum_bis:            datumBis,
      ...mengen.werte,
      konzentration,
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

  // 4. Junction-Records anlegen (betroffene Grundstücke + flaeche_ha Snapshot, dedupliziert)
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

  // 5. Kosten-Vorschlagsfunktion (optional, best effort): Fläche je Weingarten aggregieren
  //    und – falls im Formular aktiviert – einen Kosteneintrag + Weingarten-Splits anlegen.
  const haByWeingarten = new Map<string, number>()
  for (const g of grundstueckeById.values()) {
    const curr = haByWeingarten.get(g.weingarten_id) ?? 0
    haByWeingarten.set(g.weingarten_id, curr + (g.flaeche_ha ?? 0))
  }
  await ggfKostenEintragAnlegen(supabase, tenantId, formData, datum, haByWeingarten, behandlungId)

  revalidatePath('/behandlungen')
  // hinweise: gespeichert, aber prüfenswert (z. B. Spritzbrühe ≠ Wasseraufwand × Fläche) – für Formular und Assistent
  return { id: behandlungId, hinweise: mengen.hinweise }
}

export async function updateBehandlung(id: string, formData: FormData) {
  const supabase = await createSupabaseServerClient()
  const tenantId = await getTenantId()

  const datum          = formData.get('datum') as string
  const datumBis       = (formData.get('datum_bis') as string) || null
  const art            = massnahmenArtAus(formData)
  // Mittel und Wartezeit nur, wenn die Art sie kennt – nach einem Artwechsel (z. B. Spritzung → Laubschneiden)
  // bleibt sonst die Wartezeit des ausgeblendeten Mittels in ernte_fruehesteins stehen
  const { psmId, duengemittelId, wartezeitTage: wartezeit } = mittelFuerArt(art, {
    psmId:          (formData.get('psm_id') as string) || null,
    duengemittelId: (formData.get('duengemittel_id') as string) || null,
    wartezeitTage:  formData.get('wartezeit_tage') ? Number(dezimal(formData.get('wartezeit_tage'))) : null,
  })
  const aufwandmenge   = formData.get('aufwandmenge') ? Number(dezimal(formData.get('aufwandmenge'))) : null
  const aufwandEinheit = (formData.get('aufwandmenge_einheit') as string) || null
  const mengeGesamt    = formData.get('menge_gesamt') ? Number(dezimal(formData.get('menge_gesamt'))) : null
  const mengeEinheit   = (formData.get('menge_einheit') as string) || null
  const konzentration  = parseDecimal(formData.get('konzentration'))
  const wasseraufwand  = formData.get('wasseraufwand_l_ha') ? Number(dezimal(formData.get('wasseraufwand_l_ha'))) : null
  // BBCH, Schaderreger bzw. Grund / Anlass, Witterung und Temperatur so, wie das Formular sie sendet – nicht nach
  // der Feld-Matrix filtern: Ausgeblendete Felder schickt das Bearbeiten-Formular bei unveränderter Art mit dem
  // gespeicherten Wert (<input type="hidden">, felderBeimBearbeiten, KAN-143/KAN-152); nicht gesendet (nach einem
  // Artwechsel) oder leer → null
  const bbch           = (formData.get('bbch_stadium') as string) || null
  const schaderreger   = (formData.get('schaderreger') as string) || null
  const witterung      = (formData.get('witterung') as string) || null
  const temperatur     = zahlAus(formData.get('temperatur_c'))   // 0 °C bleibt 0, leer → null
  const notizen        = (formData.get('notizen') as string) || null
  const bearbeitungstiefe = formData.get('bearbeitungstiefe_cm') ? Number(dezimal(formData.get('bearbeitungstiefe_cm'))) : null
  const bearbeitungsgeraet = (formData.get('bearbeitungsgeraet') as string) || null
  const schnittart      = (formData.get('schnittart') as string) || null
  // nur bei einer Laubarbeit – bei Laubschneiden (KAN-143) und allen anderen Arten null
  const laubarbeitArt   = laubarbeitArtFuer(art, (formData.get('laubarbeit_art') as string) || null)
  if (laubarbeitArtFehlt(art, laubarbeitArt)) throw new AktionsFehler(LAUBARBEIT_ART_FEHLT)   // Feld-Matrix: Pflicht
  const einarbeitung    = einarbeitungAus(formData)   // KAN-154: nicht angehakt = false, nicht gesendet = null
  const einarbeitungZeitpunkt = (formData.get('einarbeitung_zeitpunkt') as string) || null

  await pruefeBioSperre(supabase, tenantId, psmId, duengemittelId)   // KAN-154: wie beim Anlegen

  let ernteFruehesteins: string | null = null
  if (datum && wartezeit != null) {
    const d = new Date(datum)
    d.setDate(d.getDate() + wartezeit)
    ernteFruehesteins = d.toISOString().split('T')[0]
  }

  // Mengen prüfen und ergänzen (KAN-133) – Fläche = Σ der Grundstücke dieser Maßnahme (die GST-Auswahl
  // ist beim Bearbeiten nicht änderbar). behandlung_grundstuecke hat keine tenant_id, daher eingebettet
  // über die Maßnahme des Betriebs.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: bisher, error: bisherErr } = await (supabase.from('behandlungen') as any)
    .select('id, behandlung_grundstuecke(flaeche_ha, grundstueck:grundstueck_id(flaeche_ha))')
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .maybeSingle()
  if (bisherErr) throw new AktionsFehler((bisherErr as AR).message)
  if (!bisher) throw new AktionsFehler('Maßnahme nicht gefunden – bitte die Seite neu laden.')
  const mengen = pruefeMassnahmeMengen({
    art, psmId, duengemittelId,
    ...(await ladeMengenStamm(supabase, tenantId, art, psmId, duengemittelId)),
    aufwand: aufwandmenge, aufwandEinheit,
    mengeGesamt, mengeEinheit,
    wasserLHa: wasseraufwand, konzentrationPct: konzentration,
    flaecheHa: summeFlaecheHa((((bisher as AR).behandlung_grundstuecke ?? []) as AR[]).map(bg => bg.flaeche_ha ?? bg.grundstueck?.flaeche_ha)),
  })
  if (!mengen.ok) throw new AktionsFehler(mengen.fehler)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.from('behandlungen') as any)
    .update({
      art, psm_id: psmId, duengemittel_id: duengemittelId, datum, datum_bis: datumBis,
      ...mengen.werte,
      konzentration,
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
  return { hinweise: mengen.hinweise }
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
