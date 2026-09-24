import { NextRequest, NextResponse } from 'next/server'
import { getCurrentMembership, isSystemAdmin } from '@/lib/auth/roles'
import { pruefeZweiFaktor } from '@/lib/api/zweiFaktor'
import { laufMorgenberichte } from '@/lib/morgenbericht/lauf'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// ── Morgenbericht für alle Betriebe (manueller Lauf) ─────────────────────────
// Der tägliche Lauf steckt im Sammel-Cron /api/cron/taeglich (Vercel Hobby:
// höchstens zwei Cron-Jobs je Projekt, einmal täglich). Diese Route bleibt für
// System-Admins zum Testen bzw. für einen Aufruf mit CRON_SECRET.

export async function GET(req: NextRequest) { return handle(req) }
export async function POST(req: NextRequest) { return handle(req) }

async function handle(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  const authHeader = req.headers.get('authorization')
  const hasCronAuth = !!cronSecret && authHeader === `Bearer ${cronSecret}`
  if (!hasCronAuth) {
    // Sitzungszweig (manueller Lauf): Zwei-Faktor wie jede benutzergebundene Route (KAN-54)
    const zweiFaktor = await pruefeZweiFaktor()
    if (zweiFaktor) return zweiFaktor
    const membership = await getCurrentMembership()
    if (!membership || !isSystemAdmin(membership.role)) return NextResponse.json({ fehler: 'Unauthorized' }, { status: 401 })
  }
  return NextResponse.json(await laufMorgenberichte((maxDuration - 8) * 1000))
}
