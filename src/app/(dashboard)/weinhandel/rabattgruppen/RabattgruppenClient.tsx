'use client'

import { useState, useTransition } from 'react'
import { createRabattgruppe, updateRabattgruppe, deleteRabattgruppe } from './actions'
import type { Rabattgruppe } from './page'

function inputCls() {
  return 'w-full border border-s112-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40'
}

function RabattForm({
  initial, onDone,
}: {
  initial?: Rabattgruppe | null
  onDone: () => void
}) {
  const [pending, startTransition] = useTransition()

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    startTransition(async () => {
      if (initial) await updateRabattgruppe(initial.id, fd)
      else await createRabattgruppe(fd)
      onDone()
    })
  }

  return (
    <form onSubmit={handleSubmit} className="bg-s112-bg border border-s112-border rounded-xl p-5 space-y-3">
      <h3 className="text-sm font-semibold text-gray-800">
        {initial ? 'Rabattgruppe bearbeiten' : 'Neue Rabattgruppe'}
      </h3>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Bezeichnung *</label>
          <input name="name" defaultValue={initial?.name ?? ''} required
            placeholder="z.B. Stammkunde, Großhändler" className={inputCls()} />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Rabatt %</label>
          <input name="rabatt_pct" type="number" step="0.5" min="0" max="100"
            defaultValue={initial?.rabatt_pct ?? 0}
            placeholder="z.B. 10" className={inputCls()} />
        </div>
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">Notizen</label>
        <input name="notizen" defaultValue={initial?.notizen ?? ''}
          placeholder="Optional" className={inputCls()} />
      </div>
      <div className="flex gap-2">
        <button type="submit" disabled={pending}
          className="bg-s112-teal text-white px-4 py-1.5 rounded-lg text-sm font-medium hover:bg-opacity-90 disabled:opacity-40">
          {pending ? 'Speichern…' : (initial ? 'Speichern' : 'Anlegen')}
        </button>
        <button type="button" onClick={onDone}
          className="px-4 py-1.5 rounded-lg text-sm font-medium text-gray-600 hover:text-gray-800">
          Abbrechen
        </button>
      </div>
    </form>
  )
}

export default function RabattgruppenClient({
  gruppen, writeOk,
}: {
  gruppen: Rabattgruppe[]
  writeOk: boolean
}) {
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing]   = useState<Rabattgruppe | null>(null)
  const [pending, startTransition] = useTransition()

  function handleDelete(id: string, name: string) {
    if (!confirm(`Rabattgruppe "${name}" wirklich löschen?`)) return
    startTransition(async () => { await deleteRabattgruppe(id) })
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Rabattgruppen</h1>
          <p className="text-sm text-s112-muted mt-0.5">Kundenrabatte nach Kategorie verwalten</p>
        </div>
        {writeOk && !showForm && !editing && (
          <button onClick={() => setShowForm(true)}
            className="bg-s112-teal text-white px-4 py-2 rounded-xl text-sm font-semibold hover:bg-opacity-90">
            ＋ Neue Gruppe
          </button>
        )}
      </div>

      {showForm && (
        <RabattForm onDone={() => setShowForm(false)} />
      )}

      {gruppen.length === 0 && !showForm ? (
        <div className="card p-8 text-center text-s112-muted text-sm">
          Noch keine Rabattgruppen angelegt.
        </div>
      ) : (
        <div className="space-y-2">
          {gruppen.map(g => editing?.id === g.id ? (
            <RabattForm key={g.id} initial={g} onDone={() => setEditing(null)} />
          ) : (
            <div key={g.id} className="card p-4 flex items-center gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-3">
                  <span className="font-semibold text-gray-900">{g.name}</span>
                  <span className="text-sm font-bold text-s112-teal bg-s112-teal/10 px-2 py-0.5 rounded-full tabular-nums">
                    {g.rabatt_pct > 0 ? `${g.rabatt_pct}%` : 'Kein Rabatt'}
                  </span>
                </div>
                {g.notizen && (
                  <p className="text-xs text-s112-muted mt-0.5">{g.notizen}</p>
                )}
              </div>
              {writeOk && (
                <div className="flex gap-1 flex-shrink-0">
                  <button onClick={() => setEditing(g)}
                    title="Bearbeiten" aria-label="Bearbeiten"
                    className="text-s112-muted hover:text-s112-teal px-2 py-1 rounded transition-colors">
                    ✏️
                  </button>
                  <button onClick={() => handleDelete(g.id, g.name)} disabled={pending}
                    title="Löschen" aria-label="Löschen"
                    className="text-s112-muted hover:text-red-500 px-2 py-1 rounded transition-colors">
                    🗑️
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
