'use server'

import { createSupabaseServerClient } from '@/lib/supabase/server'
import { alle, bloecke } from '@/lib/supabase/alle'
import { getCurrentMembership } from '@/lib/auth/roles'
import { pruefeSeitenBetrieb } from '@/lib/auth/seitenBetrieb'
import { pruefeSchreibzugriff } from '@/lib/auth/sperren'
import { hatModul } from '@/lib/auth/modul'
import { revalidatePath } from 'next/cache'
import { AktionsFehler, dbFehlerText } from '@/lib/fehler'
import { stornoGrundFehler } from '@/lib/storno/grund'
import { dezimal, zahlAus } from '@/lib/format'
import { pruefeMassnahmeMengen, summeFlaecheHa, type MassnahmeMengenEingabe } from '@/lib/behandlungen/massnahmeMengen'
import {
  LAUBARBEIT_ART_FEHLT, MASSNAHMEN_ARTEN, MASSNAHMEN_ART_LABEL, istMassnahmenArt, laubarbeitArtFehlt, laubarbeitArtFuer,
  artMitPsm, mittelFuerArt, type MassnahmenArt,
} from '@/lib/behandlungen/arten'
import { einarbeitungAus } from './neu/feldMatrix'
import { kostenAufteilung } from '@/lib/wein/massnahmeAnteile'
import { gstAktivAm } from '@/lib/wein/grundstueckAktiv'
import { artMitBetriebsmittel, BM_AUFWAND_EINHEITEN } from '@/lib/behandlungen/betriebsmittel'
import { ladeMandantMitglieder } from '@/lib/aufgaben/mitglieder'
import {
  anwenderAus, erfassungsverzugH, fristAus, fristRelevant, istArtVerwendung, nacherfassungHinweis, uhrzeitAus, uhrzeitFehler,
} from '@/lib/behandlungen/erfassungsfrist'

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
// Ermittelt die Fläche je Ried aus der Grundstück-Verknüpfung (behandlung_grundstuecke) – nach einer
// geänderten Ried-Auswahl bereits die neue.
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

type GstAuswahl = Map<string, { id: string; weingarten_id: string; flaeche_ha: number | null }>

// Betroffene Grundstücke aus der Formular-Auswahl: a) alle WI-GST der ganz gewählten Rieden, b) die einzeln gewählten
// GST – nur Nutzart WI (andere Nutzarten, z. B. Grünbrache, werden übersprungen). Anlegen und – seit 30.09.2026 –
// Bearbeiten. KAN-150 F1: bei ganzen Rieden nur Grundstücke, die am Tag der Maßnahme bewirtschaftet werden.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function grundstueckeDerAuswahl(supabase: any, tenantId: string, formData: FormData): Promise<GstAuswahl> {
  const weingartenIds = formData.getAll('weingarten_ids') as string[]
  const grundstueckIds = formData.getAll('grundstueck_ids') as string[]
  const out: GstAuswahl = new Map()
  const laden = async (spalte: 'weingarten_id' | 'id', ids: string[]) => {
    if (ids.length === 0) return
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await alle<AR>((supabase.from('grundstuecke') as any)
      .select('id, weingarten_id, flaeche_ha, aktiv, deaktiviert_am')
      .in(spalte, ids)
      .eq('nutzart', 'WI')
      .eq('tenant_id', tenantId)
      .order('id'))
    if (error) throw new AktionsFehler((error as AR).message)
    const tag = String(formData.get('datum') ?? '').slice(0, 10)
    for (const g of ((data ?? []) as AR[])) {
      if (spalte === 'weingarten_id' && tag && !gstAktivAm(g, tag)) continue
      out.set(g.id, { id: g.id, weingarten_id: g.weingarten_id, flaeche_ha: g.flaeche_ha ?? null })
    }
  }
  await laden('weingarten_id', weingartenIds)
  await laden('id', grundstueckIds)
  return out
}

const STORNIERT_FEST = 'Die Maßnahme ist storniert und lässt sich nicht mehr ändern – bitte neu erfassen.'

