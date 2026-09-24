import { createSupabaseServerClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { getCurrentMembership } from '@/lib/auth/roles'
import { pruefeZweiFaktor } from '@/lib/api/zweiFaktor'
export const dynamic = 'force-dynamic'
type R = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

// GET fehlte bisher komplett - der Client konnte den gespeicherten Wert nie
// wieder laden (monitoredEmail-State startete immer leer), wodurch die
// Funktion nach jedem Neuladen der Seite unsichtbar wirkte, obwohl sie
// serverseitig (list/message/folders/unified-Routen) längst aktiv war.
export async function GET() {
  const zweiFaktor = await pruefeZweiFaktor()
  if (zweiFaktor) return zweiFaktor
  try {
    const supabase = await createSupabaseServerClient()
    const membership = await getCurrentMembership()
    const tenantId = membership?.tenantId
    if (!tenantId) return NextResponse.json({ fehler: 'Kein Betrieb' }, { status: 401 })
    const { data: { user } } = await supabase.auth.getUser()

    const { data } = await (supabase.from('user_email_connections') as any)
      .select('monitored_email, email_spiegel_stand, email_spiegel_info')
      .eq('tenant_id', tenantId).eq('user_id', user?.id ?? '').maybeSingle()

    const d = data as R | null
    return NextResponse.json({ monitored_email: d?.monitored_email ?? null, spiegel_stand: d?.email_spiegel_stand ?? null, spiegel_info: d?.email_spiegel_info ?? null })
  } catch (err) { return NextResponse.json({ fehler: String(err) }, { status: 500 }) }
}

export async function POST(req: NextRequest) {
  const zweiFaktor = await pruefeZweiFaktor()
  if (zweiFaktor) return zweiFaktor
  try {
    const { monitored_email } = await req.json()
    const supabase = await createSupabaseServerClient()
    const membership = await getCurrentMembership()
    const tenantId = membership?.tenantId
    if (!tenantId) return NextResponse.json({ fehler: 'Kein Betrieb' }, { status: 401 })
    const { data: { user } } = await supabase.auth.getUser()

    await (supabase.from('user_email_connections') as any)
      .update({ monitored_email: monitored_email || null, aktualisiert_am: new Date().toISOString() })
      .eq('tenant_id', tenantId).eq('user_id', user?.id ?? '')

    return NextResponse.json({ ok: true })
  } catch (err) { return NextResponse.json({ fehler: String(err) }, { status: 500 }) }
}
