import { createSupabaseServerClient } from '@/lib/supabase/server'
import type { Metadata } from 'next'
import WeinexportFormClient from './WeinexportFormClient'
export const metadata: Metadata = { title: 'Neuer Exportauftrag – software:112' }
export const dynamic = 'force-dynamic'
type R = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

export default async function NeuPage() {
  const supabase = await createSupabaseServerClient()
  const { data: membership } = await (supabase.from('tenant_memberships') as any).select('tenant_id').limit(1).single()
  const tenantId = (membership as R | null)?.tenant_id

  const [{ data: kontakte }, { data: firmen }, { data: fuellungen }] = await Promise.all([
    (supabase.from('kontakte') as any).select('id,vorname,nachname').eq('tenant_id', tenantId).eq('aktiv', true).order('nachname'),
    (supabase.from('firmen') as any).select('id,name').eq('tenant_id', tenantId).eq('aktiv', true).order('name'),
    (supabase.from('fuellungen') as any).select('id,bezeichnung,flaschengroesse_ml,lagerbestand_fl').eq('tenant_id', tenantId).eq('aktiv', true).gt('lagerbestand_fl', 0).order('bezeichnung'),
  ])

  return <WeinexportFormClient
    kontakte={(kontakte ?? []) as R[]}
    firmen={(firmen ?? []) as R[]}
    fuellungen={(fuellungen ?? []) as R[]}
    tenantId={tenantId}
  />
}
