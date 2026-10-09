// behoerdenmeldung: weinbuch
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentMembership } from '@/lib/auth/roles'
import type { Metadata } from 'next'
import Link from '@/components/ui/Link'
import { notFound } from 'next/navigation'
import { BookOpen, GitMerge } from 'lucide-react'
import { ladeWeinbuch } from '@/lib/behoerden/weinbuch'
import { csvPfad } from '@/lib/behoerden/katalog'
import CsvExportKnopf from '@/components/CsvExportKnopf'
import { formatRebsorteMitKuerzel } from '@/lib/wein/bki_kuerzel'
import { WeinbuchTimeline } from './WeinbuchTimeline'
import PrintButton from './PrintButton'
import MostgewichtAnzeige from '@/components/wein/MostgewichtAnzeige'

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

  // Dieselbe Ladefunktion wie die CSV „weinbuch“ (lib/behoerden/weinbuch.ts → buildWeinbuch)
  const geladen = tenantId ? await ladeWeinbuch(supabase, tenantId, { chargeId: id }) : null
  if (!geladen) notFound()
  const { wa, events } = geladen.weinbuch

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
            {/* KAN-131: Mostgewicht der Charge im Kopf */}
            {(wa.kmw != null || wa.oechsle != null) && <> · <MostgewichtAnzeige wert={{ kmw: wa.kmw, oechsle: wa.oechsle, einheit: wa.mostgewicht_einheit }} /></>}
          </p>
          {/* KAN-200: aktuell gültige Prüfnummer (auch per Umzug übernommen) bzw. „für den Tankbestand erloschen“ */}
          {wa.pruefnummer && <p className="text-sm text-s112-text-2 mt-0.5">Prüfnummer: {wa.pruefnummer}</p>}
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
          {/* KAN-108: Lesen der Charge und ihrer Vorgänger mit Maßnahmen und Wartezeiten */}
          <Link
            href={`/weingarten/rueckverfolgung?charge=${id}`}
            className="text-sm font-medium text-s112-blue-700 hover:underline"
          >
            Rückverfolgung Weingarten
          </Link>
          <PrintButton />
          <CsvExportKnopf href={csvPfad('weinbuch', { charge: id })} />
        </div>
      </div>

      {/* KAN-127: Hinweise (Zukauf, Eröffnungsbestand, Lesedatum …) auch im Ausdruck */}
      {geladen.weinbuch?.abgeschlossenAm && (
        <p className="text-xs text-s112-muted">Weinbuch abgeschlossen mit der Füllung am {new Date(`${geladen.weinbuch.abgeschlossenAm}T12:00:00`).toLocaleDateString('de-AT', { timeZone: 'Europe/Vienna' })} – spätere Einträge gehören nicht mehr zu dieser Charge.</p>
      )}
      {geladen.warnungen.length > 0 && (
        <ul className="text-xs text-s112-warn-fg list-disc pl-4 space-y-0.5">
          {geladen.warnungen.map((w, i) => <li key={i}>{w}</li>)}
        </ul>
      )}

      <WeinbuchTimeline events={events} />

    </div>
  )
}
