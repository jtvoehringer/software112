// behoerdenmeldung: keller-auswertungen, keller-behandlungen-alle
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentMembership } from '@/lib/auth/roles'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { wienHeute } from '@/lib/csv'
import { istTag } from '@/lib/behoerden/kellerbuch-hilfen'
import { ladeKellerAuswertungen } from '@/lib/behoerden/keller-auswertungen'
import KellerAuswertungenClient from './KellerAuswertungenClient'

export const metadata: Metadata = { title: 'Keller-Auswertungen – software:112' }
export const dynamic = 'force-dynamic'

// Seit 24.09.2026: Zeitraum frei wählbar (?von=&bis=, Standard: 1.1. des laufenden Jahres
// bis offen – wie bisher), alle Umzüge statt höchstens 100, CSV über den Baustein.
// Dieselben Ladefunktionen liefern die CSVs „keller-auswertungen“ (Umzüge, Filtrationen,
// Schwund) und „keller-behandlungen-alle“ (lib/behoerden/keller-auswertungen.ts).
export default async function KellerAuswertungenPage({
  searchParams,
}: {
  searchParams: Promise<{ von?: string; bis?: string }>
}) {
  const sp = await searchParams
  const membership = await getCurrentMembership()
  const tenantId = membership?.tenantId ?? null
  if (!tenantId) notFound()

  const jahresStart = `${wienHeute().slice(0, 4)}-01-01`
  const vonGesetzt = sp.von !== undefined
  const von = vonGesetzt ? (sp.von && istTag(sp.von) ? sp.von : null) : jahresStart
  const bisRoh = sp.bis && istTag(sp.bis) ? sp.bis : null
  const bis = von && bisRoh && bisRoh < von ? null : bisRoh

  const supabase = await createSupabaseServerClient()
  const daten = await ladeKellerAuswertungen(supabase, tenantId, { von, bis })

  return <KellerAuswertungenClient daten={daten} />
}
