'use client'

import React, { useState, useTransition } from 'react'
import { Pencil, Trash2 } from 'lucide-react'
import { createGrundstueck, updateGrundstueck, deleteGrundstueck, fetchBevFlaeche, type BevNutzung } from './actions'
import { fmtHa } from '@/lib/format'
import { getKgBezeichnung } from '@/lib/wein/katastralgemeinden'
import { HERKUNFT_ORDER, HERKUNFT_LABEL } from '@/lib/herkunft'

export type GST = {
  id: string; weingarten_id: string; gst_nr: string
  katastralgemeinde: string | null; einlagezahl: string | null
  rebsorte: string | null; pflanzjahr: number | null
  weinart: string | null; bewirtschaftung: string | null; bewirtschaftung_seit: string | null
  flaeche_ha: number | null; flaeche_ha_kataster: number | null
  trauben_herkunft_code: string | null
  ama_feldnummer: string | null; kg_bezeichnung: string | null
  boden: string | null; rechtsverhaeltnis: string | null; unterlagsrebe: string | null
  status: string; notizen: string | null
}

export type ErtragHistorie = {
  jahrgang: number; menge_kg: number; datum: string | null
  grundstueck_id: string | null; gst_nr: string | null
}

const STATUS_OPTIONS = [
  { value: 'aktiv',   label: 'Ausgepflanzt', badge: 'bg-green-100 text-green-700' },
  { value: 'brache',  label: 'Brache',  badge: 'bg-yellow-100 text-yellow-700' },
  { value: 'gruenbrache', label: 'Grünbrache', badge: 'bg-orange-100 text-orange-600' },
]

const BEWIRTSCHAFTUNG_OPTIONS = [
  { value: 'biodynamisch',  label: 'Biodynamisch' },
  { value: 'biologisch',    label: 'Biologisch/Organisch' },
  { value: 'in_umstellung', label: 'In Umstellung' },
  { value: 'nachhaltig',    label: 'Nachhaltig' },
  { value: 'kip',           label: 'KIP' },
  { value: 'konventionell', label: 'Konventionell' },
]

const BEWIRTSCHAFTUNG_BADGE: Record<string, string> = {
  biodynamisch:  'bg-green-100 text-green-800',
  biologisch:    'bg-green-100 text-green-700',
  in_umstellung: 'bg-yellow-100 text-yellow-700',
  nachhaltig:    'bg-teal-100 text-teal-700',
  kip:           'bg-blue-100 text-blue-700',
  konventionell: 'bg-gray-100 text-gray-600',
  bio:           'bg-green-100 text-green-700',
  demeter:       'bg-green-100 text-green-800',
}
const BEWIRTSCHAFTUNG_LABEL: Record<string, string> = {
  biodynamisch:  'Biodynamisch',
  biologisch:    'Bio/Organisch',
  in_umstellung: 'In Umstellung',
  nachhaltig:    'Nachhaltig',
  kip:           'KIP',
  konventionell: 'Konventionell',
  bio:           'Bio',
  demeter:       'Biodynamisch',
}

