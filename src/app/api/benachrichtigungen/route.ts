import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentMembership } from '@/lib/auth/roles'
import { pruefeZweiFaktor } from '@/lib/api/zweiFaktor'

export const dynamic = 'force-dynamic'

// POST /api/benachrichtigungen – als gelesen markieren
// Body: { ids: string[] } einzelne, oder { alle: true } alle ungelesenen des Benutzers im aktiven Betrieb
// schreibsperre-ausnahme: markiert nur eigene Benachrichtigungen als gelesen (Lesestatus, keine Betriebsdaten) – gehört zum Lesen
export async function POST(req: NextRequest) {
  const zweiFaktor = await pruefeZweiFaktor()
  if (zweiFaktor) return zweiFaktor
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Nicht angemeldet' }, { status: 401 })
  const membership = await getCurrentMembership()
  if (!membership) return NextResponse.json({ error: 'Kein aktiver Betrieb' }, { status: 400 })
  const body = (await req.json().catch(() => ({}))) as { ids?: string[]; alle?: boolean }
  const jetzt = new Date().toISOString()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let q = (supabase.from('benachrichtigungen') as any).update({ gelesen_am: jetzt })
    .eq('tenant_id', membership.tenantId).eq('empfaenger_id', user.id).is('gelesen_am', null)
  if (body.alle) { /* alle ungelesenen */ }
  else if (Array.isArray(body.ids) && body.ids.length > 0) q = q.in('id', body.ids.slice(0, 100))
  else return NextResponse.json({ error: 'ids oder alle erforderlich' }, { status: 400 })
  const { error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