const OHNE_WI_GST = 'Die gewählten Rieden bzw. Grundstücke haben kein Grundstück mit Nutzart WI (Weingarten) – eine Maßnahme ohne Grundstück lässt sich nicht auswerten. Bitte eine Ried mit Weingarten-Grundstücken wählen oder die Nutzart der Grundstücke prüfen.'

// KAN-167 (01.10.2026): Betriebsmittel (Weinbehandlungs- bzw. Produktionsmittel) bei Sonstiges und Laubarbeit – nur
// ein aktives Mittel des eigenen Betriebs, nie zusammen mit einem Pflanzenschutzmittel. Aufwand optional (je ha oder
// gesamt); er ersetzt die Aufwand-Spalten der Mengenprüfung, die bei diesen Arten sonst leer bleiben.
type BmAuswahl = { id: string | null; aufwand: number | null; einheit: string | null }
async function betriebsmittelAus(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any, tenantId: string, art: string, formData: FormData, psmId: string | null,
  /** Bearbeiten: das bisher gespeicherte Mittel darf bleiben, auch wenn es inzwischen deaktiviert ist */
  bisherId: string | null = null,
): Promise<BmAuswahl> {
  const id = artMitBetriebsmittel(art) ? ((formData.get('betriebsmittel_id') as string) || null) : null
  if (!id) return { id: null, aufwand: null, einheit: null }
  if (psmId) throw new AktionsFehler('Je Maßnahme entweder ein Pflanzenschutzmittel oder ein Betriebsmittel wählen.')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.from('betriebsmittel') as any)
    .select('id, aktiv').eq('id', id).eq('tenant_id', tenantId).maybeSingle()
  if (error) throw new AktionsFehler(dbFehlerText(error, 'Betriebsmittel konnte nicht geprüft werden'))
  if (!data || (data.aktiv === false && id !== bisherId)) throw new AktionsFehler('Das gewählte Betriebsmittel gibt es nicht (mehr) oder es ist deaktiviert – bitte die Seite neu laden.')
  const roh = ((formData.get('bm_aufwand') as string) ?? '').trim()
  if (!roh) return { id, aufwand: null, einheit: null }
  const aufwand = Number(dezimal(roh))
  if (!Number.isFinite(aufwand) || aufwand <= 0) throw new AktionsFehler('Der Aufwand des Betriebsmittels muss eine Zahl größer als 0 sein.')
  const einheit = (formData.get('bm_aufwand_einheit') as string) || ''
  if (!(BM_AUFWAND_EINHEITEN as readonly string[]).includes(einheit)) throw new AktionsFehler('Bitte die Einheit des Aufwands wählen.')
  return { id, aufwand, einheit }
}

/** Spalten für behandlungen: Betriebsmittel samt Aufwand (überschreibt die Aufwand-Spalten nur mit Betriebsmittel) */
function betriebsmittelSpalten(bm: BmAuswahl): Record<string, unknown> {
  return bm.id ? { betriebsmittel_id: bm.id, aufwandmenge: bm.aufwand, aufwandmenge_einheit: bm.einheit } : { betriebsmittel_id: null }
}

