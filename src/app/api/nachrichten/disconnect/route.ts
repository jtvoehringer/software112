import { createSupabaseServerClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { getCurrentMembership } from '@/lib/auth/roles'
import { pruefeZweiFaktor } from '@/lib/api/zweiFaktor'
export const dynamic = 'force-dynamic'
type R = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

// schreibsperre-ausnahme: entfernt nur die eigenen gespeicherten Postfach-Zugangsdaten – muss aus Datenschutzgründen immer möglich sein
export async function POST() {
  const zweiFaktor = await pruefeZweiFaktor()
  if (zweiFaktor) return zweiFaktor
  try {
    const supabase = await createSupabaseServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ fehler: 'Nicht angemeldet' }, { status: 401 })

    const membership = await getCurrentMembership()
    const tenantId = membership?.tenantId
    if (!tenantId) return NextResponse.json({ fehler: 'Kein Betrieb' }, { status: 401 })

    await (supabase.from('user_email_connections') as any)
      .delete()
      .eq('tenant_id', tenantId)
      .eq('user_id', user.id)

    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ fehler: String(err) }, { status: 500 })
  }
}
