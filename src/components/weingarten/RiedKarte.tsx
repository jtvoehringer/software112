'use client'

// ── Leaflet-Karte für Rieden (Stufe 1 Rieden-Koordinaten, 27.8.2026) ─────────
// Hintergrund: basemap.at (Orthofoto + Grau, frei nutzbar, Nennung Pflicht).
// Zwei Betriebsarten: ein Pin (Ried-Detail, optional per Klick verschiebbar)
// oder viele Pins (Rieden-Übersicht/Dashboard). Leaflet wird erst im Browser
// geladen (kein SSR) – deshalb dynamischer Import in useEffect.

import { useEffect, useLayoutEffect, useRef } from 'react'
import type { Map as LeafletMap, LayerGroup } from 'leaflet'
import 'leaflet/dist/leaflet.css'

export type KartenPin = { id: string; name: string; lat: number; lon: number; sub?: string; href?: string }

const ORTHO = 'https://mapsneu.wien.gv.at/basemap/bmaporthofoto30cm/normal/google3857/{z}/{y}/{x}.jpeg'
const GRAU  = 'https://mapsneu.wien.gv.at/basemap/bmapgrau/normal/google3857/{z}/{y}/{x}.png'
const ATTR  = 'Grundkarte: <a href="https://basemap.at" target="_blank" rel="noopener">basemap.at</a>'
// Standardausschnitt, wenn noch keine Koordinaten da sind: Thermenregion / Gumpoldskirchen
const START: [number, number] = [48.05, 16.28]

export type KartenUmriss = { name: string; geometrie: unknown }

export default function RiedKarte({
  pins, geometrie, weitere = [], editable = false, onPick, height = 320, zoom,
}: {
  pins: KartenPin[]
  /** GeoJSON-Geometrie (Polygon/MultiPolygon) – wird gezeichnet, wenn vorhanden (Stufe 2) */
  geometrie?: unknown
  /** Weitere Umrisse (z.B. Schläge/Grundstücke der Ried), gestrichelt mit Tooltip */
  weitere?: KartenUmriss[]
  /** Klick auf die Karte setzt den Pin neu (nur Einzelpin-Modus) */
  editable?: boolean
  onPick?: (lat: number, lon: number) => void
  height?: number
  zoom?: number
}) {
  const ref = useRef<HTMLDivElement>(null)
  const mapRef = useRef<LeafletMap | null>(null)
  const layerRef = useRef<LayerGroup | null>(null)
  const onPickRef = useRef(onPick)
  // Zeichnen mit den Daten des LETZTEN Renders: Beide Effekte warten erst auf import('leaflet') – ohne Ref
  // zeichnete der Aufbau mit dem ersten Stand, wenn sich Pins/Umriss währenddessen geändert hatten.
  const zeichnenRef = useRef<(L: typeof import('leaflet')) => void>(() => {})

  // Karte einmalig aufbauen
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const L = (await import('leaflet')).default
      if (cancelled || !ref.current || mapRef.current) return
      const map = L.map(ref.current, { center: START, zoom: zoom ?? 12, scrollWheelZoom: false })
      map.attributionControl.setPrefix('Leaflet')
      const ortho = L.tileLayer(ORTHO, { attribution: ATTR, maxZoom: 19 })
      const grau  = L.tileLayer(GRAU,  { attribution: ATTR, maxZoom: 19 })
      ortho.addTo(map)
      L.control.layers({ 'Luftbild': ortho, 'Karte': grau }, undefined, { position: 'topright' }).addTo(map)
      L.control.scale({ imperial: false }).addTo(map)
      map.on('click', e => { if (onPickRef.current) onPickRef.current(e.latlng.lat, e.latlng.lng) })
      mapRef.current = map
      layerRef.current = L.layerGroup().addTo(map)
      zeichnenRef.current(L)
    })()
    return () => { cancelled = true; mapRef.current?.remove(); mapRef.current = null; layerRef.current = null }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Pins/Geometrie neu zeichnen, wenn sich die Daten ändern
  useEffect(() => {
    ;(async () => {
      if (!mapRef.current) return
      const L = (await import('leaflet')).default
      zeichnenRef.current(L)
    })()
  }, [pins, geometrie, weitere, editable])

  function zeichnen(L: typeof import('leaflet')) {
    const map = mapRef.current, layer = layerRef.current
    if (!map || !layer) return
    layer.clearLayers()
    const bounds = L.latLngBounds([])
    if (geometrie && typeof geometrie === 'object') {
      try {
        const gj = L.geoJSON(geometrie as GeoJSON.GeoJsonObject, { style: { color: '#4F86D6', weight: 2, fillColor: '#77A6E7', fillOpacity: 0.25 } })
        gj.addTo(layer); bounds.extend(gj.getBounds())
      } catch { /* ungültige Geometrie ignorieren */ }
    }
    for (const u of weitere) {
      if (!u.geometrie || typeof u.geometrie !== 'object') continue
      try {
        const gj = L.geoJSON(u.geometrie as GeoJSON.GeoJsonObject, { style: { color: '#2F63AC', weight: 1.5, dashArray: '4 3', fillColor: '#4F86D6', fillOpacity: 0.08 } })
        gj.bindTooltip(u.name, { sticky: true }); gj.addTo(layer); bounds.extend(gj.getBounds())
      } catch { /* ungültige Geometrie ignorieren */ }
    }
    for (const p of pins) {
      const icon = L.divIcon({
        className: '',
        html: `<div style="width:14px;height:14px;border-radius:50%;background:#4F86D6;border:2px solid #fff;box-shadow:0 0 0 2px rgba(14,60,98,.35)"></div>`,
        iconSize: [14, 14], iconAnchor: [7, 7],
      })
      const m = L.marker([p.lat, p.lon], { icon, title: p.name }).addTo(layer)
      const sub = p.sub ? `<br><span style="color:#6E717A;font-size:11px">${p.sub}</span>` : ''
      const link = p.href ? `<br><a href="${p.href}" style="font-size:11px">Ried öffnen →</a>` : ''
      m.bindPopup(`<b style="font-size:13px">${p.name}</b>${sub}${link}`)
      if (pins.length > 1) m.bindTooltip(p.name, { direction: 'top', offset: [0, -8] })
      bounds.extend([p.lat, p.lon])
    }
    if (bounds.isValid()) {
      if (pins.length === 1 && !geometrie) map.setView(bounds.getCenter(), zoom ?? 16)
      else map.fitBounds(bounds.pad(0.2), { maxZoom: zoom ?? 17 })
    }
  }
  // nach jedem Commit (vor den Effekten oben) – nicht beim Rendern schreiben
  useLayoutEffect(() => { onPickRef.current = onPick; zeichnenRef.current = zeichnen })

  return (
    <div className="relative">
      <div ref={ref} style={{ height }} className={`w-full rounded-xl overflow-hidden border border-s112-line z-0 ${editable ? 'cursor-crosshair' : ''}`} />
      {editable && <p className="absolute left-2 bottom-2 z-400 bg-white/90 rounded-sm px-2 py-0.5 text-[11px] text-s112-text-2">Auf die Karte klicken setzt den Pin</p>}
    </div>
  )
}
