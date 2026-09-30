// behoerdenmeldung: weinbuch-sammlung
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentMembership } from '@/lib/auth/roles'
import type { Metadata } from 'next'
import Link from '@/components/ui/Link'
import { BookOpen } from 'lucide-react'
import { formatRebsorteMitKuerzel } from '@/lib/wein/bki_kuerzel'
import { WeinbuchTimeline } from '@/app/(dashboard)/kellerbuch/weinausbau/[id]/buch/WeinbuchTimeline'
import PrintButton from '@/app/(dashboard)/kellerbuch/weinausbau/[id]/buch/PrintButton'
import CsvExportKnopf from '@/components/CsvExportKnopf'
import { csvPfad } from '@/lib/behoerden/katalog'
import { ladeWeinbuchFilter, ladeWeinbuchSammlung, WEINBUCH_STATUS_LABEL, type WeinbuchFilter } from '@/lib/behoerden/weinbuch'
import { fmtNum } from '@/lib/format'

export const metadata: Metadata = { title: 'Weinbuch-Sammlung – software:112' }
export const dynamic = 'force-dynamic'

// Weinbuch-Sammlung für BKI-Prüfungen: sammelt die vollständigen Weinbücher (alle
// Buchungen, wie auf der Einzelchargen-Seite) für alle Chargen, die den Filtern
// (Jahrgang/Sorte/Bezeichnung) entsprechen, in EINEM druckbaren Dokument – Seitenumbruch
// vor jeder Charge, damit „Drucken / Als PDF speichern“ ein übergabefertiges Sammel-PDF
// ergibt. Pflichtmeldung (reports/(pflicht)): Betriebsleiter auch ohne Modul Controlling.
// Seit 24.09.2026 mit eigener Filterauswahl und CSV (dieselbe Ladefunktion,
// lib/behoerden/weinbuch.ts).
export default async function WeinbuecherSammlungPage({
  searchParams,
}: {
  searchParams: Promise<{ jahrgang?: string; sorte?: string; bezeichnung?: string }>
}) {
  const sp = await searchParams
  const jahrgangZahl = sp.jahrgang && /^\d{4}$/.test(sp.jahrgang.trim()) ? Number(sp.jahrgang.trim()) : null
  const filter: WeinbuchFilter = {
    jahrgang: jahrgangZahl,
    sorte: sp.sorte?.trim() || null,
    bezeichnung: sp.bezeichnung?.trim() || null,
  }
  const supabase = await createSupabaseServerClient()
  const membership = await getCurrentMembership()
  const tenantId = membership?.tenantId ?? null

  const [sammlung, optionen] = tenantId
    ? await Promise.all([ladeWeinbuchSammlung(supabase, tenantId, filter), ladeWeinbuchFilter(supabase, tenantId)])
    : [{ weinbuecher: [], zeilen: [], warnungen: [] }, { jahrgaenge: [], sorten: [], bezeichnungen: [] }]
  const weinbuecher = sammlung.weinbuecher

  const filterAktiv = !!(filter.jahrgang || filter.sorte || filter.bezeichnung)
  const auswahl = 'w-full border border-s112-border rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-s112-teal/40'

  return (
    <div className="max-w-3xl mx-auto space-y-8 p-6 print:p-0">

      {/* Kopf (nicht gedruckt) */}
      <div className="print:hidden space-y-4">
        <nav className="flex items-center gap-2 text-sm text-s112-muted">
          <Link href="/kellerbuch" className="hover:text-s112-blue-700 transition-colors">Kellerbuch</Link>
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
              {filter.jahrgang ? ` · Jahrgang ${filter.jahrgang}` : ''}
              {filter.sorte ? ` · ${filter.sorte}` : ''}
              {filter.bezeichnung ? ` · ${filter.bezeichnung}` : ''}
            </p>
          </div>
          <div className="flex items-start gap-2">
            <PrintButton />
            <CsvExportKnopf href={csvPfad('weinbuch-sammlung', { jahrgang: filter.jahrgang, sorte: filter.sorte, bezeichnung: filter.bezeichnung })} />
          </div>
        </div>

        {/* Filter direkt auf der Seite (bisher nur im Tab „Weinbücher“ der Auswertungen) */}
        <form method="get" className="card p-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className="block text-xs font-medium text-s112-text-2 mb-1">Jahrgang</label>
            <select aria-label="Jahrgang" name="jahrgang" defaultValue={filter.jahrgang ?? ''} className={auswahl}>
              <option value="">Alle</option>
              {optionen.jahrgaenge.map(j => <option key={j} value={j}>{j}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-s112-text-2 mb-1">Sorte</label>
            <select aria-label="Sorte" name="sorte" defaultValue={filter.sorte ?? ''} className={auswahl}>
              <option value="">Alle</option>
              {optionen.sorten.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-s112-text-2 mb-1">Bezeichnung</label>
            <select aria-label="Bezeichnung" name="bezeichnung" defaultValue={filter.bezeichnung ?? ''} className={auswahl}>
              <option value="">Alle</option>
              {optionen.bezeichnungen.map(b => <option key={b} value={b}>{b}</option>)}
            </select>
          </div>
          <div className="sm:col-span-3 flex items-center gap-3">
            <button type="submit" className="text-s112-yellow px-4 py-2 rounded-xl text-sm font-semibold bg-s112-teal hover:bg-opacity-90">
              Auswahl anzeigen
            </button>
            {filterAktiv && (
              <Link href="/reports/weinbuecher-sammlung" className="text-sm text-s112-muted hover:text-s112-blue-700">Alle Chargen</Link>
            )}
          </div>
        </form>
        {sammlung.warnungen.length > 0 && (
          <ul className="text-xs text-s112-warn-fg list-disc pl-4">
            {sammlung.warnungen.map((w, i) => <li key={i}>{w}</li>)}
          </ul>
        )}
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
                {' · '}{WEINBUCH_STATUS_LABEL[wb.wa.status] ?? wb.wa.status}
                {' · '}{fmtNum(Number(wb.wa.menge_liter ?? 0))} L
                {wb.wa.behaelter_name ? ` · ${wb.wa.behaelter_name}` : ''}
              </p>
            </div>
            {/* KAN-127: Hinweise der Charge auch im Ausdruck */}
            {wb.abgeschlossenAm && (
              <p className="text-xs text-s112-muted mb-2">Weinbuch abgeschlossen mit der Füllung am {new Date(`${wb.abgeschlossenAm}T12:00:00`).toLocaleDateString('de-AT')}.</p>
            )}
            {wb.warnungen.length > 0 && (
              <ul className="text-xs text-s112-warn-fg list-disc pl-4 space-y-0.5 mb-4">
                {wb.warnungen.map((w, j) => <li key={j}>{w}</li>)}
              </ul>
            )}
            <WeinbuchTimeline events={wb.events} zeigeLegende={i === weinbuecher.length - 1} />
          </div>
        ))
      )}
    </div>
  )
}
