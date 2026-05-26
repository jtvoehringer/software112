'use client'

import React, { useState, useTransition } from 'react'
import { createGrundstueck, updateGrundstueck, deleteGrundstueck } from './actions'

export type GST = {
  id: string; weingarten_id: string; gst_nr: string
  katastralgemeinde: string | null; einlagezahl: string | null
  rebsorte: string | null; pflanzjahr: number | null
  flaeche_ha: number | null; status: string; notizen: string | null
}

const STATUS_OPTIONS = [
  { value: 'aktiv',   label: 'Aktiv',   badge: 'bg-green-100 text-green-700' },
  { value: 'brache',  label: 'Brache',  badge: 'bg-yellow-100 text-yellow-700' },
  { value: 'gerodet', label: 'Gerodet', badge: 'bg-red-100 text-red-600' },
]

function StatusBadge({ status }: { status: string }) {
  const opt = STATUS_OPTIONS.find(o => o.value === status) ?? STATUS_OPTIONS[0]
  return (
    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${opt.badge}`}>
      {opt.label}
    </span>
  )
}

// ── Formular (Neu / Bearbeiten) ───────────────────────────────────────────────
function GSTForm({
  weingartenId, gst, onDone,
}: {
  weingartenId: string; gst?: GST; onDone: () => void
}) {
  const [pending, startTransition] = useTransition()

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    startTransition(async () => {
      if (gst) {
        await updateGrundstueck(gst.id, weingartenId, fd)
      } else {
        await createGrundstueck(weingartenId, fd)
      }
      onDone()
    })
  }

  return (
    <form onSubmit={handleSubmit} className="bg-s112-bg border border-s112-border rounded-xl p-4 space-y-3">
      <h3 className="text-sm font-semibold text-gray-800">
        {gst ? 'Grundstück bearbeiten' : 'Grundstück hinzufügen'}
      </h3>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">
            GST-Nummer <span className="text-red-500">*</span>
          </label>
          <input name="gst_nr" required defaultValue={gst?.gst_nr ?? ''}
            placeholder="z.B. 1411/1"
            className="w-full border border-s112-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Status</label>
          <select name="status" defaultValue={gst?.status ?? 'aktiv'}
            className="w-full border border-s112-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40">
            {STATUS_OPTIONS.map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Katastralgemeinde</label>
          <input name="katastralgemeinde" defaultValue={gst?.katastralgemeinde ?? ''}
            className="w-full border border-s112-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Einlagezahl</label>
          <input name="einlagezahl" defaultValue={gst?.einlagezahl ?? ''}
            className="w-full border border-s112-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Rebsorte</label>
          <input name="rebsorte" defaultValue={gst?.rebsorte ?? ''}
            placeholder="z.B. Grüner Veltliner"
            className="w-full border border-s112-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Pflanzjahr</label>
          <input name="pflanzjahr" type="number" min="1900" max="2100"
            defaultValue={gst?.pflanzjahr ?? ''}
            className="w-full border border-s112-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Fläche (ha)</label>
          <input name="flaeche_ha" type="number" step="0.0001" min="0"
            defaultValue={gst?.flaeche_ha ?? ''}
            className="w-full border border-s112-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Notizen</label>
          <input name="notizen" defaultValue={gst?.notizen ?? ''}
            className="w-full border border-s112-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40" />
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
  weingartenId, grundstuecke, writeOk, adminOk,
}: {
  weingartenId: string; grundstuecke: GST[]
  writeOk: boolean; adminOk: boolean
}) {
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const totalHa = grundstuecke.reduce((s, g) => s + (g.flaeche_ha ?? 0), 0)
  const aktiv   = grundstuecke.filter(g => g.status === 'aktiv').length

  function handleDelete(id: string, gstNr: string) {
    if (!confirm(`GST ${gstNr} wirklich löschen?`)) return
    startTransition(() => deleteGrundstueck(id, weingartenId))
  }

  return (
    <div className={pending ? 'opacity-60 pointer-events-none' : ''}>
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3">
          <h2 className="text-base font-semibold text-gray-800">Grundstücke</h2>
          <span className="text-xs text-s112-muted">
            {grundstuecke.length} GST · {aktiv} aktiv · {totalHa.toFixed(4)} ha
          </span>
        </div>
        {writeOk && !showForm && (
          <button
            onClick={() => { setShowForm(true); setEditId(null) }}
            className="inline-flex items-center gap-1 text-xs bg-s112-teal/10 hover:bg-s112-teal/20 text-s112-teal font-medium px-3 py-1.5 rounded-lg transition-colors"
          >
            ＋ Grundstück
          </button>
        )}
      </div>

      {/* Neues Grundstück */}
      {showForm && !editId && (
        <div className="mb-3">
          <GSTForm weingartenId={weingartenId} onDone={() => setShowForm(false)} />
        </div>
      )}

      {/* Liste */}
      {grundstuecke.length > 0 ? (
        <div className="border border-s112-border rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-s112-bg border-b border-s112-border text-xs text-gray-600">
                <th className="text-left px-3 py-2 font-semibold">GST-Nr</th>
                <th className="text-left px-3 py-2 font-semibold">Rebsorte</th>
                <th className="text-left px-3 py-2 font-semibold">KG</th>
                <th className="text-right px-3 py-2 font-semibold">Fläche (ha)</th>
                <th className="text-right px-3 py-2 font-semibold">Pflanzjahr</th>
                <th className="text-center px-3 py-2 font-semibold">Status</th>
                {(writeOk || adminOk) && <th className="px-3 py-2" />}
              </tr>
            </thead>
            <tbody>
              {grundstuecke.map(g => (
                <React.Fragment key={g.id}>
                  <tr className={`border-b border-s112-border/50 last:border-0 ${g.status !== 'aktiv' ? 'opacity-60' : ''}`}>
                    <td className="px-3 py-2 font-mono text-xs font-medium">{g.gst_nr}</td>
                    <td className="px-3 py-2 text-s112-muted">{g.rebsorte ?? '–'}</td>
                    <td className="px-3 py-2 text-xs text-s112-muted">{g.katastralgemeinde ?? '–'}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {g.flaeche_ha?.toFixed(4) ?? '–'}
                    </td>
                    <td className="px-3 py-2 text-right text-s112-muted">{g.pflanzjahr ?? '–'}</td>
                    <td className="px-3 py-2 text-center"><StatusBadge status={g.status} /></td>
                    {(writeOk || adminOk) && (
                      <td className="px-3 py-2 text-right">
                        <div className="flex items-center justify-end gap-2">
                          {writeOk && (
                            <button
                              onClick={() => { setEditId(g.id); setShowForm(false) }}
                              className="text-xs text-s112-teal hover:underline"
                            >
                              Bearb.
                            </button>
                          )}
                          {adminOk && (
                            <button
                              onClick={() => handleDelete(g.id, g.gst_nr)}
                              className="text-xs text-red-400 hover:text-red-600"
                            >
                              Löschen
                            </button>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                  {editId === g.id && (
                    <tr>
                      <td colSpan={7} className="px-3 py-2">
                        <GSTForm
                          weingartenId={weingartenId}
                          gst={g}
                          onDone={() => setEditId(null)}
                        />
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
