import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentUserRole, canWrite, canAdmin } from '@/lib/auth/roles'
import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import Link from 'next/link'
import ErnteDetailClient from './ErnteDetailClient'
import type { Pressung, PressungWG, PressungBeh, WGOption, BehOption, WAOption } from './PressungSection'

export const metadata: Metadata = { title: 'Lese – software:112' }
export const dynamic = 'force-dynamic'

interface Props { params: Promise<{ id: string }> }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AR = Record<string, any>

export type ErnteParzelle = {
  id: string; weingarten_id: string; weingarten_name: string; weingarten_rebsorte: string | null
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
  ] = await Promise.all([
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase.from('weinjahrgaenge') as any).select('*').eq('id', id).single(),

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase.from('ernte_parzellen') as any)
      .select('id, weingarten_id, ernte_datum, menge_kg, menge_hl, oechsle, klosterneuburger, qualitaetsstufe, lesemethode, notizen, weingarten:weingarten_id(name, rebsorte)')
      .eq('jahrgang_id', id).order('ernte_datum', { ascending: false }),

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase.from('weingarten') as any)
      .select('id, name, rebsorte, lagen:lage_id(name)').eq('aktiv', true).order('name'),

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase.from('ama_erntemeldungen') as any)
      .select('id, status, gesamtmenge_kg, gesamtmenge_hl, n8n_status, n8n_fehler, eingereicht_am')
      .eq('jahrgang_id', id).maybeSingle(),

    // Pressungen mit Sub-Tabellen
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase.from('pressungen') as any)
      .select(`id, datum, most_liter_gesamt, weinbezeichnung, notizen, kmw_grad,
        weingaerten:pressung_weingaerten(id, weingarten_id, trauben_kg, rebsorte, notizen, weingarten:weingarten_id(name)),
        behaelter:pressung_behaelter(id, behaelter_id, weinausbau_id, menge_liter, notizen, behaelter:behaelter_id(name), weinausbau:weinausbau_id(name, jahrgang))`)
      .eq('jahrgang_id', id).order('datum', { ascending: false }),

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase.from('behaelter') as any).select('id, name').eq('aktiv', true).order('name'),

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase.from('weinausbau') as any)
      .select('id, name, jahrgang').eq('aktiv', true).neq('status', 'abgeschlossen').order('name'),
  ])

  if (!jg) notFound()

  const parzellen: ErnteParzelle[] = ((rawP ?? []) as AR[]).map(p => ({
    id: p.id, weingarten_id: p.weingarten_id,
    weingarten_name: p.weingarten?.name ?? '–', weingarten_rebsorte: p.weingarten?.rebsorte ?? null,
    ernte_datum: p.ernte_datum, menge_kg: p.menge_kg, menge_hl: p.menge_hl,
    oechsle: p.oechsle, klosterneuburger: p.klosterneuburger,
    qualitaetsstufe: p.qualitaetsstufe, lesemethode: p.lesemethode, notizen: p.notizen,
  }))

  const weingaerten: WeingartenOpt[] = ((rawW ?? []) as AR[]).map(w => ({
    id: w.id, name: w.name, rebsorte: w.rebsorte ?? null, lage_name: w.lagen?.name ?? null,
  }))

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
  const verfuegbareKg: Record<string, number> = {}
  for (const wgId of Object.keys(harvestedKgByWG)) {
    verfuegbareKg[wgId] = (harvestedKgByWG[wgId] ?? 0) - (pressedKgByWG[wgId] ?? 0)
  }
  const behOptions: BehOption[] = ((rawBeh ?? []) as AR[]).map(b => ({ id: b.id, name: b.name }))
  const waOptions: WAOption[]  = ((rawWA ?? []) as AR[]).map(w => ({ id: w.id, name: w.name, jahrgang: w.jahrgang ?? null }))

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
        amaMeldung={amaMeldung}
        pressungen={pressungen}
        wgOptions={wgOptions}
        behOptions={behOptions}
        waOptions={waOptions}
        verfuegbareKg={verfuegbareKg}
        writeOk={writeOk}
        adminOk={adminOk}
      />
    </div>
  )
}
