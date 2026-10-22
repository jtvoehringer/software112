import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentMembership } from '@/lib/auth/roles'
import { NextRequest, NextResponse } from 'next/server'
import { pruefeZweiFaktor } from '@/lib/api/zweiFaktor'
import { ladeUmsatzRechnungen, rechnungNetto } from '@/lib/verkauf/umsatz'
import { dbFehlerText } from '@/lib/fehler'

const TAG = /^\d{4}-\d{2}-\d{2}$/

// KAN-346/348: Belege eines Monats der Umsatz-Auswertung – dieselben Rechnungen wie die Monatssumme (zentrale
// Umsatzfunktion, netto nach Rechnungsdatum), je Rechnung mit ihrem Netto-Umsatz, damit die Belegliste die Monatssumme
// ergibt. Sammelrechnung als eine Zeile, Link zur Rechnungsseite. Die frühere Wahl „nach Lieferdatum“ entfällt.
export async function GET(req: NextRequest) {
  const zweiFaktor = await pruefeZweiFaktor()
  if (zweiFaktor) return zweiFaktor
  const membership = await getCurrentMembership()
  const tenantId = membership?.tenantId
  if (!tenantId) return NextResponse.json({ fehler: 'Kein Betrieb' }, { status: 401 })

  const von = req.nextUrl.searchParams.get('von')
  const bis = req.nextUrl.searchParams.get('bis')
  if (!von || !bis || !TAG.test(von) || !TAG.test(bis)) return NextResponse.json({ fehler: 'von/bis fehlen (Format JJJJ-MM-TT)' }, { status: 400 })

  const supabase = await createSupabaseServerClient()
  // alle() in ladeUmsatzRechnungen: Detailliste und Summe über alle Rechnungen des Zeitraums, nicht nur die ersten 1.000
  const { data, error } = await ladeUmsatzRechnungen(supabase, tenantId, von, bis)
  if (error) return NextResponse.json({ fehler: dbFehlerText(error, 'Belege konnten nicht geladen werden') }, { status: 500 })

  return NextResponse.json({
    posten: data.map(r => ({
      id: r.id, datum: r.datum, rechnungsnummer: r.rechnungsnummer ?? null, storniert: !!r.storniert, bezahlt: !!r.bezahlt,
      kontakt: r.kontakt ?? null, firma: r.firma ?? null,
      netto: rechnungNetto(r),
      href: `/weinhandel/rechnungen/${r.id}`,
    })),
  })
}
