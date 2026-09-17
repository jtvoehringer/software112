import { redirect } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentMembership } from '@/lib/auth/roles'
import type { Metadata } from 'next'
import Link from '@/components/ui/Link'
import WeinexportDetailClient from './WeinexportDetailClient'
export const metadata: Metadata = { title: 'Exportauftrag – software:112' }
export const dynamic = 'force-dynamic'
type R = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

export default async function WeinexportDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const supabase = await createSupabaseServerClient()

  // Exportaufträge ist ein optionales Modul (Migration 152) - pro Mandant unter
  // Admin > Mandant > Module ein-/ausschaltbar.
  // Aktiv gewählten Betrieb respektieren (Cookie-basiert) statt einer beliebigen
  // Mitgliedschaft – sonst können bei Mehrfach-Mitgliedschaft Daten eines anderen
  // Betriebs angezeigt werden.
  const membership = await getCurrentMembership()
  const tenantId = membership?.tenantId
  const { data: einst } = await (supabase.from('tenant_einstellungen') as any)
    .select('modul_export').eq('tenant_id', tenantId).maybeSingle()
  if (!einst?.modul_export) redirect('/dashboard')

  const { id } = await params
  const [{ data: auftrag }, { data: positionen }, { data: dokumente }] = await Promise.all([
    (supabase.from('exportauftraege') as any)
      .select('*, kontakte(vorname,nachname,email,telefon), firmen(name,email,telefon)')
      .eq('id', id).eq('tenant_id', tenantId).single(),
    (supabase.from('exportauftrag_positionen') as any)
      .select('*, fuellungen(bezeichnung,flaschengroesse_ml)')
      .eq('exportauftrag_id', id).eq('tenant_id', tenantId).order('sort_order'),
    (supabase.from('export_dokumente') as any)
      .select('*').eq('exportauftrag_id', id).eq('tenant_id', tenantId).order('dokument_art'),
  ])

  if (!auftrag) return (
    <div className="p-8">
      <p className="text-s112-err-fg">Exportauftrag nicht gefunden.</p>
      <Link href="/weinexport" className="text-s112-blue-700 text-sm mt-2 inline-block">← Zurück</Link>
    </div>
  )

  return <WeinexportDetailClient
    auftrag={auftrag as R}
    positionen={(positionen ?? []) as R[]}
    dokumente={(dokumente ?? []) as R[]}
  />
}
