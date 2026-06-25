'use client'

import React, { useState, useTransition } from 'react'
import { upsertErnteParzelle, deleteErnteParzelle, createOrUpdateAMAMeldung, createMultipleErnteParzellen } from '../actions'
import { qualitaetLabel, QUALITAET_OPTS } from '@/lib/wein/qualitaet'
import { kmwZuQualitaet } from '@/lib/weinqualitaet'
import type { ErnteParzelle, WeingartenOpt, GSTOpt, AMAMeldung } from './page'
import PressungSection from './PressungSection'
import type { Pressung, WGOption, BehOption, WAOption } from './PressungSection'
import { fmtHa, fmtZahl, fmtProzent } from '@/lib/format'

// QUALITAET_OPTS: aus lib/wein/qualitaet importiert (s.u. import qualitaetLabel)
const LESEMETHODE_OPTS = [
  { value: 'handlese', label: 'Handlese' },
  { value: 'maschinenlese', label: 'Maschinenlese' },
  { value: 'selektionslese', label: 'Selektionslese' },
]
const AMA_STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  entwurf:     { label: 'Entwurf',     cls: 'bg-gray-100 text-gray-600' },
  bereit:      { label: 'Bereit',      cls: 'bg-blue-100 text-blue-700' },
  eingereicht: { label: 'Eingereicht', cls: 'bg-amber-100 text-amber-700' },
  bestaetigt:  { label: 'Bestätigt',   cls: 'bg-green-100 text-green-700' },
  abgelehnt:   { label: 'Abgelehnt',   cls: 'bg-red-100 text-red-700' },
}

