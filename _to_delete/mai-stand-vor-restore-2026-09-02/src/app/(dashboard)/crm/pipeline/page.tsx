import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentUserRole, canWrite } from '@/lib/auth/roles'
import type { Metadata } from 'next'
import PipelineClient from './PipelineClient'
import type { PipelineEintragRow } from '@/lib/crm/types'

export const metadata: Metadata = { title: 'Pipeline – software:112' }
export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

export default async function PipelinePage() {
  const supabase = await createSupabaseServerClient()
  const role    = await getCurrentUserRole()
  const writeOk = canWrite(role)

  const [{ data: pRaw }, { data: kRaw }, { data: fRaw }] = await Promise.all([
    (supabase.from('pipeline_eintraege') as any)
      .select('id, stufe, titel, kategorie, wert_euro, wahrscheinlichkeit, erwartetes_datum, erledigt, erledigt_am, notizen, aktualisiert_am, kontakt_id, kontakte:kontakt_id(vorname,nachname), firma_id, firmen:firma_id(name)')
      .order('aktualisiert_am', { ascending: false }),

    (supabase.from('kontakte') as any)
      .select('id, vorname, nachname')
      .eq('aktiv', true)
      .order('nachname'),

    (supabase.from('firmen') as any)
      .select('id, name')
      .eq('aktiv', true)
      .order('name'),
  ])

  const eintraege: PipelineEintragRow[] = ((pRaw ?? []) as R[]).map(p => {
    const k = p.kontakte as R | null
    const f = p.firmen as R | null
    return {
      id:                  p.id,
      stufe:               p.stufe,
      titel:               p.titel,
      kategorie:           p.kategorie ?? null,
      wert_euro:           p.wert_euro ?? null,
      wahrscheinlichkeit:  p.wahrscheinlichkeit ?? null,
      erwartetes_datum:    p.erwartetes_datum ?? null,
      erledigt:            p.erledigt ?? false,
      erledigt_am:         p.erledigt_am ?? null,
      notizen:             p.notizen ?? null,
      kontakt_id:          p.kontakt_id ?? null,
      kontakt_name:        k ? [k.vorname, k.nachname].filter(Boolean).join(' ') : null,
      firma_id:            p.firma_id ?? null,
      firma_name:          f?.name ?? null,
      aktualisiert_am:     p.aktualisiert_am,
    }
  })

  const kontakte = ((kRaw ?? []) as R[]).map(k => ({
    id: k.id,
    name: [k.vorname, k.nachname].filter(Boolean).join(' '),
  }))

  const firmen = ((fRaw ?? []) as R[]).map(f => ({ id: f.id, name: f.name }))

  const aktiv = eintraege.filter(e => !['verloren', 'stammkunde'].includes(e.stufe)).length

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Verkaufs-Pipeline</h1>
          <p className="text-sm text-s112-muted mt-0.5">Chancen verfolgen · Stufen managen</p>
        </div>
        <span className="text-sm text-s112-muted">{aktiv} aktive Chancen</span>
      </div>

      <PipelineClient
        eintraege={eintraege}
        kontakte={kontakte}
        firmen={firmen}
        writeOk={writeOk}
      />
    </div>
  )
}
