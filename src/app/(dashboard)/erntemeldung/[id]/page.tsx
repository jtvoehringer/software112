// behoerdenmeldung: lesedaten, erntemeldung, bki-traubenverkauf
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { alle } from '@/lib/supabase/alle'
import { ladeBehaelter } from '@/lib/keller/behaelter'
import { getCurrentUserRole, canWrite, canAdmin, getCurrentMembership } from '@/lib/auth/roles'
import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import Link from '@/components/ui/Link'
import ErnteDetailClient from './ErnteDetailClient'
import type { Pressung, PressungWG, PressungBeh, WGOption, BehOption, WAOption, ZukaufTraubenOpt } from './PressungSection'
import TraubenverkaufSection, { type Traubenverkauf, type TVWGOption, type TVKontaktOption, type TVFirmaOption, type TVQuelleOption } from './TraubenverkaufSection'
import { formatRebsorteMitKuerzel } from '@/lib/wein/bki_kuerzel'
import { berechneHektarhoechstertrag, ladeLesedaten, stichtagHinweis, teileNachStichtag, weinbauflaecheHa, type HektarhoechstertragStatus, type LeseZeile } from '@/lib/behoerden/erntemeldung'
import { KATALOG_ERNTE } from '@/lib/behoerden/katalog/ernte'
import { betriebUndModuleLaden, zugriffsFehler } from '@/lib/behoerden/zugriff'
import { istErntebar } from '@/lib/wein/leseErfassung'
import { gewaehlteLese, leseLoeschsperre, leseTitel, type Lese } from '@/lib/wein/lesen'
import LeseReiter, { type LeseMitSperre } from './LeseReiter'

export const metadata: Metadata = { title: 'Lese – software:112' }
export const dynamic = 'force-dynamic'

interface Props { params: Promise<{ id: string }>; searchParams: Promise<{ lese?: string | string[] }> }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AR = Record<string, any>

export type GSTOpt = { id: string; gst_nr: string; rebsorte: string | null; flaeche_ha: number | null }
export type ErnteParzelle = {
  id: string; weingarten_id: string; weingarten_name: string; weingarten_rebsorte: string | null
  grundstueck_id: string | null; grundstueck_nr: string | null; grundstueck_rebsorte: string | null
  ernte_datum: string | null; menge_kg: number | null; menge_hl: number | null
  oechsle: number | null; klosterneuburger: number | null
  /** gemessene Einheit ('kmw' | 'oechsle', KAN-128) – vor Migration A null */
  mostgewicht_einheit: string | null
  qualitaetsstufe: string | null; lesemethode: string | null; notizen: string | null
  /** KAN-129: Lese des Eintrags („2026/1 Hauptlese“) und ihre Nummer – Gruppierung der Lesedaten */
  lese_titel: string | null; lese_nr: number | null
}
export type WeingartenOpt = {
  id: string; name: string; rebsorte: string | null; lage_name: string | null
  /** AMA-Feldstücknummer (Suche in der Lese-Erfassung, KAN-162) */
  ama_feldnummer: string | null
  /** Fläche des Weingartens – Bezugsfläche nur, wenn er keine Grundstücke hat (KAN-161) */
  flaeche_ha: number | null
  /** mind. ein Grundstück der Nutzart WI oder gar keine Grundstücke (lib/wein/leseErfassung.ts, KAN-160) */
  erntebar: boolean
}
export type AMAMeldung = {
  id: string; status: string; gesamtmenge_kg: number | null; gesamtmenge_hl: number | null
  n8n_status: string | null; n8n_fehler: string | null; eingereicht_am: string | null
  positionen: { rebsorte_name: string; flaeche_ha: number | null; menge_kg: number | null }[]
}
// Hektarhöchstertrag: Berechnung gemeinsam mit Erntemeldung-Druck und -CSV (lib/behoerden/erntemeldung.ts)
export type { HektarhoechstertragStatus }

