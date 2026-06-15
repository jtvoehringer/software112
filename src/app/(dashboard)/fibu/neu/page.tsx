import { redirect } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentMembership } from '@/lib/auth/roles'
import FibuNeuClient from './FibuNeuClient'

export const dynamic = 'force-dynamic'

export default async function FibuNeuPage() {
  const supabase   = await createSupabaseServerClient()
  const membership = await getCurrentMembership()
  if (!membership?.tenantId) redirect('/login')
  const tenantId = membership.tenantId

  const { data: einst } = await (supabase.from('tenant_einstellungen') as any)
    .select('modul_fibu').eq('tenant_id', tenantId).maybeSingle()
  if (!einst?.modul_fibu) redirect('/dashboard')

  const { data: konten } = await (supabase.from('fibu_kontenplan') as any)
    .select('id, konto_nr, konto_name, typ')
    .or(`tenant_id.is.null,tenant_id.eq.${tenantId}`)
    .eq('aktiv', true)
    .order('konto_nr')

  return <FibuNeuClient konten={konten ?? []} tenantId={tenantId} />
}
