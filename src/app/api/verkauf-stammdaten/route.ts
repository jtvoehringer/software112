import { createSupabaseServerClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const supabase = await createSupabaseServerClient()

    const { data: einstellungen } = await (supabase.from('tenant_einstellungen') as any)
      .select('ust_satz_standard').limit(1).maybeSingle()
    const ustStandard: number = parseFloat((einstellungen as any)?.ust_satz_standard) || 13

    const [
      { data: fuellungen },
      { data: weinausbau },
      { data: kontakte },
      { data: firmen },
      { data: sonstigeArtikel },
      { data: zukaufPosten },
      { data: pressungDirektRaw },
    ] = await Promise.all([
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase.from('fuellungen') as any)
        .select('id, name, jahrgang, rebsorte, flaschengroesse_ml, bestand_flaschen, vk_preis_brutto')
        .eq('aktiv', true).gt('bestand_flaschen', 0).order('name'),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase.from('weinausbau') as any)
        .select('id, name, menge_liter')
        .eq('aktiv', true).neq('status', 'abgeschlossen').gt('menge_liter', 0).order('name'),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase.from('kontakte') as any)
        .select('id, vorname, nachname, firma_id, sonderrabatt_pct, skonto_pct, skonto_tage, rabattgruppe:rabattgruppe_id(rabatt_pct)')
        .eq('aktiv', true).order('nachname'),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase.from('firmen') as any)
        .select('id, name, sonderrabatt_pct, skonto_pct, skonto_tage, rabattgruppe:rabattgruppe_id(rabatt_pct)')
        .eq('aktiv', true).order('name'),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase.from('sonstige_artikel') as any)
        .select('id, name, einheit, default_preis')
        .eq('aktiv', true).order('name'),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase.from('zukauf_posten') as any)
        .select('id, art, menge, einheit, rebsorte, jahrgang, notizen')
        .eq('aktiv', true).gt('menge', 0).order('erstellt_am', { ascending: false }),
      // Pressung-Direktbefüllungen (noch keiner Kellerbuch-Charge zugeordnet)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase.from('pressung_behaelter') as any)
        .select('id, menge_liter, behaelter:behaelter_id(name), pressung:pressung_id(datum, weinbezeichnung)')
        .is('weinausbau_id', null).gt('menge_liter', 0)
        .order('menge_liter', { ascending: false }),
    ])

    return NextResponse.json({
      fuellungen:       fuellungen    ?? [],
      weinausbau:       weinausbau    ?? [],
      sonstige_artikel: sonstigeArtikel ?? [],
      zukauf_posten:    zukaufPosten  ?? [],
      pressung_direkt:  ((pressungDirektRaw ?? []) as any[]).map((pb: any) => ({
        id:                   pb.id,
        menge_liter:          pb.menge_liter,
        behaelter_name:       (pb.behaelter as any)?.name ?? null,
        pressung_datum:       (pb.pressung as any)?.datum ?? null,
        pressung_bezeichnung: (pb.pressung as any)?.weinbezeichnung ?? null,
      })),
      kontakte: (kontakte ?? []).map((k: any) => ({
        ...k,
        rabatt_pct:       (k.rabattgruppe as any)?.rabatt_pct ?? null,
        sonderrabatt_pct: parseFloat(k.sonderrabatt_pct) || 0,
        skonto_pct:       parseFloat(k.skonto_pct) || 0,
        skonto_tage:      parseInt(k.skonto_tage) || 10,
      })),
      ust_satz_standard: ustStandard,
      firmen: (firmen ?? []).map((f: any) => ({
        ...f,
        rabatt_pct:       (f.rabattgruppe as any)?.rabatt_pct ?? null,
        sonderrabatt_pct: parseFloat(f.sonderrabatt_pct) || 0,
        skonto_pct:       parseFloat(f.skonto_pct) || 0,
        skonto_tage:      parseInt(f.skonto_tage) || 10,
      })),
    })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
