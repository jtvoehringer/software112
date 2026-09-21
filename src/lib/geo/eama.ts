// ── eAMA / INVEKOS-GIS Import (Stufe 2 Rieden-Koordinaten) ───────────────────
// Reine Hilfsfunktionen ohne Server-Imports – werden im Browser (Parsen des
// Shapefile-ZIP mit shpjs) und in den Server Actions (Zuordnung, Speichern)
// verwendet.
//
// Quelle: INVEKOS-GIS > Extras > GIS-Datenexport > Shapefile
//   "beantragte Feldstücke"        → 1 Polygon je Feldstück (FSNR, FSNAME, FLAECHE)
//   "beantragte Schläge (flächig)" → 1 Polygon je Schlag   (FSNR, SLNR, SORTE, AUSPFLANZD, CODES)
// Koordinatensystem der AMA: MGI / Austria Lambert (EPSG:31287). Die .prj im
// ZIP enthält KEINE Datumsverschiebung (TOWGS84) – ohne sie läge alles ~300 m
// daneben. Deshalb wird beim Parsen explizit diese Definition verwendet.
// Zuordnung: weingarten.ama_feldnummer = FSNR (Ried), grundstuecke.ama_feldnummer = SLNR (Schlag).

import { dezimal } from '@/lib/format'

export const PROJ_MGI_AUSTRIA_LAMBERT =
  '+proj=lcc +lat_1=49 +lat_2=46 +lat_0=47.5 +lon_0=13.33333333333333 +x_0=400000 +y_0=400000 ' +
  '+ellps=bessel +towgs84=577.326,90.129,463.919,5.137,1.474,5.297,2.4232 +units=m +no_defs'

export type GeoPolygon = { type: 'Polygon'; coordinates: number[][][] } | { type: 'MultiPolygon'; coordinates: number[][][][] }

export type EamaFeldstueck = {
  fsnr: number
  fsname: string
  nutzung: string | null      // FNAR_CODE (WI = Weingarten, A = Acker, G = Grünland …)
  flaeche_ha: number | null   // FLAECHE lt. AMA
  geometrie: GeoPolygon
}
export type EamaSchlag = {
  fsnr: number
  slnr: number
  sorte: string | null
  codes: string | null
  auspflanzjahr: number | null
  flaeche_ha: number | null   // FLAECHE_NETTO
  geometrie: GeoPolygon
}

type Props = Record<string, unknown>
const num = (v: unknown): number | null => { const n = typeof v === 'string' ? parseFloat(dezimal(v)) : Number(v); return Number.isFinite(n) ? n : null }
const str = (v: unknown): string | null => { const s = v == null ? '' : String(v).trim(); return s ? s : null }

/** Feature-Properties des Feldstück-Shapefiles → EamaFeldstueck (null, wenn unbrauchbar) */
export function feldstueckAusFeature(props: Props, geometrie: unknown): EamaFeldstueck | null {
  const fsnr = num(props.FSNR); const g = polygonOderNull(geometrie)
  if (fsnr == null || !g) return null
  return { fsnr: Math.round(fsnr), fsname: str(props.FSNAME) ?? `Feldstück ${fsnr}`, nutzung: str(props.FNAR_CODE), flaeche_ha: num(props.FLAECHE), geometrie: g }
}

/** Feature-Properties des Schlag-Shapefiles → EamaSchlag */
export function schlagAusFeature(props: Props, geometrie: unknown): EamaSchlag | null {
  const fsnr = num(props.FSNR), slnr = num(props.SLNR); const g = polygonOderNull(geometrie)
  if (fsnr == null || slnr == null || !g) return null
  // AUSPFLANZD kommt als "01.01.1992" (dBase-Textfeld, in Shapefiles auf 10 Zeichen gekürzt: AUSPFLANZD)
  const datum = str(props.AUSPFLANZD ?? props.AUSPFLANZDATUM)
  const jahr = datum ? parseInt(datum.slice(-4)) : NaN
  return {
    fsnr: Math.round(fsnr), slnr: Math.round(slnr), sorte: str(props.SORTE), codes: str(props.CODES),
    auspflanzjahr: Number.isFinite(jahr) && jahr > 1800 ? jahr : null,
    flaeche_ha: num(props.FLAECHE_NE ?? props.FLAECHE_NETTO) ?? num(props.FLAECHE_BR ?? props.FLAECHE_BRUTTO),
    geometrie: g,
  }
}

export function polygonOderNull(g: unknown): GeoPolygon | null {
  const x = g as { type?: string; coordinates?: unknown } | null
  if (!x || !Array.isArray(x.coordinates)) return null
  if (x.type === 'Polygon') return { type: 'Polygon', coordinates: (x.coordinates as number[][][]).map(r => r.map(c => [round6(c[0]), round6(c[1])])) }
  if (x.type === 'MultiPolygon') return { type: 'MultiPolygon', coordinates: (x.coordinates as number[][][][]).map(p => p.map(r => r.map(c => [round6(c[0]), round6(c[1])]))) }
  return null
}
const round6 = (n: number) => Math.round(n * 1e6) / 1e6

/** Flächenschwerpunkt (Shoelace) des größten Außenrings – als Pin-Position der Ried */
export function zentrum(g: GeoPolygon): { lat: number; lon: number } | null {
  const ringe: number[][][] = g.type === 'Polygon' ? [g.coordinates[0]] : g.coordinates.map(p => p[0])
  let best: { a: number; cx: number; cy: number } | null = null
  for (const ring of ringe) {
    if (!ring || ring.length < 3) continue
    let a = 0, cx = 0, cy = 0
    for (let i = 0; i < ring.length - 1; i++) {
      const [x1, y1] = ring[i], [x2, y2] = ring[i + 1]
      const f = x1 * y2 - x2 * y1
      a += f; cx += (x1 + x2) * f; cy += (y1 + y2) * f
    }
    if (Math.abs(a) < 1e-12) continue
    const A = a / 2
    const c = { a: Math.abs(A), cx: cx / (6 * A), cy: cy / (6 * A) }
    if (!best || c.a > best.a) best = c
  }
  if (!best) {
    // degenerierter Ring: Mittel der Punkte
    const pts = ringe.flat(); if (!pts.length) return null
    return { lat: pts.reduce((s, p) => s + p[1], 0) / pts.length, lon: pts.reduce((s, p) => s + p[0], 0) / pts.length }
  }
  return { lat: round6(best.cy), lon: round6(best.cx) }
}

/** Fläche in ha aus WGS84-Polygon (Näherung über lokale Metrik, für Plausibilitätsanzeige) */
export function flaecheHa(g: GeoPolygon): number {
  const ringe: number[][][] = g.type === 'Polygon' ? [g.coordinates[0]] : g.coordinates.map(p => p[0])
  let total = 0
  for (const ring of ringe) {
    if (!ring || ring.length < 3) continue
    const lat0 = ring[0][1] * Math.PI / 180
    const kx = 111320 * Math.cos(lat0), ky = 110574
    let a = 0
    for (let i = 0; i < ring.length - 1; i++) {
      const x1 = ring[i][0] * kx, y1 = ring[i][1] * ky, x2 = ring[i + 1][0] * kx, y2 = ring[i + 1][1] * ky
      a += x1 * y2 - x2 * y1
    }
    total += Math.abs(a) / 2
  }
  return total / 10000
}
