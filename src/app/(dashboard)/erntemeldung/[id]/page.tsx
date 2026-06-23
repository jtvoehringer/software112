import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentUserRole, canWrite, canAdmin } from '@/lib/auth/roles'
import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import Link from 'next/link'
import ErnteDetailClient from './ErnteDetailClient'
import type { Pressung, PressungWG, PressungBeh, WGOption, BehOption, WAOption } from './PressungSection'
import TraubenverkaufSection, { type Traubenverkauf, type TVWGOption, type TVKontaktOption, type TVFirmaOption, type TVLeseParzelle } from './TraubenverkaufSection'

export const metadata: Metadata = { title: 'Lese – software:112' }
export const dynamic = 'force-dynamic'

interface Props { params: Promise<{ id: string }> }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AR = Record<string, any>

export type GSTOpt = { id: string; gst_nr: string; rebsorte: string | null; flaeche_ha: number | null }
export type ErnteParzelle = {
  id: string; weingarten_id: string; weingarten_name: string; weingarten_rebsorte: string | null
  grundstueck_id: string | null; grundstueck_nr: string | null; grundstueck_rebsorte: string | null
  ernte_datum: string | null; menge_kg: number | null; menge_hl: number | null
  oechsle: number | null; klosterneuburger: number | null
  qualitaetsstufe: string | null; lesemethode: string | null; notizen: string | null
}
export type WeingartenOpt = { id: string; name: string; rebsorte: string | null; lage_name: string | null }
export type AMAMeldung = {
  id: string; status: string; gesamtmenge_kg: number | null; gesamtmenge_hl: number | null
  n8n_status: string | null; n8n_fehler: string | null; eingereicht_am: string | null
  positionen: { rebsorte_name: string; flaeche_ha: number | null; menge_kg: number | null }[]
}

