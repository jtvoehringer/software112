// behoerdenmeldung: keller-auswertungen, keller-behandlungen-alle
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentMembership } from '@/lib/auth/roles'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { wienHeute } from '@/lib/csv'
import { kellerZeitraum, ladeKellerAuswertungen } from '@/lib/behoerden/keller-auswertungen'
import KellerAuswertungenClient from './KellerAuswertungenClient'

export const metadata: Metadata = { title: 'Keller-Auswertungen' }
export const dynamic = 'force-dynamic'

// Seit 24.09.2026: Zeitraum frei wählbar (?von=&bis=, Standard: 1.1. des laufenden Jahres
// bis offen – wie bisher), alle Umzüge statt höchstens 100, CSV über den Baustein.
// Dieselben Ladefunktionen liefern die CSVs „keller-auswertungen“ (Umzüge, Filtrationen,
// Schwund) und „keller-behandlungen-alle“ (lib/behoerden/keller-auswertungen.ts).
// KAN-177 (01.10.2026): Zeitraum über kellerZeitraum() – ungültige bzw. vertauschte Grenzen
// fallen nicht mehr stillschweigend weg, sondern werden gemeldet bzw. getauscht.
export default async function KellerAuswertungenPage({
  searchParams,
}: {
  searchParams: Promise<{ von?: string; bis?: string }>
}) {
  const sp = await searchParams
  const membership = await getCurrentMembership()
  const tenantId = membership?.tenantId ?? null
  if (!tenantId) notFound()

  const { zeitraum, hinweise } = kellerZeitraum(sp, wienHeute())

  const supabase = await createSupabaseServerClient()
  const daten = await ladeKellerAuswertungen(supabase, tenantId, zeitraum)

  return <KellerAuswertungenClient daten={daten} zeitraumHinweise={hinweise} />
}