// ── Anwendung: Uhrzeit, Anwender, Art der Verwendung (KAN-87) ────────────────────────────────────────────
// Dieselbe Prüfung für Formular, Bearbeiten und Assistent: Startuhrzeit Pflicht bei bienengefährlichen Mitteln, Ende
// nicht vor dem Beginn; Anwender = angemeldeter Benutzer, ein Mitglied oder ein Fremdanwender (Name). Art der
// Verwendung nur mit Pflanzenschutzmittel (Standard Freiland). Beim Bearbeiten ohne Feld „anwender“ bleibt der Anwender.
async function anwendungSpalten(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any, tenantId: string, formData: FormData, psmId: string | null, datum: string, datumBis: string | null,
  neu: boolean,
): Promise<Record<string, unknown>> {
  const uhrzeitVon = uhrzeitAus(formData.get('uhrzeit_von'))
  const uhrzeitBis = uhrzeitAus(formData.get('uhrzeit_bis'))
  if (uhrzeitVon === undefined || uhrzeitBis === undefined) throw new AktionsFehler('Bitte die Uhrzeit als HH:MM angeben.')
  let bienengefaehrlich = false
  if (psmId) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase.from('pflanzenschutzmittel') as any)
      .select('bienengefaehrlich').eq('id', psmId).or(`tenant_id.eq.${tenantId},tenant_id.is.null`).maybeSingle()
    if (error) throw new AktionsFehler(dbFehlerText(error))
    bienengefaehrlich = (data as AR | null)?.bienengefaehrlich === true
  }
  const fehler = uhrzeitFehler({ datum, datumBis, uhrzeitVon, uhrzeitBis, bienengefaehrlich })
  if (fehler) throw new AktionsFehler(fehler)
  const roh = (formData.get('art_verwendung') as string | null) || null
  if (roh && !istArtVerwendung(roh)) throw new AktionsFehler(`Unbekannte Art der Verwendung „${roh}“.`)
  const spalten: Record<string, unknown> = {
    uhrzeit_von: uhrzeitVon, uhrzeit_bis: uhrzeitBis,
    art_verwendung: psmId ? (roh ?? 'freiland') : null,
  }
  if (neu || formData.has('anwender')) {
    const { data: { user } } = await supabase.auth.getUser()
    const mitglieder = (await ladeMandantMitglieder(tenantId)).map(m => m.id)
    const a = anwenderAus(formData.get('anwender'), formData.get('anwender_name'), user?.id ?? null, mitglieder)
    if ('fehler' in a) throw new AktionsFehler(a.fehler)
    spalten.durchgefuehrt_von = a.durchgefuehrtVon
    spalten.anwender_name = a.anwenderName
  }
  return spalten
}

