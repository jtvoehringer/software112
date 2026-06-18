import { createSupabaseServerClient } from '@/lib/supabase/server'
import { fmtLiter } from '@/lib/format'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'

export const metadata: Metadata = { title: 'Umzüge – software:112' }
export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

const TYP_ICONS: Record<string, string> = {
  lagertank: '🪣', immervolltank: '🪣', stahltank: '🪣', holzfass: '🪵', betonei: '⚪', amphore: '🏺', sonstiges: '📦',
}

function fmt(n: number | null) {
  if (n == null || isNaN(n)) return '–'
  return n.toLocaleString('de-AT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' L'
}

export default async function BehaelterUmzuegePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createSupabaseServerClient()

  const { data: bhRow } = await (supabase.from('behaelter') as any)
    .select('id, name, typ, volumen_liter, standort')
    .eq('id', id)
    .single()

  if (!bhRow) notFound()
  const bh = bhRow as R

  // Alle Umzüge bei denen dieser Behälter Quelle ODER Ziel war
  const { data: umzugRaw } = await (supabase.from('keller_umzuege') as any)
    .select(`
      id, datum, menge_liter, brutto_liter, schwund_liter, umzug_typ, zeilen_typ, notizen,
      von_behaelter:von_behaelter_id(id, name),
      nach_behaelter:nach_behaelter_id(id, name),
      von_weinausbau:von_weinausbau_id(name),
      nach_weinausbau:nach_weinausbau_id(name)
    `)
    .or(`von_behaelter_id.eq.${id},nach_behaelter_id.eq.${id}`)
    .not('zeilen_typ', 'eq', 'ziel')   // Ziel-Zeilen (n:n) ausblenden – info steckt in der Quelle
    .order('datum', { ascending: false })

  const umzuege = (umzugRaw ?? []) as R[]

  return (
    <div className="max-w-4xl space-y-6">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-s112-muted">
        <Link href="/kellerbuch" className="hover:text-s112-teal transition-colors">Kellerbuch</Link>
        <span>/</span>
        <span className="text-gray-700 font-medium">{bh.name}</span>
        <span>/</span>
        <span className="text-gray-500">Umzüge</span>
      </div>

      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-start gap-3">
          <span className="text-3xl mt-0.5">{TYP_ICONS[bh.typ] ?? '📦'}</span>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{bh.name}</h1>
            <div className="flex items-center gap-3 mt-0.5 flex-wrap text-xs text-s112-muted">
              {bh.standort && <span>{bh.standort}</span>}
              {bh.volumen_liter && <span>{fmtLiter(parseFloat(bh.volumen_liter))} Kapazität</span>}
            </div>
          </div>
        </div>
        <Link href="/kellerbuch/umziehen"
          className="text-xs border border-s112-teal text-s112-teal px-3 py-1.5 rounded-lg hover:bg-s112-teal/5 font-medium">
          ↔️ Neuer Umzug
        </Link>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-s112-border">
        <Link href={`/kellerbuch/behaelter/${id}/bewegungen`}
          className="px-4 py-2 text-sm font-medium text-s112-muted hover:text-gray-700 border-b-2 border-transparent hover:border-gray-300 -mb-px transition-colors">
          📊 Bewegungsbuch
        </Link>
        <span className="px-4 py-2 text-sm font-medium text-s112-teal border-b-2 border-s112-teal -mb-px">
          ↔️ Umziehen
        </span>
        <Link href={`/kellerbuch/behaelter/${id}/behandlungen`}
          className="px-4 py-2 text-sm font-medium text-s112-muted hover:text-gray-700 border-b-2 border-transparent hover:border-gray-300 -mb-px transition-colors">
          🧪 Kellerbehandlungen
        </Link>
      </div>

      {/* Tabelle */}
      {umzuege.length === 0 ? (
        <div className="card text-center py-10">
          <p className="text-2xl mb-2">↔️</p>
          <p className="text-sm text-s112-muted">Noch keine Umzüge für diesen Behälter</p>
          <Link href="/kellerbuch/umziehen"
            className="mt-3 inline-block text-xs text-s112-teal font-semibold hover:underline">
            → Zum Umziehen-Formular
          </Link>
        </div>
      ) : (
        <div className="card p-0 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-s112-bg border-b border-s112-border">
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500">Datum</th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500">Art</th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500">Von</th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500">Nach</th>
                <th className="text-right px-4 py-2.5 text-xs font-semibold text-gray-500">Brutto</th>
                <th className="text-right px-4 py-2.5 text-xs font-semibold text-gray-500">Netto</th>
                <th className="text-right px-4 py-2.5 text-xs font-semibold text-gray-500">Schwund</th>
              </tr>
            </thead>
            <tbody>
              {umzuege.map((u: R) => {
                const vonBeh   = (u.von_behaelter  as R | null)?.name ?? '–'
                const nachBeh  = (u.nach_behaelter as R | null)?.name ?? '–'
                const vonCharge  = (u.von_weinausbau  as R | null)?.name ?? null
                const nachCharge = (u.nach_weinausbau as R | null)?.name ?? null
                const istQuelle  = (u.von_behaelter  as R | null)?.id === id
                const netto    = parseFloat(u.menge_liter)  || 0
                const brutto   = parseFloat(u.brutto_liter) || (netto + (parseFloat(u.schwund_liter) || 0))
                const schwund  = parseFloat(u.schwund_liter) || 0
                const istFilt    = u.umzug_typ === 'filtration'
                const istSchwund = u.umzug_typ === 'schwund'
                const artBadge = istSchwund
                  ? { cls: 'bg-amber-100 text-amber-700', label: '💧 Schwund' }
                  : istFilt
                    ? { cls: 'bg-blue-100 text-blue-700', label: '🔽 Filtration' }
                    : { cls: 'bg-gray-100 text-gray-600', label: '↔️ Umzug' }
                return (
                  <tr key={u.id}
                    className={`border-b border-s112-border/30 last:border-0 hover:bg-s112-bg/40 ${istQuelle ? 'bg-red-50/20' : 'bg-green-50/20'}`}>
                    <td className="px-4 py-2.5 text-xs text-gray-500 whitespace-nowrap">
                      {new Date(u.datum).toLocaleDateString('de-AT')}
                    </td>
                    <td className="px-4 py-2.5">
                      <span className={`inline-block text-xs px-2 py-0.5 rounded-full font-medium ${artBadge.cls}`}>
                        {artBadge.label}
                      </span>
                    </td>
                    <td className="px-4 py-2.5">
                      <p className={`text-sm ${istQuelle ? 'font-semibold text-s112-teal' : 'text-gray-600'}`}>{vonBeh}</p>
                      {vonCharge && <p className="text-xs text-s112-muted">{vonCharge}</p>}
                    </td>
                    <td className="px-4 py-2.5">
                      <p className={`text-sm ${!istQuelle ? 'font-semibold text-s112-teal' : 'text-gray-600'}`}>{nachBeh}</p>
                      {nachCharge && <p className="text-xs text-s112-muted">{nachCharge}</p>}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-gray-700 text-xs">{fmt(brutto)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums font-medium text-gray-800">{fmt(netto)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-amber-600 text-xs">
                      {schwund > 0 ? fmt(schwund) : '–'}
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
