import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import Link from '@/components/ui/Link'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentMembership, canWrite } from '@/lib/auth/roles'
import { alle, inBloecken } from '@/lib/supabase/alle'
import { geladen } from '@/lib/supabase/geladen'
import { heuteWien } from '@/lib/datum/wien'
import { fmtNum, fmtEur } from '@/lib/format'
import { ANGEBOT_STATUS_LABEL, angebotAbgelaufen, angebotSummen, type AngebotStatus } from '@/lib/auftrag/angebot'

export const metadata: Metadata = { title: 'Angebote' }
export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>
const tag = (d: string | null | undefined) => (d ? d.split('-').reverse().join('.') : '–')

// KAN-418 Teil 4 (12.11.2026): Angebote – mit Preisen, ohne Reservierung. Standard: nur offene; ?alle=1 zeigt auch
// angenommene, abgelehnte und stornierte.
export default async function AngebotePage({ searchParams }: { searchParams: Promise<{ alle?: string }> }) {
  const membership = await getCurrentMembership()
  if (!membership?.tenantId) redirect('/login')
  const tenantId = membership.tenantId
  const writeOk = canWrite(membership, 'warenwirtschaft')
  const mitErledigten = (await searchParams).alle === '1'
  const supabase = await createSupabaseServerClient()
  const heute = heuteWien()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let q = (supabase.from('auftraege') as any)
    .select('id, nummer, datum, status, gueltig_bis, kontakt_id, firma_id, storniert_am, ab_versendet_am, erstellt_am')
    .eq('tenant_id', tenantId).eq('art', 'angebot')
  if (!mitErledigten) q = q.eq('status', 'offen')
  const angebote = (geladen(await alle(q.order('datum', { ascending: false }).order('erstellt_am', { ascending: false }).order('id', { ascending: false })), 'Angebote') ?? []) as R[]

  const ids = angebote.map(a => a.id as string)
  const kontaktIds = [...new Set(angebote.map(a => a.kontakt_id).filter(Boolean))] as string[]
  const firmaIds = [...new Set(angebote.map(a => a.firma_id).filter(Boolean))] as string[]
  const [posRes, kRes, fRes] = await Promise.all([
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    inBloecken<R>(ids, b => alle<R>((supabase.from('auftrag_positionen') as any)
      .select('id, auftrag_id, menge, preis_brutto, rabatt_pct, sonderrabatt_pct, ust_satz').eq('tenant_id', tenantId).in('auftrag_id', b).order('id'))),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    inBloecken<R>(kontaktIds, b => alle<R>((supabase.from('kontakte') as any).select('id, vorname, nachname').eq('tenant_id', tenantId).in('id', b).order('id'))),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    inBloecken<R>(firmaIds, b => alle<R>((supabase.from('firmen') as any).select('id, name').eq('tenant_id', tenantId).in('id', b).order('id'))),
  ])
  const positionen = (geladen(posRes, 'Positionen') ?? []) as R[]
  const kontakte = new Map(((geladen(kRes, 'Kontakte') ?? []) as R[]).map(k => [k.id as string, [k.vorname, k.nachname].filter(Boolean).join(' ')]))
  const firmen = new Map(((geladen(fRes, 'Firmen') ?? []) as R[]).map(f => [f.id as string, f.name as string]))
  const jeAngebot = new Map<string, R[]>()
  for (const p of positionen) jeAngebot.set(p.auftrag_id, [...(jeAngebot.get(p.auftrag_id) ?? []), p])

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold text-s112-text">Angebote</h1>
          <p className="text-sm text-s112-muted mt-1">Ein Angebot nennt Preise, reserviert aber keine Flaschen – das macht erst der Auftrag.</p>
        </div>
        <div className="flex items-center gap-2">
          <Link href={mitErledigten ? '/weinhandel/angebote' : '/weinhandel/angebote?alle=1'}
            className="border border-s112-border text-s112-text-2 px-3 py-2 rounded-xl text-sm hover:bg-s112-bg">
            {mitErledigten ? 'Nur offene' : 'Auch angenommene, abgelehnte und stornierte'}
          </Link>
          {writeOk && (
            <Link href="/weinhandel/angebote/neu" className="inline-flex items-center gap-2 bg-s112-teal text-s112-yellow px-4 py-2 rounded-xl text-sm font-semibold hover:bg-s112-teal/90">
              + Neues Angebot
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
              <th className="px-4 py-3 font-semibold text-right">Betrag (brutto)</th>
              <th className="px-4 py-3 font-semibold">Gültig bis</th>
              <th className="px-4 py-3 font-semibold">Status</th>
            </tr>
          </thead>
          <tbody>
            {angebote.map(a => {
              const s = angebotSummen(jeAngebot.get(a.id) ?? [])
              const abgelaufen = angebotAbgelaufen(a as { status: string; gueltig_bis: string | null }, heute)
              return (
                <tr key={a.id} className="border-b border-s112-border last:border-0 hover:bg-s112-bg/50">
                  <td className="px-4 py-3 font-mono text-xs whitespace-nowrap">
                    <Link href={`/weinhandel/angebote/${a.id}`} className="text-s112-blue-700 hover:underline">{a.nummer}</Link>
                  </td>
                  <td className="px-4 py-3 tabular-nums whitespace-nowrap">{tag(a.datum)}</td>
                  <td className="px-4 py-3">{(a.firma_id && firmen.get(a.firma_id)) || (a.kontakt_id && kontakte.get(a.kontakt_id)) || '–'}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{fmtNum(s.flaschen, 0)}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{fmtEur(s.brutto)}</td>
                  <td className={`px-4 py-3 tabular-nums whitespace-nowrap ${abgelaufen ? 'text-s112-err-fg font-medium' : ''}`}>
                    {tag(a.gueltig_bis)}{abgelaufen ? ' · abgelaufen' : ''}
                  </td>
                  <td className="px-4 py-3">
                    {ANGEBOT_STATUS_LABEL[a.status as AngebotStatus] ?? a.status}
                    {a.ab_versendet_am && <span className="block text-xs text-s112-muted">gesendet</span>}
                  </td>
                </tr>
              )
            })}
            {angebote.length === 0 && (
              <tr><td colSpan={7} className="text-center py-10 text-s112-muted">{mitErledigten ? 'Noch keine Angebote.' : 'Keine offenen Angebote.'}</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
