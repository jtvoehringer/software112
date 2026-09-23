'use client'

import Link from '@/components/ui/Link'
import { useState, useTransition } from 'react'
import { createMandant } from './actions'

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
      <h3 className="text-sm font-semibold text-s112-text">Neuer Mandant</h3>
      <div>
        <label className="block text-xs font-medium text-s112-text-2 mb-1">Name des Betriebs *</label>
        <input aria-label="Name des Betriebs" name="name" required placeholder="z.B. Weingut Mustermann"
          className="w-full border border-s112-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40"
          autoFocus />
      </div>
      <div className="flex gap-2">
        <button type="submit" disabled={pending}
          className="bg-s112-teal text-white px-4 py-1.5 rounded-lg text-sm font-medium hover:bg-opacity-90 disabled:opacity-40">
          {pending ? 'Wird angelegt…' : 'Anlegen'}
        </button>
        <button type="button" onClick={onDone}
          className="px-4 py-1.5 rounded-lg text-sm font-medium text-s112-text-2 hover:text-s112-text">
          Abbrechen
        </button>
      </div>
    </form>
  )
}

// ── Typen ──────────────────────────────────────────────────────────────────────

import type { MandantRow } from './page'

// ── Hauptkomponente ───────────────────────────────────────────────────────────

export default function MandantenClient({ mandanten, canCreate = true }: { mandanten: MandantRow[]; canCreate?: boolean }) {
  const [showForm, setShowForm] = useState(false)

  return (
    <div className="space-y-4">
      {/* "Neuer Mandant" nur für echte system_admin - die Sandbox-Sonderfreigabe
          (siehe isSandboxAdminUnlock) sieht diese Liste nur lesend, damit sie
          nie außerhalb der Sandbox einen echten neuen Mandanten anlegen kann,
          bei dem sie automatisch als system_admin eingetragen würde. */}
      {canCreate && !showForm && (
        <button onClick={() => setShowForm(true)}
          className="inline-flex items-center gap-2 bg-s112-teal text-white px-4 py-2 rounded-xl text-sm font-semibold hover:bg-opacity-90">
          <span>＋</span> Neuer Mandant
        </button>
      )}

      {canCreate && showForm && <NeuMandantForm onDone={() => setShowForm(false)} />}

      <div className="card p-0 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-s112-border bg-s112-bg">
              <th className="text-left px-4 py-2 text-xs font-semibold text-s112-muted">Name</th>
              <th className="text-left px-4 py-2 text-xs font-semibold text-s112-muted">Kundennummer</th>
              <th className="text-center px-4 py-2 text-xs font-semibold text-s112-muted">CD</th>
              <th className="text-center px-4 py-2 text-xs font-semibold text-s112-muted">Benutzer</th>
              <th className="text-left px-4 py-2 text-xs font-semibold text-s112-muted">Erstellt</th>
            </tr>
          </thead>
          <tbody>
            {mandanten.map(m => (
              <tr key={m.id} className="border-b border-s112-border/40 last:border-0 hover:bg-s112-bg/50">
                <td className="px-4 py-3">
                  <Link href={`/admin/mandanten/${m.id}`}
                    className="font-medium text-s112-blue-700 hover:underline text-sm">
                    {m.name}
                  </Link>
                  {m.anzeigename && m.anzeigename !== m.name && (
                    <span className="ml-2 text-xs text-s112-muted">({m.anzeigename})</span>
                  )}
                </td>
                <td className="px-4 py-3 text-xs font-mono" title={`ID ${m.id}`}>
                  {m.kundennummer
                    ? <span className="text-s112-text-1">{m.kundennummer}</span>
                    : <span className="text-s112-warn-fg" title="Wird vergeben, sobald die PLZ des Betriebs hinterlegt ist (Betrieb › Adresse)">noch keine – PLZ fehlt</span>}
                </td>
                <td className="px-4 py-3 text-center">
                  <div className="flex items-center justify-center gap-1.5">
                    <div className="w-4 h-4 rounded-full border border-s112-line flex-shrink-0"
                      style={{ background: m.primary_color }} title={m.primary_color} />
                    <div className="w-4 h-4 rounded-full border border-s112-line flex-shrink-0"
                      style={{ background: m.secondary_color }} title={m.secondary_color} />
                  </div>
                </td>
                <td className="px-4 py-3 text-xs text-s112-muted text-center">{m.benutzer_anzahl}</td>
                <td className="px-4 py-3 text-xs text-s112-muted tabular-nums">
                  {new Date(m.erstellt_am).toLocaleDateString('de-AT')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
