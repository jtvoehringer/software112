'use client'

import { useState, useTransition } from 'react'
import { updateMemberRole, updateMemberModule, removeMember, toggleMemberAktiv, resendInvite, inviteMember } from './actions'
import type { MemberWithEmail } from './actions'
import { MODULE, MODUL_VORLAGEN, type Modul } from '@/lib/auth/module'
import { Users, Info } from 'lucide-react'

function inputCls() {
  return 'w-full border border-s112-border rounded-lg px-3 py-1.5 text-sm focus:outline-hidden focus:ring-2 focus:ring-s112-teal/40'
}

// Benutzerkonzept (Beschluss Mgmt-Team 19.9.2026, Migration 218): drei vergebbare
// Rollen, Mitarbeiter mit Modulmatrix. Technische Schlüssel bleiben (tenant_admin,
// winzer, leser), nur die Anzeige ändert sich.
const ROLLEN = [
  { value: 'tenant_admin', label: 'Betriebs-Manager', hinweis: 'sieht alles, bearbeitet alles, verwaltet Benutzer und Einstellungen' },
  { value: 'winzer',       label: 'Mitarbeiter',      hinweis: 'sieht alles außer System-Administration, bearbeitet nur in den freigegebenen Modulen' },
  { value: 'leser',        label: 'Leser',            hinweis: 'sieht alles, bearbeitet nichts' },
]

const ROLE_COLORS: Record<string, string> = {
  system_admin: 'bg-s112-err-bg text-s112-err-fg',
  tenant_admin: 'bg-[#F2F3F5] text-s112-text-1',
  winzer:       'bg-s112-blue-100 text-s112-blue-700',
  leser:        'bg-[#F2F3F5] text-s112-text-2',
}

const ROLE_LABELS: Record<string, string> = {
  system_admin: 'Super-Admin',
  tenant_admin: 'Betriebs-Manager',
  winzer:       'Mitarbeiter',
  leser:        'Leser',
}

const MODUL_KURZ: Record<Modul, string> = {
  rieden: 'Rieden', kellerbuch: 'Kellerbuch', warenwirtschaft: 'Warenwirtschaft', crm: 'CRM', ea: 'E&A', auswertungen: 'Controlling/KI',
}

const gleich = (a: Modul[], b: Modul[]) => a.length === b.length && a.every(x => b.includes(x))

