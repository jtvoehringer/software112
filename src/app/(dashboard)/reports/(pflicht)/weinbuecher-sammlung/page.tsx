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
import {
  ladeWeinbuchChargen, ladeWeinbuchFilter, ladeWeinbuchSammlung, zuVieleChargenText,
  WEINBUCH_SAMMLUNG_MAX, WEINBUCH_STATUS_LABEL, type WeinbuchCharge, type WeinbuchFilter,
} from '@/lib/behoerden/weinbuch'
import { fmtNum } from '@/lib/format'

export const metadata: Metadata = { title: 'Weinbuch-Sammlung' }
export const dynamic = 'force-dynamic'

// Weinbuch-Sammlung für BKI-Prüfungen: sammelt die vollständigen Weinbücher (alle
// Buchungen, wie auf der Einzelchargen-Seite) für alle Chargen, die den Filtern
// (Jahrgang/Sorte/Bezeichnung) entsprechen, in EINEM druckbaren Dokument – Seitenumbruch
// vor jeder Charge, damit „Drucken / Als PDF speichern“ ein übergabefertiges Sammel-PDF
// ergibt. Pflichtmeldung (reports/(pflicht)): Betriebsleiter auch ohne Modul Controlling.
// Seit 24.09.2026 mit eigener Filterauswahl und CSV (dieselbe Ladefunktion,
// lib/behoerden/weinbuch.ts).
// KAN-385 (UAT 28.10.2026): erst auswählen – beim Öffnen nur Filter (Jahrgang = neuester) und
// Chargenliste; die Weinbücher erst mit „Weinbücher anzeigen“ (anzeigen=1), höchstens
// WEINBUCH_SAMMLUNG_MAX Chargen. Ohne jahrgang in der URL gilt der neueste, „Alle“ = jahrgang=.
export default async function WeinbuecherSammlungPage({
  searchParams,
}: {
  searchParams: Promise<{ jahrgang?: string; sorte?: string; bezeichnung?: string; anzeigen?: string }>
}) {
  const sp = await searchParams
  const supabase = await createSupabaseServerClient()
  const membership = await getCurrentMembership()
  const tenantId = membership?.tenantId ?? null

  const optionen = tenantId
    ? await ladeWeinbuchFilter(supabase, tenantId)
    : { jahrgaenge: [], sorten: [], bezeichnungen: [] }
  const jahrgangZahl = sp.jahrgang && /^\d{4}$/.test(sp.jahrgang.trim()) ? Number(sp.jahrgang.trim()) : null
  const filter: WeinbuchFilter = {
    jahrgang: sp.jahrgang === undefined ? (optionen.jahrgaenge[0] ?? null) : jahrgangZahl,
    sorte: sp.sorte?.trim() || null,
    bezeichnung: sp.bezeichnung?.trim() || null,
  }
  const chargen: WeinbuchCharge[] = tenantId ? await ladeWeinbuchChargen(supabase, tenantId, filter) : []
  const zuViele = chargen.length > WEINBUCH_SAMMLUNG_MAX
  const anzeigen = sp.anzeigen === '1' && !zuViele && chargen.length > 0
  const sammlung = anzeigen && tenantId ? await ladeWeinbuchSammlung(supabase, tenantId, filter, chargen) : null
  const weinbuecher = sammlung?.weinbuecher ?? []

  const filterAktiv = !!(filter.jahrgang || filter.sorte || filter.bezeichnung)
  const auswahl = 'w-full border border-s112-border rounded-lg px-3 py-2 text-sm bg-white focus:outline-hidden focus:ring-2 focus:ring-s112-teal/40'
  const knopf = 'px-4 py-2 rounded-xl text-sm font-semibold'

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
              {chargen.length} {chargen.length === 1 ? 'Charge' : 'Chargen'}
              {filterAktiv ? '' : ' · alle Chargen'}
              {filter.jahrgang ? ` · Jahrgang ${filter.jahrgang}` : ''}
              {filter.sorte ? ` · ${filter.sorte}` : ''}
              {filter.bezeichnung ? ` · ${filter.bezeichnung}` : ''}
            </p>
          </div>
          {!zuViele && chargen.length > 0 && (
            <div className="flex items-start gap-2">
              {anzeigen && <PrintButton />}
              <CsvExportKnopf href={csvPfad('weinbuch-sammlung', { jahrgang: filter.jahrgang, sorte: filter.sorte, bezeichnung: filter.bezeichnung })} />
            </div>
          )}
        </div>

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
          <div className="sm:col-span-3 flex items-center gap-3 flex-wrap">
            <button type="submit" className={`${knopf} text-s112-text-2 border border-s112-border hover:bg-s112-bg`}>
              Chargen auswählen
            </button>
            <button type="submit" name="anzeigen" value="1" className={`${knopf} text-s112-yellow bg-s112-teal hover:bg-s112-teal/90`}>
              Weinbücher anzeigen
            </button>
          </div>
        </form>

        {zuViele && (
          <p role="status" className="text-sm bg-s112-warn-bg text-s112-warn-fg border border-s112-warn/30 px-3 py-2 rounded-lg">
            {zuVieleChargenText(chargen.length)}
          </p>
        )}
        {sammlung && sammlung.warnungen.length > 0 && (
          <ul className="text-xs text-s112-warn-fg list-disc pl-4">
            {sammlung.warnungen.map((w, i) => <li key={i}>{w}</li>)}
          </ul>
        )}

        {/* Chargenliste der Auswahl – die Weinbücher selbst erst nach „Weinbücher anzeigen“ */}
        {!anzeigen && chargen.length > 0 && (
          <div className="card divide-y divide-s112-line">
            {chargen.map(c => (
              <div key={c.id} className="flex items-center justify-between gap-3 px-4 py-2 text-sm">
                <Link href={`/kellerbuch/weinausbau/${c.id}/buch`} className="min-w-0 truncate font-medium text-s112-text hover:text-s112-blue-700">
                  {c.name ?? '–'}
                </Link>
                <span className="shrink-0 text-xs text-s112-muted">
                  {[c.jahrgang, c.rebsorte, c.status ? WEINBUCH_STATUS_LABEL[c.status] ?? c.status : null].filter(Boolean).join(' · ')}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {chargen.length === 0 ? (
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
                {wb.wa.pruefnummer ? ` · Prüfnummer ${wb.wa.pruefnummer}` : ''}
              </p>
            </div>
            {/* KAN-127: Hinweise der Charge auch im Ausdruck */}
            {wb.abgeschlossenAm && (
              <p className="text-xs text-s112-muted mb-2">Weinbuch abgeschlossen mit der Füllung am {new Date(`${wb.abgeschlossenAm}T12:00:00`).toLocaleDateString('de-AT', { timeZone: 'Europe/Vienna' })}.</p>
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
