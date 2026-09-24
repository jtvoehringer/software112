'use client'
import { useState } from 'react'

interface Props { auftragId: string; initialArc: string; initialStatus: string }

export default function EmcsPanel({ auftragId, initialArc, initialStatus }: Props) {
  const [arc, setArc]       = useState(initialArc)
  const [status, setStatus] = useState(initialStatus)
  const [saving, setSaving] = useState(false)
  const [fehler, setFehler] = useState<string | null>(null)

  return (
    <div className="bg-white rounded-xl border border-s112-border p-5 mt-5">
      <h2 className="font-semibold text-s112-text mb-3">EMCS</h2>
      <div className="space-y-2">
        <label className="block text-xs text-s112-muted">ARC-Nummer</label>
        <input aria-label="ARC-Nummer" value={arc} onChange={e => setArc(e.target.value)}
          placeholder="AT123456789012345"
          className="w-full border border-s112-border rounded-lg px-3 py-1.5 text-sm focus:outline-none" />
        <label className="block text-xs text-s112-muted mt-1">Status</label>
        <select aria-label="Status" value={status} onChange={e => setStatus(e.target.value)}
          className="w-full border border-s112-border rounded-lg px-3 py-1.5 text-sm focus:outline-none">
          <option value="">nicht eingereicht</option>
          <option value="draft">Entwurf</option>
          <option value="submitted">Eingereicht</option>
          <option value="accepted">Akzeptiert</option>
          <option value="cancelled">Storniert</option>
        </select>
        <button type="button" disabled={saving}
          onClick={async () => {
            setSaving(true); setFehler(null)
            const res = await fetch('/api/weinexport/' + auftragId, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ emcs_arc_nummer: arc || null, emcs_status: status || null }),
            })
            if (!res.ok) setFehler((await res.json().catch(() => null))?.fehler ?? `Fehler (Status ${res.status})`)
            setSaving(false)
          }}
          className="w-full text-xs bg-s112-teal text-white py-1.5 rounded-lg hover:bg-opacity-90 disabled:opacity-40">
          {saving ? 'Speichern...' : 'EMCS speichern'}
        </button>
        {fehler && <p role="alert" className="text-xs text-s112-err">{fehler}</p>}
        <a href={'/api/weinexport/' + auftragId + '/emcs'}
          className="block text-center text-xs border border-s112-border text-s112-text-2 py-1.5 rounded-lg hover:bg-s112-bg mt-1">
          e-AD XML Download
        </a>
      </div>
    </div>
  )
}
