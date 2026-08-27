// Typdeklaration für shpjs (liefert keine eigenen Typen). Nur die drei
// Funktionen, die der eAMA-GIS-Import nutzt (ImportGisClient.tsx).
declare module 'shpjs' {
  /** .shp-Bytes → GeoJSON-Geometrien; proj = proj4-Definition oder WKT der Quellprojektion (Ziel WGS84) */
  export function parseShp(buffer: ArrayBuffer | Uint8Array | DataView, proj?: string): unknown[]
  /** .dbf-Bytes → Attribut-Objekte; cpg = Zeichensatz (z.B. 'ISO-8859-1') */
  export function parseDbf(buffer: ArrayBuffer | Uint8Array | DataView, cpg?: string): Record<string, unknown>[]
  export function combine(parts: [unknown[], Record<string, unknown>[]]): {
    type: 'FeatureCollection'
    features: { type: 'Feature'; geometry: unknown; properties: Record<string, unknown> }[]
  }
}
