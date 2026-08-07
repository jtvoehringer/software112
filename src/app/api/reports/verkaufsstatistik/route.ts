import { createSupabaseServerClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

// Verkaufsstatistik: flache Liste der Flaschenverkäufe (verkauf_positionen, typ='flasche'),
// gefiltert nach Jahrgang/Sorte/Bezeichnung (aus der verknüpften Füllung) und
// Kunde/PLZ-Bereich/Ort/Land (aus Kontakt oder Firma des Verkaufspostens).
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const jahrgang    = searchParams.get('jahrgang')
    const sorte       = searchParams.get('sorte')
    const bezeichnung = searchParams.get('bezeichnung')
    const kunde       = searchParams.get('kunde')   // "kontakt:<id>" | "firma:<id>"
    const plzVon      = searchParams.get('plzVon')
    const plzBis      = searchParams.get('plzBis')
    const ort         = searchParams.get('ort')
    const land        = searchParams.get('land')

    const supabase = await createSupabaseServerClient()

    let query = (supabase.from('verkaufsposten') as any)
      .select(`
        id, datum, rechnungsnummer,
        kontakt:kontakte!kontakt_id(id, vorname, nachname, plz, ort, land),
        firma:firmen(id, name, plz, ort, land),
        verkauf_positionen(id, typ, name, menge, preis_brutto, rabatt_pct, sonderrabatt_pct,
          fuellung:fuellungen(name, jahrgang, rebsorte, bezeichnung))
      `)
      .eq('aktiv', true).eq('storniert', false)

    if (kunde?.startsWith('kontakt:')) query = query.eq('kontakt_id', kunde.slice(8))
    else if (kunde?.startsWith('firma:')) query = query.eq('firma_id', kunde.slice(6))

    const { data, error } = await query
    if (error) return NextResponse.json({ fehler: error.message }, { status: 500 })

    type Zeile = {
      datum: string; rechnungsnummer: string | null; kunde: string
      plz: string | null; ort: string | null; land: string | null
      produkt: string; jahrgang: number | null; sorte: string | null; bezeichnung: string | null
      menge: number; betrag: number
    }
    const zeilen: Zeile[] = []

    for (const p of ((data ?? []) as R[])) {
      const kontakt = p.kontakt as R | null
      const firma   = p.firma as R | null
      const kundeName = kontakt ? [kontakt.vorname, kontakt.nachname].filter(Boolean).join(' ') : (firma?.name ?? '–')
      const plzWert  = kontakt?.plz  ?? firma?.plz  ?? null
      const ortWert  = kontakt?.ort  ?? firma?.ort  ?? null
      const landWert = kontakt?.land ?? firma?.land ?? null

      // Ort/Land/PLZ-Bereich gelten auf Ebene des Verkaufspostens (= Kunde), nicht pro Position
      if (ort && ortWert !== ort) continue
      if (land && landWert !== land) continue
      if ((plzVon || plzBis) && !plzWert) continue
      if (plzVon && plzWert && plzWert < plzVon) continue
      if (plzBis && plzWert && plzWert > plzBis) continue

      for (const pos of ((p.verkauf_positionen ?? []) as R[])) {
        if (pos.typ !== 'flasche') continue
        const f = pos.fuellung as R | null

        if (jahrgang && String(f?.jahrgang ?? '') !== jahrgang) continue
        if (sorte && f?.rebsorte !== sorte) continue
        if (bezeichnung && f?.bezeichnung !== bezeichnung) continue

        const betrag = (Number(pos.preis_brutto) || 0) * (Number(pos.menge) || 0) *
          (1 - (Number(pos.rabatt_pct) || 0) / 100) * (1 - (Number(pos.sonderrabatt_pct) || 0) / 100)

        zeilen.push({
          datum: p.datum, rechnungsnummer: p.rechnungsnummer ?? null, kunde: kundeName,
          plz: plzWert, ort: ortWert, land: landWert,
          produkt: f?.name ?? pos.name, jahrgang: f?.jahrgang ?? null, sorte: f?.rebsorte ?? null, bezeichnung: f?.bezeichnung ?? null,
          menge: Number(pos.menge) || 0, betrag,
        })
      }
    }

    zeilen.sort((a, b) => new Date(b.datum).getTime() - new Date(a.datum).getTime())

    const summeMenge  = zeilen.reduce((s, z) => s + z.menge, 0)
    const summeBetrag = zeilen.reduce((s, z) => s + z.betrag, 0)

    return NextResponse.json({ zeilen, summeMenge, summeBetrag, anzahl: zeilen.length })
  } catch (err) {
    return NextResponse.json({ fehler: String(err) }, { status: 500 })
  }
}
