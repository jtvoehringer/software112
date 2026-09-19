import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentUserRole, canWrite, getCurrentMembership } from '@/lib/auth/roles'
import { redirect } from 'next/navigation'
import type { Metadata } from 'next'
import Link from '@/components/ui/Link'
import { createFuellung } from '../../actions'
import { ladeCustomWeinbaugebiete } from '../../../weinbaugebiete/actions'
import FuellungFormClient from './FuellungFormClient'

export const metadata: Metadata = { title: 'Neue Füllung – software:112' }
export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

export default async function NeueFuellungPage({
  searchParams,
}: {
  searchParams: Promise<{ charge?: string }>
}) {
  const role = await getCurrentUserRole()
  if (!canWrite(role, 'warenwirtschaft')) redirect('/weinhandel')

  const { charge: chargeId } = await searchParams
  const supabase = await createSupabaseServerClient()
  const membership = await getCurrentMembership()
  const tenantId = membership?.tenantId ?? null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tf = (query: any) => tenantId ? query.eq('tenant_id', tenantId) : query

  // Alle aktiven Weinausbau-Chargen + DAC-Anträge parallel laden
  const [{ data: chargenRaw }, { data: dacRaw }] = await Promise.all([
  tf((supabase.from('weinausbau') as any)
    .select('id, name, jahrgang, rebsorte, menge_liter, status, qualitaetsstufe, herkunft_code')
    .eq('aktiv', true)
    .neq('status', 'abgeschlossen')
    .order('jahrgang', { ascending: false })),
  tf((supabase.from('dac_antrag') as any)
    .select('id, bezeichnung, dac_region, jahrgang, rebsorte, pruefnummer, status, weinausbau_id')
    .order('jahrgang', { ascending: false })),
  ])

  const dacAntraege = (dacRaw ?? []) as R[]
  let chargen = (chargenRaw ?? []) as R[]

  // Eigene, vom Mandanten selbst angelegte Weinbaugebiete (Herkunft-Code-Selbstverwaltung)
  const customWeinbaugebiete = await ladeCustomWeinbaugebiete()

  // Wenn über "Abfüllen"-Button mit chargeId aufgerufen: diese Charge immer mitladen,
  // auch wenn Status 'abgeschlossen' ist (Füllung kann trotzdem angelegt werden)
  if (chargeId && !chargen.find((c: R) => c.id === chargeId)) {
    const { data: extraRaw } = await tf((supabase.from('weinausbau') as any)
      .select('id, name, jahrgang, rebsorte, menge_liter, status, qualitaetsstufe, herkunft_code')
      .eq('id', chargeId))
      .single()
    if (extraRaw) chargen = [extraRaw as R, ...chargen]
  }

  return (
    <div className="max-w-2xl">
      <nav className="flex items-center gap-2 text-sm text-s112-muted mb-6">
        <Link href="/weinhandel" className="hover:text-s112-blue-700">Weinhandel</Link>
        <span>/</span>
        <span className="text-s112-text font-medium">Neue Füllung</span>
      </nav>

      <h1 className="text-2xl font-semibold text-s112-text mb-1">Neue Füllung anlegen</h1>
      <p className="text-sm text-s112-muted mb-6">
        Der Wein verlässt den Keller und wird als verkaufsfertiger Artikel im Weinhandel angelegt.
      </p>

      {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
      <FuellungFormClient
        chargen={chargen as any}
        dacAntraege={dacAntraege as any}
        customWeinbaugebiete={customWeinbaugebiete}
        action={createFuellung}
        defaultChargeId={chargeId}
      />
    </div>
  )
}
