'use client'

// KAN-398: Tankmischung – weitere Pflanzenschutzmittel in derselben Spritzbrühe. Je Zeile Mittel, Aufwandmenge und
// Einheit; Spritzbrühe, Wasseraufwand, Datum, Rieden und alle übrigen Angaben gelten wie beim ersten Mittel. Beim
// Speichern entsteht je Mittel eine Maßnahme (gemeinsame tankmischung_id, lib/behandlungen/tankmischung.ts).
// Felder: weitere_psm_id, weitere_aufwandmenge, weitere_aufwandmenge_einheit (wiederholt, Server Action).

import { Plus, X, Hourglass, Ban } from 'lucide-react'
import { AUFWAND_EINHEITEN } from '@/lib/behandlungen/massnahmeMengen'
import { WEITERE_FELDER, WEITERE_MITTEL_MAX } from '@/lib/behandlungen/tankmischung'
import { aufwandEinheitText } from './mengenFelder'
import type { PSM } from './page'

export type WeiteresMittelZeile = { key: number; psmId: string; aufwand: string; einheit: string }

const feld = 'w-full border border-s112-border rounded-lg px-3 py-2.5 sm:py-2 text-base sm:text-sm focus:outline-hidden focus:ring-2 focus:ring-s112-teal/40'

export default function WeitereMittel({
  psm, erstesPsmId, zeilen, onZeilen, bioSperre,
}: {
  psm: PSM[]
  /** das erste Mittel der Mischung (Feld „Spritzmittel / Mittel“) – nicht noch einmal wählbar */
  erstesPsmId: string
  zeilen: WeiteresMittelZeile[]
  onZeilen: (z: WeiteresMittelZeile[]) => void
  /** Bio-Status Bio-EU/biodynamisch: nicht öko-zugelassene Mittel sperren */
  bioSperre: boolean
}) {
  const aendern = (key: number, teil: Partial<WeiteresMittelZeile>) => onZeilen(zeilen.map(z => (z.key === key ? { ...z, ...teil } : z)))
  const dazu = () => onZeilen([...zeilen, { key: Math.max(0, ...zeilen.map(z => z.key)) + 1, psmId: '', aufwand: '', einheit: 'kg_ha' }])
  return (
    <div className="space-y-2">
      {zeilen.map((z, i) => {
        const nr = i + 2
        const mittel = psm.find(p => p.id === z.psmId)
        const gesperrt = bioSperre && mittel?.oeko_zugelassen === false
        return (
          <fieldset key={z.key} className="rounded-lg border border-s112-border p-3 space-y-2">
            <legend className="px-1 text-sm font-medium text-s112-text-1">Mittel {nr} der Tankmischung</legend>
            <div className="grid grid-cols-1 sm:grid-cols-[1fr_8rem_8rem_auto] gap-2 items-end">
              <div>
                <label className="block text-xs text-s112-muted mb-1">Mittel</label>
                <select aria-label={`Mittel ${nr} der Tankmischung`} name={WEITERE_FELDER.psm} value={z.psmId} required
                  aria-invalid={gesperrt || undefined}
                  onChange={e => aendern(z.key, { psmId: e.target.value })} className={feld}>
                  <option value="">– Auswählen –</option>
                  {psm.filter(p => p.id === z.psmId || (p.id !== erstesPsmId && !zeilen.some(o => o.psmId === p.id))).map(p => (
                    <option key={p.id} value={p.id}>
                      {p.name}{p.handelsname ? ` (${p.handelsname})` : ''}{p.oeko_zugelassen ? ' · Bio' : ''}{p.cu_gehalt_pct ? ` · Cu ${p.cu_gehalt_pct}%` : ''}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-s112-muted mb-1">Aufwandmenge</label>
                <input aria-label={`Aufwandmenge Mittel ${nr}`} name={WEITERE_FELDER.aufwand} type="text" inputMode="decimal" required
                  placeholder="z.B. 0,6" value={z.aufwand} onChange={e => aendern(z.key, { aufwand: e.target.value })} className={feld} />
              </div>
              <div>
                <label className="block text-xs text-s112-muted mb-1">Einheit</label>
                <select aria-label={`Einheit Mittel ${nr}`} name={WEITERE_FELDER.einheit} value={z.einheit}
                  onChange={e => aendern(z.key, { einheit: e.target.value })} className={feld}>
                  {AUFWAND_EINHEITEN.map(e => <option key={e} value={e}>{aufwandEinheitText(e, AUFWAND_EINHEITEN)}</option>)}
                </select>
              </div>
              <button type="button" onClick={() => onZeilen(zeilen.filter(o => o.key !== z.key))}
                aria-label={`Mittel ${nr} entfernen`} title="Entfernen"
                className="h-10 w-10 inline-flex items-center justify-center rounded-lg border border-s112-border text-s112-muted hover:text-s112-err hover:border-s112-err/50">
                <X size={16} aria-hidden />
              </button>
            </div>
            {mittel?.wartezeit_tage != null && (
              <p className="text-xs text-s112-warn-fg inline-flex items-center gap-1"><Hourglass size={12} />Wartezeit: {mittel.wartezeit_tage} Tage vor Ernte</p>
            )}
            {gesperrt && (
              <p role="alert" className="text-xs text-s112-err-fg inline-flex items-center gap-1">
                <Ban size={12} aria-hidden />Nicht öko-zugelassen – passt nicht zum Bio-Status des Betriebs.
              </p>
            )}
          </fieldset>
        )
      })}
      {zeilen.length < WEITERE_MITTEL_MAX && (
        <button type="button" onClick={dazu}
          className="inline-flex items-center gap-1.5 text-sm text-s112-blue-700 hover:underline">
          <Plus size={14} aria-hidden />weiteres Mittel (Tankmischung)
        </button>
      )}
      {zeilen.length > 0 && (
        <p className="text-xs text-s112-muted">
          Alle Mittel kommen in dieselbe Spritzbrühe. Gespeichert wird je Mittel eine Maßnahme – Lager, Kupfer-Bilanz und
          Pflanzenschutz-Aufzeichnung rechnen je Mittel mit seiner Aufwandmenge.
        </p>
      )}
    </div>
  )
}
