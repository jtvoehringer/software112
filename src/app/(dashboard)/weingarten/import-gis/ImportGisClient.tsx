'use client'

// ── eAMA-GIS-Import (Client): Shapefile-ZIP im Browser parsen, Vorschau, Übernahme ──
// Die AMA liefert die Polygone in MGI/Austria Lambert; shpjs rechnet mit der
// expliziten Definition (inkl. Datumsverschiebung) nach WGS84 um – ohne sie
// läge alles rund 300 m daneben. Erst die Vorschau zeigt, welche Feldstücke
// welcher Ried zugeordnet werden (über die AMA-Feldstücknummer); übernommen
// wird nur nach Klick auf „Übernehmen“.

import { useState, useTransition } from 'react'
import Link from '@/components/ui/Link'
import { Upload, CheckCircle2, AlertTriangle, MapPin } from 'lucide-react'
import { PROJ_MGI_AUSTRIA_LAMBERT, feldstueckAusFeature, schlagAusFeature, flaecheHa, type EamaFeldstueck, type EamaSchlag } from '@/lib/geo/eama'
import { vorschauEamaGis, uebernehmeEamaGis, type Vorschau } from './actions'
import { fehlerText } from '@/lib/fehler'

type Feature = { properties: Record<string, unknown>; geometry: unknown }

/** Shapefile-ZIP → GeoJSON-Features (WGS84), komplett im Browser */
async function parseShapefileZip(file: File): Promise<Feature[]> {
  const [{ default: JSZip }, shp] = await Promise.all([import('jszip'), import('shpjs')])
  const zip = await JSZip.loadAsync(await file.arrayBuffer())
  const namen = Object.keys(zip.files)
  const shpName = namen.find(n => n.toLowerCase().endsWith('.shp'))
  const dbfName = namen.find(n => n.toLowerCase().endsWith('.dbf'))
  if (!shpName || !dbfName) throw new Error('Im ZIP fehlt die .shp- oder .dbf-Datei – bitte den unveränderten eAMA-Export hochladen.')
  const shpBuf = await zip.file(shpName)!.async('arraybuffer')
  const dbfBuf = await zip.file(dbfName)!.async('arraybuffer')
  // Attribute sind Latin-1 (Umlaute in FSNAME/SORTE)
  const geoms = shp.parseShp(shpBuf, PROJ_MGI_AUSTRIA_LAMBERT)
  const props = shp.parseDbf(dbfBuf, 'ISO-8859-1')
  return shp.combine([geoms, props]).features
}

