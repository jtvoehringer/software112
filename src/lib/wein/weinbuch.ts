// Gemeinsame Datenlogik für das "Weinbuch" einer Weinausbau-Charge (vollständige
// Prozesshistorie von der Rebe bis zur Flasche). Ursprünglich Teil von
// kellerbuch/weinausbau/[id]/buch/page.tsx – für die Weinbuch-Sammlung
// (Auswertungen, BKI-Prüfung) am 7.8.2026 hierher ausgelagert, damit dieselbe
// (aufwändige) Abfrage-Logik für EINE Charge (Einzelseite) und für VIELE Chargen
// (Sammel-PDF) identisch wiederverwendet werden kann, statt sie zu duplizieren.

import { qualitaetLabel } from '@/lib/wein/qualitaet'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

export type EventTyp =
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

export interface TimelineEvent {
  datum: string        // ISO date string zum Sortieren
  typ: EventTyp
  titel: string
  details: string[]
  badge?: string
}

export interface WeinbuchCharge {
  id: string
  name: string
  jahrgang: number | null
  rebsorte: string | null
  qualitaetsstufe: string | null
  status: string
  menge_liter: number
  behaelter_id: string | null
  behaelter_name: string | null
}

export interface Weinbuch {
  wa: WeinbuchCharge
  events: TimelineEvent[]
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function buildWeinbuch(supabase: any, id: string, tenantId: string | null): Promise<Weinbuch | null> {
  // Explizite Tenant-Filterung zusätzlich zu RLS: RLS erlaubt Zeilen aus JEDER Mitgliedschaft
  // des Nutzers, nicht nur dem aktiv gewählten Betrieb – ohne diesen Filter könnten bei
  // Mehrfach-Mitgliedschaft Daten vom falschen Betrieb angezeigt werden.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tf = (query: any) => tenantId ? query.eq('tenant_id', tenantId) : query

  // ── 1. Weinausbau-Charge laden ────────────────────────────────────────────
  const { data: waRaw, error: waErr } = await tf((supabase.from('weinausbau') as any)
    .select('id, name, jahrgang, rebsorte, qualitaetsstufe, status, menge_liter, behaelter_id, behaelter:behaelter_id(name)')
    .eq('id', id))
    .maybeSingle()

  if (waErr || !waRaw) return null
  const waRow = waRaw as R
  const wa: WeinbuchCharge = {
    id: waRow.id,
    name: waRow.name,
    jahrgang: waRow.jahrgang,
    rebsorte: waRow.rebsorte,
    qualitaetsstufe: waRow.qualitaetsstufe,
    status: waRow.status,
    menge_liter: waRow.menge_liter,
    behaelter_id: waRow.behaelter_id,
    behaelter_name: (waRow.behaelter as R | null)?.name ?? null,
  }

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

    tf((supabase.from('keller_umzuege') as any)
      .select(`
        datum, menge_liter, brutto_liter, schwund_liter, zeilen_typ, umzug_batch_id, umzug_typ, notizen,
        von_behaelter:von_behaelter_id(name),
        nach_behaelter:nach_behaelter_id(name)
      `)
      .eq('von_weinausbau_id', id)
      .order('datum', { ascending: true })),

    tf((supabase.from('keller_behandlungen') as any)
      .select('datum, typ_name_snapshot, menge, einheit, volumen_liter_ist, notizen, typ:typ_id(name)')
      .eq('weinausbau_id', id)
      .order('datum', { ascending: true })),

    tf((supabase.from('weinanalysen') as any)
      .select('analyse_datum, labor, probe_nr, alkohol_vol, restzucker_gl, gesamtsaeure_gl, ph_wert, flüchtige_saeure_gl, freie_so2_mgl, gesamt_so2_mgl, bewertung, notizen')
      .eq('weinausbau_id', id)
      .order('analyse_datum', { ascending: true })),

    tf((supabase.from('dac_antrag') as any)
      .select('id, bezeichnung, dac_region, status, pruefnummer, eingereicht_am, bescheid_am, created_at')
      .eq('weinausbau_id', id)
      .order('created_at', { ascending: true })),

    tf((supabase.from('fuellung_chargen') as any)
      .select(`
        anteil_liter,
        fuellung:fuellung_id(
          id, datum, chargennummer, pruefnummer, name,
          anzahl_flaschen, flaschengroesse_ml, menge_liter_gefuellt
        )
      `)
      .eq('weinausbau_id', id)),

    tf((supabase.from('fuellungen') as any)
      .select('id, datum, chargennummer, pruefnummer, name, anzahl_flaschen, flaschengroesse_ml, menge_liter_gefuellt')
      .eq('weinausbau_id', id)),

    tf((supabase.from('weinausbau_weingaerten') as any)
      .select('weingarten_id, weingarten:weingarten_id(id, name)')
      .eq('weinausbau_id', id)),

    tf((supabase.from('verschneidungen') as any)
      .select(`datum, notizen,
        quellen:verschneidung_quellen(menge_liter, anteil_pct,
          quelle:quell_weinausbau_id(id, name, rebsorte))`)
      .eq('ziel_weinausbau_id', id)
      .order('datum', { ascending: true })),

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
    const { data: kbFallbackRaw } = await tf((supabase.from('keller_behandlungen') as any)
      .select('datum, typ_name_snapshot, menge, einheit, volumen_liter_ist, notizen, typ:typ_id(name)')
      .eq('behaelter_id', wa.behaelter_id)
      .order('datum', { ascending: true }))
    kellerBeh = (kbFallbackRaw ?? []) as R[]
  }
  const analysen      = (anRes.data ?? []) as R[]
  const dacAntraege   = (dacRes.data ?? []) as R[]
  const fuellChargen  = (fuellRes.data ?? []) as R[]
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
    const { data: zielRows } = await tf((supabase.from('keller_umzuege') as any)
      .select('umzug_batch_id, nach_behaelter:nach_behaelter_id(name)')
      .in('umzug_batch_id', batchIds)
      .eq('zeilen_typ', 'ziel'))
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

