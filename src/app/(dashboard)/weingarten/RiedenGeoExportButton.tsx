'use client'

// Wegpunkt-Export aller Rieden mit Koordinaten (Stufe 1): GPX (GPS-Geräte,
// Handy-Apps, Traktor-Terminal), KML (Google Earth / My Maps), GeoJSON (QGIS,
// Farmsoftware). Die Datei kommt aus /api/export/rieden-geo.

import { useEffect, useRef, useState } from 'react'
import { MapPin, ChevronDown } from 'lucide-react'

export default function RiedenGeoExportButton({ anzahl }: { anzahl: number }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    window.addEventListener('mousedown', h); return () => window.removeEventListener('mousedown', h)
  }, [open])
  const disabled = anzahl === 0
  return (
    <div className="relative" ref={ref}>
      <button type="button" disabled={disabled} onClick={() => setOpen(o => !o)}
        title={disabled ? 'Noch keine Ried mit Koordinaten' : `${anzahl} Rieden mit Koordinaten exportieren`}
        className="inline-flex items-center gap-1.5 border border-s112-border bg-white text-gray-700 px-3 py-2 rounded-xl text-sm font-medium hover:bg-s112-bg disabled:opacity-40 transition-colors">
        <MapPin size={15} strokeWidth={1.75} className="text-s112-teal" /> Wegpunkte <ChevronDown size={13} />
      </button>
      {open && (
        <div className="absolute right-0 top-11 z-40 w-64 bg-white rounded-xl border border-s112-line shadow-lg p-1.5 text-sm">
          <a href="/api/export/rieden-geo?format=gpx" className="block px-3 py-2 rounded-lg hover:bg-s112-bg" onClick={() => setOpen(false)}>GPX <span className="text-xs text-s112-tertiary">· GPS-Gerät, Handy-App, Terminal</span></a>
          <a href="/api/export/rieden-geo?format=kml" className="block px-3 py-2 rounded-lg hover:bg-s112-bg" onClick={() => setOpen(false)}>KML <span className="text-xs text-s112-tertiary">· Google Earth / My Maps</span></a>
          <a href="/api/export/rieden-geo?format=geojson" className="block px-3 py-2 rounded-lg hover:bg-s112-bg" onClick={() => setOpen(false)}>GeoJSON <span className="text-xs text-s112-tertiary">· QGIS, Farmsoftware</span></a>
        </div>
      )}
    </div>
  )
}
