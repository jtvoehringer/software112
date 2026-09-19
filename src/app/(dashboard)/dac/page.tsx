import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentUserRole, canWrite, getCurrentMembership } from '@/lib/auth/roles'
import type { Metadata } from 'next'
import Link from '@/components/ui/Link'
import { Pencil } from 'lucide-react'

export const metadata: Metadata = { title: 'DAC & Prüfnummern – software:112' }
export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

const STATUS: Record<string, { label: string; color: string }> = {
  entwurf:      { label: 'Entwurf',       color: 'bg-[#F2F3F5] text-s112-text-2' },
  eingereicht:  { label: 'Eingereicht',   color: 'bg-s112-blue-100 text-s112-blue-700' },
  in_pruefung:  { label: 'In Prüfung',    color: 'bg-s112-warn-bg text-s112-warn-fg' },
  genehmigt:    { label: 'Genehmigt',     color: 'bg-s112-ok-bg text-s112-ok-fg' },
  abgelehnt:    { label: 'Abgelehnt',     color: 'bg-s112-err-bg text-s112-err-fg' },
}

const DAC_REGIONEN: Record<string, string> = {
  weinviertel: 'Weinviertel', kamptal: 'Kamptal', kremstal: 'Kremstal',
  wachau: 'Wachau', wagram: 'Wagram', traisental: 'Traisental',
  carnuntum: 'Carnuntum', leithaberg: 'Leithaberg', neusiedlersee: 'Neusiedlersee',
  mittelburgenland: 'Mittelburgenland', eisenberg: 'Eisenberg', rosalia: 'Rosalia',
  wiener_gemischter_satz: 'Wiener Gemischter Satz', sonstiges: 'Sonstiges',
}

export default async function DacPage() {
  const supabase = await createSupabaseServerClient()
  const role = await getCurrentUserRole()
  const writeOk = canWrite(role, 'kellerbuch')
  // Explizite Tenant-Filterung zusätzlich zu RLS: RLS erlaubt Zeilen aus JEDER Mitgliedschaft
  // des Nutzers, nicht nur dem aktiv gewählten Betrieb.
  const membership = await getCurrentMembership()
  const tenantId = membership?.tenantId ?? null

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query = (supabase.from('dac_antrag') as any)
    .select('id, bezeichnung, dac_region, jahrgang, rebsorte, status, pruefnummer, eingereicht_am, aktiv')
    .order('created_at', { ascending: false })
  if (tenantId) query = query.eq('tenant_id', tenantId)
  const { data: raw } = await query

  const antraege = (raw ?? []) as R[]
  const genehmigt   = antraege.filter((a: R) => a.status === 'genehmigt').length
  const offen       = antraege.filter((a: R) => ['eingereicht','in_pruefung'].includes(a.status)).length
  const entwuerfe   = antraege.filter((a: R) => a.status === 'entwurf').length

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-s112-text">DAC & Prüfnummern</h1>
          <p className="text-sm text-s112-muted mt-0.5">Anträge nach österreichischem Weinrecht</p>
        </div>
        {writeOk && (
          <Link href="/dac/neu"
            className="inline-flex items-center gap-2 bg-s112-teal text-white px-4 py-2 rounded-xl text-sm font-semibold hover:bg-opacity-90 transition-colors">
            Neuer Antrag
          </Link>
        )}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="card text-center">
          <p className="text-3xl font-semibold text-s112-ok-fg">{genehmigt}</p>
          <p className="text-xs text-s112-muted mt-1">Genehmigt</p>
        </div>
        <div className="card text-center">
          <p className="text-3xl font-semibold text-s112-blue-700">{offen}</p>
          <p className="text-xs text-s112-muted mt-1">In Bearbeitung</p>
        </div>
        <div className="card text-center">
          <p className="text-3xl font-semibold text-s112-text-2">{entwuerfe}</p>
          <p className="text-xs text-s112-muted mt-1">Entwürfe</p>
        </div>
      </div>

      {antraege.length > 0 ? (
        <div className="card p-0 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-s112-bg border-b border-s112-border">
                <th className="text-left px-4 py-3 font-semibold text-s112-text-1">Bezeichnung</th>
                <th className="text-left px-4 py-3 font-semibold text-s112-text-1">DAC-Region</th>
                <th className="text-center px-4 py-3 font-semibold text-s112-text-1">JG</th>
                <th className="text-left px-4 py-3 font-semibold text-s112-text-1">Status</th>
                <th className="text-left px-4 py-3 font-semibold text-s112-text-1">Prüfnummer</th>
                <th className="text-left px-4 py-3 font-semibold text-s112-text-1">Eingereicht</th>
                <th className="text-right px-4 py-3 font-semibold text-s112-text-1"></th>
              </tr>
            </thead>
            <tbody>
              {antraege.map((a: R, i: number) => {
                const st = STATUS[a.status] ?? { label: a.status, color: 'bg-[#F2F3F5] text-s112-text-2' }
                return (
                  <tr key={a.id} className={`border-b border-s112-border last:border-0 ${!a.aktiv ? 'opacity-40' : ''} ${i%2===1 ? 'bg-s112-bg/50' : ''}`}>
                    <td className="px-4 py-3 font-medium">{a.bezeichnung}</td>
                    <td className="px-4 py-3 text-s112-muted">{DAC_REGIONEN[a.dac_region] ?? a.dac_region}</td>
                    <td className="px-4 py-3 text-center tabular-nums">{a.jahrgang ?? '–'}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${st.color}`}>{st.label}</span>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs">
                      {a.pruefnummer ? (
                        <span className="bg-s112-ok-bg text-s112-ok-fg px-2 py-1 rounded">{a.pruefnummer}</span>
                      ) : '–'}
                    </td>
                    <td className="px-4 py-3 text-s112-muted text-xs">
                      {a.eingereicht_am ? new Date(a.eingereicht_am).toLocaleDateString('de-AT') : '–'}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {writeOk && (
                        <Link href={`/dac/${a.id}`}
                          title="Bearbeiten" aria-label="Bearbeiten"
                          className="text-s112-blue-700 hover:text-s112-blue-700/70"><Pencil size={16} /></Link>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="card text-center py-16">
          <p className="text-s112-text-1 font-medium">Noch keine Anträge</p>
          <p className="text-s112-muted text-sm mt-1 mb-6">Legen Sie Ihren ersten Antrag an</p>
          {writeOk && (
            <Link href="/dac/neu"
              className="inline-flex items-center gap-2 bg-s112-teal text-white px-5 py-2 rounded-xl text-sm font-semibold hover:bg-opacity-90 transition-colors">
              Erster Antrag
            </Link>
          )}
        </div>
      )}
    </div>
  )
}
