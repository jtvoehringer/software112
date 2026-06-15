import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentMembership } from '@/lib/auth/roles'

export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

function fmt(n: number | null | undefined) {
  return (n ?? 0).toLocaleString('de-AT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export default async function FibuPage({
  searchParams,
}: {
  searchParams: { jahr?: string; monat?: string; q?: string }
}) {
  const supabase   = await createSupabaseServerClient()
  const membership = await getCurrentMembership()
  if (!membership?.tenantId) redirect('/login')
  const tenantId = membership.tenantId

  const { data: einst } = await (supabase.from('tenant_einstellungen') as any)
    .select('modul_fibu').eq('tenant_id', tenantId).maybeSingle()
  if (!einst?.modul_fibu) redirect('/dashboard')

  const sp   = await searchParams
  const jahr = parseInt(sp.jahr ?? '') || new Date().getFullYear()
  const q    = sp.q ?? ''

  // Buchungssätze + Zeilen laden
  const { data: perioden } = await (supabase.from('fibu_perioden') as any)
    .select('id, jahr, monat, gesperrt')
    .eq('tenant_id', tenantId)
    .eq('jahr', jahr)
    .order('monat')

  let query = (supabase.from('fibu_buchungssaetze') as any)
    .select('*, fibu_buchungszeilen(*, fibu_kontenplan(konto_nr, konto_name))')
    .eq('tenant_id', tenantId)
    .gte('belegdatum', `${jahr}-01-01`)
    .lte('belegdatum', `${jahr}-12-31`)
    .order('buchungsdatum', { ascending: false })

  if (q) query = query.ilike('beschreibung', `%${q}%`)

  const { data: buchungssaetze } = await query

  const jahre = Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - i)
  const MONATE = ['Jän','Feb','Mär','Apr','Mai','Jun','Jul','Aug','Sep','Okt','Nov','Dez']

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">FIBU – Buchungsjournal</h1>
          <p className="text-sm text-s112-muted">Doppelte Buchhaltung · Österr. Einheitskontenrahmen (EKR)</p>
        </div>
        <div className="flex gap-2">
          <Link href="/fibu/kontenplan"
            className="border border-s112-border text-s112-teal px-4 py-2 rounded-xl text-sm hover:bg-s112-bg">
            Kontenplan
          </Link>
          <Link href="/fibu/neu"
            className="bg-s112-teal text-white px-4 py-2 rounded-xl text-sm font-semibold hover:bg-opacity-90">
            + Buchungssatz
          </Link>
        </div>
      </div>

      {/* Perioden-Übersicht */}
      {(perioden as R[])?.length > 0 && (
        <div className="flex gap-2 flex-wrap mb-5">
          {(perioden as R[]).map((p: R) => (
            <span key={p.id}
              className={`text-xs px-2.5 py-1 rounded-full border ${p.gesperrt ? 'bg-gray-100 text-gray-500 border-gray-200' : 'bg-s112-teal/10 text-s112-teal border-s112-teal/30'}`}>
              {MONATE[p.monat - 1]} {p.gesperrt ? '🔒' : ''}
            </span>
          ))}
        </div>
      )}

      {/* Filter */}
      <form method="GET" className="bg-white rounded-2xl border border-s112-border p-4 mb-4 flex gap-3 items-end">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Jahr</label>
          <select name="jahr" defaultValue={String(jahr)}
            className="border border-s112-border rounded-lg px-3 py-1.5 text-sm focus:outline-none">
            {jahre.map(j => <option key={j} value={j}>{j}</option>)}
          </select>
        </div>
        <div className="flex-1">
          <label className="block text-xs font-medium text-gray-600 mb-1">Suche</label>
          <input name="q" defaultValue={q} placeholder="Buchungstext, Belegnummer…"
            className="w-full border border-s112-border rounded-lg px-3 py-1.5 text-sm focus:outline-none" />
        </div>
        <button type="submit" className="bg-s112-teal text-white px-4 py-1.5 rounded-lg text-sm">Filtern</button>
      </form>

      {/* Buchungssätze */}
      {(!buchungssaetze || buchungssaetze.length === 0) ? (
        <div className="bg-white rounded-2xl border border-s112-border p-10 text-center text-s112-muted">
          Keine Buchungssätze für {jahr}
        </div>
      ) : (
        <div className="space-y-3">
          {(buchungssaetze as R[]).map((satz: R) => {
            const zeilen = (satz.fibu_buchungszeilen as R[]) ?? []
            const soll   = zeilen.filter(z => z.seite === 'soll').reduce((s, z) => s + (z.betrag ?? 0), 0)
            return (
              <div key={satz.id} className="bg-white rounded-2xl border border-s112-border overflow-hidden">
                <div className="flex items-center justify-between px-5 py-3 border-b border-s112-border/60 bg-s112-bg/40">
                  <div className="flex items-center gap-3">
                    <span className="font-mono text-xs text-s112-teal font-medium">{satz.belegnummer}</span>
                    <span className="text-sm font-medium text-gray-800">{satz.beschreibung}</span>
                    {satz.gesperrt && <span className="text-xs text-gray-400">🔒</span>}
                  </div>
                  <div className="flex items-center gap-4">
                    <span className="text-xs text-gray-500">
                      {new Date(satz.belegdatum).toLocaleDateString('de-AT')}
                    </span>
                    <span className="font-mono text-sm font-semibold text-gray-700">€ {fmt(soll)}</span>
                  </div>
                </div>
                <table className="w-full text-sm">
                  <tbody>
                    {zeilen.map((z: R, idx: number) => (
                      <tr key={idx} className={`border-b border-s112-border/30 ${idx % 2 === 0 ? '' : 'bg-s112-bg/20'}`}>
                        <td className="px-5 py-2 text-gray-500 text-xs font-mono w-16">
                          {z.fibu_kontenplan?.konto_nr}
                        </td>
                        <td className="px-2 py-2 text-gray-700">
                          {z.fibu_kontenplan?.konto_name ?? '–'}
                        </td>
                        <td className="px-2 py-2 text-center">
                          <span className={`text-xs px-2 py-0.5 rounded-full ${z.seite === 'soll' ? 'bg-orange-100 text-orange-700' : 'bg-blue-100 text-blue-700'}`}>
                            {z.seite === 'soll' ? 'Soll' : 'Haben'}
                          </span>
                        </td>
                        <td className="px-5 py-2 text-right font-mono font-medium text-gray-800">
                          € {fmt(z.betrag)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
