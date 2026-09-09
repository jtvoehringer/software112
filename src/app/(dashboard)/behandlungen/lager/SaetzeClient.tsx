'use client'

import { useState, useTransition } from 'react'
import { Pencil, Trash2 } from 'lucide-react'
import { upsertSatzMassnahme, deactivateSatzMassnahme } from './actions'
import type { SatzEintrag } from './page'

const ART_OPTS = [
  { value: 'spritzung',        label: 'Spritzung' },
  { value: 'duengung',         label: 'Düngung' },
  { value: 'bodenbearbeitung', label: 'Bodenbearbeitung' },
  { value: 'schnitt',          label: 'Schnitt' },
  { value: 'laubarbeit',       label: 'Laubarbeit' },
  { value: 'sonstiges',        label: 'Sonstiges' },
]

const ART_COLOR: Record<string, string> = {
  spritzung:        'bg-s112-blue-50 text-s112-blue-700 border-s112-blue-100',
  duengung:         'bg-s112-ok-bg text-s112-ok-fg border-s112-ok/30',
  bodenbearbeitung: 'bg-s112-warn-bg text-s112-warn-fg border-s112-warn/30',
  schnitt:          'bg-[#F2F3F5] text-s112-text-1 border-s112-line-str',
  laubarbeit:       'bg-[#F2F3F5] text-s112-text-1 border-s112-line-str',
  sonstiges:        'bg-s112-bg text-s112-text-2 border-s112-line',
}

