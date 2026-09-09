'use client'

import { useState, useTransition } from 'react'
import { updateMemberRole, removeMember, toggleMemberAktiv, resendInvite, inviteMember } from './actions'
import type { MemberWithEmail } from './actions'
import { Users } from 'lucide-react'

function inputCls() {
  return 'w-full border border-s112-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40'
}

const ROLLEN = [
  { value: 'tenant_admin', label: 'Betriebsleiter' },
  { value: 'winzer',       label: 'Winzer/Kellermeister' },
  { value: 'leser',        label: 'Nur-Lesen' },
]

const ROLE_COLORS: Record<string, string> = {
  system_admin: 'bg-s112-err-bg text-s112-err-fg',
  tenant_admin: 'bg-[#F2F3F5] text-s112-text-1',
  winzer:       'bg-s112-blue-100 text-s112-blue-700',
  leser:        'bg-[#F2F3F5] text-s112-text-2',
}

const ROLE_LABELS: Record<string, string> = {
  system_admin: 'System-Admin',
  tenant_admin: 'Betriebsleiter',
  winzer:       'Winzer/Kellermeister',
  leser:        'Nur-Lesen',
}

interface Props {
  members: MemberWithEmail[]
  /** Benutzerlimit des Pakets (Migration 194): anzahl = aktive Benutzer ohne
   *  Plattform-Admins, limit = null bei unbegrenzt. Optional, damit die
   *  Komponente auch ohne Limit-Info nutzbar bleibt. */
  limit?: { anzahl: number; limit: number | null; erlaubt: boolean }
}

