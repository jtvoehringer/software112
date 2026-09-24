// behoerdenmeldung: transportbescheinigung
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentMembership } from '@/lib/auth/roles'
import { notFound } from 'next/navigation'
import Link from '@/components/ui/Link'
import type { Metadata } from 'next'
import TBFormular from './TBFormular'
import { ladeTransportbescheinigung } from '@/lib/behoerden/transportbescheinigung'
import { csvPfad } from '@/lib/behoerden/katalog'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Transportbescheinigung – software:112' }

// Formular (gespeichert oder Vorbelegung) kommt aus derselben Ladefunktion wie die CSV
// (/meldungen/transportbescheinigung/csv) – siehe lib/behoerden/transportbescheinigung.ts.
export default async function TransportbescheinigungPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createSupabaseServerClient()
  const membership = await getCurrentMembership()
  const tenantId = membership?.tenantId ?? null
  if (!tenantId) notFound()

  const tb = await ladeTransportbescheinigung(supabase, tenantId, { id })
  if (!tb) notFound()
  const { posten } = tb

  return (
    <div className="max-w-5xl space-y-4">
      <div className="flex items-center gap-2 text-sm text-s112-muted no-print">
        <Link href="/weinhandel/verkauf" className="hover:text-s112-blue-700 transition-colors">Verkauf</Link>
        <span>/</span>
        <Link href={`/weinhandel/verkauf/${id}`} className="hover:text-s112-blue-700 transition-colors">
          {posten.rechnungsnummer ?? (posten.datum ? new Date(posten.datum).toLocaleDateString('de-AT') : 'Verkauf')}
        </Link>
        <span>/</span>
        <span className="text-s112-text-1 font-medium">Transportbescheinigung</span>
      </div>

      <TBFormular
        verkaufspostenId={id}
        initial={tb.formular}
        csvHref={csvPfad('transportbescheinigung', { id, beleg: posten.rechnungsnummer })}
      />
    </div>
  )
}