/** Erfassungsfrist des Betriebs (Stunden, Standard 24) */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function ladePsmFrist(supabase: any, tenantId: string): Promise<number> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (supabase.from('tenant_einstellungen') as any)
    .select('psm_erfassungsfrist_h').eq('tenant_id', tenantId).maybeSingle()
  return fristAus((data as AR | null)?.psm_erfassungsfrist_h)
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
  const grundstueckeById = await grundstueckeDerAuswahl(supabase, tenantId, formData)

  // KAN-132 (Frage 6): keine Maßnahme ohne Grundstück – sie wäre auf kein GST verteilbar (Auswertungen, Cu, N/P,
  // Kosten); gilt für Formular und Assistent (der ruft diese Action)
  if (grundstueckeById.size === 0) throw new AktionsFehler(OHNE_WI_GST)

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
  const bm = await betriebsmittelAus(supabase, tenantId, art, formData, psmId)   // KAN-167
  const anwendung = await anwendungSpalten(supabase, tenantId, formData, psmId, datum, datumBis, true)   // KAN-87

  // 3. Behandlung anlegen – erfasst am/von setzt die Datenbank (Trigger b_erfassung) – Aufwand, Spritzbrühe/Düngermenge, Wasseraufwand und Reinkupfer aus der Prüfung
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
      ...betriebsmittelSpalten(bm),
      ...anwendung,
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
  // KAN-195: Kostenrechnung gehört zum Paket-Modul Controlling – ohne Modul sperrt die Datenbank kosteneintraege
  if (await hatModul('modul_controlling')) await ggfKostenEintragAnlegen(supabase, tenantId, formData, datum, haByWeingarten, behandlungId)

  revalidatePath('/behandlungen')
  // KAN-87: Nacherfassung über der Frist (Pflanzenschutz und Düngung, ab Tagesende) – Hinweis, gespeichert wird
  // trotzdem (Markierung in der Liste)
  const hinweise = [...mengen.hinweise]
  if (fristRelevant({ art, psmId })) {
    const frist = await ladePsmFrist(supabase, tenantId)
    const nach = nacherfassungHinweis(erfassungsverzugH({ datum, datumBis }, Date.now()), frist)
    if (nach) hinweise.push(nach)
  }
  // hinweise: gespeichert, aber prüfenswert (z. B. Spritzbrühe ≠ Wasseraufwand × Fläche) – für Formular und Assistent
  return { id: behandlungId, hinweise }
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

  // Mengen prüfen und ergänzen (KAN-133) – Fläche = Σ der Grundstücke dieser Maßnahme. behandlung_grundstuecke hat
  // keine tenant_id, daher eingebettet über die Maßnahme des Betriebs.
  // storno-sichtbar: Einzelsatz – eine stornierte Maßnahme lehnt die Prüfung darunter ab (KAN-88)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: bisher, error: bisherErr } = await (supabase.from('behandlungen') as any)
    .select('id, betriebsmittel_id, storniert_am, behandlung_grundstuecke(grundstueck_id, flaeche_ha, grundstueck:grundstueck_id(flaeche_ha))')
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .maybeSingle()
  if (bisherErr) throw new AktionsFehler((bisherErr as AR).message)
  if (!bisher) throw new AktionsFehler('Maßnahme nicht gefunden – bitte die Seite neu laden.')
  if ((bisher as AR).storniert_am) throw new AktionsFehler(STORNIERT_FEST)   // KAN-88 (DB: s112_storno_schutz)
  const bisherBG = (((bisher as AR).behandlung_grundstuecke ?? []) as AR[])

  // Rieden beim Bearbeiten änderbar (Rückmeldung 30.09.2026): mit „ried_auswahl“ ersetzt die Auswahl die
  // Grundstücke der Maßnahme. Bisher behandelte GST behalten ihren Flächen-Snapshot, neue übernehmen die heutige
  // Fläche. Ohne Kennzeichen (z. B. Altformular) bleibt die Zuordnung unverändert.
  let neueGst: GstAuswahl | null = null
  if (formData.get('ried_auswahl') === '1') {
    neueGst = await grundstueckeDerAuswahl(supabase, tenantId, formData)
    if (neueGst.size === 0) throw new AktionsFehler(OHNE_WI_GST)
    const snapshot = new Map(bisherBG.map(bg => [String(bg.grundstueck_id), bg.flaeche_ha ?? bg.grundstueck?.flaeche_ha ?? null]))
    for (const g of neueGst.values()) if (snapshot.has(g.id)) g.flaeche_ha = snapshot.get(g.id) ?? g.flaeche_ha
  }
  const flaechen = neueGst
    ? Array.from(neueGst.values(), g => g.flaeche_ha)
    : bisherBG.map(bg => bg.flaeche_ha ?? bg.grundstueck?.flaeche_ha)

  const mengen = pruefeMassnahmeMengen({
    art, psmId, duengemittelId,
    ...(await ladeMengenStamm(supabase, tenantId, art, psmId, duengemittelId)),
    aufwand: aufwandmenge, aufwandEinheit,
    mengeGesamt, mengeEinheit,
    wasserLHa: wasseraufwand, konzentrationPct: konzentration,
    flaecheHa: summeFlaecheHa(flaechen),
  })
  if (!mengen.ok) throw new AktionsFehler(mengen.fehler)
  const bm = await betriebsmittelAus(supabase, tenantId, art, formData, psmId, (bisher as AR).betriebsmittel_id ?? null)   // KAN-167
  const anwendung = await anwendungSpalten(supabase, tenantId, formData, psmId, datum, datumBis, false)   // KAN-87 (erfasst am/von bleibt)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.from('behandlungen') as any)
    .update({
      art, psm_id: psmId, duengemittel_id: duengemittelId, datum, datum_bis: datumBis,
      ...mengen.werte,
      ...betriebsmittelSpalten(bm),
      ...anwendung,
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

  if (neueGst) {
    const bisherIds = new Set(bisherBG.map(bg => String(bg.grundstueck_id)))
    const weg = [...bisherIds].filter(gid => !neueGst!.has(gid))
    const dazu = [...neueGst.values()].filter(g => !bisherIds.has(g.id))
    // in Blöcken: eine Maßnahme über alle Rieden hat mehrere hundert Grundstücke (URL-Grenze ≈ 350 IDs)
    for (const block of bloecke(weg)) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: e } = await (supabase.from('behandlung_grundstuecke') as any)
        .delete().eq('behandlung_id', id).in('grundstueck_id', block)   // storno-ausnahme: Bearbeiten der Maßnahme – abgewählte Grundstücke (Vorgabe 30.09.2026: Bearbeiten ohne Dokumentation)
      if (e) throw new AktionsFehler(`Speichern fehlgeschlagen (behandlung_grundstuecke): ${e.message}`)
    }
    if (dazu.length > 0) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: e } = await (supabase.from('behandlung_grundstuecke') as any)
        .insert(dazu.map(g => ({ behandlung_id: id, grundstueck_id: g.id, flaeche_ha: g.flaeche_ha ?? null })))
      if (e) throw new AktionsFehler(`Speichern fehlgeschlagen (behandlung_grundstuecke): ${e.message}`)
    }
  }

  // Kosten danach – die Aufteilung je Ried liest die (ggf. neue) Grundstücks-Zuordnung
  // KAN-195: ohne Modul Controlling bleiben bestehende Kosteneinträge unangetastet (DB-Sperre)
  if (await hatModul('modul_controlling')) await ggfKostenEintragAktualisieren(supabase, tenantId, formData, datum, id)

  revalidatePath('/behandlungen')
  revalidatePath('/behandlungen/berichte')
  return { hinweise: mengen.hinweise }
}

