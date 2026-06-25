import { createSupabaseServerClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const supabase = await createSupabaseServerClient()

    const [{ data: behaelter }, { data: weinausbau }] = await Promise.all([
      (supabase.from('behaelter') as any)
        .select('id, name, typ')
        .eq('aktiv', true)
        .order('name'),
      (supabase.from('weinausbau') as any)
        .select('id, name, menge_liter, behaelter_id, rebsorte')
        .eq('aktiv', true)
        .order('name'),
    ])

    return NextResponse.json({ behaelter: behaelter ?? [], weinausbau: weinausbau ?? [] })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
