'use client'

// ── Prüfdialog vor dem Import von Kontakten und Firmen (KAN-484, 18.11.2026) ─────────────────────────────────────────
//
// Zeigt nach „Prüfen“, was importiert wird (neu), was übersprungen wird (Pflichtname fehlt, Dublette) und wo Angaben
// fehlen. Das Segment lässt sich je Zeile oder für alle Zeilen ohne erkanntes Segment nachtragen; alles andere ist nur
// Hinweis. Bis „Importieren“ ist nichts gespeichert.

import { useMemo, useState } from 'react'
import { useDialog } from '@/components/ui/useDialog'
import { SEGMENTE } from '@/lib/crm/types'
import { hatFehlendeAngaben, zusammenfassung, type ZeilenPruefung } from '@/lib/crm/importPruefung'

const ANZEIGE_MAX = 200

export default function ImportPruefDialog({ typ, zeilen, onAbbrechen, onImportieren }: {
  typ: 'kontakte' | 'firmen'
  zeilen: ZeilenPruefung[]
  onAbbrechen: () => void
  /** Index der Zeile in der Datei → gewähltes Segment (nur geänderte Zeilen) */
  onImportieren: (segmente: Map<number, string>) => void
}) {
  const dialog = useDialog(true, onAbbrechen, typ === 'kontakte' ? 'Kontakte vor dem Import prüfen' : 'Firmen vor dem Import prüfen')
  const summe = useMemo(() => zusammenfassung(zeilen), [zeilen])
  const [nurFehlend, setNurFehlend] = useState(summe.mitFehlendenAngaben > 0)
  const [segmente, setSegmente] = useState<Map<number, string>>(() => new Map())
  const [fuerAlle, setFuerAlle] = useState('')

  const ohneSegment = zeilen.filter(z => z.status === 'neu' && (z.segment.status === 'fehlt' || z.segment.status === 'unbekannt'))
  const sichtbar = nurFehlend ? zeilen.filter(z => hatFehlendeAngaben(z) || z.status !== 'neu') : zeilen
  const segmentVon = (z: ZeilenPruefung) => segmente.get(z.index) ?? z.segment.wert

  function setzeSegment(index: number, wert: string) {
    setSegmente(m => new Map(m).set(index, wert))
  }
  function fuerAlleSetzen() {
    if (!fuerAlle) return
    setSegmente(m => {
      const neu = new Map(m)
      for (const z of ohneSegment) neu.set(z.index, fuerAlle)
      return neu
    })
  }

  const was = typ === 'kontakte' ? (summe.neu === 1 ? 'Kontakt' : 'Kontakte') : (summe.neu === 1 ? 'Firma' : 'Firmen')

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div {...dialog} className="bg-white rounded-xl shadow-2xl w-full max-w-4xl max-h-[calc(100dvh-2rem)] flex flex-col">
        <div className="px-6 pt-5 pb-3 border-b border-s112-border">
          <h2 className="text-lg font-semibold text-s112-text">{typ === 'kontakte' ? 'Kontakte' : 'Firmen'} vor dem Import prüfen</h2>
          <p className="text-sm text-s112-text-2 mt-1" role="status">
            <strong>{summe.neu}</strong> neu · {summe.dubletten} {summe.dubletten === 1 ? 'Dublette' : 'Dubletten'} · {summe.uebersprungen} übersprungen
            · <strong>{summe.mitFehlendenAngaben}</strong> mit fehlenden Angaben
          </p>
          <p className="text-xs text-s112-muted mt-1">Noch ist nichts gespeichert. Dubletten und Zeilen ohne Pflichtnamen werden nicht angelegt.</p>
        </div>

        <div className="px-6 py-3 flex flex-wrap items-center gap-3 border-b border-s112-border text-sm">
          <label className="inline-flex items-center gap-2">
            <input type="checkbox" checked={nurFehlend} onChange={e => setNurFehlend(e.target.checked)} />
            Nur Zeilen mit fehlenden Angaben oder ohne Import
          </label>
          {ohneSegment.length > 0 && (
            <span className="inline-flex items-center gap-2 ml-auto">
              <label htmlFor="import-segment-alle" className="text-s112-text-1">Segment für alle {ohneSegment.length} ohne Segment:</label>
              <select id="import-segment-alle" value={fuerAlle} onChange={e => setFuerAlle(e.target.value)}
                className="border border-s112-border rounded-lg px-2 py-1 text-sm">
                <option value="">– wählen –</option>
                {SEGMENTE.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
              <button type="button" onClick={fuerAlleSetzen} disabled={!fuerAlle}
                className="px-3 py-1 rounded-lg border border-s112-border hover:bg-s112-bg disabled:opacity-40">
                Übernehmen
              </button>
            </span>
          )}
        </div>

        <div className="overflow-y-auto flex-1 px-6 py-3">
          {sichtbar.length === 0 ? (
            <p className="text-sm text-s112-muted py-6 text-center">Keine fehlenden Angaben – alle Zeilen sind vollständig.</p>
          ) : (
            <table className="w-full text-sm border-collapse">
              <thead className="text-xs text-s112-text-2 text-left">
                <tr>
                  <th scope="col" className="py-1 pr-3 font-medium">Zeile</th>
                  <th scope="col" className="py-1 pr-3 font-medium">Name</th>
                  <th scope="col" className="py-1 pr-3 font-medium">Status</th>
                  <th scope="col" className="py-1 pr-3 font-medium">Segment</th>
                  <th scope="col" className="py-1 font-medium">Hinweise</th>
                </tr>
              </thead>
              <tbody>
                {sichtbar.slice(0, ANZEIGE_MAX).map(z => (
                  <tr key={z.index} className="border-t border-s112-border align-top">
                    <td className="py-1.5 pr-3 tabular-nums text-s112-text-2">{z.zeile}</td>
                    <td className="py-1.5 pr-3">{z.name || '–'}{z.email && <span className="block text-xs text-s112-muted">{z.email}</span>}</td>
                    <td className="py-1.5 pr-3 whitespace-nowrap">
                      {z.status === 'neu' ? 'neu' : z.status === 'dublette' ? `Dublette (${z.grund})` : `übersprungen (${z.grund})`}
                    </td>
                    <td className="py-1.5 pr-3">
                      {z.status === 'neu' ? (
                        <select aria-label={`Segment Zeile ${z.zeile}`} value={segmentVon(z)} onChange={e => setzeSegment(z.index, e.target.value)}
                          className={`border rounded-lg px-2 py-1 text-sm ${segmente.has(z.index) || z.segment.status === 'ok' ? 'border-s112-border' : 'border-s112-warn'}`}>
                          {SEGMENTE.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                        </select>
                      ) : '–'}
                    </td>
                    <td className="py-1.5 text-xs text-s112-text-2">
                      {z.hinweise.filter(h => !segmente.has(z.index) || !h.startsWith('Segment')).join(' · ') || (z.status === 'neu' ? '–' : '')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {sichtbar.length > ANZEIGE_MAX && (
            <p className="text-xs text-s112-muted mt-2">… und {sichtbar.length - ANZEIGE_MAX} weitere Zeilen – „Segment für alle“ gilt auch für diese.</p>
          )}
        </div>

        <div className="px-6 py-4 border-t border-s112-border flex justify-end gap-3">
          <button type="button" onClick={onAbbrechen} className="px-4 py-2 rounded-xl text-sm border border-s112-border hover:bg-s112-bg">
            Abbrechen
          </button>
          <button type="button" onClick={() => onImportieren(segmente)} disabled={summe.neu === 0}
            className="bg-s112-teal text-s112-yellow px-5 py-2 rounded-xl text-sm font-semibold hover:bg-s112-teal/90 disabled:opacity-40">
            {summe.neu} {was} importieren
          </button>
        </div>
      </div>
    </div>
  )
}
