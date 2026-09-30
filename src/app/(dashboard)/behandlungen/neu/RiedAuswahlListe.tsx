'use client'

// Ried-Auswahl mit GST-Feinauswahl – gemeinsam für „Neue Maßnahme“ und „Maßnahme bearbeiten“ (30.09.2026: Rieden beim
// Bearbeiten änderbar). Gruppen wie die Ernte (lib/wein/riedAuswahl.ts): Lage mit genau einer Ried als eine Zeile; ist
// eine ganze Ried gewählt, sind alle ihre WI-GST angehakt (so rechnet auch der Server), ein Klick auf ein GST nimmt nur
// dieses heraus.

import { Fragment, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import type { WeingartenOption, GSTOption } from './page'
import { riedGruppen, istEinzelRied, weingartenZusatz } from './absenden'
import { fmtNum } from '@/lib/format'

function fmtHa(n: number) {
  return `${fmtNum(n, { max: 4 })} ha`
}

export default function RiedAuswahlListe({
  weingaerten, gstByWeingarten, selectedWGs, setSelectedWGs, selectedGSTs, setSelectedGSTs, riedHinweis, riedMeldung,
}: {
  weingaerten: WeingartenOption[]
  gstByWeingarten: Record<string, GSTOption[]>
  selectedWGs: Set<string>
  setSelectedWGs: Dispatch<SetStateAction<Set<string>>>
  selectedGSTs: Map<string, string>
  setSelectedGSTs: Dispatch<SetStateAction<Map<string, string>>>
  riedHinweis: boolean
  riedMeldung: string | undefined
}) {
  const [expandedWGs, setExpandedWGs] = useState<Set<string>>(new Set())
  const lagen = riedGruppen(weingaerten)

  function toggleExpand(wgId: string) {
    setExpandedWGs(prev => { const n = new Set(prev); n.has(wgId) ? n.delete(wgId) : n.add(wgId); return n })
  }

  function toggleWG(id: string, spritzbar: boolean) {
    if (!spritzbar) return
    // Ried komplett auswählen ersetzt eine etwaige Einzel-GST-Auswahl dieser Ried
    setSelectedGSTs(prev => {
      const n = new Map(prev)
      for (const [gId, wId] of n) { if (wId === id) n.delete(gId) }
      return n
    })
    setSelectedWGs(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function toggleGST(gstId: string, wgId: string) {
    // Bug 30.09.2026 (Gebeshuber): Ist die ganze Ried gewählt, sind alle ihre WI-GST angehakt. Ein Klick auf ein
    // GST nimmt nur dieses heraus – die Ried wird zur Einzelauswahl aller übrigen GST (bisher war danach gar
    // nichts mehr gewählt bzw. die GST standen trotz Ried-Auswahl leer da).
    const riedGewaehlt = selectedWGs.has(wgId)
    const wasSelected = riedGewaehlt || selectedGSTs.has(gstId)
    setSelectedWGs(prev => { const n = new Set(prev); n.delete(wgId); return n })
    setSelectedGSTs(prev => {
      const n = new Map(prev)
      if (riedGewaehlt) for (const g of gstByWeingarten[wgId] ?? []) n.set(g.id, wgId)
      wasSelected ? n.delete(gstId) : n.set(gstId, wgId)
      return n
    })
  }

  function toggleLage(wgs: WeingartenOption[]) {
    const spritzbare = wgs.filter(w => w.spritzbar).map(w => w.id)
    const allSelected = spritzbare.length > 0 && spritzbare.every(id => selectedWGs.has(id))
    setSelectedGSTs(prev => {
      const n = new Map(prev)
      for (const [gId, wId] of n) { if (spritzbare.includes(wId)) n.delete(gId) }
      return n
    })
    setSelectedWGs(prev => {
      const next = new Set(prev)
      if (allSelected) {
        spritzbare.forEach(id => next.delete(id))
      } else {
        spritzbare.forEach(id => next.add(id))
      }
      return next
    })
  }

  return (
        <div className="space-y-3">
          {lagen.map((gruppe) => {
            const { schluessel, name: lageName, weingaerten: wgs } = gruppe
            // Bug 30.09.2026 / wie die Ernte (KAN-160): Lage mit genau einer Ried (bei Gebeshuber der Regelfall,
            // gleicher Name) als EINE Zeile statt Lage-Kopf und Ried darunter
            const einzelRied = istEinzelRied(gruppe)
            const spritzbare = wgs.filter(w => w.spritzbar)
            const allSelected = spritzbare.length > 0 && spritzbare.every(w => selectedWGs.has(w.id))
            const someSelected = spritzbare.some(w => selectedWGs.has(w.id) || [...selectedGSTs.values()].includes(w.id))
            const lageHa = spritzbare.reduce((s, w) => {
              if (selectedWGs.has(w.id)) return s + w.gst_ha_aktiv
              const gsts = gstByWeingarten[w.id] ?? []
              return s + gsts.filter(g => selectedGSTs.has(g.id)).reduce((s2, g) => s2 + (g.flaeche_ha ?? 0), 0)
            }, 0)

            return (
              <div key={schluessel} className="border border-s112-border rounded-xl overflow-hidden">
                {/* Lage-Header (nicht bei einer Lage mit nur einer Ried) */}
                {!einzelRied && <div
                  className="flex items-center gap-3 px-3 py-2 bg-s112-bg cursor-pointer hover:bg-s112-bg/80 transition-colors"
                  onClick={() => toggleLage(wgs)}
                >
                  <input
                    type="checkbox"
                    readOnly
                    aria-label={`${lageName}: alle spritzbaren auswählen`}
                    aria-invalid={riedHinweis || undefined} aria-describedby={riedMeldung}
                    checked={allSelected}
                    ref={el => { if (el) el.indeterminate = someSelected && !allSelected }}
                    className="accent-s112-teal"
                  />
                  <span className="text-sm font-semibold text-s112-text">{lageName}</span>
                  <span className="text-xs text-s112-muted">{spritzbare.length} spritzbar</span>
                  {lageHa > 0 && (
                    <span className="ml-auto text-xs text-s112-blue-700">{fmtHa(lageHa)}</span>
                  )}
                </div>}
                {/* Rieden mit GST-Feinauswahl */}
                <div className="divide-y divide-s112-border/40">
                  {wgs.map(w => {
                    const gsts = gstByWeingarten[w.id] ?? []
                    const isExpanded = expandedWGs.has(w.id)
                    const wgSel = selectedWGs.has(w.id)
                    const gstSelCount = gsts.filter(g => selectedGSTs.has(g.id)).length
                    const someGstSel = gstSelCount > 0
                    const allGstSel = gsts.length > 0 && gstSelCount === gsts.length
                    const isActive = wgSel || someGstSel

                    return (
                      <div key={w.id} className={!w.spritzbar ? 'bg-s112-bg' : ''}>
                        <div className={`flex items-center gap-3 px-4 py-2 text-sm transition-colors
                          ${w.spritzbar ? 'hover:bg-s112-bg/40' : 'opacity-40'}`}>
                          <input
                            type="checkbox"
                            aria-label={w.name}
                            aria-invalid={riedHinweis || undefined} aria-describedby={riedMeldung}
                            checked={wgSel || allGstSel}
                            ref={el => { if (el) el.indeterminate = someGstSel && !allGstSel && !wgSel }}
                            onChange={() => toggleWG(w.id, w.spritzbar)}
                            disabled={!w.spritzbar}
                            className="accent-s112-teal cursor-pointer"
                          />
                          {gsts.length > 0 ? (
                            <button type="button" onClick={() => toggleExpand(w.id)}
                              className="flex items-center gap-1.5 flex-1 text-left"
                              disabled={!w.spritzbar}>
                              <svg className={`w-3 h-3 text-s112-muted transition-transform shrink-0 ${isExpanded ? 'rotate-90' : ''}`}
                                fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                              </svg>
                              <span className={`font-medium ${isActive ? 'text-s112-blue-700' : 'text-s112-text'}`}>
                                {einzelRied ? lageName : w.name}
                                {einzelRied && weingartenZusatz(lageName, w.name) && <span className="font-normal text-s112-text-1"> · {w.name}</span>}
                              </span>
                              <span className="text-xs text-s112-muted">{gsts.length} GST</span>
                              {w.gst_ha_aktiv > 0 && (
                                <span className="text-xs text-s112-muted ml-auto">{fmtHa(w.gst_ha_aktiv)}</span>
                              )}
                            </button>
                          ) : (
                            <span className={`font-medium flex-1 ${isActive ? 'text-s112-blue-700' : 'text-s112-text'}`}>
                              {einzelRied ? lageName : w.name}
                              {einzelRied && weingartenZusatz(lageName, w.name) && <span className="font-normal text-s112-text-1"> · {w.name}</span>}
                            </span>
                          )}
                          {!w.spritzbar && (
                            <span className="text-xs bg-[#F2F3F5] text-s112-text-2 px-1.5 py-0.5 rounded-full">
                              Brache / Gerodet
                            </span>
                          )}
                        </div>
                        {isExpanded && gsts.length > 0 && w.spritzbar && (
                          <div className="bg-white border-t border-s112-border/20">
                            {gsts.map(g => {
                              // ganze Ried gewählt = alle ihre WI-GST gewählt (so rechnet auch der Server)
                              const isGstSel = wgSel || selectedGSTs.has(g.id)
                              return (
                                <Fragment key={g.id}>
                                  <label className={`flex items-center gap-2 pl-10 pr-4 py-1.5 text-xs cursor-pointer hover:bg-s112-bg/30 ${isGstSel ? 'bg-s112-teal/5' : ''}`}>
                                    <input type="checkbox"
                                      aria-invalid={riedHinweis || undefined} aria-describedby={riedMeldung}
                                      checked={isGstSel}
                                      onChange={() => toggleGST(g.id, w.id)}
                                      className="accent-s112-teal" />
                                    <span className={`font-mono ${isGstSel ? 'text-s112-blue-700 font-medium' : 'text-s112-text-2'}`}>
                                      GST {g.gst_nr}
                                    </span>
                                    {g.rebsorte && <span className="text-s112-muted">· {g.rebsorte}</span>}
                                    {g.flaeche_ha != null && <span className="text-s112-muted ml-auto">{fmtHa(g.flaeche_ha)}</span>}
                                  </label>
                                </Fragment>
                              )
                            })}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
  )
}
