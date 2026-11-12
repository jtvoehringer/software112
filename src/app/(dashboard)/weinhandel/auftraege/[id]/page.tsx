import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import Link from '@/components/ui/Link'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentMembership, canWrite } from '@/lib/auth/roles'
import { alle } from '@/lib/supabase/alle'
import { geladen } from '@/lib/supabase/geladen'
import { heuteWien } from '@/lib/datum/wien'
import { fmtNum } from '@/lib/format'
import { AUFTRAG_STATUS_LABEL, RESERVIERT_STATUS, reservierungAbgelaufen, type AuftragStatus } from '@/lib/auftrag/regeln'
import AuftragAktionen from './AuftragAktionen'

export const metadata: Metadata = { title: 'Auftrag' }
export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>
const tag = (d: string | null | undefined) => (d ? d.split('-').reverse().join('.') : '–')

export default async function AuftragPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const membership = await getCurrentMembership()
  if (!membership?.tenantId) redirect('/login')
  const tenantId = membership.tenantId
  const supabase = await createSupabaseServerClient()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const a = geladen(await (supabase.from('auftraege') as any)
    .select('id, nummer, datum, status, reserviert_bis, notizen, kontakt_id, firma_id, storniert_am, storno_grund, erstellt_am')
    .eq('id', id).eq('tenant_id', tenantId).maybeSingle(), 'Auftrag') as R | null
  if (!a) notFound()

  const [posRes, kRes, fRes] = await Promise.all([
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    alle<R>((supabase.from('auftrag_positionen') as any).select('id, fuellung_id, name, menge, geliefert').eq('tenant_id', tenantId).eq('auftrag_id', id).order('erstellt_am').order('id')),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    a.kontakt_id ? (supabase.from('kontakte') as any).select('id, vorname, nachname').eq('id', a.kontakt_id).eq('tenant_id', tenantId).maybeSingle() : Promise.resolve({ data: null, error: null }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    a.firma_id ? (supabase.from('firmen') as any).select('id, name').eq('id', a.firma_id).eq('tenant_id', tenantId).maybeSingle() : Promise.resolve({ data: null, error: null }),
  ])
  const positionen = (geladen(posRes, 'Positionen') ?? []) as R[]
  const kontakt = geladen(kRes, 'Kontakt') as R | null
  const firma = geladen(fRes, 'Firma') as R | null
  const heute = heuteWien()
  const reserviert = (RESERVIERT_STATUS as readonly string[]).includes(a.status)
  const abgelaufen = reservierungAbgelaufen(a as { status: string; reserviert_bis: string | null }, heute)
  const kunde = firma?.name ?? ([kontakt?.vorname, kontakt?.nachname].filter(Boolean).join(' ') || '–')

  return (
    <div className="max-w-3xl space-y-4">
      <nav className="flex items-center gap-2 text-sm text-s112-muted">
        <Link href="/weinhandel/auftraege" className="hover:text-s112-blue-700">Aufträge</Link>
        <span>/</span>
        <span className="font-medium text-s112-text">{a.nummer}</span>
      </nav>

      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold text-s112-text">Auftrag {a.nummer}</h1>
          <p className="text-sm text-s112-muted mt-1">{tag(a.datum)} · {AUFTRAG_STATUS_LABEL[a.status as AuftragStatus] ?? a.status}</p>
        </div>
        {canWrite(membership, 'warenwirtschaft') && reserviert && (
          <AuftragAktionen id={a.id} nummer={a.nummer} reserviertBis={a.reserviert_bis ?? heute} heute={heute} />
        )}
      </div>

      {abgelaufen && (
        <div role="status" className="bg-s112-warn-bg border border-s112-warn/30 text-sm text-s112-warn-fg rounded-xl px-4 py-3">
          Die Reservierung ist seit {tag(a.reserviert_bis)} abgelaufen. Die Flaschen bleiben reserviert, bis du die Frist verlängerst oder den Auftrag stornierst.
        </div>
      )}
      {a.storniert_am && (
        <div role="status" className="bg-s112-bg border border-s112-border text-sm text-s112-text-2 rounded-xl px-4 py-3">
          Storniert am {new Date(a.storniert_am).toLocaleDateString('de-AT', { timeZone: 'Europe/Vienna', day: '2-digit', month: '2-digit', year: 'numeric' })}
          {a.storno_grund ? ` – ${a.storno_grund}` : ''}. Die Reservierung ist aufgehoben.
        </div>
      )}

      <div className="card p-6 space-y-4">
        <dl className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
          <div><dt className="text-xs text-s112-muted">Kunde</dt>
            <dd className="mt-0.5">
              {a.firma_id ? <Link href={`/crm/firmen/${a.firma_id}`} className="text-s112-blue-700 hover:underline">{kunde}</Link>
                : a.kontakt_id ? <Link href={`/crm/kontakte/${a.kontakt_id}`} className="text-s112-blue-700 hover:underline">{kunde}</Link> : kunde}
            </dd></div>
          <div><dt className="text-xs text-s112-muted">Reserviert bis</dt><dd className={`mt-0.5 tabular-nums ${abgelaufen ? 'text-s112-err-fg font-medium' : ''}`}>{reserviert ? tag(a.reserviert_bis) : '–'}</dd></div>
          <div><dt className="text-xs text-s112-muted">Notiz</dt><dd className="mt-0.5 whitespace-pre-wrap">{a.notizen || '–'}</dd></div>
        </dl>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-s112-border text-left text-xs text-s112-muted">
                <th className="py-2 pr-3 font-semibold">Füllung</th>
                <th className="py-2 px-3 font-semibold text-right">Flaschen</th>
                <th className="py-2 px-3 font-semibold text-right">Geliefert</th>
                <th className="py-2 pl-3 font-semibold text-right">Reserviert</th>
              </tr>
            </thead>
            <tbody>
              {positionen.map(p => (
                <tr key={p.id} className="border-b border-s112-border last:border-0">
                  <td className="py-2 pr-3"><Link href={`/weinhandel/fuellungen/${p.fuellung_id}/edit`} className="hover:text-s112-blue-700 hover:underline">{p.name}</Link></td>
                  <td className="py-2 px-3 text-right tabular-nums">{fmtNum(Number(p.menge), 0)}</td>
                  <td className="py-2 px-3 text-right tabular-nums">{fmtNum(Number(p.geliefert), 0)}</td>
                  <td className="py-2 pl-3 text-right tabular-nums">{fmtNum(reserviert ? Math.max(0, Number(p.menge) - Number(p.geliefert)) : 0, 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-s112-muted">Preise und Rabatte entstehen bei der Lieferung. Positionen lassen sich nicht ändern – bei Bedarf den Auftrag stornieren und neu erfassen.</p>
      </div>
    </div>
  )
}
