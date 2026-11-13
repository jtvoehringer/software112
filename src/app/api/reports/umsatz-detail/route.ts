import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentMembership } from '@/lib/auth/roles'
import { NextRequest, NextResponse } from 'next/server'
import { pruefeZweiFaktor } from '@/lib/api/zweiFaktor'
import { ladeUmsatzBelege, umsatzBelegZeile } from '@/lib/verkauf/umsatz'
import { umsatzBasis } from '@/lib/verkauf/umsatzBasis'
import { dbFehlerText } from '@/lib/fehler'
import { leseKonflikt } from '@/lib/api/lesebereich'

const TAG = /^\d{4}-\d{2}-\d{2}$/

// KAN-346/348: Belege eines Monats der Umsatz-Auswertung – dieselben Belege wie die Monatssumme (zentrale
// Umsatzfunktion, netto), je Beleg mit seinem Netto-Umsatz, damit die Belegliste den Monatsbalken ergibt.
// ?basis=rechnung (Standard): Rechnungen nach Rechnungsdatum, Sammelrechnung als eine Zeile, Link zur Rechnungsseite;
// ?basis=lieferung (KAN-105): Lieferscheine nach Lieferdatum, auch nicht berechnete, Link zum Lieferschein.
export async function GET(req: NextRequest) {
  const zweiFaktor = await pruefeZweiFaktor()
  if (zweiFaktor) return zweiFaktor
  const membership = await getCurrentMembership()
  const leseSperre = leseKonflikt(membership, 'verkauf')   // KAN-455: Lesebereich je Profil
  if (leseSperre) return leseSperre
  const tenantId = membership?.tenantId
  if (!tenantId) return NextResponse.json({ fehler: 'Kein Betrieb' }, { status: 401 })

  const von = req.nextUrl.searchParams.get('von')
  const bis = req.nextUrl.searchParams.get('bis')
  if (!von || !bis || !TAG.test(von) || !TAG.test(bis)) return NextResponse.json({ fehler: 'von/bis fehlen (Format JJJJ-MM-TT)' }, { status: 400 })

  const supabase = await createSupabaseServerClient()
  // alle() in ladeUmsatzBelege: Detailliste und Summe über alle Rechnungen des Zeitraums, nicht nur die ersten 1.000
  const basis = umsatzBasis(req.nextUrl.searchParams.get('basis'))
  const { data, error } = await ladeUmsatzBelege(supabase, tenantId, von, bis, basis)
  if (error) return NextResponse.json({ fehler: dbFehlerText(error, 'Belege konnten nicht geladen werden') }, { status: 500 })

  return NextResponse.json({ basis, posten: data.map(r => umsatzBelegZeile(r, basis)) })
}
