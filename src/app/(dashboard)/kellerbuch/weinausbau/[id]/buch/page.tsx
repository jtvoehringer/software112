import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentMembership } from '@/lib/auth/roles'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { BookOpen, GitMerge } from 'lucide-react'
import { buildWeinbuch } from '@/lib/wein/weinbuch'
import { formatRebsorteMitKuerzel } from '@/lib/wein/bki_kuerzel'
import { WeinbuchTimeline } from './WeinbuchTimeline'
import PrintButton from './PrintButton'

export const metadata: Metadata = { title: 'Weinbuch – software:112' }
export const dynamic = 'force-dynamic'

export default async function WeinbuchPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase   = await createSupabaseServerClient()
  const membership = await getCurrentMembership()
  const tenantId   = membership?.tenantId ?? null

  const weinbuch = await buildWeinbuch(supabase, id, tenantId)
  if (!weinbuch) notFound()
  const { wa, events } = weinbuch

  return (
    <div className="max-w-3xl space-y-6">

      {/* Breadcrumb (ausgeblendet beim Drucken) */}
      <nav className="flex items-center gap-2 text-sm text-s112-muted flex-wrap print:hidden">
        <Link href="/kellerbuch" className="hover:text-s112-blue-700">Kellerbuch</Link>
        <span>/</span>
        <Link href={`/kellerbuch/weinausbau/${id}`} className="hover:text-s112-blue-700">{wa.name}</Link>
        <span>/</span>
        <span className="text-s112-text font-medium">Weinbuch</span>
      </nav>

      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold text-s112-text flex items-center gap-2">
            <BookOpen size={22} strokeWidth={1.75} className="text-s112-blue-700" />Weinbuch
          </h1>
          <p className="text-s112-muted text-sm mt-1">
            {wa.name}
            {wa.jahrgang ? ` · Jahrgang ${wa.jahrgang}` : ''}
            {wa.rebsorte ? ` · ${formatRebsorteMitKuerzel(wa.rebsorte)}` : ''}
          </p>
          <p className="text-xs text-s112-muted mt-0.5">
            Von der Rebe bis zur Flasche – vollständige Prozesshistorie dieser Charge
          </p>
        </div>
        <div className="flex items-center gap-3 shrink-0 print:hidden">
          <Link
            href={`/kellerbuch/weinausbau/${id}/blend-protokoll`}
            className="flex items-center gap-1.5 text-sm font-medium text-s112-blue-700 hover:underline"
          >
            <GitMerge size={15} strokeWidth={1.75} />Blend-Protokoll
          </Link>
          <PrintButton />
        </div>
      </div>

      <WeinbuchTimeline events={events} />

    </div>
  )
}
