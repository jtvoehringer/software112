'use client'

// ── Karte "Lage & Koordinaten" in der Ried-Detailseite (Stufe 1) ─────────────
// Pin setzen per Klick auf die Karte, per Eingabe ("48,05123, 16,28456") oder
// über den Standort des Handys; speichern schreibt den Pin auf ALLE
// weingarten-Zeilen derselben Ried (Riedenebene, siehe actions.ts).

import { useState, useTransition } from 'react'
import { MapPin, Navigation, LocateFixed, Trash2, Download } from 'lucide-react'
import RiedKarte, { type KartenUmriss } from './RiedKarte'
import { fmtKoord, googleMapsUrl, navigationUrl, parseKoordinaten, inOesterreich } from '@/lib/geo/rieden'
import { speichereRiedGeo, loescheRiedGeo } from '@/app/(dashboard)/weingarten/actions'

export default function RiedGeoPanel({
  weingartenId, name, lat, lon, geometrie, weitere = [], geoQuelle, geoStand, writeOk,
}: {
  weingartenId: string; name: string
  lat: number | null; lon: number | null; geometrie: unknown
  /** Schlag-/Grundstücks-Umrisse der Ried (aus dem eAMA-Import) */
  weitere?: KartenUmriss[]
  geoQuelle: string | null; geoStand: string | null; writeOk: boolean
}) {
  const [pending, start] = useTransition()
  const [pos, setPos] = useState<{ lat: number; lon: number } | null>(lat != null && lon != null ? { lat, lon } : null)
  const [eingabe, setEingabe] = useState(pos ? fmtKoord(pos.lat, pos.lon, 6) : '')
  const [dirty, setDirty] = useState(false)
  const [meldung, setMeldung] = useState<{ text: string; fehler?: boolean } | null>(null)

  const setzen = (p: { lat: number; lon: number }) => {
    setPos(p); setEingabe(fmtKoord(p.lat, p.lon, 6)); setDirty(true); setMeldung(null)
  }

  const uebernehmen = () => {
    const p = parseKoordinaten(eingabe)
    if (!p) { setMeldung({ text: 'Format: Breite, Länge – z.B. 48,05123, 16,28456', fehler: true }); return }
    setzen(p)
  }

  const standort = () => {
    if (!navigator.geolocation) { setMeldung({ text: 'Standort ist auf diesem Gerät nicht verfügbar.', fehler: true }); return }
    setMeldung({ text: 'Standort wird ermittelt …' })
    navigator.geolocation.getCurrentPosition(
      g => { setzen({ lat: g.coords.latitude, lon: g.coords.longitude }); setMeldung({ text: `Standort übernommen (±${Math.round(g.coords.accuracy)} m)` }) },
      () => setMeldung({ text: 'Standort konnte nicht ermittelt werden (Berechtigung?).', fehler: true }),
      { enableHighAccuracy: true, timeout: 15000 },
    )
  }

  const speichern = () => start(async () => {
    if (!pos) return
    const r = await speichereRiedGeo(weingartenId, pos.lat, pos.lon)
    if (r?.error) setMeldung({ text: r.error, fehler: true })
    else { setDirty(false); setMeldung({ text: r?.anzahl && r.anzahl > 1 ? `Gespeichert – für alle ${r.anzahl} Weingärten dieser Ried.` : 'Gespeichert.' }) }
  })
  const loeschen = () => start(async () => {
    if (!confirm('Koordinaten dieser Ried entfernen?')) return
    const r = await loescheRiedGeo(weingartenId)
    if (r?.error) setMeldung({ text: r.error, fehler: true })
    else { setPos(null); setEingabe(''); setDirty(false); setMeldung({ text: 'Koordinaten entfernt.' }) }
  })

  const warnung = pos && !inOesterreich(pos.lat, pos.lon) ? 'Punkt liegt außerhalb Österreichs – Breite und Länge vertauscht?' : null

  return (
    <div className="card">
      <div className="flex items-start justify-between gap-3 flex-wrap mb-3">
        <div>
          <h2 className="text-base font-semibold text-s112-text flex items-center gap-2"><MapPin size={16} strokeWidth={1.75} className="text-s112-blue-700" /> Lage &amp; Koordinaten</h2>
          <p className="text-xs text-s112-muted mt-0.5">
            {pos
              ? <>Mittelpunkt {fmtKoord(pos.lat, pos.lon)}{geoQuelle ? ` · Quelle: ${geoQuelle}` : ''}{geoStand ? ` · Stand ${new Date(geoStand).toLocaleDateString('de-AT')}` : ''}</>
              : 'Noch keine Koordinaten – Pin auf der Karte setzen, Koordinaten eintragen oder Standort übernehmen.'}
          </p>
        </div>
        {pos && !dirty && (
          <div className="flex items-center gap-2 flex-wrap">
            <a href={googleMapsUrl(pos.lat, pos.lon)} target="_blank" rel="noopener" className="btn-secondary text-xs py-1.5 inline-flex items-center gap-1.5"><MapPin size={13} /> Google Maps</a>
            <a href={navigationUrl(pos.lat, pos.lon)} target="_blank" rel="noopener" className="btn-secondary text-xs py-1.5 inline-flex items-center gap-1.5"><Navigation size={13} /> Navigation</a>
            <a href={`/api/export/rieden-geo?format=gpx&id=${weingartenId}`} className="btn-secondary text-xs py-1.5 inline-flex items-center gap-1.5" title="Wegpunkt als GPX"><Download size={13} /> GPX</a>
            <a href={`/api/export/rieden-geo?format=kml&id=${weingartenId}`} className="btn-secondary text-xs py-1.5 inline-flex items-center gap-1.5" title="Für Google Earth / My Maps"><Download size={13} /> KML</a>
          </div>
        )}
      </div>

      <RiedKarte
        pins={pos ? [{ id: weingartenId, name, lat: pos.lat, lon: pos.lon }] : []}
        geometrie={geometrie}
        weitere={weitere}
        editable={writeOk}
        onPick={writeOk ? (la, lo) => setzen({ lat: la, lon: lo }) : undefined}
        height={340}
      />

      {writeOk && (
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <label className="block flex-1 min-w-[240px]">
            <span className="block text-xs font-medium text-s112-text-2 mb-1">Koordinaten (Breite, Länge – WGS84)</span>
            <input value={eingabe} onChange={e => setEingabe(e.target.value)} onBlur={() => eingabe.trim() && uebernehmen()}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); uebernehmen() } }}
              placeholder="48,05123, 16,28456" className="form-input font-mono text-sm" />
          </label>
          <button type="button" onClick={standort} className="btn-secondary text-xs py-2 inline-flex items-center gap-1.5" title="Standort dieses Geräts übernehmen"><LocateFixed size={14} /> Aktueller Standort</button>
          <button type="button" onClick={speichern} disabled={!pos || !dirty || pending} className="btn-primary text-xs py-2">{pending ? 'Speichern …' : 'Speichern'}</button>
          {pos && (lat != null) && (
            <button type="button" onClick={loeschen} disabled={pending} className="text-xs text-s112-tertiary hover:text-s112-err-fg inline-flex items-center gap-1 py-2" title="Koordinaten entfernen"><Trash2 size={13} /> entfernen</button>
          )}
        </div>
      )}
      {(meldung || warnung) && (
        <p className={`text-xs mt-2 ${meldung?.fehler || warnung ? 'text-s112-err-fg' : 'text-s112-ok-fg'}`}>{warnung ?? meldung?.text}</p>
      )}
      <p className="text-[11px] text-s112-tertiary mt-2">Umriss und Mittelpunkt kommen aus dem eAMA-GIS-Import (Rieden › eAMA-GIS importieren) oder werden hier manuell gesetzt. Gestrichelt: Schlag-Umrisse der Grundstücke.</p>
    </div>
  )
}