function formatDate(d: string | null) {
  if (!d) return '–'
  return new Date(d).toLocaleDateString('de-AT', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

function SatzForm({ satz, onDone }: { satz?: SatzEintrag; onDone: () => void }) {
  const [pending, startTransition] = useTransition()

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    startTransition(async () => {
      await upsertSatzMassnahme(fd)
      onDone()
    })
  }

  return (
    <form onSubmit={handleSubmit} className="bg-s112-bg border border-s112-border rounded-xl p-4 space-y-3">
      <h3 className="text-sm font-semibold text-s112-text">
        {satz ? 'Satz bearbeiten' : 'Neuen Satz anlegen'}
      </h3>
      {satz && <input type="hidden" name="existing_id" value={satz.id} />}

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-s112-text-2 mb-1">Art *</label>
          <select name="art" required defaultValue={satz?.art ?? ''}
            className="w-full border border-s112-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40">
            <option value="">– Auswählen –</option>
            {ART_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-s112-text-2 mb-1">Bezeichnung *</label>
          <input name="bezeichnung" required defaultValue={satz?.bezeichnung ?? ''}
            placeholder="z.B. Handlese, Laubschnitt maschinell"
            className="w-full border border-s112-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40" />
        </div>

        <div>
          <label className="block text-xs font-medium text-s112-text-2 mb-1">Satz pro ha (€) *</label>
          <input name="satz_pro_ha" type="number" step="0.01" min="0" required
            defaultValue={satz?.satz_pro_ha ?? ''}
            placeholder="z.B. 350"
            className="w-full border border-s112-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40" />
        </div>
        <div>
          <label className="block text-xs font-medium text-s112-text-2 mb-1">Gültig ab</label>
          <input name="gueltig_ab" type="date" defaultValue={satz?.gueltig_ab ?? new Date().toISOString().split('T')[0]}
            className="w-full border border-s112-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40" />
        </div>

        <div className="col-span-2">
          <label className="block text-xs font-medium text-s112-text-2 mb-1">Notizen</label>
          <input name="notizen" defaultValue={satz?.notizen ?? ''}
            placeholder="z.B. Quelle: LK Niederösterreich, IDB 2026"
            className="w-full border border-s112-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40" />
        </div>
      </div>

      <div className="flex gap-2 pt-1">
        <button type="submit" disabled={pending}
          className="bg-s112-teal text-white px-4 py-1.5 rounded-lg text-sm font-medium hover:bg-opacity-90 disabled:opacity-50">
          {pending ? 'Speichert…' : 'Speichern'}
        </button>
        <button type="button" onClick={onDone}
          className="px-4 py-1.5 rounded-lg text-sm font-medium text-s112-text-2 hover:text-s112-text">
          Abbrechen
        </button>
      </div>
    </form>
  )
}

export default function SaetzeClient({
  saetze, writeOk, adminOk,
}: {
  saetze: SatzEintrag[]; writeOk: boolean; adminOk: boolean
}) {
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function handleDeactivate(id: string) {
    if (!confirm('Satz deaktivieren?')) return
    startTransition(() => deactivateSatzMassnahme(id))
  }

  return (
    <div className={pending ? 'opacity-60 pointer-events-none' : ''}>
      <p className="text-xs text-s112-muted mb-4">
        Bauernkammer-/IDB-Hektarsätze je Maßnahmenart – du pflegst die aktuellen Werte selbst (jährlich anzupassen).
        Sie werden im Maßnahmenformular zur Kosten-Vorschlagsfunktion herangezogen.
      </p>

      {showForm && !editId && (
        <div className="mb-6">
          <SatzForm onDone={() => setShowForm(false)} />
        </div>
      )}

      {!showForm && writeOk && (
        <div className="mb-6">
          <button onClick={() => setShowForm(true)}
            className="inline-flex items-center gap-2 bg-s112-teal text-white px-4 py-2 rounded-xl text-sm font-semibold hover:bg-opacity-90 transition-colors">
            Neuen Satz anlegen
          </button>
        </div>
      )}

      <div className="card">
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b border-s112-border">
                <th className="text-left text-xs text-s112-muted font-semibold py-2 pr-3">Art</th>
                <th className="text-left text-xs text-s112-muted font-semibold py-2 pr-3">Bezeichnung</th>
                <th className="text-right text-xs text-s112-muted font-semibold py-2 pr-3">€/ha</th>
                <th className="text-left text-xs text-s112-muted font-semibold py-2 pr-3">Gültig ab</th>
                <th className="text-left text-xs text-s112-muted font-semibold py-2 pr-3">Notizen</th>
                {(writeOk || adminOk) && (
                  <th className="py-2 px-3 sticky right-0 bg-white border-l border-s112-border" />
                )}
              </tr>
            </thead>
            <tbody>
              {saetze.map(s => (
                <>
                  <tr key={s.id} className="group border-b border-s112-border/40 hover:bg-s112-bg/30">
                    <td className="py-2.5 pr-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full border ${ART_COLOR[s.art] ?? 'bg-s112-bg text-s112-text-2 border-s112-line'}`}>
                        {ART_OPTS.find(o => o.value === s.art)?.label ?? s.art}
                      </span>
                    </td>
                    <td className="py-2.5 pr-3 font-medium text-s112-text">{s.bezeichnung}</td>
                    <td className="py-2.5 pr-3 text-right tabular-nums font-medium text-s112-blue-700">
                      {s.satz_pro_ha.toLocaleString('de-AT')} €
                    </td>
                    <td className="py-2.5 pr-3 text-xs text-s112-muted">{formatDate(s.gueltig_ab)}</td>
                    <td className="py-2.5 pr-3 text-xs text-s112-muted">{s.notizen ?? '–'}</td>
                    {(writeOk || adminOk) && (
                      <td className="py-2.5 px-3 text-right sticky right-0 bg-white border-l border-s112-border/40">
                        <div className="flex items-center justify-end gap-2">
                          {writeOk && (
                            <button onClick={() => setEditId(editId === s.id ? null : s.id)}
                              title="Bearbeiten" aria-label="Bearbeiten"
                              className="text-s112-blue-700 hover:text-s112-blue-700/70"><Pencil size={16} /></button>
                          )}
                          {adminOk && (
                            <button onClick={() => handleDeactivate(s.id)}
                              title="Deaktivieren" aria-label="Deaktivieren"
                              className="text-s112-err hover:text-s112-err-fg"><Trash2 size={16} /></button>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                  {editId === s.id && (
                    <tr key={`edit-${s.id}`}>
                      <td colSpan={6} className="px-0 py-2">
                        <SatzForm satz={s} onDone={() => setEditId(null)} />
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
          {saetze.length === 0 && (
            <p className="text-center py-12 text-s112-muted text-sm">
              Noch keine Stundensätze/Hektarsätze angelegt.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
