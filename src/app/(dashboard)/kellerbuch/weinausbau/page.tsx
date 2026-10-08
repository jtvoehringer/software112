import { createSupabaseServerClient } from '@/lib/supabase/server'
import { alle } from '@/lib/supabase/alle'
import { getCurrentMembership } from '@/lib/auth/roles'
import { fmtLiter } from '@/lib/format'
import type { Metadata } from 'next'
import Link from '@/components/ui/Link'
import { formatRebsorteMitKuerzel } from '@/lib/wein/bki_kuerzel'

export const metadata: Metadata = { title: 'Weinausbau – software:112' }
export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  ernte:         { label: 'Ernte',         color: 'bg-s112-warn-bg text-s112-warn-fg' },
  gaerung:       { label: 'Gärung',        color: 'bg-s112-warn-bg text-s112-warn-fg' },
  ausbau:        { label: 'Ausbau',        color: 'bg-s112-blue-100 text-s112-blue-700' },
  abfuellung:    { label: 'Abfüllung',     color: 'bg-[#F2F3F5] text-s112-text-1' },
  abgeschlossen: { label: 'Abgeschlossen', color: 'bg-s112-ok-bg text-s112-ok-fg' },
}

export default async function WeinausbauListePage() {
  const supabase   = await createSupabaseServerClient()
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
  // alle(): Chargen sammeln sich über die Jahrgänge – PostgREST kappt sonst still bei 1.000
  const { data: raw } = await alle(query.order('id'))

  const chargen = (raw ?? []) as R[]
  const aktive  = chargen.filter((w: R) => w.status !== 'abgeschlossen' && !w.ist_eroeffnungsbestand)
  const abgesch = chargen.filter((w: R) => w.status === 'abgeschlossen' && !w.ist_eroeffnungsbestand)

  function ChargenTabelle({ liste }: { liste: R[] }) {
    if (liste.length === 0) {
      return <p className="text-sm text-s112-muted italic px-4 py-3">Keine Einträge</p>
    }
    // KAN-181: am Handy waagrecht scrollbar statt gequetscht (die Karte bleibt overflow-hidden für die Ecken)
    return (
      <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-sm">
        <thead>
          <tr className="border-b border-s112-border/50">
            <th className="text-left px-4 py-2 text-xs font-medium text-s112-text-2">Charge</th>
            <th className="text-left px-4 py-2 text-xs font-medium text-s112-text-2">Jg.</th>
            <th className="text-left px-4 py-2 text-xs font-medium text-s112-text-2">Rebsorte</th>
            <th className="text-left px-4 py-2 text-xs font-medium text-s112-text-2">Behälter</th>
            <th className="text-left px-4 py-2 text-xs font-medium text-s112-text-2">Status</th>
            <th className="text-right px-4 py-2 text-xs font-medium text-s112-text-2">Liter</th>
          </tr>
        </thead>
        <tbody>
          {liste.map((w: R) => {
            const st    = STATUS_LABELS[w.status] ?? { label: w.status, color: 'bg-[#F2F3F5] text-s112-text-2' }
            const menge = parseFloat(w.menge_liter) || 0
            return (
              <tr key={w.id} className="border-b border-s112-border/30 last:border-0 hover:bg-s112-bg/40">
                <td className="px-4 py-2.5 font-medium text-s112-text">
                  <Link href={`/kellerbuch/weinausbau/${w.id}`} className="font-medium text-s112-blue-700 hover:underline">
                    {w.name || 'Charge ohne Namen'}
                  </Link>
                </td>
                <td className="px-4 py-2.5 text-s112-muted text-xs">{w.jahrgang ?? '–'}</td>
                <td className="px-4 py-2.5 text-s112-muted text-xs">{formatRebsorteMitKuerzel(w.rebsorte)}</td>
                <td className="px-4 py-2.5 text-s112-muted text-xs">{(w.behaelter as R)?.name ?? '–'}</td>
                <td className="px-4 py-2.5">
                  <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${st.color}`}>{st.label}</span>
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums text-s112-text">{fmtLiter(menge)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
      </div>
    )
  }

  return (
    <div>
      <div className="flex items-center gap-2 text-sm text-s112-muted mb-4">
        <Link href="/kellerbuch" className="hover:text-s112-blue-700 transition-colors">Kellerbuch</Link>
        <span>/</span>
        <span className="text-s112-text-1 font-medium">Weinausbau</span>
      </div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-s112-text">Weinausbau</h1>
          <p className="text-sm text-s112-muted mt-0.5">Alle Chargen im Überblick</p>
        </div>
        <div className="flex items-center gap-3">
          <Link href="/kellerbuch" className="text-sm text-s112-muted hover:text-s112-blue-700">
            ← Kellerbuch
          </Link>
        </div>
      </div>

      {/* Laufende Chargen */}
      <div className="card p-0 overflow-hidden mb-6">
        <div className="flex items-center justify-between px-4 py-3 bg-s112-bg border-b border-s112-border">
          <h2 className="font-semibold text-s112-text text-sm">Laufende Chargen</h2>
          <span className="text-xs text-s112-muted">{aktive.length} Einträge</span>
        </div>
        <ChargenTabelle liste={aktive} />
      </div>

      {/* Abgeschlossene Chargen – standardmäßig eingeklappt (Rückverfolgung/Prüfungen
          bleiben so erreichbar, ohne im Alltag Platz auf der Seite wegzunehmen) */}
      {abgesch.length > 0 && (
        <details className="card p-0 overflow-hidden group">
          <summary className="flex items-center justify-between px-4 py-3 bg-s112-bg border-b border-s112-border cursor-pointer select-none list-none">
            <span className="flex items-center gap-2">
              <span className="text-s112-muted text-xs transition-transform group-open:rotate-90">▶</span>
              <h2 className="font-semibold text-s112-text text-sm">Abgeschlossene Chargen</h2>
            </span>
            <span className="text-xs text-s112-muted">{abgesch.length} Einträge</span>
          </summary>
          <ChargenTabelle liste={abgesch} />
        </details>
      )}
    </div>
  )
}
