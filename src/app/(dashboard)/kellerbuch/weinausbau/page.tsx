import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentUserRole, canWrite, getCurrentMembership } from '@/lib/auth/roles'
import { fmtLiter } from '@/lib/format'
import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = { title: 'Weinausbau – software:112' }
export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  ernte:         { label: 'Ernte',         color: 'bg-yellow-100 text-yellow-700' },
  gaerung:       { label: 'Gärung',        color: 'bg-orange-100 text-orange-700' },
  ausbau:        { label: 'Ausbau',        color: 'bg-blue-100 text-blue-700' },
  abfuellung:    { label: 'Abfüllung',     color: 'bg-purple-100 text-purple-700' },
  abgeschlossen: { label: 'Abgeschlossen', color: 'bg-green-100 text-green-700' },
}

export default async function WeinausbauListePage() {
  const supabase   = await createSupabaseServerClient()
  const role       = await getCurrentUserRole()
  const writeOk    = canWrite(role)
  const membership = await getCurrentMembership()
  const tenantId   = membership?.tenantId ?? null

  let query = (supabase.from('weinausbau') as any)
    .select('id, name, jahrgang, rebsorte, menge_liter, status, aktiv, ist_eroeffnungsbestand, behaelter:behaelter_id(name)')
    .order('jahrgang', { ascending: false })
    .order('name')
  // Explizite Tenant-Filterung zusätzlich zu RLS: RLS erlaubt Zeilen aus JEDER Mitgliedschaft
  // des Nutzers, nicht nur dem aktiv gewählten Betrieb – ohne diesen Filter könnten bei
  // Mehrfach-Mitgliedschaft Daten vom falschen Betrieb angezeigt werden.
  if (tenantId) query = query.eq('tenant_id', tenantId)
  const { data: raw } = await query

  const chargen = (raw ?? []) as R[]
  const aktive  = chargen.filter((w: R) => w.status !== 'abgeschlossen' && !w.ist_eroeffnungsbestand)
  const abgesch = chargen.filter((w: R) => w.status === 'abgeschlossen' && !w.ist_eroeffnungsbestand)

  function ChargenTabelle({ liste, showNew }: { liste: R[], showNew?: boolean }) {
    if (liste.length === 0) {
      return <p className="text-sm text-s112-muted italic px-4 py-3">Keine Einträge</p>
    }
    return (
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-s112-border/50">
            <th className="text-left px-4 py-2 text-xs font-medium text-gray-500">Charge</th>
            <th className="text-left px-4 py-2 text-xs font-medium text-gray-500">Jg.</th>
            <th className="text-left px-4 py-2 text-xs font-medium text-gray-500">Rebsorte</th>
            <th className="text-left px-4 py-2 text-xs font-medium text-gray-500">Behälter</th>
            <th className="text-left px-4 py-2 text-xs font-medium text-gray-500">Status</th>
            <th className="text-right px-4 py-2 text-xs font-medium text-gray-500">Liter</th>
            <th className="px-4 py-2" />
          </tr>
        </thead>
        <tbody>
          {liste.map((w: R) => {
            const st    = STATUS_LABELS[w.status] ?? { label: w.status, color: 'bg-gray-100 text-gray-600' }
            const menge = parseFloat(w.menge_liter) || 0
            return (
              <tr key={w.id} className="border-b border-s112-border/30 last:border-0 hover:bg-s112-bg/40">
                <td className="px-4 py-2.5 font-medium text-gray-800">{w.name}</td>
                <td className="px-4 py-2.5 text-s112-muted text-xs">{w.jahrgang ?? '–'}</td>
                <td className="px-4 py-2.5 text-s112-muted text-xs">{w.rebsorte ?? '–'}</td>
                <td className="px-4 py-2.5 text-s112-muted text-xs">{(w.behaelter as R)?.name ?? '–'}</td>
                <td className="px-4 py-2.5">
                  <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${st.color}`}>{st.label}</span>
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums text-gray-800">{fmtLiter(menge)}</td>
                <td className="px-4 py-2.5 text-right">
                  <Link href={`/kellerbuch/weinausbau/${w.id}`}
                    className="text-xs text-s112-teal hover:underline whitespace-nowrap">
                    Details →
                  </Link>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    )
  }

  return (
    <div>
      <div className="flex items-center gap-2 text-sm text-s112-muted mb-4">
        <Link href="/kellerbuch" className="hover:text-s112-teal transition-colors">Kellerbuch</Link>
        <span>/</span>
        <span className="text-gray-700 font-medium">Weinausbau</span>
      </div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Weinausbau</h1>
          <p className="text-sm text-s112-muted mt-0.5">Alle Chargen im Überblick</p>
        </div>
        <div className="flex items-center gap-3">
          <Link href="/kellerbuch" className="text-sm text-s112-muted hover:text-s112-teal">
            ← Kellerbuch
          </Link>
        </div>
      </div>

      {/* Laufende Chargen */}
      <div className="card p-0 overflow-hidden mb-6">
        <div className="flex items-center justify-between px-4 py-3 bg-s112-bg border-b border-s112-border">
          <h2 className="font-semibold text-gray-800 text-sm">Laufende Chargen</h2>
          <span className="text-xs text-s112-muted">{aktive.length} Einträge</span>
        </div>
        <ChargenTabelle liste={aktive} showNew />
      </div>

      {/* Abgeschlossene Chargen – standardmäßig eingeklappt (Rückverfolgung/Prüfungen
          bleiben so erreichbar, ohne im Alltag Platz auf der Seite wegzunehmen) */}
      {abgesch.length > 0 && (
        <details className="card p-0 overflow-hidden group">
          <summary className="flex items-center justify-between px-4 py-3 bg-s112-bg border-b border-s112-border cursor-pointer select-none list-none">
            <span className="flex items-center gap-2">
              <span className="text-s112-muted text-xs transition-transform group-open:rotate-90">▶</span>
              <h2 className="font-semibold text-gray-800 text-sm">Abgeschlossene Chargen</h2>
            </span>
            <span className="text-xs text-s112-muted">{abgesch.length} Einträge</span>
          </summary>
          <ChargenTabelle liste={abgesch} />
        </details>
      )}
    </div>
  )
}
