import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { getCurrentMembership, isSystemAdmin } from '@/lib/auth/roles'
import { laufMorgenberichte } from '@/lib/morgenbericht/lauf'
import { spiegleMailboxen } from '@/lib/email/spiegel'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// ── Täglicher Sammel-Cron (05:00 UTC = 07:00 MESZ, vercel.json) ──────────────
// Vercel Hobby erlaubt zwei Cron-Jobs je Projekt, jeweils einmal täglich.
// Deshalb laufen hier nacheinander: 1. fällige E&A-Daueraufträge (bisher
// /api/cron/ea-dauerauftraege, 06:00), 2. der Morgenbericht aller Betriebe -
// so enthält der Bericht die Buchungen aus den Daueraufträgen bereits.
// Die Einzelrouten bleiben für manuelle Aufrufe (System-Admin) bestehen.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

export async function GET(req: NextRequest) { return handle(req) }
export async function POST(req: NextRequest) { return handle(req) }

async function handle(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  const authHeader = req.headers.get('authorization')
  const hasCronAuth = !!cronSecret && authHeader === `Bearer ${cronSecret}`
  if (!hasCronAuth) {
    const membership = await getCurrentMembership()
    if (!membership || !isSystemAdmin(membership.role)) return NextResponse.json({ fehler: 'Unauthorized' }, { status: 401 })
  }
  const start = Date.now()

  // 1. Daueraufträge (mandantenübergreifende DB-Funktion, siehe Migration 164)
  // tenant-isolation-ignore: Cron-Job über alle Mandanten, siehe process_ea_dauerauftraege (Migration 164)
  const admin = createSupabaseAdminClient()
  const { data: daRaw, error: daErr } = await (admin.rpc as any)('process_ea_dauerauftraege')
  const da = (Array.isArray(daRaw) ? daRaw[0] : daRaw) as R | null
  const dauerauftraege = daErr ? { fehler: daErr.message } : { verarbeitet: da?.verarbeitet ?? 0, erstellt: da?.erstellt ?? 0, uebersprungen: da?.uebersprungen ?? 0, fehler: da?.fehler ?? 0 }

  // 2. Morgenberichte (bis zu 60 % des restlichen Zeitbudgets)
  const rest = (maxDuration - 8) * 1000 - (Date.now() - start)
  const morgenbericht = await laufMorgenberichte(Math.max(5000, Math.floor(rest * 0.6)))

  // 3. E-Mail-Spiegelung ins CRM (Posteingang/Gesendet aller verbundenen Postfächer, inkrementell)
  const rest2 = (maxDuration - 6) * 1000 - (Date.now() - start)
  const emailSpiegel = rest2 > 5000 ? await spiegleMailboxen(rest2) : { uebersprungen: 'kein Zeitbudget' }

  return NextResponse.json({ dauerMs: Date.now() - start, dauerauftraege, morgenbericht, emailSpiegel })
}
