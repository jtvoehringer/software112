import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentUserRole, canWrite } from '@/lib/auth/roles'
import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = { title: 'Kellerbuch – software:112' }
export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  ernte:        { label: 'Ernte',       color: 'bg-yellow-100 text-yellow-700' },
  gaerung:      { label: 'Gärung',      color: 'bg-orange-100 text-orange-700' },
  ausbau:       { label: 'Ausbau',      color: 'bg-blue-100 text-blue-700' },
  abfuellung:   { label: 'Abfüllung',   color: 'bg-purple-100 text-purple-700' },
  abgeschlossen:{ label: 'Abgeschlossen', color: 'bg-green-100 text-green-700' },
}

const TYP_LABELS: Record<string, string> = {
  stahltank: 'Stahltank', holzfass: 'Holzfass',
  betonei: 'Betonei', amphore: 'Amphore', sonstiges: 'Sonstiges',
}

export default async function KellerbuchPage() {
  const supabase = await createSupabaseServerClient()
  const role = await getCurrentUserRole()
  const writeOk = canWrite(role)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [{ data: behaelterRaw }, { data: weinausbauRaw }] = await Promise.all([
    (supabase.from('behaelter') as any)
      .select('id, name, typ, volumen_liter, standort, aktiv')
      .order('name'),
    (supabase.from('weinausbau') as any)
      .select('id, name, jahrgang, rebsorte, menge_liter, status, aktiv, behaelter_id')
      .order('jahrgang', { ascending: false }),
  ])

  const behaelter   = (behaelterRaw ?? []) as R[]
  const weinausbau  = (weinausbauRaw ?? []) as R[]
  const aktiveChargen = weinausbau.filter((w: R) => w.aktiv && w.status !== 'abgeschlossen')
  const gesamtLiter   = aktiveChargen.reduce((s: number, w: R) => s + (w.menge_liter ?? 0), 0)

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Kellerbuch</h1>
          <p className="text-sm text-s112-muted mt-0.5">Behälter & Weinausbau-Chargen</p>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4 mb-8">
        <div className="card text-center">
          <p className="text-3xl font-bold text-s112-teal">{behaelter.filter((b: R) => b.aktiv).length}</p>
          <p className="text-xs text-s112-muted mt-1">Aktive Behälter</p>
        </div>
        <div className="card text-center">
          <p className="text-3xl font-bold text-s112-teal">{aktiveChargen.length}</p>
          <p className="text-xs text-s112-muted mt-1">Laufende Chargen</p>
        </div>
        <div className="card text-center">
          <p className="text-3xl font-bold text-s112-teal">{gesamtLiter.toLocaleString('de-AT')}</p>
          <p className="text-xs text-s112-muted mt-1">Liter in Ausbau</p>
        </div>
      </div>

      {/* Zwei Sektionen nebeneinander */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* ── BEHÄLTER ── */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-gray-800">Behälter</h2>
            {writeOk && (
              <Link href="/kellerbuch/behaelter/neu"
                className="text-xs text-s112-teal font-semibold hover:underline">
                ＋ Neuer Behälter
              </Link>
            )}
          </div>
          {behaelter.length > 0 ? (
            <div className="card p-0 overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-s112-bg border-b border-s112-border">
                    <th className="text-left px-4 py-2 font-semibold text-gray-700">Name</th>
                    <th className="text-left px-4 py-2 font-semibold text-gray-700">Typ</th>
                    <th className="text-right px-4 py-2 font-semibold text-gray-700">Liter</th>
                    <th className="text-right px-4 py-2 font-semibold text-gray-700"></th>
                  </tr>
                </thead>
                <tbody>
                  {behaelter.map((b: R, i: number) => (
                    <tr key={b.id} className={`border-b border-s112-border last:border-0 ${!b.aktiv ? 'opacity-40' : ''} ${i%2===1?'bg-s112-bg/50':''}`}>
                      <td className="px-4 py-2 font-medium">{b.name}</td>
                      <td className="px-4 py-2 text-s112-muted">{b.typ ? TYP_LABELS[b.typ] : '–'}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{b.volumen_liter ? b.volumen_liter.toLocaleString('de-AT') : '–'}</td>
                      <td className="px-4 py-2 text-right">
                        {writeOk && (
                          <Link href={`/kellerbuch/behaelter/${b.id}`} className="text-s112-teal hover:underline text-xs">Bearbeiten</Link>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="card text-center py-8">
              <p className="text-2xl mb-2">🛢️</p>
              <p className="text-sm text-s112-muted">Noch keine Behälter angelegt</p>
              {writeOk && (
                <Link href="/kellerbuch/behaelter/neu" className="text-xs text-s112-teal font-semibold mt-2 inline-block hover:underline">＋ Ersten Behälter anlegen</Link>
              )}
            </div>
          )}
        </section>

        {/* ── WEINAUSBAU ── */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-gray-800">Weinausbau-Chargen</h2>
            {writeOk && (
              <Link href="/kellerbuch/weinausbau/neu"
                className="text-xs text-s112-teal font-semibold hover:underline">
                ＋ Neue Charge
              </Link>
            )}
          </div>
          {weinausbau.length > 0 ? (
            <div className="card p-0 overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-s112-bg border-b border-s112-border">
                    <th className="text-left px-4 py-2 font-semibold text-gray-700">Charge</th>
                    <th className="text-left px-4 py-2 font-semibold text-gray-700">JG</th>
                    <th className="text-left px-4 py-2 font-semibold text-gray-700">Status</th>
                    <th className="text-right px-4 py-2 font-semibold text-gray-700">Liter</th>
                    <th className="text-right px-4 py-2 font-semibold text-gray-700"></th>
                  </tr>
                </thead>
                <tbody>
                  {weinausbau.map((w: R, i: number) => {
                    const st = STATUS_LABELS[w.status] ?? { label: w.status, color: 'bg-gray-100 text-gray-600' }
                    return (
                      <tr key={w.id} className={`border-b border-s112-border last:border-0 ${!w.aktiv ? 'opacity-40' : ''} ${i%2===1?'bg-s112-bg/50':''}`}>
                        <td className="px-4 py-2 font-medium">{w.name}</td>
                        <td className="px-4 py-2 text-s112-muted">{w.jahrgang ?? '–'}</td>
                        <td className="px-4 py-2">
                          <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${st.color}`}>{st.label}</span>
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums">{w.menge_liter ? w.menge_liter.toLocaleString('de-AT') : '–'}</td>
                        <td className="px-4 py-2 text-right">
                          {writeOk && (
                            <Link href={`/kellerbuch/weinausbau/${w.id}`} className="text-s112-teal hover:underline text-xs">Bearbeiten</Link>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="card text-center py-8">
              <p className="text-2xl mb-2">🍷</p>
              <p className="text-sm text-s112-muted">Noch keine Chargen angelegt</p>
              {writeOk && (
                <Link href="/kellerbuch/weinausbau/neu" className="text-xs text-s112-teal font-semibold mt-2 inline-block hover:underline">＋ Erste Charge anlegen</Link>
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
