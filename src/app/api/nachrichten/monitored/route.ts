import { createSupabaseServerClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { getCurrentMembership } from '@/lib/auth/roles'
export const dynamic = 'force-dynamic'
type R = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

// GET fehlte bisher komplett - der Client konnte den gespeicherten Wert nie
// wieder laden (monitoredEmail-State startete immer leer), wodurch die
// Funktion nach jedem Neuladen der Seite unsichtbar wirkte, obwohl sie
// serverseitig (list/message/folders/unified-Routen) längst aktiv war.
export async function GET() {
  try {
    const supabase = await createSupabaseServerClient()
    const membership = await getCurrentMembership()
    const tenantId = membership?.tenantId
    if (!tenantId) return NextResponse.json({ fehler: 'Kein Betrieb' }, { status: 401 })
    const { data: { user } } = await supabase.auth.getUser()

    const { data } = await (supabase.from('user_email_connections') as any)
      .select('monitored_email')
      .eq('tenant_id', tenantId).eq('user_id', user?.id ?? '').maybeSingle()

    return NextResponse.json({ monitored_email: (data as R | null)?.monitored_email ?? null })
  } catch (err) { return NextResponse.json({ fehler: String(err) }, { status: 500 }) }
}

export async function POST(req: NextRequest) {
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
