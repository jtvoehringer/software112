import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentUserRole, canWrite, getCurrentMembership } from '@/lib/auth/roles'
import type { Metadata } from 'next'
import RabattgruppenClient from './RabattgruppenClient'

export const metadata: Metadata = { title: 'Rabattgruppen – software:112' }
export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

export type Rabattgruppe = {
  id: string; name: string; rabatt_pct: number; notizen: string | null
}

export default async function RabattgruppenPage() {
  const supabase = await createSupabaseServerClient()
  const role     = await getCurrentUserRole()
  const writeOk  = canWrite(role, 'warenwirtschaft')

  // Explizite Tenant-Filterung zusätzlich zu RLS: RLS erlaubt Zeilen aus JEDER Mitgliedschaft
  // des Nutzers, nicht nur dem aktiv gewählten Betrieb.
  const membership = await getCurrentMembership()
  const tenantId   = membership?.tenantId ?? null
  const tf = (query: any) => tenantId ? query.eq('tenant_id', tenantId) : query

  const { data } = await tf((supabase.from('rabattgruppen') as any)
    .select('id, name, rabatt_pct, notizen')
    .order('rabatt_pct', { ascending: true }))

  const gruppen: Rabattgruppe[] = ((data ?? []) as R[]).map(r => ({
    id:         r.id,
    name:       r.name,
    rabatt_pct: Number(r.rabatt_pct),
    notizen:    r.notizen ?? null,
  }))

  return <RabattgruppenClient gruppen={gruppen} writeOk={writeOk} />
}
