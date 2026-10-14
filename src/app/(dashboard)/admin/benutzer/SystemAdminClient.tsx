'use client'

import { useState, useTransition } from 'react'
import { inviteSystemAdmin, removeSystemAdmin } from './systemAdminActions'
import type { SystemAdminUser } from './page'

export default function SystemAdminClient({ admins, canInvite = true }: { admins: SystemAdminUser[]; canInvite?: boolean }) {
  const [showInvite, setShowInvite]   = useState(false)
  const [email, setEmail]             = useState('')
  const [error, setError]             = useState<string | null>(null)
  const [success, setSuccess]         = useState<string | null>(null)
  const [pending, startTransition]    = useTransition()

  function handleInvite(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSuccess(null)
    startTransition(async () => {
      const result = await inviteSystemAdmin(email)
      if (result.error) {
        setError(result.error)
      } else {
        setSuccess(result.hinweis ?? `Einladung an ${email} versandt.`)
        setEmail('')
        setShowInvite(false)
      }
    })
  }

  function handleRemove(m: SystemAdminUser) {
    if (!confirm(`Super-Admin-Rolle von "${m.email}" im Betrieb "${m.tenantName}" entfernen? Mit der letzten Rolle endet auch der Plattform-Admin.`)) return
    setError(null)
    startTransition(async () => {
      const result = await removeSystemAdmin(m.membershipId)
      if (result.error) setError(result.error)
    })
  }

  return (
    <div className="space-y-4">
      {error   && <div role="alert" className="p-3 bg-s112-err-bg border border-s112-err/30 rounded-xl text-sm text-s112-err-fg">{error}</div>}
      {success && <div role="status" className="p-3 bg-s112-ok-bg border border-s112-ok/30 rounded-xl text-sm text-s112-ok-fg">{success}</div>}

      <div className="card p-0 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-s112-border bg-s112-bg">
              <th className="text-left px-4 py-2 text-xs font-semibold text-s112-muted">E-Mail</th>
              <th className="text-left px-4 py-2 text-xs font-semibold text-s112-muted">Tenant</th>
              <th className="text-left px-4 py-2 text-xs font-semibold text-s112-muted">Seit</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody>
            {admins.map(m => (
              <tr key={m.membershipId} className="border-b border-s112-border/40 last:border-0 hover:bg-s112-bg/50">
                <td className="px-4 py-3 font-medium text-s112-text">{m.email}</td>
                <td className="px-4 py-3 text-xs text-s112-muted">{m.tenantName}</td>
                <td className="px-4 py-3 text-xs text-s112-muted tabular-nums">
                  {new Date(m.createdAt).toLocaleDateString('de-AT')}
                </td>
                <td className="px-4 py-3 text-right">
                  {canInvite && admins.length > 1 && (
                    <button onClick={() => handleRemove(m)} disabled={pending}
                      className="text-xs text-s112-err hover:text-s112-err-fg disabled:opacity-40">
                      Entfernen
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {canInvite && (!showInvite ? (
        <button onClick={() => setShowInvite(true)}
          className="inline-flex items-center gap-2 bg-s112-teal text-s112-yellow px-4 py-2 rounded-xl text-sm font-semibold hover:bg-s112-teal/90">
          <span>＋</span> Plattform-Admin einladen
        </button>
      ) : (
        <form onSubmit={handleInvite} className="bg-s112-bg border border-s112-border rounded-xl p-5 space-y-3">
          <h3 className="text-sm font-semibold text-s112-text">Neuen Plattform-Admin einladen</h3>
          {/* KAN-18: Super-Admin = Plattform-Admin (Entscheidung Jörgen, 06.10.2026) */}
          <p className="text-xs text-s112-muted">
            Die Person wird <strong>Plattform-Admin</strong>: Super-Admin in <strong>allen bestehenden und künftigen Betrieben</strong>,
            mit Zugriff auf alle Betriebsdaten und die Plattform-Verwaltung (Mandanten, Pakete, Release Notes, Plattform-Admins).
            Neue Konten erhalten eine Einladungs-E-Mail.
          </p>
          <div>
            <label className="block text-xs font-medium text-s112-text-2 mb-1">E-Mail-Adresse *</label>
            <input aria-label="E-Mail-Adresse" type="email" value={email} onChange={e => setEmail(e.target.value)}
              required placeholder="admin@example.com"
              className="w-full border border-s112-border rounded-lg px-3 py-1.5 text-sm focus:outline-hidden focus:ring-2 focus:ring-s112-teal/40"
              autoFocus />
          </div>
          <div className="flex gap-2">
            <button type="submit" disabled={pending}
              className="bg-s112-teal text-s112-yellow px-4 py-1.5 rounded-lg text-sm font-medium hover:bg-s112-teal/90 disabled:opacity-40">
              {pending ? 'Wird eingeladen…' : 'Einladen'}
            </button>
            <button type="button" onClick={() => { setShowInvite(false); setEmail('') }}
              className="px-4 py-1.5 rounded-lg text-sm font-medium text-s112-text-2 hover:text-s112-text">
              Abbrechen
            </button>
          </div>
        </form>
      ))}

      <p className="text-xs text-s112-muted">
        {canInvite
          ? 'Plattform-Admins sind in jedem Betrieb Super-Admin (neue Betriebe automatisch) und verwalten die Plattform. Mindestens ein Plattform-Admin muss immer vorhanden sein.'
          : 'Nur lesbar: diese Ansicht zeigt in der Sandbox ausschließlich etwaige Super-Admins des Sandbox-Mandanten selbst.'}
      </p>
    </div>
  )
}
