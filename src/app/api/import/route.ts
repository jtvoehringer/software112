import { createSupabaseServerClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
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
      typ: 'kontakte' | 'firmen' | 'fuellungen' | 'rieden' | 'rieden_details' | 'grundstuecke' | 'gebinde'
      rows: R[]
      mapping: Record<string, string>
    }

    const supabase = await createSupabaseServerClient()
    const { data: _mb } = await (supabase.from('tenant_memberships') as any).select('tenant_id').limit(1).single()
    const tenantId = (_mb as R | null)?.tenant_id
    if (!tenantId) return NextResponse.json({ fehler: 'Nicht autorisiert' }, { status: 401 })

    // Nur tenant_admin darf importieren
    const { data: { user } } = await supabase.auth.getUser()
    const { data: membership } = await (supabase.from('tenant_memberships') as any)
      .select('role').eq('tenant_id', tenantId).eq('user_id', user?.id ?? '').maybeSingle()
    if (!['tenant_admin', 'winzer'].includes((membership as R | null)?.role ?? ''))
      return NextResponse.json({ fehler: 'Keine Berechtigung' }, { status: 403 })

    let ok = 0
    const details: string[] = []

    // Caches für "Rieden (Details)" (Ried-Name → lagen.id, legt bei Bedarf neu an)
    // und "Grundstücke" (Weingarten-Name → weingarten.id), damit derselbe Name
    // innerhalb eines Imports nicht mehrfach abgefragt/angelegt wird.
    const lageCache: Map<string, string> = new Map()
    const weingartenCache: Map<string, string> = new Map()

    async function findOrCreateLageId(name: string): Promise<string> {
      const key = name.trim().toLowerCase()
      const cached = lageCache.get(key)
      if (cached) return cached
      const { data: bestehend } = await (supabase.from('lagen') as any)
        .select('id').eq('tenant_id', tenantId).ilike('name', name.trim()).maybeSingle()
      if ((bestehend as R | null)?.id) {
        lageCache.set(key, (bestehend as R).id)
        return (bestehend as R).id
      }
      const { data: neu, error } = await (supabase.from('lagen') as any)
        .insert({ tenant_id: tenantId, name: name.trim() })
        .select('id').single()
      if (error) throw new Error(`Ried "${name}" konnte nicht angelegt werden: ${error.message}`)
      lageCache.set(key, (neu as R).id)
      return (neu as R).id
    }

    async function findWeingartenId(name: string): Promise<string | null> {
      const key = name.trim().toLowerCase()
      const cached = weingartenCache.get(key)
      if (cached) return cached
      const { data } = await (supabase.from('weingarten') as any)
        .select('id').eq('tenant_id', tenantId).ilike('name', name.trim()).maybeSingle()
      const id = (data as R | null)?.id ?? null
      if (id) weingartenCache.set(key, id)
      return id
    }

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
            bestand_flaschen:   mapVal(row, mapping.lagerbestand_fl, v => parseInt(v) || 0) ?? 0,
            vk_preis_brutto:    mapVal(row, mapping.vk_preis_brutto, v => parseFloat(v.replace(',','.')) || null) ?? null,
            einstandspreis:     mapVal(row, mapping.einkaufspreis, v => parseFloat(v.replace(',','.')) || null) ?? null,
            notizen:            mapVal(row, mapping.notizen) ?? null,
            aktiv: true,
          })
          if (error) { details.push(`Zeile ${i+2}: ${error.message}`); continue }

        } else if (typ === 'rieden') {
          const name = mapVal(row, mapping.name)
          if (!name) { details.push(`Zeile ${i+2}: Bezeichnung fehlt – übersprungen`); continue }
          const { error } = await (supabase.from('weingarten') as any).insert({
            tenant_id: tenantId,
            name,
            notizen:   mapVal(row, mapping.notizen) ?? null,
            aktiv: true,
          })
          if (error) { details.push(`Zeile ${i+2}: ${error.message}`); continue }

        } else if (typ === 'rieden_details') {
          const name = mapVal(row, mapping.name)
          if (!name) { details.push(`Zeile ${i+2}: Bezeichnung fehlt – übersprungen`); continue }
          const riedName = mapVal(row, mapping.ried) as string | null
          let lageId: string | null = null
          let riedText: string | null = null
          if (riedName) {
            lageId = await findOrCreateLageId(riedName)
            riedText = riedName.trim()
          }
          const { error } = await (supabase.from('weingarten') as any).insert({
            tenant_id:  tenantId,
            name,
            lage_id:    lageId,
            ried:       riedText,
            rebsorte:   mapVal(row, mapping.rebsorte) ?? null,
            pflanzjahr: mapVal(row, mapping.pflanzjahr, v => parseInt(v) || null) ?? null,
            weinart:    (mapVal(row, mapping.weinart) as string) || 'unbekannt',
            flaeche_ha: mapVal(row, mapping.flaeche_ha, v => parseFloat(v.replace(',', '.')) || null) ?? null,
            aktiv: true,
          })
          if (error) { details.push(`Zeile ${i+2}: ${error.message}`); continue }

        } else if (typ === 'grundstuecke') {
          const gstNr = mapVal(row, mapping.gst_nr)
          if (!gstNr) { details.push(`Zeile ${i+2}: GST-Nummer fehlt – übersprungen`); continue }
          const riedFlaeche = mapVal(row, mapping.ried_flaeche) as string | null
          if (!riedFlaeche) { details.push(`Zeile ${i+2}: Ried-Zuordnung fehlt – übersprungen`); continue }
          const weingartenId = await findWeingartenId(riedFlaeche)
          if (!weingartenId) {
            details.push(`Zeile ${i+2}: Ried "${riedFlaeche}" nicht gefunden (zuerst über Tab "Rieden (Details)" anlegen) – übersprungen`)
            continue
          }
          const { error } = await (supabase.from('grundstuecke') as any).insert({
            tenant_id:            tenantId,
            weingarten_id:        weingartenId,
            gst_nr:               gstNr,
            katastralgemeinde:    mapVal(row, mapping.katastralgemeinde) ?? null,
            flaeche_ha:           mapVal(row, mapping.flaeche_ha, v => parseFloat(v.replace(',', '.')) || null) ?? null,
            flaeche_ha_kataster:  mapVal(row, mapping.flaeche_ha_kataster, v => parseFloat(v.replace(',', '.')) || null) ?? null,
            rebsorte:             mapVal(row, mapping.rebsorte) ?? null,
            bewirtschaftung:      mapVal(row, mapping.bewirtschaftung) ?? null,
            status:               (mapVal(row, mapping.status) as string) || 'aktiv',
          })
          if (error) { details.push(`Zeile ${i+2}: ${error.message}`); continue }

        } else if (typ === 'gebinde') {
          const name = mapVal(row, mapping.name)
          if (!name) { details.push(`Zeile ${i+2}: Bezeichnung fehlt – übersprungen`); continue }
          const { error } = await (supabase.from('behaelter') as any).insert({
            tenant_id:     tenantId,
            name,
            typ:           mapVal(row, mapping.typ) ?? null,
            volumen_liter: mapVal(row, mapping.volumen_liter, v => parseFloat(v.replace(',', '.')) || null) ?? null,
            standort:      mapVal(row, mapping.standort) ?? null,
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
