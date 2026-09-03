import { createSupabaseServerClient } from '@/lib/supabase/server'
import { alle } from '@/lib/supabase/alle'
import { getCurrentUserRole, canWrite, getCurrentMembership } from '@/lib/auth/roles'
import type { Metadata } from 'next'
import Link from 'next/link'
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
  const membership = await getCurrentMembership()
  const tenantId = membership?.tenantId ?? null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tf = (query: any) => tenantId ? query.eq('tenant_id', tenantId) : query

  const [{ data: pRaw }, { data: kRaw }, { data: fRaw }] = await Promise.all([
    tf((supabase.from('pipeline_eintraege') as any)
      .select('id, stufe, titel, kategorie, wert_euro, wahrscheinlichkeit, erwartetes_datum, ganztags, uhrzeit_von, uhrzeit_bis, erledigt, erledigt_am, notizen, aktualisiert_am, kontakt_id, kontakte:kontakt_id(vorname,nachname), firma_id, firmen:firma_id(name)')
      .order('aktualisiert_am', { ascending: false })),

    alle(tf((supabase.from('kontakte') as any)
      .select('id, vorname, nachname')
      .eq('aktiv', true)
      .order('nachname').order('id'))),

    alle(tf((supabase.from('firmen') as any)
      .select('id, name')
      .eq('aktiv', true)
      .order('name').order('id'))),
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
      ganztags:            p.ganztags ?? true,
      uhrzeit_von:         p.uhrzeit_von ?? null,
      uhrzeit_bis:         p.uhrzeit_bis ?? null,
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
      <div className="flex items-center gap-2 text-sm text-s112-muted mb-4">
        <Link href="/crm" className="hover:text-s112-teal transition-colors">CRM</Link>
        <span>/</span>
        <span className="text-gray-700 font-medium">Verkaufs-Pipeline</span>
      </div>
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
