import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { getCurrentMembership, isSystemAdmin } from '@/lib/auth/roles'
import { pruefeZweiFaktor } from '@/lib/api/zweiFaktor'
import { dbFehlerText } from '@/lib/fehler'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

// Vercel Cron ruft GET auf (siehe vercel.json) – delegiert an dieselbe Logik wie POST.
export async function GET(req: NextRequest) {
  return handle(req)
}

// Manuell auslösbar (z.B. zum Testen) – nur System-Admins, ausschließlich über
// eine eingeloggte Session (kein CRON_SECRET nötig für diesen Zweig).
// schreibsperre-ausnahme: Cron bzw. manueller Lauf nur für Super-Admins (von der Abo-Sperre ausgenommen), mandantenübergreifend
export async function POST(req: NextRequest) {
  return handle(req)
}

async function handle(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  const authHeader = req.headers.get('authorization')
  const hasCronAuth = !!cronSecret && authHeader === `Bearer ${cronSecret}`

  if (!hasCronAuth) {
    // Sitzungszweig (manueller Lauf): Zwei-Faktor wie jede benutzergebundene Route (KAN-54)
    const zweiFaktor = await pruefeZweiFaktor()
    if (zweiFaktor) return zweiFaktor
    const membership = await getCurrentMembership()
    if (!membership || !isSystemAdmin(membership.role)) {
      return NextResponse.json({ fehler: 'Unauthorized' }, { status: 401 })
    }
  }

  // Bewusst mandantenübergreifend – process_ea_dauerauftraege() verarbeitet
  // fällige Daueraufträge ALLER Mandanten in einem Lauf (SECURITY DEFINER,
  // eigene Filterung nach tenant_id innerhalb der Funktion).
  // tenant-isolation-ignore: Cron-Job über alle Mandanten, siehe process_ea_dauerauftraege (Migration 164)
  const admin = createSupabaseAdminClient()
  const { data, error } = await (admin.rpc as any)('process_ea_dauerauftraege')

  if (error) {
    return NextResponse.json({ fehler: dbFehlerText(error) }, { status: 500 })
  }

  const row = (Array.isArray(data) ? data[0] : data) as R | null
  return NextResponse.json({
    verarbeitet:   row?.verarbeitet    ?? 0,
    erstellt:      row?.erstellt       ?? 0,
    uebersprungen: row?.uebersprungen  ?? 0,
    fehler:        row?.fehler         ?? 0,
  })
}