function StatusBadge({ status }: { status: string }) {
  const opt = STATUS_OPTIONS.find(o => o.value === status) ?? STATUS_OPTIONS[0]
  return (
    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${opt.badge}`}>
      {opt.label}
    </span>
  )
}

const inputCls = "w-full border border-s112-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40"
const labelCls = "block text-xs font-medium text-gray-600 mb-1"

// ── Ertragshistorie für ein einzelnes GST ─────────────────────────────────────
function GstErtragPanel({ gst, eintraege }: { gst: GST; eintraege: ErtragHistorie[] }) {
  const haAma      = gst.flaeche_ha ?? 0
  const haKataster = gst.flaeche_ha_kataster ?? 0

  const totalKg = eintraege.reduce((s, e) => s + e.menge_kg, 0)

  return (
    <div className="bg-s112-bg/60 border-t border-s112-border/50 px-3 py-2">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-gray-500">
            <th className="text-left py-1 pr-3 font-medium">Jahrgang</th>
            <th className="text-left py-1 pr-3 font-medium">Ernte-Datum</th>
            <th className="text-right py-1 pr-3 font-medium">Menge (kg)</th>
            {haAma > 0 && <th className="text-right py-1 pr-3 font-medium">kg/ha (AMA)</th>}
            {haKataster > 0 && <th className="text-right py-1 font-medium">kg/ha (Kataster)</th>}
          </tr>
        </thead>
        <tbody>
          {eintraege.map((e, i) => (
            <tr key={i} className="border-t border-s112-border/30">
              <td className="py-1 pr-3 font-semibold text-gray-700">{e.jahrgang}</td>
              <td className="py-1 pr-3 text-s112-muted">
                {e.datum
                  ? new Date(e.datum).toLocaleDateString('de-AT', { day: '2-digit', month: '2-digit', year: 'numeric' })
                  : '–'}
              </td>
              <td className="py-1 pr-3 text-right font-mono text-gray-800">
                {e.menge_kg.toLocaleString('de-AT', { maximumFractionDigits: 0 })}
              </td>
              {haAma > 0 && (
                <td className="py-1 pr-3 text-right font-mono text-s112-muted">
                  {(e.menge_kg / haAma).toLocaleString('de-AT', { maximumFractionDigits: 0 })}
                </td>
              )}
              {haKataster > 0 && (
                <td className="py-1 text-right font-mono text-s112-muted">
                  {(e.menge_kg / haKataster).toLocaleString('de-AT', { maximumFractionDigits: 0 })}
                </td>
              )}
            </tr>
          ))}
          {eintraege.length > 1 && (
            <tr className="border-t-2 border-s112-border/60 font-semibold">
              <td className="py-1 pr-3 text-gray-600">Gesamt</td>
              <td className="py-1 pr-3" />
              <td className="py-1 pr-3 text-right font-mono text-gray-700">
                {totalKg.toLocaleString('de-AT', { maximumFractionDigits: 0 })}
              </td>
              {haAma > 0 && (
                <td className="py-1 pr-3 text-right font-mono text-gray-600">
                  Ø {(totalKg / eintraege.length / haAma).toLocaleString('de-AT', { maximumFractionDigits: 0 })}
                </td>
              )}
              {haKataster > 0 && (
                <td className="py-1 text-right font-mono text-gray-600">
                  Ø {(totalKg / eintraege.length / haKataster).toLocaleString('de-AT', { maximumFractionDigits: 0 })}
                </td>
              )}
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}

// ── Formular (Neu / Bearbeiten) ───────────────────────────────────────────────
function GSTForm({ weingartenId, gst, onDone }: { weingartenId: string; gst?: GST; onDone: () => void }) {
  const [pending, startTransition] = useTransition()
  const [bewirtschaftung, setBewirtschaftung] = useState(gst?.bewirtschaftung ?? '')
  const [weinart, setWeinart] = useState(gst?.weinart ?? 'unbekannt')
  const [kgnr, setKgnr] = useState(gst?.katastralgemeinde ?? '')
  const [kgBezeichnung, setKgBezeichnung] = useState(gst?.kg_bezeichnung ?? '')
  const [katasterHa, setKatasterHa] = useState<string>(gst?.flaeche_ha_kataster != null ? String(gst.flaeche_ha_kataster) : '')
  const [bevLoading, setBevLoading] = useState(false)
  const [bevMsg, setBevMsg] = useState<string | null>(null)
  const [bevOk, setBevOk] = useState(false)
  const [bevAlleNutzungen, setBevAlleNutzungen] = useState<BevNutzung[] | null>(null)

  function handleKgnrChange(e: React.ChangeEvent<HTMLInputElement>) {
    const val = e.target.value
    setKgnr(val)
    // Auto-Lookup bei 4 oder 5 Stellen (KGNr. sind offiziell 5-stellig mit führender 0,
    // werden aber oft 4-stellig eingegeben, z.B. 4023 = Pfaffstätten → padStart → 04023)
    if (val.length === 4 || val.length === 5) {
      const lookup = getKgBezeichnung(val)
      setKgBezeichnung(lookup ?? '') // leert Feld wenn kein Treffer → kein "Altbestand"
    } else {
      setKgBezeichnung('') // leert Feld bei unvollständiger Eingabe
    }
  }

  async function handleBevImport() {
    if (!kgnr) { setBevMsg('Bitte zuerst KGNr eingeben'); setBevOk(false); return }
    const gstNr = (document.querySelector('input[name="gst_nr"]') as HTMLInputElement)?.value
    if (!gstNr) { setBevMsg('Bitte zuerst GST-Nr eingeben'); setBevOk(false); return }
    setBevLoading(true)
    setBevMsg(null)
    setBevAlleNutzungen(null)
    const result = await fetchBevFlaeche(kgnr, gstNr)
    setBevLoading(false)
    if (result.ok) {
      setKatasterHa(String(result.ha))
      const detail = result.nutzungen.map(n => n.nutzung + ': ' + n.ha.toFixed(4) + ' ha').join(', ')
      setBevMsg(result.ha.toFixed(4) + ' ha (' + detail + ')')
      setBevOk(true)
    } else {
      setBevMsg(result.message)
      setBevOk(false)
      if ('alleNutzungen' in result && result.alleNutzungen) {
        setBevAlleNutzungen(result.alleNutzungen)
      }
    }
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    startTransition(async () => {
      if (gst) await updateGrundstueck(gst.id, weingartenId, fd)
      else      await createGrundstueck(weingartenId, fd)
      onDone()
    })
  }

  return (
    <form onSubmit={handleSubmit} className="bg-s112-bg border border-s112-border rounded-xl p-4 space-y-3">
      <h3 className="text-sm font-semibold text-gray-800">
        {gst ? 'Grundstück bearbeiten' : 'Grundstück hinzufügen'}
      </h3>

      <div className="grid grid-cols-2 gap-3">
        {/* Identifikation */}
        <div>
          <label className={labelCls}>GST-Nummer <span className="text-red-500">*</span></label>
          <input name="gst_nr" required defaultValue={gst?.gst_nr ?? ''} placeholder="z.B. 1411/1" className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>Status</label>
          <select name="status" defaultValue={gst?.status ?? 'aktiv'} className={inputCls}>
            {STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        <div>
          <label className={labelCls}>KGNr.</label>
          <input
            name="katastralgemeinde"
            value={kgnr}
            onChange={handleKgnrChange}
            placeholder="z.B. 12105"
            maxLength={5}
            className={inputCls}
          />
        </div>
        <div>
          <label className={labelCls}>Katastralgemeinde</label>
          <input name="kg_bezeichnung" type="hidden" value={kgBezeichnung} />
          <div className="w-full border border-s112-border rounded-lg px-3 py-1.5 text-sm bg-gray-50 text-gray-700 min-h-[34px]">
            {kgBezeichnung || <span className="text-s112-muted italic">wird aus KGNr. ermittelt</span>}
          </div>
        </div>

        {/* Rebsorte & Weinart */}
        <div>
          <label className={labelCls}>Rebsorte</label>
          <input name="rebsorte" defaultValue={gst?.rebsorte ?? ''} placeholder="z.B. Grüner Veltliner" className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>Weinart</label>
          <select name="weinart" value={weinart} onChange={e => setWeinart(e.target.value)} className={inputCls}>
            <option value="weiss">Weißwein</option>
            <option value="rot">Rotwein</option>
            <option value="unbekannt">– unbekannt –</option>
          </select>
        </div>

        {/* Pflanzjahr & Bewirtschaftung */}
        <div>
          <label className={labelCls}>Pflanzjahr</label>
          <input name="pflanzjahr" type="number" min="1900" max="2100" defaultValue={gst?.pflanzjahr ?? ''} className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>Bewirtschaftung</label>
          <select name="bewirtschaftung" value={bewirtschaftung} onChange={e => setBewirtschaftung(e.target.value)} className={inputCls}>
            <option value="">– bitte wählen –</option>
            {BEWIRTSCHAFTUNG_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        {bewirtschaftung === 'in_umstellung' && (
          <div className="col-span-2">
            <label className={labelCls}>In Umstellung seit</label>
            <input name="bewirtschaftung_seit" type="date" defaultValue={gst?.bewirtschaftung_seit ?? ''} className={inputCls} />
          </div>
        )}

        {/* Flächen */}
        <div>
          <label className={labelCls}>GST-Fläche lt. AMA (ha)</label>
          <input name="flaeche_ha" type="number" step="0.0001" min="0" defaultValue={gst?.flaeche_ha ?? ''} className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>
            GST-Fläche lt. Kataster (ha)
          </label>
          <div className="flex gap-1.5">
            <input
              name="flaeche_ha_kataster"
              type="number" step="0.0001" min="0"
              value={katasterHa}
              onChange={e => setKatasterHa(e.target.value)}
              className={inputCls}
            />
            <button
              type="button"
              onClick={handleBevImport}
              disabled={bevLoading}
              title="Fläche aus BEV-Kataster holen"
              className="shrink-0 px-2.5 py-1.5 rounded-lg border border-s112-border text-xs font-medium text-s112-teal hover:bg-s112-teal/10 disabled:opacity-40 transition-colors whitespace-nowrap"
            >
              {bevLoading ? '…' : 'BEV'}
            </button>
          </div>
          {bevMsg && (
            <p className={'text-xs mt-1 ' + (bevOk ? 'text-green-600' : 'text-orange-600')}>
              {bevMsg}
            </p>
          )}
          {bevAlleNutzungen && bevAlleNutzungen.length > 0 && (
            <div className="mt-2 border border-orange-200 rounded-lg overflow-hidden text-xs">
              <table className="w-full">
                <thead>
                  <tr className="bg-orange-50 text-orange-700">
                    <th className="text-left px-2 py-1 font-medium">NS</th>
                    <th className="text-left px-2 py-1 font-medium">Nutzung</th>
                    <th className="text-right px-2 py-1 font-medium">ha</th>
                  </tr>
                </thead>
                <tbody>
                  {bevAlleNutzungen.map((n, i) => (
                    <tr key={i} className="border-t border-orange-100">
                      <td className="px-2 py-1 font-mono text-orange-600">{n.ns}</td>
                      <td className="px-2 py-1 text-gray-700">{n.nutzung}</td>
                      <td className="px-2 py-1 text-right font-mono text-gray-700">{n.ha.toFixed(4)}</td>
                    </tr>
                  ))}
                  <tr className="border-t border-orange-200 bg-orange-50 font-semibold">
                    <td className="px-2 py-1 text-orange-700" colSpan={2}>Gesamt</td>
                    <td className="px-2 py-1 text-right font-mono text-orange-700">
                      {bevAlleNutzungen.reduce((s, n) => s + n.ha, 0).toFixed(4)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* BKI */}
        <div className="col-span-2">
          <label className={labelCls}>Herkunft-Code (BKI)</label>
          <select name="trauben_herkunft_code" defaultValue={gst?.trauben_herkunft_code ?? ''} className={inputCls}>
            <option value="">– bitte wählen –</option>
            {HERKUNFT_ORDER.map(code => (
              <option key={code} value={code}>{HERKUNFT_LABEL[code]}</option>
            ))}
          </select>
          <p className="text-xs text-s112-muted mt-1">Herkunftsstufe gem. Weingesetz/DAC-Verordnung – wird an Lese, Kellerbuch und Füllung weitergegeben (nur Abstufungen möglich)</p>
        </div>

        {/* AMA-Feldstücknummer */}
        <div>
          <label className={labelCls}>AMA-Feldstücknr.</label>
          <input name="ama_feldnummer" maxLength={3} pattern="[0-9]{1,3}" defaultValue={gst?.ama_feldnummer ?? ''} placeholder="z.B. 12" className={inputCls} />
          <p className="text-xs text-s112-muted mt-1">Max. 3-stellig numerisch</p>
        </div>

        {/* Rechtsverhältnis */}
        <div>
          <label className={labelCls}>Rechtsverhältnis</label>
          <select name="rechtsverhaeltnis" defaultValue={gst?.rechtsverhaeltnis ?? ''} className={inputCls}>
            <option value="">– bitte wählen –</option>
            <option value="eigentum">Eigentum</option>
            <option value="pacht">Pacht</option>
          </select>
        </div>

        {/* Unterlagsrebe */}
        <div>
          <label className={labelCls}>Unterlagsrebe</label>
          <input name="unterlagsrebe" defaultValue={gst?.unterlagsrebe ?? ''} placeholder="z.B. SO4, Kober 5BB" className={inputCls} />
        </div>

        {/* Boden */}
        <div>
          <label className={labelCls}>Boden</label>
          <input name="boden" defaultValue={gst?.boden ?? ''} placeholder="z.B. Löss, Schotter, Gneis" className={inputCls} />
        </div>

        {/* Notizen */}
        <div className="col-span-2">
          <label className={labelCls}>Notizen</label>
          <input name="notizen" defaultValue={gst?.notizen ?? ''} className={inputCls} />
        </div>
      </div>

      <div className="flex gap-2 pt-1">
        <button type="submit" disabled={pending}
          className="bg-s112-teal text-white px-4 py-1.5 rounded-lg text-sm font-medium hover:bg-opacity-90 disabled:opacity-50 transition-colors">
          {pending ? 'Speichert…' : 'Speichern'}
        </button>
        <button type="button" onClick={onDone}
          className="px-4 py-1.5 rounded-lg text-sm font-medium text-gray-600 hover:text-gray-800 transition-colors">
          Abbrechen
        </button>
      </div>
    </form>
  )
}

// ── Hauptkomponente ───────────────────────────────────────────────────────────
export default function GrundstueckePanel({
  weingartenId, grundstuecke, ertragByGst = {},
}: {
  weingartenId: string
  grundstuecke: GST[]
  ertragByGst?: Record<string, ErtragHistorie[]>
}) {
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId]     = useState<string | null>(null)
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
  const [pending, startTransition] = useTransition()

  const totalAma      = grundstuecke.reduce((s, g) => s + (g.flaeche_ha ?? 0), 0)
  const totalKataster = grundstuecke.reduce((s, g) => s + (g.flaeche_ha_kataster ?? 0), 0)
  const aktiv         = grundstuecke.filter(g => g.status === 'aktiv').length

  function toggleExpand(id: string) {
    setExpandedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function handleDelete(id: string, gstNr: string) {
    if (!confirm(`GST ${gstNr} wirklich löschen?`)) return
    startTransition(() => deleteGrundstueck(id, weingartenId))
  }

  return (
    <div className={pending ? 'opacity-60 pointer-events-none' : ''}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3">
          <h2 className="text-base font-semibold text-gray-800">Grundstücke</h2>
          <span className="text-xs text-s112-muted">
            {grundstuecke.length} GST · {aktiv} aktiv · AMA: {fmtHa(totalAma)} ha
            {totalKataster > 0 && ` · Kataster: ${fmtHa(totalKataster)} ha`}
          </span>
        </div>
        {!showForm && (
          <button onClick={() => { setShowForm(true); setEditId(null) }}
            className="inline-flex items-center gap-1 text-xs bg-s112-teal/10 hover:bg-s112-teal/20 text-s112-teal font-medium px-3 py-1.5 rounded-lg transition-colors">
            Grundstück
          </button>
        )}
      </div>

      {showForm && !editId && (
        <div className="mb-3">
          <GSTForm weingartenId={weingartenId} onDone={() => setShowForm(false)} />
        </div>
      )}

      {grundstuecke.length > 0 ? (
        <div className="border border-s112-border rounded-xl overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-s112-bg border-b border-s112-border text-xs text-gray-600">
                <th className="w-6 px-2 py-2" />
                <th className="text-left px-3 py-2 font-semibold">GST-Nr</th>
                <th className="text-left px-3 py-2 font-semibold">Rebsorte</th>
                <th className="text-left px-3 py-2 font-semibold">Bewirtschaftung</th>
                <th className="text-right px-3 py-2 font-semibold leading-tight">GST-Fläche<br/>lt. AMA</th>
                <th className="text-right px-3 py-2 font-semibold leading-tight">GST-Fläche<br/>lt. Kataster</th>
                <th className="text-right px-3 py-2 font-semibold">Pflanzjahr</th>
                <th className="text-center px-3 py-2 font-semibold">Status</th>
                <th className="px-3 py-2 sticky right-0 bg-s112-bg border-l border-s112-border" />
              </tr>
            </thead>
            <tbody>
              {grundstuecke.map(g => {
                const eintraege = ertragByGst[g.id] ?? []
                const isExpanded = expandedIds.has(g.id)
                const hasHistory = eintraege.length > 0
                return (
                  <React.Fragment key={g.id}>
                    <tr
                      className={`group border-b border-s112-border/50 cursor-pointer hover:bg-s112-bg/40 transition-colors ${!isExpanded ? 'last:border-0' : ''} ${g.status !== 'aktiv' ? 'opacity-60' : ''}`}
                      onClick={() => { setEditId(g.id); setShowForm(false) }}
                      title="Grundstück bearbeiten"
                    >
                      {/* Expand-Toggle */}
                      <td className="px-2 py-2 text-center" onClick={e => e.stopPropagation()}>
                        {hasHistory ? (
                          <button
                            onClick={() => toggleExpand(g.id)}
                            className="text-s112-muted hover:text-s112-teal transition-colors text-xs leading-none"
                            title={isExpanded ? 'Ertragshistorie ausblenden' : 'Ertragshistorie einblenden'}
                          >
                            {isExpanded ? '▼' : '▶'}
                          </button>
                        ) : (
                          <span className="text-gray-200 text-xs">▶</span>
                        )}
                      </td>
                      <td className="px-3 py-2 font-mono text-xs font-medium">
                        {g.gst_nr}
                        {hasHistory && (
                          <span className="ml-1.5 text-xs text-s112-muted font-normal">
                            ({eintraege.length}×)
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-s112-muted text-xs">
                        {g.rebsorte ?? '–'}
                        {g.weinart && g.weinart !== 'unbekannt' && (
                          <span className={`ml-1 inline-block px-1 py-0 rounded-full text-xs font-medium ${
                            g.weinart === 'rot' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'
                          }`}>{g.weinart === 'rot' ? 'Rot' : 'Weiß'}</span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {g.bewirtschaftung ? (
                          <span className={`inline-block px-1.5 py-0 rounded-full text-xs font-medium ${BEWIRTSCHAFTUNG_BADGE[g.bewirtschaftung] ?? 'bg-gray-100 text-gray-600'}`}>
                            {BEWIRTSCHAFTUNG_LABEL[g.bewirtschaftung] ?? g.bewirtschaftung}
                            {g.bewirtschaftung === 'in_umstellung' && g.bewirtschaftung_seit && (
                              <span className="ml-1 text-gray-500">seit {new Date(g.bewirtschaftung_seit).toLocaleDateString('de-AT', { month: '2-digit', year: 'numeric' })}</span>
                            )}
                          </span>
                        ) : <span className="text-s112-muted text-xs">–</span>}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-xs">{fmtHa(g.flaeche_ha)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-xs text-s112-muted">
                        {g.flaeche_ha_kataster != null ? fmtHa(g.flaeche_ha_kataster) : '–'}
                      </td>
                      <td className="px-3 py-2 text-right text-s112-muted text-xs">{g.pflanzjahr ?? '–'}</td>
                      <td className="px-3 py-2 text-center"><StatusBadge status={g.status} /></td>
                      <td className="px-3 py-2 text-right sticky right-0 bg-white border-l border-s112-border/40" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center justify-end gap-2">
                          <button onClick={() => { setEditId(g.id); setShowForm(false) }}
                            title="Bearbeiten" aria-label="Bearbeiten"
                            className="text-s112-teal hover:text-s112-teal/70"><Pencil size={14} /></button>
                          <button onClick={() => handleDelete(g.id, g.gst_nr)}
                            title="Löschen" aria-label="Löschen"
                            className="text-red-400 hover:text-red-600"><Trash2 size={14} /></button>
                        </div>
                      </td>
                    </tr>
                    {/* Ertragshistorie aufgeklappt */}
                    {isExpanded && hasHistory && (
                      <tr className="border-b border-s112-border/50">
                        <td colSpan={9} className="p-0">
                          <GstErtragPanel gst={g} eintraege={eintraege} />
                        </td>
                      </tr>
                    )}
                    {/* Bearbeiten-Formular */}
                    {editId === g.id && (
                      <tr>
                        <td colSpan={9} className="px-3 py-2">
                          <GSTForm weingartenId={weingartenId} gst={g} onDone={() => setEditId(null)} />
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="border border-dashed border-s112-border rounded-xl p-6 text-center text-sm text-s112-muted">
          Noch keine Grundstücke erfasst.
        </div>
      )}
    </div>
  )
}
