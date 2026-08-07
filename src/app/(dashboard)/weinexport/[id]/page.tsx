import { redirect } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import type { Metadata } from 'next'
import Link from 'next/link'
import WeinexportDetailClient from './WeinexportDetailClient'
export const metadata: Metadata = { title: 'Exportauftrag – software:112' }
export const dynamic = 'force-dynamic'
type R = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

export default async function WeinexportDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const supabase = await createSupabaseServerClient()

  // Exportaufträge ist ein optionales Modul (Migration 152) - pro Mandant unter
  // Admin > Mandant > Module ein-/ausschaltbar.
  const { data: membership } = await (supabase.from('tenant_memberships') as any).select('tenant_id').limit(1).single()
  const tenantId = (membership as R | null)?.tenant_id
  const { data: einst } = await (supabase.from('tenant_einstellungen') as any)
    .select('modul_export').eq('tenant_id', tenantId).maybeSingle()
  if (!einst?.modul_export) redirect('/dashboard')

  const { id } = await params
  const [{ data: auftrag }, { data: positionen }, { data: dokumente }] = await Promise.all([
    (supabase.from('exportauftraege') as any)
      .select('*, kontakte(vorname,nachname,email,telefon), firmen(name,email,telefon)')
      .eq('id', id).single(),
    (supabase.from('exportauftrag_positionen') as any)
      .select('*, fuellungen(bezeichnung,flaschengroesse_ml)')
      .eq('exportauftrag_id', id).order('sort_order'),
    (supabase.from('export_dokumente') as any)
      .select('*').eq('exportauftrag_id', id).order('dokument_art'),
  ])

  if (!auftrag) return (
    <div className="p-8">
      <p className="text-red-600">Exportauftrag nicht gefunden.</p>
      <Link href="/weinexport" className="text-s112-teal text-sm mt-2 inline-block">← Zurück</Link>
    </div>
  )

  return <WeinexportDetailClient
    auftrag={auftrag as R}
    positionen={(positionen ?? []) as R[]}
    dokumente={(dokumente ?? []) as R[]}
  />
}
