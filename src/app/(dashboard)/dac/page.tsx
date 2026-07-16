import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentUserRole, canWrite } from '@/lib/auth/roles'
import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = { title: 'DAC & Prüfnummern – software:112' }
export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

const STATUS: Record<string, { label: string; color: string }> = {
  entwurf:      { label: 'Entwurf',       color: 'bg-gray-100 text-gray-600' },
  eingereicht:  { label: 'Eingereicht',   color: 'bg-blue-100 text-blue-700' },
  in_pruefung:  { label: 'In Prüfung',    color: 'bg-yellow-100 text-yellow-700' },
  genehmigt:    { label: 'Genehmigt',     color: 'bg-green-100 text-green-700' },
  abgelehnt:    { label: 'Abgelehnt',     color: 'bg-red-100 text-red-700' },
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
  const writeOk = canWrite(role)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: raw } = await (supabase.from('dac_antrag') as any)
    .select('id, bezeichnung, dac_region, jahrgang, rebsorte, status, pruefnummer, eingereicht_am, aktiv')
    .order('created_at', { ascending: false })

  const antraege = (raw ?? []) as R[]
  const genehmigt   = antraege.filter((a: R) => a.status === 'genehmigt').length
  const offen       = antraege.filter((a: R) => ['eingereicht','in_pruefung'].includes(a.status)).length
  const entwuerfe   = antraege.filter((a: R) => a.status === 'entwurf').length

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">DAC & Prüfnummern</h1>
          <p className="text-sm text-s112-muted mt-0.5">Anträge nach österreichischem Weinrecht</p>
        </div>
        {writeOk && (
          <Link href="/dac/neu"
            className="inline-flex items-center gap-2 bg-s112-teal text-white px-4 py-2 rounded-xl text-sm font-semibold hover:bg-opacity-90 transition-colors">
            ＋ Neuer Antrag
          </Link>
        )}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="card text-center">
          <p className="text-3xl font-bold text-green-600">{genehmigt}</p>
          <p className="text-xs text-s112-muted mt-1">Genehmigt</p>
        </div>
        <div className="card text-center">
          <p className="text-3xl font-bold text-blue-600">{offen}</p>
          <p className="text-xs text-s112-muted mt-1">In Bearbeitung</p>
        </div>
        <div className="card text-center">
          <p className="text-3xl font-bold text-gray-500">{entwuerfe}</p>
          <p className="text-xs text-s112-muted mt-1">Entwürfe</p>
        </div>
      </div>

      {antraege.length > 0 ? (
        <div className="card p-0 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-s112-bg border-b border-s112-border">
                <th className="text-left px-4 py-3 font-semibold text-gray-700">Bezeichnung</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-700">DAC-Region</th>
                <th className="text-center px-4 py-3 font-semibold text-gray-700">JG</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-700">Status</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-700">Prüfnummer</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-700">Eingereicht</th>
                <th className="text-right px-4 py-3 font-semibold text-gray-700"></th>
              </tr>
            </thead>
            <tbody>
              {antraege.map((a: R, i: number) => {
                const st = STATUS[a.status] ?? { label: a.status, color: 'bg-gray-100 text-gray-600' }
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
                        <span className="bg-green-50 text-green-700 px-2 py-1 rounded">{a.pruefnummer}</span>
                      ) : '–'}
                    </td>
                    <td className="px-4 py-3 text-s112-muted text-xs">
                      {a.eingereicht_am ? new Date(a.eingereicht_am).toLocaleDateString('de-AT') : '–'}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {writeOk && (
                        <Link href={`/dac/${a.id}`}
                          title="Bearbeiten" aria-label="Bearbeiten"
                          className="text-s112-teal hover:text-s112-teal/70">✏️</Link>
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
          <p className="text-4xl mb-4">📋</p>
          <p className="text-gray-700 font-medium">Noch keine Anträge</p>
          <p className="text-s112-muted text-sm mt-1 mb-6">Legen Sie Ihren ersten Antrag an</p>
          {writeOk && (
            <Link href="/dac/neu"
              className="inline-flex items-center gap-2 bg-s112-teal text-white px-5 py-2 rounded-xl text-sm font-semibold hover:bg-opacity-90 transition-colors">
              ＋ Erster Antrag
            </Link>
          )}
        </div>
      )}
    </div>
  )
}
