import { createSupabaseServerClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const supabase = await createSupabaseServerClient()

    const { data: weinausbau } = await (supabase.from('weinausbau') as any)
      .select('id, name, menge_liter')
      .eq('aktiv', true)
      .order('name')

    return NextResponse.json({ weinausbau: weinausbau ?? [] })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
