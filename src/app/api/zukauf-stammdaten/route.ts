import { createSupabaseServerClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { getCurrentMembership } from '@/lib/auth/roles'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const membership = await getCurrentMembership()
    const tenantId = membership?.tenantId
    if (!tenantId) return NextResponse.json({ error: 'Kein Betrieb' }, { status: 401 })

    const supabase = await createSupabaseServerClient()

    const [{ data: behaelter }, { data: weinausbau }] = await Promise.all([
      (supabase.from('behaelter') as any)
        .select('id, name, typ, volumen_liter')
        .eq('tenant_id', tenantId)
        .eq('aktiv', true)
        .order('name'),
      (supabase.from('weinausbau') as any)
        .select('id, name, menge_liter, behaelter_id, rebsorte')
        .eq('tenant_id', tenantId)
        .eq('aktiv', true)
        .order('name'),
    ])

    return NextResponse.json({ behaelter: behaelter ?? [], weinausbau: weinausbau ?? [] })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
