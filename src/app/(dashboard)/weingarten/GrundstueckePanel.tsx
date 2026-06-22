'use client'

import React, { useState, useTransition } from 'react'
import { createGrundstueck, updateGrundstueck, deleteGrundstueck } from './actions'
import { fmtHa } from '@/lib/format'

export type GST = {
  id: string; weingarten_id: string; gst_nr: string
  katastralgemeinde: string | null; einlagezahl: string | null
  rebsorte: string | null; pflanzjahr: number | null
  weinart: string | null; bewirtschaftung: string | null; bewirtschaftung_seit: string | null
  flaeche_ha: number | null; flaeche_ha_kataster: number | null
  trauben_herkunft_code: string | null
  status: string; notizen: string | null
}

const STATUS_OPTIONS = [
  { value: 'aktiv',   label: 'Aktiv',   badge: 'bg-green-100 text-green-700' },
  { value: 'brache',  label: 'Brache',  badge: 'bg-yellow-100 text-yellow-700' },
  { value: 'gerodet', label: 'Gerodet', badge: 'bg-red-100 text-red-600' },
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

// ── Formular (Neu / Bearbeiten) ───────────────────────────────────────────────
function GSTForm({ weingartenId, gst, onDone }: { weingartenId: string; gst?: GST; onDone: () => void }) {
  const [pending, startTransition] = useTransition()
  const [bewirtschaftung, setBewirtschaftung] = useState(gst?.bewirtschaftung ?? '')
  const [weinart, setWeinart] = useState(gst?.weinart ?? 'unbekannt')

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
          <label className={labelCls}>Katastralgemeinde</label>
          <input name="katastralgemeinde" defaultValue={gst?.katastralgemeinde ?? ''} className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>Einlagezahl</label>
          <input name="einlagezahl" defaultValue={gst?.einlagezahl ?? ''} className={inputCls} />
        </div>

        {/* Rebsorte & Weinart */}
        <div>
          <label className={labelCls}>Rebsorte</label>
          <input name="rebsorte" defaultValue={gst?.rebsorte ?? ''} placeholder="z.B. Grüner Veltliner" className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>Weinart</label>
          <select name="weinart" value={weinart} onChange={e => setWeinart(e.target.value)} className={inputCls}>
            <option value="weiss">⬜ Weißwein</option>
            <option value="rot">🟥 Rotwein</option>
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
          <label className={labelCls}>GST-Fläche lt. Kataster (ha)</label>
          <input name="flaeche_ha_kataster" type="number" step="0.0001" min="0" defaultValue={gst?.flaeche_ha_kataster ?? ''} className={inputCls} />
          <p className="text-xs text-s112-muted mt-1">NÖ Atlas / Landeskataster</p>
        </div>

        {/* BKI */}
        <div className="col-span-2">
          <label className={labelCls}>Herkunft-Code (BKI)</label>
          <input name="trauben_herkunft_code" defaultValue={gst?.trauben_herkunft_code ?? ''} placeholder="z.B. WLWV" className={inputCls} />
          <p className="text-xs text-s112-muted mt-1">Offizielles Kürzel gem. BKI-Kürzelliste</p>
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
  weingartenId, grundstuecke,
}: {
  weingartenId: string; grundstuecke: GST[]
}) {
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId]     = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const totalAma      = grundstuecke.reduce((s, g) => s + (g.flaeche_ha ?? 0), 0)
  const totalKataster = grundstuecke.reduce((s, g) => s + (g.flaeche_ha_kataster ?? 0), 0)
  const aktiv         = grundstuecke.filter(g => g.status === 'aktiv').length

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
            ＋ Grundstück
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
                <th className="text-left px-3 py-2 font-semibold">GST-Nr</th>
                <th className="text-left px-3 py-2 font-semibold">Rebsorte</th>
                <th className="text-left px-3 py-2 font-semibold">Bewirtschaftung</th>
                <th className="text-right px-3 py-2 font-semibold leading-tight">GST-Fläche<br/>lt. AMA</th>
                <th className="text-right px-3 py-2 font-semibold leading-tight">GST-Fläche<br/>lt. Kataster</th>
                <th className="text-right px-3 py-2 font-semibold">Pflanzjahr</th>
                <th className="text-center px-3 py-2 font-semibold">Status</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {grundstuecke.map(g => (
                <React.Fragment key={g.id}>
                  <tr className={`border-b border-s112-border/50 last:border-0 ${g.status !== 'aktiv' ? 'opacity-60' : ''}`}>
                    <td className="px-3 py-2 font-mono text-xs font-medium">{g.gst_nr}</td>
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
                    <td className="px-3 py-2 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button onClick={() => { setEditId(g.id); setShowForm(false) }}
                          className="text-xs text-s112-teal hover:underline">Bearb.</button>
                        <button onClick={() => handleDelete(g.id, g.gst_nr)}
                          className="text-xs text-red-400 hover:text-red-600">Löschen</button>
                      </div>
                    </td>
                  </tr>
                  {editId === g.id && (
                    <tr>
                      <td colSpan={9} className="px-3 py-2">
                        <GSTForm weingartenId={weingartenId} gst={g} onDone={() => setEditId(null)} />
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
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
