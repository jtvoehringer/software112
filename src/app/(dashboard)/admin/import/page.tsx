import type { Metadata } from 'next'
import ImportClient from './ImportClient'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { ladeBehaelter } from '@/lib/keller/behaelter'
import { getCurrentMembership } from '@/lib/auth/roles'
export const metadata: Metadata = { title: 'Datenimport – software:112' }
export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

export default async function ImportPage({
  searchParams,
}: {
  searchParams: Promise<{ typ?: string; eb?: string; err?: string }>
}) {
  const { typ, eb, err } = await searchParams
  const supabase = await createSupabaseServerClient()
  // Explizite Tenant-Filterung zusätzlich zu RLS: RLS erlaubt Zeilen aus JEDER Mitgliedschaft
  // des Nutzers, nicht nur dem aktiv gewählten Betrieb.
  const membership = await getCurrentMembership()
  const tenantId = membership?.tenantId ?? null

  // Gebinde-Liste fuer die Anfangsbestandsbuchung (Datenimport > Gebinde) - wird nur
  // dort benoetigt, deshalb hier serverseitig geladen und als Prop durchgereicht.
  // Eigene + freigegebene Gebinde, fremd belegte ausgenommen (Kellergemeinschaft, Migration 203)
  const gebindeRaw = (await ladeBehaelter(supabase, tenantId, { alsZiel: true })).map(b => ({ id: b.id, name: b.anzeigeName }))

  return (
    <ImportClient
      gebinde={(gebindeRaw ?? []) as R[]}
      initialTyp={typ}
      ebOk={eb === '1'}
      ebErr={err}
    />
  )
}
