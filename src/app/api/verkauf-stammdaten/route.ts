import { createSupabaseServerClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const supabase = await createSupabaseServerClient()

    // Tenant-Einstellungen für USt-Standard
    const { data: einstellungen } = await (supabase.from('tenant_einstellungen') as any)
      .select('ust_satz_standard')
      .limit(1)
      .maybeSingle()
    const ustStandard: number = parseFloat((einstellungen as any)?.ust_satz_standard) || 13

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
        .select('id, vorname, nachname, firma_id, sonderrabatt_pct, rabattgruppe:rabattgruppe_id(rabatt_pct)')
        .eq('aktiv', true)
        .order('nachname'),

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase.from('firmen') as any)
        .select('id, name, sonderrabatt_pct, rabattgruppe:rabattgruppe_id(rabatt_pct)')
        .eq('aktiv', true)
        .order('name'),
    ])

    return NextResponse.json({
      fuellungen:  fuellungen ?? [],
      weinausbau:  weinausbau ?? [],
      kontakte: (kontakte ?? []).map((k: any) => ({
        ...k,
        rabatt_pct:       (k.rabattgruppe as any)?.rabatt_pct ?? null,
        sonderrabatt_pct: parseFloat(k.sonderrabatt_pct) || 0,
      })),
      ust_satz_standard: ustStandard,
      firmen: (firmen ?? []).map((f: any) => ({
        ...f,
        rabatt_pct:       (f.rabattgruppe as any)?.rabatt_pct ?? null,
        sonderrabatt_pct: parseFloat(f.sonderrabatt_pct) || 0,
      })),
    })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
