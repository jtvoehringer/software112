import { createSupabaseServerClient } from '@/lib/supabase/server'
import { alle } from '@/lib/supabase/alle'
import { getCurrentMembership } from '@/lib/auth/roles'
import { NextRequest, NextResponse } from 'next/server'
import { pruefeZweiFaktor } from '@/lib/api/zweiFaktor'
import { alsBeleg, lieferscheineSelect } from '@/lib/verkauf/rechnungen'
import { umsatzBasis } from '@/lib/verkauf/umsatzBasis'

export async function GET(req: NextRequest) {
  const zweiFaktor = await pruefeZweiFaktor()
  if (zweiFaktor) return zweiFaktor
  const membership = await getCurrentMembership()
  const tenantId = membership?.tenantId
  if (!tenantId) return NextResponse.json({ fehler: 'Kein Betrieb' }, { status: 401 })

  const von = req.nextUrl.searchParams.get('von')
  const bis = req.nextUrl.searchParams.get('bis')
  if (!von || !bis) return NextResponse.json({ fehler: 'von/bis fehlen' }, { status: 400 })

  const supabase = await createSupabaseServerClient()

  // KAN-105: nach Rechnungsdatum – Rechnungen (Sammelrechnung als eine Zeile), Link zur Rechnungsseite
  if (umsatzBasis(req.nextUrl.searchParams.get('basis')) === 'rechnung') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await alle((supabase.from('rechnungen') as any)
      .select(`id, datum, rechnungsnummer, storniert, bezahlt, kontakt:kontakte!kontakt_id(vorname, nachname), firma:firmen!firma_id(name), ${lieferscheineSelect('preis_brutto, menge, rabatt_pct, sonderrabatt_pct')}`)
      .eq('tenant_id', tenantId)
      .eq('aktiv', true).eq('storniert', false)
      .gte('datum', von).lte('datum', bis)
      .order('datum', { ascending: false })
      .order('id'))
    if (error) return NextResponse.json({ fehler: error.message }, { status: 500 })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return NextResponse.json({ posten: ((data ?? []) as any[]).map(r => ({ ...alsBeleg(r), href: `/weinhandel/rechnungen/${r.id}` })) })
  }

  // alle(): Detailliste und Summe über alle Verkäufe des Zeitraums, nicht nur die ersten 1.000
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await alle((supabase.from('verkaufsposten') as any)
    .select('id, datum, rechnungsnummer, storniert, bezahlt, kontakt:kontakte!kontakt_id(vorname, nachname), firma:firmen(name), verkauf_positionen(preis_brutto, menge, rabatt_pct, sonderrabatt_pct)')
    .eq('tenant_id', tenantId)
    .eq('aktiv', true).eq('storniert', false)
    .gte('datum', von).lte('datum', bis)
    .order('datum', { ascending: false })
    .order('id'))

  if (error) return NextResponse.json({ fehler: error.message }, { status: 500 })

  return NextResponse.json({ posten: data ?? [] })
}
