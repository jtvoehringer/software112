import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'
import { getCurrentMembership, canWrite } from '@/lib/auth/roles'
import { ereignisMelden } from '@/lib/system/ereignis'
import { pruefeZweiFaktor } from '@/lib/api/zweiFaktor'
import { schreibSperreKonflikt } from '@/lib/auth/sperren'
import { seitenBetriebKonflikt } from '@/lib/auth/seitenBetrieb'
export const dynamic = 'force-dynamic'
type R = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

const STANDARD_DOKUMENTE = ['v1v2','eur1','lieferschein','rechnung']

export async function POST(req: NextRequest) {
  const zweiFaktor = await pruefeZweiFaktor()
  if (zweiFaktor) return zweiFaktor
  try {
    const body = await req.json()
    const supabase = await createSupabaseServerClient()
    const admin    = createSupabaseAdminClient()
    // Nur tenant_admin und winzer dürfen Exportaufträge anlegen
    const { data: { user: authUser } } = await supabase.auth.getUser()
    if (!authUser) return NextResponse.json({ fehler: 'Nicht angemeldet' }, { status: 401 })

    // tenant_id + Rolle IMMER aus aktivem Tenant (Cookie) – niemals aus Request-Body
    // oder einer beliebigen Membership (Sicherheit)
    const membership = await getCurrentMembership()
    const tenantId = membership?.tenantId
    if (!tenantId) return NextResponse.json({ fehler: 'Nicht autorisiert' }, { status: 401 })
    // KAN-30: Formular aus einem veralteten Tab (anderer Betrieb)? Sonst Exportnummer aus dem
    // Nummernkreis des neuen Betriebs mit Kontakten/Füllungen des alten
    const konflikt = await seitenBetriebKonflikt(tenantId)
    if (konflikt) return konflikt
    const gesperrt = await schreibSperreKonflikt(membership)   // KAN-5: Nur-Lesen-Modus bei gesperrtem Abo
    if (gesperrt) return gesperrt
    if (!canWrite(membership, 'warenwirtschaft'))   // Admin-Client umgeht RLS → Modulrecht hier prüfen
      return NextResponse.json({ fehler: 'Keine Berechtigung' }, { status: 403 })

    // Referenznummer generieren
    const { data: refData } = await (admin.rpc as any)('get_next_exportnummer', { p_tenant_id: tenantId })
    const referenz = refData ?? null

    const { data: auftrag, error } = await (supabase.from('exportauftraege') as any).insert({
      tenant_id:         tenantId,
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
      { const { error: e } = await (supabase.from('exportauftrag_positionen') as any).insert(posen)
        if (e) void ereignisMelden({ art: 'db', quelle: 'weinexport/exportauftrag_positionen', meldung: e.message }) }
    }

    // Standard-Dokumente anlegen
    { const { error: e } = await (supabase.from('export_dokumente') as any).insert(
      STANDARD_DOKUMENTE.map(art => ({ exportauftrag_id: id, dokument_art: art, status: 'ausstehend' }))
    )
      if (e) void ereignisMelden({ art: 'db', quelle: 'weinexport/export_dokumente', meldung: e.message }) }

    return NextResponse.json({ ok: true, id })
  } catch (err) {
    return NextResponse.json({ fehler: String(err) }, { status: 500 })
  }
}
