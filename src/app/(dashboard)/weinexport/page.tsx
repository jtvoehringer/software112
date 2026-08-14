import { redirect } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentMembership } from '@/lib/auth/roles'
import type { Metadata } from 'next'
import Link from 'next/link'
import { Truck } from 'lucide-react'
export const metadata: Metadata = { title: 'Weinexport – software:112' }
export const dynamic = 'force-dynamic'
type R = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

const STATUS_LABEL: Record<string, string> = {
  entwurf: 'Entwurf', bestaetigt: 'Bestätigt',
  versendet: 'Versendet', abgeschlossen: 'Abgeschlossen',
}
const STATUS_COLOR: Record<string, string> = {
  entwurf: 'bg-gray-100 text-gray-600',
  bestaetigt: 'bg-blue-100 text-blue-700',
  versendet: 'bg-amber-100 text-amber-700',
  abgeschlossen: 'bg-green-100 text-green-700',
}

export default async function WeinexportPage() {
  const supabase = await createSupabaseServerClient()
  const membership = await getCurrentMembership()
  const tenantId = membership?.tenantId ?? null

  // Exportaufträge ist ein optionales Modul (Migration 152) - pro Mandant unter
  // Admin > Mandant > Module ein-/ausschaltbar, da nicht jeder Betrieb exportiert.
  const { data: einst } = await (supabase.from('tenant_einstellungen') as any)
    .select('modul_export').eq('tenant_id', tenantId).maybeSingle()
  if (!einst?.modul_export) redirect('/dashboard')

  const { data: auftraege } = await (supabase.from('exportauftraege') as any)
    .select(`*, kontakte(vorname, nachname), firmen(name)`)
    .eq('tenant_id', tenantId).eq('aktiv', true)
    .order('created_at', { ascending: false })

  const rows = (auftraege ?? []) as R[]

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Truck className="w-6 h-6 text-s112-teal" />
            Weinexport
          </h1>
          <p className="text-sm text-s112-muted mt-1">{rows.length} Exportauftrag{rows.length !== 1 ? 'aufträge' : ''}</p>
        </div>
        <Link href="/weinexport/neu"
          className="bg-s112-teal text-white px-4 py-2 rounded-xl text-sm font-semibold hover:bg-opacity-90">
          + Neuer Auftrag
        </Link>
      </div>

      {rows.length === 0 ? (
        <div className="text-center py-16 text-s112-muted">
          <p className="font-medium">Noch keine Exportaufträge</p>
          <Link href="/weinexport/neu" className="text-s112-teal text-sm hover:underline mt-2 inline-block">
            Ersten Exportauftrag anlegen →
          </Link>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-s112-border overflow-hidden">
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
              {rows.map((a: R) => {
                const importeur = a.firmen?.name ?? [a.kontakte?.vorname, a.kontakte?.nachname].filter(Boolean).join(' ') ?? '–'
                return (
                  <tr key={a.id} className="hover:bg-s112-bg/50 cursor-pointer">
                    <td className="px-5 py-3 font-medium">
                      <Link href={`/weinexport/${a.id}`} className="hover:text-s112-teal">
                        {a.referenz ?? '(kein Kz.)'}
                      </Link>
                    </td>
                    <td className="px-5 py-3 text-gray-700">{importeur}</td>
                    <td className="px-5 py-3 text-gray-700">
                      {[a.destination_stadt, a.destination_land].filter(Boolean).join(', ') || '–'}
                    </td>
                    <td className="px-5 py-3 text-s112-muted">
                      {a.datum ? new Date(a.datum).toLocaleDateString('de-AT') : '–'}
                    </td>
                    <td className="px-5 py-3 text-gray-600">{a.incoterms ?? '–'}</td>
                    <td className="px-5 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLOR[a.status] ?? 'bg-gray-100 text-gray-600'}`}>
                        {STATUS_LABEL[a.status] ?? a.status}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
