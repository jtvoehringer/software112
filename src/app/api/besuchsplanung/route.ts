import { createSupabaseServerClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

export async function POST(req: NextRequest) {
  try {
    const { ort_filter, segment, include_leads, include_kunden } = await req.json()
    const supabase = await createSupabaseServerClient()

    // Kontakte laden
    let kq = (supabase.from('kontakte') as any)
      .select('id, kundennummer, vorname, nachname, segment, email, telefon, telefon_vorwahl, mobil, mobil_vorwahl, plz, ort, strasse, land, is_lead, firma:firma_id(name)')
      .eq('aktiv', true)

    if (ort_filter?.trim()) kq = kq.ilike('ort', `%${ort_filter.trim()}%`)
    if (segment) kq = kq.eq('segment', segment)

    // Lead/Kunde-Filter
    if (include_leads && !include_kunden) kq = kq.eq('is_lead', true)
    else if (!include_leads && include_kunden) kq = kq.eq('is_lead', false)
    // beide = kein Filter

    kq = kq.order('plz').order('nachname')
    const { data: kontakteRaw } = await kq
    const kontakte = (kontakteRaw ?? []) as R[]

    // Letzten Kontakt je Person laden
    const ids = kontakte.map(k => k.id)
    let letzteMap: Record<string, string> = {}
    if (ids.length > 0) {
      const { data: akts } = await (supabase.from('aktivitaeten') as any)
        .select('kontakt_id, datum')
        .in('kontakt_id', ids)
        .eq('erledigt', true)
        .order('datum', { ascending: false })
      const seen = new Set<string>()
      ;(akts ?? []).forEach((a: R) => {
        if (!seen.has(a.kontakt_id)) {
          letzteMap[a.kontakt_id] = a.datum
          seen.add(a.kontakt_id)
        }
      })
    }

    // Telefon mit Vorwahl
    const enriched = kontakte.map(k => ({
      ...k,
      telefon: k.telefon ? `${k.telefon_vorwahl ?? '+43'} ${k.telefon}` : null,
      mobil:   k.mobil   ? `${k.mobil_vorwahl   ?? '+43'} ${k.mobil}`   : null,
      telefon_vorwahl: undefined,
      mobil_vorwahl:   undefined,
      firma_name: (k.firma as R | null)?.name ?? null,
      firma: undefined,
      letzter_kontakt: letzteMap[k.id] ?? null,
      tage_seit_kontakt: letzteMap[k.id]
        ? Math.floor((Date.now() - new Date(letzteMap[k.id]).getTime()) / 86400000)
        : null,
    }) as R))

    // Nach PLZ gruppieren
    const cluster: Record<string, typeof enriched> = {}
    enriched.forEach(k => {
      const key = k.plz ?? 'ohne PLZ'
      if (!cluster[key]) cluster[key] = []
      cluster[key].push(k)
    })

    return NextResponse.json({
      kontakte: enriched,
      cluster,
      anzahl: enriched.length,
      plz_count: Object.keys(cluster).length,
    })
  } catch (err) {
    return NextResponse.json({ fehler: String(err) }, { status: 500 })
  }
}
