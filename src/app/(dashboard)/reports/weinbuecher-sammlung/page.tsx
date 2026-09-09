import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentMembership } from '@/lib/auth/roles'
import type { Metadata } from 'next'
import Link from 'next/link'
import { BookOpen } from 'lucide-react'
import { buildWeinbuch, type Weinbuch } from '@/lib/wein/weinbuch'
import { formatRebsorteMitKuerzel } from '@/lib/wein/bki_kuerzel'
import { WeinbuchTimeline } from '@/app/(dashboard)/kellerbuch/weinausbau/[id]/buch/WeinbuchTimeline'
import PrintButton from '@/app/(dashboard)/kellerbuch/weinausbau/[id]/buch/PrintButton'
import { fmtNum } from '@/lib/format'

export const metadata: Metadata = { title: 'Weinbuch-Sammlung – software:112' }
export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

const STATUS_LABELS: Record<string, string> = {
  ernte: 'Ernte', gaerung: 'Gärung', ausbau: 'Ausbau',
  abfuellung: 'Abfüllung', abgeschlossen: 'Abgeschlossen',
}

// Weinbuch-Sammlung für BKI-Prüfungen: sammelt die vollständigen Weinbücher (alle
// Buchungen, wie auf der Einzelchargen-Seite) für alle Chargen, die den Filtern
// (Jahrgang/Sorte/Bezeichnung) aus dem Auswertungen-Tab "Weinbücher" entsprechen,
// in EINEM druckbaren Dokument – Seitenumbruch vor jeder Charge, damit "Drucken /
// Als PDF speichern" ein übergabefertiges Sammel-PDF ergibt.
export default async function WeinbuecherSammlungPage({
  searchParams,
}: {
  searchParams: Promise<{ jahrgang?: string; sorte?: string; bezeichnung?: string }>
}) {
  const { jahrgang, sorte, bezeichnung } = await searchParams
  const supabase = await createSupabaseServerClient()
  // Explizite Tenant-Filterung zusätzlich zu RLS: RLS erlaubt Zeilen aus JEDER Mitgliedschaft
  // des Nutzers, nicht nur dem aktiv gewählten Betrieb.
  const membership = await getCurrentMembership()
  const tenantId = membership?.tenantId ?? null

  let query = (supabase.from('weinausbau') as any)
    .select('id, name, jahrgang, rebsorte')
    .order('jahrgang', { ascending: false })
    .order('name')

  if (tenantId)    query = query.eq('tenant_id', tenantId)
  if (jahrgang)    query = query.eq('jahrgang', jahrgang)
  if (sorte)       query = query.eq('rebsorte', sorte)
  if (bezeichnung) query = query.eq('name', bezeichnung)

  const { data: chargenRaw } = await query
  const chargen = (chargenRaw ?? []) as R[]

  // Sequenziell laden (nicht parallel) – jedes Weinbuch stößt selbst schon rund
  // 10 parallele Abfragen an; bei vielen Chargen gleichzeitig würde das die
  // Datenbankverbindung unnötig belasten.
  const weinbuecher: Weinbuch[] = []
  for (const c of chargen) {
    const wb = await buildWeinbuch(supabase, c.id, tenantId)
    if (wb) weinbuecher.push(wb)
  }

  const filterAktiv = !!(jahrgang || sorte || bezeichnung)

  return (
    <div className="max-w-3xl mx-auto space-y-8 p-6 print:p-0">

      {/* Kopf (nicht gedruckt) */}
      <div className="print:hidden space-y-4">
        <nav className="flex items-center gap-2 text-sm text-s112-muted">
          <Link href="/reports" className="hover:text-s112-blue-700 transition-colors">Auswertungen</Link>
          <span>/</span>
          <span className="text-s112-text-1 font-medium">Weinbuch-Sammlung</span>
        </nav>
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-semibold text-s112-text flex items-center gap-2">
              <BookOpen size={22} strokeWidth={1.75} className="text-s112-blue-700" />Weinbuch-Sammlung
            </h1>
            <p className="text-sm text-s112-muted mt-0.5">
              {weinbuecher.length} {weinbuecher.length === 1 ? 'Charge' : 'Chargen'}
              {filterAktiv ? ' · gefiltert' : ' · alle Chargen'}
              {jahrgang ? ` · Jahrgang ${jahrgang}` : ''}
              {sorte ? ` · ${sorte}` : ''}
              {bezeichnung ? ` · ${bezeichnung}` : ''}
            </p>
          </div>
          <PrintButton />
        </div>
      </div>

      {weinbuecher.length === 0 ? (
        <p className="text-center text-s112-muted py-12">Keine Chargen für diese Auswahl gefunden.</p>
      ) : (
        weinbuecher.map((wb, i) => (
          <div key={wb.wa.id} className={i > 0 ? 'break-before-page pt-6' : ''}>
            <div className="border-b border-s112-border pb-3 mb-5">
              <h2 className="text-xl font-semibold text-s112-text">{wb.wa.name}</h2>
              <p className="text-sm text-s112-muted mt-0.5">
                {wb.wa.jahrgang ? `Jahrgang ${wb.wa.jahrgang}` : ''}
                {wb.wa.rebsorte ? ` · ${formatRebsorteMitKuerzel(wb.wa.rebsorte)}` : ''}
                {' · '}{STATUS_LABELS[wb.wa.status] ?? wb.wa.status}
                {' · '}{fmtNum(Number(wb.wa.menge_liter ?? 0))} L
                {wb.wa.behaelter_name ? ` · ${wb.wa.behaelter_name}` : ''}
              </p>
            </div>
            <WeinbuchTimeline events={wb.events} zeigeLegende={i === weinbuecher.length - 1} />
          </div>
        ))
      )}
    </div>
  )
}
