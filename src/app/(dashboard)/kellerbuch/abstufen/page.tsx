import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentUserRole, canWrite, getCurrentMembership } from '@/lib/auth/roles'
import type { Metadata } from 'next'
import Link from '@/components/ui/Link'
import { qualitaetAnzeige } from '@/lib/wein/qualitaet'
import { HERKUNFT_LABEL } from '@/lib/herkunft'
import { fmtNum } from '@/lib/format'

export const metadata: Metadata = { title: 'Charge abstufen – software:112' }
export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

// KAN-82 (05.10.2026): Einstieg „Charge abstufen“ aus der Befehlspalette (Strg K) – Auswahl der Charge
export default async function AbstufenAuswahlPage() {
  const supabase   = await createSupabaseServerClient()
  const role       = await getCurrentUserRole()
  const writeOk    = canWrite(role, 'kellerbuch')
  const membership = await getCurrentMembership()
  const tenantId   = membership?.tenantId ?? null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tf = (query: any) => tenantId ? query.eq('tenant_id', tenantId) : query

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await tf((supabase.from('weinausbau') as any)
    .select('id, name, jahrgang, menge_liter, qualitaetsstufe, zusatzbezeichnung, erzeugnis, herkunft_code, behaelter:behaelter_id(name)')
    .eq('aktiv', true).is('storniert_am', null).gt('menge_liter', 0.01)
    .order('name'))
  const chargen = (data ?? []) as R[]

  return (
    <div className="max-w-3xl space-y-4">
      <div className="flex items-center gap-2 text-sm text-s112-muted">
        <Link href="/kellerbuch" className="hover:text-s112-blue-700 transition-colors">Kellerbuch</Link>
        <span>/</span>
        <span className="text-s112-text-2">Charge abstufen</span>
      </div>
      <h1 className="text-xl font-semibold text-s112-text">Charge abstufen</h1>
      {!writeOk ? (
        <p className="text-sm text-s112-muted">Keine Schreibberechtigung für das Kellerbuch.</p>
      ) : chargen.length === 0 ? (
        <p className="text-sm text-s112-muted">Keine Charge mit Bestand.</p>
      ) : (
        <ul className="card divide-y divide-s112-border/50 p-0">
          {chargen.map(c => (
            <li key={c.id}>
              <Link href={`/kellerbuch/weinausbau/${c.id}/abstufen`} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-4 py-3 hover:bg-s112-bg/40">
                <span className="text-sm font-medium text-s112-text">{c.name}{c.jahrgang ? ` ${c.jahrgang}` : ''}</span>
                <span className="text-xs text-s112-text-2">{qualitaetAnzeige(c)}{c.herkunft_code ? ` · ${HERKUNFT_LABEL[c.herkunft_code] ?? c.herkunft_code}` : ''}</span>
                <span className="text-xs text-s112-muted ml-auto">{(c.behaelter as R | null)?.name ?? '–'} · {fmtNum(Number(c.menge_liter))} L</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