// KAN-88 (05.10.2026): Maßnahmen werden storniert, nicht gelöscht (Pflanzenschutz- und Düngeaufzeichnung, 3 Jahre
// Aufbewahrung). Zeitpunkt und Benutzer setzt die Datenbank (s112_storno_schutz), die Zeile bleibt gekennzeichnet stehen
// und zählt in keinem Lager, keiner Bilanz und keiner Meldung; ihre Grundstücke sind danach fest. Ein automatisch
// angelegter Kosteneintrag geht mit (nur mit Modul Controlling – ohne Modul sperrt die DB kosteneintraege).
// Endgültig löschen nur stornierte Maßnahmen über s112_storniert_loeschen (Grund im Änderungsprotokoll).
export async function stornoBehandlung(id: string, grund: string) {
  const supabase = await createSupabaseServerClient()
  const tenantId = await getTenantId()
  const f = stornoGrundFehler(grund)
  if (f) throw new AktionsFehler(f)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.from('behandlungen') as any)
    .update({ storniert_am: new Date().toISOString(), storno_grund: grund.trim() })
    .eq('id', id).eq('tenant_id', tenantId).is('storniert_am', null)
    .select('id')
  if (error) throw new AktionsFehler(dbFehlerText(error, 'Storno fehlgeschlagen'))
  if (((data ?? []) as unknown[]).length !== 1) throw new AktionsFehler('Die Maßnahme wurde nicht gefunden oder ist schon storniert – bitte die Seite neu laden.')
  if (await hatModul('modul_controlling')) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: e } = await (supabase.from('kosteneintraege') as any).delete().eq('behandlung_id', id).eq('tenant_id', tenantId)
    if (e) throw new AktionsFehler(`Storniert, aber der Kosteneintrag der Maßnahme konnte nicht entfernt werden: ${dbFehlerText(e)}`)
    revalidatePath('/controlling/kostenrechnung')
  }
  revalidatePath('/behandlungen')
  revalidatePath('/behandlungen/berichte')
  revalidatePath('/behandlungen/lager')
}

export async function loescheBehandlung(id: string, grund: string) {
  const supabase = await createSupabaseServerClient()
  const tenantId = await getTenantId()
  const f = stornoGrundFehler(grund)
  if (f) throw new AktionsFehler(f.replace('den Storno', 'das endgültige Löschen'))
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.rpc as any)('s112_storniert_loeschen', {
    p_tenant_id: tenantId, p_tabelle: 'behandlungen', p_id: id, p_grund: grund.trim(),
  })
  if (error) throw new AktionsFehler(dbFehlerText(error, 'Endgültig löschen fehlgeschlagen'))
  revalidatePath('/behandlungen')
}
