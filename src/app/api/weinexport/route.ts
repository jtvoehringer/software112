import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'
export const dynamic = 'force-dynamic'
type R = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

const STANDARD_DOKUMENTE = ['v1v2','eur1','lieferschein','rechnung']

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const supabase = await createSupabaseServerClient()
    const admin    = createSupabaseAdminClient()

    // Referenznummer generieren
    const { data: refData } = await (admin.rpc as any)('get_next_exportnummer', { p_tenant_id: body.tenant_id })
    const referenz = refData ?? null

    const { data: auftrag, error } = await (supabase.from('exportauftraege') as any).insert({
      tenant_id:         body.tenant_id,
      kontakt_id:        body.kontakt_id,
      firma_id:          body.firma_id,
      referenz,
      datum:             body.datum,
      lieferdatum:       body.lieferdatum,
      incoterms:         body.incoterms,
      transport_art:     body.transport_art,
      destination_land:  body.destination_land,
      destination_stadt: body.destination_stadt,
      eori_kunde:        body.eori_kunde,
      versicherungswert: body.versicherungswert,
      notizen:           body.notizen,
      status:            'entwurf',
    }).select().single()

    if (error) return NextResponse.json({ fehler: error.message }, { status: 500 })
    const id = (auftrag as R).id

    // Positionen
    if (body.positionen?.length > 0) {
      const posen = body.positionen.map((p: R, i: number) => ({
        exportauftrag_id: id,
        fullung_id:    p.fullung_id || null,
        beschreibung:  p.beschreibung || null,
        menge:         parseFloat(p.menge) || 0,
        einheit:       p.einheit ?? 'Fl',
        preis_eur:     parseFloat(p.preis_eur) || 0,
        taric_code:    p.taric_code ?? '2204.21',
        sort_order:    i,
      }))
      await (supabase.from('exportauftrag_positionen') as any).insert(posen)
    }

    // Standard-Dokumente anlegen
    await (supabase.from('export_dokumente') as any).insert(
      STANDARD_DOKUMENTE.map(art => ({ exportauftrag_id: id, dokument_art: art, status: 'ausstehend' }))
    )

    return NextResponse.json({ ok: true, id })
  } catch (err) {
    return NextResponse.json({ fehler: String(err) }, { status: 500 })
  }
}
