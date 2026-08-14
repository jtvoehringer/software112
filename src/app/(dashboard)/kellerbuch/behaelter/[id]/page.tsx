import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentMembership } from '@/lib/auth/roles'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import BehaelterForm from '@/components/kellerbuch/BehaelterForm'
import { updateBehaelter } from '../../actions'

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
    .select('id, name, typ, volumen_liter, standort, aktiv').eq('id', id).limit(1)
  if (tenantId) rowsQuery = rowsQuery.eq('tenant_id', tenantId)
  const { data: rows } = await rowsQuery
  type BehaelterRow = { id: string; name: string; typ: string | null; volumen_liter: number | null; standort: string | null; aktiv: boolean }
  const behaelter = (((rows ?? []) as R[])[0] ?? null) as BehaelterRow | null
  if (!behaelter) notFound()

  return (
    <div className="max-w-2xl">
      <div className="flex items-center gap-2 text-sm text-s112-muted mb-6">
        <Link href="/kellerbuch" className="hover:text-s112-teal transition-colors">Kellerbuch</Link>
        <span>/</span>
        <span className="text-gray-700 font-medium">{behaelter.name}</span>
      </div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">{behaelter.name}</h1>
      <BehaelterForm behaelter={behaelter} action={updateBehaelter.bind(null, id)} />
    </div>
  )
}
