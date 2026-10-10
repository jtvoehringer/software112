// behoerdenmeldung: bki-weingaerten
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentMembership } from '@/lib/auth/roles'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import Link from '@/components/ui/Link'
import CsvExportKnopf from '@/components/CsvExportKnopf'
import { csvPfad } from '@/lib/behoerden/katalog'
import { ladeBkiWeingaerten } from '@/lib/behoerden/bki-weingaerten'
import { fmtNum } from '@/lib/format'
import DruckKnopf from '../_behoerden/DruckKnopf'
import LagerTabs from '../_behoerden/LagerTabs'

// KAN-47 AP10 Schritt 1: BKI-Blatt „Weingärten“ – dieselbe Ladefunktion liefert die CSV (/meldungen/bki-weingaerten/csv).
// Die Seite zeigt die wichtigsten Spalten, die CSV alle 26. Annahmen W1–W6 in lib/behoerden/bki-weingaerten.ts.

export const metadata: Metadata = { title: 'Weingärten (BKI)' }
export const dynamic = 'force-dynamic'

export default async function BkiWeingaertenPage({ searchParams }: { searchParams: Promise<{ aktiv?: string }> }) {
  const sp = await searchParams
  const nurAktiv = sp.aktiv === '1'
  const membership = await getCurrentMembership()
  if (!membership?.tenantId) notFound()
  const supabase = await createSupabaseServerClient()
  const r = await ladeBkiWeingaerten(supabase, membership.tenantId, { nurAktiv })
  const summeM2 = r.zeilen.reduce((s, z) => s + (z.flaecheSorteM2 ?? 0), 0)

  return (
    <div className="space-y-6">
      <LagerTabs aktiv="weingaerten" />
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold text-s112-text">Weingärten</h1>
          <p className="text-xs text-s112-muted mt-0.5">
            BKI-Schnittstelle, Blatt „Weingärten“ – eine Zeile je Grundstück aus den{' '}
            <Link href="/weingarten" className="text-s112-blue-700 hover:underline">Rieden</Link>. Die CSV enthält alle 26 Spalten.
          </p>
        </div>
        <div className="flex items-start gap-2 print:hidden">
          <DruckKnopf />
          <CsvExportKnopf href={csvPfad('bki-weingaerten', nurAktiv ? { aktiv: '1' } : {})} />
        </div>
      </div>
      <div className="flex gap-2 text-xs print:hidden">
        <Link href="/kellerbuch/bki-weingaerten" className={`px-3 py-1.5 rounded-lg border ${nurAktiv ? 'border-s112-border text-s112-muted' : 'border-s112-teal text-s112-blue-700 font-medium'}`}>Alle</Link>
        <Link href="/kellerbuch/bki-weingaerten?aktiv=1" className={`px-3 py-1.5 rounded-lg border ${nurAktiv ? 'border-s112-teal text-s112-blue-700 font-medium' : 'border-s112-border text-s112-muted'}`}>Nur bewirtschaftete</Link>
      </div>
      {r.warnungen.length > 0 && (
        <ul className="text-xs text-s112-warn-fg list-disc pl-4 space-y-0.5">
          {r.warnungen.map((w, i) => <li key={i}>{w}</li>)}
        </ul>
      )}
      <div className="card p-0 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-s112-bg border-b border-s112-border text-left text-xs font-semibold text-s112-text-2">
              <th className="px-3 py-2.5">Bezeichnung</th>
              <th className="px-3 py-2.5">GST-Nr.</th>
              <th className="px-3 py-2.5">KG</th>
              <th className="px-3 py-2.5">Feldstück</th>
              <th className="px-3 py-2.5">Sorte</th>
              <th className="px-3 py-2.5 text-right">Fläche (m²)</th>
              <th className="px-3 py-2.5">Pflanzjahr</th>
              <th className="px-3 py-2.5">Eigen/Pacht</th>
              <th className="px-3 py-2.5">Gemeinde</th>
              <th className="px-3 py-2.5">g.U. / DAC</th>
            </tr>
          </thead>
          <tbody>
            {r.zeilen.length === 0 ? (
              <tr><td colSpan={10} className="px-4 py-8 text-center text-xs text-s112-muted italic">Noch keine Rieden erfasst</td></tr>
            ) : r.zeilen.map((z, i) => (
              <tr key={i} className={`border-b border-s112-border/30 last:border-0 ${z.kommentar ? 'text-s112-muted' : ''}`}>
                <td className="px-3 py-2">{z.bezeichnung ?? '–'}{z.kommentar && <span className="block text-[11px]">{z.kommentar}</span>}</td>
                <td className="px-3 py-2 text-xs">{z.gstNr ?? '–'}</td>
                <td className="px-3 py-2 text-xs">{z.kgNr ? `${z.kgNr} ${z.katastralgemeinde ?? ''}` : '–'}</td>
                <td className="px-3 py-2 text-xs">{z.feldstueck ?? '–'}</td>
                <td className="px-3 py-2 text-xs">{z.sorte ?? '–'}{z.qualitaetsrebsorte === false && z.sorte ? ' (keine Qualitätsrebsorte)' : ''}</td>
                <td className="px-3 py-2 text-right tabular-nums">{z.flaecheSorteM2 === null ? '–' : fmtNum(z.flaecheSorteM2, 0)}</td>
                <td className="px-3 py-2 text-xs">{z.pflanzjahr ?? '–'}</td>
                <td className="px-3 py-2 text-xs">{z.eigen === null ? '–' : z.eigen ? 'Eigen' : 'Pacht'}</td>
                <td className="px-3 py-2 text-xs">{z.gemeinde ?? '–'}{z.bundesland ? ` (${z.bundesland})` : ''}</td>
                <td className="px-3 py-2 text-xs">{z.dacGebiet ? `${z.dacGebiet} DAC` : z.gU ?? '–'}</td>
              </tr>
            ))}
            {r.zeilen.length > 0 && (
              <tr className="border-t-2 border-s112-teal/30 bg-s112-teal/5 text-sm">
                <td colSpan={5} className="px-3 py-2 font-medium">{r.zeilen.length} Zeilen</td>
                <td className="px-3 py-2 text-right tabular-nums font-semibold">{fmtNum(summeM2, 0)}</td>
                <td colSpan={4} className="px-3 py-2 text-xs text-s112-muted">≈ {fmtNum(summeM2 / 10000, 4)} ha</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