export default async function ErnteDetailPage({ params }: Props) {
  const { id } = await params
  const supabase = await createSupabaseServerClient()
  const role = await getCurrentUserRole()
  const writeOk = canWrite(role)
  const adminOk = canAdmin(role)

  const [
    { data: jg },
    { data: rawP },
    { data: rawW },
    { data: rawA },
    { data: rawPressungen },
    { data: rawBeh },
    { data: rawWA },
    { data: rawGST },
    { data: rawTV },
    { data: rawTVKontakte },
    { data: rawTVFirmen },
  ] = await Promise.all([
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase.from('weinjahrgaenge') as any).select('*').eq('id', id).single(),

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase.from('ernte_parzellen') as any)
      .select('id, weingarten_id, grundstueck_id, ernte_datum, menge_kg, menge_hl, oechsle, klosterneuburger, qualitaetsstufe, lesemethode, notizen, weingarten:weingarten_id(name, rebsorte), grundstueck:grundstueck_id(gst_nr, rebsorte)')
      .eq('jahrgang_id', id).order('ernte_datum', { ascending: false }),

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase.from('weingarten') as any)
      .select('id, name, rebsorte, trauben_verkauf, trauben_herkunft_code, lagen:lage_id(name)').eq('aktiv', true).order('name'),

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase.from('ama_erntemeldungen') as any)
      .select('id, status, gesamtmenge_kg, gesamtmenge_hl, n8n_status, n8n_fehler, eingereicht_am')
      .eq('jahrgang_id', id).maybeSingle(),

    // Pressungen mit Sub-Tabellen
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase.from('pressungen') as any)
      .select(`id, datum, most_liter_gesamt, weinbezeichnung, notizen, kmw_grad,
        weingaerten:pressung_weingaerten(id, weingarten_id, grundstueck_id, trauben_kg, rebsorte, notizen, weingarten:weingarten_id(name)),
        behaelter:pressung_behaelter(id, behaelter_id, weinausbau_id, menge_liter, notizen, behaelter:behaelter_id(name), weinausbau:weinausbau_id(name, jahrgang))`)
      .eq('jahrgang_id', id).order('datum', { ascending: false }),

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase.from('behaelter') as any).select('id, name').eq('aktiv', true).order('name'),

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase.from('weinausbau') as any)
      .select('id, name, jahrgang').eq('aktiv', true).neq('status', 'abgeschlossen').order('name'),

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase.from('grundstuecke') as any)
      .select('id, weingarten_id, gst_nr, rebsorte, flaeche_ha').eq('status', 'aktiv').order('gst_nr'),

    // Traubenverkäufe dieses Jahrgangs
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase.from('traubenverkauf') as any)
      .select('id, weingarten_id, grundstueck_id, kontakt_id, firma_id, datum, menge_kg, preis_per_kg, kmw_grad, qualitaetsstufe, gesundheit, herkunft_code, notizen, liefernummer, weingarten:weingarten_id(name), kontakt:kontakt_id(vorname, nachname), firma:firma_id(name)')
      .eq('jahrgang_id', id).order('datum', { ascending: false }),

    // Kontakte + Firmen für Abnehmer-Dropdown
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase.from('kontakte') as any).select('id, vorname, nachname, betrieb_nr').order('nachname'),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase.from('firmen') as any).select('id, name, betrieb_nr').order('name'),
  ])

  if (!jg) notFound()

  const parzellen: ErnteParzelle[] = ((rawP ?? []) as AR[]).map(p => ({
    id: p.id, weingarten_id: p.weingarten_id,
    weingarten_name: p.weingarten?.name ?? '–', weingarten_rebsorte: p.weingarten?.rebsorte ?? null,
    grundstueck_id: p.grundstueck_id ?? null, grundstueck_nr: p.grundstueck?.gst_nr ?? null, grundstueck_rebsorte: p.grundstueck?.rebsorte ?? null,
    ernte_datum: p.ernte_datum, menge_kg: p.menge_kg, menge_hl: p.menge_hl,
    oechsle: p.oechsle, klosterneuburger: p.klosterneuburger,
    qualitaetsstufe: p.qualitaetsstufe, lesemethode: p.lesemethode, notizen: p.notizen,
  }))

  const weingaerten: WeingartenOpt[] = ((rawW ?? []) as AR[]).map(w => ({
    id: w.id, name: w.name, rebsorte: w.rebsorte ?? null, lage_name: w.lagen?.name ?? null,
  }))

  const gstByWeingarten: Record<string, GSTOpt[]> = {}
  for (const g of ((rawGST ?? []) as AR[])) {
    if (!gstByWeingarten[g.weingarten_id]) gstByWeingarten[g.weingarten_id] = []
    gstByWeingarten[g.weingarten_id].push({ id: g.id, gst_nr: g.gst_nr, rebsorte: g.rebsorte ?? null, flaeche_ha: g.flaeche_ha ?? null })
  }

  let amaMeldung: AMAMeldung | null = null
  if (rawA) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: rawPos } = await (supabase.from('ama_meldepositionen') as any)
      .select('rebsorte_name, flaeche_ha, menge_kg').eq('meldung_id', (rawA as AR).id)
    amaMeldung = { ...(rawA as AR), positionen: (rawPos ?? []) as AMAMeldung['positionen'] } as AMAMeldung
  }

  const pressungen: Pressung[] = ((rawPressungen ?? []) as AR[]).map(p => ({
    id: p.id, datum: p.datum, most_liter_gesamt: p.most_liter_gesamt ?? null,
    weinbezeichnung: p.weinbezeichnung ?? null, notizen: p.notizen ?? null, kmw_grad: p.kmw_grad ?? null,
    weingaerten: ((p.weingaerten ?? []) as AR[]).map((w: AR): PressungWG => ({
      id: w.id, weingarten_id: w.weingarten_id,
      grundstueck_id: w.grundstueck_id ?? null,
      weingarten_name: w.weingarten?.name ?? '–',
      trauben_kg: w.trauben_kg, rebsorte: w.rebsorte ?? null, notizen: w.notizen ?? null,
    })),
    behaelter: ((p.behaelter ?? []) as AR[]).map((b: AR): PressungBeh => ({
      id: b.id, behaelter_id: b.behaelter_id ?? null,
      behaelter_name: b.behaelter?.name ?? null,
      weinausbau_id: b.weinausbau_id ?? null,
      weinausbau_name: b.weinausbau?.name ?? null,
      menge_liter: b.menge_liter ?? null, notizen: b.notizen ?? null,
    })),
  }))

  const wgOptions: WGOption[]  = weingaerten.map(w => ({ id: w.id, name: w.name, rebsorte: w.rebsorte }))

  // Verfügbare kg pro WG: geerntet − verpresst (für alle Pressungen dieses Jahrgangs)
  const harvestedKgByWG: Record<string, number> = {}
  for (const p of parzellen) {
    if (p.menge_kg) harvestedKgByWG[p.weingarten_id] = (harvestedKgByWG[p.weingarten_id] ?? 0) + p.menge_kg
  }
  const pressedKgByWG: Record<string, number> = {}
  for (const p of pressungen) {
    for (const w of p.weingaerten) {
      pressedKgByWG[w.weingarten_id] = (pressedKgByWG[w.weingarten_id] ?? 0) + w.trauben_kg
    }
  }
  // Verkaufte kg pro WG aus Traubenverkauf (dieses Jahrgangs) abziehen
  const soldKgByWG: Record<string, number> = {}
  for (const v of ((rawTV ?? []) as AR[])) {
    soldKgByWG[v.weingarten_id] = (soldKgByWG[v.weingarten_id] ?? 0) + (parseFloat(v.menge_kg) || 0)
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
  for (const v of ((rawTV ?? []) as AR[])) {
    if (v.grundstueck_id)
      soldKgByGST[v.grundstueck_id] = (soldKgByGST[v.grundstueck_id] ?? 0) + (parseFloat(v.menge_kg) || 0)
  }
  const verfuegbareKgByGST: Record<string, number> = {}
  for (const gstId of Object.keys(harvestedKgByGST)) {
    verfuegbareKgByGST[gstId] = Math.max(0, (harvestedKgByGST[gstId] ?? 0) - (pressedKgByGST[gstId] ?? 0) - (soldKgByGST[gstId] ?? 0))
  }
  const behOptions: BehOption[] = ((rawBeh ?? []) as AR[]).map(b => ({ id: b.id, name: b.name }))
  const waOptions: WAOption[]  = ((rawWA ?? []) as AR[]).map(w => ({ id: w.id, name: w.name, jahrgang: w.jahrgang ?? null }))

  // Traubenverkauf
  const verkauefe: Traubenverkauf[] = ((rawTV ?? []) as AR[]).map((v: AR) => ({
    id: v.id,
    weingarten_id: v.weingarten_id,
    weingarten_name: (v.weingarten as AR | null)?.name ?? '–',
    kontakt_id: v.kontakt_id ?? null,
    kontakt_name: v.kontakt ? `${(v.kontakt as AR).vorname ?? ''} ${(v.kontakt as AR).nachname ?? ''}`.trim() : null,
    firma_id: v.firma_id ?? null,
    firma_name: (v.firma as AR | null)?.name ?? null,
    datum: v.datum,
    menge_kg: parseFloat(v.menge_kg) || 0,
    preis_per_kg: v.preis_per_kg != null ? parseFloat(v.preis_per_kg) : null,
    kmw_grad: v.kmw_grad != null ? parseFloat(v.kmw_grad) : null,
    qualitaetsstufe: v.qualitaetsstufe ?? null,
    gesundheit: v.gesundheit ?? 'G',
    herkunft_code: v.herkunft_code ?? null,
    notizen: v.notizen ?? null,
    liefernummer: v.liefernummer ?? null,
  }))
  // WG-Optionen für Traubenverkauf: alle WGs die in diesem Jahrgang geerntet wurden
  // (jede Lese qualifiziert automatisch für Traubenverkauf)
  const harvestedWGIds = new Set(Object.keys(harvestedKgByWG))
  const tvWGOptions: TVWGOption[] = ((rawW ?? []) as AR[])
    .filter((w: AR) => harvestedWGIds.has(w.id))
    .map((w: AR) => ({ id: w.id, name: w.name, herkunft_code: w.trauben_herkunft_code ?? null }))
  // Lesedaten für Traubenverkauf-Formular (KMW + Qualität nach Ried)
  const tvLeseParzellen: TVLeseParzelle[] = parzellen.map(p => ({
    weingarten_id: p.weingarten_id,
    klosterneuburger: p.klosterneuburger,
    qualitaetsstufe: p.qualitaetsstufe,
  }))

  const tvKontaktOptions: TVKontaktOption[] = ((rawTVKontakte ?? []) as AR[]).map((k: AR) => ({
    id: k.id, name: `${k.vorname ?? ''} ${k.nachname ?? ''}`.trim(), betrieb_nr: k.betrieb_nr ?? null,
  }))
  const tvFirmaOptions: TVFirmaOption[] = ((rawTVFirmen ?? []) as AR[]).map((f: AR) => ({
    id: f.id, name: f.name, betrieb_nr: f.betrieb_nr ?? null,
  }))

  return (
    <div className="max-w-3xl">
      <div className="flex items-center gap-2 text-sm text-s112-muted mb-6">
        <Link href="/erntemeldung" className="hover:text-s112-teal transition-colors">Lese</Link>
        <span>/</span>
        <span className="text-gray-700 font-medium">Jahrgang {(jg as AR).jahrgang}</span>
      </div>

      <div className="flex items-center justify-between mb-6">
        <h1 className="text-3xl font-bold text-s112-teal tabular-nums">{(jg as AR).jahrgang}</h1>
        {(jg as AR).abgeschlossen && (
          <span className="text-xs bg-gray-100 text-gray-500 px-2 py-1 rounded-full">Abgeschlossen</span>
        )}
      </div>

      <ErnteDetailClient
        jahrgang={jg as AR}
        parzellen={parzellen}
        weingaerten={weingaerten}
        gstByWeingarten={gstByWeingarten}
        amaMeldung={amaMeldung}
        pressungen={pressungen}
        wgOptions={wgOptions}
        behOptions={behOptions}
        waOptions={waOptions}
        verfuegbareKg={verfuegbareKg}
        verfuegbareKgByGST={verfuegbareKgByGST}
        writeOk={writeOk}
        adminOk={adminOk}
      />

      {(tvWGOptions.length > 0 || verkauefe.length > 0) && (
        <div className="mt-6">
          <TraubenverkaufSection
            jahrgangId={id}
            verkauefe={verkauefe}
            wgOptions={tvWGOptions}
            leseParzellen={tvLeseParzellen}
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
