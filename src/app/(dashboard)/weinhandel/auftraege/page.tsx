import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import Link from '@/components/ui/Link'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentMembership, canWrite } from '@/lib/auth/roles'
import { alle, inBloecken } from '@/lib/supabase/alle'
import { geladen } from '@/lib/supabase/geladen'
import { heuteWien } from '@/lib/datum/wien'
import { fmtNum } from '@/lib/format'
import { AUFTRAG_STATUS_LABEL, reservierungAbgelaufen, type AuftragStatus } from '@/lib/auftrag/regeln'

export const metadata: Metadata = { title: 'Aufträge' }
export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>
const tag = (d: string | null | undefined) => (d ? d.split('-').reverse().join('.') : '–')

// KAN-418 Teil 1: Aufträge – jeder offene Auftrag reserviert die Flaschen seiner Positionen.
export default async function AuftraegePage({ searchParams }: { searchParams: Promise<{ alle?: string }> }) {
  const membership = await getCurrentMembership()
  if (!membership?.tenantId) redirect('/login')
  const tenantId = membership.tenantId
  const writeOk = canWrite(membership, 'warenwirtschaft')
  const mitErledigten = (await searchParams).alle === '1'
  const supabase = await createSupabaseServerClient()
  const heute = heuteWien()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let q = (supabase.from('auftraege') as any)
    .select('id, nummer, datum, status, reserviert_bis, kontakt_id, firma_id, storniert_am, ab_versendet_am, erstellt_am')
    .eq('tenant_id', tenantId).eq('art', 'auftrag')
  if (!mitErledigten) q = q.in('status', ['offen', 'teilgeliefert'])
  const auftraege = (geladen(await alle(q.order('datum', { ascending: false }).order('erstellt_am', { ascending: false }).order('id', { ascending: false })), 'Aufträge') ?? []) as R[]

  const ids = auftraege.map(a => a.id as string)
  const kontaktIds = [...new Set(auftraege.map(a => a.kontakt_id).filter(Boolean))] as string[]
  const firmaIds = [...new Set(auftraege.map(a => a.firma_id).filter(Boolean))] as string[]
  const [posRes, kRes, fRes] = await Promise.all([
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    inBloecken<R>(ids, b => alle<R>((supabase.from('auftrag_positionen') as any).select('id, auftrag_id, menge, geliefert').eq('tenant_id', tenantId).in('auftrag_id', b).order('id'))),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    inBloecken<R>(kontaktIds, b => alle<R>((supabase.from('kontakte') as any).select('id, vorname, nachname').eq('tenant_id', tenantId).in('id', b).order('id'))),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    inBloecken<R>(firmaIds, b => alle<R>((supabase.from('firmen') as any).select('id, name').eq('tenant_id', tenantId).in('id', b).order('id'))),
  ])
  const positionen = (geladen(posRes, 'Positionen') ?? []) as R[]
  const kontakte = new Map(((geladen(kRes, 'Kontakte') ?? []) as R[]).map(k => [k.id as string, [k.vorname, k.nachname].filter(Boolean).join(' ')]))
  const firmen = new Map(((geladen(fRes, 'Firmen') ?? []) as R[]).map(f => [f.id as string, f.name as string]))
  const flaschen = new Map<string, { menge: number; offen: number }>()
  for (const p of positionen) {
    const z = flaschen.get(p.auftrag_id) ?? { menge: 0, offen: 0 }
    z.menge += Number(p.menge) || 0
    z.offen += Math.max(0, (Number(p.menge) || 0) - (Number(p.geliefert) || 0))
    flaschen.set(p.auftrag_id, z)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold text-s112-text">Aufträge</h1>
          <p className="text-sm text-s112-muted mt-1">Ein offener Auftrag reserviert seine Flaschen – sie zählen im Warenlager nicht mehr als verfügbar.</p>
        </div>
        <div className="flex items-center gap-2">
          <Link href={mitErledigten ? '/weinhandel/auftraege' : '/weinhandel/auftraege?alle=1'}
            className="border border-s112-border text-s112-text-2 px-3 py-2 rounded-xl text-sm hover:bg-s112-bg">
            {mitErledigten ? 'Nur offene' : 'Auch gelieferte und stornierte'}
          </Link>
          {writeOk && (
            <Link href="/weinhandel/auftraege/neu" className="inline-flex items-center gap-2 bg-s112-teal text-s112-yellow px-4 py-2 rounded-xl text-sm font-semibold hover:bg-s112-teal/90">
              + Neuer Auftrag
            </Link>
          )}
        </div>
      </div>

      <div className="card p-0 overflow-x-auto">
        <table className="w-full min-w-[680px] text-sm">
          <thead>
            <tr className="border-b border-s112-border text-left text-xs text-s112-muted">
              <th className="px-4 py-3 font-semibold">Nummer</th>
              <th className="px-4 py-3 font-semibold">Datum</th>
              <th className="px-4 py-3 font-semibold">Kunde</th>
              <th className="px-4 py-3 font-semibold text-right">Flaschen</th>
              <th className="px-4 py-3 font-semibold text-right">Reserviert</th>
              <th className="px-4 py-3 font-semibold">Reserviert bis</th>
              <th className="px-4 py-3 font-semibold">Status</th>
            </tr>
          </thead>
          <tbody>
            {auftraege.map(a => {
              const z = flaschen.get(a.id) ?? { menge: 0, offen: 0 }
              const abgelaufen = reservierungAbgelaufen(a as { status: string; reserviert_bis: string | null }, heute)
              const reserviert = a.status === 'offen' || a.status === 'teilgeliefert' ? z.offen : 0
              return (
                <tr key={a.id} className="border-b border-s112-border last:border-0 hover:bg-s112-bg/50">
                  <td className="px-4 py-3 font-mono text-xs whitespace-nowrap">
                    <Link href={`/weinhandel/auftraege/${a.id}`} className="text-s112-blue-700 hover:underline">{a.nummer}</Link>
                  </td>
                  <td className="px-4 py-3 tabular-nums whitespace-nowrap">{tag(a.datum)}</td>
                  <td className="px-4 py-3">{(a.firma_id && firmen.get(a.firma_id)) || (a.kontakt_id && kontakte.get(a.kontakt_id)) || '–'}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{fmtNum(z.menge, 0)}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{fmtNum(reserviert, 0)}</td>
                  <td className={`px-4 py-3 tabular-nums whitespace-nowrap ${abgelaufen ? 'text-s112-err-fg font-medium' : ''}`}>
                    {tag(a.reserviert_bis)}{abgelaufen ? ' · abgelaufen' : ''}
                  </td>
                  <td className="px-4 py-3">
                    {AUFTRAG_STATUS_LABEL[a.status as AuftragStatus] ?? a.status}
                    {/* KAN-418 Teil 3: Auftragsbestätigung an den Kunden gesendet */}
                    {a.ab_versendet_am && <span className="block text-xs text-s112-muted">bestätigt</span>}
                  </td>
                </tr>
              )
            })}
            {auftraege.length === 0 && (
              <tr><td colSpan={7} className="text-center py-10 text-s112-muted">{mitErledigten ? 'Noch keine Aufträge.' : 'Keine offenen Aufträge.'}</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
