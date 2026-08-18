'use client'

import { useState, useTransition } from 'react'
import { Pencil, Trash2 } from 'lucide-react'
import { upsertPSM, deactivatePSM } from './actions'
import type { PSMEintrag } from './page'

const KATEGORIE_OPTS = [
  { value: 'fungizid',         label: 'Fungizid' },
  { value: 'insektizid',       label: 'Insektizid' },
  { value: 'herbizid',         label: 'Herbizid' },
  { value: 'akarizid',         label: 'Akarizid' },
  { value: 'wachstumsregler',  label: 'Wachstumsregler' },
  { value: 'naehrstoff',       label: 'Nährstoff / Dünger' },
  { value: 'sonstiges',        label: 'Sonstiges' },
]

const KAT_COLOR: Record<string, string> = {
  fungizid:        'bg-purple-50 text-purple-700 border-purple-200',
  insektizid:      'bg-orange-50 text-orange-700 border-orange-200',
  herbizid:        'bg-red-50 text-red-700 border-red-200',
  akarizid:        'bg-pink-50 text-pink-700 border-pink-200',
  wachstumsregler: 'bg-blue-50 text-blue-700 border-blue-200',
  naehrstoff:      'bg-green-50 text-green-700 border-green-200',
  sonstiges:       'bg-gray-50 text-gray-600 border-gray-200',
}

