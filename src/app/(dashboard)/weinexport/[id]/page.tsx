// behoerdenmeldung: exportauftrag
import { redirect } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentMembership } from '@/lib/auth/roles'
import type { Metadata } from 'next'
import Link from '@/components/ui/Link'
import WeinexportDetailClient from './WeinexportDetailClient'
import { ladeExportauftrag } from '@/lib/behoerden/exportauftrag'
import { csvPfad } from '@/lib/behoerden/katalog'
export const metadata: Metadata = { title: 'Exportauftrag – software:112' }
export const dynamic = 'force-dynamic'

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
  if (!einst?.modul_export || !tenantId) redirect('/dashboard')

  const { id } = await params
  // Dieselbe Ladefunktion wie die CSV (/meldungen/exportauftrag/csv): Auftrag, Dokumente und
  // Positionszeilen mit gerundetem Wert je Position (Summe = Summe der gerundeten Werte)
  const ergebnis = await ladeExportauftrag(supabase, tenantId, { id })

  if (!ergebnis) return (
    <div className="p-8">
      <p className="text-s112-err-fg">Exportauftrag nicht gefunden.</p>
      <Link href="/weinexport" className="text-s112-blue-700 text-sm mt-2 inline-block">← Zurück</Link>
    </div>
  )

  return <WeinexportDetailClient
    auftrag={ergebnis.auftrag}
    zeilen={ergebnis.zeilen}
    gesamtEur={ergebnis.gesamtEur}
    dokumente={ergebnis.dokumente}
    csvHref={csvPfad('exportauftrag', { id, referenz: ergebnis.auftrag.referenz })}
  />
}
