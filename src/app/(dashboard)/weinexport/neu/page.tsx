import { createSupabaseServerClient } from '@/lib/supabase/server'
import { alle } from '@/lib/supabase/alle'
import { getCurrentMembership, canWrite } from '@/lib/auth/roles'
import type { Metadata } from 'next'
import WeinexportFormClient from './WeinexportFormClient'
export const metadata: Metadata = { title: 'Neuer Exportauftrag – software:112' }
export const dynamic = 'force-dynamic'
type R = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

export default async function NeuPage() {
  const supabase = await createSupabaseServerClient()
  // Rollen-Check: leser darf keinen Exportauftrag anlegen. Ohne Mitgliedschaft ist rolle
  // 'leser' (Fallback) -> wir landen dann bereits im redirect() oben; ab hier ist membership
  // also garantiert vorhanden, tenantId also garantiert ein string (kein null-Fall mehr für
  // WeinexportFormClient, das eine verpflichtende tenantId erwartet).
  const membership = await getCurrentMembership()
  if (!membership || !canWrite(membership, 'warenwirtschaft')) {
    const { redirect } = await import('next/navigation')
    redirect('/weinexport')
    return null
  }
  const tenantId = membership.tenantId

  // Exportaufträge ist ein optionales Modul (Migration 152) - pro Mandant unter
  // Admin > Mandant > Module ein-/ausschaltbar.
  const { data: einst } = await (supabase.from('tenant_einstellungen') as any)
    .select('modul_export').eq('tenant_id', tenantId).maybeSingle()
  if (!einst?.modul_export) {
    const { redirect } = await import('next/navigation')
    redirect('/dashboard')
  }

  const [{ data: kontakte }, { data: firmen }, { data: fuellungen }] = await Promise.all([
    alle((supabase.from('kontakte') as any).select('id,vorname,nachname').eq('tenant_id', tenantId).eq('aktiv', true).order('nachname').order('id')),
    alle((supabase.from('firmen') as any).select('id,name').eq('tenant_id', tenantId).eq('aktiv', true).order('name').order('id')),
    alle((supabase.from('fuellungen') as any).select('id,name,bezeichnung,jahrgang,flaschengroesse_ml,bestand_flaschen,zolltarifnummer').eq('tenant_id', tenantId).eq('aktiv', true).gt('bestand_flaschen', 0).order('name').order('id')),
  ])

  return <WeinexportFormClient
    kontakte={(kontakte ?? []) as R[]}
    firmen={(firmen ?? []) as R[]}
    fuellungen={(fuellungen ?? []) as R[]}
    tenantId={tenantId}
  />
}
