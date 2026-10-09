import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentMembership } from '@/lib/auth/roles'
import { alle } from '@/lib/supabase/alle'
import { buildGpx, buildKml, buildGeoJson, type RiedPunkt } from '@/lib/geo/rieden'
import { pruefeZweiFaktor } from '@/lib/api/zweiFaktor'
import { heuteWien } from '@/lib/datum/wien'

export const dynamic = 'force-dynamic'
type R = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

// ── Wegpunkt-/Geometrie-Export der Rieden (Stufe 1) ──────────────────────────
// ?format=gpx|kml|geojson  (&id=<weingarten_id> für eine einzelne Ried)
// Riedenebene: je Ried (lage_id bzw. ried-Text) ein Wegpunkt, nicht je
// weingarten-Zeile – sonst stünde dieselbe Ried mehrfach im GPS-Gerät.
// Rechte (KAN-54): jedes Mitglied des Betriebs – wie die Rieden-Seiten, von denen
// aus der Export verlinkt ist; kein zuschaltbares Modul.

export async function GET(req: NextRequest) {
  const zweiFaktor = await pruefeZweiFaktor()
  if (zweiFaktor) return zweiFaktor
  const membership = await getCurrentMembership()
  const tenantId = membership?.tenantId
  if (!tenantId) return NextResponse.json({ fehler: 'Kein Betrieb' }, { status: 401 })

  const format = (req.nextUrl.searchParams.get('format') ?? 'gpx').toLowerCase()
  const id = req.nextUrl.searchParams.get('id')
  const supabase = await createSupabaseServerClient()

  let q = (supabase.from('weingarten') as any)
    .select('id, name, ried, lage_id, rebsorte, flaeche_ha, ama_feldnummer, zentrum_lat, zentrum_lon, geometrie, aktiv')
    .eq('tenant_id', tenantId).not('zentrum_lat', 'is', null).not('zentrum_lon', 'is', null).order('name').order('id')
  if (id) q = q.eq('id', id)
  const { data, error } = await alle<R>(q)
  if (error) return NextResponse.json({ fehler: 'Export fehlgeschlagen' }, { status: 500 })
  // einzelabfrage-ohne-fehler: nur der Anzeigename im Dateikopf, sonst „software:112“
  const { data: t } = await (supabase.from('tenant_einstellungen') as any).select('anzeigename').eq('tenant_id', tenantId).maybeSingle()
  const betrieb = (t as R | null)?.anzeigename ?? 'software:112'

  // Je Ried nur ein Eintrag (erste Zeile je lage_id/ried), Rebsorten zusammenfassen
  const gruppen = new Map<string, R[]>()
  for (const w of (data ?? []) as R[]) {
    if (w.aktiv === false) continue
    const key = w.lage_id ? `l:${w.lage_id}` : w.ried ? `r:${w.ried}` : `w:${w.id}`
    const arr = gruppen.get(key) ?? []; arr.push(w); gruppen.set(key, arr)
  }
  const punkte: (RiedPunkt & { geometrie?: unknown })[] = Array.from(gruppen.values()).map(rows => {
    const w = rows[0]
    const rebsorten = Array.from(new Set(rows.map(r => r.rebsorte).filter(Boolean))).join(', ')
    const ha = rows.reduce((s, r) => s + (Number(r.flaeche_ha) || 0), 0)
    return {
      id: w.id, name: (w.ried ?? w.name) as string, lat: Number(w.zentrum_lat), lon: Number(w.zentrum_lon),
      rebsorte: rebsorten || null, flaeche_ha: ha > 0 ? ha : null, ama_feldnummer: rows.find(r => r.ama_feldnummer)?.ama_feldnummer ?? null,
      geometrie: rows.find(r => r.geometrie)?.geometrie ?? undefined,
    }
  })

  const datum = heuteWien()
  const name = `rieden_${datum}`
  if (format === 'kml') {
    return new NextResponse(buildKml(punkte, betrieb), { headers: { 'Content-Type': 'application/vnd.google-earth.kml+xml; charset=utf-8', 'Content-Disposition': `attachment; filename="${name}.kml"`, 'Cache-Control': 'no-store' } })
  }
  if (format === 'geojson' || format === 'json') {
    return new NextResponse(JSON.stringify(buildGeoJson(punkte), null, 2), { headers: { 'Content-Type': 'application/geo+json; charset=utf-8', 'Content-Disposition': `attachment; filename="${name}.geojson"`, 'Cache-Control': 'no-store' } })
  }
  return new NextResponse(buildGpx(punkte, betrieb), { headers: { 'Content-Type': 'application/gpx+xml; charset=utf-8', 'Content-Disposition': `attachment; filename="${name}.gpx"`, 'Cache-Control': 'no-store' } })
}
