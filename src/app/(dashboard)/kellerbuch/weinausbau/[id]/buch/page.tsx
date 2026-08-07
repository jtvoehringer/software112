import { createSupabaseServerClient } from '@/lib/supabase/server'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { BookOpen, GitMerge } from 'lucide-react'
import { buildWeinbuch } from '@/lib/wein/weinbuch'
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
  const supabase = await createSupabaseServerClient()

  const weinbuch = await buildWeinbuch(supabase, id)
  if (!weinbuch) notFound()
  const { wa, events } = weinbuch

  return (
    <div className="max-w-3xl space-y-6">

      {/* Breadcrumb (ausgeblendet beim Drucken) */}
      <nav className="flex items-center gap-2 text-sm text-s112-muted flex-wrap print:hidden">
        <Link href="/kellerbuch" className="hover:text-s112-teal">Kellerbuch</Link>
        <span>/</span>
        <Link href={`/kellerbuch/weinausbau/${id}`} className="hover:text-s112-teal">{wa.name}</Link>
        <span>/</span>
        <span className="text-gray-800 font-medium">Weinbuch</span>
      </nav>

      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <BookOpen size={22} strokeWidth={1.75} className="text-s112-teal" />Weinbuch
          </h1>
          <p className="text-s112-muted text-sm mt-1">
            {wa.name}
            {wa.jahrgang ? ` · Jahrgang ${wa.jahrgang}` : ''}
            {wa.rebsorte ? ` · ${wa.rebsorte}` : ''}
          </p>
          <p className="text-xs text-s112-muted mt-0.5">
            Von der Rebe bis zur Flasche – vollständige Prozesshistorie dieser Charge
          </p>
        </div>
        <div className="flex items-center gap-3 shrink-0 print:hidden">
          <Link
            href={`/kellerbuch/weinausbau/${id}/blend-protokoll`}
            className="flex items-center gap-1.5 text-sm font-medium text-s112-teal hover:underline"
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
