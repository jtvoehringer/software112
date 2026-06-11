import { createSupabaseServerClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(req: NextRequest) {
  const von = req.nextUrl.searchParams.get('von')
  const bis = req.nextUrl.searchParams.get('bis')
  if (!von || !bis) return NextResponse.json({ fehler: 'von/bis fehlen' }, { status: 400 })

  const supabase = await createSupabaseServerClient()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.from('verkaufsposten') as any)
    .select('id, datum, rechnungsnummer, storniert, bezahlt, kontakt:kontakte!kontakt_id(vorname, nachname), firma:firmen(name), verkauf_positionen(preis_brutto, menge, rabatt_pct, sonderrabatt_pct)')
    .eq('aktiv', true).eq('storniert', false)
    .gte('datum', von).lte('datum', bis)
    .order('datum', { ascending: false })

  if (error) return NextResponse.json({ fehler: error.message }, { status: 500 })

  return NextResponse.json({ posten: data ?? [] })
}
