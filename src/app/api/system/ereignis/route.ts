import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentMembership } from '@/lib/auth/roles'
import { ereignisMelden } from '@/lib/system/ereignis'
import { pruefeZweiFaktor } from '@/lib/api/zweiFaktor'

export const dynamic = 'force-dynamic'

// Browser-Fehlergrenze ((dashboard)/error.tsx) meldet hierher (20.9.2026).
// Nur für angemeldete Benutzer, knappe Felder – kein freies Protokoll.
// schreibsperre-ausnahme: Fehlerprotokoll der Oberfläche (Systemereignisse) – keine Betriebsdaten
export async function POST(req: NextRequest) {
  const zweiFaktor = await pruefeZweiFaktor()
  if (zweiFaktor) return zweiFaktor
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ ok: false }, { status: 401 })

  let body: Record<string, unknown> = {}
  try { body = await req.json() } catch { return NextResponse.json({ ok: false }, { status: 400 }) }

  const membership = await getCurrentMembership()
  await ereignisMelden({
    art: 'client',
    quelle: String(body.pfad ?? '?').slice(0, 300),
    meldung: String(body.meldung ?? 'Fehler ohne Meldung'),
    digest: typeof body.digest === 'string' ? body.digest : null,
    tenantId: membership?.tenantId ?? null,
    userId: user.id,
    details: { name: typeof body.name === 'string' ? body.name.slice(0, 100) : null, userAgent: (req.headers.get('user-agent') ?? '').slice(0, 200) },
  })
  return NextResponse.json({ ok: true })
}
