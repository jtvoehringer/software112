import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentUserRole, canWrite, canAdmin } from '@/lib/auth/roles'
import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import Link from 'next/link'
import ErnteDetailClient from './ErnteDetailClient'

export const metadata: Metadata = { title: 'Jahrgang – software:112' }
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

  // Jahrgang
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: jg } = await (supabase.from('weinjahrgaenge') as any)
    .select('*').eq('id', id).single()
  if (!jg) notFound()

  // Ernte-Parzellen
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: rawP } = await (supabase.from('ernte_parzellen') as any)
    .select('id, weingarten_id, ernte_datum, menge_kg, menge_hl, oechsle, klosterneuburger, qualitaetsstufe, lesemethode, notizen, weingarten:weingarten_id(name, rebsorte)')
    .eq('jahrgang_id', id)
    .order('ernte_datum', { ascending: false })

  const parzellen: ErnteParzelle[] = ((rawP ?? []) as AR[]).map(p => ({
    id:                p.id,
    weingarten_id:     p.weingarten_id,
    weingarten_name:   p.weingarten?.name ?? '–',
    weingarten_rebsorte: p.weingarten?.rebsorte ?? null,
    ernte_datum:       p.ernte_datum,
    menge_kg:          p.menge_kg,
    menge_hl:          p.menge_hl,
    oechsle:           p.oechsle,
    klosterneuburger:  p.klosterneuburger,
    qualitaetsstufe:   p.qualitaetsstufe,
    lesemethode:       p.lesemethode,
    notizen:           p.notizen,
  }))

  // Weingärten für Auswahl
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: rawW } = await (supabase.from('weingarten') as any)
    .select('id, name, rebsorte, lagen:lage_id(name)')
    .eq('aktiv', true).order('name')
  const weingaerten: WeingartenOpt[] = ((rawW ?? []) as AR[]).map(w => ({
    id: w.id, name: w.name, rebsorte: w.rebsorte ?? null,
    lage_name: w.lagen?.name ?? null,
  }))

  // AMA Meldung
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: rawA } = await (supabase.from('ama_erntemeldungen') as any)
    .select('id, status, gesamtmenge_kg, gesamtmenge_hl, n8n_status, n8n_fehler, eingereicht_am')
    .eq('jahrgang_id', id).maybeSingle()

  let amaMeldung: AMAMeldung | null = null
  if (rawA) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: rawPos } = await (supabase.from('ama_meldepositionen') as any)
      .select('rebsorte_name, flaeche_ha, menge_kg').eq('meldung_id', (rawA as AR).id)
    amaMeldung = {
      ...(rawA as AR),
      positionen: (rawPos ?? []) as AMAMeldung['positionen'],
    }
  }

  return (
    <div className="max-w-3xl">
      <div className="flex items-center gap-2 text-sm text-s112-muted mb-6">
        <Link href="/erntemeldung" className="hover:text-s112-teal transition-colors">Erntemeldung</Link>
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
        writeOk={writeOk}
        adminOk={adminOk}
      />
    </div>
  )
}
