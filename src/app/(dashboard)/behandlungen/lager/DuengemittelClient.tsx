'use client'

import { useState, useTransition } from 'react'
import { Pencil, Trash2 } from 'lucide-react'
import { upsertDuengemittel, deactivateDuengemittel } from './actions'
import type { DuengemittelEintrag } from './page'

const TYP_OPTS = [
  { value: 'organisch',  label: 'Organisch' },
  { value: 'mineralisch', label: 'Mineralisch' },
]

const TYP_COLOR: Record<string, string> = {
  organisch:   'bg-green-50 text-green-700 border-green-200',
  mineralisch: 'bg-blue-50 text-blue-700 border-blue-200',
}

const EINHEIT_OPTS = ['kg', 'l']

function DuengemittelForm({ duengemittel, onDone }: { duengemittel?: DuengemittelEintrag; onDone: () => void }) {
  const [pending, startTransition] = useTransition()
  // Gleicher Bug wie im PSM-Formular (siehe PSMClient.tsx): hidden+checkbox-
  // Paar wurde nur per onChange synchronisiert, nicht beim initialen Rendern
  // eines bereits angehakten Werts - dadurch gingen "false" (hidden) UND
  // "true" (Checkbox) gleichzeitig ins FormData, FormData.get() nahm den
  // ersten Treffer ("false") und das Häkchen ging beim Speichern verloren.
  // Fix: kontrollierte Checkbox, disabled am hidden-Zwilling aus demselben
  // State.
  const [oekoZugelassen, setOekoZugelassen] = useState(duengemittel?.oeko_zugelassen ?? false)
  const [einarbeitung, setEinarbeitung] = useState(duengemittel?.einarbeitung_erforderlich ?? false)

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    startTransition(async () => {
      await upsertDuengemittel(fd)
      onDone()
    })
  }

  return (
    <form onSubmit={handleSubmit} className="bg-s112-bg border border-s112-border rounded-xl p-4 space-y-3">
      <h3 className="text-sm font-semibold text-gray-800">
        {duengemittel ? 'Düngemittel bearbeiten' : 'Neues Düngemittel anlegen'}
      </h3>
      {duengemittel && <input type="hidden" name="existing_id" value={duengemittel.id} />}

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Name *</label>
          <input name="name" required defaultValue={duengemittel?.name ?? ''}
            placeholder="z.B. Hornspäne"
            className="w-full border border-s112-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Handelsname</label>
          <input name="handelsname" defaultValue={duengemittel?.handelsname ?? ''}
            className="w-full border border-s112-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40" />
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Typ</label>
          <select name="typ" defaultValue={duengemittel?.typ ?? ''}
            className="w-full border border-s112-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40">
            <option value="">– keiner –</option>
            {TYP_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Wartezeit (Tage)</label>
          <input name="wartezeit_tage" type="number" min="0"
            defaultValue={duengemittel?.wartezeit_tage ?? ''}
            className="w-full border border-s112-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40" />
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">N-Gehalt (%)</label>
          <input name="naehrstoff_n_pct" type="number" step="0.01" min="0" max="100"
            defaultValue={duengemittel?.naehrstoff_n_pct ?? ''}
            className="w-full border border-s112-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">P-Gehalt (%)</label>
          <input name="naehrstoff_p_pct" type="number" step="0.01" min="0" max="100"
            defaultValue={duengemittel?.naehrstoff_p_pct ?? ''}
            className="w-full border border-s112-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40" />
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">K-Gehalt (%)</label>
          <input name="naehrstoff_k_pct" type="number" step="0.01" min="0" max="100"
            defaultValue={duengemittel?.naehrstoff_k_pct ?? ''}
            className="w-full border border-s112-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40" />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Preis/Einheit (€)</label>
            <input name="preis_pro_einheit" type="number" step="0.0001" min="0"
              defaultValue={duengemittel?.preis_pro_einheit ?? ''}
              placeholder="jährlich prüfen"
              className="w-full border border-s112-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Einheit</label>
            <select name="einheit" defaultValue={duengemittel?.einheit ?? 'kg'}
              className="w-full border border-s112-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40">
              {EINHEIT_OPTS.map(e => <option key={e} value={e}>{e}</option>)}
            </select>
          </div>
        </div>

        <div className="flex items-end pb-1.5">
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="hidden" name="oeko_zugelassen" value="false" disabled={oekoZugelassen} />
            <input type="checkbox" name="oeko_zugelassen" value="true"
              checked={oekoZugelassen}
              onChange={e => setOekoZugelassen(e.currentTarget.checked)}
              className="accent-s112-teal w-4 h-4" />
            <span className="text-sm text-gray-700">Bio/Öko zugelassen</span>
          </label>
        </div>
        <div className="flex items-end pb-1.5">
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="hidden" name="einarbeitung_erforderlich" value="false" disabled={einarbeitung} />
            <input type="checkbox" name="einarbeitung_erforderlich" value="true"
              checked={einarbeitung}
              onChange={e => setEinarbeitung(e.currentTarget.checked)}
              className="accent-s112-teal w-4 h-4" />
            <span className="text-sm text-gray-700">Einarbeitung erforderlich</span>
          </label>
        </div>

        <div className="col-span-2">
          <label className="block text-xs font-medium text-gray-600 mb-1">Notizen</label>
          <input name="notizen" defaultValue={duengemittel?.notizen ?? ''}
            className="w-full border border-s112-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40" />
        </div>
      </div>

      <div className="flex gap-2 pt-1">
        <button type="submit" disabled={pending}
          className="bg-s112-teal text-white px-4 py-1.5 rounded-lg text-sm font-medium hover:bg-opacity-90 disabled:opacity-50">
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

export default function DuengemittelClient({
  duengemittel, writeOk, adminOk,
}: {
  duengemittel: DuengemittelEintrag[]; writeOk: boolean; adminOk: boolean
}) {
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function handleDeactivate(id: string) {
    if (!confirm('Düngemittel deaktivieren? Es bleibt in bestehenden Maßnahmen erhalten.')) return
    startTransition(() => deactivateDuengemittel(id))
  }

  return (
    <div className={pending ? 'opacity-60 pointer-events-none' : ''}>
      {/* Formular */}
      {showForm && !editId && (
        <div className="mb-6">
          <DuengemittelForm onDone={() => setShowForm(false)} />
        </div>
      )}

      {!showForm && writeOk && (
        <div className="mb-6">
          <button onClick={() => setShowForm(true)}
            className="inline-flex items-center gap-2 bg-s112-teal text-white px-4 py-2 rounded-xl text-sm font-semibold hover:bg-opacity-90 transition-colors">
            Neues Düngemittel anlegen
          </button>
        </div>
      )}

      {/* Tabelle */}
      <div className="card">
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b border-s112-border">
                <th className="text-left text-xs text-s112-muted font-semibold py-2 pr-3">Name</th>
                <th className="text-left text-xs text-s112-muted font-semibold py-2 pr-3">Typ</th>
                <th className="text-right text-xs text-s112-muted font-semibold py-2 pr-3">N-P-K %</th>
                <th className="text-right text-xs text-s112-muted font-semibold py-2 pr-3">Preis/Einheit</th>
                <th className="text-right text-xs text-s112-muted font-semibold py-2 pr-3">Wartezeit</th>
                <th className="text-center text-xs text-s112-muted font-semibold py-2 pr-3">Bio</th>
                {(writeOk || adminOk) && (
                  <th className="py-2 px-3 sticky right-0 bg-white border-l border-s112-border" />
                )}
              </tr>
            </thead>
            <tbody>
              {duengemittel.map(d => (
                <>
                  <tr key={d.id} className="group border-b border-s112-border/40 hover:bg-s112-bg/30">
                    <td className="py-2.5 pr-3 font-medium text-gray-900">
                      {d.name}
                      {d.handelsname && d.handelsname !== d.name && (
                        <span className="ml-1 text-xs text-s112-muted">({d.handelsname})</span>
                      )}
                    </td>
                    <td className="py-2.5 pr-3">
                      {d.typ ? (
                        <span className={`text-xs px-2 py-0.5 rounded-full border ${TYP_COLOR[d.typ] ?? 'bg-gray-50 text-gray-600 border-gray-200'}`}>
                          {TYP_OPTS.find(o => o.value === d.typ)?.label ?? d.typ}
                        </span>
                      ) : '–'}
                    </td>
                    <td className="py-2.5 pr-3 text-right tabular-nums text-xs text-s112-muted">
                      {(d.naehrstoff_n_pct != null || d.naehrstoff_p_pct != null || d.naehrstoff_k_pct != null)
                        ? `${d.naehrstoff_n_pct ?? '–'}-${d.naehrstoff_p_pct ?? '–'}-${d.naehrstoff_k_pct ?? '–'}`
                        : '–'}
                    </td>
                    <td className="py-2.5 pr-3 text-right tabular-nums text-xs text-s112-muted">
                      {d.preis_pro_einheit ? `${d.preis_pro_einheit} €/${d.einheit ?? 'kg'}` : '–'}
                    </td>
                    <td className="py-2.5 pr-3 text-right tabular-nums text-xs text-s112-muted">
                      {d.wartezeit_tage ? `${d.wartezeit_tage} T` : '–'}
                    </td>
                    <td className="py-2.5 pr-3 text-center">
                      {d.oeko_zugelassen
                        ? <span className="text-green-600">Ja</span>
                        : <span className="text-gray-300">–</span>}
                    </td>
                    {(writeOk || adminOk) && (
                      <td className="py-2.5 px-3 text-right sticky right-0 bg-white border-l border-s112-border/40">
                        <div className="flex items-center justify-end gap-2">
                          {writeOk && (
                            <button onClick={() => setEditId(editId === d.id ? null : d.id)}
                              title="Bearbeiten" aria-label="Bearbeiten"
                              className="text-s112-teal hover:text-s112-teal/70"><Pencil className="w-4 h-4" /></button>
                          )}
                          {adminOk && (
                            <button onClick={() => handleDeactivate(d.id)}
                              title="Deaktivieren" aria-label="Deaktivieren"
                              className="text-red-400 hover:text-red-600"><Trash2 className="w-4 h-4" /></button>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                  {editId === d.id && (
                    <tr key={`edit-${d.id}`}>
                      <td colSpan={7} className="px-0 py-2">
                        <DuengemittelForm duengemittel={d} onDone={() => setEditId(null)} />
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
          {duengemittel.length === 0 && (
            <p className="text-center py-12 text-s112-muted text-sm">
              Noch keine Düngemittel angelegt.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
