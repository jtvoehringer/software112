import { createSupabaseServerClient } from '@/lib/supabase/server'
import type { Metadata } from 'next'
import Link from 'next/link'
import BerichteClient from './BerichteClient'

export const metadata: Metadata = { title: 'Behandlungs-Berichte – software:112' }
export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AR = Record<string, any>

export type BehandlungReport = {
  id: string
  datum: string
  datum_bis: string | null
  art: string
  menge_gesamt: number | null
  menge_einheit: string | null
  psm_id: string | null
  psm_name: string | null
  cu_gehalt_pct: number | null
  oeko_zugelassen: boolean
  notizen: string | null
  grundstuecke: {
    grundstueck_id: string
    flaeche_ha: number
    gst_nr: string
    weingarten_id: string
    weingarten_name: string
    lage_id: string | null
    lage_name: string | null
  }[]
}

export default async function BerichtePage() {
  const supabase = await createSupabaseServerClient()

  // Behandlungen mit Grundstücken, Weingärten, Lagen
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: rawB } = await (supabase.from('behandlungen') as any)
    .select(`
      id, datum, datum_bis, art, menge_gesamt, menge_einheit, notizen,
      psm:psm_id(name, cu_gehalt_pct, oeko_zugelassen)
    `)
    .order('datum', { ascending: false })

  // Behandlung-Grundstücke mit Weingarten & Lage
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: rawBG } = await (supabase.from('behandlung_grundstuecke') as any)
    .select(`
      behandlung_id, grundstueck_id, flaeche_ha,
      grundstueck:grundstueck_id(
        gst_nr,
        weingarten:weingarten_id(id, name, lage_id, lagen:lage_id(name))
      )
    `)

  // Grundstücke nach Behandlung gruppieren
  const bgByBeh = new Map<string, BehandlungReport['grundstuecke']>()
  for (const bg of ((rawBG ?? []) as AR[])) {
    const arr = bgByBeh.get(bg.behandlung_id) ?? []
    const wg = bg.grundstueck?.weingarten
    arr.push({
      grundstueck_id:  bg.grundstueck_id,
      flaeche_ha:      bg.flaeche_ha ?? 0,
      gst_nr:          bg.grundstueck?.gst_nr ?? '–',
      weingarten_id:   wg?.id ?? '',
      weingarten_name: wg?.name ?? '–',
      lage_id:         wg?.lage_id ?? null,
      lage_name:       wg?.lagen?.name ?? null,
    })
    bgByBeh.set(bg.behandlung_id, arr)
  }

  const behandlungen: BehandlungReport[] = ((rawB ?? []) as AR[]).map(b => ({
    id:             b.id,
    datum:          b.datum,
    datum_bis:      b.datum_bis ?? null,
    art:            b.art ?? 'spritzung',
    menge_gesamt:   b.menge_gesamt ?? null,
    menge_einheit:  b.menge_einheit ?? null,
    psm_id:         b.psm?.id ?? null,
    psm_name:       b.psm?.name ?? null,
    cu_gehalt_pct:  b.psm?.cu_gehalt_pct ?? null,
    oeko_zugelassen: b.psm?.oeko_zugelassen ?? false,
    notizen:        b.notizen ?? null,
    grundstuecke:   bgByBeh.get(b.id) ?? [],
  }))

  return (
    <div>
      <div className="flex items-center gap-2 text-sm text-s112-muted mb-6">
        <Link href="/behandlungen" className="hover:text-s112-teal transition-colors">Behandlungen</Link>
        <span>/</span>
        <span className="text-gray-700 font-medium">Berichte</span>
      </div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Berichte & Aufzeichnungen</h1>
          <p className="text-sm text-s112-muted mt-0.5">Anteilige Mittelverteilung · Cu-Bilanz · Behördennachweise</p>
        </div>
      </div>
      <BerichteClient behandlungen={behandlungen} />
    </div>
  )
}