  const ernteDaten: Array<{ datum: string; details: string[] }> = []
  if (weingartenIds.size > 0) {
    const { data: jgRow } = await tf((supabase.from('weinjahrgaenge') as any)
      .select('id')
      .eq('jahrgang', wa.jahrgang))
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
  let feldbehandlungen: R[] = []
  if (weingartenIds.size > 0) {
    const { data: gstRaw } = await tf((supabase.from('grundstuecke') as any)
      .select('id').in('weingarten_id', Array.from(weingartenIds)))
    const grundstueckIds = ((gstRaw ?? []) as R[]).map((g: R) => g.id as string)

    if (grundstueckIds.length > 0) {
      const { data: tenantRow } = await tf((supabase.from('weinausbau') as any)
        .select('tenant_id').eq('id', id))
        .maybeSingle()
      const rpcTenantId = (tenantRow as R | null)?.tenant_id as string | null

      if (rpcTenantId) {
        const { data: rpcRaw } = await (supabase.rpc as any)(
          'get_behandlungen_fuer_grundstuecke',
          { p_grundstueck_ids: grundstueckIds, p_tenant_id: rpcTenantId }
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

    if (feldbehandlungen.length === 0) {
      const { data: fbDirektRaw } = await tf((supabase.from('behandlungen') as any)
        .select('id, datum, art, aufwandmenge, aufwandmenge_einheit, bbch_stadium, schaderreger, notizen, psm:psm_id(name), weingarten:weingarten_id(name)')
        .in('weingarten_id', Array.from(weingartenIds))
        .order('datum', { ascending: true }))
      feldbehandlungen = ((fbDirektRaw ?? []) as R[]).map((r: R) => ({
        ...r,
        psm_name: (r.psm as R | null)?.name ?? null,
      }))
    }
  }

  // ── 3. Timeline zusammenbauen ─────────────────────────────────────────────
  const events: TimelineEvent[] = []

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

  for (const e of ernteDaten) {
    events.push({ datum: e.datum, typ: 'ernte', titel: 'Lese', details: e.details })
  }

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

  for (const u of umzuege) {
    if (u.umzug_typ === 'schwund') {
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

  for (const dac of dacAntraege) {
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
        dac.eingereicht_am && `Eingereicht: ${new Date(dac.eingereicht_am).toLocaleDateString('de-AT')}`,
        dac.bescheid_am && `Bescheid: ${new Date(dac.bescheid_am).toLocaleDateString('de-AT')}`,
      ].filter(Boolean) as string[],
    })
  }

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

  for (const fc of alleFuellungen) {
    const f = fc.fuellung as R | null
    if (!f || !f.datum) continue

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

  events.sort((a, b) => a.datum.localeCompare(b.datum))

  return { wa, events }
}
