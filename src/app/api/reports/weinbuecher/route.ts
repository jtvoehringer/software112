import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentMembership } from '@/lib/auth/roles'
import { NextRequest, NextResponse } from 'next/server'
import { pruefeZweiFaktor } from '@/lib/api/zweiFaktor'
export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

// Weinbuch-Sammlung (Auswertungen, BKI-Prüfung): flache Liste aller Weinausbau-
// Chargen, gefiltert nach Jahrgang / Sorte / Bezeichnung. Bewusst OHNE Einschränkung
// auf aktiv/status – für eine Prüfung müssen auch abgeschlossene Chargen auffindbar
// bleiben, "Bezeichnung" entspricht hier dem Chargennamen (weinausbau.name).
export async function GET(req: NextRequest) {
  const zweiFaktor = await pruefeZweiFaktor()
  if (zweiFaktor) return zweiFaktor
  try {
    const membership = await getCurrentMembership()
    const tenantId = membership?.tenantId
    if (!tenantId) return NextResponse.json({ fehler: 'Kein Betrieb' }, { status: 401 })

    const { searchParams } = new URL(req.url)
    const jahrgang    = searchParams.get('jahrgang')
    const sorte       = searchParams.get('sorte')
    const bezeichnung = searchParams.get('bezeichnung')

    const supabase = await createSupabaseServerClient()

    let query = (supabase.from('weinausbau') as any)
      .select('id, name, jahrgang, rebsorte, qualitaetsstufe, status, menge_liter, behaelter:behaelter_id(name)')
      .eq('tenant_id', tenantId)
      .order('jahrgang', { ascending: false })
      .order('name')

    if (jahrgang)    query = query.eq('jahrgang', jahrgang)
    if (sorte)       query = query.eq('rebsorte', sorte)
    if (bezeichnung) query = query.eq('name', bezeichnung)

    const { data, error } = await query
    if (error) return NextResponse.json({ fehler: error.message }, { status: 500 })

    const chargen = ((data ?? []) as R[]).map(w => ({
      id: w.id,
      name: w.name,
      jahrgang: w.jahrgang,
      rebsorte: w.rebsorte,
      qualitaetsstufe: w.qualitaetsstufe,
      status: w.status,
      menge_liter: w.menge_liter,
      behaelter: (w.behaelter as R | null)?.name ?? null,
    }))

    return NextResponse.json({ chargen, anzahl: chargen.length })
  } catch (err) {
    return NextResponse.json({ fehler: String(err) }, { status: 500 })
  }
}