function PSMForm({ psm, onDone }: { psm?: PSMEintrag; onDone: () => void }) {
  const [pending, startTransition] = useTransition()
  // Bug (gemeldet): beim Ändern eines anderen Felds "verlor" das Formular das
  // Häkchen bei "Bio/Öko zugelassen", auch ohne es angefasst zu haben. Ursache:
  // das hidden+checkbox-Paar (Standard-Trick, damit eine NICHT angehakte Box
  // trotzdem "false" mitsendet) wurde nur per onChange synchronisiert - beim
  // Bearbeiten eines bereits angehakten Mittels war die Checkbox zwar dank
  // defaultChecked von Anfang an sichtbar angehakt, das disabled am hidden-
  // Zwilling blieb aber unverändert (false). Ohne Klick auf die Checkbox
  // feuerte onChange nie, also gingen BEIDE Felder namens oeko_zugelassen ins
  // FormData - "false" (hidden, zuerst im DOM) UND "true" (Checkbox, danach).
  // FormData.get() liefert den ERSTEN Treffer, also "false" - die Aktion hat
  // das Häkchen beim Speichern jedes anderen Feldes stillschweigend gelöscht.
  // Fix: kontrollierte Checkbox + disabled am hidden-Zwilling direkt aus
  // demselben State ableiten, statt es nur reaktiv per onChange nachzuziehen.
  const [oekoZugelassen, setOekoZugelassen] = useState(psm?.oeko_zugelassen ?? false)

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    startTransition(async () => {
      await upsertPSM(fd)
      onDone()
    })
  }

  return (
    <form onSubmit={handleSubmit} className="bg-s112-bg border border-s112-border rounded-xl p-4 space-y-3">
      <h3 className="text-sm font-semibold text-gray-800">
        {psm ? 'Mittel bearbeiten' : 'Neues Mittel anlegen'}
      </h3>
      {psm && <input type="hidden" name="existing_id" value={psm.id} />}

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Name *</label>
          <input name="name" required defaultValue={psm?.name ?? ''}
            placeholder="z.B. Cuprozin progress"
            className="w-full border border-s112-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Handelsname</label>
          <input name="handelsname" defaultValue={psm?.handelsname ?? ''}
            className="w-full border border-s112-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40" />
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Kategorie</label>
          <select name="kategorie" defaultValue={psm?.kategorie ?? ''}
            className="w-full border border-s112-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40">
            <option value="">– keine –</option>
            {KATEGORIE_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Wirkstoff</label>
          <input name="wirkstoff" defaultValue={psm?.wirkstoff ?? ''}
            placeholder="z.B. Kupferhydroxid"
            className="w-full border border-s112-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40" />
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Wirkstoffgehalt (%)</label>
          <input name="wirkstoffgehalt_pct" type="number" step="0.01" min="0" max="100"
            defaultValue={psm?.wirkstoffgehalt_pct ?? ''}
            className="w-full border border-s112-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Cu-Gehalt (%)</label>
          <input name="cu_gehalt_pct" type="number" step="0.01" min="0" max="100"
            defaultValue={psm?.cu_gehalt_pct ?? ''}
            placeholder="nur bei Kupfermitteln"
            className="w-full border border-s112-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40" />
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Max. Aufwand (kg/ha)</label>
          <input name="max_aufwand_kg_ha" type="number" step="0.001" min="0"
            defaultValue={psm?.max_aufwand_kg_ha ?? ''}
            className="w-full border border-s112-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Max. Anwendungen</label>
          <input name="max_anwendungen" type="number" min="0"
            defaultValue={psm?.max_anwendungen ?? ''}
            className="w-full border border-s112-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40" />
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Wartezeit (Tage)</label>
          <input name="wartezeit_tage" type="number" min="0"
            defaultValue={psm?.wartezeit_tage ?? ''}
            className="w-full border border-s112-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40" />
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

        <div className="col-span-2">
          <label className="block text-xs font-medium text-gray-600 mb-1">Notizen</label>
          <input name="notizen" defaultValue={psm?.notizen ?? ''}
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

export default function PSMClient({
  psm, writeOk, adminOk,
}: {
  psm: PSMEintrag[]; writeOk: boolean; adminOk: boolean
}) {
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function handleDeactivate(id: string) {
    if (!confirm('Mittel deaktivieren? Es bleibt in bestehenden Maßnahmen erhalten.')) return
    startTransition(() => deactivatePSM(id))
  }

  return (
    <div className={pending ? 'opacity-60 pointer-events-none' : ''}>
      {/* Formular */}
      {showForm && !editId && (
        <div className="mb-6">
          <PSMForm onDone={() => setShowForm(false)} />
        </div>
      )}

      {!showForm && writeOk && (
        <div className="mb-6">
          <button onClick={() => setShowForm(true)}
            className="inline-flex items-center gap-2 bg-s112-teal text-white px-4 py-2 rounded-xl text-sm font-semibold hover:bg-opacity-90 transition-colors">
            Neues Mittel anlegen
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
                <th className="text-left text-xs text-s112-muted font-semibold py-2 pr-3">Kategorie</th>
                <th className="text-left text-xs text-s112-muted font-semibold py-2 pr-3">Wirkstoff</th>
                <th className="text-right text-xs text-s112-muted font-semibold py-2 pr-3">Cu-%</th>
                <th className="text-right text-xs text-s112-muted font-semibold py-2 pr-3">Max. kg/ha</th>
                <th className="text-right text-xs text-s112-muted font-semibold py-2 pr-3">Wartezeit</th>
                <th className="text-center text-xs text-s112-muted font-semibold py-2 pr-3">Bio</th>
                {(writeOk || adminOk) && (
                  <th className="py-2 px-3 sticky right-0 bg-white border-l border-s112-border" />
                )}
              </tr>
            </thead>
            <tbody>
              {psm.map(p => (
                <>
                  <tr key={p.id} className="group border-b border-s112-border/40 hover:bg-s112-bg/30">
                    <td className="py-2.5 pr-3 font-medium text-gray-900">
                      {p.name}
                      {p.handelsname && p.handelsname !== p.name && (
                        <span className="ml-1 text-xs text-s112-muted">({p.handelsname})</span>
                      )}
                    </td>
                    <td className="py-2.5 pr-3">
                      {p.kategorie ? (
                        <span className={`text-xs px-2 py-0.5 rounded-full border ${KAT_COLOR[p.kategorie] ?? 'bg-gray-50 text-gray-600 border-gray-200'}`}>
                          {KATEGORIE_OPTS.find(o => o.value === p.kategorie)?.label ?? p.kategorie}
                        </span>
                      ) : '–'}
                    </td>
                    <td className="py-2.5 pr-3 text-s112-muted text-xs">{p.wirkstoff ?? '–'}</td>
                    <td className="py-2.5 pr-3 text-right tabular-nums text-xs">
                      {p.cu_gehalt_pct ? (
                        <span className="text-blue-600 font-medium">{p.cu_gehalt_pct} %</span>
                      ) : '–'}
                    </td>
                    <td className="py-2.5 pr-3 text-right tabular-nums text-xs text-s112-muted">
                      {p.max_aufwand_kg_ha ? `${p.max_aufwand_kg_ha} kg/ha` : '–'}
                    </td>
                    <td className="py-2.5 pr-3 text-right tabular-nums text-xs text-s112-muted">
                      {p.wartezeit_tage ? `${p.wartezeit_tage} T` : '–'}
                    </td>
                    <td className="py-2.5 pr-3 text-center">
                      {p.oeko_zugelassen
                        ? <span className="text-green-600">Ja</span>
                        : <span className="text-gray-300">–</span>}
                    </td>
                    {(writeOk || adminOk) && (
                      <td className="py-2.5 px-3 text-right sticky right-0 bg-white border-l border-s112-border/40">
                        <div className="flex items-center justify-end gap-2">
                          {writeOk && (
                            <button onClick={() => setEditId(editId === p.id ? null : p.id)}
                              title="Bearbeiten" aria-label="Bearbeiten"
                              className="text-s112-teal hover:text-s112-teal/70"><Pencil className="w-4 h-4" /></button>
                          )}
                          {adminOk && (
                            <button onClick={() => handleDeactivate(p.id)}
                              title="Deaktivieren" aria-label="Deaktivieren"
                              className="text-red-400 hover:text-red-600"><Trash2 className="w-4 h-4" /></button>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                  {editId === p.id && (
                    <tr key={`edit-${p.id}`}>
                      <td colSpan={8} className="px-0 py-2">
                        <PSMForm psm={p} onDone={() => setEditId(null)} />
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
          {psm.length === 0 && (
            <p className="text-center py-12 text-s112-muted text-sm">
              Noch keine Pflanzenschutzmittel angelegt.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
