import { createSupabaseServerClient } from '@/lib/supabase/server'
import { geladen } from '@/lib/supabase/geladen'
import { alle } from '@/lib/supabase/alle'
import { getCurrentUserRole, canWrite, getCurrentMembership } from '@/lib/auth/roles'
import type { Metadata } from 'next'
import Link from '@/components/ui/Link'
import { notFound } from 'next/navigation'
import { normalisiereQualitaet } from '@/lib/wein/qualitaetsrang'
import { abstufenHerkuenfte, abstufenZusaetze, abstufungText } from '@/lib/kellerbuch/abstufen'
import { ladeBehaelter } from '@/lib/keller/behaelter'
import { BELEGUNG_SPALTEN, GEBINDE_ANLEGEN_PFAD, leereGebinde as leereGebindeAus, nurBelegendeChargen } from '@/lib/kellerbuch/leereGebinde'
import { mitZurueck } from '@/lib/navigation/zurueck'
import { wienHeute } from '@/lib/csv'
import { fmtNum } from '@/lib/format'
import AbstufenForm from './AbstufenForm'

export const metadata: Metadata = { title: 'Charge abstufen' }
export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

// KAN-82 (05.10.2026): Aktion „Abstufen“ – ganze Charge an Ort und Stelle oder Teilmenge mit Umzug in ein leeres Gebinde
export default async function AbstufenPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase   = await createSupabaseServerClient()
  const role       = await getCurrentUserRole()
  const writeOk    = canWrite(role, 'kellerbuch')
  const membership = await getCurrentMembership()
  const tenantId   = membership?.tenantId ?? null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tf = (query: any) => tenantId ? query.eq('tenant_id', tenantId) : query

  const [waRawRes, umstRawRes, belegtRawRes, behaelter] = await Promise.all([
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tf((supabase.from('weinausbau') as any)
      .select('id, name, jahrgang, rebsorte, menge_liter, behaelter_id, qualitaetsstufe, zusatzbezeichnung, erzeugnis, herkunft_code, aktiv, storniert_am')
      .eq('id', id).maybeSingle()),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tf((supabase.from('charge_umstufungen') as any)
      .select('id, datum, menge_liter, alt_qualitaetsstufe, alt_zusatzbezeichnung, alt_erzeugnis, alt_herkunft_code, neu_qualitaetsstufe, neu_zusatzbezeichnung, neu_erzeugnis, neu_herkunft_code, grund, erstellt_von_name, quelle:quelle_weinausbau_id(name)')
      .eq('weinausbau_id', id).order('datum', { ascending: false })),
    // belegte Gebinde – Teilmenge nur in ein leeres Gebinde; KAN-358: dieselbe Regel wie Umzug und Zukauf
    // (abgeschlossene, inaktive und stornierte Chargen belegen kein Gebinde)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    alle(nurBelegendeChargen(tf((supabase.from('weinausbau') as any).select(BELEGUNG_SPALTEN))).not('behaelter_id', 'is', null).order('id')),
    ladeBehaelter(supabase, tenantId, { nurAktiv: true }),
  ])
  const waRaw = geladen(waRawRes, 'Chargen')
  const umstRaw = geladen(umstRawRes, 'Abstufungen')
  const belegtRaw = geladen(belegtRawRes, 'Chargen')
  if (!waRaw) notFound()
  const wa = waRaw as R
  const alt = { ...normalisiereQualitaet(wa), herkunft: (wa.herkunft_code as string | null) ?? null }
  const leereGebinde = leereGebindeAus(behaelter, (belegtRaw ?? []) as R[], { ausser: wa.behaelter_id as string | null })
    .map(b => ({ id: b.id, name: b.name as string }))
  const bestand = Number(wa.menge_liter) || 0
  const abstufbar = writeOk && !wa.storniert_am && wa.aktiv !== false && bestand > 0.01

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-center gap-2 text-sm text-s112-muted">
        <Link href="/kellerbuch" className="hover:text-s112-blue-700 transition-colors">Kellerbuch</Link>
        <span>/</span>
        <Link href={`/kellerbuch/weinausbau/${wa.id}`} className="hover:text-s112-blue-700 transition-colors">{wa.name}</Link>
        <span>/</span>
        <span className="text-s112-text-2">Abstufen</span>
      </div>
      <h1 className="text-xl font-semibold text-s112-text">Charge abstufen – {wa.name}</h1>

      {abstufbar ? (
        <AbstufenForm
          chargeId={wa.id}
          bestand={bestand}
          heute={wienHeute()}
          alt={alt}
          zusaetze={abstufenZusaetze(alt)}
          herkuenfte={abstufenHerkuenfte(alt)}
          leereGebinde={leereGebinde}
          gebindeAnlegenHref={mitZurueck(GEBINDE_ANLEGEN_PFAD, `/kellerbuch/weinausbau/${wa.id}/abstufen`)}
        />
      ) : (
        <p className="text-sm text-s112-muted">
          {writeOk ? 'Die Charge ist storniert, nicht mehr aktiv oder leer – nichts abzustufen.' : 'Keine Schreibberechtigung für das Kellerbuch.'}
        </p>
      )}

      <section className="card p-0 overflow-x-auto">
        <h2 className="text-sm font-semibold text-s112-text px-4 pt-4">Bisherige Abstufungen</h2>
        {((umstRaw ?? []) as R[]).length === 0 ? (
          <p className="text-xs text-s112-muted px-4 pb-4 pt-1">Noch keine.</p>
        ) : (
          <table className="w-full min-w-[560px] text-xs mt-2">
            <thead className="text-s112-text-2 text-left">
              <tr><th className="px-4 py-2">Datum</th><th className="px-2 py-2">Menge</th><th className="px-2 py-2">alt → neu</th><th className="px-2 py-2">Grund</th><th className="px-4 py-2">von</th></tr>
            </thead>
            <tbody className="divide-y divide-s112-border/50">
              {((umstRaw ?? []) as R[]).map(u => (
                <tr key={u.id}>
                  <td className="px-4 py-2 whitespace-nowrap">{String(u.datum).split('-').reverse().join('.')}</td>
                  <td className="px-2 py-2 whitespace-nowrap">{fmtNum(Number(u.menge_liter))} L</td>
                  <td className="px-2 py-2">
                    {abstufungText(
                      { ...normalisiereQualitaet({ qualitaetsstufe: u.alt_qualitaetsstufe, zusatzbezeichnung: u.alt_zusatzbezeichnung, erzeugnis: u.alt_erzeugnis }), herkunft: u.alt_herkunft_code },
                      { ...normalisiereQualitaet({ qualitaetsstufe: u.neu_qualitaetsstufe, zusatzbezeichnung: u.neu_zusatzbezeichnung, erzeugnis: u.neu_erzeugnis }), herkunft: u.neu_herkunft_code })}
                    {(u.quelle as R | null)?.name && <span className="text-s112-muted"> · Teilmenge aus „{(u.quelle as R).name}“</span>}
                  </td>
                  <td className="px-2 py-2">{u.grund}</td>
                  <td className="px-4 py-2 whitespace-nowrap">{u.erstellt_von_name ?? '–'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  )
}
