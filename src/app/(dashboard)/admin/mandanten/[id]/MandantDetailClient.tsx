'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState, useTransition, useRef } from 'react'
import { CheckCircle2, AlertTriangle, Pencil } from 'lucide-react'
import {
  saveTenantSettings,
  uploadTenantLogo,
  inviteUserToTenant,
  resendInvite,
  updateMemberRoleAdmin,
  updateMemberNameAdmin,
  removeMemberAdmin,
  renameTenantAdmin,
  saveVerkaufEinstellungen,
  saveEmailEinstellungen,
  saveM365Einstellungen,
  saveBetriebEinstellungen,
  resetRechnungsZaehler,
  resetKundenZaehler,
  saveSumUpConfig,
  saveBawbZugangsdaten,
  createStripeCustomer,
  createStripeCheckoutSession,
  createStripePortalSession,
  cancelStripeSubscription,
} from './actions'
import { STRIPE_STATUS_META, STRIPE_PLAN_LABELS } from '@/lib/stripe/client'
import type { TenantDetail, TenantSettings, TenantMember } from './page'

// ── Hilfsfunktionen ───────────────────────────────────────────────────────────

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

const BIO_STATUS_OPTS = [
  { value: 'konventionell', label: 'Konventionell' },
  { value: 'kip',           label: 'KIP (kontrolliert integrierte Produktion)' },
  { value: 'nachhaltig',    label: 'Nachhaltig' },
  { value: 'bio_eu',        label: 'Bio-EU' },
  { value: 'biodynamisch',  label: 'Biodynamisch' },
]

function inputCls() {
  return 'w-full border border-s112-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40'
}

function Toggle({ on, onToggle, label }: { on: boolean; onToggle: () => void; label: string }) {
  return (
    <label className="flex items-center gap-3 cursor-pointer">
      <div onClick={onToggle}
        className={`w-9 h-5 rounded-full transition-colors flex-shrink-0 ${on ? 'bg-s112-teal' : 'bg-gray-300'}`}>
        <div className={`w-4 h-4 bg-white rounded-full shadow mt-0.5 transition-transform ${on ? 'translate-x-4' : 'translate-x-0.5'}`} />
      </div>
      <span className="text-sm text-gray-700">{label}</span>
    </label>
  )
}

// ── Tab: Branding ─────────────────────────────────────────────────────────────

