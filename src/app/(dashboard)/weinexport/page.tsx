// behoerdenmeldung: exportauftraege
import { redirect } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentMembership } from '@/lib/auth/roles'
import type { Metadata } from 'next'
import Link from '@/components/ui/Link'
import { Truck } from 'lucide-react'
import CsvExportKnopf from '@/components/CsvExportKnopf'
import { csvPfad } from '@/lib/behoerden/katalog'
import { ladeExportauftraege } from '@/lib/behoerden/exportauftrag'
export const metadata: Metadata = { title: 'Weinexport – software:112' }
export const dynamic = 'force-dynamic'

const STATUS_COLOR: Record<string, string> = {
  entwurf: 'bg-[#F2F3F5] text-s112-text-2',
  bestaetigt: 'bg-s112-blue-100 text-s112-blue-700',
  versendet: 'bg-s112-warn-bg text-s112-warn-fg',
  abgeschlossen: 'bg-s112-ok-bg text-s112-ok-fg',
}

export default async function WeinexportPage() {
  const supabase = await createSupabaseServerClient()
  const membership = await getCurrentMembership()
  const tenantId = membership?.tenantId ?? null

  // Exportaufträge ist ein optionales Modul (Migration 152) - pro Mandant unter
  // Admin > Mandant > Module ein-/ausschaltbar, da nicht jeder Betrieb exportiert.
  const { data: einst } = await (supabase.from('tenant_einstellungen') as any)
    .select('modul_export').eq('tenant_id', tenantId).maybeSingle()
  if (!einst?.modul_export || !tenantId) redirect('/dashboard')

  // Dieselbe Ladefunktion wie die CSV (/meldungen/exportauftraege/csv)
  const { zeilen: rows } = await ladeExportauftraege(supabase, tenantId)

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-s112-text flex items-center gap-2">
            <Truck className="w-6 h-6 text-s112-blue-700" />
            Weinexport
          </h1>
          <p className="text-sm text-s112-muted mt-1">{rows.length} Exportauftrag{rows.length !== 1 ? 'aufträge' : ''}</p>
        </div>
        <div className="flex items-start gap-2">
          <CsvExportKnopf href={csvPfad('exportauftraege')} className="self-center" />
          <Link href="/weinexport/neu"
            className="bg-s112-teal text-s112-yellow px-4 py-2 rounded-xl text-sm font-semibold hover:bg-opacity-90">
            + Neuer Auftrag
          </Link>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="text-center py-16 text-s112-muted">
          <p className="font-medium">Noch keine Exportaufträge</p>
          <Link href="/weinexport/neu" className="text-s112-blue-700 text-sm hover:underline mt-2 inline-block">
            Ersten Exportauftrag anlegen →
          </Link>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-s112-border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-s112-bg text-xs text-s112-muted uppercase tracking-wide">
              <tr>
                <th className="px-5 py-3 text-left">Referenz</th>
                <th className="px-5 py-3 text-left">Importeur</th>
                <th className="px-5 py-3 text-left">Destination</th>
                <th className="px-5 py-3 text-left">Datum</th>
                <th className="px-5 py-3 text-left">Incoterms</th>
                <th className="px-5 py-3 text-left">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-s112-border/40">
              {rows.map(a => (
                <tr key={a.id} className="hover:bg-s112-bg/50 cursor-pointer">
                  <td className="px-5 py-3 font-medium">
                    <Link href={`/weinexport/${a.id}`} className="hover:text-s112-blue-700">
                      {a.referenz ?? '(kein Kz.)'}
                    </Link>
                  </td>
                  <td className="px-5 py-3 text-s112-text-1">{a.importeur ?? '–'}</td>
                  <td className="px-5 py-3 text-s112-text-1">
                    {[a.bestimmungsort, a.bestimmungsland].filter(Boolean).join(', ') || '–'}
                  </td>
                  <td className="px-5 py-3 text-s112-muted">
                    {a.datum ? new Date(a.datum).toLocaleDateString('de-AT') : '–'}
                  </td>
                  <td className="px-5 py-3 text-s112-text-2">{a.incoterms ?? '–'}</td>
                  <td className="px-5 py-3">
                    {a.storniertAm ? (
                      // KAN-150 F2: stornierter Auftrag bleibt gekennzeichnet stehen
                      <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-s112-err-bg text-s112-err-fg"
                        title={`storniert am ${new Date(a.storniertAm).toLocaleDateString('de-AT')}${a.storniertVon ? ` von ${a.storniertVon}` : ''}${a.stornoGrund ? ` – ${a.stornoGrund}` : ''}`}>
                        Storniert
                      </span>
                    ) : (
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${(a.status && STATUS_COLOR[a.status]) || 'bg-[#F2F3F5] text-s112-text-2'}`}>
                        {a.statusLabel ?? a.status}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