function formatDate(d: string | null) {
  if (!d) return '–'
  return new Date(d).toLocaleDateString('de-AT', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

// ── Neu-Formular: Mehrfacherfassung (Checkboxen nach Ried + GST) ──────────────
function NeueParzellenForm({
  jahrgangId, weingaerten, gstByWeingarten, onDone,
}: {
  jahrgangId: string; weingaerten: WeingartenOpt[]
  gstByWeingarten: Record<string, GSTOpt[]>; onDone: () => void
}) {
  const [pending, startTransition] = useTransition()
  const [selectedWGs, setSelectedWGs] = useState<Set<string>>(new Set())
  const [selectedGSTs, setSelectedGSTs] = useState<Map<string, string>>(new Map())
  const [expandedWGs, setExpandedWGs] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const [gstData, setGstData] = useState<Map<string, { menge_kg: string; kmw: string; notizen: string }>>(new Map())
  const [kmwNeu, setKmwNeu] = useState<number | null>(null)
  const derivedQualitaetNeu = kmwNeu != null ? kmwZuQualitaet(kmwNeu) : 'qualitaetswein'

  const riedMap = new Map<string, WeingartenOpt[]>()
  for (const w of weingaerten) {
    const key = w.lage_name ?? 'Alle'
    const arr = riedMap.get(key) ?? []
    arr.push(w)
    riedMap.set(key, arr)
  }
  const rieden = Array.from(riedMap.entries()).sort(([a], [b]) => a.localeCompare(b, 'de'))
  const totalSelCount = selectedWGs.size + selectedGSTs.size

  function toggleExpand(wgId: string) {
    setExpandedWGs(prev => { const n = new Set(prev); n.has(wgId) ? n.delete(wgId) : n.add(wgId); return n })
  }
  function toggleWG(wgId: string) {
    setSelectedGSTs(prev => { const n = new Map(prev); for (const [gId, wId] of n) { if (wId === wgId) n.delete(gId) } return n })
    setSelectedWGs(prev => { const n = new Set(prev); n.has(wgId) ? n.delete(wgId) : n.add(wgId); return n })
  }
  function toggleGST(gstId: string, wgId: string) {
    const wasSelected = selectedGSTs.has(gstId)
    setSelectedWGs(prev => { const n = new Set(prev); n.delete(wgId); return n })
    setSelectedGSTs(prev => { const n = new Map(prev); wasSelected ? n.delete(gstId) : n.set(gstId, wgId); return n })
    setGstData(prev => { const n = new Map(prev); wasSelected ? n.delete(gstId) : n.set(gstId, { menge_kg: '', kmw: '', notizen: '' }); return n })
  }
  function toggleLage(wgs: WeingartenOpt[]) {
    const ids = wgs.map(w => w.id)
    const allSel = ids.every(id => selectedWGs.has(id))
    setSelectedGSTs(prev => { const n = new Map(prev); for (const [gId, wId] of n) { if (ids.includes(wId)) n.delete(gId) } return n })
    setSelectedWGs(prev => { const n = new Set(prev); allSel ? ids.forEach(id => n.delete(id)) : ids.forEach(id => n.add(id)); return n })
  }
  function selectAll() {
    setSelectedGSTs(new Map())
    setSelectedWGs(new Set(weingaerten.map(w => w.id)))
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (totalSelCount === 0) { setError('Bitte mindestens eine Ried oder ein Grundstück auswählen.'); return }
    setError(null)
    const fd = new FormData(e.currentTarget)
    selectedWGs.forEach(id => fd.append('weingarten_ids', id))
    fd.append('grundstueck_json', JSON.stringify(
      Array.from(selectedGSTs.entries()).map(([gst_id, weingarten_id]) => {
        const gst = (gstByWeingarten[weingarten_id] ?? []).find(g => g.id === gst_id)
        const data = gstData.get(gst_id)
        return {
          gst_id, weingarten_id, flaeche_ha: gst?.flaeche_ha ?? null,
          menge_kg: data?.menge_kg ? parseFloat(data.menge_kg) : null,
          kmw: data?.kmw ? parseFloat(data.kmw) : null,
          notizen: data?.notizen || null,
        }
      })
    ))
    startTransition(async () => {
      try { await createMultipleErnteParzellen(jahrgangId, fd); onDone() }
      catch (err) { setError((err as Error).message) }
    })
  }

  const inputCls = 'w-full border border-s112-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40'

  return (
    <form onSubmit={handleSubmit} className="bg-s112-bg border border-s112-border rounded-xl p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-800">Lesedaten erfassen</h3>
        {totalSelCount > 0 && <span className="text-xs text-s112-teal font-medium">{totalSelCount} gewählt</span>}
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between mb-1">
          <label className="block text-xs font-medium text-gray-600">Rieden <span className="text-red-500">*</span></label>
          <button type="button" onClick={selectAll} className="text-xs text-s112-teal hover:underline">Alle auswählen</button>
        </div>
        {rieden.map(([lageName, wgs]) => {
          const allLageSel = wgs.every(w => selectedWGs.has(w.id))
          const someLageSel = wgs.some(w => selectedWGs.has(w.id) || [...selectedGSTs.values()].includes(w.id))
          return (
            <div key={lageName} className="border border-s112-border rounded-lg overflow-hidden">
              <div className="flex items-center gap-2 px-3 py-1.5 bg-white cursor-pointer hover:bg-s112-bg/60"
                onClick={() => toggleLage(wgs)}>
                <input type="checkbox" readOnly checked={allLageSel}
                  ref={el => { if (el) el.indeterminate = someLageSel && !allLageSel }}
                  className="accent-s112-teal" />
                <span className="text-xs font-semibold text-gray-800">{lageName}</span>
                <span className="text-xs text-s112-muted ml-1">{wgs.length} Rieden</span>
              </div>
              <div className="divide-y divide-s112-border/40 border-t border-s112-border/40">
                {wgs.map(w => {
                  const gsts = gstByWeingarten[w.id] ?? []
                  const isExpanded = expandedWGs.has(w.id)
                  const wgSel = selectedWGs.has(w.id)
                  const gstSelCount = gsts.filter(g => selectedGSTs.has(g.id)).length
                  const someGstSel = gstSelCount > 0
                  const allGstSel = gsts.length > 0 && gstSelCount === gsts.length
                  const isActive = wgSel || someGstSel
                  return (
                    <div key={w.id}>
                      <div className="flex items-center gap-2 px-4 py-1.5 hover:bg-s112-bg/40">
                        <input type="checkbox"
                          checked={wgSel || allGstSel}
                          ref={el => { if (el) el.indeterminate = someGstSel && !allGstSel && !wgSel }}
                          onChange={() => toggleWG(w.id)}
                          className="accent-s112-teal cursor-pointer" />
                        {gsts.length > 0 ? (
                          <button type="button" onClick={() => toggleExpand(w.id)}
                            className="flex items-center gap-1.5 flex-1 text-left">
                            <svg className={`w-3 h-3 text-s112-muted transition-transform shrink-0 ${isExpanded ? 'rotate-90' : ''}`}
                              fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                            </svg>
                            <span className={`text-xs ${isActive ? 'font-medium text-s112-teal' : 'text-gray-700'}`}>{w.name}</span>
                            <span className="text-xs text-s112-muted ml-auto">{gsts.length} GST</span>
                          </button>
                        ) : (
                          <label className="flex items-center gap-1.5 flex-1 cursor-pointer">
                            <span className={`text-xs ${isActive ? 'font-medium text-s112-teal' : 'text-gray-700'}`}>{w.name}</span>
                          </label>
                        )}
                      </div>
                      {isExpanded && gsts.length > 0 && (
                        <div className="bg-white border-t border-s112-border/20">
                          {gsts.map(g => {
                            const isGstSel = selectedGSTs.has(g.id)
                            return (
                              <React.Fragment key={g.id}>
                                <label className={`flex items-center gap-2 pl-10 pr-4 py-1 text-xs cursor-pointer hover:bg-s112-bg/30 ${isGstSel ? 'bg-s112-teal/5' : ''}`}>
                                  <input type="checkbox"
                                    checked={isGstSel}
                                    onChange={() => toggleGST(g.id, w.id)}
                                    className="accent-s112-teal" />
                                  <span className={`font-mono ${isGstSel ? 'text-s112-teal font-medium' : 'text-gray-600'}`}>
                                    GST {g.gst_nr}
                                  </span>
                                  {g.rebsorte && <span className="text-s112-muted">· {g.rebsorte}</span>}
                                  {g.flaeche_ha && <span className="text-s112-muted ml-auto">{g.flaeche_ha.toFixed(4)} ha</span>}
                                </label>
                                {isGstSel && (
                                  <div className="pl-10 pr-4 pb-2 pt-1 bg-s112-teal/5 border-b border-s112-border/20">
                                    <div className="grid grid-cols-3 gap-2">
                                      <div>
                                        <label className="block text-xs text-gray-500 mb-0.5">Menge kg</label>
                                        <input type="text" inputMode="decimal" placeholder="–"
                                          value={gstData.get(g.id)?.menge_kg ?? ''}
                                          onChange={e => setGstData(prev => { const n = new Map(prev); const d = n.get(g.id) ?? { menge_kg: '', kmw: '', notizen: '' }; n.set(g.id, { ...d, menge_kg: e.target.value }); return n })}
                                          className="w-full border border-s112-border rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-s112-teal/40 bg-white" />
                                      </div>
                                      <div>
                                        <label className="block text-xs text-gray-500 mb-0.5">°KMW</label>
                                        <input type="text" inputMode="decimal" placeholder="–"
                                          value={gstData.get(g.id)?.kmw ?? ''}
                                          onChange={e => setGstData(prev => { const n = new Map(prev); const d = n.get(g.id) ?? { menge_kg: '', kmw: '', notizen: '' }; n.set(g.id, { ...d, kmw: e.target.value }); return n })}
                                          className="w-full border border-s112-border rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-s112-teal/40 bg-white" />
                                      </div>
                                      <div>
                                        <label className="block text-xs text-gray-500 mb-0.5">Notizen</label>
                                        <input type="text" placeholder="–"
                                          value={gstData.get(g.id)?.notizen ?? ''}
                                          onChange={e => setGstData(prev => { const n = new Map(prev); const d = n.get(g.id) ?? { menge_kg: '', kmw: '', notizen: '' }; n.set(g.id, { ...d, notizen: e.target.value }); return n })}
                                          className="w-full border border-s112-border rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-s112-teal/40 bg-white" />
                                      </div>
                                    </div>
                                  </div>
                                )}
                              </React.Fragment>
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

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Ernte-Datum</label>
          <input name="ernte_datum" type="date" defaultValue={new Date().toISOString().split('T')[0]} className={inputCls} />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Lesemethode</label>
          <select name="lesemethode" className={inputCls}>
            <option value="">–</option>
            {LESEMETHODE_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">
            Menge kg
            {selectedGSTs.size > 0
              ? <span className="text-s112-muted font-normal"> (Fallback für GST ohne eigenen Wert)</span>
              : <span className="text-s112-muted font-normal"> (anteilsmäßig auf GST aufgeteilt)</span>}
          </label>
          <input name="menge_kg" type="text" inputMode="decimal" className={inputCls} placeholder="–" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">°KMW</label>
          <input name="klosterneuburger" type="text" inputMode="decimal" className={inputCls}
            onChange={e => setKmwNeu(e.target.value ? parseFloat(e.target.value) : null)} />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Qualitätsstufe</label>
          <input type="hidden" name="qualitaetsstufe" value={derivedQualitaetNeu} />
          <div className={inputCls + ' bg-s112-bg text-gray-700 cursor-not-allowed'}>
            {qualitaetLabel(derivedQualitaetNeu)}
            {kmwNeu == null && <span className="text-s112-muted ml-1">(wird aus °KMW abgeleitet)</span>}
          </div>
        </div>
        <div className="col-span-2">
          <label className="block text-xs font-medium text-gray-600 mb-1">Notizen</label>
          <input name="notizen" className={inputCls} placeholder="optional" />
        </div>
      </div>

      {error && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}

      <div className="flex gap-2 pt-1">
        <button type="submit" disabled={pending || totalSelCount === 0}
          className="bg-s112-teal text-white px-4 py-1.5 rounded-lg text-sm font-medium hover:bg-opacity-90 disabled:opacity-50 transition-colors">
          {pending ? 'Speichert…' : `${totalSelCount > 0 ? `${totalSelCount} × ` : ''}Speichern`}
        </button>
        <button type="button" onClick={onDone}
          className="px-4 py-1.5 rounded-lg text-sm font-medium text-gray-600 hover:text-gray-800">
          Abbrechen
        </button>
      </div>
    </form>
  )
}
// ── Edit-Formular: Einzelerfassung (bestehende Parzelle bearbeiten) ─────────────
function ParzellForm({
  jahrgangId, weingaerten, gstByWeingarten, parzelle, onDone,
}: {
  jahrgangId: string; weingaerten: WeingartenOpt[]
  gstByWeingarten: Record<string, GSTOpt[]>
  parzelle?: ErnteParzelle; onDone: () => void
}) {
  const [pending, startTransition] = useTransition()
  const [kmwEdit, setKmwEdit] = useState<number | null>(
    parzelle?.klosterneuburger != null ? Number(parzelle.klosterneuburger) : null
  )
  const [selWgId, setSelWgId] = useState<string>(parzelle?.weingarten_id ?? '')
  const [selGstId, setSelGstId] = useState<string>(parzelle?.grundstueck_id ?? '')
  const derivedQualitaetEdit = kmwEdit != null ? kmwZuQualitaet(kmwEdit) : 'qualitaetswein'
  const verfuegbareGSTs = selWgId ? (gstByWeingarten[selWgId] ?? []) : []

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    startTransition(async () => {
      await upsertErnteParzelle(jahrgangId, fd)
      onDone()
    })
  }

  const lagenMap = new Map<string, WeingartenOpt[]>()
  for (const w of weingaerten) {
    const key = w.lage_name ?? '(Keine Lage)'
    const arr = lagenMap.get(key) ?? []
    arr.push(w)
    lagenMap.set(key, arr)
  }

  return (
    <form onSubmit={handleSubmit} className="bg-s112-bg border border-s112-border rounded-xl p-4 space-y-3">
      <h3 className="text-sm font-semibold text-gray-800">
        {parzelle ? 'Lesedaten bearbeiten' : 'Lesedaten erfassen'}
      </h3>
      {parzelle && <input type="hidden" name="existing_id" value={parzelle.id} />}
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <label className="block text-xs font-medium text-gray-600 mb-1">Weingarten <span className="text-red-500">*</span></label>
          <select name="weingarten_id" required value={selWgId}
            onChange={e => { setSelWgId(e.target.value); setSelGstId('') }}
            className="w-full border border-s112-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40">
            <option value="">– Auswählen –</option>
            {Array.from(lagenMap.entries()).map(([lage, wgs]) => (
              <optgroup key={lage} label={lage}>
                {wgs.map(w => (
                  <option key={w.id} value={w.id}>{w.name}{w.rebsorte ? ` (${w.rebsorte})` : ''}</option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>
        {verfuegbareGSTs.length > 0 && (
          <div className="col-span-2">
            <label className="block text-xs font-medium text-gray-600 mb-1">Grundstück (GST)</label>
            <input type="hidden" name="grundstueck_id" value={selGstId} />
            <select value={selGstId} onChange={e => setSelGstId(e.target.value)}
              className="w-full border border-s112-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40">
              <option value="">– kein GST –</option>
              {verfuegbareGSTs.map(g => (
                <option key={g.id} value={g.id}>
                  {g.gst_nr}{g.rebsorte ? ' · ' + g.rebsorte : ''}{g.flaeche_ha ? ' · ' + g.flaeche_ha.toFixed(4) + ' ha' : ''}
                </option>
              ))}
            </select>
          </div>
        )}
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Ernte-Datum</label>
          <input name="ernte_datum" type="date" defaultValue={parzelle?.ernte_datum ?? ''}
            className="w-full border border-s112-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Lesemethode</label>
          <select name="lesemethode" defaultValue={parzelle?.lesemethode ?? ''}
            className="w-full border border-s112-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40">
            <option value="">–</option>
            {LESEMETHODE_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Menge (kg)</label>
          <input name="menge_kg" type="text" inputMode="decimal"
            defaultValue={parzelle?.menge_kg ?? ''}
            className="w-full border border-s112-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40" />
        </div>
        <input type="hidden" name="oechsle" value="" />
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">°KMW</label>
          <input name="klosterneuburger" type="text" inputMode="decimal"
            defaultValue={parzelle?.klosterneuburger ?? ''}
            onChange={e => setKmwEdit(e.target.value ? parseFloat(e.target.value) : null)}
            className="w-full border border-s112-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Qualitätsstufe</label>
          <input type="hidden" name="qualitaetsstufe" value={derivedQualitaetEdit} />
          <div className="w-full border border-s112-border rounded-lg px-3 py-1.5 text-sm bg-s112-bg text-gray-700 cursor-not-allowed">
            {qualitaetLabel(derivedQualitaetEdit)}
            {kmwEdit == null && <span className="text-s112-muted ml-1">(wird aus °KMW abgeleitet)</span>}
          </div>
        </div>
        <div className="col-span-2">
          <label className="block text-xs font-medium text-gray-600 mb-1">Notizen</label>
          <input name="notizen" defaultValue={parzelle?.notizen ?? ''}
            className="w-full border border-s112-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40" />
        </div>
      </div>
      <div className="flex gap-2 pt-1">
        <button type="submit" disabled={pending}
          className="bg-s112-teal text-white px-4 py-1.5 rounded-lg text-sm font-medium hover:bg-opacity-90 disabled:opacity-50 transition-colors">
          {pending ? 'Speichert…' : 'Speichern'}
        </button>
        <button type="button" onClick={onDone}
          className="px-4 py-1.5 rounded-lg text-sm font-medium text-gray-600 hover:text-gray-800">
          Abbrechen
        </button>
      </div>
    </form>
  )
}


// ── Hauptkomponente ─────────────────────────────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default function ErnteDetailClient({ jahrgang, parzellen, weingaerten, gstByWeingarten, amaMeldung, pressungen, wgOptions, behOptions, waOptions, verfuegbareKg, verfuegbareKgByGST, behaelterMitCharge, writeOk, adminOk }: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  jahrgang: Record<string, any>; parzellen: ErnteParzelle[]
  weingaerten: WeingartenOpt[]; gstByWeingarten: Record<string, GSTOpt[]>; amaMeldung: AMAMeldung | null
  pressungen: Pressung[]; wgOptions: WGOption[]; behOptions: BehOption[]; waOptions: WAOption[]
  verfuegbareKg: Record<string, number>; verfuegbareKgByGST: Record<string, number>
  behaelterMitCharge: Record<string, { weinausbau_id: string; name: string }[]>; writeOk: boolean; adminOk: boolean
}) {
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const gesamtKg = parzellen.reduce((s, p) => s + (p.menge_kg ?? 0), 0)

  function handleDelete(id: string) {
    if (!confirm('Lesedaten löschen?')) return
    startTransition(() => deleteErnteParzelle(id, jahrgang.id))
  }

  function handleAMA() {
    if (!confirm('AMA-Meldung aus aktuellen Lesedaten aufbauen?')) return
    startTransition(() => createOrUpdateAMAMeldung(jahrgang.id))
  }

  const heute = new Date().toLocaleDateString('de-AT', { day: '2-digit', month: '2-digit', year: 'numeric' })

  return (
    <div className={`space-y-6 ${pending ? 'opacity-60 pointer-events-none' : ''}`}>

      {/* Print-Header (nur beim Drucken sichtbar) */}
      <div className="hidden print:block mb-4 pb-4 border-b-2 border-gray-300">
        <p className="text-xs text-gray-500 font-semibold tracking-widest uppercase">software:112 – Gebeshuber Weinbau</p>
        <h1 className="text-2xl font-bold text-gray-900 mt-0.5">Jahrgang {jahrgang.jahrgang}</h1>
        <p className="text-sm text-gray-400 mt-1">Erstellt: {heute}</p>
      </div>

      {/* Ernte-Übersicht */}
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold text-gray-800">Lesedaten</h2>
          <div className="flex items-center gap-3">
            <span className="text-sm text-s112-muted">{parzellen.length} Parzellen · {fmtZahl(gesamtKg/1000, 2)} t</span>
            {writeOk && !showForm && (
              <button onClick={() => { setShowForm(true); setEditId(null) }}
                data-print="hide"
                className="text-xs bg-s112-teal/10 hover:bg-s112-teal/20 text-s112-teal font-medium px-3 py-1.5 rounded-lg transition-colors">
                ＋ Ernte
              </button>
            )}
            <button
              onClick={() => window.print()}
              data-print="hide"
              className="inline-flex items-center gap-1.5 border border-s112-border text-gray-600 px-3 py-1.5 rounded-lg text-xs hover:bg-s112-bg transition-colors"
              title="Als PDF speichern oder drucken"
            >
              🖨 Drucken / PDF
            </button>
          </div>
        </div>

        {showForm && !editId && (
          <div className="mb-4" data-print="hide">
            <NeueParzellenForm jahrgangId={jahrgang.id} weingaerten={weingaerten} gstByWeingarten={gstByWeingarten} onDone={() => setShowForm(false)} />
          </div>
        )}

        {parzellen.length > 0 ? (
          <div className="border border-s112-border rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-s112-bg border-b border-s112-border text-xs text-gray-600">
                  <th className="text-left px-3 py-2 font-semibold">Ried</th>
                  <th className="text-left px-3 py-2 font-semibold">GST</th>
                  <th className="text-left px-3 py-2 font-semibold">Sorte</th>
                  <th className="text-left px-3 py-2 font-semibold">Datum</th>
                  <th className="text-right px-3 py-2 font-semibold">kg</th>
                  <th className="text-right px-3 py-2 font-semibold">°KMW</th>
                  <th className="text-left px-3 py-2 font-semibold">Qualität</th>
                  {(writeOk || adminOk) && <th className="px-3 py-2" />}
                </tr>
              </thead>
              <tbody>
                {parzellen.map(p => (
                  <React.Fragment key={p.id}>
                    <tr className="border-b border-s112-border/40 last:border-0 hover:bg-s112-bg/30">
                      <td className="px-3 py-2 font-medium text-gray-800">
                        {p.weingarten_name}
                      </td>
                      <td className="px-3 py-2 text-xs text-s112-muted font-mono">{p.grundstueck_nr ?? '–'}</td>
                      <td className="px-3 py-2 text-xs text-s112-muted">{p.grundstueck_rebsorte ?? p.weingarten_rebsorte ?? '–'}</td>
                      <td className="px-3 py-2 text-s112-muted">{formatDate(p.ernte_datum)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{p.menge_kg?.toLocaleString('de-AT') ?? '–'}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{p.klosterneuburger ?? '–'}</td>
                      <td className="px-3 py-2 text-xs text-s112-muted">{qualitaetLabel(p.qualitaetsstufe)}</td>
                      {(writeOk || adminOk) && (
                        <td className="px-3 py-2 text-right" data-print="hide">
                          <div className="flex items-center justify-end gap-2">
                            {writeOk && (
                              <button onClick={() => { setEditId(p.id); setShowForm(false) }}
                                className="text-xs text-s112-teal hover:underline">Bearb.</button>
                            )}
                            {adminOk && (
                              <button onClick={() => handleDelete(p.id)}
                                className="text-xs text-red-400 hover:text-red-600">Löschen</button>
                            )}
                          </div>
                        </td>
                      )}
                    </tr>
                    {editId === p.id && (
                      <tr>
                        <td colSpan={8} className="px-3 py-2">
                          <ParzellForm jahrgangId={jahrgang.id} weingaerten={weingaerten} gstByWeingarten={gstByWeingarten} parzelle={p} onDone={() => setEditId(null)} />
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-s112-bg border-t-2 border-s112-border font-semibold text-sm">
                  <td className="px-3 py-2 text-gray-700" colSpan={3}>Gesamt</td>
                  <td className="px-3 py-2 text-right tabular-nums text-gray-800">{gesamtKg.toLocaleString('de-AT')} kg</td>
                  <td colSpan={3} className="px-3 py-2 text-xs text-s112-muted">
                    ≈ {fmtProzent(gesamtKg / 130)} hl
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        ) : (
          <div className="border border-dashed border-s112-border rounded-xl p-8 text-center text-sm text-s112-muted">
            Noch keine Lesedaten erfasst.
          </div>
        )}
      </div>

      {/* AMA Meldung */}
      {writeOk && (
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-semibold text-gray-800">AMA Erntemeldung</h2>
            {amaMeldung && (
              <span className={`text-xs px-2 py-1 rounded-full font-medium ${AMA_STATUS_BADGE[amaMeldung.status]?.cls ?? 'bg-gray-100 text-gray-600'}`}>
                {AMA_STATUS_BADGE[amaMeldung.status]?.label ?? amaMeldung.status}
              </span>
            )}
          </div>

          {amaMeldung ? (
            <div>
              <div className="grid grid-cols-2 gap-4 mb-4">
                <div className="bg-s112-bg rounded-xl p-3">
                  <p className="text-lg font-bold text-gray-800">{amaMeldung.gesamtmenge_kg?.toLocaleString('de-AT')} kg</p>
                  <p className="text-xs text-s112-muted">Gesamtmenge</p>
                </div>
                <div className="bg-s112-bg rounded-xl p-3">
                  <p className="text-lg font-bold text-gray-800">{fmtProzent(amaMeldung.gesamtmenge_hl)} hl</p>
                  <p className="text-xs text-s112-muted">Most (≈)</p>
                </div>
              </div>

              {amaMeldung.positionen.length > 0 && (
                <table className="w-full text-sm mb-4">
                  <thead>
                    <tr className="border-b border-s112-border text-xs text-gray-600">
                      <th className="text-left pb-1 font-semibold">Rebsorte</th>
                      <th className="text-right pb-1 font-semibold">Fläche (ha)</th>
                      <th className="text-right pb-1 font-semibold">Menge (kg)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {amaMeldung.positionen.map((pos, i) => (
                      <tr key={i} className="border-b border-s112-border/40 last:border-0">
                        <td className="py-1.5">{pos.rebsorte_name}</td>
                        <td className="py-1.5 text-right tabular-nums">{fmtHa(pos.flaeche_ha)}</td>
                        <td className="py-1.5 text-right tabular-nums">{pos.menge_kg?.toLocaleString('de-AT') ?? '–'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              {amaMeldung.n8n_fehler && (
                <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-3 py-2 text-xs mb-3">
                  Fehler: {amaMeldung.n8n_fehler}
                </div>
              )}

              <div className="flex gap-2" data-print="hide">
                <button onClick={handleAMA}
                  className="text-sm bg-s112-bg border border-s112-border hover:border-s112-teal text-gray-700 hover:text-s112-teal px-4 py-2 rounded-lg transition-colors">
                  Neu berechnen
                </button>
              </div>
            </div>
          ) : (
            <div>
              <p className="text-sm text-s112-muted mb-4" data-print="hide">
                Lesedaten aus {parzellen.length} Parzellen zu AMA-Meldung aggregieren.
              </p>
              <button onClick={handleAMA} disabled={parzellen.length === 0}
                data-print="hide"
                className="bg-s112-teal text-white px-4 py-2 rounded-xl text-sm font-semibold hover:bg-opacity-90 disabled:opacity-50 transition-colors">
                AMA-Meldung erstellen
              </button>
            </div>
          )}
        </div>
      )}

      {/* Pressungen / Lese */}
      <PressungSection
        jahrgangId={jahrgang.id}
        pressungen={pressungen}
        wgOptions={wgOptions}
        behOptions={behOptions}
        waOptions={waOptions}
        verfuegbareKgByGST={verfuegbareKgByGST}
        behaelterMitCharge={behaelterMitCharge}
        leseParzellen={parzellen.map(p => ({
          weingarten_id: p.weingarten_id,
          weingarten_name: p.weingarten_name,
          grundstueck_id: p.grundstueck_id,
          grundstueck_nr: p.grundstueck_nr,
          grundstueck_rebsorte: p.grundstueck_rebsorte,
          menge_kg: p.menge_kg,
          rebsorte: p.weingarten_rebsorte,
          klosterneuburger: p.klosterneuburger,
        }))}
        writeOk={writeOk}
        adminOk={adminOk}
      />
    </div>
  )
}
