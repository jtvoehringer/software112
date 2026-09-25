// Manueller Lauf der E-Mail-Spiegelung (System-Admin oder CRON_SECRET) - der
// tägliche Lauf hängt am Sammel-Cron /api/cron/taeglich. ?tenant=<id> begrenzt
// auf einen Betrieb.
import { NextRequest, NextResponse } from 'next/server'
import { getCurrentMembership, isSystemAdmin } from '@/lib/auth/roles'
import { spiegleMailboxen } from '@/lib/email/spiegel'
import { pruefeZweiFaktor } from '@/lib/api/zweiFaktor'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(req: NextRequest) { return handle(req) }
// schreibsperre-ausnahme: Cron bzw. manueller Lauf nur für Super-Admins (von der Abo-Sperre ausgenommen)
export async function POST(req: NextRequest) { return handle(req) }

async function handle(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  const hasCronAuth = !!cronSecret && req.headers.get('authorization') === `Bearer ${cronSecret}`
  if (!hasCronAuth) {
    // Sitzungszweig: Zwei-Faktor wie jede benutzergebundene Route (KAN-54)
    const zweiFaktor = await pruefeZweiFaktor()
    if (zweiFaktor) return zweiFaktor
  }
  const membership = hasCronAuth ? null : await getCurrentMembership()
  if (!hasCronAuth && (!membership || !isSystemAdmin(membership.role))) return NextResponse.json({ fehler: 'Unauthorized' }, { status: 401 })
  const nurTenant = req.nextUrl.searchParams.get('tenant') ?? (membership?.tenantId ?? undefined)
  const erg = await spiegleMailboxen((maxDuration - 8) * 1000, nurTenant || undefined)
  return NextResponse.json(erg)
}
