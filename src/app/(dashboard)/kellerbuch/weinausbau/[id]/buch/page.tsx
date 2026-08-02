import { createSupabaseServerClient } from '@/lib/supabase/server'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { qualitaetLabel } from '@/lib/wein/qualitaet'
import { BookOpen, Leaf, Grape, Filter, ArrowLeftRight, Wind, FlaskConical, Microscope, Award, Wine, GitMerge, type LucideIcon } from 'lucide-react'

export const metadata: Metadata = { title: 'Weinbuch – software:112' }
export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

// ── Typen für Timeline-Events ─────────────────────────────────────────────────
type EventTyp =
  | 'feldbehandlung'
  | 'ernte'
  | 'pressung'
  | 'umzug'
  | 'schwund'
  | 'kellerbehandlung'
  | 'analyse'
  | 'dac'
  | 'fuellung'
  | 'verschneidung'

interface TimelineEvent {
  datum: string        // ISO date string zum Sortieren
  typ: EventTyp
  titel: string
  details: string[]
  badge?: string
}

// ── Hilfsfunktion: Datum formatieren ─────────────────────────────────────────
function fmtDate(d: string | null | undefined) {
  if (!d) return '–'
  return new Date(d).toLocaleDateString('de-AT', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

// ── Icon + Farbe je Event-Typ ────────────────────────────────────────────────
const EVENT_STYLE: Record<EventTyp, { icon: LucideIcon; dot: string; card: string }> = {
  feldbehandlung: { icon: Leaf,           dot: 'bg-green-500',   card: 'border-green-100  bg-green-50/40'  },
  ernte:          { icon: Grape,          dot: 'bg-purple-500',  card: 'border-purple-100 bg-purple-50/40' },
  pressung:       { icon: Filter,         dot: 'bg-orange-400',  card: 'border-orange-100 bg-orange-50/40' },
  umzug:          { icon: ArrowLeftRight, dot: 'bg-blue-400',    card: 'border-blue-100   bg-blue-50/40'   },
  schwund:        { icon: Wind,           dot: 'bg-red-400',     card: 'border-red-100    bg-red-50/40'    },
  kellerbehandlung:{ icon: FlaskConical,  dot: 'bg-teal-500',    card: 'border-teal-100   bg-teal-50/40'   },
  analyse:        { icon: Microscope,     dot: 'bg-indigo-400',  card: 'border-indigo-100 bg-indigo-50/40' },
  dac:            { icon: Award,          dot: 'bg-yellow-500',  card: 'border-yellow-100 bg-yellow-50/40' },
  fuellung:       { icon: Wine,           dot: 'bg-s112-teal',   card: 'border-s112-teal/20 bg-s112-teal/5'},
  verschneidung:  { icon: GitMerge,       dot: 'bg-violet-500',  card: 'border-violet-100 bg-violet-50/40' },
}

export default async function WeinbuchPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createSupabaseServerClient()

  // ── 1. Weinausbau-Charge laden ────────────────────────────────────────────
  const { data: waRaw, error: waErr } = await (supabase.from('weinausbau') as any)
    .select('id, name, jahrgang, rebsorte, qualitaetsstufe, status, menge_liter, behaelter_id, behaelter:behaelter_id(name)')
    .eq('id', id)
    .maybeSingle()

  if (waErr || !waRaw) notFound()
  const wa = waRaw as R

  // ── 2. Alle Daten parallel laden ─────────────────────────────────────────
  const [
    prRes,      // Pressungen → Weingärten
    umRes,      // Umzüge
    kbRes,      // Kellerbehandlungen
    anRes,      // Analysen
    dacRes,     // DAC-Anträge
    fuellRes,       // Füllungen via fuellung_chargen
    fuellDirektRes, // Direkte Füllungen (Fallback alte Daten)
    wawRes,        // weinausbau_weingaerten (direkter Weingarten-Link)
    verschnEinRes, // Verschneidungen eingehend (Ziel)
    verschnAusRes, // Verschneidungen ausgehend (Quelle)
  ] = await Promise.all([
    // Pressungen + Weingärten (weingarten hat kein grundstueck_id)
    (supabase.from('pressung_behaelter') as any)
      .select(`
        menge_liter,
        pressung:pressung_id(
          id, datum, most_liter_gesamt, weinbezeichnung,
          pressung_weingaerten(
            trauben_kg, rebsorte, ernte_datum, kmw, weingarten_id,
            weingarten:weingarten_id(id, name, flaeche_ha)
          )
        )
      `)
      .eq('weinausbau_id', id),

    // Umzüge aus dieser Charge
    (supabase.from('keller_umzuege') as any)
      .select(`
        datum, menge_liter, brutto_liter, schwund_liter, zeilen_typ, umzug_batch_id, umzug_typ, notizen,
        von_behaelter:von_behaelter_id(name),
        nach_behaelter:nach_behaelter_id(name)
      `)
      .eq('von_weinausbau_id', id)
      .order('datum', { ascending: true }),

    // Kellerbehandlungen via weinausbau_id
    (supabase.from('keller_behandlungen') as any)
      .select('datum, typ_name_snapshot, menge, einheit, volumen_liter_ist, notizen, typ:typ_id(name)')
      .eq('weinausbau_id', id)
      .order('datum', { ascending: true }),

    // Analysen (weinanalysen – Migration 010)
    (supabase.from('weinanalysen') as any)
      .select('analyse_datum, labor, probe_nr, alkohol_vol, restzucker_gl, gesamtsaeure_gl, ph_wert, flüchtige_saeure_gl, freie_so2_mgl, gesamt_so2_mgl, bewertung, notizen')
      .eq('weinausbau_id', id)
      .order('analyse_datum', { ascending: true }),

    // DAC-Antrag
    (supabase.from('dac_antrag') as any)
      .select('id, bezeichnung, dac_region, status, pruefnummer, eingereicht_am, bescheid_am, created_at')
      .eq('weinausbau_id', id)
      .order('created_at', { ascending: true }),

    // Füllungen via fuellung_chargen
    (supabase.from('fuellung_chargen') as any)
      .select(`
        anteil_liter,
        fuellung:fuellung_id(
          id, datum, chargennummer, pruefnummer, name,
          anzahl_flaschen, flaschengroesse_ml, menge_liter_gefuellt
        )
      `)
      .eq('weinausbau_id', id),

    // Direkte Füllungen (Fallback für alte Daten ohne fuellung_chargen-Eintrag)
    (supabase.from('fuellungen') as any)
      .select('id, datum, chargennummer, pruefnummer, name, anzahl_flaschen, flaschengroesse_ml, menge_liter_gefuellt')
      .eq('weinausbau_id', id),

    // Verknüpfte Weingärten (direkter Pfad ohne Pressung)
    (supabase.from('weinausbau_weingaerten') as any)
      .select('weingarten_id, weingarten:weingarten_id(id, name)')
      .eq('weinausbau_id', id),

    // Verschneidungen: diese Charge als Ziel (eingehend)
    (supabase.from('verschneidungen') as any)
      .select(`datum, notizen,
        quellen:verschneidung_quellen(menge_liter, anteil_pct,
          quelle:quell_weinausbau_id(id, name, rebsorte))`)
      .eq('ziel_weinausbau_id', id)
      .order('datum', { ascending: true }),

    // Verschneidungen: diese Charge als Quelle (ausgehend)
    (supabase.from('verschneidung_quellen') as any)
      .select(`menge_liter, anteil_pct,
        verschneidung:verschneidung_id(id, datum, notizen,
          ziel:ziel_weinausbau_id(id, name))`)
      .eq('quell_weinausbau_id', id),
  ])

  const pressungen    = (prRes.data ?? []) as R[]
  const umzuegeRaw    = (umRes.data ?? []) as R[]
  let kellerBeh     = (kbRes.data ?? []) as R[]
  // Fallback: alte Einträge ohne weinausbau_id → über behaelter_id suchen
  if (kellerBeh.length === 0 && wa.behaelter_id) {
    const { data: kbFallbackRaw } = await (supabase.from('keller_behandlungen') as any)
      .select('datum, typ_name_snapshot, menge, einheit, volumen_liter_ist, notizen, typ:typ_id(name)')
      .eq('behaelter_id', wa.behaelter_id)
      .order('datum', { ascending: true })
    kellerBeh = (kbFallbackRaw ?? []) as R[]
  }
  const analysen      = (anRes.data ?? []) as R[]
  const dacAntraege   = (dacRes.data ?? []) as R[]
  const fuellChargen  = (fuellRes.data ?? []) as R[]
  // Direkte Füllungen als fuellung_chargen-ähnliche Wrapper (Fallback für alte Daten)
  const fuellChargenIds = new Set(fuellChargen.map((fc: R) => (fc.fuellung as R | null)?.id).filter(Boolean))
  const direktFuellungen = ((fuellDirektRes.data ?? []) as R[])
    .filter((f: R) => !fuellChargenIds.has(f.id))
    .map((f: R) => ({ anteil_liter: null, fuellung: f }))
  const alleFuellungen = [...fuellChargen, ...direktFuellungen]

  const verschnEin = (verschnEinRes.data ?? []) as R[]
  const verschnAus = (verschnAusRes.data ?? []) as R[]

  // Umzüge: Ziel-Behälter via Batch-Lookup ergänzen
  const batchIds = [...new Set(
    umzuegeRaw.filter(u => u.zeilen_typ === 'quelle' && u.umzug_batch_id).map(u => u.umzug_batch_id)
  )] as string[]
  const zielByBatch: Record<string, R> = {}
  if (batchIds.length > 0) {
    const { data: zielRows } = await (supabase.from('keller_umzuege') as any)
      .select('umzug_batch_id, nach_behaelter:nach_behaelter_id(name)')
      .in('umzug_batch_id', batchIds)
      .eq('zeilen_typ', 'ziel')
    for (const z of ((zielRows ?? []) as R[])) {
      if (!zielByBatch[z.umzug_batch_id]) zielByBatch[z.umzug_batch_id] = z
    }
  }
  const umzuege = umzuegeRaw.map(u => {
    if (u.zeilen_typ === 'quelle' && u.umzug_batch_id && zielByBatch[u.umzug_batch_id]) {
      return { ...u, nach_behaelter: zielByBatch[u.umzug_batch_id].nach_behaelter }
    }
    return u
  })

  // Feldbehandlungen: direkt über weingarten_id (weingarten hat kein grundstueck_id)
  // Weingarten-IDs: aus wawRes (Junction) + aus Pressungen
  const weingartenIds = new Set<string>()
  for (const r of ((wawRes.data ?? []) as R[])) {
    if (r.weingarten_id) weingartenIds.add(r.weingarten_id)
  }
  for (const pb of pressungen) {
    const p = pb.pressung as R | null
    if (!p) continue
    for (const wg of ((p.pressung_weingaerten ?? []) as R[])) {
      if (wg.weingarten_id) weingartenIds.add(wg.weingarten_id)
    }
  }

  // Ernte-Daten: echte Lesemeldungen aus `ernte_parzellen` (Ried/GST/°KMW/Qualitätsstufe),
  // verknüpft über Jahrgang + Weingärten dieser Charge — es gibt keine direkte FK von
  // ernte_parzellen auf weinausbau, daher (wie bei Feldbehandlungen) Verknüpfung über
  // die Weingärten, aus denen diese Charge gepresst wurde.
  const ernteDaten: Array<{ datum: string; details: string[] }> = []
  if (weingartenIds.size > 0) {
    const { data: jgRow } = await (supabase.from('weinjahrgaenge') as any)
      .select('id')
      .eq('jahrgang', wa.jahrgang)
      .maybeSingle()
    const jahrgangId = (jgRow as R | null)?.id

    if (jahrgangId) {
      const { data: epRaw } = await (supabase.from('ernte_parzellen') as any)
        .select(`
          ernte_datum, menge_kg, oechsle, klosterneuburger, qualitaetsstufe, lesemethode, notizen,
          weingarten:weingarten_id(name),
          grundstueck:grundstueck_id(gst_nr, katastralgemeinde)
        `)
        .eq('jahrgang_id', jahrgangId)
        .in('weingarten_id', Array.from(weingartenIds))
        .order('ernte_datum', { ascending: true })

      for (const ep of ((epRaw ?? []) as R[])) {
        if (!ep.ernte_datum) continue
        const w = ep.weingarten as R | null
        const g = ep.grundstueck as R | null
        const details: string[] = []
        if (w?.name) details.push(`Ried: ${w.name}`)
        if (g?.gst_nr) details.push(`GST ${g.gst_nr}`)
        if (ep.menge_kg) details.push(`${parseFloat(ep.menge_kg).toLocaleString('de-AT')} kg`)
        if (ep.klosterneuburger) details.push(`${ep.klosterneuburger} °KMW`)
        if (ep.oechsle) details.push(`${ep.oechsle} °Oe`)
        if (ep.qualitaetsstufe) details.push(qualitaetLabel(ep.qualitaetsstufe))
        if (ep.lesemethode) {
          details.push(
            ep.lesemethode === 'handlese' ? 'Handlese'
            : ep.lesemethode === 'maschinenlese' ? 'Maschinenlese'
            : ep.lesemethode === 'selektionslese' ? 'Selektionslese'
            : ep.lesemethode
          )
        }
        if (ep.notizen) details.push(ep.notizen)
        ernteDaten.push({ datum: ep.ernte_datum, details })
      }
    }
  }

  // Fallback für sehr alte Daten ohne ernte_parzellen-Eintrag: Ernte-Infos aus dem
  // Pressungs-Snapshot (pressung_weingaerten) ableiten, falls oben nichts gefunden wurde
  if (ernteDaten.length === 0) {
    for (const pb of pressungen) {
      const p = pb.pressung as R | null
      if (!p) continue
      for (const wg of ((p.pressung_weingaerten ?? []) as R[])) {
        if (!wg.ernte_datum) continue
        const w = wg.weingarten as R | null
        const details: string[] = []
        if (w?.name) details.push(`Weingarten: ${w.name}`)
        if (wg.trauben_kg) details.push(`${parseFloat(wg.trauben_kg).toLocaleString('de-AT')} kg`)
        if (wg.kmw) details.push(`${wg.kmw} °KMW`)
        if (wg.rebsorte) details.push(wg.rebsorte)
        ernteDaten.push({ datum: wg.ernte_datum, details })
      }
    }
  }

  // Feldbehandlungen: via RPC (umgeht RLS-Subquery-Problem bei behandlung_grundstuecke)
  // Schritt 1: Grundstück-IDs für diese Weingärten
  let feldbehandlungen: R[] = []
  if (weingartenIds.size > 0) {
    const { data: gstRaw } = await (supabase.from('grundstuecke') as any)
      .select('id').in('weingarten_id', Array.from(weingartenIds))
    const grundstueckIds = ((gstRaw ?? []) as R[]).map((g: R) => g.id as string)

    if (grundstueckIds.length > 0) {
      // Schritt 2: Tenant-ID des Weinausbaus ermitteln
      const { data: tenantRow } = await (supabase.from('weinausbau') as any)
        .select('tenant_id').eq('id', id).maybeSingle()
      const tenantId = (tenantRow as R | null)?.tenant_id as string | null

      if (tenantId) {
        // Schritt 3: RPC – läuft als security definer, prüft Tenant selbst
        const { data: rpcRaw } = await (supabase.rpc as any)(
          'get_behandlungen_fuer_grundstuecke',
          { p_grundstueck_ids: grundstueckIds, p_tenant_id: tenantId }
        )
        feldbehandlungen = ((rpcRaw ?? []) as R[]).map((r: R) => ({
          id: r.behandlung_id,
          datum: r.datum,
          art: r.art,
          psm_name: r.psm_name,
          aufwandmenge: r.aufwandmenge,
          aufwandmenge_einheit: r.aufwandmenge_einheit,
          bbch_stadium: r.bbch_stadium,
          schaderreger: r.schaderreger,
          notizen: r.notizen,
          flaeche_ha_gesamt: r.flaeche_ha_gesamt,
          weingarten: r.weingarten_name ? { name: r.weingarten_name } : null,
        }))
      }
    }

    // Fallback: behandlungen.weingarten_id direkt (falls keine grundstuecke angelegt)
    if (feldbehandlungen.length === 0) {
      const { data: fbDirektRaw } = await (supabase.from('behandlungen') as any)
        .select('id, datum, art, aufwandmenge, aufwandmenge_einheit, bbch_stadium, schaderreger, notizen, psm:psm_id(name), weingarten:weingarten_id(name)')
        .in('weingarten_id', Array.from(weingartenIds))
        .order('datum', { ascending: true })
      feldbehandlungen = ((fbDirektRaw ?? []) as R[]).map((r: R) => ({
        ...r,
        psm_name: (r.psm as R | null)?.name ?? null,
      }))
    }
  }


  // ── 3. Timeline zusammenbauen ─────────────────────────────────────────────
  const events: TimelineEvent[] = []

  // Feldbehandlungen
  for (const b of feldbehandlungen) {
    const wgName = (b.weingarten as R | null)?.name ?? null
    events.push({
      datum: b.datum,
      typ: 'feldbehandlung',
      titel: b.psm_name ?? b.art ?? 'Behandlung',
      details: [
        b.art && `Art: ${b.art}`,
        b.aufwandmenge && `${b.aufwandmenge} ${b.aufwandmenge_einheit ?? ''}`.trim(),
        b.bbch_stadium && `BBCH ${b.bbch_stadium}`,
        b.schaderreger && `Schaderreger: ${b.schaderreger}`,
        b.flaeche_ha_gesamt && `Fläche: ${parseFloat(b.flaeche_ha_gesamt).toLocaleString('de-AT')} ha`,
        wgName && `Weingarten: ${wgName}`,
        b.notizen,
      ].filter(Boolean) as string[],
    })
  }

  // Ernte-Events (aus pressung_weingaerten)
  for (const e of ernteDaten) {
    events.push({
      datum: e.datum,
      typ: 'ernte',
      titel: 'Lese',
      details: e.details,
    })
  }

  // Pressungen
  for (const pb of pressungen) {
    const p = pb.pressung as R | null
    if (!p || !p.datum) continue
    const wgListe = (p.pressung_weingaerten ?? []) as R[]
    const weingaertenText = wgListe
      .map((wg: R) => (wg.weingarten as R | null)?.name)
      .filter(Boolean).join(', ')
    events.push({
      datum: p.datum,
      typ: 'pressung',
      titel: p.weinbezeichnung ? `Pressung – ${p.weinbezeichnung}` : 'Pressung',
      details: [
        p.most_liter_gesamt && `${parseFloat(p.most_liter_gesamt).toLocaleString('de-AT')} L Most`,
        pb.menge_liter && `Anteil: ${parseFloat(pb.menge_liter).toLocaleString('de-AT')} L`,
        weingaertenText && `Weingärten: ${weingaertenText}`,
      ].filter(Boolean) as string[],
    })
  }

  // Umzüge
  for (const u of umzuege) {
    if (u.umzug_typ === 'schwund') {
      // Schwund-Buchung (z.B. Restmenge bei Abfüllung) ist kein echter Transfer zwischen
      // zwei Behältern (von_behaelter_id bleibt leer) — daher eigene Darstellung statt
      // eines verwirrenden "? → Behälter"-Eintrags.
      const behaelterName = (u.nach_behaelter as R | null)?.name ?? null
      const menge = u.schwund_liter ?? u.brutto_liter ?? u.menge_liter
      events.push({
        datum: u.datum,
        typ: 'schwund',
        titel: behaelterName ? `Schwund – ${behaelterName}` : 'Schwund',
        details: [
          menge && `${parseFloat(menge).toLocaleString('de-AT')} L Schwund`,
          u.notizen,
        ].filter(Boolean) as string[],
      })
      continue
    }
    const von = (u.von_behaelter as R | null)?.name ?? '?'
    const nach = (u.nach_behaelter as R | null)?.name ?? '?'
    const liter = u.brutto_liter ?? u.menge_liter
    events.push({
      datum: u.datum,
      typ: 'umzug',
      titel: `${von} → ${nach}`,
      details: [
        liter && `${parseFloat(liter).toLocaleString('de-AT')} L`,
        u.schwund_liter && `Schwund: ${parseFloat(u.schwund_liter).toLocaleString('de-AT')} L`,
      ].filter(Boolean) as string[],
    })
  }

  // Kellerbehandlungen
  for (const kb of kellerBeh) {
    const typName = (kb.typ as R | null)?.name ?? kb.typ_name_snapshot ?? 'Kellerbehandlung'
    events.push({
      datum: kb.datum,
      typ: 'kellerbehandlung',
      titel: typName,
      details: [
        kb.menge != null && kb.einheit ? `${parseFloat(kb.menge).toLocaleString('de-AT')} ${kb.einheit}` : null,
        kb.volumen_liter_ist ? `Volumen Ist: ${parseFloat(kb.volumen_liter_ist).toLocaleString('de-AT')} L` : null,
        kb.notizen,
      ].filter(Boolean) as string[],
    })
  }

  // Analysen – je Zeile ein Analyse-Event mit den 7 Standard-Parametern
  for (const a of analysen) {
    const params: string[] = [
      a.alkohol_vol != null       ? `Alkohol: ${parseFloat(a.alkohol_vol).toLocaleString('de-AT')} % vol` : null,
      a.restzucker_gl != null     ? `Restzucker: ${parseFloat(a.restzucker_gl).toLocaleString('de-AT')} g/l` : null,
      a.gesamtsaeure_gl != null   ? `Gesamtsäure: ${parseFloat(a.gesamtsaeure_gl).toLocaleString('de-AT')} g/l` : null,
      a.ph_wert != null           ? `pH-Wert: ${parseFloat(a.ph_wert).toLocaleString('de-AT')}` : null,
      a['flüchtige_saeure_gl'] != null ? `Flüchtige Säure: ${parseFloat(a['flüchtige_saeure_gl']).toLocaleString('de-AT')} g/l` : null,
      a.freie_so2_mgl != null     ? `Freies SO₂: ${parseFloat(a.freie_so2_mgl).toLocaleString('de-AT')} mg/l` : null,
      a.gesamt_so2_mgl != null    ? `Gesamt-SO₂: ${parseFloat(a.gesamt_so2_mgl).toLocaleString('de-AT')} mg/l` : null,
      a.probe_nr                  ? `Probe-Nr.: ${a.probe_nr}` : null,
      a.bewertung,
      a.notizen,
    ].filter(Boolean) as string[]
    events.push({
      datum: a.analyse_datum,
      typ: 'analyse',
      titel: `Analyse${a.labor ? ` – ${a.labor}` : ''}`,
      details: params,
    })
  }

  // DAC-Anträge
  for (const dac of dacAntraege) {
    // Fallback auf erstellt_am damit Anträge im Status "entwurf" / "in_pruefung" nicht verschwindeninden
    const datum = dac.bescheid_am ?? dac.eingereicht_am ?? dac.created_at ?? null
    if (!datum) continue
    const statusBadge =
      dac.status === 'genehmigt'   ? 'Genehmigt' :
      dac.status === 'eingereicht' ? 'Eingereicht' :
      dac.status === 'in_pruefung' ? 'In Prüfung' :
      dac.status === 'abgelehnt'   ? 'Abgelehnt' :
      dac.status === 'entwurf'     ? 'Entwurf' :
      dac.status
    events.push({
      datum,
      typ: 'dac',
      titel: dac.bezeichnung,
      badge: statusBadge,
      details: [
        dac.pruefnummer && `Prüfnummer: ${dac.pruefnummer}`,
        dac.eingereicht_am && `Eingereicht: ${fmtDate(dac.eingereicht_am)}`,
        dac.bescheid_am && `Bescheid: ${fmtDate(dac.bescheid_am)}`,
      ].filter(Boolean) as string[],
    })
  }

  // Verschneidungen – eingehend (diese Charge ist das Ziel / das Ergebnis)
  for (const v of verschnEin) {
    const quelleTexte = ((v.quellen ?? []) as R[]).map((q: R) => {
      const name = (q.quelle as R | null)?.name ?? '?'
      return q.anteil_pct != null
        ? `${name}: ${q.anteil_pct} % (${parseFloat(q.menge_liter ?? 0).toLocaleString('de-AT')} L)`
        : `${name}: ${parseFloat(q.menge_liter ?? 0).toLocaleString('de-AT')} L`
    })
    events.push({
      datum: v.datum,
      typ: 'verschneidung',
      titel: 'Verschneidung – eingehend',
      details: [...quelleTexte, v.notizen].filter(Boolean) as string[],
    })
  }

  // Verschneidungen – ausgehend (diese Charge hat zur Verschneidung beigetragen)
  for (const vq of verschnAus) {
    const v = vq.verschneidung as R | null
    if (!v) continue
    const zielName = (v.ziel as R | null)?.name ?? '?'
    const detail = vq.anteil_pct != null
      ? `→ ${zielName}: ${vq.anteil_pct} % (${parseFloat(vq.menge_liter ?? 0).toLocaleString('de-AT')} L)`
      : `→ ${zielName}: ${parseFloat(vq.menge_liter ?? 0).toLocaleString('de-AT')} L`
    events.push({
      datum: v.datum,
      typ: 'verschneidung',
      titel: 'Verschneidung – abgegeben',
      details: [detail, v.notizen].filter(Boolean) as string[],
    })
  }

  // Füllungen
  for (const fc of alleFuellungen) {
    const f = fc.fuellung as R | null
    if (!f || !f.datum) continue

    // Schwund, der beim Abschluss dieser Charge automatisch ausgebucht wurde (selbes Datum),
    // zur Füllung dazurechnen → zeigt die tatsächlich aus dem Behälter verarbeitete Menge
    // (z.B. 4.399,5 L abgefüllt + 0,5 L Schwund = 4.400 L verarbeitet)
    const schwundZurFuellung = umzuege.find(
      (u) => u.umzug_typ === 'schwund' && u.datum === f.datum
    )
    const schwundMenge = schwundZurFuellung
      ? parseFloat(schwundZurFuellung.schwund_liter ?? schwundZurFuellung.brutto_liter ?? '0')
      : null
    const gefuellt = f.menge_liter_gefuellt ? parseFloat(f.menge_liter_gefuellt) : null
    const verarbeitet = gefuellt != null && schwundMenge ? gefuellt + schwundMenge : null

    events.push({
      datum: f.datum,
      typ: 'fuellung',
      titel: f.name ?? 'Abfüllung',
      details: [
        f.chargennummer && `Charge: ${f.chargennummer}`,
        f.pruefnummer && `Prüfnr.: ${f.pruefnummer}`,
        f.anzahl_flaschen && f.flaschengroesse_ml
          ? `${parseInt(f.anzahl_flaschen).toLocaleString('de-AT')} × ${f.flaschengroesse_ml} ml`
          : null,
        gefuellt != null ? `${gefuellt.toLocaleString('de-AT')} L abgefüllt` : null,
        verarbeitet != null
          ? `Verarbeitete Menge aus Behälter: ${verarbeitet.toLocaleString('de-AT')} L (davon ${schwundMenge!.toLocaleString('de-AT')} L Schwund)`
          : null,
        fc.anteil_liter
          ? `Anteil diese Charge: ${parseFloat(fc.anteil_liter).toLocaleString('de-AT')} L`
          : null,
      ].filter(Boolean) as string[],
    })
  }

  // Chronologisch sortieren
  events.sort((a, b) => a.datum.localeCompare(b.datum))

  return (
    <div className="max-w-3xl space-y-6">

      {/* Breadcrumb */}
      <nav className="flex items-center gap-2 text-sm text-s112-muted flex-wrap">
        <Link href="/kellerbuch" className="hover:text-s112-teal">Kellerbuch</Link>
        <span>/</span>
        <Link href={`/kellerbuch/weinausbau/${id}`} className="hover:text-s112-teal">{wa.name}</Link>
        <span>/</span>
        <span className="text-gray-800 font-medium">Weinbuch</span>
      </nav>

      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <BookOpen size={22} strokeWidth={1.75} className="text-s112-teal" />Weinbuch
        </h1>
        <p className="text-s112-muted text-sm mt-1">
          {wa.name}
          {wa.jahrgang ? ` · Jahrgang ${wa.jahrgang}` : ''}
          {wa.rebsorte ? ` · ${wa.rebsorte}` : ''}
        </p>
        <p className="text-xs text-s112-muted mt-0.5">
          Von der Rebe bis zur Flasche – vollständige Prozesshistorie dieser Charge
        </p>
      </div>

      {/* Timeline */}
      {events.length === 0 ? (
        <div className="card p-8 text-center text-s112-muted">
          <BookOpen size={32} strokeWidth={1.5} className="mx-auto mb-3 text-s112-tertiary" />
          <p className="text-sm">Noch keine Ereignisse für diese Charge erfasst.</p>
        </div>
      ) : (
        <div className="relative">
          {/* Vertikale Linie */}
          <div className="absolute left-5 top-0 bottom-0 w-0.5 bg-s112-border/60" />

          <div className="space-y-4">
            {events.map((ev, i) => {
              const style = EVENT_STYLE[ev.typ]
              return (
                <div key={i} className="relative flex gap-4">
                  {/* Dot */}
                  <div className={`relative z-10 w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${style.dot} shadow-sm`}>
                    <style.icon size={18} strokeWidth={1.75} className="text-white" />
                  </div>

                  {/* Card */}
                  <div className={`flex-1 rounded-xl border p-4 ${style.card}`}>
                    <div className="flex items-start justify-between gap-2 flex-wrap">
                      <div>
                        <p className="font-semibold text-gray-800 text-sm">{ev.titel}</p>
                        {ev.badge && (
                          <span className="inline-block text-xs font-medium text-gray-600 bg-white/70 border border-gray-200 rounded-full px-2 py-0.5 mt-0.5">
                            {ev.badge}
                          </span>
                        )}
                      </div>
                      <span className="text-xs text-gray-500 tabular-nums shrink-0">
                        {fmtDate(ev.datum)}
                      </span>
                    </div>
                    {ev.details.length > 0 && (
                      <ul className="mt-1.5 space-y-0.5">
                        {ev.details.map((d, j) => (
                          <li key={j} className="text-xs text-gray-600">{d}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              )
            })}

            {/* Abschluss-Marker */}
            <div className="relative flex gap-4 items-center">
              <div className="relative z-10 w-10 h-10 rounded-full flex items-center justify-center shrink-0 bg-gray-200 text-gray-400 text-lg shadow-sm">
                ∎
              </div>
              <p className="text-xs text-s112-muted">Ende der Aufzeichnung</p>
            </div>
          </div>
        </div>
      )}

      {/* Legende */}
      <div className="card p-4">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Legende</p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {(Object.entries(EVENT_STYLE) as [EventTyp, typeof EVENT_STYLE[EventTyp]][]).map(([typ, style]) => (
            <div key={typ} className="flex items-center gap-1.5">
              <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${style.dot}`} />
              <span className="text-xs text-gray-600 inline-flex items-center gap-1">
                <style.icon size={13} strokeWidth={1.75} className="text-gray-500" />
                {
                typ === 'feldbehandlung' ? 'Feldbehandlung'
                : typ === 'ernte' ? 'Ernte / Lese'
                : typ === 'pressung' ? 'Pressung'
                : typ === 'umzug' ? 'Umzug'
                : typ === 'kellerbehandlung' ? 'Kellerbehandlung'
                : typ === 'analyse' ? 'Analyse'
                : typ === 'dac' ? 'DAC / Prüfnummer'
                : typ === 'verschneidung' ? 'Verschneidung'
                : typ === 'schwund' ? 'Schwund'
                : 'Füllung'
              }
              </span>
            </div>
          ))}
        </div>
      </div>

    </div>
  )
}