export default function ImportGisClient() {
  const [feldstuecke, setFeldstuecke] = useState<EamaFeldstueck[] | null>(null)
  const [schlaege, setSchlaege] = useState<EamaSchlag[]>([])
  const [vorschau, setVorschau] = useState<Vorschau | null>(null)
  const [ueberschreiben, setUeberschreiben] = useState(false)
  const [ergebnis, setErgebnis] = useState<{ rieden: number; pins: number; grundstuecke: number } | null>(null)
  const [fehler, setFehler] = useState<string | null>(null)
  const [laden, setLaden] = useState<string | null>(null)
  const [pending, start] = useTransition()

  async function dateiLesen(file: File, typ: 'fs' | 'sl') {
    setFehler(null); setErgebnis(null); setVorschau(null)
    setLaden(typ === 'fs' ? 'Feldstücke werden gelesen …' : 'Schläge werden gelesen …')
    try {
      const features = await parseShapefileZip(file)
      if (typ === 'fs') {
        const fs = features.map(f => feldstueckAusFeature(f.properties, f.geometry)).filter((x): x is EamaFeldstueck => !!x)
        if (!fs.length) throw new Error('Keine Feldstücke erkannt – ist das der Export „beantragte Feldstücke“?')
        // Plausibilität: liegt der erste Punkt in Österreich?
        const p = fs[0].geometrie.type === 'Polygon' ? fs[0].geometrie.coordinates[0][0] : fs[0].geometrie.coordinates[0][0][0]
        if (p[0] < 9 || p[0] > 18 || p[1] < 46 || p[1] > 49.5) throw new Error('Koordinaten liegen außerhalb Österreichs – Projektion der Datei unerwartet.')
        setFeldstuecke(fs)
      } else {
        const sl = features.map(f => schlagAusFeature(f.properties, f.geometry)).filter((x): x is EamaSchlag => !!x)
        if (!sl.length) throw new Error('Keine Schläge erkannt – ist das der Export „beantragte Schläge (flächig)“?')
        setSchlaege(sl)
      }
    } catch (e) {
      setFehler(fehlerText(e))
    } finally { setLaden(null) }
  }

  const vorschauLaden = () => start(async () => {
    if (!feldstuecke) return
    setFehler(null)
    try { setVorschau(await vorschauEamaGis(feldstuecke, schlaege)) }
    catch (e) { setFehler(fehlerText(e)) }
  })
  const uebernehmen = () => start(async () => {
    if (!feldstuecke) return
    setFehler(null)
    const r = await uebernehmeEamaGis(feldstuecke, schlaege, { manuellePinsUeberschreiben: ueberschreiben })
    if (r.fehler) setFehler(r.fehler)
    setErgebnis({ rieden: r.rieden, pins: r.pins, grundstuecke: r.grundstuecke })
  })

  const zugeordnet = vorschau?.zuordnungen.filter(z => z.ried).length ?? 0
  const offen = vorschau?.zuordnungen.filter(z => !z.ried).length ?? 0
  const manuellePins = vorschau?.zuordnungen.filter(z => z.ried?.geoQuelle === 'manuell').length ?? 0

  return (
    <div className="space-y-5 max-w-5xl">
      {/* Schritt 1: Dateien */}
      <div className="card">
        <h2 className="text-base font-semibold text-s112-text mb-1">1. Export-Dateien aus dem INVEKOS-GIS</h2>
        <p className="text-sm text-s112-muted mb-4">eAMA › Flächen › INVEKOS-GIS aufrufen › Extras › GIS-Datenexport › Dateiformat <b>Shapefile</b>. Die ZIP-Dateien unverändert hochladen; das Parsen passiert im Browser, es wird nichts an Dritte gesendet.</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <label className="block border border-dashed border-s112-line-str rounded-xl p-4 hover:border-s112-teal cursor-pointer">
            <span className="flex items-center gap-2 text-sm font-semibold text-s112-text"><Upload size={16} className="text-s112-blue-700" /> Exporttyp „beantragte Feldstücke“ (ZIP) <span className="text-s112-err-fg">*</span></span>
            <span className="block text-xs text-s112-muted mt-1">Ein Polygon je Feldstück → Umriss und Pin der Ried</span>
            <input type="file" accept=".zip" className="mt-2 text-xs" onChange={e => e.target.files?.[0] && dateiLesen(e.target.files[0], 'fs')} />
            {feldstuecke && <span className="block mt-2 text-xs text-s112-ok-fg inline-flex items-center gap-1"><CheckCircle2 size={13} /> {feldstuecke.length} Feldstücke gelesen</span>}
          </label>
          <label className="block border border-dashed border-s112-line-str rounded-xl p-4 hover:border-s112-teal cursor-pointer">
            <span className="flex items-center gap-2 text-sm font-semibold text-s112-text"><Upload size={16} className="text-s112-blue-700" /> Exporttyp „beantragte Schläge (flächig)“ (ZIP)</span>
            <span className="block text-xs text-s112-muted mt-1">Optional: ein Polygon je Schlag/Rebsorte → Umriss der Grundstücke (Schlagnummer)</span>
            <input type="file" accept=".zip" className="mt-2 text-xs" onChange={e => e.target.files?.[0] && dateiLesen(e.target.files[0], 'sl')} />
            {schlaege.length > 0 && <span className="block mt-2 text-xs text-s112-ok-fg inline-flex items-center gap-1"><CheckCircle2 size={13} /> {schlaege.length} Schläge gelesen</span>}
          </label>
        </div>
        {laden && <p className="text-xs text-s112-muted mt-3">{laden}</p>}
        <div className="mt-4 flex items-center gap-3">
          <button type="button" onClick={vorschauLaden} disabled={!feldstuecke || pending} className="btn-primary text-sm py-2">{pending && !vorschau ? 'Prüfe Zuordnung …' : 'Zuordnung prüfen'}</button>
          {feldstuecke && !vorschau && <span className="text-xs text-s112-muted">Es wird noch nichts gespeichert.</span>}
        </div>
      </div>

      {/* Schritt 2: Vorschau */}
      {vorschau && !ergebnis && (
        <div className="card">
          <h2 className="text-base font-semibold text-s112-text mb-1">2. Zuordnung prüfen</h2>
          <p className="text-sm text-s112-muted mb-3">
            {zugeordnet} von {vorschau.zuordnungen.length} Feldstücken einer Ried zugeordnet (über die AMA-Feldstücknummer)
            {offen > 0 && <> · <span className="text-s112-warn-fg">{offen} ohne Ried</span></>}
            {schlaege.length > 0 && <> · {vorschau.zuordnungen.reduce((s, z) => s + z.gstTreffer, 0)} Grundstücke erhalten einen Schlag-Umriss</>}
          </p>
          <div className="overflow-x-auto max-h-[50vh] overflow-y-auto border border-s112-line rounded-lg">
            <table className="w-full text-sm">
              <thead className="bg-s112-bg sticky top-0"><tr>
                <th className="text-left px-3 py-2 font-semibold text-s112-text-1">FS-Nr.</th>
                <th className="text-left px-3 py-2 font-semibold text-s112-text-1">Feldstück (AMA)</th>
                <th className="text-right px-3 py-2 font-semibold text-s112-text-1">ha (AMA)</th>
                <th className="text-right px-3 py-2 font-semibold text-s112-text-1">ha (Umriss)</th>
                <th className="text-left px-3 py-2 font-semibold text-s112-text-1">Ried in software:112</th>
                <th className="text-left px-3 py-2 font-semibold text-s112-text-1">Bisher</th>
                <th className="text-right px-3 py-2 font-semibold text-s112-text-1">Schläge / GST</th>
              </tr></thead>
              <tbody>
                {vorschau.zuordnungen.map(z => {
                  const fs = feldstuecke!.find(f => f.fsnr === z.fsnr)
                  return (
                    <tr key={z.fsnr} className={`border-t border-s112-line ${z.ried ? '' : 'bg-s112-warn-bg/40'}`}>
                      <td className="px-3 py-1.5 font-mono">{z.fsnr}</td>
                      <td className="px-3 py-1.5">{z.fsname}{z.nutzung && z.nutzung !== 'WI' && <span className="ml-1 text-xs text-s112-tertiary">({z.nutzung})</span>}</td>
                      <td className="px-3 py-1.5 text-right font-mono">{z.flaeche_ha != null ? z.flaeche_ha.toFixed(4).replace('.', ',') : '–'}</td>
                      <td className="px-3 py-1.5 text-right font-mono text-s112-tertiary">{fs ? flaecheHa(fs.geometrie).toFixed(4).replace('.', ',') : '–'}</td>
                      <td className="px-3 py-1.5">{z.ried
                        ? <span className="inline-flex items-center gap-1 text-s112-ok-fg"><CheckCircle2 size={13} /> {z.ried.name}</span>
                        : <span className="inline-flex items-center gap-1 text-s112-warn-fg"><AlertTriangle size={13} /> keine Ried mit Feldstücknr. {z.fsnr}</span>}</td>
                      <td className="px-3 py-1.5 text-xs text-s112-muted">{z.ried ? [z.ried.hatUmriss ? 'Umriss' : null, z.ried.hatPin ? `Pin (${z.ried.geoQuelle ?? '?'})` : null].filter(Boolean).join(' · ') || '–' : '–'}</td>
                      <td className="px-3 py-1.5 text-right font-mono">{z.schlaege} / {z.gstTreffer}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {vorschau.riedenOhneFeldstueck.length > 0 && (
            <p className="text-xs text-s112-muted mt-3"><AlertTriangle size={12} className="inline mr-1 text-s112-warn-fg" />
              Rieden ohne Feldstück in der Datei (bleiben unverändert): {vorschau.riedenOhneFeldstueck.map(r => `${r.name}${r.ama_feldnummer ? ` (FS ${r.ama_feldnummer})` : ' (keine FS-Nr.)'}`).join(', ')}
            </p>
          )}
          {vorschau.schlaegeOhneGst.length > 0 && (
            <p className="text-xs text-s112-muted mt-1">Schläge ohne passendes Grundstück (Schlagnr. am GST fehlt): {vorschau.schlaegeOhneGst.slice(0, 12).map(s => `${s.fsnr}/${s.slnr}${s.sorte ? ` ${s.sorte}` : ''}`).join(', ')}{vorschau.schlaegeOhneGst.length > 12 ? ' …' : ''}</p>
          )}
          <div className="mt-4 flex flex-wrap items-center gap-4">
            <label className="inline-flex items-center gap-2 text-sm text-s112-text-1">
              <input type="checkbox" checked={ueberschreiben} onChange={e => setUeberschreiben(e.target.checked)} className="accent-s112-teal" disabled={manuellePins === 0} />
              Manuell gesetzte Pins durch AMA-Mittelpunkt ersetzen{manuellePins > 0 ? ` (${manuellePins})` : ''}
            </label>
            <button type="button" onClick={uebernehmen} disabled={pending || zugeordnet === 0} className="btn-primary text-sm py-2">{pending ? 'Übernehme …' : `${zugeordnet} Rieden übernehmen`}</button>
          </div>
          <p className="text-xs text-s112-tertiary mt-2">Umrisse werden immer übernommen; Pins nur, wenn keiner da ist, er bereits von eAMA stammt oder oben das Ersetzen angehakt ist. Flächen und Stammdaten werden nicht verändert.</p>
        </div>
      )}

      {ergebnis && (
        <div className="card border-s112-ok bg-s112-ok-bg/40">
          <h2 className="text-base font-semibold text-s112-ok-fg inline-flex items-center gap-2"><CheckCircle2 size={18} /> Import abgeschlossen</h2>
          <p className="text-sm text-s112-text-1 mt-1">{ergebnis.rieden} Rieden mit Umriss, {ergebnis.pins} Pins gesetzt, {ergebnis.grundstuecke} Grundstücke mit Schlag-Umriss.</p>
          <div className="mt-3 flex gap-3">
            <Link href="/weingarten" className="btn-primary text-sm py-1.5">Zu den Rieden</Link>
            <Link href="/dashboard/weingarten" className="btn-secondary text-sm py-1.5 inline-flex items-center gap-1.5"><MapPin size={14} /> Rieden-Karte</Link>
          </div>
        </div>
      )}
      {fehler && <p className="text-sm text-s112-err-fg">{fehler}</p>}
    </div>
  )
}
