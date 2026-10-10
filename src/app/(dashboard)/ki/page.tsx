import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { geladen } from '@/lib/supabase/geladen'
import { getCurrentMembership } from '@/lib/auth/roles'
import type { Metadata } from 'next'
import KiClient from './KiClient'
export const metadata: Metadata = { title: 'Frag dein Weingut' }
export const dynamic = 'force-dynamic'
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

export default async function KiPage() {
  const admin    = createSupabaseAdminClient()
  const membership = await getCurrentMembership()
  const tenantId = membership?.tenantId ?? null

  const cfg = geladen(await (admin.from('tenant_einstellungen') as any)
    .select('ki_abfragen_aktiv, ki_abfragen_paket, ki_abfragen_zaehler')
    .eq('tenant_id', tenantId).maybeSingle(), 'Einstellungen')
  const c = (cfg ?? {}) as R

  return <KiClient
    aktiv={c.ki_abfragen_aktiv ?? false}
    paket={c.ki_abfragen_paket ?? 'basic'}
    verbraucht={c.ki_abfragen_zaehler ?? 0}
  />
}
