import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentMembership } from '@/lib/auth/roles'
import type { Metadata } from 'next'
import Link from '@/components/ui/Link'
import { notFound } from 'next/navigation'
import BehaelterForm from '@/components/kellerbuch/BehaelterForm'
import { updateBehaelter } from '../../actions'
import { ladeKellergemeinschaft } from '@/lib/keller/behaelter'

export const metadata: Metadata = { title: 'Behälter bearbeiten – software:112' }
export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

export default async function BehaelterEditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createSupabaseServerClient()
  const membership = await getCurrentMembership()
  const tenantId    = membership?.tenantId ?? null
  // Explizite Tenant-Filterung zusätzlich zu RLS: RLS erlaubt Zeilen aus JEDER Mitgliedschaft
  // des Nutzers, nicht nur dem aktiv gewählten Betrieb.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let rowsQuery = (supabase.from('behaelter') as any)
    .select('id, name, typ, volumen_liter, standort, aktiv, notizen, stapler, gemeinsam, lp_pickerl').eq('id', id).limit(1)
  if (tenantId) rowsQuery = rowsQuery.eq('tenant_id', tenantId)
  const { data: rows } = await rowsQuery
  type BehaelterRow = { id: string; name: string; typ: string | null; volumen_liter: number | null; standort: string | null; aktiv: boolean; notizen: string | null; stapler: boolean; gemeinsam: boolean }
  const behaelter = (((rows ?? []) as R[])[0] ?? null) as BehaelterRow | null
  if (!behaelter) notFound()   // fremde (freigegebene) Gebinde bearbeitet nur der Eigentümer
  const gemeinschaft = await ladeKellergemeinschaft(supabase, tenantId)
  const partner = gemeinschaft.alsEigentuemer.length ? gemeinschaft.alsEigentuemer.map(p => p.name).join(', ') : null

  return (
    <div className="max-w-2xl">
      <div className="flex items-center gap-2 text-sm text-s112-muted mb-6">
        <Link href="/kellerbuch" className="hover:text-s112-blue-700 transition-colors">Kellerbuch</Link>
        <span>/</span>
        <span className="text-s112-text-1 font-medium">{behaelter.name}</span>
      </div>
      <h1 className="text-2xl font-semibold text-s112-text mb-6">{behaelter.name}</h1>
      <BehaelterForm behaelter={behaelter} action={updateBehaelter.bind(null, id)} partner={partner} />
    </div>
  )
}
