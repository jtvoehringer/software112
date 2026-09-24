// behoerdenmeldung: pruefnummernantrag
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentMembership } from '@/lib/auth/roles'
import { notFound } from 'next/navigation'
import Link from '@/components/ui/Link'
import type { Metadata } from 'next'
import PNAFormular from './PNAFormular'
import { ladePruefnummernantrag } from '@/lib/behoerden/pruefnummernantrag'
import { csvPfad } from '@/lib/behoerden/katalog'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Prüfnummernantrag – software:112' }

// Formular (gespeichert oder Vorbelegung) kommt aus derselben Ladefunktion wie die CSV
// (/meldungen/pruefnummernantrag/csv) – siehe lib/behoerden/pruefnummernantrag.ts.
export default async function PruefnummernantragPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createSupabaseServerClient()
  const membership = await getCurrentMembership()
  const tenantId = membership?.tenantId ?? null
  if (!tenantId) notFound()

  const pna = await ladePruefnummernantrag(supabase, tenantId, { id })
  if (!pna) notFound()

  return (
    <div className="max-w-4xl space-y-4">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-s112-muted no-print">
        <Link href="/dac" className="hover:text-s112-blue-700 transition-colors">DAC & Prüfnummern</Link>
        <span>/</span>
        <Link href={`/dac/${id}`} className="hover:text-s112-blue-700 transition-colors">{pna.dac.bezeichnung}</Link>
        <span>/</span>
        <span className="text-s112-text-1 font-medium">Prüfnummernantrag</span>
      </div>

      <PNAFormular
        dacAntragId={id}
        initial={pna.formular}
        csvHref={csvPfad('pruefnummernantrag', { id, bez: pna.dac.bezeichnung })}
      />
    </div>
  )
}
