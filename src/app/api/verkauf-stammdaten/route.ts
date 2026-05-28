import { createSupabaseServerClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const supabase = await createSupabaseServerClient()

    const [
      { data: fuellungen },
      { data: weinausbau },
      { data: kontakte },
      { data: firmen },
    ] = await Promise.all([
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase.from('fuellungen') as any)
        .select('id, name, jahrgang, rebsorte, flaschengroesse_ml, bestand_flaschen, vk_preis_brutto')
        .eq('aktiv', true)
        .gt('bestand_flaschen', 0)
        .order('name'),

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase.from('weinausbau') as any)
        .select('id, name, menge_liter')
        .eq('aktiv', true)
        .gt('menge_liter', 0)
        .order('name'),

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase.from('kontakte') as any)
        .select('id, vorname, nachname, firma_id')
        .eq('aktiv', true)
        .order('nachname'),

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase.from('firmen') as any)
        .select('id, name')
        .eq('aktiv', true)
        .order('name'),
    ])

    return NextResponse.json({
      fuellungen:  fuellungen ?? [],
      weinausbau:  weinausbau ?? [],
      kontakte:    kontakte   ?? [],
      firmen:      firmen     ?? [],
    })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
