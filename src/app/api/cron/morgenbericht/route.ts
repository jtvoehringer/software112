import { NextRequest, NextResponse } from 'next/server'
import { getCurrentMembership, isSystemAdmin } from '@/lib/auth/roles'
import { pruefeZweiFaktor } from '@/lib/api/zweiFaktor'
import { laufMorgenberichte } from '@/lib/morgenbericht/lauf'
import { LAUF_RESERVE_MS } from '@/lib/morgenbericht/zeitplan'

export const dynamic = 'force-dynamic'
export const maxDuration = 800

// ── Morgenbericht für alle Betriebe (manueller Lauf) ─────────────────────────
// Der tägliche Lauf steckt im Sammel-Cron /api/cron/taeglich (entstanden unter Vercel
// Hobby mit zwei Cron-Jobs; seit 23.09.2026 Vercel Pro mit Fluid: bis 100 Cron-Jobs,
// bis einmal pro Minute, minutengenau, maxDuration bis 800 s). Diese Route bleibt für
// System-Admins zum Testen bzw. für einen Aufruf mit CRON_SECRET – gleiches Zeitbudget
// wie der tägliche Lauf (KAN-123): maxDuration abzüglich Reserve.

export async function GET(req: NextRequest) { return handle(req) }
// schreibsperre-ausnahme: Cron bzw. manueller Lauf nur für Super-Admins (von der Abo-Sperre ausgenommen), mandantenübergreifend
export async function POST(req: NextRequest) { return handle(req) }

async function handle(req: NextRequest) {
  const start = Date.now()
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
  return NextResponse.json(await laufMorgenberichte(maxDuration * 1000 - LAUF_RESERVE_MS - (Date.now() - start)))
}
