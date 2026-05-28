'use client'

import { useState, useTransition } from 'react'
import { inviteSystemAdmin, removeSystemAdmin } from './systemAdminActions'
import type { SystemAdminUser } from './page'

export default function SystemAdminClient({ admins }: { admins: SystemAdminUser[] }) {
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
        setSuccess(`Einladung an ${email} versandt.`)
        setEmail('')
        setShowInvite(false)
      }
    })
  }

  function handleRemove(m: SystemAdminUser) {
    if (!confirm(`System-Admin "${m.email}" wirklich entfernen?`)) return
    setError(null)
    startTransition(async () => {
      const result = await removeSystemAdmin(m.membershipId)
      if (result.error) setError(result.error)
    })
  }

  return (
    <div className="space-y-4">
      {error   && <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">{error}</div>}
      {success && <div className="p-3 bg-green-50 border border-green-200 rounded-xl text-sm text-green-700">{success}</div>}

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
                <td className="px-4 py-3 font-medium text-gray-900">{m.email}</td>
                <td className="px-4 py-3 text-xs text-s112-muted">{m.tenantName}</td>
                <td className="px-4 py-3 text-xs text-s112-muted tabular-nums">
                  {new Date(m.createdAt).toLocaleDateString('de-AT')}
                </td>
                <td className="px-4 py-3 text-right">
                  {admins.length > 1 && (
                    <button onClick={() => handleRemove(m)} disabled={pending}
                      className="text-xs text-red-400 hover:text-red-600 disabled:opacity-40">
                      Entfernen
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {!showInvite ? (
        <button onClick={() => setShowInvite(true)}
          className="inline-flex items-center gap-2 bg-s112-teal text-white px-4 py-2 rounded-xl text-sm font-semibold hover:bg-opacity-90">
          <span>＋</span> System-Admin einladen
        </button>
      ) : (
        <form onSubmit={handleInvite} className="bg-s112-bg border border-s112-border rounded-xl p-5 space-y-3">
          <h3 className="text-sm font-semibold text-gray-800">Neuen System-Admin einladen</h3>
          <p className="text-xs text-s112-muted">Der Benutzer erhält eine Einladungs-E-Mail von Supabase.</p>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">E-Mail-Adresse *</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)}
              required placeholder="admin@example.com"
              className="w-full border border-s112-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40"
              autoFocus />
          </div>
          <div className="flex gap-2">
            <button type="submit" disabled={pending}
              className="bg-s112-teal text-white px-4 py-1.5 rounded-lg text-sm font-medium hover:bg-opacity-90 disabled:opacity-40">
              {pending ? 'Wird eingeladen…' : 'Einladen'}
            </button>
            <button type="button" onClick={() => { setShowInvite(false); setEmail('') }}
              className="px-4 py-1.5 rounded-lg text-sm font-medium text-gray-600 hover:text-gray-800">
              Abbrechen
            </button>
          </div>
        </form>
      )}

      <p className="text-xs text-s112-muted">
        System-Admins haben Zugriff auf alle Mandanten und diese Verwaltungsseite.
        Mindestens ein System-Admin muss immer vorhanden sein.
      </p>
    </div>
  )
}
