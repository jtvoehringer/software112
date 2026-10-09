// ── Geo-Hilfsfunktionen für Rieden (ohne Abhängigkeiten, server- und client-tauglich) ──
// Koordinaten immer WGS84 (lat/lon in Dezimalgrad), wie sie Google Maps, GPS-
// Geräte und eAMA (nach Umrechnung) verwenden.

import { dezimal } from '@/lib/format'
import { rund } from '@/lib/zahl/runden'

export type RiedPunkt = {
  id: string
  name: string
  lat: number
  lon: number
  rebsorte?: string | null
  flaeche_ha?: number | null
  ama_feldnummer?: string | null
}

/** Koordinate als "48,123456, 16,123456" (österreichisch) */
export function fmtKoord(lat: number, lon: number, digits = 5) {
  return `${lat.toFixed(digits).replace('.', ',')}, ${lon.toFixed(digits).replace('.', ',')}`
}

/** Google-Maps-Link: öffnet den Punkt, am Handy mit Option "Route" */
export function googleMapsUrl(lat: number, lon: number) {
  return `https://www.google.com/maps/search/?api=1&query=${lat.toFixed(6)},${lon.toFixed(6)}`
}
/** Direkt Navigation starten (Google Maps, am iPhone auch Apple Karten über den universellen Link) */
export function navigationUrl(lat: number, lon: number) {
  return `https://www.google.com/maps/dir/?api=1&destination=${lat.toFixed(6)},${lon.toFixed(6)}&travelmode=driving`
}

/** Plausibilitätsprüfung für Österreich (grob) – verhindert vertauschte lat/lon */
export function inOesterreich(lat: number, lon: number) {
  return lat >= 46 && lat <= 49.2 && lon >= 9.3 && lon <= 17.3
}

export function parseKoordinaten(text: string): { lat: number; lon: number } | null {
  // akzeptiert "48.12345, 16.54321", "48,12345; 16,54321", "48.12345 16.54321"
  const t = text.trim().replace(/\s+/g, ' ')
  const m = t.match(/^(-?\d{1,2}(?:[.,]\d+)?)\s*[,; ]\s*(-?\d{1,3}(?:[.,]\d+)?)$/)
  if (!m) return null
  // Bei Komma als Dezimaltrennzeichen: "48,12345, 16,54321" → erst Trennzeichen erkennen
  const lat = parseFloat(dezimal(m[1]))
  const lon = parseFloat(dezimal(m[2]))
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null
  return { lat, lon }
}

const xml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

function beschreibung(p: RiedPunkt) {
  return [p.rebsorte, p.flaeche_ha != null ? `${p.flaeche_ha.toFixed(2).replace('.', ',')} ha` : null, p.ama_feldnummer ? `AMA-FS ${p.ama_feldnummer}` : null]
    .filter(Boolean).join(' · ')
}

/** GPX 1.1 – Wegpunkte (Garmin, Handy-Apps, Traktor-Terminals) */
export function buildGpx(punkte: RiedPunkt[], betrieb: string) {
  const wpts = punkte.map(p =>
    `  <wpt lat="${p.lat.toFixed(6)}" lon="${p.lon.toFixed(6)}">\n    <name>${xml(p.name)}</name>\n    <desc>${xml(beschreibung(p))}</desc>\n    <sym>Flag, Green</sym>\n  </wpt>`).join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="software:112" xmlns="http://www.topografix.com/GPX/1/1">\n  <metadata><name>${xml(betrieb)} – Rieden</name><time>${new Date().toISOString()}</time></metadata>\n${wpts}\n</gpx>\n`
}

/** KML – Google Earth / Google My Maps; Polygone, sofern vorhanden (Stufe 2) */
export function buildKml(punkte: (RiedPunkt & { geometrie?: unknown })[], betrieb: string) {
  const pm = punkte.map(p => {
    const poly = kmlPolygon(p.geometrie)
    return `    <Placemark>\n      <name>${xml(p.name)}</name>\n      <description>${xml(beschreibung(p))}</description>\n      ${poly ? `<MultiGeometry><Point><coordinates>${p.lon.toFixed(6)},${p.lat.toFixed(6)},0</coordinates></Point>${poly}</MultiGeometry>` : `<Point><coordinates>${p.lon.toFixed(6)},${p.lat.toFixed(6)},0</coordinates></Point>`}\n    </Placemark>`
  }).join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2">\n  <Document>\n    <name>${xml(betrieb)} – Rieden</name>\n${pm}\n  </Document>\n</kml>\n`
}

function kmlPolygon(geometrie: unknown): string | null {
  const g = geometrie as { type?: string; coordinates?: number[][][] | number[][][][] } | null
  if (!g || !g.type || !g.coordinates) return null
  let rings: number[][][] = []
  if (g.type === 'Polygon') rings = [(g.coordinates as number[][][])[0]]
  else if (g.type === 'MultiPolygon') rings = (g.coordinates as number[][][][]).map(p => p[0])
  rings = rings.filter(Boolean)
  if (!rings.length) return null
  return rings.map(r => `<Polygon><outerBoundaryIs><LinearRing><coordinates>${r.map(c => `${c[0]},${c[1]},0`).join(' ')}</coordinates></LinearRing></outerBoundaryIs></Polygon>`).join('')
}

/** GeoJSON FeatureCollection – Farmsoftware, QGIS, Stufe-2-Roundtrip */
export function buildGeoJson(punkte: (RiedPunkt & { geometrie?: unknown })[]) {
  return {
    type: 'FeatureCollection',
    features: punkte.map(p => ({
      type: 'Feature',
      properties: { id: p.id, name: p.name, rebsorte: p.rebsorte ?? null, flaeche_ha: p.flaeche_ha ?? null, ama_feldnummer: p.ama_feldnummer ?? null },
      geometry: p.geometrie ?? { type: 'Point', coordinates: [rund(p.lon, 6), rund(p.lat, 6)] },
    })),
  }
}
