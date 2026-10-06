import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentUserRole, canWrite, getCurrentMembership } from '@/lib/auth/roles'
import type { Metadata } from 'next'
import Link from '@/components/ui/Link'
import { notFound } from 'next/navigation'
import { wienHeute } from '@/lib/csv'
import { fmtNum } from '@/lib/format'
import { VERARBEITUNG_ZWECK_LABEL, istVerarbeitungZweck } from '@/lib/kellerbuch/verarbeitung'
import VerarbeitenForm from './VerarbeitenForm'
import VerarbeitungStorno from './VerarbeitungStorno'

export const metadata: Metadata = { title: 'Charge verarbeiten – software:112' }
export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

// KAN-41 Paket 3a (06.10.2026): Aktion „Verarbeiten“ – Abgang einer Menge durch Verarbeitung (BSM AB_VERAR)
export default async function VerarbeitenPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase   = await createSupabaseServerClient()
  const role       = await getCurrentUserRole()
  const writeOk    = canWrite(role, 'kellerbuch')
  const membership = await getCurrentMembership()
  const tenantId   = membership?.tenantId ?? null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tf = (query: any) => tenantId ? query.eq('tenant_id', tenantId) : query

  const [{ data: waRaw }, { data: vRaw }] = await Promise.all([
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tf((supabase.from('weinausbau') as any)
      .select('id, name, menge_liter, aktiv, storniert_am').eq('id', id).maybeSingle()),
    // storno-sichtbar: stornierte Verarbeitungen bleiben mit Kennzeichen in der Liste
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tf((supabase.from('keller_verarbeitungen') as any)
      .select('id, datum, menge_liter, zweck, notizen, erstellt_von_name, storniert_am, storno_grund')
      .eq('weinausbau_id', id).order('datum', { ascending: false }).order('id')),
  ])
  if (!waRaw) notFound()
  const wa = waRaw as R
  const bestand = Number(wa.menge_liter) || 0
  const moeglich = writeOk && !wa.storniert_am && wa.aktiv !== false && bestand > 0.01
  const liste = (vRaw ?? []) as R[]

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-center gap-2 text-sm text-s112-muted">
        <Link href="/kellerbuch" className="hover:text-s112-blue-700 transition-colors">Kellerbuch</Link>
        <span>/</span>
        <Link href={`/kellerbuch/weinausbau/${wa.id}`} className="hover:text-s112-blue-700 transition-colors">{wa.name}</Link>
        <span>/</span>
        <span className="text-s112-text-2">Verarbeiten</span>
      </div>
      <h1 className="text-xl font-semibold text-s112-text">Charge verarbeiten – {wa.name}</h1>
      <p className="text-sm text-s112-muted">
        Eine Menge verlässt den Weinbestand, weil sie zu Traubensaft, Essig, in der Brennerei oder sonst weiterverarbeitet wird.
        In der Bestandsmeldung als „Abgang durch Verarbeitung“ gebucht. Verarbeiten Sie die ganze Menge, wird die Charge abgeschlossen.
      </p>

      {moeglich ? (
        <VerarbeitenForm chargeId={wa.id} bestand={bestand} heute={wienHeute()} />
      ) : (
        <p className="text-sm text-s112-muted">
          {writeOk ? 'Die Charge ist storniert, nicht mehr aktiv oder leer – nichts zu verarbeiten.' : 'Keine Schreibberechtigung für das Kellerbuch.'}
        </p>
      )}

      <section className="card p-0 overflow-x-auto">
        <h2 className="text-sm font-semibold text-s112-text px-4 pt-4">Bisherige Verarbeitungen</h2>
        {liste.length === 0 ? (
          <p className="text-xs text-s112-muted px-4 pb-4 pt-1">Noch keine.</p>
        ) : (
          <table className="w-full min-w-[560px] text-xs mt-2">
            <thead className="text-s112-text-2 text-left">
              <tr><th className="px-4 py-2">Datum</th><th className="px-2 py-2">Menge</th><th className="px-2 py-2">Zweck</th><th className="px-2 py-2">Notiz</th><th className="px-2 py-2">von</th><th className="px-4 py-2" /></tr>
            </thead>
            <tbody className="divide-y divide-s112-border/50">
              {liste.map(v => (
                <tr key={v.id} className={v.storniert_am ? 'text-s112-muted line-through' : ''}>
                  <td className="px-4 py-2 whitespace-nowrap">{String(v.datum).split('-').reverse().join('.')}</td>
                  <td className="px-2 py-2 whitespace-nowrap">{fmtNum(Number(v.menge_liter))} L</td>
                  <td className="px-2 py-2">{istVerarbeitungZweck(v.zweck) ? VERARBEITUNG_ZWECK_LABEL[v.zweck] : v.zweck}</td>
                  <td className="px-2 py-2">{v.storniert_am ? `Storniert: ${v.storno_grund ?? ''}` : (v.notizen ?? '')}</td>
                  <td className="px-2 py-2 whitespace-nowrap">{v.erstellt_von_name ?? '–'}</td>
                  <td className="px-4 py-2 text-right">
                    {writeOk && !v.storniert_am && <VerarbeitungStorno id={v.id} chargeId={wa.id} />}
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
