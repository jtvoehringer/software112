// behoerdenmeldung: bki-lagerbewegungen
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentMembership } from '@/lib/auth/roles'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import CsvExportKnopf from '@/components/CsvExportKnopf'
import { csvPfad } from '@/lib/behoerden/katalog'
import { ladeLagerbewegungen } from '@/lib/behoerden/lagerstand'
import { istTag, zeitraumAnzeige } from '@/lib/behoerden/kellerbuch-hilfen'
import { fmtNum } from '@/lib/format'
import { wienHeute } from '@/lib/csv'
import DruckKnopf from '../_behoerden/DruckKnopf'
import LagerTabs from '../_behoerden/LagerTabs'
import ZeitraumFormular from '../_behoerden/ZeitraumFormular'

// KAN-44 Teil 1: BKI-Blatt „Lagerbewegungen“ aus dem Bewegungsjournal – dieselbe Ladefunktion liefert die CSV
// (/meldungen/bki-lagerbewegungen/csv?von=…&bis=…). Ohne Zeitraum: ab 1. Jänner des laufenden Jahres.

export const metadata: Metadata = { title: 'Lagerbewegungen' }
export const dynamic = 'force-dynamic'

const datum = (d: string) => d.split('-').reverse().join('.')

export default async function LagerbewegungenPage({ searchParams }: { searchParams: Promise<{ von?: string; bis?: string }> }) {
  const sp = await searchParams
  const von = sp.von && istTag(sp.von) ? sp.von : `${wienHeute().slice(0, 4)}-01-01`
  const bisRoh = sp.bis && istTag(sp.bis) ? sp.bis : null
  const bis = bisRoh && bisRoh < von ? null : bisRoh

  const membership = await getCurrentMembership()
  if (!membership?.tenantId) notFound()
  const supabase = await createSupabaseServerClient()
  const l = await ladeLagerbewegungen(supabase, membership.tenantId, { von, bis })

  return (
    <div className="space-y-6">
      <LagerTabs aktiv="lagerbewegungen" />
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold text-s112-text">Lagerbewegungen</h1>
          <p className="text-xs text-s112-muted mt-0.5">
            BKI-Schnittstelle, Blatt „Lagerbewegungen“ · {zeitraumAnzeige({ von, bis })} – jede Buchung des Bewegungsjournals mit
            Anfangs- und Buchungsmenge. Die CSV enthält alle Spalten des Blatts.
          </p>
        </div>
        <div className="flex items-start gap-2 print:hidden">
          <DruckKnopf />
          <CsvExportKnopf href={csvPfad('bki-lagerbewegungen', { von, bis })} />
        </div>
      </div>
      <ZeitraumFormular von={von} bis={bis} zuruecksetzen="/kellerbuch/lagerbewegungen" />
      {l.warnungen.length > 0 && (
        <ul className="text-xs text-s112-warn-fg list-disc pl-4 space-y-0.5">
          {l.warnungen.map((w, i) => <li key={i}>{w}</li>)}
        </ul>
      )}
      <div className="card p-0 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-s112-bg border-b border-s112-border text-left text-xs font-semibold text-s112-text-2">
              <th className="px-3 py-2.5">Datum</th>
              <th className="px-3 py-2.5">Beleg</th>
              <th className="px-3 py-2.5">Produkt</th>
              <th className="px-3 py-2.5">Art</th>
              <th className="px-3 py-2.5">Buchungsart</th>
              <th className="px-3 py-2.5">BSM</th>
              <th className="px-3 py-2.5 text-right">Anfang</th>
              <th className="px-3 py-2.5 text-right">Buchung</th>
              <th className="px-3 py-2.5">Käufer / Verkäufer</th>
              <th className="px-3 py-2.5">Anmerkungen</th>
            </tr>
          </thead>
          <tbody>
            {l.zeilen.length === 0 ? (
              <tr><td colSpan={10} className="px-4 py-8 text-center text-xs text-s112-muted italic">Keine Buchungen im Zeitraum</td></tr>
            ) : l.zeilen.map((z, i) => {
              const fl = z.gebindeArt === 'Flasche'
              const anfang = fl ? `${z.anfangStk} Stk` : `${fmtNum(z.anfangLiter, 2)} l`
              const buchung = fl ? `${(z.buchungStk ?? 0) > 0 ? '+' : ''}${z.buchungStk} Stk` : `${z.buchungLiter > 0 ? '+' : ''}${fmtNum(z.buchungLiter, 2)} l`
              return (
                <tr key={i} className="border-b border-s112-border/30 last:border-0">
                  <td className="px-3 py-2 text-xs whitespace-nowrap">{datum(z.datum)}</td>
                  <td className="px-3 py-2 text-xs">{z.beleg}</td>
                  <td className="px-3 py-2">{z.produkt ?? '–'}</td>
                  <td className="px-3 py-2 text-xs">{z.gebindeArt}</td>
                  <td className="px-3 py-2 text-xs">{z.buchungsart}</td>
                  <td className="px-3 py-2 text-xs">{z.buchungsartBsm ?? ''}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-xs">{anfang}</td>
                  <td className={`px-3 py-2 text-right tabular-nums ${z.buchungLiter < 0 ? 'text-s112-err-fg' : 'text-s112-ok-fg'}`}>{buchung}</td>
                  <td className="px-3 py-2 text-xs">{z.kaeufer ?? z.verkaeufer ?? ''}</td>
                  <td className="px-3 py-2 text-xs text-s112-muted">{z.anmerkung ?? ''}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