function BrandingTab({ tenant, settings }: { tenant: TenantDetail; settings: TenantSettings }) {
  const router                     = useRouter()
  const [pending, startTransition] = useTransition()
  const [saved, setSaved]          = useState(false)
  const [primary, setPrimary]      = useState(settings.primary_color)
  const [secondary, setSecondary]  = useState(settings.secondary_color)
  const [logoUrl, setLogoUrl]      = useState(settings.logo_url ?? '')
  const [logoUploading, setLogoUploading] = useState(false)
  const [logoError, setLogoError]  = useState<string | null>(null)
  const logoInputRef               = useRef<HTMLInputElement>(null)

  function handleLogoFile(file: File) {
    setLogoUploading(true)
    setLogoError(null)
    const fd = new FormData()
    fd.append('file', file)
    startTransition(async () => {
      const result = await uploadTenantLogo(tenant.id, fd)
      setLogoUploading(false)
      if (result.error) setLogoError(result.error)
      else if (result.url) setLogoUrl(result.url)
    })
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    fd.set('modul_newsletter', settings.modul_newsletter ? 'true' : 'false')
    fd.set('modul_crm',        settings.modul_crm        ? 'true' : 'false')
    fd.set('modul_kellerbuch', settings.modul_kellerbuch  ? 'true' : 'false')
    fd.set('modul_weingarten', settings.modul_weingarten  ? 'true' : 'false')
    fd.set('modul_ea',         settings.modul_ea          ? 'true' : 'false')
    fd.set('modul_sumup',      settings.modul_sumup       ? 'true' : 'false')
    fd.set('modul_export',     settings.modul_export      ? 'true' : 'false')
    fd.set('assistent_aktiv',  settings.assistent_aktiv   ? 'true' : 'false')
    startTransition(async () => {
      await saveTenantSettings(tenant.id, fd)
      setSaved(true)
      setTimeout(() => router.push('/admin/mandanten'), 800)
    })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5 max-w-lg">
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">Anzeigename</label>
        <input name="anzeigename" defaultValue={settings.anzeigename ?? tenant.name}
          placeholder={tenant.name} className={inputCls()} />
        <p className="text-xs text-s112-muted mt-1">Wird in der Sidebar unter dem Logo angezeigt.</p>
      </div>

      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">Logo</label>

        <input
          ref={logoInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/svg+xml"
          className="hidden"
          onChange={e => {
            const f = e.target.files?.[0]
            if (f) handleLogoFile(f)
            e.target.value = ''
          }}
        />
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => logoInputRef.current?.click()}
            disabled={logoUploading}
            className="text-xs font-medium bg-s112-teal/10 hover:bg-s112-teal/20 text-s112-teal px-3 py-1.5 rounded-lg transition-colors disabled:opacity-40"
          >
            {logoUploading ? 'Hochladen…' : 'Logo-Datei hochladen'}
          </button>
          {logoError && <span className="text-xs text-red-500">{logoError}</span>}
        </div>
        <p className="text-xs text-s112-muted mt-1">PNG, JPG, WebP oder SVG, max. 2 MB. Empfohlen: max. 140×40 px.</p>

        <input name="logo_url" value={logoUrl} onChange={e => setLogoUrl(e.target.value)}
          placeholder="/logos/mein-logo.png oder https://..." className={inputCls() + ' mt-2'} />
        <p className="text-xs text-s112-muted mt-1">
          Wird beim Hochladen automatisch befüllt. Alternativ kann hier auch direkt eine
          öffentliche URL oder ein Pfad im <code className="bg-gray-100 px-1 rounded">/public</code>-Ordner eingetragen werden.
        </p>
        {logoUrl && (
          <div className="mt-2 p-3 bg-gray-50 border border-s112-border rounded-lg inline-block">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={logoUrl} alt="Vorschau" className="max-h-10 max-w-[140px] object-contain" />
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Primärfarbe</label>
          <div className="flex gap-2 items-center">
            <input type="color" value={primary} onChange={e => setPrimary(e.target.value)}
              className="w-8 h-8 rounded border border-s112-border cursor-pointer p-0.5 flex-shrink-0" />
            <input name="primary_color" value={primary} onChange={e => setPrimary(e.target.value)}
              className="flex-1 border border-s112-border rounded-lg px-3 py-1.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-s112-teal/40" />
          </div>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Sekundärfarbe</label>
          <div className="flex gap-2 items-center">
            <input type="color" value={secondary} onChange={e => setSecondary(e.target.value)}
              className="w-8 h-8 rounded border border-s112-border cursor-pointer p-0.5 flex-shrink-0" />
            <input name="secondary_color" value={secondary} onChange={e => setSecondary(e.target.value)}
              className="flex-1 border border-s112-border rounded-lg px-3 py-1.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-s112-teal/40" />
          </div>
        </div>
      </div>

      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">
          Session Timeout (Minuten)
        </label>
        <input name="session_timeout_minuten" type="number" min="5" max="480"
          defaultValue={settings.session_timeout_minuten ?? ''}
          placeholder="Leer = kein Timeout" className={inputCls()} style={{ maxWidth: '180px' }} />
        <p className="text-xs text-s112-muted mt-1">
          Nach dieser Inaktivitätsdauer erscheint ein Hinweis. Leer lassen = kein automatischer Logout.
        </p>
      </div>

      {/* Brevo-Werte mitnehmen */}
      <input type="hidden" name="brevo_api_key"     defaultValue={settings.brevo_api_key ?? ''} />
      <input type="hidden" name="brevo_sender_mail" defaultValue={settings.brevo_sender_mail ?? ''} />
      <input type="hidden" name="brevo_sender_name" defaultValue={settings.brevo_sender_name ?? ''} />
      <input type="hidden" name="brevo_list_privat" defaultValue={settings.brevo_list_privat ?? ''} />
      <input type="hidden" name="brevo_list_gastro" defaultValue={settings.brevo_list_gastro ?? ''} />
      <input type="hidden" name="brevo_list_handel" defaultValue={settings.brevo_list_handel ?? ''} />
      <input type="hidden" name="brevo_list_export" defaultValue={settings.brevo_list_export ?? ''} />
      <input type="hidden" name="brevo_list_grossh" defaultValue={settings.brevo_list_grossh ?? ''} />

      <div className="flex items-center gap-3">
        <button type="submit" disabled={pending}
          className="bg-s112-teal text-white px-4 py-1.5 rounded-lg text-sm font-medium hover:bg-opacity-90 disabled:opacity-40">
          {pending ? 'Speichern…' : 'Speichern'}
        </button>
        {saved && <span className="text-xs text-s112-teal font-medium">Gespeichert</span>}
      </div>
    </form>
  )
}

// ── Tab: Benutzer ─────────────────────────────────────────────────────────────

function BenutzerTab({ tenant, members: initialMembers }: { tenant: TenantDetail; members: TenantMember[] }) {
  const [members, setMembers]         = useState<TenantMember[]>(initialMembers)
  const [showInvite, setShowInvite]   = useState(false)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteName, setInviteName]   = useState('')
  const [inviteRole, setInviteRole]   = useState('winzer')
  const [editingId, setEditingId]     = useState<string | null>(null)
  const [editRole, setEditRole]       = useState('')
  // Name wird seit 7.8.2026 hier zentral administriert (Pflichtfeld) statt
  // vom Benutzer selbst unter /profil - eigener Bearbeitungs-Status, damit
  // Name- und Rolle-Bearbeitung unabhaengig voneinander laufen koennen.
  const [editingNameId, setEditingNameId] = useState<string | null>(null)
  const [editName, setEditName]           = useState('')
  const [error, setError]             = useState<string | null>(null)
  const [success, setSuccess]         = useState<string | null>(null)
  const [pending, startTransition]    = useTransition()

  function handleInvite(e: React.FormEvent) {
    e.preventDefault()
    setError(null); setSuccess(null)
    startTransition(async () => {
      const r = await inviteUserToTenant(tenant.id, inviteEmail, inviteRole, inviteName)
      if (r.error) { setError(r.error) }
      else { setSuccess(`Einladung an ${inviteEmail} versandt.`); setInviteEmail(''); setInviteName(''); setShowInvite(false) }
    })
  }

  function handleRoleUpdate(membershipId: string) {
    setError(null)
    startTransition(async () => {
      const r = await updateMemberRoleAdmin(membershipId, editRole, tenant.id)
      if (r.error) setError(r.error)
      else setEditingId(null)
    })
  }

  function handleNameUpdate(m: TenantMember) {
    setError(null)
    startTransition(async () => {
      const r = await updateMemberNameAdmin(m.userId, editName, tenant.id)
      if (r.error) { setError(r.error); return }
      setMembers(prev => prev.map(x => x.id === m.id ? { ...x, fullName: editName.trim() } : x))
      setEditingNameId(null)
    })
  }

  function handleRemove(m: TenantMember) {
    if (!confirm(`"${m.email}" aus diesem Mandanten entfernen?`)) return
    setError(null)
    startTransition(async () => {
      const r = await removeMemberAdmin(m.id, tenant.id)
      if (r.error) { setError(r.error); return }
      // Mitglied aus State entfernen ohne Seite neu zu laden
      setMembers(prev => prev.filter(x => x.id !== m.id))
      setSuccess(`${m.email} wurde entfernt.`)
    })
  }

  function handleResendInvite(m: TenantMember) {
    setError(null); setSuccess(null)
    startTransition(async () => {
      const r = await resendInvite(m.userId, tenant.id)
      if (r.error) { setError(r.error); return }
      setSuccess(`Neue Einladung an ${m.email} versandt.`)
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
              <th className="text-left px-4 py-2 text-xs font-semibold text-s112-muted">Name</th>
              <th className="text-left px-4 py-2 text-xs font-semibold text-s112-muted">E-Mail</th>
              <th className="text-left px-4 py-2 text-xs font-semibold text-s112-muted">Rolle</th>
              <th className="text-left px-4 py-2 text-xs font-semibold text-s112-muted">Seit</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody>
            {members.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-sm text-s112-muted">
                Noch keine Benutzer zugewiesen.
              </td></tr>
            )}
            {members.map(m => (
              <tr key={m.id} className="border-b border-s112-border/40 last:border-0 hover:bg-s112-bg/50">
                <td className="px-4 py-3">
                  {editingNameId === m.id ? (
                    <div className="flex items-center gap-2">
                      <input value={editName} onChange={e => setEditName(e.target.value)}
                        required disabled={pending} autoFocus
                        className="border border-s112-border rounded-lg px-2 py-1 text-xs w-36 focus:outline-none focus:ring-2 focus:ring-s112-teal/40" />
                      <button onClick={() => handleNameUpdate(m)} disabled={pending || !editName.trim()}
                        className="text-xs text-s112-teal hover:underline font-semibold disabled:opacity-50">Speichern</button>
                      <button onClick={() => setEditingNameId(null)}
                        className="text-xs text-s112-muted hover:text-gray-700">Abbrechen</button>
                    </div>
                  ) : (
                    <button onClick={() => { setEditingNameId(m.id); setEditName(m.fullName ?? '') }}
                      className="font-medium text-gray-900 hover:text-s112-teal inline-flex items-center gap-1.5 group">
                      {m.fullName ?? <span className="text-red-500 font-normal italic">kein Name hinterlegt</span>}
                      <Pencil size={11} className="opacity-0 group-hover:opacity-60" />
                    </button>
                  )}
                </td>
                <td className="px-4 py-3 text-gray-700">
                  {m.email}
                  {!m.confirmed && (
                    <span className="ml-2 inline-block px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700"
                      title="Einladung verschickt, aber noch nicht angenommen">
                      Ausstehend
                    </span>
                  )}
                </td>
                <td className="px-4 py-3">
                  {editingId === m.id ? (
                    <select value={editRole} onChange={e => setEditRole(e.target.value)}
                      className="border border-s112-border rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-s112-teal/40"
                      disabled={pending}>
                      {ROLLEN.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                    </select>
                  ) : (
                    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${ROLE_COLORS[m.role] ?? 'bg-gray-100 text-gray-600'}`}>
                      {ROLE_LABELS[m.role] ?? m.role}
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-xs text-s112-muted tabular-nums">
                  {new Date(m.createdAt).toLocaleDateString('de-AT')}
                </td>
                <td className="px-4 py-3 text-right">
                  {editingId === m.id ? (
                    <div className="flex gap-2 justify-end">
                      <button onClick={() => handleRoleUpdate(m.id)} disabled={pending}
                        className="text-xs text-s112-teal hover:underline font-semibold disabled:opacity-50">Speichern</button>
                      <button onClick={() => setEditingId(null)}
                        className="text-xs text-s112-muted hover:text-gray-700">Abbrechen</button>
                    </div>
                  ) : m.role !== 'system_admin' ? (
                    <div className="flex gap-3 justify-end">
                      {!m.confirmed && (
                        <button onClick={() => handleResendInvite(m)} disabled={pending}
                          className="text-xs text-s112-teal hover:underline font-medium disabled:opacity-50">
                          Einladung erneut senden
                        </button>
                      )}
                      <button onClick={() => { setEditingId(m.id); setEditRole(m.role) }}
                        className="text-xs text-s112-teal hover:underline font-medium">Rolle</button>
                      <button onClick={() => handleRemove(m)} disabled={pending}
                        className="text-xs text-red-400 hover:text-red-600 disabled:opacity-50">Entfernen</button>
                    </div>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {!showInvite ? (
        <button onClick={() => setShowInvite(true)}
          className="inline-flex items-center gap-2 bg-s112-teal text-white px-4 py-2 rounded-xl text-sm font-semibold hover:bg-opacity-90">
          + Benutzer einladen
        </button>
      ) : (
        <form onSubmit={handleInvite} className="bg-s112-bg border border-s112-border rounded-xl p-5 space-y-3">
          <h3 className="text-sm font-semibold text-gray-800">Benutzer einladen</h3>
          <p className="text-xs text-s112-muted">
            Neuer Benutzer: erhält Einladungs-E-Mail von Supabase zum Passwort setzen.<br />
            Bestehender Supabase-User: wird direkt zugewiesen.
          </p>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Name *</label>
              <input value={inviteName} onChange={e => setInviteName(e.target.value)}
                required className={inputCls()} placeholder="Vorname Nachname" autoFocus />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">E-Mail *</label>
              <input type="email" value={inviteEmail} onChange={e => setInviteEmail(e.target.value)}
                required className={inputCls()} placeholder="benutzer@weingut.at" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Rolle *</label>
              <select value={inviteRole} onChange={e => setInviteRole(e.target.value)}
                className={inputCls()}>
                {ROLLEN.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
            </div>
          </div>
          <div className="flex gap-2">
            <button type="submit" disabled={pending}
              className="bg-s112-teal text-white px-4 py-1.5 rounded-lg text-sm font-medium hover:bg-opacity-90 disabled:opacity-40">
              {pending ? 'Einladen…' : 'Einladen'}
            </button>
            <button type="button" onClick={() => { setShowInvite(false); setInviteEmail(''); setInviteName('') }}
              className="px-4 py-1.5 rounded-lg text-sm font-medium text-gray-600 hover:text-gray-800">
              Abbrechen
            </button>
          </div>
        </form>
      )}
    </div>
  )
}

// ── Tab: Brevo ────────────────────────────────────────────────────────────────

function BrevoTab({ tenant, settings }: { tenant: TenantDetail; settings: TenantSettings }) {
  const router                     = useRouter()
  const [pending, startTransition] = useTransition()
  const [saved, setSaved]          = useState(false)

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    fd.set('anzeigename',      settings.anzeigename ?? '')
    fd.set('logo_url',         settings.logo_url ?? '')
    fd.set('primary_color',    settings.primary_color)
    fd.set('session_timeout_minuten', String(settings.session_timeout_minuten ?? ''))
    fd.set('secondary_color',  settings.secondary_color)
    fd.set('modul_newsletter', settings.modul_newsletter ? 'true' : 'false')
    fd.set('modul_crm',        settings.modul_crm        ? 'true' : 'false')
    fd.set('modul_kellerbuch', settings.modul_kellerbuch  ? 'true' : 'false')
    fd.set('modul_weingarten', settings.modul_weingarten  ? 'true' : 'false')
    fd.set('modul_ea',         settings.modul_ea          ? 'true' : 'false')
    fd.set('modul_sumup',      settings.modul_sumup       ? 'true' : 'false')
    fd.set('modul_export',     settings.modul_export      ? 'true' : 'false')
    fd.set('assistent_aktiv',  settings.assistent_aktiv   ? 'true' : 'false')
    startTransition(async () => {
      await saveTenantSettings(tenant.id, fd)
      setSaved(true)
      setTimeout(() => router.push('/admin/mandanten'), 800)
    })
  }

  if (!settings.modul_newsletter) {
    return (
      <div className="p-6 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-800">
        <p className="font-semibold mb-1">Newsletter-Modul ist deaktiviert</p>
        <p>Aktiviere das Newsletter-Modul im Tab <strong>Module</strong>, um die Brevo-Konfiguration zu verwenden.</p>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5 max-w-lg">
      <div className="p-4 bg-blue-50 border border-blue-200 rounded-xl text-xs text-blue-800 space-y-1">
        <p className="font-semibold">Brevo-Einrichtung – Hinweise</p>
        <p>→ API-Key: <a href="https://app.brevo.com/settings/keys/api" target="_blank" rel="noreferrer" className="underline">app.brevo.com → Account → API Keys</a></p>
        <p>→ Listen-IDs: <a href="https://app.brevo.com/contact/list-listing" target="_blank" rel="noreferrer" className="underline">app.brevo.com → Contacts → Lists</a> → ID in der URL</p>
        <p>→ Absender-E-Mail muss in Brevo als verifizierte Domain eingetragen sein.</p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <label className="block text-xs font-medium text-gray-600 mb-1">API-Key</label>
          <input name="brevo_api_key" defaultValue={settings.brevo_api_key ?? ''}
            placeholder="xkeysib-…" className={inputCls()} />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Absender E-Mail</label>
          <input name="brevo_sender_mail" defaultValue={settings.brevo_sender_mail ?? ''}
            placeholder="info@weingut.at" className={inputCls()} />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Absender Name</label>
          <input name="brevo_sender_name" defaultValue={settings.brevo_sender_name ?? ''}
            placeholder="Weingut Mustermann" className={inputCls()} />
        </div>
      </div>

      <div>
        <p className="text-xs font-semibold text-gray-700 uppercase tracking-wide mb-2">Listen-IDs</p>
        <div className="grid grid-cols-2 gap-2">
          {[
            { name: 'brevo_list_privat', label: 'Privat',       val: settings.brevo_list_privat },
            { name: 'brevo_list_gastro', label: 'Gastronomie',  val: settings.brevo_list_gastro },
            { name: 'brevo_list_handel', label: 'Handel',       val: settings.brevo_list_handel },
            { name: 'brevo_list_export', label: 'Export',       val: settings.brevo_list_export },
            { name: 'brevo_list_grossh', label: 'Großhandel',   val: settings.brevo_list_grossh },
          ].map(f => (
            <div key={f.name}>
              <label className="block text-xs font-medium text-gray-600 mb-1">{f.label}</label>
              <input name={f.name} defaultValue={f.val ?? ''}
                placeholder="z.B. 3" type="number" min="1"
                className="w-full border border-s112-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40" />
            </div>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button type="submit" disabled={pending}
          className="bg-s112-teal text-white px-4 py-1.5 rounded-lg text-sm font-medium hover:bg-opacity-90 disabled:opacity-40">
          {pending ? 'Speichern…' : 'Speichern'}
        </button>
        {saved && <span className="text-xs text-s112-teal font-medium">Gespeichert</span>}
      </div>
    </form>
  )
}

// ── Tab: Module ───────────────────────────────────────────────────────────────

function ModuleTab({ tenant, settings }: { tenant: TenantDetail; settings: TenantSettings }) {
  const router                     = useRouter()
  const [pending, startTransition] = useTransition()
  const [saved, setSaved]          = useState(false)
  const [mods, setMods]            = useState({
    modul_weingarten: settings.modul_weingarten,
    modul_kellerbuch: settings.modul_kellerbuch,
    modul_crm:        settings.modul_crm,
    modul_newsletter: settings.modul_newsletter,
    modul_ea:         settings.modul_ea         ?? false,
    modul_sumup:      settings.modul_sumup       ?? false,
    modul_export:     settings.modul_export      ?? false,
    assistent_aktiv:  settings.assistent_aktiv   ?? false,
  })

  function toggle(key: keyof typeof mods) {
    setMods(m => ({ ...m, [key]: !m[key] }))
  }

  function handleSave() {
    const fd = new FormData()
    fd.set('anzeigename',      settings.anzeigename ?? '')
    fd.set('logo_url',         settings.logo_url ?? '')
    fd.set('primary_color',    settings.primary_color)
    fd.set('secondary_color',  settings.secondary_color)
    fd.set('modul_weingarten', mods.modul_weingarten ? 'true' : 'false')
    fd.set('modul_kellerbuch', mods.modul_kellerbuch  ? 'true' : 'false')
    fd.set('modul_crm',        mods.modul_crm         ? 'true' : 'false')
    fd.set('modul_newsletter', mods.modul_newsletter   ? 'true' : 'false')
    fd.set('modul_ea',         mods.modul_ea           ? 'true' : 'false')
    fd.set('modul_sumup',      mods.modul_sumup         ? 'true' : 'false')
    fd.set('modul_export',     mods.modul_export        ? 'true' : 'false')
    fd.set('assistent_aktiv',  mods.assistent_aktiv     ? 'true' : 'false')
    fd.set('brevo_api_key',     settings.brevo_api_key ?? '')
    fd.set('brevo_sender_mail', settings.brevo_sender_mail ?? '')
    fd.set('brevo_sender_name', settings.brevo_sender_name ?? '')
    fd.set('brevo_list_privat', String(settings.brevo_list_privat ?? ''))
    fd.set('brevo_list_gastro', String(settings.brevo_list_gastro ?? ''))
    fd.set('brevo_list_handel', String(settings.brevo_list_handel ?? ''))
    fd.set('brevo_list_export', String(settings.brevo_list_export ?? ''))
    fd.set('brevo_list_grossh', String(settings.brevo_list_grossh ?? ''))
    startTransition(async () => {
      await saveTenantSettings(tenant.id, fd)
      setSaved(true)
      setTimeout(() => router.push('/admin/mandanten'), 800)
    })
  }

  return (
    <div className="space-y-5 max-w-sm">
      <div className="card space-y-4">
        <Toggle on={mods.modul_weingarten} onToggle={() => toggle('modul_weingarten')} label="Weingarten-Modul" />
        <Toggle on={mods.modul_kellerbuch} onToggle={() => toggle('modul_kellerbuch')} label="Kellerbuch-Modul" />
        <Toggle on={mods.modul_crm}        onToggle={() => toggle('modul_crm')}        label="CRM-Modul" />
        <Toggle on={mods.modul_newsletter} onToggle={() => toggle('modul_newsletter')} label="Newsletter-Modul (Brevo)" />
        <Toggle on={mods.modul_ea}         onToggle={() => toggle('modul_ea')}         label="E&A-Rechnung (§ 4 Abs. 3)" />
        <Toggle on={mods.modul_sumup} onToggle={() => {
            if (!mods.modul_sumup && !mods.modul_ea) toggle('modul_ea')
            toggle('modul_sumup')
          }} label="SumUp Kartenterminal" />
          {!mods.modul_ea && (
            <p className="text-xs text-amber-600 -mt-2 ml-12">
              Erfordert E&amp;A – Aktivierung schaltet E&amp;A automatisch mit ein
            </p>
          )}
        <Toggle on={mods.modul_export} onToggle={() => toggle('modul_export')} label="Exportaufträge (Weinexport)" />
        <Toggle on={mods.assistent_aktiv} onToggle={() => toggle('assistent_aktiv')} label="bot:112 – Beta" />
      </div>

      <div className="flex items-center gap-3">
        <button onClick={handleSave} disabled={pending}
          className="bg-s112-teal text-white px-4 py-1.5 rounded-lg text-sm font-medium hover:bg-opacity-90 disabled:opacity-40">
          {pending ? 'Speichern…' : 'Speichern'}
        </button>
        {saved && <span className="text-xs text-s112-teal font-medium">Gespeichert</span>}
      </div>
    </div>
  )
}


// ── Tab: Betrieb ──────────────────────────────────────────────────────────────

function BetriebTab({ tenant, settings }: { tenant: TenantDetail; settings: TenantSettings }) {
  const router                     = useRouter()
  const [pending, startTransition] = useTransition()
  const [saved, setSaved]          = useState(false)

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    startTransition(async () => {
      await saveBetriebEinstellungen(tenant.id, fd)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6 max-w-lg">
      <div>
        <p className="text-xs font-semibold text-gray-700 uppercase tracking-wide mb-3">Betriebsdaten (Briefkopf)</p>
        <div className="grid grid-cols-1 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Betriebsname *</label>
            <input name="betrieb_name" defaultValue={settings.betrieb_name ?? ''} required className={inputCls()} placeholder="Weingut Gebeshuber" />
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div className="col-span-2">
              <label className="block text-xs font-medium text-gray-600 mb-1">Straße + Nr.</label>
              <input name="betrieb_strasse" defaultValue={settings.betrieb_strasse ?? ''} className={inputCls()} placeholder="Hauptstraße 1" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">PLZ</label>
              <input name="betrieb_plz" defaultValue={settings.betrieb_plz ?? ''} className={inputCls()} placeholder="3421" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Ort</label>
            <input name="betrieb_ort" defaultValue={settings.betrieb_ort ?? ''} className={inputCls()} placeholder="Krems an der Donau" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Telefon</label>
              <input name="betrieb_telefon" defaultValue={settings.betrieb_telefon ?? ''} className={inputCls()} placeholder="+43 2732 12345" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">E-Mail</label>
              <input name="betrieb_email" type="email" defaultValue={settings.betrieb_email ?? ''} className={inputCls()} placeholder="office@weingut.at" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Website</label>
              <input name="betrieb_website" defaultValue={settings.betrieb_website ?? ''} className={inputCls()} placeholder="www.weingut.at" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">UID-Nummer</label>
              <input name="betrieb_uid" defaultValue={settings.betrieb_uid ?? ''} className={inputCls()} placeholder="ATU12345678" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Weinbau-Betriebsnummer</label>
              <input name="betrieb_betriebsnummer" defaultValue={settings.betrieb_betriebsnummer ?? ''} className={inputCls()} placeholder="z.B. 4489781" />
              <p className="text-[10px] text-gray-400 mt-0.5">Für Transportbescheinigung &amp; Prüfnummernantrag</p>
            </div>
          </div>
        </div>
      </div>

      <div>
        <p className="text-xs font-semibold text-gray-700 uppercase tracking-wide mb-3">Bewirtschaftung</p>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Status</label>
          <select name="bio_status" defaultValue={tenant.bio_status} className={inputCls()} style={{ maxWidth: '320px' }}>
            {BIO_STATUS_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <p className="text-[10px] text-gray-400 mt-0.5">
            Steuert die Warn-/Sperrlogik bei der Mittelwahl im Maßnahmenformular: bei Bio-EU/biodynamisch
            wird ein nicht öko-zugelassenes Mittel gesperrt, bei KIP/nachhaltig nur als Warnung angezeigt.
          </p>
        </div>
      </div>

      <div>
        <p className="text-xs font-semibold text-gray-700 uppercase tracking-wide mb-3">Bankverbindung</p>
        <div className="grid grid-cols-1 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">IBAN</label>
            <input name="rechnung_iban" defaultValue={settings.rechnung_iban ?? ''} className={inputCls()} placeholder="AT12 3456 7890 1234 5678" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">BIC</label>
            <input name="rechnung_bic" defaultValue={settings.rechnung_bic ?? ''} className={inputCls()} placeholder="RLNWATWWXXX" style={{ maxWidth: '320px' }} />
          </div>
          {/* Zahlungsziel wurde vom Betrieb zum Kunden verschoben (6.8.2026) -
              siehe zahlungsziel_tage auf Kontakt/Firma. */}
        </div>
      </div>

      <div>
        <p className="text-xs font-semibold text-gray-700 uppercase tracking-wide mb-3">Rechnungs-Fußtext</p>
        <textarea name="rechnung_fusstext" defaultValue={settings.rechnung_fusstext ?? ''}
          rows={3} placeholder="z.B. Gemäß § 6 Abs. 1 Z 8 UStG befreit von der Umsatzsteuer."
          className="w-full border border-s112-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40 resize-none" />
      </div>

      <div className="flex items-center gap-3">
        <button type="submit" disabled={pending}
          className="bg-s112-teal text-white px-4 py-1.5 rounded-lg text-sm font-medium hover:bg-opacity-90 disabled:opacity-40">
          {pending ? 'Speichern…' : 'Speichern'}
        </button>
        {saved && <span className="text-xs text-s112-teal font-medium">Gespeichert</span>}
      </div>
    </form>
  )
}



// ── Tab: Microsoft 365 ───────────────────────────────────────────────────────
function M365Tab({ tenant, settings }: { tenant: TenantDetail; settings: TenantSettings }) {
  const [pending, startTransition] = useTransition()
  const [saved,   setSaved]        = useState(false)

  const isConnected = !!settings.m365_user_email
  // Access Token läuft nach ~1h ab; getValidAccessToken refresht automatisch via Refresh Token.
  // Daher: "verbunden" wenn m365_user_email gesetzt, auch wenn Access Token abgelaufen.
  const tokenOk     = isConnected  // Refresh Token übernimmt automatisch
  const tokenExpired = settings.m365_token_expires_at
    ? new Date(settings.m365_token_expires_at) < new Date()
    : false

  const [subLoading, setSubLoading] = useState(false)
  const [subResult, setSubResult]   = useState<string | null>(null)

  async function handleSubscribe() {
    setSubLoading(true); setSubResult(null)
    try {
      const res = await fetch('/api/m365/subscribe', { method: 'POST' })
      const json = await res.json()
      if (!res.ok || json.fehler) { setSubResult('Fehler: ' + (json.fehler ?? 'Unbekannt')); return }
      setSubResult(`Webhook ${json.aktion} · gültig bis ${new Date(json.expires).toLocaleString('de-AT')}`)
    } catch (err) { setSubResult('Fehler: ' + String(err)) }
    finally { setSubLoading(false) }
  }

  function handleSave(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    startTransition(async () => {
      await saveM365Einstellungen(tenant.id, new FormData(e.currentTarget))
      setSaved(true); setTimeout(() => setSaved(false), 2000)
    })
  }

  return (
    <div className="space-y-6 max-w-lg">
      {/* Status */}
      <div className={`flex items-center gap-3 p-4 rounded-xl border ${isConnected && tokenOk ? 'border-green-300 bg-green-50' : 'border-amber-300 bg-amber-50'}`}>
        {isConnected && tokenOk
          ? <CheckCircle2 className="w-6 h-6 text-green-600 flex-shrink-0" />
          : <AlertTriangle className="w-6 h-6 text-amber-600 flex-shrink-0" />}
        <div>
          <p className="text-sm font-semibold">{isConnected ? `Verbunden als ${settings.m365_user_email}` : 'Noch nicht verbunden'}</p>
          {isConnected && tokenExpired && (
            <p className="text-xs text-amber-700">Access Token abgelaufen – wird beim nächsten E-Mail-Abruf automatisch erneuert</p>
          )}
          {isConnected && !tokenExpired && settings.m365_token_expires_at && (
            <p className="text-xs text-gray-500">Token gültig bis: {new Date(settings.m365_token_expires_at).toLocaleString('de-AT')}</p>
          )}
        </div>
        {isConnected && (
          <a href="/api/auth/m365" className="ml-auto text-xs border border-s112-border px-3 py-1.5 rounded-lg hover:bg-white">
            Neu verbinden
          </a>
        )}
      </div>

      {/* Setup */}
      <form onSubmit={handleSave} className="space-y-4">
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-xs space-y-1.5">
          <p className="font-semibold text-blue-800">Azure AD App-Registrierung (einmalig):</p>
          <ol className="list-decimal ml-4 space-y-1 text-blue-700">
            <li>portal.azure.com → App-Registrierungen → Neue Registrierung</li>
            <li>Umleitungs-URI (Web): <code className="bg-white px-1 rounded">https://software112.icp-consultants.at/api/auth/m365/callback</code></li>
            <li>Zertifikate & Geheimnisse → Neuer geheimer Clientschlüssel</li>
            <li>API-Berechtigungen → Microsoft Graph → delegiert: Mail.ReadWrite, Mail.Send, Calendars.Read, offline_access – danach „Administratorzustimmung erteilen"</li>
          </ol>
        </div>

        <div className="grid grid-cols-1 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Azure AD Verzeichnis-ID (Tenant ID)</label>
            <input name="m365_tenant_id" defaultValue={settings.m365_tenant_id ?? ''} placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" className={inputCls()} />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Anwendungs-ID (Client ID)</label>
            <input name="m365_client_id" defaultValue={settings.m365_client_id ?? ''} placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" className={inputCls()} />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Geheimer Clientschlüssel</label>
            <input name="m365_client_secret" type="password" placeholder="Neu setzen (leer = unverändert)" className={inputCls()} />
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button type="submit" disabled={pending}
            className="bg-s112-teal text-white px-4 py-1.5 rounded-lg text-sm font-medium hover:bg-opacity-90 disabled:opacity-40">
            {pending ? 'Speichern…' : 'Speichern'}
          </button>
          {saved && <span className="text-xs text-s112-teal font-medium">Gespeichert</span>}
          {settings.m365_tenant_id && settings.m365_client_id && (
            <a href="/api/auth/m365"
              className="ml-auto bg-blue-600 text-white px-4 py-1.5 rounded-lg text-sm font-medium hover:bg-blue-700">
              Mit Microsoft 365 verbinden
            </a>
          )}
        </div>
      </form>

      {/* Webhook Info */}
      {isConnected && (
        <div className="border border-s112-border rounded-xl p-4 space-y-2">
          <p className="text-sm font-semibold text-gray-700">Echtzeit-Webhook</p>
          <p className="text-xs text-s112-muted mb-3">
            {settings.m365_webhook_sub_id
              ? `Aktive Subscription (${settings.m365_webhook_sub_id.slice(0, 16)}…)`
              : 'Noch kein Webhook registriert.'}
            {settings.m365_webhook_expires && ` · Läuft ab: ${new Date(settings.m365_webhook_expires).toLocaleString('de-AT')}`}
          </p>
          <button type="button" onClick={handleSubscribe} disabled={subLoading}
            className="text-sm border border-s112-border px-4 py-1.5 rounded-lg hover:bg-s112-bg disabled:opacity-40">
            {subLoading ? 'Registrieren…' : settings.m365_webhook_sub_id ? 'Webhook erneuern' : 'Webhook registrieren'}
          </button>
          {subResult && <p className="text-xs font-medium text-gray-700 mt-2">{subResult}</p>}
        </div>
      )}
    </div>
  )
}

// ── Tab: E-Mail-Integration ───────────────────────────────────────────────────
function EmailTab({ tenant, settings }: { tenant: TenantDetail; settings: TenantSettings }) {
  const [pending, startTransition] = useTransition()
  const [saved,   setSaved]        = useState(false)
  const [polling, setPolling]      = useState(false)
  const [pollResult, setPollResult] = useState<string | null>(null)
  const [aktiv, setAktiv]          = useState(settings.email_modul_aktiv)

  function handleSave(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    fd.set('email_modul_aktiv', aktiv ? 'true' : 'false')
    startTransition(async () => {
      await saveEmailEinstellungen(tenant.id, fd)
      setSaved(true); setTimeout(() => setSaved(false), 2000)
    })
  }

  async function handlePoll() {
    setPolling(true); setPollResult(null)
    try {
      const res = await fetch('/api/email/poll', { method: 'POST' })
      const json = await res.json()
      setPollResult(json.fehler ? `Fehler: ${json.fehler}` : `${json.neu} neue E-Mail(s) importiert`)
    } catch (err) { setPollResult(`Fehler: ${err}`) }
    finally { setPolling(false) }
  }

  return (
    <div className="space-y-6 max-w-lg">
      <div className="flex items-center gap-3">
        <label className="flex items-center gap-2.5 cursor-pointer select-none">
          <div onClick={() => setAktiv(v => !v)}
            className={`w-10 h-5 rounded-full transition-colors flex items-center px-0.5 ${aktiv ? 'bg-s112-teal' : 'bg-gray-300'}`}>
            <div className={`w-4 h-4 rounded-full bg-white shadow transition-transform ${aktiv ? 'translate-x-5' : 'translate-x-0'}`} />
          </div>
        </label>
        <span className={`text-sm font-semibold ${aktiv ? 'text-s112-teal' : 'text-gray-500'}`}>
          E-Mail-Modul {aktiv ? 'aktiv' : 'inaktiv'}
        </span>
      </div>

      <form onSubmit={handleSave} className="space-y-5">
        {/* SMTP Ausgehend */}
        <div>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">SMTP – Ausgehende E-Mails</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">SMTP-Host</label>
              <input name="email_smtp_host" defaultValue={settings.email_smtp_host ?? ''} placeholder="smtp.gmail.com" className={inputCls()} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Port</label>
              <input name="email_smtp_port" type="number" defaultValue={settings.email_smtp_port} className={inputCls()} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Benutzername / E-Mail</label>
              <input name="email_smtp_user" defaultValue={settings.email_smtp_user ?? ''} placeholder="name@domain.at" className={inputCls()} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Passwort / App-Passwort</label>
              <input name="email_smtp_pass" type="password" placeholder="Neu setzen (leer = unverändert)" className={inputCls()} />
            </div>
            <div className="col-span-2">
              <label className="block text-xs font-medium text-gray-600 mb-1">Absendername</label>
              <input name="email_smtp_from_name" defaultValue={settings.email_smtp_from_name ?? ''} placeholder="Weingut Gebeshuber" className={inputCls()} />
            </div>
          </div>
        </div>

        {/* IMAP Eingehend */}
        <div>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">IMAP – Eingehende E-Mails</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">IMAP-Host</label>
              <input name="email_imap_host" defaultValue={settings.email_imap_host ?? ''} placeholder="imap.gmail.com" className={inputCls()} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Port</label>
              <input name="email_imap_port" type="number" defaultValue={settings.email_imap_port} className={inputCls()} />
            </div>
            <div className="col-span-2">
              <label className="block text-xs font-medium text-gray-600 mb-1">Benutzername / E-Mail</label>
              <input name="email_imap_user" defaultValue={settings.email_imap_user ?? ''} className={inputCls()} />
            </div>
            <div className="col-span-2">
              <label className="block text-xs font-medium text-gray-600 mb-1">Passwort / App-Passwort</label>
              <input name="email_imap_pass" type="password" placeholder="Neu setzen (leer = unverändert)" className={inputCls()} />
            </div>
          </div>
          {settings.email_last_poll && (
            <p className="text-xs text-s112-muted mt-2">Letzter Import: {new Date(settings.email_last_poll).toLocaleString('de-AT')}</p>
          )}
        </div>

        <div className="flex items-center gap-3">
          <button type="submit" disabled={pending}
            className="bg-s112-teal text-white px-4 py-1.5 rounded-lg text-sm font-medium hover:bg-opacity-90 disabled:opacity-40">
            {pending ? 'Speichern…' : 'Speichern'}
          </button>
          {saved && <span className="text-xs text-s112-teal font-medium">Gespeichert</span>}
        </div>
      </form>

      {/* Manueller IMAP-Poll */}
      <div className="border border-s112-border rounded-xl p-4 space-y-3">
        <p className="text-sm font-semibold text-gray-700">Posteingang jetzt abrufen</p>
        <p className="text-xs text-s112-muted">Importiert ungelesene E-Mails der letzten 7 Tage und legt Aktivitäten für bekannte Kontakte an.</p>
        <button type="button" onClick={handlePoll} disabled={polling}
          className="text-sm border border-s112-border px-4 py-1.5 rounded-lg hover:bg-s112-bg disabled:opacity-40">
          {polling ? 'Abrufen…' : 'Jetzt abrufen'}
        </button>
        {pollResult && <p className="text-xs font-medium text-gray-700">{pollResult}</p>}
      </div>
    </div>
  )
}

// ── Tab: Verkauf ──────────────────────────────────────────────────────────────

function VerkaufTab({ tenant, settings }: { tenant: TenantDetail; settings: TenantSettings }) {
  const [pending, startTransition] = useTransition()
  const [saved,   setSaved]        = useState(false)
  const [resetVal,  setResetVal]   = useState(String(settings.rechnung_zaehler))
  const [zaehler,   setZaehler]    = useState(settings.rechnung_zaehler)
  const [kResetVal, setKResetVal]  = useState(String(settings.kunden_zaehler))
  const [kZaehler,  setKZaehler]   = useState(settings.kunden_zaehler)

  const [ustStandard, setUstStandard] = useState(settings.ust_satz_standard)

  // Vorschau der nächsten Rechnungsnummer
  const [prefix,   setPrefix]   = useState(settings.rechnung_prefix)
  const [stellen,  setStellen]  = useState(settings.rechnung_stellen)
  const naechste = `${prefix}-${String(zaehler).padStart(stellen, '0')}`

  // Vorschau der nächsten Kundennummer
  const [kPrefix,  setKPrefix]  = useState(settings.kunden_prefix)
  const [kStellen, setKStellen] = useState(settings.kunden_stellen)
  const naechsteKunde = `${kPrefix}-${String(kZaehler).padStart(kStellen, '0')}`

  function handleSave(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    startTransition(async () => {
      await saveVerkaufEinstellungen(tenant.id, fd)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    })
  }

  function handleReset() {
    const neu = parseInt(resetVal)
    if (isNaN(neu) || neu < 1) return
    if (!confirm(`Rechnungs-Zähler auf ${neu} zurücksetzen?`)) return
    startTransition(async () => {
      await resetRechnungsZaehler(tenant.id, neu)
      setZaehler(neu)
    })
  }

  function handleKundenReset() {
    const neu = parseInt(kResetVal)
    if (isNaN(neu) || neu < 1) return
    if (!confirm(`Kunden-Zähler auf ${neu} zurücksetzen?`)) return
    startTransition(async () => {
      await resetKundenZaehler(tenant.id, neu)
      setKZaehler(neu)
    })
  }

  return (
    <div className="space-y-6 max-w-md">

      {/* Einstellungen */}
      <form onSubmit={handleSave} className="space-y-4">
        {/* USt-Standard */}
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Standard-Umsatzsteuer</p>
        <input type="hidden" name="ust_satz_standard" value={ustStandard} />
        <div className="grid grid-cols-2 gap-3">
          {([{ val: 13, label: '13 %', hint: 'Weinproduzent (stiller Wein)' }, { val: 20, label: '20 %', hint: 'Weinhändler / Spirituosen' }] as const).map(opt => (
            <button
              key={opt.val}
              type="button"
              onClick={() => setUstStandard(opt.val)}
              className={`flex flex-col items-start px-4 py-3 rounded-xl border-2 text-left transition-colors
                ${ustStandard === opt.val
                  ? 'border-s112-teal bg-s112-teal/5 text-s112-teal'
                  : 'border-s112-border text-gray-600 hover:border-s112-teal/40'}`}
            >
              <span className="text-lg font-bold">{opt.label}</span>
              <span className="text-xs mt-0.5 opacity-70">{opt.hint}</span>
            </button>
          ))}
        </div>

        {/* Rechnungsnummer */}
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Rechnungsnummer</p>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Präfix</label>
            <input
              name="rechnung_prefix"
              value={prefix}
              onChange={e => setPrefix(e.target.value.toUpperCase())}
              maxLength={8}
              placeholder="RE"
              className={inputCls()}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Stellen</label>
            <input
              name="rechnung_stellen"
              type="number"
              value={stellen}
              onChange={e => setStellen(Math.max(1, Math.min(8, parseInt(e.target.value) || 4)))}
              min={1} max={8}
              className={inputCls()}
            />
          </div>
        </div>
        <div className="bg-s112-bg border border-s112-border rounded-lg px-4 py-2.5 flex items-center justify-between">
          <p className="text-xs text-s112-muted">Nächste Rechnungsnummer</p>
          <p className="text-base font-mono font-bold text-s112-teal tracking-wider">{naechste}</p>
        </div>

        {/* Kundennummer */}
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider pt-2">Kundennummer</p>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Präfix</label>
            <input
              name="kunden_prefix"
              value={kPrefix}
              onChange={e => setKPrefix(e.target.value.toUpperCase())}
              maxLength={8}
              placeholder="K"
              className={inputCls()}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Stellen</label>
            <input
              name="kunden_stellen"
              type="number"
              value={kStellen}
              onChange={e => setKStellen(Math.max(1, Math.min(8, parseInt(e.target.value) || 4)))}
              min={1} max={8}
              className={inputCls()}
            />
          </div>
        </div>
        <div className="bg-s112-bg border border-s112-border rounded-lg px-4 py-2.5 flex items-center justify-between">
          <p className="text-xs text-s112-muted">Nächste Kundennummer</p>
          <p className="text-base font-mono font-bold text-s112-teal tracking-wider">{naechsteKunde}</p>
        </div>

        <div className="flex items-center gap-3">
          <button type="submit" disabled={pending}
            className="bg-s112-teal text-white px-4 py-1.5 rounded-lg text-sm font-medium hover:bg-opacity-90 disabled:opacity-40">
            {pending ? 'Speichern…' : 'Speichern'}
          </button>
          {saved && <span className="text-xs text-s112-teal font-medium">Gespeichert</span>}
        </div>
      </form>

      {/* Zähler zurücksetzen */}
      <div className="border border-s112-border rounded-xl p-4 space-y-3">
        <div>
          <p className="text-sm font-semibold text-gray-700">Zählerstand</p>
          <p className="text-xs text-s112-muted mt-0.5">
            Aktuell: <span className="font-mono font-semibold text-gray-900">{zaehler}</span>
            {' '}(nächste vergebene Nummer: <span className="font-mono text-gray-900">{naechste}</span>)
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="number"
            value={resetVal}
            onChange={e => setResetVal(e.target.value)}
            min={1}
            className="w-28 border border-s112-border rounded-lg px-3 py-1.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-s112-teal/40"
          />
          <button
            type="button"
            onClick={handleReset}
            disabled={pending}
            className="text-sm text-red-500 hover:text-red-700 border border-red-200 px-3 py-1.5 rounded-lg hover:bg-red-50 disabled:opacity-40 transition-colors"
          >
            Zähler setzen
          </button>
        </div>
        <p className="text-xs text-s112-muted">
          Nur bei Ersteinrichtung oder Jahreswechsel. Bereits vergebene Nummern bleiben unverändert.
        </p>
      </div>

      {/* Kundennummer-Zähler */}
      <div className="border border-s112-border rounded-xl p-4 space-y-3">
        <div>
          <p className="text-sm font-semibold text-gray-700">Kunden-Zählerstand</p>
          <p className="text-xs text-s112-muted mt-0.5">
            Aktuell: <span className="font-mono font-semibold text-gray-900">{kZaehler}</span>
            {' '}(nächste: <span className="font-mono text-gray-900">{naechsteKunde}</span>)
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="number"
            value={kResetVal}
            onChange={e => setKResetVal(e.target.value)}
            min={1}
            className="w-28 border border-s112-border rounded-lg px-3 py-1.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-s112-teal/40"
          />
          <button
            type="button"
            onClick={handleKundenReset}
            disabled={pending}
            className="text-sm text-red-500 hover:text-red-700 border border-red-200 px-3 py-1.5 rounded-lg hover:bg-red-50 disabled:opacity-40 transition-colors"
          >
            Zähler setzen
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Tab: Onboarding-Checkliste ────────────────────────────────────────────────

function CheckItem({ ok, label, hint }: { ok: boolean; label: string; hint?: string }) {
  return (
    <div className={`flex gap-3 p-3 rounded-xl border ${ok ? 'border-green-200 bg-green-50' : 'border-amber-200 bg-amber-50'}`}>
      {ok
        ? <CheckCircle2 className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
        : <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />}
      <div>
        <p className={`text-sm font-medium ${ok ? 'text-green-800' : 'text-amber-800'}`}>{label}</p>
        {!ok && hint && <p className="text-xs text-amber-700 mt-0.5">{hint}</p>}
      </div>
    </div>
  )
}

function ChecklisteTab({ tenant, settings, members }: {
  tenant: TenantDetail; settings: TenantSettings; members: TenantMember[]
}) {
  const hasLogo         = !!settings.logo_url
  const hasName         = !!settings.anzeigename
  const hasUser         = members.filter(m => m.role !== 'system_admin').length > 0
  const hasBrevo        = !settings.modul_newsletter || (
    !!settings.brevo_api_key && !!settings.brevo_sender_mail && !!settings.brevo_sender_name
  )
  const hasListen       = !settings.modul_newsletter || (
    !!settings.brevo_list_privat && !!settings.brevo_list_gastro
  )
  const hasStripeCustomer  = !!tenant.stripe_customer_id
  const hasStripeAbo       = !!tenant.stripe_subscription_id && tenant.stripe_status === 'active'

  const allOk = hasLogo && hasName && hasUser && hasBrevo && hasListen && hasStripeCustomer && hasStripeAbo

  return (
    <div className="space-y-4 max-w-lg">
      {allOk && (
        <div className="p-4 bg-green-50 border border-green-200 rounded-xl text-sm text-green-800 font-medium flex items-center gap-2">
          <CheckCircle2 className="w-5 h-5 flex-shrink-0" />
          Dieser Mandant ist vollständig konfiguriert und einsatzbereit!
        </div>
      )}

      <div className="space-y-2">
        <CheckItem ok label="Mandant angelegt" />
        <CheckItem ok={hasName}
          label="Anzeigename gesetzt"
          hint="→ Tab Branding: Anzeigename eintragen" />
        <CheckItem ok={hasLogo}
          label="Logo konfiguriert"
          hint="→ Tab Branding: Logo-Datei hochladen (oder alternativ Logo-URL eintragen)." />
        <CheckItem ok={hasUser}
          label="Mindestens 1 Benutzer zugewiesen"
          hint="→ Tab Benutzer: Benutzer einladen. Der eingeladene Benutzer erhält eine E-Mail von Supabase." />
        {settings.modul_newsletter && (
          <>
            <CheckItem ok={hasBrevo}
              label="Brevo API-Key & Absender konfiguriert"
              hint="→ Tab Brevo: API-Key, Absender-E-Mail und Absender-Name eintragen." />
            <CheckItem ok={hasListen}
              label="Brevo Listen-IDs eingetragen"
              hint="→ Tab Brevo: Mindestens Privat und Gastronomie eintragen. IDs findest du unter app.brevo.com → Contacts → Lists." />
          </>
        )}
        <CheckItem ok={hasStripeCustomer}
          label="Stripe Customer angelegt"
          hint="→ Tab Stripe: E-Mail eintragen und auf '+ Customer anlegen' klicken." />
        <CheckItem ok={hasStripeAbo}
          label="Stripe Abonnement aktiv"
          hint="→ Tab Stripe: Plan wählen → Stripe Checkout öffnet sich → Zahlungsdaten eingeben." />
      </div>

      <div className="mt-4 p-4 bg-blue-50 border border-blue-200 rounded-xl text-xs text-blue-800 space-y-2">
        <p className="font-semibold">Supabase Setup für neuen Benutzer</p>
        <p>1. Klicke auf <strong>Benutzer einladen</strong> und trage die E-Mail-Adresse ein.</p>
        <p>2. Supabase sendet automatisch eine Einladungs-E-Mail mit Link zum Passwort setzen.</p>
        <p>3. Nach Passwort-Setzen kann sich der Benutzer unter <a href="https://software112.icp-consultants.at/login" target="_blank" rel="noreferrer" className="underline">software112.icp-consultants.at/login</a> anmelden.</p>
        <p className="font-semibold mt-2">Stripe Webhook (einmalig global, nicht pro Mandant)</p>
        <p>Endpoint in Stripe Dashboard registrieren: <code className="bg-white/60 px-1 rounded font-mono">https://software112.icp-consultants.at/api/stripe/webhook</code></p>
        <p>Events: <code className="bg-white/60 px-1 rounded font-mono">customer.subscription.*</code>, <code className="bg-white/60 px-1 rounded font-mono">invoice.payment_succeeded</code>, <code className="bg-white/60 px-1 rounded font-mono">invoice.payment_failed</code></p>
        <p className="font-semibold mt-2">Tenant-ID (für technische Konfiguration)</p>
        <code className="bg-white/60 px-2 py-0.5 rounded font-mono">{tenant.id}</code>
      </div>
    </div>
  )
}


// ── Tab: bawb.at (LFRZ Weinkontrolle) ────────────────────────────────────────
const BAWB_URL = 'https://services2.lfrz.at/at.lfrz.wein/frame.html'

function BawbTab({ tenant, settings }: { tenant: TenantDetail; settings: TenantSettings }) {
  const [kennung,  setKennung]  = useState(settings.bawb_kennung  ?? '')
  const [passwort, setPasswort] = useState(settings.bawb_passwort ?? '')
  const [showPw,   setShowPw]   = useState(false)
  const [status,   setStatus]   = useState<'idle' | 'saving' | 'ok' | 'err'>('idle')
  const [errMsg,   setErrMsg]   = useState<string | null>(null)
  const [, startTransition] = useTransition()

  const inputCls = 'w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40'

  function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setStatus('saving'); setErrMsg(null)
    const fd = new FormData()
    fd.set('bawb_kennung',  kennung.trim())
    fd.set('bawb_passwort', passwort)
    startTransition(async () => {
      const res = await saveBawbZugangsdaten(tenant.id, fd)
      if (res?.error) { setStatus('err'); setErrMsg(res.error) }
      else setStatus('ok')
    })
  }

  return (
    <div className="space-y-5">

      {/* Info + Link */}
      <div className="card p-5 space-y-3">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="font-semibold text-gray-800 mb-1">LFRZ Weinkontrolle Online (bawb.at)</h3>
            <p className="text-sm text-s112-muted">
              Österreichisches Weingesetz-Onlineportal für Erntemeldung, Betriebsmitteilung und Verarbeitungsprotokoll.
            </p>
          </div>
          <a
            href={BAWB_URL}
            target="_blank"
            rel="noreferrer"
            className="shrink-0 bg-s112-teal text-white px-4 py-2 rounded-xl text-sm font-semibold hover:bg-opacity-90 transition-colors whitespace-nowrap"
          >
            bawb.at öffnen
          </a>
        </div>
        <p className="text-xs text-s112-muted bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          Die Zugangsdaten werden in der Datenbank gespeichert (wie API-Keys). Für erhöhte Sicherheit empfiehlt sich Supabase Vault – aktuell nicht aktiviert.
        </p>
      </div>

      {/* Zugangsdaten */}
      <form onSubmit={handleSave} className="card p-5 space-y-4">
        <h3 className="font-semibold text-gray-800 text-sm">Zugangsdaten</h3>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Kennung (Betriebsnummer)</label>
            <input
              type="text"
              value={kennung}
              onChange={e => { setKennung(e.target.value); setStatus('idle') }}
              placeholder="z.B. 4489781"
              className={inputCls}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Passwort</label>
            <div className="relative">
              <input
                type={showPw ? 'text' : 'password'}
                value={passwort}
                onChange={e => { setPasswort(e.target.value); setStatus('idle') }}
                placeholder="Passwort"
                className={inputCls + ' pr-16'}
              />
              <button
                type="button"
                onClick={() => setShowPw(v => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-s112-muted hover:text-gray-700 px-1"
              >
                {showPw ? 'verbergen' : 'anzeigen'}
              </button>
            </div>
          </div>
        </div>

        {errMsg && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{errMsg}</p>}

        <div className="flex items-center gap-3">
          <button type="submit" disabled={status === 'saving'}
            className="bg-s112-teal text-white px-4 py-1.5 rounded-lg text-sm font-medium hover:bg-opacity-90 disabled:opacity-50 transition-colors">
            {status === 'saving' ? 'Speichert…' : 'Zugangsdaten speichern'}
          </button>
          {status === 'ok' && <span className="text-xs text-green-700 font-medium">Gespeichert</span>}
        </div>
      </form>

      {/* Gespeicherte Zugangsdaten – Kopier-Hilfe */}
      {(settings.bawb_kennung || settings.bawb_passwort) && (
        <div className="card p-4 space-y-2 bg-s112-bg">
          <p className="text-xs font-semibold text-gray-700">Gespeicherte Zugangsdaten (zum Kopieren)</p>
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div>
              <span className="text-s112-muted">Kennung:</span>{' '}
              <span className="font-mono font-medium text-gray-800">{settings.bawb_kennung ?? '–'}</span>
            </div>
            <div>
              <span className="text-s112-muted">Passwort:</span>{' '}
              <span className="font-mono font-medium text-gray-800">{settings.bawb_passwort ?? '–'}</span>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}

// ── Tab: SumUp ───────────────────────────────────────────────────────────────

function SumUpTab({ tenant, settings }: { tenant: TenantDetail; settings: TenantSettings }) {
  const [apiKey, setApiKey]         = useState((settings as any).sumup_api_key ?? '')
  const [merchantCode, setMerchantCode] = useState((settings as any).sumup_merchant_code ?? '')
  const [saving, setSaving]         = useState(false)
  const [msg, setMsg]               = useState<string | null>(null)
  const [msgIsError, setMsgIsError] = useState(false)

  if (!(settings as any).modul_sumup) {
    return (
      <div className="text-sm text-s112-muted py-8 text-center">
        SumUp-Modul ist deaktiviert. Aktiviere es zuerst im Tab „Module".
      </div>
    )
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true); setMsg(null)
    const fd = new FormData()
    fd.set('sumup_api_key',       apiKey)
    fd.set('sumup_merchant_code', merchantCode)
    const res = await saveSumUpConfig(tenant.id, fd)
    setMsgIsError(!!res?.error)
    setMsg(res?.error ?? 'Gespeichert')
    setSaving(false)
  }

  return (
    <div className="max-w-lg space-y-5">
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-800">
        <strong>Hinweis:</strong> API-Key und Merchant-Code werden in der Datenbank gespeichert.
        Für Produktionseinsatz empfiehlt sich Supabase Vault.
      </div>
      <form onSubmit={handleSave} className="space-y-4">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">SumUp API Key</label>
          <input value={apiKey} onChange={e => setApiKey(e.target.value)}
            placeholder="sup_sk_…"
            className="w-full border border-s112-border rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-s112-teal/40" />
          <p className="text-xs text-s112-muted mt-1">Persönlicher Access-Token aus dem SumUp-Dashboard → API Keys</p>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Merchant Code</label>
          <input value={merchantCode} onChange={e => setMerchantCode(e.target.value)}
            placeholder="M…"
            className="w-full border border-s112-border rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-s112-teal/40" />
          <p className="text-xs text-s112-muted mt-1">Zu finden unter SumUp-Profil → Unternehmensinformationen</p>
        </div>
        {msg && <p className={`text-sm ${msgIsError ? 'text-red-600' : 'text-green-600'}`}>{msg}</p>}
        <button type="submit" disabled={saving}
          className="bg-s112-teal text-white px-5 py-2 rounded-xl text-sm font-semibold hover:bg-opacity-90 disabled:opacity-40">
          {saving ? 'Speichern…' : 'Speichern'}
        </button>
      </form>
    </div>
  )
}

// ── Haupt-Komponente ──────────────────────────────────────────────────────────


// ── Tab: Stripe Abrechnung ────────────────────────────────────────────────────

function StripeTab({ tenant }: { tenant: TenantDetail }) {
  const router   = useRouter()
  const [pending, startTransition] = useTransition()
  const [error,  setError]   = useState<string | null>(null)
  const [email,  setEmail]   = useState('')

  const PLANS = [
    { id: process.env.NEXT_PUBLIC_STRIPE_PRICE_PROFESSIONAL      ?? '', label: 'Professional (€299/Mo)' },
    { id: process.env.NEXT_PUBLIC_STRIPE_PRICE_PROFESSIONAL_PLUS   ?? '', label: 'Professional+ (€349/Mo)' },
    { id: process.env.NEXT_PUBLIC_STRIPE_PRICE_ENTERPRISE  ?? '', label: 'Enterprise (€399/Mo)' },
  ]

  const statusMeta = tenant.stripe_status ? (STRIPE_STATUS_META[tenant.stripe_status] ?? null) : null
  const planLabel  = tenant.stripe_plan   ? (STRIPE_PLAN_LABELS[tenant.stripe_plan] ?? tenant.stripe_plan) : null

  function handleCreateCustomer() {
    if (!email) { setError('E-Mail für Stripe Customer erforderlich'); return }
    setError(null)
    startTransition(async () => {
      const r = await createStripeCustomer(tenant.id, tenant.name, email)
      if (r?.error) setError(r.error)
      else router.refresh()
    })
  }

  function handleCheckout(priceId: string) {
    if (!tenant.stripe_customer_id) { setError('Zuerst Stripe Customer anlegen'); return }
    setError(null)
    startTransition(async () => {
      const r = await createStripeCheckoutSession(tenant.id, tenant.stripe_customer_id!, priceId)
      if (r?.error) setError(r.error)
      else if (r?.url) window.location.href = r.url
    })
  }

  function handlePortal() {
    if (!tenant.stripe_customer_id) return
    startTransition(async () => {
      const r = await createStripePortalSession(tenant.id, tenant.stripe_customer_id!)
      if (r?.error) setError(r.error)
      else if (r?.url) window.location.href = r.url
    })
  }

  function handleCancel() {
    if (!tenant.stripe_subscription_id) return
    if (!confirm('Abo wirklich sofort kündigen?')) return
    startTransition(async () => {
      const r = await cancelStripeSubscription(tenant.id, tenant.stripe_subscription_id!)
      if (r?.error) setError(r.error)
      else router.refresh()
    })
  }

  return (
    <div className="space-y-6">
      {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3 text-sm">{error}</div>}

      {/* Status-Karte */}
      <div className="card p-4 space-y-3">
        <h2 className="text-sm font-semibold text-s112-muted uppercase tracking-wider">Abo-Status</h2>
        <div className="flex items-center gap-3 flex-wrap">
          {statusMeta
            ? <span className={`text-sm font-semibold px-3 py-1 rounded-full ${statusMeta.color}`}>{statusMeta.label}</span>
            : <span className="text-sm text-s112-muted italic">Kein Stripe-Abo</span>
          }
          {planLabel && <span className="text-sm text-gray-600">{planLabel}</span>}
          {tenant.stripe_current_period_end && (
            <span className="text-xs text-s112-muted">
              Periode bis {new Date(tenant.stripe_current_period_end).toLocaleDateString('de-AT')}
            </span>
          )}
        </div>
        {tenant.stripe_customer_id && (
          <p className="text-xs text-s112-muted font-mono">Customer: {tenant.stripe_customer_id}</p>
        )}
        {tenant.stripe_subscription_id && (
          <p className="text-xs text-s112-muted font-mono">Subscription: {tenant.stripe_subscription_id}</p>
        )}
      </div>

      {/* Customer anlegen */}
      {!tenant.stripe_customer_id && (
        <div className="card p-4 space-y-3">
          <h2 className="text-sm font-semibold text-s112-muted uppercase tracking-wider">Stripe Customer anlegen</h2>
          <div className="flex gap-2">
            <input
              type="email" value={email} onChange={e => setEmail(e.target.value)}
              placeholder="E-Mail des Mandanten"
              className="form-input flex-1 text-sm"
            />
            <button
              type="button" onClick={handleCreateCustomer} disabled={pending}
              className="bg-s112-teal text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-opacity-90 disabled:opacity-50 whitespace-nowrap">
              {pending ? 'Erstelle…' : '+ Customer anlegen'}
            </button>
          </div>
        </div>
      )}

      {/* Abo abschließen */}
      {tenant.stripe_customer_id && !tenant.stripe_subscription_id && (
        <div className="card p-4 space-y-3">
          <h2 className="text-sm font-semibold text-s112-muted uppercase tracking-wider">Abonnement abschließen</h2>
          <div className="grid grid-cols-2 gap-2">
            {PLANS.filter(p => p.id).map(p => (
              <button key={p.id} type="button" disabled={pending}
                onClick={() => handleCheckout(p.id)}
                className="border border-s112-border rounded-lg px-4 py-3 text-sm text-left hover:border-s112-teal hover:bg-s112-bg transition-colors disabled:opacity-50">
                <span className="font-medium text-gray-800">{p.label}</span>
                <span className="text-xs text-s112-muted block mt-0.5">→ Stripe Checkout</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Abo verwalten / kündigen */}
      {tenant.stripe_subscription_id && (
        <div className="card p-4 space-y-3">
          <h2 className="text-sm font-semibold text-s112-muted uppercase tracking-wider">Abo verwalten</h2>
          <div className="flex gap-2 flex-wrap">
            <button type="button" onClick={handlePortal} disabled={pending}
              className="bg-s112-teal text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-opacity-90 disabled:opacity-50">
              {pending ? 'Lade…' : 'software:112 Kundenportal'}
            </button>
            <button type="button" onClick={handleCancel} disabled={pending}
              className="border border-red-200 text-red-500 px-4 py-2 rounded-lg text-sm hover:bg-red-50 disabled:opacity-50">
              Abo kündigen
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

type Tab = 'branding' | 'benutzer' | 'brevo' | 'module' | 'betrieb' | 'verkauf' | 'email' | 'm365' | 'bawb' | 'sumup' | 'stripe' | 'checkliste'

export default function MandantDetailClient({ tenant, settings, members }: {
  tenant:   TenantDetail
  settings: TenantSettings
  members:  TenantMember[]
}) {
  const [tab, setTab]           = useState<Tab>('branding')
  const [editName, setEditName] = useState(false)
  const [name, setName]         = useState(tenant.name)
  const [pending, startTransition] = useTransition()

  function handleRename(e: React.FormEvent) {
    e.preventDefault()
    startTransition(async () => {
      await renameTenantAdmin(tenant.id, name)
      setEditName(false)
    })
  }

  const tabs: { id: Tab; label: string }[] = [
    { id: 'branding',    label: 'Branding' },
    { id: 'benutzer',    label: 'Benutzer' },
    { id: 'brevo',       label: 'Brevo' },
    { id: 'module',      label: 'Module' },
    { id: 'betrieb',     label: 'Betrieb' },
    { id: 'verkauf',     label: 'Verkauf' },
    { id: 'email',       label: 'E-Mail'      },
    { id: 'm365',        label: 'M365'        },
    { id: 'bawb',        label: 'bawb.at'     },
    { id: 'sumup',       label: 'SumUp'       },
    { id: 'stripe',      label: 'Stripe'      },
    { id: 'checkliste',  label: 'Checkliste' },
  ]

  return (
    <div>
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <div className="flex items-center gap-2 text-sm text-s112-muted mb-1.5">
            <span>Administration</span>
            <span>/</span>
            <Link href="/admin/mandanten" className="hover:text-s112-teal transition-colors">Mandanten</Link>
            <span>/</span>
            <span className="text-gray-700 font-medium">{tenant.name}</span>
          </div>
          {editName ? (
            <form onSubmit={handleRename} className="flex items-center gap-2 mt-1">
              <input value={name} onChange={e => setName(e.target.value)}
                className="text-2xl font-bold text-gray-900 border-b-2 border-s112-teal outline-none bg-transparent"
                autoFocus />
              <button type="submit" disabled={pending}
                className="text-xs bg-s112-teal text-white px-2.5 py-1 rounded-lg disabled:opacity-40">OK</button>
              <button type="button" onClick={() => { setEditName(false); setName(tenant.name) }}
                className="text-xs text-s112-muted hover:text-gray-700">Abbrechen</button>
            </form>
          ) : (
            <div className="flex items-center gap-2 mt-1">
              <h1 className="text-2xl font-bold text-gray-900">{tenant.name}</h1>
              <button onClick={() => setEditName(true)}
                className="text-s112-muted hover:text-s112-teal mt-0.5">
                <Pencil className="w-4 h-4" />
              </button>
            </div>
          )}
          <p className="text-xs text-s112-muted mt-0.5">
            {tenant.slug} · {tenant.plan} ·
            Erstellt {new Date(tenant.created_at).toLocaleDateString('de-AT')}
          </p>
        </div>

        {/* Status-Badges */}
        <div className="flex gap-2 flex-wrap justify-end">
          {settings.modul_weingarten && <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">Weingarten</span>}
          {settings.modul_kellerbuch && <span className="text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full">Kellerbuch</span>}
          {settings.modul_crm        && <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">CRM</span>}
          {settings.modul_newsletter && <span className="text-xs bg-orange-100 text-orange-700 px-2 py-0.5 rounded-full">Newsletter</span>}
          {settings.modul_ea         && <span className="text-xs bg-lime-100 text-lime-700 px-2 py-0.5 rounded-full">E&A</span>}
          {settings.modul_sumup      && <span className="text-xs bg-violet-100 text-violet-700 px-2 py-0.5 rounded-full">SumUp</span>}
          {settings.modul_export     && <span className="text-xs bg-cyan-100 text-cyan-700 px-2 py-0.5 rounded-full">Exportaufträge</span>}
          {tenant.stripe_status === 'active'   && <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">Abo aktiv</span>}
          {tenant.stripe_status === 'past_due' && <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">Zahlung offen</span>}
          {tenant.stripe_status === 'cancelled' && <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">Abo gekündigt</span>}
        </div>
      </div>

      {/* Tab-Navigation */}
      <div className="flex gap-1 border-b border-s112-border mb-6">
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
              tab === t.id
                ? 'border-s112-teal text-s112-teal'
                : 'border-transparent text-s112-muted hover:text-gray-700'
            }`}>
            {t.label}
            {t.id === 'benutzer' && members.length > 0 &&
              <span className="ml-1.5 text-xs bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded-full">{members.length}</span>}
          </button>
        ))}
      </div>

      {/* Tab-Inhalt */}
      {tab === 'branding'   && <BrandingTab   tenant={tenant} settings={settings} />}
      {tab === 'benutzer'   && <BenutzerTab   tenant={tenant} members={members} />}
      {tab === 'brevo'      && <BrevoTab      tenant={tenant} settings={settings} />}
      {tab === 'module'     && <ModuleTab     tenant={tenant} settings={settings} />}
      {tab === 'betrieb'    && <BetriebTab    tenant={tenant} settings={settings} />}
      {tab === 'verkauf'    && <VerkaufTab    tenant={tenant} settings={settings} />}
      {tab === 'email'      && <EmailTab      tenant={tenant} settings={settings} />}
      {tab === 'm365'       && <M365Tab       tenant={tenant} settings={settings} />}
      {tab === 'bawb'       && <BawbTab       tenant={tenant} settings={settings} />}
      {tab === 'sumup'      && <SumUpTab      tenant={tenant} settings={settings} />}
      {tab === 'stripe'     && <StripeTab     tenant={tenant} />}
      {tab === 'checkliste' && <ChecklisteTab tenant={tenant} settings={settings} members={members} />}
    </div>
  )
}
