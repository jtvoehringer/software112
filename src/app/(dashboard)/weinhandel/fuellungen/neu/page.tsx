import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentUserRole, canWrite, getCurrentMembership } from '@/lib/auth/roles'
import { redirect } from 'next/navigation'
import type { Metadata } from 'next'
import Link from '@/components/ui/Link'
import { createFuellung } from '../../actions'
import { ladeCustomWeinbaugebiete } from '../../../weinbaugebiete/actions'
import FuellungFormClient from './FuellungFormClient'
import { wienHeute } from '@/lib/csv'
import { pruefnummerGueltig, pruefnummerHinweis, waehlbareAntraege, type PnChargeDaten } from '@/lib/kellerbuch/pruefnummer'
import { ladePruefnummerDaten } from '@/lib/kellerbuch/pruefnummerLaden'

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

  // Alle aktiven Weinausbau-Chargen + DAC-Anträge parallel laden. KAN-72: keine abgelehnten
  // oder inaktiven Anträge mehr (früher wählbar, samt ihrer Prüfnummer)
  const [{ data: chargenRaw }, { data: dacRaw }] = await Promise.all([
  tf((supabase.from('weinausbau') as any)
    .select('id, name, jahrgang, rebsorte, menge_liter, status, qualitaetsstufe, herkunft_code')
    .eq('aktiv', true)
    .neq('status', 'abgeschlossen')
    .order('jahrgang', { ascending: false })),
  tf((supabase.from('dac_antrag') as any)
    .select('id, bezeichnung, dac_region, jahrgang, rebsorte, pruefnummer, status, weinausbau_id')
    .eq('aktiv', true)
    .neq('status', 'abgelehnt')
    .order('jahrgang', { ascending: false })),
  ])

  // KAN-72: nur Anträge anbieten, die für den heutigen Bestand der Charge gelten – dieselbe
  // Regel prüft createFuellung (fuellungAntragPruefen) mit dem Abfülldatum. Für Chargen, deren
  // frühere Prüfnummer nicht mehr gilt, zeigt das Formular den Grund.
  const alleAntraege = (dacRaw ?? []) as R[]
  const heute = wienHeute()
  const pnDaten = tenantId
    ? await ladePruefnummerDaten(supabase, tenantId, alleAntraege.map(d => d.weinausbau_id), { heute })
    : new Map<string, PnChargeDaten>()
  const waehlbar = new Set<string>()
  const pnHinweise: Record<string, string> = {}
  for (const [chargeId, daten] of pnDaten) {
    for (const id of waehlbareAntraege(daten, heute)) waehlbar.add(id)
    const hinweis = pruefnummerHinweis(pruefnummerGueltig(daten, heute))
    if (hinweis) pnHinweise[chargeId] = hinweis
  }
  const dacAntraege = alleAntraege.filter(d => waehlbar.has(d.id))
  // Chargen mit (aktivem, nicht abgelehntem) Antrag: keine freie Prüfnummer-Eingabe
  const chargenMitAntrag = [...new Set(alleAntraege.map(d => d.weinausbau_id).filter(Boolean) as string[])]
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
        chargenMitAntrag={chargenMitAntrag}
        pnHinweise={pnHinweise}
        customWeinbaugebiete={customWeinbaugebiete}
        action={createFuellung}
        defaultChargeId={chargeId}
      />
    </div>
  )
}
