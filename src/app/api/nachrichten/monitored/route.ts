import { createSupabaseServerClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { getCurrentMembership } from '@/lib/auth/roles'
export const dynamic = 'force-dynamic'
type R = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

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
