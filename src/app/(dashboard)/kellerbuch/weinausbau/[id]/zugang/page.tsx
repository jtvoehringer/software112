import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentUserRole, canWrite, canAdmin, getCurrentMembership } from '@/lib/auth/roles'
import type { Metadata } from 'next'
import Link from '@/components/ui/Link'
import { notFound } from 'next/navigation'
import { wienHeute } from '@/lib/csv'
import { fmtNum } from '@/lib/format'
import { ZUGANGSKORREKTUR_ART_LABEL, istZugangskorrekturArt } from '@/lib/kellerbuch/zugangskorrektur'
import ZugangForm, { ZugangStorno } from './ZugangForm'

export const metadata: Metadata = { title: 'Zugang korrigieren – software:112' }
export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

// KAN-53 (07.10.2026): Zugangskorrektur einer Charge – Mehrmenge, Inventur-Plus (Journal INV_PLUS), nur Betriebsleitung
export default async function ZugangPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase   = await createSupabaseServerClient()
  const role       = await getCurrentUserRole()
  const darf       = canWrite(role, 'kellerbuch') && !!role && canAdmin(role)
  const membership = await getCurrentMembership()
  const tenantId   = membership?.tenantId ?? null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tf = (query: any) => tenantId ? query.eq('tenant_id', tenantId) : query

  const [{ data: waRaw }, { data: zRaw }] = await Promise.all([
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tf((supabase.from('weinausbau') as any)
      .select('id, name, menge_liter, aktiv, storniert_am').eq('id', id).maybeSingle()),
    // storno-sichtbar: stornierte Korrekturen bleiben mit Kennzeichen in der Liste
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tf((supabase.from('keller_zugangskorrekturen') as any)
      .select('id, datum, menge_liter, art, grund, erstellt_von_name, storniert_am, storno_grund')
      .eq('weinausbau_id', id).order('datum', { ascending: false }).order('id')),
  ])
  if (!waRaw) notFound()
  const wa = waRaw as R
  const moeglich = darf && !wa.storniert_am && wa.aktiv !== false
  const liste = (zRaw ?? []) as R[]

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-center gap-2 text-sm text-s112-muted">
        <Link href="/kellerbuch" className="hover:text-s112-blue-700 transition-colors">Kellerbuch</Link>
        <span>/</span>
        <Link href={`/kellerbuch/weinausbau/${wa.id}`} className="hover:text-s112-blue-700 transition-colors">{wa.name}</Link>
        <span>/</span>
        <span className="text-s112-text-2">Zugang korrigieren</span>
      </div>
      <h1 className="text-xl font-semibold text-s112-text">Zugang korrigieren – {wa.name}</h1>
      <p className="text-sm text-s112-muted">
        Das Gegenstück zu „Schwund buchen“: eine Mehrmenge (z. B. nach der Pressung), ein Inventur-Plus oder ein Tippfehler im
        Eröffnungsbestand erhöht die Charge als datierte Buchung mit Grund. Im Kellerbuch-Journal als „Inventurdifferenz Mehrmenge“
        (INV_PLUS) – keine Buchungsart der Bestandsmeldung, die BSM weist darauf hin. Eine geltende Prüfnummer gilt danach für den
        Tankbestand nicht mehr. Nur für die Betriebsleitung. Aktueller Bestand: {fmtNum(Number(wa.menge_liter) || 0)} L.
      </p>

      {moeglich ? (
        <ZugangForm chargeId={wa.id} heute={wienHeute()} />
      ) : (
        <p className="text-sm text-s112-muted">
          {darf ? 'Die Charge ist storniert bzw. nicht mehr aktiv – keine Zugangskorrektur möglich.' : 'Zugangskorrekturen bucht nur die Betriebsleitung.'}
        </p>
      )}

      <section className="card p-0 overflow-x-auto">
        <h2 className="text-sm font-semibold text-s112-text px-4 pt-4">Bisherige Zugangskorrekturen</h2>
        {liste.length === 0 ? (
          <p className="text-xs text-s112-muted px-4 pb-4 pt-1">Noch keine.</p>
        ) : (
          <table className="w-full min-w-[560px] text-xs mt-2">
            <thead className="text-s112-text-2 text-left">
              <tr><th className="px-4 py-2">Datum</th><th className="px-2 py-2">Menge</th><th className="px-2 py-2">Art</th><th className="px-2 py-2">Grund</th><th className="px-2 py-2">von</th><th className="px-4 py-2" /></tr>
            </thead>
            <tbody className="divide-y divide-s112-border/50">
              {liste.map(z => (
                <tr key={z.id} className={z.storniert_am ? 'text-s112-muted line-through' : ''}>
                  <td className="px-4 py-2 whitespace-nowrap">{String(z.datum).split('-').reverse().join('.')}</td>
                  <td className="px-2 py-2 whitespace-nowrap">+{fmtNum(Number(z.menge_liter))} L</td>
                  <td className="px-2 py-2">{istZugangskorrekturArt(z.art) ? ZUGANGSKORREKTUR_ART_LABEL[z.art] : z.art}</td>
                  <td className="px-2 py-2">{z.storniert_am ? `Storniert: ${z.storno_grund ?? ''}` : (z.grund ?? '')}</td>
                  <td className="px-2 py-2 whitespace-nowrap">{z.erstellt_von_name ?? '–'}</td>
                  <td className="px-4 py-2 text-right">
                    {darf && !z.storniert_am && <ZugangStorno id={z.id} chargeId={wa.id} />}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  )
}
