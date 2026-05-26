'use client'

import { useState, useTransition } from 'react'
import { updateMemberRole, removeMember } from './actions'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

const ROLLEN = [
  { value: 'tenant_admin', label: 'Betriebsleiter' },
  { value: 'winzer',       label: 'Winzer/Kellermeister' },
  { value: 'leser',        label: 'Nur-Lesen' },
]

const ROLE_COLORS: Record<string, string> = {
  system_admin: 'bg-red-100 text-red-700',
  tenant_admin: 'bg-purple-100 text-purple-700',
  winzer:       'bg-blue-100 text-blue-700',
  leser:        'bg-gray-100 text-gray-600',
}

const ROLE_LABELS: Record<string, string> = {
  system_admin: 'System-Admin',
  tenant_admin: 'Betriebsleiter',
  winzer:       'Winzer/Kellermeister',
  leser:        'Nur-Lesen',
}

interface Props {
  members: R[]
  currentMembershipId: string
}

export default function BenutzerClient({ members, currentMembershipId }: Props) {
  const [editingId, setEditingId]     = useState<string | null>(null)
  const [selectedRole, setSelectedRole] = useState<string>('')
  const [error, setError]             = useState<string | null>(null)
  const [isPending, startTransition]  = useTransition()

  const handleEditRole = (member: R) => {
    setEditingId(member.id)
    setSelectedRole(member.role)
    setError(null)
  }

  const handleSaveRole = (membershipId: string) => {
    setError(null)
    startTransition(async () => {
      const result = await updateMemberRole(membershipId, selectedRole)
      if (result?.error) {
        setError(result.error)
      } else {
        setEditingId(null)
      }
    })
  }

  const handleRemove = (membershipId: string) => {
    if (!confirm('Mitglied wirklich entfernen?')) return
    setError(null)
    startTransition(async () => {
      const result = await removeMember(membershipId)
      if (result?.error) setError(result.error)
    })
  }

  if (members.length === 0) {
    return (
      <div className="card text-center py-16">
        <p className="text-4xl mb-4">👥</p>
        <p className="text-gray-700 font-medium">Keine Mitglieder gefunden</p>
        <p className="text-s112-muted text-sm mt-1">Laden Sie Mitarbeiter über Supabase ein.</p>
      </div>
    )
  }

  return (
    <>
      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="card p-0 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-s112-bg border-b border-s112-border">
              <th className="text-left px-4 py-3 font-semibold text-gray-700">User-ID</th>
              <th className="text-left px-4 py-3 font-semibold text-gray-700">Rolle</th>
              <th className="text-left px-4 py-3 font-semibold text-gray-700">Mitglied seit</th>
              <th className="text-right px-4 py-3 font-semibold text-gray-700">Aktionen</th>
            </tr>
          </thead>
          <tbody>
            {members.map((m: R, i: number) => (
              <tr key={m.id} className={`border-b border-s112-border last:border-0 ${i % 2 === 1 ? 'bg-s112-bg/50' : ''}`}>
                <td className="px-4 py-3 font-mono text-xs text-s112-muted">
                  {m.user_id?.slice(0, 8)}…
                </td>
                <td className="px-4 py-3">
                  {editingId === m.id ? (
                    <select
                      value={selectedRole}
                      onChange={e => setSelectedRole(e.target.value)}
                      className="border border-s112-border rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-s112-teal"
                      disabled={isPending}
                    >
                      {ROLLEN.map(r => (
                        <option key={r.value} value={r.value}>{r.label}</option>
                      ))}
                    </select>
                  ) : (
                    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${ROLE_COLORS[m.role] ?? 'bg-gray-100 text-gray-600'}`}>
                      {ROLE_LABELS[m.role] ?? m.role}
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-s112-muted text-xs">
                  {m.created_at ? new Date(m.created_at).toLocaleDateString('de-AT') : '–'}
                </td>
                <td className="px-4 py-3 text-right">
                  <div className="flex items-center justify-end gap-3">
                    {editingId === m.id ? (
                      <>
                        <button
                          onClick={() => handleSaveRole(m.id)}
                          disabled={isPending}
                          className="text-s112-teal hover:underline text-xs font-semibold disabled:opacity-50"
                        >
                          Speichern
                        </button>
                        <button
                          onClick={() => setEditingId(null)}
                          disabled={isPending}
                          className="text-s112-muted hover:text-gray-700 text-xs"
                        >
                          Abbrechen
                        </button>
                      </>
                    ) : (
                      <>
                        {m.role !== 'system_admin' && (
                          <>
                            <button
                              onClick={() => handleEditRole(m)}
                              className="text-s112-teal hover:underline text-xs font-medium"
                            >
                              Rolle ändern
                            </button>
                            <button
                              onClick={() => handleRemove(m.id)}
                              disabled={isPending}
                              className="text-red-400 hover:text-red-600 text-xs disabled:opacity-50"
                            >
                              Entfernen
                            </button>
                          </>
                        )}
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-s112-muted mt-3">
        * System-Admins können nicht über diese Seite bearbeitet werden.
        Die eigene Rolle kann nicht geändert werden (RLS-Schutz).
      </p>
    </>
  )
}