export default function BenutzerClient({ members, limit }: Props) {
  const [editingId, setEditingId]         = useState<string | null>(null)
  const [selectedRole, setSelectedRole]   = useState<string>('')
  const [error, setError]                 = useState<string | null>(null)
  const [success, setSuccess]             = useState<string | null>(null)
  const [isPending, startTransition]      = useTransition()

  // ── Neuen Benutzer hinzufügen ──
  const [showInvite, setShowInvite]   = useState(false)
  const [inviteName, setInviteName]   = useState('')
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole]   = useState('winzer')

  const handleInvite = (e: React.FormEvent) => {
    e.preventDefault()
    setError(null); setSuccess(null)
    startTransition(async () => {
      const result = await inviteMember(inviteEmail, inviteRole, inviteName)
      if (result?.error) setError(result.error)
      else {
        setSuccess(`Einladung an ${inviteEmail} versandt.`)
        setInviteName(''); setInviteEmail(''); setInviteRole('winzer'); setShowInvite(false)
      }
    })
  }

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

  const handleResendInvite = (m: MemberWithEmail) => {
    setError(null); setSuccess(null)
    startTransition(async () => {
      const result = await resendInvite(m.user_id)
      if (result?.error) setError(result.error)
      else setSuccess(`Neue Einladung an ${m.email} versandt.`)
    })
  }

  return (
    <>
      {error && (
        <div className="mb-4 p-3 bg-s112-err-bg border border-s112-err/30 rounded-xl text-sm text-s112-err-fg">
          {error}
        </div>
      )}
      {success && (
        <div className="mb-4 p-3 bg-s112-ok-bg border border-s112-ok/30 rounded-xl text-sm text-s112-ok-fg">
          {success}
        </div>
      )}

      {/* ── Aktive Mitglieder ── */}
      <div className="card p-0 overflow-hidden mb-6">
        <div className="px-4 py-3 border-b border-s112-border flex items-center justify-between">
          <h2 className="font-semibold text-s112-text">Aktive Mitglieder</h2>
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
                <th className="text-left px-4 py-3 font-semibold text-s112-text-1">E-Mail</th>
                <th className="text-left px-4 py-3 font-semibold text-s112-text-1">Rolle</th>
                <th className="text-left px-4 py-3 font-semibold text-s112-text-1">Status</th>
                <th className="text-left px-4 py-3 font-semibold text-s112-text-1">Dabei seit</th>
                <th className="text-right px-4 py-3 font-semibold text-s112-text-1">Aktionen</th>
              </tr>
            </thead>
            <tbody>
              {members.map((m, i) => (
                <tr key={m.id} className={`border-b border-s112-border last:border-0 ${i % 2 === 1 ? 'bg-s112-bg/50' : ''}`}>
                  <td className="px-4 py-3 font-medium text-s112-text">
                    {m.email}
                    {!m.confirmed && (
                      <span className="ml-2 inline-block px-2 py-0.5 rounded-full text-xs font-medium bg-s112-warn-bg text-s112-warn-fg"
                        title="Einladung verschickt, aber noch nicht angenommen">
                        Ausstehend
                      </span>
                    )}
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
                      <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${ROLE_COLORS[m.role] ?? 'bg-[#F2F3F5] text-s112-text-2'}`}>
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
                          ? 'bg-s112-teal/10 text-s112-blue-700 hover:bg-s112-teal/20'
                          : 'bg-s112-err-bg text-s112-err-fg hover:bg-s112-err-fg/25'
                      }`}
                    >
                      <span className={`w-1.5 h-1.5 rounded-full ${m.aktiv ? 'bg-s112-teal' : 'bg-s112-err'}`} />
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
                            className="text-s112-blue-700 hover:underline text-xs font-semibold disabled:opacity-50">
                            Speichern
                          </button>
                          <button onClick={() => setEditingId(null)} disabled={isPending}
                            className="text-s112-muted hover:text-s112-text-1 text-xs">
                            Abbrechen
                          </button>
                        </>
                      ) : (
                        <>
                          {!m.confirmed && (
                            <button onClick={() => handleResendInvite(m)} disabled={isPending}
                              className="text-s112-blue-700 hover:underline text-xs font-medium disabled:opacity-50">
                              Einladung erneut senden
                            </button>
                          )}
                          {m.role !== 'system_admin' && (
                            <>
                              <button onClick={() => handleEditRole(m)}
                                className="text-s112-blue-700 hover:underline text-xs font-medium">
                                Rolle ändern
                              </button>
                              <button onClick={() => handleRemove(m.id, m.email)} disabled={isPending}
                                className="text-s112-err hover:text-s112-err-fg text-xs disabled:opacity-50">
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

      {limit && limit.limit !== null && (
        <p className={`text-xs ${limit.erlaubt ? 'text-s112-muted' : 'text-s112-warn-fg'}`}>
          {limit.anzahl} von {limit.limit} Benutzern Ihres Pakets belegt.
          {!limit.erlaubt && <> Für weitere Benutzer können Sie Ihr Paket unter <a href="/abo" className="underline">Abo</a> erweitern.</>}
        </p>
      )}

      {!showInvite ? (
        <button onClick={() => setShowInvite(true)}
          disabled={!!limit && !limit.erlaubt}
          title={limit && !limit.erlaubt ? 'Benutzerlimit des Pakets erreicht' : undefined}
          className="inline-flex items-center gap-2 bg-s112-teal text-white px-4 py-2 rounded-xl text-sm font-semibold hover:bg-opacity-90 disabled:opacity-40 disabled:cursor-not-allowed">
          <span>＋</span> Benutzer hinzufügen
        </button>
      ) : (
        <form onSubmit={handleInvite} className="bg-s112-bg border border-s112-border rounded-xl p-5 space-y-3">
          <h3 className="text-sm font-semibold text-s112-text">Benutzer hinzufügen</h3>
          <p className="text-xs text-s112-muted">
            Neuer Benutzer: erhält Einladungs-E-Mail von Supabase zum Passwort setzen.<br />
            Bestehender Supabase-User: wird direkt zugewiesen.
          </p>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-s112-text-2 mb-1">Name *</label>
              <input value={inviteName} onChange={e => setInviteName(e.target.value)}
                required className={inputCls()} placeholder="Vorname Nachname" disabled={isPending} autoFocus />
            </div>
            <div>
              <label className="block text-xs font-medium text-s112-text-2 mb-1">E-Mail *</label>
              <input type="email" value={inviteEmail} onChange={e => setInviteEmail(e.target.value)}
                required className={inputCls()} placeholder="benutzer@weingut.at" disabled={isPending} />
            </div>
            <div>
              <label className="block text-xs font-medium text-s112-text-2 mb-1">Rolle *</label>
              <select value={inviteRole} onChange={e => setInviteRole(e.target.value)}
                className={inputCls()} disabled={isPending}>
                {ROLLEN.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
            </div>
          </div>
          <div className="flex gap-2">
            <button type="submit" disabled={isPending}
              className="bg-s112-teal text-white px-4 py-1.5 rounded-lg text-sm font-medium hover:bg-opacity-90 disabled:opacity-40">
              {isPending ? 'Wird eingeladen…' : 'Einladen'}
            </button>
            <button type="button" onClick={() => { setShowInvite(false); setInviteName(''); setInviteEmail('') }}
              className="px-4 py-1.5 rounded-lg text-sm font-medium text-s112-text-2 hover:text-s112-text">
              Abbrechen
            </button>
          </div>
        </form>
      )}

      <p className="text-xs text-s112-muted mt-4">
        System-Admins können über diese Seite nicht in der Rolle geändert oder entfernt
        werden - der Zugriff lässt sich aber über den Status (Aktiv/Inaktiv) sperren.
        Die eigene Mitgliedschaft ist durch RLS geschützt.
      </p>
    </>
  )
}