/** Modulmatrix mit Vorlagen – für Einladung und Bearbeitung */
function ModulMatrix({ module, onChange, disabled }: { module: Modul[]; onChange: (m: Modul[]) => void; disabled?: boolean }) {
  const toggle = (m: Modul) => onChange(module.includes(m) ? module.filter(x => x !== m) : [...module, m])
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        <span className="text-s112-muted mr-1">Vorlage:</span>
        {MODUL_VORLAGEN.map(v => {
          const aktiv = gleich(module, v.module)
          return (
            <button key={v.key} type="button" disabled={disabled} onClick={() => onChange([...v.module])} title={v.hinweis}
              className={`px-2.5 py-1 rounded-full border font-medium transition-colors disabled:opacity-50 ${aktiv ? 'bg-s112-teal text-s112-yellow border-s112-teal' : 'bg-white text-s112-text-1 border-s112-border hover:bg-s112-bg'}`}>
              {v.label}
            </button>
          )
        })}
      </div>
      <div className="grid sm:grid-cols-2 gap-x-4 gap-y-1.5">
        {MODULE.map(m => (
          <label key={m.key} className={`flex items-start gap-2 text-sm cursor-pointer ${disabled ? 'opacity-60' : ''}`} title={m.hinweis}>
            <input type="checkbox" checked={module.includes(m.key)} onChange={() => toggle(m.key)} disabled={disabled} className="mt-0.5 rounded-sm" />
            <span>
              <span className="font-medium text-s112-text">{m.label}</span>
              {m.key === 'ea' && <span className="ml-1.5 text-[11px] text-s112-warn-fg font-medium">Finanzdaten</span>}
              <span className="block text-[11.5px] text-s112-muted leading-snug">{m.hinweis}</span>
            </span>
          </label>
        ))}
      </div>
      {module.length === 0 && <p className="text-xs text-s112-warn-fg">Ohne Modul kann der Mitarbeiter nur lesen (wie ein Leser).</p>}
    </div>
  )
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
  const [selectedModule, setSelectedModule] = useState<Modul[]>([])
  const [error, setError]                 = useState<string | null>(null)
  const [success, setSuccess]             = useState<string | null>(null)
  const [isPending, startTransition]      = useTransition()

  // ── Neuen Benutzer hinzufügen ──
  const [showInvite, setShowInvite]   = useState(false)
  const [inviteName, setInviteName]   = useState('')
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole]   = useState('winzer')
  const [inviteModule, setInviteModule] = useState<Modul[]>([...MODUL_VORLAGEN[0].module])

  const handleInvite = (e: React.FormEvent) => {
    e.preventDefault()
    setError(null); setSuccess(null)
    startTransition(async () => {
      const result = await inviteMember(inviteEmail, inviteRole, inviteName, inviteRole === 'winzer' ? inviteModule : [])
      if (result?.error) setError(result.error)
      else {
        setSuccess(result.hinweis ?? `Einladung an ${inviteEmail} versandt.`)
        setInviteName(''); setInviteEmail(''); setInviteRole('winzer'); setInviteModule([...MODUL_VORLAGEN[0].module]); setShowInvite(false)
      }
    })
  }

  const handleEditRole = (m: MemberWithEmail) => {
    setEditingId(m.id)
    setSelectedRole(m.role)
    setSelectedModule(m.role === 'winzer' ? [...m.schreibmodule] : [...MODUL_VORLAGEN[0].module])
    setError(null); setSuccess(null)
  }

  const handleSaveRole = (m: MemberWithEmail) => {
    setError(null)
    startTransition(async () => {
      const result = selectedRole === m.role && m.role === 'winzer'
        ? await updateMemberModule(m.id, selectedModule)
        : await updateMemberRole(m.id, selectedRole, selectedRole === 'winzer' ? selectedModule : undefined)
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
        <div role="alert" className="mb-4 p-3 bg-s112-err-bg border border-s112-err/30 rounded-xl text-sm text-s112-err-fg">
          {error}
        </div>
      )}
      {success && (
        <div role="status" className="mb-4 p-3 bg-s112-ok-bg border border-s112-ok/30 rounded-xl text-sm text-s112-ok-fg">
          {success}
        </div>
      )}

      {/* ── Rollen erklärt ── */}
      <div className="mb-4 bg-s112-blue-50 border border-s112-blue-100 rounded-xl px-4 py-3 text-sm text-s112-text-1 flex gap-2.5">
        <Info className="w-4 h-4 mt-0.5 shrink-0 text-s112-blue-700" />
        <div>
          {ROLLEN.map((r, i) => (
            <span key={r.value}>{i > 0 && ' · '}<strong className="text-s112-text">{r.label}</strong> {r.hinweis}</span>
          ))}
          <span className="block mt-1 text-xs text-s112-muted">
            Mitarbeiter: Häkchen je Modul, Vorlagen „Rieden &amp; Keller“ und „Vertrieb“ zum schnellen Anlegen. Verkäufe verändern den Flaschenbestand auch ohne Kellerbuch-Recht; E&amp;A-Rechnung gibt Zugriff auf Bank, Belege und AfA – bewusst freigeben.
          </span>
        </div>
      </div>

      {/* ── Aktive Mitglieder ── */}
      <div className="card p-0 overflow-hidden mb-6">
        <div className="px-4 py-3 border-b border-s112-border flex items-center justify-between">
          <h2 className="font-semibold text-s112-text">Mitglieder</h2>
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
                <th className="text-left px-4 py-3 font-semibold text-s112-text-1">Rolle · Module</th>
                <th className="text-left px-4 py-3 font-semibold text-s112-text-1">Status</th>
                <th className="text-left px-4 py-3 font-semibold text-s112-text-1">Dabei seit</th>
                <th className="text-right px-4 py-3 font-semibold text-s112-text-1">Aktionen</th>
              </tr>
            </thead>
            <tbody>
              {members.map((m, i) => (
                <tr key={m.id} className={`border-b border-s112-border last:border-0 align-top ${i % 2 === 1 ? 'bg-s112-bg/50' : ''}`}>
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
                      <div className="space-y-2 min-w-[320px]">
                        <select
                          value={selectedRole}
                          onChange={e => setSelectedRole(e.target.value)}
                          className="border border-s112-border rounded-lg px-2 py-1 text-xs focus:outline-hidden focus:ring-2 focus:ring-s112-teal"
                          disabled={isPending}
                        >
                          {ROLLEN.map(r => (
                            <option key={r.value} value={r.value}>{r.label}</option>
                          ))}
                        </select>
                        {selectedRole === 'winzer' && (
                          <div className="bg-white border border-s112-border rounded-lg p-3">
                            <ModulMatrix module={selectedModule} onChange={setSelectedModule} disabled={isPending} />
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="flex flex-wrap items-center gap-1">
                        <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${ROLE_COLORS[m.role] ?? 'bg-[#F2F3F5] text-s112-text-2'}`}>
                          {ROLE_LABELS[m.role] ?? m.role}
                        </span>
                        {m.role === 'winzer' && (
                          m.schreibmodule.length === 0
                            ? <span className="text-[11px] text-s112-warn-fg">keine Module – nur lesen</span>
                            : (MODULE.filter(x => m.schreibmodule.includes(x.key)).map(x => (
                                <span key={x.key} className="inline-block px-1.5 py-0.5 rounded-sm text-[11px] bg-white border border-s112-border text-s112-text-1" title={x.hinweis}>{MODUL_KURZ[x.key]}</span>
                              )))
                        )}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {/* Mitgliedschaft de-/aktivieren (Migration 159) - bewusst für ALLE
                        Rollen inkl. system_admin sichtbar/bedienbar (im Unterschied zu
                        "Rolle ändern"/"Entfernen" unten), damit der Betriebs-Manager z.B.
                        einen Super-Admin-Zugriff für seinen Betrieb sperren kann. Die
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
                          <button onClick={() => handleSaveRole(m)} disabled={isPending}
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
                                {m.role === 'winzer' ? 'Rolle / Module ändern' : 'Rolle ändern'}
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
          className="inline-flex items-center gap-2 bg-s112-teal text-s112-yellow px-4 py-2 rounded-xl text-sm font-semibold hover:bg-s112-teal/90 disabled:opacity-40 disabled:cursor-not-allowed">
          <span>＋</span> Benutzer hinzufügen
        </button>
      ) : (
        <form onSubmit={handleInvite} className="bg-s112-bg border border-s112-border rounded-xl p-5 space-y-3">
          <h3 className="text-sm font-semibold text-s112-text">Benutzer hinzufügen</h3>
          <p className="text-xs text-s112-muted">
            Neuer Benutzer: erhält eine Einladungs-E-Mail zum Setzen des Passworts.<br />
            Bestehender Benutzer (anderer Betrieb): wird direkt zugewiesen.
          </p>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-s112-text-2 mb-1">Name *</label>
              <input aria-label="Name" value={inviteName} onChange={e => setInviteName(e.target.value)}
                required className={inputCls()} placeholder="Vorname Nachname" disabled={isPending} autoFocus />
            </div>
            <div>
              <label className="block text-xs font-medium text-s112-text-2 mb-1">E-Mail *</label>
              <input aria-label="E-Mail" type="email" value={inviteEmail} onChange={e => setInviteEmail(e.target.value)}
                required className={inputCls()} placeholder="benutzer@weingut.at" disabled={isPending} />
            </div>
            <div>
              <label className="block text-xs font-medium text-s112-text-2 mb-1">Rolle *</label>
              <select required aria-label="Rolle" value={inviteRole} onChange={e => setInviteRole(e.target.value)}
                className={inputCls()} disabled={isPending}>
                {ROLLEN.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
              <p className="text-[11px] text-s112-muted mt-1">{ROLLEN.find(r => r.value === inviteRole)?.hinweis}</p>
            </div>
          </div>
          {inviteRole === 'winzer' && (
            <div className="bg-white border border-s112-border rounded-lg p-3">
              <p className="text-xs font-medium text-s112-text-2 mb-2">Module, in denen der Mitarbeiter bearbeiten darf</p>
              <ModulMatrix module={inviteModule} onChange={setInviteModule} disabled={isPending} />
            </div>
          )}
          <div className="flex gap-2">
            <button type="submit" disabled={isPending}
              className="bg-s112-teal text-s112-yellow px-4 py-1.5 rounded-lg text-sm font-medium hover:bg-s112-teal/90 disabled:opacity-40">
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
        Super-Admins können über diese Seite nicht in der Rolle geändert oder entfernt
        werden - der Zugriff lässt sich aber über den Status (Aktiv/Inaktiv) sperren.
        Die eigene Mitgliedschaft ist durch RLS geschützt.
      </p>
    </>
  )
}
