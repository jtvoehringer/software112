import { createSupabaseServerClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ fehler: 'id fehlt' }, { status: 400 })

  const supabase = await createSupabaseServerClient()

  // Verkaufspositionen für diese Füllung
  const { data: posRaw, error } = await (supabase
    .from('verkauf_positionen') as any)
    .select('id, menge, einheit, preis_brutto, rabatt_pct, sonderrabatt_pct, erstellt_am, verkaufsposten:verkaufsposten_id(id, datum, rechnungsnummer, storniert, bezahlt, kontakt:kontakte!kontakt_id(vorname, nachname), firma:firmen(name))')
    .eq('fuellung_id', id)
    .order('erstellt_am', { ascending: false })
    .limit(50)

  if (error) return NextResponse.json({ fehler: error.message }, { status: 500 })

  const pos = (posRaw ?? []) as R[]

  // Bestandsveränderungen aufbereiten
  const bv = pos.map(p => {
    const vp = p.verkaufsposten as R | null
    const nettoPreis = (Number(p.preis_brutto) || 0)
      * (1 - (Number(p.rabatt_pct) || 0) / 100)
      * (1 - (Number(p.sonderrabatt_pct) || 0) / 100)
    const kunde = vp?.kontakt
      ? [vp.kontakt.vorname, vp.kontakt.nachname].filter(Boolean).join(' ')
      : vp?.firma?.name ?? '–'
    return {
      datum:          vp?.datum ?? null,
      rechnungsnummer: vp?.rechnungsnummer ?? null,
      verkauf_id:     vp?.id ?? null,
      storniert:      vp?.storniert ?? false,
      bezahlt:        vp?.bezahlt ?? false,
      kunde,
      menge:          Number(p.menge) || 0,
      einheit:        p.einheit ?? 'Fl.',
      preis_brutto:   Number(p.preis_brutto) || 0,
      netto_preis:    nettoPreis,
      umsatz:         nettoPreis * (Number(p.menge) || 0),
    }
  })

  const gesamtVerkauft = bv.filter(b => !b.storniert).reduce((s, b) => s + b.menge, 0)
  const gesamtUmsatz   = bv.filter(b => !b.storniert).reduce((s, b) => s + b.umsatz, 0)

  return NextResponse.json({ bv, gesamtVerkauft, gesamtUmsatz })
}
