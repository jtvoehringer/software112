import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import type { Metadata } from 'next'
import KiClient from './KiClient'
export const metadata: Metadata = { title: 'Frag dein Weingut – software:112' }
export const dynamic = 'force-dynamic'
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

export default async function KiPage() {
  const supabase = await createSupabaseServerClient()
  const admin    = createSupabaseAdminClient()
  const { data: membership } = await (supabase.from('tenant_memberships') as any).select('tenant_id').limit(1).single()
  const tenantId = (membership as R | null)?.tenant_id

  const { data: cfg } = await (admin.from('tenant_einstellungen') as any)
    .select('ki_abfragen_aktiv, ki_abfragen_paket, ki_abfragen_zaehler')
    .eq('tenant_id', tenantId).maybeSingle()
  const c = (cfg ?? {}) as R

  return <KiClient
    aktiv={c.ki_abfragen_aktiv ?? false}
    paket={c.ki_abfragen_paket ?? 'basic'}
    verbraucht={c.ki_abfragen_zaehler ?? 0}
  />
}
