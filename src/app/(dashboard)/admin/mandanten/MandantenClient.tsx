'use client'

import { useState, useTransition } from 'react'
import { createMandant, renameMandant } from './actions'
import type { MandantRow } from './page'

function inputCls() {
  return 'w-full border border-s112-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40'
}

// ── Neuer Mandant ─────────────────────────────────────────────────────────────

function NeuMandantForm({ onDone }: { onDone: () => void }) {
  const [pending, startTransition] = useTransition()

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    startTransition(async () => { await createMandant(fd); onDone() })
  }

  return (
    <form onSubmit={handleSubmit} className="bg-s112-bg border border-s112-border rounded-xl p-5 space-y-3">
      <h3 className="text-sm font-semibold text-gray-800">Neuer Mandant</h3>
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">Name des Betriebs *</label>
        <input name="name" required placeholder="z.B. Weingut Mustermann" className={inputCls()} autoFocus />
      </div>
      <div className="flex gap-2">
        <button type="submit" disabled={pending}
          className="bg-s112-teal text-white px-4 py-1.5 rounded-lg text-sm font-medium hover:bg-opacity-90 disabled:opacity-40">
          {pending ? 'Wird angelegt…' : 'Anlegen'}
        </button>
        <button type="button" onClick={onDone}
          className="px-4 py-1.5 rounded-lg text-sm font-medium text-gray-600 hover:text-gray-800">
          Abbrechen
        </button>
      </div>
    </form>
  )
}

// ── Mandant-Zeile ─────────────────────────────────────────────────────────────

function MandantZeile({ m }: { m: MandantRow }) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(m.name)
  const [pending, startTransition] = useTransition()

  function handleRename(e: React.FormEvent) {
    e.preventDefault()
    startTransition(async () => {
      await renameMandant(m.id, name)
      setEditing(false)
    })
  }

  return (
    <tr className="border-b border-s112-border/40 last:border-0 hover:bg-s112-bg/50">
      <td className="px-4 py-3">
        {editing ? (
          <form onSubmit={handleRename} className="flex gap-2 items-center">
            <input value={name} onChange={e => setName(e.target.value)}
              className="border border-s112-border rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40 w-56"
              autoFocus />
            <button type="submit" disabled={pending}
              className="text-xs text-white bg-s112-teal px-3 py-1 rounded-lg disabled:opacity-40">
              {pending ? '…' : 'OK'}
            </button>
            <button type="button" onClick={() => { setEditing(false); setName(m.name) }}
              className="text-xs text-gray-500 hover:text-gray-700">
              Abbrechen
            </button>
          </form>
        ) : (
          <div className="flex items-center gap-2">
            <span className="font-medium text-sm text-gray-900">{m.name}</span>
            <button onClick={() => setEditing(true)}
              className="text-xs text-s112-muted hover:text-s112-teal opacity-0 group-hover:opacity-100 transition-opacity px-1">
              ✏
            </button>
          </div>
        )}
      </td>
      <td className="px-4 py-3 text-xs text-s112-muted font-mono">{m.id.slice(0, 8)}…</td>
      <td className="px-4 py-3 text-xs text-s112-muted text-center">{m.benutzer_anzahl}</td>
      <td className="px-4 py-3 text-xs text-s112-muted tabular-nums">
        {new Date(m.erstellt_am).toLocaleDateString('de-AT')}
      </td>
    </tr>
  )
}

// ── Hauptkomponente ───────────────────────────────────────────────────────────

export default function MandantenClient({ mandanten }: { mandanten: MandantRow[] }) {
  const [showForm, setShowForm] = useState(false)

  return (
    <div className="space-y-4">
      {!showForm && (
        <button onClick={() => setShowForm(true)}
          className="inline-flex items-center gap-2 bg-s112-teal text-white px-4 py-2 rounded-xl text-sm font-semibold hover:bg-opacity-90">
          <span>＋</span> Neuer Mandant
        </button>
      )}

      {showForm && <NeuMandantForm onDone={() => setShowForm(false)} />}

      <div className="card p-0 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-s112-border bg-s112-bg">
              <th className="text-left px-4 py-2 text-xs font-semibold text-s112-muted">Name</th>
              <th className="text-left px-4 py-2 text-xs font-semibold text-s112-muted">ID</th>
              <th className="text-center px-4 py-2 text-xs font-semibold text-s112-muted">Benutzer</th>
              <th className="text-left px-4 py-2 text-xs font-semibold text-s112-muted">Erstellt</th>
            </tr>
          </thead>
          <tbody>
            {mandanten.map(m => <MandantZeile key={m.id} m={m} />)}
          </tbody>
        </table>
      </div>
    </div>
  )
}
