import { createSupabaseServerClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { getTenantId } from '@/lib/api/auth'
export const dynamic = 'force-dynamic'
type R = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

const SEGMENT_MAP: Record<string, string> = {
  'privat': 'privat', 'private': 'privat',
  'gastro': 'gastro', 'gastronomie': 'gastro',
  'handel': 'handel', 'trade': 'handel',
  'export': 'export',
  'grosshandel': 'grosshandel', 'großhandel': 'grosshandel', 'wholesale': 'grosshandel',
}

function mapVal(row: R, csvKey: string | undefined, transform?: (v: string) => unknown): unknown {
  if (!csvKey) return undefined
  const raw = (row[csvKey] ?? '').toString().trim()
  if (!raw) return null
  return transform ? transform(raw) : raw
}

export async function POST(req: NextRequest) {
  try {
    const { typ, rows, mapping } = await req.json() as {
      typ: 'kontakte' | 'firmen' | 'fuellungen'
      rows: R[]
      mapping: Record<string, string>
    }

    const supabase = await createSupabaseServerClient()
    const tenantId = await getTenantId(supabase)
    if (!tenantId) return NextResponse.json({ fehler: 'Nicht autorisiert' }, { status: 401 })

    // Nur tenant_admin darf importieren
    const { data: { user } } = await supabase.auth.getUser()
    const { data: membership } = await (supabase.from('tenant_memberships') as any)
      .select('rolle').eq('tenant_id', tenantId).eq('user_id', user?.id ?? '').maybeSingle()
    if (!['tenant_admin', 'winzer'].includes((membership as R | null)?.rolle ?? ''))
      return NextResponse.json({ fehler: 'Keine Berechtigung' }, { status: 403 })

    let ok = 0
    const details: string[] = []

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]
      try {
        if (typ === 'kontakte') {
          const nachname = mapVal(row, mapping.nachname)
          if (!nachname) { details.push(`Zeile ${i+2}: Nachname fehlt – übersprungen`); continue }
          const segment = SEGMENT_MAP[(mapVal(row, mapping.segment) as string)?.toLowerCase() ?? ''] ?? 'privat'
          const { error } = await (supabase.from('kontakte') as any).insert({
            tenant_id: tenantId,
            vorname:   mapVal(row, mapping.vorname) ?? null,
            nachname,
            email:     mapVal(row, mapping.email) ?? null,
            telefon:   mapVal(row, mapping.telefon) ?? null,
            mobil:     mapVal(row, mapping.mobil) ?? null,
            strasse:   mapVal(row, mapping.strasse) ?? null,
            plz:       mapVal(row, mapping.plz) ?? null,
            ort:       mapVal(row, mapping.ort) ?? null,
            land:      mapVal(row, mapping.land) || 'AT',
            segment,
            notizen:   mapVal(row, mapping.notizen) ?? null,
            aktiv: true, stammkunde: false, newsletter: false,
            newsletter_bestaetigt: false, is_lead: true,
          })
          if (error) { details.push(`Zeile ${i+2}: ${error.message}`); continue }

        } else if (typ === 'firmen') {
          const name = mapVal(row, mapping.name)
          if (!name) { details.push(`Zeile ${i+2}: Name fehlt – übersprungen`); continue }
          const segment = SEGMENT_MAP[(mapVal(row, mapping.segment) as string)?.toLowerCase() ?? ''] ?? 'gastro'
          const { error } = await (supabase.from('firmen') as any).insert({
            tenant_id: tenantId,
            name,
            email:              mapVal(row, mapping.email) ?? null,
            telefon:            mapVal(row, mapping.telefon) ?? null,
            strasse:            mapVal(row, mapping.strasse) ?? null,
            plz:                mapVal(row, mapping.plz) ?? null,
            ort:                mapVal(row, mapping.ort) ?? null,
            land:               mapVal(row, mapping.land) || 'AT',
            segment,
            uid_nummer:         mapVal(row, mapping.uid_nummer) ?? null,
            zahlungsziel_tage:  mapVal(row, mapping.zahlungsziel_tage, v => parseInt(v) || null) ?? null,
            notizen:            mapVal(row, mapping.notizen) ?? null,
            aktiv: true, is_lead: true,
          })
          if (error) { details.push(`Zeile ${i+2}: ${error.message}`); continue }

        } else if (typ === 'fuellungen') {
          const bezeichnung = mapVal(row, mapping.bezeichnung)
          if (!bezeichnung) { details.push(`Zeile ${i+2}: Bezeichnung fehlt – übersprungen`); continue }
          const { error } = await (supabase.from('fuellungen') as any).insert({
            tenant_id:          tenantId,
            bezeichnung,
            jahrgang:           mapVal(row, mapping.jahrgang, v => parseInt(v) || null) ?? null,
            rebsorte:           mapVal(row, mapping.rebsorte) ?? null,
            flaschengroesse_ml: mapVal(row, mapping.flaschengroesse_ml, v => parseInt(v) || 750) ?? 750,
            lagerbestand_fl:    mapVal(row, mapping.lagerbestand_fl, v => parseInt(v) || 0) ?? 0,
            vk_preis_brutto:    mapVal(row, mapping.vk_preis_brutto, v => parseFloat(v.replace(',','.')) || null) ?? null,
            einkaufspreis:      mapVal(row, mapping.einkaufspreis, v => parseFloat(v.replace(',','.')) || null) ?? null,
            notizen:            mapVal(row, mapping.notizen) ?? null,
            aktiv: true,
          })
          if (error) { details.push(`Zeile ${i+2}: ${error.message}`); continue }
        }
        ok++
      } catch (err) {
        details.push(`Zeile ${i+2}: ${String(err)}`)
      }
    }

    return NextResponse.json({ ok, fehler: rows.length - ok, details })
  } catch (err) {
    return NextResponse.json({ fehler: String(err) }, { status: 500 })
  }
}
