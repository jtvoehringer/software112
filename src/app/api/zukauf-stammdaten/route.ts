import { createSupabaseServerClient } from '@/lib/supabase/server'
import { ladeBehaelter } from '@/lib/keller/behaelter'
import { NextResponse } from 'next/server'
import { getCurrentMembership } from '@/lib/auth/roles'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const membership = await getCurrentMembership()
    const tenantId = membership?.tenantId
    if (!tenantId) return NextResponse.json({ error: 'Kein Betrieb' }, { status: 401 })

    const supabase = await createSupabaseServerClient()

    const [behaelterRows, { data: weinausbau }] = await Promise.all([
      // eigene + freigegebene Gebinde, fremd belegte ausgenommen (Kellergemeinschaft, Migration 203)
      ladeBehaelter(supabase, tenantId, { alsZiel: true }),
      (supabase.from('weinausbau') as any)
        .select('id, name, menge_liter, behaelter_id, rebsorte')
        .eq('tenant_id', tenantId)
        .eq('aktiv', true)
        .order('name'),
    ])

    const behaelter = behaelterRows.map(b => ({ id: b.id, name: b.anzeigeName, typ: b.typ, volumen_liter: b.volumen_liter }))
    return NextResponse.json({ behaelter, weinausbau: weinausbau ?? [] })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