/** Lesezeile (gemeinsame Ladefunktion) → Zeile der Lesedaten-Tabelle bzw. des Bearbeiten-Formulars */
function zuErnteParzelle(z: LeseZeile): ErnteParzelle {
  return {
    id: z.id, weingarten_id: z.weingartenId ?? '',
    weingarten_name: z.ried ?? '–', weingarten_rebsorte: z.weingartenRebsorte,
    grundstueck_id: z.grundstueckId, grundstueck_nr: z.gstNr, grundstueck_rebsorte: z.grundstueckRebsorte,
    ernte_datum: z.datum, menge_kg: z.mengeKg, menge_hl: z.mengeHl,
    oechsle: z.oechsle, klosterneuburger: z.kmw, mostgewicht_einheit: z.mostgewichtEinheit,
    qualitaetsstufe: z.qualitaetsstufe, lesemethode: z.lesemethode, notizen: z.notizen,
    lese_titel: z.lese, lese_nr: z.leseNr,
  }
}

export default async function ErnteDetailPage({ params, searchParams }: Props) {
  const { id } = await params
  const { lese: leseParam } = await searchParams
  const supabase = await createSupabaseServerClient()
  const role = await getCurrentUserRole()
  const writeOk = canWrite(role, 'rieden')
  const adminOk = canAdmin(role)
  const membership = await getCurrentMembership()
  const tenantId = membership?.tenantId ?? null
  if (!membership || !tenantId) notFound()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tf = (query: any) => query.eq('tenant_id', tenantId)

  const [
    { data: jg },
    lese,
    { data: rawW },
    { data: rawA },
    { data: rawPressungen },
    behRows,
    { data: rawWA },
    { data: rawGST },
    { data: rawGstAlle },
    { data: rawTV },
    { data: rawTVKontakte },
    { data: rawTVFirmen },
    { betrieb, module },
    { data: rawLesen },
  ] = await Promise.all([
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tf((supabase.from('weinjahrgaenge') as any).select('*').eq('id', id).single()),

    // Lesedaten: dieselbe Ladefunktion wie die CSV „Lesedaten“ (/meldungen/lesedaten/csv).
    // ernte_parzellen hat keine tenant_id – der Jahrgang wird oben mandantengefiltert
    // geladen, ohne ihn endet die Seite unten mit notFound().
    ladeLesedaten(supabase, id),

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tf((supabase.from('weingarten') as any)
      .select('id, name, rebsorte, flaeche_ha, ama_feldnummer, trauben_verkauf, trauben_herkunft_code, lagen:lage_id(name)').eq('aktiv', true).order('name')),

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tf((supabase.from('ama_erntemeldungen') as any)
      .select('id, status, gesamtmenge_kg, gesamtmenge_hl, n8n_status, n8n_fehler, eingereicht_am')
      .eq('jahrgang_id', id).maybeSingle()),

    // Pressungen mit Sub-Tabellen
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tf((supabase.from('pressungen') as any)
      .select(`id, lese_id, datum, most_liter_gesamt, weinbezeichnung, notizen, kmw_grad,
        weingaerten:pressung_weingaerten(id, weingarten_id, grundstueck_id, zukauf_posten_id, trauben_kg, rebsorte, notizen, ernte_datum, kmw, oechsle, mostgewicht_einheit, weingarten:weingarten_id(name)),
        behaelter:pressung_behaelter(id, behaelter_id, weinausbau_id, menge_liter, notizen, behaelter:behaelter_id(name), weinausbau:weinausbau_id(name, jahrgang, qualitaetsstufe))`)
      .eq('jahrgang_id', id).order('datum', { ascending: false })),

    // Gebinde für die Pressung: eigene + freigegebene, fremd belegte ausgenommen (Migration 203)
    ladeBehaelter(supabase, tenantId, { alsZiel: true }),

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tf((supabase.from('weinausbau') as any)
      .select('id, name, jahrgang, behaelter_id, rebsorte, menge_liter, qualitaetsstufe, herkunft_code').eq('aktiv', true).neq('status', 'abgeschlossen').order('name')),

    // Weingartenfläche (GST, Nutzart WI) – auch Bezugsfläche des Hektarhöchstertrags; alle() statt 1.000er-Deckel
    alle<AR>(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      tf((supabase.from('grundstuecke') as any)
        .select('id, weingarten_id, gst_nr, rebsorte, flaeche_ha').eq('nutzart', 'WI').order('gst_nr').order('id')),
    ),
    // Alle Grundstücke (jede Nutzart) – ein Weingarten nur mit Acker/Grünland/Brache ist nicht erntebar (KAN-160)
    alle<AR>(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      tf((supabase.from('grundstuecke') as any).select('id, weingarten_id').order('id')),
    ),

    // Traubenverkäufe dieses Jahrgangs (mit Rechnung: Löschen storniert sie, KAN-35)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tf((supabase.from('traubenverkauf') as any)
      .select('id, lese_id, weingarten_id, grundstueck_id, zukauf_posten_id, kontakt_id, firma_id, datum, menge_kg, preis_per_kg, kmw_grad, oechsle, mostgewicht_einheit, qualitaetsstufe, gesundheit, herkunft_code, notizen, liefernummer, verkaufsposten_id, weingarten:weingarten_id(name), grundstueck:grundstueck_id(gst_nr), kontakt:kontakt_id(vorname, nachname), firma:firma_id(name), verkaufsposten:verkaufsposten_id(rechnungsnummer, storniert)')
      .eq('jahrgang_id', id).order('datum', { ascending: false })),

    // Kontakte + Firmen für Abnehmer-Dropdown
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tf((supabase.from('kontakte') as any).select('id, vorname, nachname, betrieb_nr').order('nachname')),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tf((supabase.from('firmen') as any).select('id, name, betrieb_nr').order('name')),

    // Betriebsname (Druckkopf) und Modul-Schalter (CSV-Knöpfe nach derselben Regel wie die CSV-Route)
    betriebUndModuleLaden(supabase, tenantId),

    // KAN-129: Lesen des Jahrgangs (Reiter)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tf((supabase.from('lesen') as any)
      .select('id, lfd_nr, art, bezeichnung, beginn, ende, notizen').eq('jahrgang_id', id).order('lfd_nr')),
  ])

  if (!jg) notFound()

  // ── KAN-129: gewählte Lese (?lese=<Nr.>, sonst die höchste) ─────────────────
  // Lesedaten, Pressungen, Traubenverkäufe aus eigener Ernte und die verfügbaren kg gelten für diese Lese;
  // Hektarhöchstertrag und AMA-Erntemeldung bleiben beim ganzen Jahrgang. Trauben-Zukäufe gehören keiner Lese.
  const lesen = ((rawLesen ?? []) as Lese[])
  const aktiveLese = gewaehlteLese(lesen, leseParam)
  const inLese = (leseId: string | null | undefined) => !aktiveLese || lesen.length <= 1 || leseId === aktiveLese.id
  const rawPressungenAlle = (rawPressungen ?? []) as AR[]
  const rawTVAlle = (rawTV ?? []) as AR[]
  const rawTVLese = rawTVAlle.filter(v => v.zukauf_posten_id || inLese(v.lese_id))
  const lesenMitSperre: LeseMitSperre[] = lesen.map(l => ({
    ...l,
    loeschsperre: leseLoeschsperre(l, lesen.map(x => x.lfd_nr), {
      eintraege: lese.zeilen.filter(z => z.leseId === l.id).length,
      pressungen: rawPressungenAlle.filter(p => p.lese_id === l.id).length,
      traubenverkaeufe: rawTVAlle.filter(v => v.lese_id === l.id).length,
    }),
  }))
  const aktiveLeseMitSperre = aktiveLese ? lesenMitSperre.find(l => l.id === aktiveLese.id) ?? null : null
  // Pflichtmeldungen (Lesedaten, Erntemeldung, BKI-Datenblatt): Betriebsleiter immer, Leser nur mit Controlling
  const csvErlaubt = zugriffsFehler(KATALOG_ERNTE.lesedaten, membership, module) === null
  const bkiErlaubt = zugriffsFehler(KATALOG_ERNTE['bki-traubenverkauf'], membership, module) === null

  // Zugekaufte Trauben dieses Jahrgangs (art='trauben') - stehen als zusätzliche
  // Quelle für Pressungs-Vorschlag und Traubenverkauf zur Verfügung.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: rawZukaufTrauben } = await tf((supabase.from('zukauf_posten') as any)
    .select(`
      id, datum, menge, rebsorte, herkunft, qualitaetsstufe, kmw, oechsle, mostgewicht_einheit,
      lieferant_kontakt:kontakte!lieferant_kontakt_id(vorname, nachname),
      lieferant_firma:firmen!lieferant_firma_id(name)
    `)
    .eq('art', 'trauben')
    .eq('aktiv', true)
    .eq('jahrgang', (jg as AR).jahrgang)
    .order('datum', { ascending: false }))

  // Anzeige wie bisher: neueste Lese zuerst (Postgres-DESC: ohne Datum ganz oben); bei mehreren Lesen je Lese
  // gruppiert (höchste Nummer oben). Die Tabelle und der Druck zeigen immer den ganzen Jahrgang (Ticket Soll 4),
  // Pressungen und verfügbare kg nur die gewählte Lese.
  const nachDatum = (a: ErnteParzelle, b: ErnteParzelle) =>
    (a.ernte_datum === b.ernte_datum ? 0 : a.ernte_datum === null ? -1 : b.ernte_datum === null ? 1 : b.ernte_datum.localeCompare(a.ernte_datum))
  const alleParzellen: ErnteParzelle[] = lese.zeilen.map(zuErnteParzelle)
    .sort((a, b) => (lesen.length > 1 ? (b.lese_nr ?? 0) - (a.lese_nr ?? 0) : 0) || nachDatum(a, b))
  const parzellen: ErnteParzelle[] = alleParzellen.filter(p => inLese(lese.zeilen.find(z => z.id === p.id)?.leseId))
  // KAN-129 Frage 7: Lesegut nach dem 30.11. zählt nicht in die Erntemeldung
  const nachStichtag = stichtagHinweis(teileNachStichtag(lese.zeilen, Number((jg as AR).jahrgang)).danach, Number((jg as AR).jahrgang))

  const gstByWeingarten: Record<string, GSTOpt[]> = {}
  for (const g of rawGST) {
    if (!gstByWeingarten[g.weingarten_id]) gstByWeingarten[g.weingarten_id] = []
    gstByWeingarten[g.weingarten_id].push({ id: g.id, gst_nr: g.gst_nr, rebsorte: g.rebsorte ?? null, flaeche_ha: g.flaeche_ha ?? null })
  }
  const gstAnzahlJeWeingarten = new Map<string, number>()
  for (const g of rawGstAlle as AR[]) gstAnzahlJeWeingarten.set(g.weingarten_id, (gstAnzahlJeWeingarten.get(g.weingarten_id) ?? 0) + 1)

  const weingaerten: WeingartenOpt[] = ((rawW ?? []) as AR[]).map(w => ({
    id: w.id, name: w.name, rebsorte: w.rebsorte ?? null, lage_name: w.lagen?.name ?? null,
    ama_feldnummer: w.ama_feldnummer ?? null, flaeche_ha: w.flaeche_ha ?? null,
    erntebar: istErntebar(gstAnzahlJeWeingarten.get(w.id) ?? 0, gstByWeingarten[w.id]?.length ?? 0),
  }))

  // ── Hektarhöchstertrag-Prüfung (Qualitätswein, betriebsweit) ────────────────
  // Hinweis vom BKI (18.07.2026): die hl-Höchstmenge für Qualitätswein wird gegen
  // die GST-Fläche lt. AMA berechnet (= flaeche_ha, laut Betrieb keine Abweichung),
  // Erntebetrag darf 10.000 kg/ha nicht überschreiten, betriebsweit gerechnet.
  // Reine Info-/Warnfunktion – ersetzt keine rechtliche Prüfung. Dieselbe Berechnung
  // steht in der Erntemeldung (Druck /reports/ama und CSV).
  const hektarhoechstertrag: HektarhoechstertragStatus = berechneHektarhoechstertrag(lese.zeilen, weinbauflaecheHa(rawGST))

  let amaMeldung: AMAMeldung | null = null
  if (rawA) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: rawPos } = await (supabase.from('ama_meldepositionen') as any)
      .select('rebsorte_name, flaeche_ha, menge_kg').eq('meldung_id', (rawA as AR).id)
    amaMeldung = { ...(rawA as AR), positionen: (rawPos ?? []) as AMAMeldung['positionen'] } as AMAMeldung
  }

  const allePressungen: (Pressung & { lese_id: string | null })[] = rawPressungenAlle.map(p => ({
    lese_id: p.lese_id ?? null,
    id: p.id, datum: p.datum, most_liter_gesamt: p.most_liter_gesamt ?? null,
    weinbezeichnung: p.weinbezeichnung ?? null, notizen: p.notizen ?? null, kmw_grad: p.kmw_grad ?? null,
    weingaerten: ((p.weingaerten ?? []) as AR[]).map((w: AR): PressungWG => ({
      id: w.id, weingarten_id: w.weingarten_id,
      grundstueck_id: w.grundstueck_id ?? null,
      zukauf_posten_id: w.zukauf_posten_id ?? null,
      weingarten_name: w.weingarten?.name ?? (w.zukauf_posten_id ? 'Zukauf' : '–'),
      trauben_kg: w.trauben_kg, rebsorte: w.rebsorte ?? null, notizen: w.notizen ?? null,
      // KAN-126: Lesetag und Mostgewicht der Traubenzeile
      ernte_datum: w.ernte_datum ?? null, kmw: w.kmw ?? null, oechsle: w.oechsle ?? null, mostgewicht_einheit: w.mostgewicht_einheit ?? null,
    })),
    behaelter: ((p.behaelter ?? []) as AR[]).map((b: AR): PressungBeh => ({
      id: b.id, behaelter_id: b.behaelter_id ?? null,
      behaelter_name: b.behaelter?.name ?? null,
      weinausbau_id: b.weinausbau_id ?? null,
      weinausbau_name: b.weinausbau?.name ?? null,
      weinausbau_qualitaet: b.weinausbau?.qualitaetsstufe ?? null,
      menge_liter: b.menge_liter ?? null, notizen: b.notizen ?? null,
    })),
  }))

  const pressungen: Pressung[] = allePressungen.filter(p => inLese(p.lese_id))
  const wgOptions: WGOption[]  = weingaerten.map(w => ({ id: w.id, name: w.name, rebsorte: w.rebsorte }))

  // Verfügbare kg pro WG: geerntet − verpresst (für alle Pressungen dieses Jahrgangs)
  const harvestedKgByWG: Record<string, number> = {}
  for (const p of parzellen) {
    if (p.menge_kg) harvestedKgByWG[p.weingarten_id] = (harvestedKgByWG[p.weingarten_id] ?? 0) + p.menge_kg
  }
  const pressedKgByWG: Record<string, number> = {}
  for (const p of pressungen) {
    for (const w of p.weingaerten) {
      if (w.weingarten_id) pressedKgByWG[w.weingarten_id] = (pressedKgByWG[w.weingarten_id] ?? 0) + w.trauben_kg
    }
  }
  // Verkaufte kg pro WG aus Traubenverkauf (dieses Jahrgangs) abziehen
  const soldKgByWG: Record<string, number> = {}
  for (const v of rawTVLese) {
    if (v.weingarten_id) soldKgByWG[v.weingarten_id] = (soldKgByWG[v.weingarten_id] ?? 0) + (parseFloat(v.menge_kg) || 0)
  }
  const verfuegbareKg: Record<string, number> = {}
  for (const wgId of Object.keys(harvestedKgByWG)) {
    verfuegbareKg[wgId] = Math.max(0, (harvestedKgByWG[wgId] ?? 0) - (pressedKgByWG[wgId] ?? 0) - (soldKgByWG[wgId] ?? 0))
  }
  // Verfügbare kg pro GST: direkte Berechnung (kein proportionales Verteilen)
  const harvestedKgByGST: Record<string, number> = {}
  for (const p of parzellen) {
    if (p.grundstueck_id && p.menge_kg)
      harvestedKgByGST[p.grundstueck_id] = (harvestedKgByGST[p.grundstueck_id] ?? 0) + p.menge_kg
  }
  const pressedKgByGST: Record<string, number> = {}
  for (const p of pressungen) {
    for (const w of p.weingaerten) {
      if (w.grundstueck_id)
        pressedKgByGST[w.grundstueck_id] = (pressedKgByGST[w.grundstueck_id] ?? 0) + w.trauben_kg
    }
  }
  const soldKgByGST: Record<string, number> = {}
  for (const v of rawTVLese) {
    if (v.grundstueck_id)
      soldKgByGST[v.grundstueck_id] = (soldKgByGST[v.grundstueck_id] ?? 0) + (parseFloat(v.menge_kg) || 0)
  }
  const verfuegbareKgByGST: Record<string, number> = {}
  for (const gstId of Object.keys(harvestedKgByGST)) {
    verfuegbareKgByGST[gstId] = Math.max(0, (harvestedKgByGST[gstId] ?? 0) - (pressedKgByGST[gstId] ?? 0) - (soldKgByGST[gstId] ?? 0))
  }

  // Verfügbare kg pro Trauben-Zukauf: zugekaufte Menge − bereits verpresst − bereits verkauft
  const pressedKgByZukauf: Record<string, number> = {}
  for (const p of allePressungen) {
    for (const w of p.weingaerten) {
      if (w.zukauf_posten_id) pressedKgByZukauf[w.zukauf_posten_id] = (pressedKgByZukauf[w.zukauf_posten_id] ?? 0) + w.trauben_kg
    }
  }
  const soldKgByZukauf: Record<string, number> = {}
  for (const v of rawTVAlle) {
    if (v.zukauf_posten_id) soldKgByZukauf[v.zukauf_posten_id] = (soldKgByZukauf[v.zukauf_posten_id] ?? 0) + (parseFloat(v.menge_kg) || 0)
  }
  const zukaufTrauben: ZukaufTraubenOpt[] = ((rawZukaufTrauben ?? []) as AR[]).map(z => {
    const mengeKg = parseFloat(z.menge) || 0
    const lieferant = z.lieferant_kontakt
      ? [z.lieferant_kontakt.vorname, z.lieferant_kontakt.nachname].filter(Boolean).join(' ')
      : (z.lieferant_firma?.name ?? '–')
    return {
      id: z.id,
      datum: z.datum,
      lieferant,
      rebsorte: z.rebsorte ?? null,
      herkunft: z.herkunft ?? null,
      menge_kg: mengeKg,
      verfuegbar_kg: Math.max(0, mengeKg - (pressedKgByZukauf[z.id] ?? 0) - (soldKgByZukauf[z.id] ?? 0)),
      kmw_grad: z.kmw != null ? parseFloat(z.kmw) : null,
      // KAN-128: Messwert und Einheit des Zukaufs – Vorbelegung beim Traubenverkauf aus dem Zukauf
      oechsle: z.oechsle != null ? parseFloat(z.oechsle) : null,
      mostgewicht_einheit: z.mostgewicht_einheit ?? null,
    }
  })
  // Welche Behälter haben bereits eine Kellerbuch-Charge (für Verschnitt-Warnung)
  // Direkt aus weinausbau abfragen — unabhängig von pressung_behaelter Rückverknüpfung
  const behaelterMitCharge: Record<string, { weinausbau_id: string; name: string; rebsorte?: string | null; menge_liter?: number | null; qualitaetsstufe?: string | null; herkunft_code?: string | null }[]> = {}
  for (const wa of ((rawWA ?? []) as AR[])) {
    if (wa.behaelter_id && wa.id && wa.name) {
      if (!behaelterMitCharge[wa.behaelter_id]) behaelterMitCharge[wa.behaelter_id] = []
      behaelterMitCharge[wa.behaelter_id].push({
        weinausbau_id: wa.id, name: wa.name, rebsorte: wa.rebsorte ?? null, menge_liter: wa.menge_liter ?? null,
        qualitaetsstufe: wa.qualitaetsstufe ?? null, herkunft_code: wa.herkunft_code ?? null,
      })
    }
  }
  const behOptions: BehOption[] = behRows.map(b => ({ id: b.id, name: b.anzeigeName, volumen_liter: b.volumen_liter ?? null }))
  const waOptions: WAOption[]  = ((rawWA ?? []) as AR[]).map(w => ({ id: w.id, name: w.name, jahrgang: w.jahrgang ?? null }))

  // Traubenverkauf
  const zukaufById = new Map(zukaufTrauben.map(z => [z.id, z]))
  const verkauefe: Traubenverkauf[] = rawTVLese.map((v: AR) => {
    const zukaufQuelle = v.zukauf_posten_id ? zukaufById.get(v.zukauf_posten_id) : undefined
    return {
    id: v.id,
    weingarten_id: v.weingarten_id ?? null,
    grundstueck_id: v.grundstueck_id ?? null,
    grundstueck_nr: (v.grundstueck as AR | null)?.gst_nr ?? null,
    zukauf_posten_id: v.zukauf_posten_id ?? null,
    weingarten_name: (v.weingarten as AR | null)?.name
      ?? (zukaufQuelle
            ? `Zukauf – ${zukaufQuelle.rebsorte ? formatRebsorteMitKuerzel(zukaufQuelle.rebsorte) : '–'}${zukaufQuelle.lieferant ? ' (' + zukaufQuelle.lieferant + ')' : ''}`
            : (v.zukauf_posten_id ? 'Zukauf' : '–')),
    kontakt_id: v.kontakt_id ?? null,
    kontakt_name: v.kontakt ? `${(v.kontakt as AR).vorname ?? ''} ${(v.kontakt as AR).nachname ?? ''}`.trim() : null,
    firma_id: v.firma_id ?? null,
    firma_name: (v.firma as AR | null)?.name ?? null,
    datum: v.datum,
    menge_kg: parseFloat(v.menge_kg) || 0,
    preis_per_kg: v.preis_per_kg != null ? parseFloat(v.preis_per_kg) : null,
    kmw_grad: v.kmw_grad != null ? parseFloat(v.kmw_grad) : null,
    oechsle: v.oechsle != null ? parseFloat(v.oechsle) : null,
    mostgewicht_einheit: v.mostgewicht_einheit ?? null,
    qualitaetsstufe: v.qualitaetsstufe ?? null,
    gesundheit: v.gesundheit ?? 'G',
    herkunft_code: v.herkunft_code ?? null,
    notizen: v.notizen ?? null,
    liefernummer: v.liefernummer ?? null,
    rechnungsnummer: (v.verkaufsposten as AR | null)?.rechnungsnummer ?? null,
    rechnung_storniert: !!(v.verkaufsposten as AR | null)?.storniert,
    }
  })
  // WG-Optionen für Traubenverkauf: alle WGs die in diesem Jahrgang geerntet wurden
  // (jede Lese qualifiziert automatisch für Traubenverkauf)
  const harvestedWGIds = new Set(Object.keys(harvestedKgByWG))
  const tvWGOptions: TVWGOption[] = ((rawW ?? []) as AR[])
    .filter((w: AR) => harvestedWGIds.has(w.id))
    .map((w: AR) => ({ id: w.id, name: w.name, herkunft_code: w.trauben_herkunft_code ?? null }))

  // ── Quellen-Optionen "eigene Ernte" für Traubenverkauf ───────────────────────
  // Bugfix: der Verkauf muss dieselbe Granularität (Ried/GST) wie der
  // Pressungs-Vorschlag verwenden, sonst wird eine verkaufte Menge nirgends
  // korrekt abgezogen. Für WGs mit GST-zugeordneten Lesedaten wird pro GST
  // eine Option angeboten (verfuegbareKgByGST, exakt wie im Pressungs-
  // Vorschlag); für WGs ganz ohne GST-Zuordnung fällt die Option auf WG-Ebene
  // zurück (verfuegbareKg). Beim Speichern wird passend weingarten_id UND
  // (falls vorhanden) grundstueck_id mitgeschickt.
  const tvHerkunftByWG = new Map(tvWGOptions.map(w => [w.id, w.herkunft_code]))
  const gstRowsMap = new Map<string, {
    weingarten_id: string; weingarten_name: string; grundstueck_nr: string | null
    klosterneuburger: number | null; oechsle: number | null; mostgewicht_einheit: string | null
    qualitaetsstufe: string | null
  }>()
  for (const p of parzellen) {
    if (p.grundstueck_id && !gstRowsMap.has(p.grundstueck_id)) {
      gstRowsMap.set(p.grundstueck_id, {
        weingarten_id: p.weingarten_id, weingarten_name: p.weingarten_name,
        grundstueck_nr: p.grundstueck_nr,
        // Mostgewicht mit gemessener Einheit (KAN-128) – Vorbelegung des Traubenverkaufs
        klosterneuburger: p.klosterneuburger, oechsle: p.oechsle, mostgewicht_einheit: p.mostgewicht_einheit,
        qualitaetsstufe: p.qualitaetsstufe,
      })
    }
  }
  const wgIdsMitGST = new Set([...gstRowsMap.values()].map(g => g.weingarten_id))
  const tvQuelleOptions: TVQuelleOption[] = [
    ...[...gstRowsMap.entries()].map(([gstId, g]) => ({
      compositeId: `gst:${gstId}`,
      weingarten_id: g.weingarten_id,
      grundstueck_id: gstId,
      label: g.grundstueck_nr ? `GST ${g.grundstueck_nr} · ${g.weingarten_name}` : g.weingarten_name,
      herkunft_code: tvHerkunftByWG.get(g.weingarten_id) ?? null,
      klosterneuburger: g.klosterneuburger,
      oechsle: g.oechsle,
      mostgewicht_einheit: g.mostgewicht_einheit,
      qualitaetsstufe: g.qualitaetsstufe,
      verfuegbar_kg: verfuegbareKgByGST[gstId] ?? 0,
    })),
    ...tvWGOptions
      .filter(w => !wgIdsMitGST.has(w.id))
      .map(w => {
        const p = parzellen.find(pp => pp.weingarten_id === w.id)
        return {
          compositeId: `wg:${w.id}`,
          weingarten_id: w.id,
          grundstueck_id: null,
          label: w.name,
          herkunft_code: w.herkunft_code,
          klosterneuburger: p?.klosterneuburger ?? null,
          oechsle: p?.oechsle ?? null,
          mostgewicht_einheit: p?.mostgewicht_einheit ?? null,
          qualitaetsstufe: p?.qualitaetsstufe ?? null,
          verfuegbar_kg: verfuegbareKg[w.id] ?? 0,
        }
      }),
  ]

  const tvKontaktOptions: TVKontaktOption[] = ((rawTVKontakte ?? []) as AR[]).map((k: AR) => ({
    id: k.id, name: `${k.vorname ?? ''} ${k.nachname ?? ''}`.trim(), betrieb_nr: k.betrieb_nr ?? null,
  }))
  const tvFirmaOptions: TVFirmaOption[] = ((rawTVFirmen ?? []) as AR[]).map((f: AR) => ({
    id: f.id, name: f.name, betrieb_nr: f.betrieb_nr ?? null,
  }))

  return (
    <div className="max-w-3xl">
      <div className="flex items-center gap-2 text-sm text-s112-muted mb-6">
        <Link href="/erntemeldung" className="hover:text-s112-blue-700 transition-colors">Lese</Link>
        <span>/</span>
        <span className="text-s112-text-1 font-medium">Jahrgang {(jg as AR).jahrgang}</span>
      </div>

      <div className="flex items-center justify-between mb-6">
        <h1 className="text-3xl font-semibold text-s112-blue-700 tabular-nums">{(jg as AR).jahrgang}</h1>
        {(jg as AR).abgeschlossen && (
          <span className="text-xs bg-[#F2F3F5] text-s112-text-2 px-2 py-1 rounded-full">Abgeschlossen</span>
        )}
      </div>

      {aktiveLeseMitSperre && (
        <LeseReiter
          jahrgangId={id}
          jahrgang={Number((jg as AR).jahrgang)}
          lesen={lesenMitSperre}
          aktiv={aktiveLeseMitSperre}
          writeOk={writeOk}
          adminOk={adminOk}
        />
      )}

      <ErnteDetailClient
        jahrgang={jg as AR}
        leseId={aktiveLese?.id ?? null}
        leseTitel={aktiveLese && lesen.length > 1 ? leseTitel((jg as AR).jahrgang, aktiveLese) : null}
        mehrereLesen={lesen.length > 1}
        tabellenParzellen={alleParzellen}
        stichtagHinweis={nachStichtag}
        parzellen={parzellen}
        weingaerten={weingaerten}
        gstByWeingarten={gstByWeingarten}
        amaMeldung={amaMeldung}
        hektarhoechstertrag={hektarhoechstertrag}
        pressungen={pressungen}
        wgOptions={wgOptions}
        behOptions={behOptions}
        waOptions={waOptions}
        verfuegbareKg={verfuegbareKg}
        verfuegbareKgByGST={verfuegbareKgByGST}
        zukaufTrauben={zukaufTrauben}
        behaelterMitCharge={behaelterMitCharge}
        writeOk={writeOk}
        adminOk={adminOk}
        betriebName={betrieb.name}
        csvErlaubt={csvErlaubt}
      />

      {(tvQuelleOptions.length > 0 || verkauefe.length > 0 || zukaufTrauben.length > 0) && (
        <div className="mt-6">
          <TraubenverkaufSection
            jahrgangId={id}
            leseId={aktiveLese?.id ?? null}
            jahrgang={Number((jg as AR).jahrgang)}
            bkiErlaubt={bkiErlaubt}
            verkauefe={verkauefe}
            quelleOptions={tvQuelleOptions}
            zukaufOptions={zukaufTrauben}
            kontaktOptions={tvKontaktOptions}
            firmaOptions={tvFirmaOptions}
            writeOk={writeOk}
            adminOk={adminOk}
          />
        </div>
      )}
        </div>
  )
}
