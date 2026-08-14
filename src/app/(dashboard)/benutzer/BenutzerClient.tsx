'use client'

import { useState, useTransition } from 'react'
import { updateMemberRole, removeMember, assignUserToTenant, toggleMemberAktiv } from './actions'
import type { MemberWithEmail, UnassignedUser } from './actions'
import { Users } from 'lucide-react'

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
  members:    MemberWithEmail[]
  unassigned: UnassignedUser[]
}

export default function BenutzerClient({ members, unassigned }: Props) {
  const [editingId, setEditingId]         = useState<string | null>(null)
  const [selectedRole, setSelectedRole]   = useState<string>('')
  const [assignUserId, setAssignUserId]   = useState<string>('')
  const [assignRole, setAssignRole]       = useState<string>('winzer')
  const [showAssign, setShowAssign]       = useState(false)
  const [error, setError]                 = useState<string | null>(null)
  const [isPending, startTransition]      = useTransition()

  const handleEditRole = (m: MemberWithEmail) => {
    setEditingId(m.id)
    setSelectedRole(m.role)
    setError(null)
  }

  const handleSaveRole = (membershipId: string) => {
    setError(null)
    startTransition(async () => {
      const result = await updateMemberRole(membershipId, selectedRole)
      if (result?.error) setError(result.error)
      else setEditingId(null)
    })
  }

  const handleRemove = (membershipId: string, email: string) => {
    if (!confirm(`Mitglied "${email}" wirklich entfernen?`)) return
    setError(null)
    startTransition(async () => {
      const result = await removeMember(membershipId)
      if (result?.error) setError(result.error)
    })
  }

  const handleToggleAktiv = (membershipId: string, aktivNeu: boolean) => {
    setError(null)
    startTransition(async () => {
      const result = await toggleMemberAktiv(membershipId, aktivNeu)
      if (result?.error) setError(result.error)
    })
  }

  const handleAssign = () => {
    if (!assignUserId) return
    setError(null)
    startTransition(async () => {
      const result = await assignUserToTenant(assignUserId, assignRole)
      if (result?.error) {
        setError(result.error)
      } else {
        setShowAssign(false)
        setAssignUserId('')
        setAssignRole('winzer')
      }
    })
  }

  return (
    <>
      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
          {error}
        </div>
      )}

      {/* ── Aktive Mitglieder ── */}
      <div className="card p-0 overflow-hidden mb-6">
        <div className="px-4 py-3 border-b border-s112-border flex items-center justify-between">
          <h2 className="font-semibold text-gray-800">Aktive Mitglieder</h2>
          <span className="text-xs text-s112-muted">{members.length} Mitglied{members.length !== 1 ? 'er' : ''}</span>
        </div>

        {members.length === 0 ? (
          <div className="text-center py-10">
            <Users size={32} strokeWidth={1.5} className="mx-auto mb-3 text-s112-tertiary" />
            <p className="text-sm text-s112-muted">Noch keine Mitglieder zugewiesen</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-s112-bg border-b border-s112-border">
                <th className="text-left px-4 py-3 font-semibold text-gray-700">E-Mail</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-700">Rolle</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-700">Status</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-700">Dabei seit</th>
                <th className="text-right px-4 py-3 font-semibold text-gray-700">Aktionen</th>
              </tr>
            </thead>
            <tbody>
              {members.map((m, i) => (
                <tr key={m.id} className={`border-b border-s112-border last:border-0 ${i % 2 === 1 ? 'bg-s112-bg/50' : ''}`}>
                  <td className="px-4 py-3 font-medium text-gray-900">{m.email}</td>
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
                  <td className="px-4 py-3">
                    {/* Mitgliedschaft de-/aktivieren (Migration 159) - bewusst für ALLE
                        Rollen inkl. system_admin sichtbar/bedienbar (im Unterschied zu
                        "Rolle ändern"/"Entfernen" unten), damit der Betriebsleiter z.B.
                        einen System-Admin-Zugriff für seinen Betrieb sperren kann. Die
                        eigene Mitgliedschaft ist serverseitig geschützt (siehe actions.ts). */}
                    <button
                      type="button"
                      disabled={isPending}
                      onClick={() => {
                        if (m.aktiv && !confirm(`Zugriff für "${m.email}" auf diesen Betrieb wirklich deaktivieren?`)) return
                        handleToggleAktiv(m.id, !m.aktiv)
                      }}
                      title={m.aktiv ? 'Klicken zum Deaktivieren' : 'Klicken zum Aktivieren'}
                      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium transition-colors disabled:opacity-50 ${
                        m.aktiv
                          ? 'bg-s112-teal/10 text-s112-teal hover:bg-s112-teal/20'
                          : 'bg-red-100 text-red-700 hover:bg-red-200'
                      }`}
                    >
                      <span className={`w-1.5 h-1.5 rounded-full ${m.aktiv ? 'bg-s112-teal' : 'bg-red-500'}`} />
                      {m.aktiv ? 'Aktiv' : 'Inaktiv'}
                    </button>
                  </td>
                  <td className="px-4 py-3 text-s112-muted text-xs">
                    {m.created_at ? new Date(m.created_at).toLocaleDateString('de-AT') : '–'}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-3">
                      {editingId === m.id ? (
                        <>
                          <button onClick={() => handleSaveRole(m.id)} disabled={isPending}
                            className="text-s112-teal hover:underline text-xs font-semibold disabled:opacity-50">
                            Speichern
                          </button>
                          <button onClick={() => setEditingId(null)} disabled={isPending}
                            className="text-s112-muted hover:text-gray-700 text-xs">
                            Abbrechen
                          </button>
                        </>
                      ) : (
                        <>
                          {m.role !== 'system_admin' && (
                            <>
                              <button onClick={() => handleEditRole(m)}
                                className="text-s112-teal hover:underline text-xs font-medium">
                                Rolle ändern
                              </button>
                              <button onClick={() => handleRemove(m.id, m.email)} disabled={isPending}
                                className="text-red-400 hover:text-red-600 text-xs disabled:opacity-50">
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
        )}
      </div>

      {/* ── User zuweisen ── */}
      {unassigned.length > 0 && (
        <div className="card">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h2 className="font-semibold text-gray-800">Benutzer zuweisen</h2>
              <p className="text-xs text-s112-muted mt-0.5">
                Diese Benutzer existieren in Supabase, sind aber noch nicht diesem Betrieb zugewiesen.
              </p>
            </div>
            <button
              onClick={() => setShowAssign(!showAssign)}
              className="text-xs text-s112-teal font-semibold hover:underline"
            >
              {showAssign ? 'Schließen' : '+ Zuweisen'}
            </button>
          </div>

          {showAssign && (
            <div className="border border-s112-border rounded-xl p-4 bg-s112-bg">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div className="sm:col-span-2">
                  <label className="block text-xs font-medium text-gray-700 mb-1">Benutzer</label>
                  <select
                    value={assignUserId}
                    onChange={e => setAssignUserId(e.target.value)}
                    className="w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal"
                    disabled={isPending}
                  >
                    <option value="">— Bitte wählen —</option>
                    {unassigned.map(u => (
                      <option key={u.user_id} value={u.user_id}>{u.email}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Rolle</label>
                  <select
                    value={assignRole}
                    onChange={e => setAssignRole(e.target.value)}
                    className="w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal"
                    disabled={isPending}
                  >
                    {ROLLEN.map(r => (
                      <option key={r.value} value={r.value}>{r.label}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="mt-3 flex justify-end">
                <button
                  onClick={handleAssign}
                  disabled={!assignUserId || isPending}
                  className="bg-s112-teal text-white px-4 py-2 rounded-xl text-sm font-semibold hover:bg-opacity-90 disabled:opacity-40 transition-colors"
                >
                  {isPending ? 'Wird zugewiesen…' : 'Zuweisen'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      <p className="text-xs text-s112-muted mt-4">
        System-Admins können über diese Seite nicht in der Rolle geändert oder entfernt
        werden - der Zugriff lässt sich aber über den Status (Aktiv/Inaktiv) sperren.
        Die eigene Mitgliedschaft ist durch RLS geschützt.
      </p>
    </>
  )
}
