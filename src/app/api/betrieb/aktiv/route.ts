import { NextResponse } from 'next/server'
import { getCurrentMembership } from '@/lib/auth/roles'
import { pruefeZweiFaktor } from '@/lib/api/zweiFaktor'
import { ladeTenantKopf, betriebsName, mandantName } from '@/lib/tenant/kopf'

export const dynamic = 'force-dynamic'

const KEIN_CACHE = { 'Cache-Control': 'no-store' }

// GET /api/betrieb/aktiv (KAN-30) → { tenantId, name, mandant }
//
// Aktiver Betrieb laut Cookie (über getCurrentMembership() gegen die eigenen, aktiven
// Mitgliedschaften geprüft) samt Anzeigename und Mandantenname (tenants.name, unterscheidet
// Betriebe mit gleichem Anzeigenamen). Der Betriebs-Wächter (components/BetriebsWaechter.tsx)
// fragt das nur bei Rückkehr in den Tab (höchstens alle 15 s) bzw. nach einer Meldung eines
// anderen Tabs ab – nicht im Takt. Namen aus dem 60-s-Layout-Cache (lib/tenant/kopf.ts), also
// ohne zusätzliche Datenbankabfrage im Normalfall.
// { tenantId: null } = keine Aussage (abgemeldet, keine Mitgliedschaft) – der Wächter sperrt dann nicht.
export async function GET() {
  const zweiFaktor = await pruefeZweiFaktor()
  if (zweiFaktor) return zweiFaktor
  const membership = await getCurrentMembership()
  if (!membership) return NextResponse.json({ tenantId: null, name: null }, { headers: KEIN_CACHE })
  const kopf = await ladeTenantKopf(membership.tenantId)
  return NextResponse.json(
    { tenantId: membership.tenantId, name: betriebsName(kopf), mandant: mandantName(kopf) },
    { headers: KEIN_CACHE },
  )
}
