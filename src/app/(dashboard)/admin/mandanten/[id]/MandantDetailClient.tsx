'use client'

import Link from '@/components/ui/Link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useState, useEffect, useTransition, useRef, Suspense } from 'react'
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
  saveKellerwirtschaftAdmin,
  resetRechnungsZaehler,
  resetKundenZaehler,
  saveSumUpConfig,
  saveBawbZugangsdaten,
  createStripeCustomer,
  createStripeCheckoutSession,
  createStripePortalSession,
  cancelStripeSubscription,
  wendePaketVorgabenAn,
} from './actions'
import { PAKETE, PAKET_REIHENFOLGE, paketAusPlan, paketPriceId, preisText, type PaketKey } from '@/lib/pakete'
import { BETRIEBSNUMMER_MUSTER, BETRIEBSNUMMER_ZWECK, weinbauBetriebsnummerFehlt } from '@/lib/betrieb/betriebsnummer'
import { fehlerText } from '@/lib/fehler'
import { STRIPE_STATUS_META, STRIPE_PLAN_LABELS } from '@/lib/stripe/client'
import type { TenantDetail, TenantSettings, TenantMember } from './page'
import { bundeslandAusKundennummer } from '@/lib/tenant/kundennummer'
import KontrastHinweis from '@/components/ui/KontrastHinweis'
import { EINHEIT_ZEICHEN, type MostgewichtEinheit } from '@/lib/wein/mostgewicht'

// ── Hilfsfunktionen ───────────────────────────────────────────────────────────

const ROLLEN = [
  { value: 'tenant_admin', label: 'Betriebs-Manager' },
  { value: 'winzer',       label: 'Mitarbeiter' },
  { value: 'leser',        label: 'Leser' },
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
      <button type="button" role="switch" aria-checked={on} onClick={onToggle}
        className={`w-9 h-5 rounded-full transition-colors flex-shrink-0 ${on ? 'bg-s112-teal' : 'bg-s112-line-str'}`}>
        <span className={`block w-4 h-4 bg-white rounded-full shadow mt-0.5 transition-transform ${on ? 'translate-x-4' : 'translate-x-0.5'}`} />
      </button>
      <span className="text-sm text-s112-text-1">{label}</span>
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
    fd.set('modul_controlling', settings.modul_controlling ? 'true' : 'false')
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
        <label className="block text-xs font-medium text-s112-text-2 mb-1">Anzeigename</label>
        <input aria-label="Anzeigename" name="anzeigename" defaultValue={settings.anzeigename ?? tenant.name}
          placeholder={tenant.name} className={inputCls()} />
        <p className="text-xs text-s112-muted mt-1">Wird oben in der Kopfleiste neben „Betrieb“ angezeigt – leer lassen für den Betriebsnamen.</p>
      </div>

      <div>
        <label className="block text-xs font-medium text-s112-text-2 mb-1">Logo</label>

        <input aria-label="Logo"
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
            className="text-xs font-medium bg-s112-teal/10 hover:bg-s112-teal/20 text-s112-blue-700 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-40"
          >
            {logoUploading ? 'Hochladen…' : 'Logo-Datei hochladen'}
          </button>
          {logoError && <span className="text-xs text-s112-err">{logoError}</span>}
        </div>
        <p className="text-xs text-s112-muted mt-1">PNG, JPG, WebP oder SVG, max. 2 MB. Empfohlen: max. 140×40 px.</p>

        <input name="logo_url" value={logoUrl} onChange={e => setLogoUrl(e.target.value)}
          placeholder="/logos/mein-logo.png oder https://..." className={inputCls() + ' mt-2'} />
        <p className="text-xs text-s112-muted mt-1">
          Wird beim Hochladen automatisch befüllt. Alternativ kann hier auch direkt eine
          öffentliche URL oder ein Pfad im <code className="bg-[#F2F3F5] px-1 rounded">/public</code>-Ordner eingetragen werden.
        </p>
        {logoUrl && (
          <div className="mt-2 p-3 bg-s112-bg border border-s112-border rounded-lg inline-block">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={logoUrl} alt="Vorschau" className="max-h-10 max-w-[140px] object-contain" />
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-s112-text-2 mb-1">Primärfarbe</label>
          <div className="flex gap-2 items-center">
            <input type="color" value={primary} onChange={e => setPrimary(e.target.value)}
              className="w-8 h-8 rounded border border-s112-border cursor-pointer p-0.5 flex-shrink-0" />
            <input name="primary_color" value={primary} onChange={e => setPrimary(e.target.value)}
              className="flex-1 border border-s112-border rounded-lg px-3 py-1.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-s112-teal/40" />
          </div>
        </div>
        <div>
          <label className="block text-xs font-medium text-s112-text-2 mb-1">Sekundärfarbe</label>
          <div className="flex gap-2 items-center">
            <input type="color" value={secondary} onChange={e => setSecondary(e.target.value)}
              className="w-8 h-8 rounded border border-s112-border cursor-pointer p-0.5 flex-shrink-0" />
            <input name="secondary_color" value={secondary} onChange={e => setSecondary(e.target.value)}
              className="flex-1 border border-s112-border rounded-lg px-3 py-1.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-s112-teal/40" />
          </div>
        </div>
      </div>
      <KontrastHinweis primary={primary} secondary={secondary} name={settings.anzeigename || tenant.name} onUebernehmen={setPrimary} />

      <div>
        <label className="block text-xs font-medium text-s112-text-2 mb-1">
          Session Timeout (Minuten)
        </label>
        <input aria-label="Session Timeout (Minuten)" name="session_timeout_minuten" type="number" min="5" max="480"
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
          className="bg-s112-teal text-s112-yellow px-4 py-1.5 rounded-lg text-sm font-medium hover:bg-opacity-90 disabled:opacity-40">
          {pending ? 'Speichern…' : 'Speichern'}
        </button>
        {saved && <span className="text-xs text-s112-blue-700 font-medium">Gespeichert</span>}
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
      else { setSuccess(r.hinweis ?? `Einladung an ${inviteEmail} versandt.`); setInviteEmail(''); setInviteName(''); setShowInvite(false) }
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
      {error   && <div className="p-3 bg-s112-err-bg border border-s112-err/30 rounded-xl text-sm text-s112-err-fg">{error}</div>}
      {success && <div className="p-3 bg-s112-ok-bg border border-s112-ok/30 rounded-xl text-sm text-s112-ok-fg">{success}</div>}

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
                        className="text-xs text-s112-blue-700 hover:underline font-semibold disabled:opacity-50">Speichern</button>
                      <button onClick={() => setEditingNameId(null)}
                        className="text-xs text-s112-muted hover:text-s112-text-1">Abbrechen</button>
                    </div>
                  ) : (
                    <button onClick={() => { setEditingNameId(m.id); setEditName(m.fullName ?? '') }}
                      className="font-medium text-s112-text hover:text-s112-blue-700 inline-flex items-center gap-1.5 group">
                      {m.fullName ?? <span className="text-s112-err font-normal italic">kein Name hinterlegt</span>}
                      <Pencil size={11} className="opacity-0 group-hover:opacity-60" />
                    </button>
                  )}
                </td>
                <td className="px-4 py-3 text-s112-text-1">
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
                    <select value={editRole} onChange={e => setEditRole(e.target.value)}
                      className="border border-s112-border rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-s112-teal/40"
                      disabled={pending}>
                      {ROLLEN.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                    </select>
                  ) : (
                    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${ROLE_COLORS[m.role] ?? 'bg-[#F2F3F5] text-s112-text-2'}`}>
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
                        className="text-xs text-s112-blue-700 hover:underline font-semibold disabled:opacity-50">Speichern</button>
                      <button onClick={() => setEditingId(null)}
                        className="text-xs text-s112-muted hover:text-s112-text-1">Abbrechen</button>
                    </div>
                  ) : m.role !== 'system_admin' ? (
                    <div className="flex gap-3 justify-end">
                      {!m.confirmed && (
                        <button onClick={() => handleResendInvite(m)} disabled={pending}
                          className="text-xs text-s112-blue-700 hover:underline font-medium disabled:opacity-50">
                          Einladung erneut senden
                        </button>
                      )}
                      <button onClick={() => { setEditingId(m.id); setEditRole(m.role) }}
                        className="text-xs text-s112-blue-700 hover:underline font-medium">Rolle</button>
                      <button onClick={() => handleRemove(m)} disabled={pending}
                        className="text-xs text-s112-err hover:text-s112-err-fg disabled:opacity-50">Entfernen</button>
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
          className="inline-flex items-center gap-2 bg-s112-teal text-s112-yellow px-4 py-2 rounded-xl text-sm font-semibold hover:bg-opacity-90">
          + Benutzer einladen
        </button>
      ) : (
        <form onSubmit={handleInvite} className="bg-s112-bg border border-s112-border rounded-xl p-5 space-y-3">
          <h3 className="text-sm font-semibold text-s112-text">Benutzer einladen</h3>
          <p className="text-xs text-s112-muted">
            Neuer Benutzer: erhält Einladungs-E-Mail von Supabase zum Passwort setzen.<br />
            Bestehender Supabase-User: wird direkt zugewiesen.
          </p>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-s112-text-2 mb-1">Name *</label>
              <input aria-label="Name" value={inviteName} onChange={e => setInviteName(e.target.value)}
                required className={inputCls()} placeholder="Vorname Nachname" autoFocus />
            </div>
            <div>
              <label className="block text-xs font-medium text-s112-text-2 mb-1">E-Mail *</label>
              <input aria-label="E-Mail" type="email" value={inviteEmail} onChange={e => setInviteEmail(e.target.value)}
                required className={inputCls()} placeholder="benutzer@weingut.at" />
            </div>
            <div>
              <label className="block text-xs font-medium text-s112-text-2 mb-1">Rolle *</label>
              <select aria-label="Rolle" value={inviteRole} onChange={e => setInviteRole(e.target.value)}
                className={inputCls()}>
                {ROLLEN.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
            </div>
          </div>
          <div className="flex gap-2">
            <button type="submit" disabled={pending}
              className="bg-s112-teal text-s112-yellow px-4 py-1.5 rounded-lg text-sm font-medium hover:bg-opacity-90 disabled:opacity-40">
              {pending ? 'Einladen…' : 'Einladen'}
            </button>
            <button type="button" onClick={() => { setShowInvite(false); setInviteEmail(''); setInviteName('') }}
              className="px-4 py-1.5 rounded-lg text-sm font-medium text-s112-text-2 hover:text-s112-text">
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
  const [fehler, setFehler]        = useState<string | null>(null)
  const [kurzname, setKurzname]    = useState(settings.newsletter_kurzname ?? '')

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
    fd.set('modul_controlling', settings.modul_controlling ? 'true' : 'false')
    fd.set('assistent_aktiv',  settings.assistent_aktiv   ? 'true' : 'false')
    // S11: Schlüssel wird nie angezeigt – leer gelassen = hinterlegten behalten (Maske)
    const neuerKey = String(fd.get('brevo_api_key_neu') ?? '').trim()
    fd.delete('brevo_api_key_neu')
    fd.set('brevo_api_key', neuerKey || (settings.brevo_api_key ?? ''))
    setFehler(null)
    startTransition(async () => {
      try {
        await saveTenantSettings(tenant.id, fd)
        setSaved(true)
        router.refresh()
      } catch (err) {
        setFehler(fehlerText(err))
      }
    })
  }

  if (!settings.modul_newsletter) {
    return (
      <div className="p-6 bg-s112-warn-bg border border-s112-warn/30 rounded-xl text-sm text-s112-warn-fg">
        <p className="font-semibold mb-1">Newsletter-Modul ist deaktiviert</p>
        <p>Aktiviere das Newsletter-Modul im Tab <strong>Module</strong>, um die Brevo-Konfiguration zu verwenden.</p>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5 max-w-lg">
      <div className="p-4 bg-s112-blue-50 border border-s112-blue-100 rounded-xl text-xs text-s112-blue-700 space-y-1">
        <p className="font-semibold">Brevo-Einrichtung – Hinweise</p>
        <p>→ API-Key: <a href="https://app.brevo.com/settings/keys/api" target="_blank" rel="noreferrer" className="underline">app.brevo.com → Account → API Keys</a></p>
        <p>→ Listen-IDs: <a href="https://app.brevo.com/contact/list-listing" target="_blank" rel="noreferrer" className="underline">app.brevo.com → Contacts → Lists</a> → ID in der URL</p>
        <p>→ Absender-E-Mail muss in Brevo als verifizierte Domain eingetragen sein.</p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <label className="block text-xs font-medium text-s112-text-2 mb-1">API-Key</label>
          <input aria-label="API-Key" name="brevo_api_key_neu" type="password" autoComplete="off" defaultValue=""
            placeholder={settings.brevo_api_key ? 'hinterlegt (verschlüsselt) – zum Ändern neu eingeben' : 'xkeysib-…'} className={inputCls()} />
        </div>
        <div>
          <label className="block text-xs font-medium text-s112-text-2 mb-1">Absender E-Mail</label>
          <input aria-label="Absender E-Mail" name="brevo_sender_mail" defaultValue={settings.brevo_sender_mail ?? ''}
            placeholder="info@weingut.at" className={inputCls()} />
        </div>
        <div>
          <label className="block text-xs font-medium text-s112-text-2 mb-1">Absender Name</label>
          <input aria-label="Absender Name" name="brevo_sender_name" defaultValue={settings.brevo_sender_name ?? ''}
            placeholder="Weingut Mustermann" className={inputCls()} />
        </div>
      </div>

      <div>
        <p className="text-xs font-semibold text-s112-text-1 uppercase tracking-wide mb-2">Listen-IDs</p>
        <div className="grid grid-cols-2 gap-2">
          {[
            { name: 'brevo_list_privat', label: 'Privat',       val: settings.brevo_list_privat },
            { name: 'brevo_list_gastro', label: 'Gastronomie',  val: settings.brevo_list_gastro },
            { name: 'brevo_list_handel', label: 'Handel',       val: settings.brevo_list_handel },
            { name: 'brevo_list_export', label: 'Export',       val: settings.brevo_list_export },
            { name: 'brevo_list_grossh', label: 'Großhandel',   val: settings.brevo_list_grossh },
          ].map(f => (
            <div key={f.name}>
              <label className="block text-xs font-medium text-s112-text-2 mb-1">{f.label}</label>
              <input name={f.name} defaultValue={f.val ?? ''}
                placeholder="z.B. 3" type="number" min="1"
                className="w-full border border-s112-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40" />
            </div>
          ))}
        </div>
      </div>

      <div className="space-y-3 pt-2 border-t border-s112-line">
        <p className="text-xs font-semibold text-s112-text-1 uppercase tracking-wide pt-3">Öffentliche Anmeldeseite</p>
        <div>
          <label htmlFor="nl-kurzname" className="block text-xs font-medium text-s112-text-2 mb-1">Kurzname (Adresse)</label>
          <input id="nl-kurzname" name="newsletter_kurzname" value={kurzname}
            onChange={e => setKurzname(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
            placeholder="z. B. gebeshuber" maxLength={40} className={inputCls()} />
          <p className="text-xs text-s112-muted mt-1">
            {kurzname
              ? <>Seite: <span className="font-mono">/newsletter/{kurzname}</span>{settings.newsletter_kurzname === kurzname && settings.brevo_api_key && settings.brevo_sender_mail && <> · <a href={`/newsletter/${kurzname}`} target="_blank" rel="noreferrer" className="underline">öffnen</a></>}</>
              : 'Ohne Kurzname gibt es keine öffentliche Anmeldeseite.'}
          </p>
        </div>
        <div>
          <label htmlFor="nl-datenschutz" className="block text-xs font-medium text-s112-text-2 mb-1">Link zur Datenschutzerklärung des Betriebs</label>
          <input id="nl-datenschutz" name="newsletter_datenschutz_url" type="url" defaultValue={settings.newsletter_datenschutz_url ?? ''}
            placeholder="https://www.weingut.at/datenschutz" className={inputCls()} />
        </div>
        <div>
          <label htmlFor="nl-einleitung" className="block text-xs font-medium text-s112-text-2 mb-1">Einleitungstext (optional)</label>
          <textarea id="nl-einleitung" name="newsletter_einleitung" rows={3} maxLength={600} defaultValue={settings.newsletter_einleitung ?? ''}
            placeholder="Neuigkeiten zu unseren Weinen, Jahrgängen und Verkostungsterminen – direkt in Ihr Postfach."
            className={inputCls()} />
        </div>
      </div>

      {fehler && <p role="alert" className="text-sm text-s112-err-fg">{fehler}</p>}
      <div className="flex items-center gap-3">
        <button type="submit" disabled={pending}
          className="bg-s112-teal text-s112-yellow px-4 py-1.5 rounded-lg text-sm font-medium hover:bg-opacity-90 disabled:opacity-40">
          {pending ? 'Speichern…' : 'Speichern'}
        </button>
        {saved && <span role="status" className="text-xs text-s112-blue-700 font-medium">Gespeichert</span>}
      </div>
    </form>
  )
}

// ── Tab: Module ───────────────────────────────────────────────────────────────

function ModuleTab({ tenant, settings }: { tenant: TenantDetail; settings: TenantSettings }) {
  const router                     = useRouter()
  const [pending, startTransition] = useTransition()
  // Paketmodell (2.9.2026, Rückmeldung 4.9.2026): die Module kommen aus dem
  // gebuchten Paket (tenants.stripe_plan) - keine Einzel-Toggles mehr, der
  // Stripe-Webhook setzt die Flags bei jedem Subscription-Event hart, bis
  // dahin "Paket-Vorgaben anwenden". Vom System geführt: enthält das Paket
  // die E&A-Rechnung (Standard, Premium), muss die Buchhaltungsart gewählt
  // werden (Migration 197) - E&A in software:112 oder Doppik beim
  // Steuerberater (BMD). Einzige weitere Handeinstellung: SumUp (Hardware).
  const paket = paketAusPlan(tenant.stripe_plan)
  const [paketWahl, setPaketWahl]  = useState<PaketKey | ''>(paket ?? '')
  const [paketMsg, setPaketMsg]    = useState<string | null>(null)
  // '' = noch nicht gewählt (bei Betrieben ohne E&A gibt es noch keine Wahl)
  const [buchhaltungsart, setBuchhaltungsart] = useState<'ea' | 'doppik' | ''>(settings.modul_ea ? (settings.buchhaltungsart ?? 'ea') : '')
  const [sumup, setSumup]          = useState(settings.modul_sumup ?? false)
  const [saved, setSaved]          = useState(false)

  // Props nach router.refresh() (Paket-Vorgaben, Stripe-Webhook) übernehmen
  useEffect(() => {
    setBuchhaltungsart(settings.modul_ea ? (settings.buchhaltungsart ?? 'ea') : '')
    setSumup(settings.modul_sumup ?? false)
  }, [settings])

  const gewaehlt = paketWahl ? PAKETE[paketWahl] : (paket ? PAKETE[paket] : null)
  const brauchtBuchhaltungsart = !!gewaehlt?.module.modul_ea
  const wahlFehlt = brauchtBuchhaltungsart && buchhaltungsart === ''

  function handlePaketAnwenden() {
    setPaketMsg(null)
    startTransition(async () => {
      const r = await wendePaketVorgabenAn(tenant.id, paketWahl || undefined, buchhaltungsart)
      if ('error' in r && r.error) { setPaketMsg(r.error); return }
      setPaketMsg(`Vorgaben des Pakets ${PAKETE[(r as { paket: PaketKey }).paket].label} angewendet.`)
      router.refresh()
    })
  }

  function handleSave() {
    const fd = new FormData()
    fd.set('anzeigename',      settings.anzeigename ?? '')
    fd.set('logo_url',         settings.logo_url ?? '')
    fd.set('primary_color',    settings.primary_color)
    fd.set('secondary_color',  settings.secondary_color)
    fd.set('modul_weingarten', settings.modul_weingarten ? 'true' : 'false')
    fd.set('modul_kellerbuch', settings.modul_kellerbuch  ? 'true' : 'false')
    fd.set('modul_crm',        settings.modul_crm         ? 'true' : 'false')
    fd.set('modul_newsletter', settings.modul_newsletter   ? 'true' : 'false')
    fd.set('modul_ea',         settings.modul_ea           ? 'true' : 'false')
    fd.set('modul_sumup',      sumup && settings.modul_ea  ? 'true' : 'false')
    fd.set('modul_export',     settings.modul_export        ? 'true' : 'false')
    fd.set('modul_controlling', settings.modul_controlling   ? 'true' : 'false')
    fd.set('buchhaltungsart',  buchhaltungsart || 'ea')
    fd.set('assistent_aktiv',  settings.assistent_aktiv     ? 'true' : 'false')
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
      router.refresh()
      setTimeout(() => setSaved(false), 2500)
    })
  }

  // Was der Betrieb aktuell hat (tatsächliche Flags - nach Paket-Anwendung bzw. Webhook)
  const p = paket ? PAKETE[paket] : null
  const modulListe: { label: string; aktiv: boolean; hinweis?: string }[] = [
    { label: 'Weingarten & Rieden',      aktiv: settings.modul_weingarten },
    { label: 'Kellerbuch',               aktiv: settings.modul_kellerbuch },
    { label: 'CRM',                      aktiv: settings.modul_crm },
    { label: 'Newsletter (Brevo)',       aktiv: settings.modul_newsletter,  hinweis: 'ab Standard' },
    { label: settings.buchhaltungsart === 'doppik' && settings.modul_ea ? 'Belege & BMD-Übergabe (Doppik beim Steuerberater)' : 'E&A-Rechnung inkl. BMD-Übergabe', aktiv: settings.modul_ea, hinweis: 'ab Standard' },
    { label: 'Controlling (Auswertungen, Kostenrechnung, Datenexport)', aktiv: settings.modul_controlling, hinweis: 'ab Standard' },
    { label: 'Exportaufträge (Weinexport)', aktiv: settings.modul_export, hinweis: 'Premium' },
    { label: 'bot:112 mit Sprachsteuerung', aktiv: settings.assistent_aktiv, hinweis: 'Premium' },
    { label: 'SumUp Kartenterminal',     aktiv: settings.modul_sumup,       hinweis: 'Zusatzoption' },
  ]
  const geaendert = (buchhaltungsart || 'ea') !== (settings.buchhaltungsart ?? 'ea') || sumup !== (settings.modul_sumup ?? false)

  const BuchhaltungsWahl = (
    <div className="space-y-2">
      {([
        ['ea',     'E&A-Rechnung in software:112',                  'UVA, Monatsabschluss und Jahresergebnis entstehen hier.'],
        ['doppik', 'Doppelte Buchhaltung beim Steuerberater (BMD)', 'software:112 erfasst Rechnungen und Belege und übergibt sie per BMD-Übergabe. UVA nur als Vorschau, Meldung macht die Kanzlei.'],
      ] as ['ea' | 'doppik', string, string][]).map(([key, label, hinweis]) => (
        <label key={key} className={`flex items-start gap-2.5 cursor-pointer rounded-xl border px-3 py-2.5 text-sm ${buchhaltungsart === key ? 'border-s112-teal bg-s112-teal/5' : 'border-s112-border'}`}>
          <input type="radio" name="buchhaltungsart" value={key} checked={buchhaltungsart === key}
            onChange={() => setBuchhaltungsart(key)} className="mt-1" />
          <span>
            <span className="text-s112-text font-medium">{label}</span>
            <span className="block text-[11px] text-s112-muted mt-0.5">{hinweis}</span>
          </span>
        </label>
      ))}
    </div>
  )

  return (
    <div className="space-y-5 max-w-md">
      <div className="card space-y-3">
        <h2 className="text-sm font-semibold text-s112-muted uppercase tracking-wider">Paket</h2>
        <p className="text-sm text-s112-text-1">
          {p ? <>Gebucht: <span className="font-medium">{p.label}</span> ({preisText(p)}, {p.maxBenutzer === null ? 'unbegrenzt Benutzer' : `${p.maxBenutzer} Benutzer`}, KI-Abfragen {p.kiLimit === null ? 'unbegrenzt' : `${p.kiLimit}/Monat`})</> : 'Kein Paket hinterlegt (kein Stripe-Abo).'}
        </p>
        <p className="text-xs text-s112-muted">
          Die Module ergeben sich aus dem Paket. Bis Stripe angebunden ist, wird das Paket hier gewählt und mit
          „Paket-Vorgaben anwenden“ gesetzt – danach übernimmt das der Stripe-Webhook bei jedem Paketwechsel.
        </p>
        <div className="flex items-center gap-2">
          <select value={paketWahl} onChange={e => setPaketWahl(e.target.value as PaketKey | '')}
            className="border border-s112-border rounded-lg px-2 py-1.5 text-sm">
            <option value="">– gebuchtes Paket –</option>
            {PAKET_REIHENFOLGE.map(k => <option key={k} value={k}>{PAKETE[k].label}</option>)}
          </select>
          <button type="button" onClick={handlePaketAnwenden} disabled={pending || wahlFehlt}
            className="border border-s112-teal text-s112-blue-700 px-3 py-1.5 rounded-lg text-sm font-medium hover:bg-s112-teal/5 disabled:opacity-40">
            Paket-Vorgaben anwenden
          </button>
        </div>
        {brauchtBuchhaltungsart && (
          <div className="rounded-xl border border-s112-border bg-s112-bg/60 p-3 space-y-2">
            <p className="text-xs font-medium text-s112-text-1">
              {gewaehlt?.label} enthält die E&amp;A-Rechnung – wer macht die Buchhaltung?
              {wahlFehlt && <span className="text-s112-warn-fg font-normal"> Bitte wählen, dann kann das Paket angewendet werden.</span>}
            </p>
            {BuchhaltungsWahl}
          </div>
        )}
        {paketMsg && <p className="text-xs text-s112-text-1">{paketMsg}</p>}

        <ul className="divide-y divide-s112-border/60 border-t border-s112-border/60 pt-1">
          {modulListe.map(m => (
            <li key={m.label} className="flex items-center justify-between py-2 text-sm">
              <span className={m.aktiv ? 'text-s112-text' : 'text-s112-tertiary'}>
                {m.aktiv ? <CheckCircle2 className="inline w-4 h-4 text-s112-blue-700 mr-1.5 -mt-0.5" /> : <span className="inline-block w-4 h-4 mr-1.5 align-middle rounded-full border border-s112-line-str" />}
                {m.label}
              </span>
              {m.hinweis && <span className="text-[11px] text-s112-muted">{m.hinweis}</span>}
            </li>
          ))}
        </ul>
      </div>

      {settings.modul_ea && (
        <div className="card space-y-3">
          <h2 className="text-sm font-semibold text-s112-muted uppercase tracking-wider">Buchhaltung &amp; Zusatzoptionen</h2>
          <p className="text-xs text-s112-muted">Wird nicht vom Paket entschieden, sondern vom Betrieb – kann jederzeit umgestellt werden.</p>
          {BuchhaltungsWahl}
          <div className="pt-1">
            <Toggle on={sumup} onToggle={() => setSumup(v => !v)} label="SumUp Kartenterminal (Zusatzoption, Hardware)" />
          </div>
          <div className="flex items-center gap-3 pt-1">
            <button onClick={handleSave} disabled={pending || !geaendert}
              className="bg-s112-teal text-s112-yellow px-4 py-1.5 rounded-lg text-sm font-medium hover:bg-opacity-90 disabled:opacity-40">
              {pending ? 'Speichern…' : 'Speichern'}
            </button>
            {saved && <span className="text-xs text-s112-blue-700 font-medium">Gespeichert</span>}
          </div>
        </div>
      )}
    </div>
  )
}


// ── Tab: Betrieb ──────────────────────────────────────────────────────────────

function BetriebTab({ tenant, settings }: { tenant: TenantDetail; settings: TenantSettings }) {
  const router                     = useRouter()
  const [pending, startTransition] = useTransition()
  const [saved, setSaved]          = useState(false)
  const [fehler, setFehler]        = useState<string | null>(null)

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    setFehler(null)
    startTransition(async () => {
      try {
        await saveBetriebEinstellungen(tenant.id, fd)
        setSaved(true)
        setTimeout(() => setSaved(false), 2000)
        router.refresh()
      } catch (err) {
        // z. B. Weinbau-Betriebsnummer fehlt bzw. ungültig (Pflichtfeld seit 25.09.2026);
        // fehlerText liest die AktionsFehler-Meldung aus dem digest (err.message ist in Produktion maskiert)
        setFehler(fehlerText(err))
      }
    })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6 max-w-lg">
      <div>
        <p className="text-xs font-semibold text-s112-text-1 uppercase tracking-wide mb-3">Betriebsdaten (Briefkopf)</p>
        <div className="grid grid-cols-1 gap-3">
          <div>
            <label className="block text-xs font-medium text-s112-text-2 mb-1">Betriebsname *</label>
            <input aria-label="Betriebsname" name="betrieb_name" defaultValue={settings.betrieb_name ?? ''} required className={inputCls()} placeholder="Weingut Gebeshuber" />
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div className="col-span-2">
              <label className="block text-xs font-medium text-s112-text-2 mb-1">Straße + Nr.</label>
              <input aria-label="Straße + Nr." name="betrieb_strasse" defaultValue={settings.betrieb_strasse ?? ''} className={inputCls()} placeholder="Hauptstraße 1" />
            </div>
            <div>
              <label className="block text-xs font-medium text-s112-text-2 mb-1">PLZ</label>
              <input aria-label="PLZ" name="betrieb_plz" defaultValue={settings.betrieb_plz ?? ''} className={inputCls()} placeholder="3421" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-s112-text-2 mb-1">Ort</label>
            <input aria-label="Ort" name="betrieb_ort" defaultValue={settings.betrieb_ort ?? ''} className={inputCls()} placeholder="Krems an der Donau" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-xs font-medium text-s112-text-2 mb-1">Telefon</label>
              <input aria-label="Telefon" name="betrieb_telefon" defaultValue={settings.betrieb_telefon ?? ''} className={inputCls()} placeholder="+43 2732 12345" />
            </div>
            <div>
              <label className="block text-xs font-medium text-s112-text-2 mb-1">E-Mail</label>
              <input aria-label="E-Mail" name="betrieb_email" type="email" defaultValue={settings.betrieb_email ?? ''} className={inputCls()} placeholder="office@weingut.at" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-xs font-medium text-s112-text-2 mb-1">Website</label>
              <input aria-label="Website" name="betrieb_website" defaultValue={settings.betrieb_website ?? ''} className={inputCls()} placeholder="www.weingut.at" />
            </div>
            <div>
              <label className="block text-xs font-medium text-s112-text-2 mb-1">UID-Nummer</label>
              <input aria-label="UID-Nummer" name="betrieb_uid" defaultValue={settings.betrieb_uid ?? ''} className={inputCls()} placeholder="ATU12345678" />
            </div>
            <div>
              <label className="block text-xs font-medium text-s112-text-2 mb-1">Weinbau-Betriebsnummer *</label>
              <input aria-label="Weinbau-Betriebsnummer" name="betrieb_betriebsnummer" defaultValue={settings.betrieb_betriebsnummer ?? ''} required
                inputMode="numeric" pattern={BETRIEBSNUMMER_MUSTER} title="Nur Ziffern (höchstens 10), z. B. 4489781"
                className={inputCls()} placeholder="z.B. 4489781" />
              {weinbauBetriebsnummerFehlt(settings.betrieb_betriebsnummer)
                ? <p className="text-[11px] text-s112-err-fg mt-0.5">Fehlt – bitte ergänzen. {BETRIEBSNUMMER_ZWECK}.</p>
                : <p className="text-[11px] text-s112-tertiary mt-0.5">{BETRIEBSNUMMER_ZWECK}</p>}
            </div>
          </div>
        </div>
      </div>

      <div>
        <p className="text-xs font-semibold text-s112-text-1 uppercase tracking-wide mb-3">Bewirtschaftung</p>
        <div>
          <label className="block text-xs font-medium text-s112-text-2 mb-1">Status</label>
          <select aria-label="Status" name="bio_status" defaultValue={tenant.bio_status} className={inputCls()} style={{ maxWidth: '320px' }}>
            {BIO_STATUS_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <p className="text-[11px] text-s112-tertiary mt-0.5">
            Steuert die Warn-/Sperrlogik bei der Mittelwahl im Maßnahmenformular: bei Bio-EU/biodynamisch
            wird ein nicht öko-zugelassenes Mittel gesperrt, bei KIP/nachhaltig nur als Warnung angezeigt.
          </p>
        </div>
      </div>

      <div>
        <p className="text-xs font-semibold text-s112-text-1 uppercase tracking-wide mb-3">Bankverbindung</p>
        <div className="grid grid-cols-1 gap-3">
          <div>
            <label className="block text-xs font-medium text-s112-text-2 mb-1">IBAN</label>
            <input aria-label="IBAN" name="rechnung_iban" defaultValue={settings.rechnung_iban ?? ''} className={inputCls()} placeholder="AT12 3456 7890 1234 5678" />
          </div>
          <div>
            <label className="block text-xs font-medium text-s112-text-2 mb-1">BIC</label>
            <input aria-label="BIC" name="rechnung_bic" defaultValue={settings.rechnung_bic ?? ''} className={inputCls()} placeholder="RLNWATWWXXX" style={{ maxWidth: '320px' }} />
          </div>
          {/* Zahlungsziel wurde vom Betrieb zum Kunden verschoben (6.8.2026) -
              siehe zahlungsziel_tage auf Kontakt/Firma. */}
        </div>
      </div>

      <div>
        <p className="text-xs font-semibold text-s112-text-1 uppercase tracking-wide mb-3">Rechnungs-Fußtext</p>
        <textarea name="rechnung_fusstext" defaultValue={settings.rechnung_fusstext ?? ''}
          rows={3} placeholder="z.B. Gemäß § 6 Abs. 1 Z 8 UStG befreit von der Umsatzsteuer."
          className="w-full border border-s112-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40 resize-none" />
      </div>

      <div className="flex items-center gap-3">
        <button type="submit" disabled={pending}
          className="bg-s112-teal text-s112-yellow px-4 py-1.5 rounded-lg text-sm font-medium hover:bg-opacity-90 disabled:opacity-40">
          {pending ? 'Speichern…' : 'Speichern'}
        </button>
        {saved && <span className="text-xs text-s112-blue-700 font-medium">Gespeichert</span>}
      </div>
      {fehler && <p role="alert" className="text-sm text-s112-err-fg">{fehler}</p>}
    </form>
  )
}

// ── Tab: Betrieb – Abschnitt Kellerwirtschaft (KAN-134) ──────────────────────
// Bevorzugte Mostgewicht-Einheit (tenant_einstellungen.mostgewicht_einheit) – dieselbe Einstellung wie
// „Mein Betrieb“ → Kellerwirtschaft (/betrieb/einstellungen, canAdmin). Eigenes Formular unter den
// Betriebsdaten (kein eigener Reiter – die Reiterleiste ist voll); speichert saveKellerwirtschaftAdmin.

const MOSTGEWICHT_EINHEIT_OPTS: { value: MostgewichtEinheit; label: string; text: string }[] = [
  { value: 'kmw',     label: '°KMW (Klosterneuburger Mostwaage)', text: 'Einheit des österreichischen Weingesetzes – Standard.' },
  { value: 'oechsle', label: '°Oe (Öchsle)',                      text: 'Wenn der Betrieb meist in Öchsle misst, z. B. mit Dichtemesser oder Öchsle-Refraktometer.' },
]

function KellerwirtschaftAbschnitt({ tenant, settings }: { tenant: TenantDetail; settings: TenantSettings }) {
  const router                     = useRouter()
  const [pending, startTransition] = useTransition()
  const [saved, setSaved]          = useState(false)
  const [fehler, setFehler]        = useState<string | null>(null)

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    setFehler(null)
    startTransition(async () => {
      try {
        await saveKellerwirtschaftAdmin(tenant.id, fd)
        setSaved(true)
        setTimeout(() => setSaved(false), 2000)
        router.refresh()
      } catch (err) {
        setFehler(fehlerText(err))
      }
    })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 max-w-lg mt-8 pt-6 border-t border-s112-border">
      <fieldset aria-describedby="admin-mostgewicht-einheit-hinweis">
        <legend className="text-xs font-semibold text-s112-text-1 uppercase tracking-wide mb-3">Kellerwirtschaft – Mostgewicht-Einheit</legend>
        <div className="space-y-2">
          {MOSTGEWICHT_EINHEIT_OPTS.map(o => (
            <label key={o.value} className="flex items-start gap-2 text-sm text-s112-text">
              <input type="radio" name="mostgewicht_einheit" value={o.value} required
                defaultChecked={settings.mostgewicht_einheit === o.value} className="mt-1 accent-s112-teal" />
              <span>{o.label}<span className="block text-xs text-s112-muted">{o.text}</span></span>
            </label>
          ))}
        </div>
        <p id="admin-mostgewicht-einheit-hinweis" className="text-[11px] text-s112-tertiary mt-2">
          Aktuell: {EINHEIT_ZEICHEN[settings.mostgewicht_einheit]}. Formulare und Listen des Betriebs zeigen diese Einheit
          zuerst, die andere umgerechnet daneben (≈); die gemessene Einheit wird bei jedem Eintrag mitgespeichert.
          Qualitätsstufen richten sich immer nach °KMW. Der Betriebs-Manager kann die Einstellung später selbst unter
          System &gt; Mein Betrieb im Reiter „Kellerwirtschaft“ ändern.
        </p>
      </fieldset>

      <div className="flex items-center gap-3">
        <button type="submit" disabled={pending}
          className="bg-s112-teal text-s112-yellow px-4 py-1.5 rounded-lg text-sm font-medium hover:bg-opacity-90 disabled:opacity-40">
          {pending ? 'Speichern…' : 'Einheit speichern'}
        </button>
        {saved && <span className="text-xs text-s112-blue-700 font-medium">Gespeichert</span>}
      </div>
      {fehler && <p role="alert" className="text-sm text-s112-err-fg">{fehler}</p>}
    </form>
  )
}

// ── Tab: Microsoft 365 ───────────────────────────────────────────────────────
function M365Tab({ tenant, settings }: { tenant: TenantDetail; settings: TenantSettings }) {
  const [pending, startTransition] = useTransition()
  const [saved,   setSaved]        = useState(false)

  // Rückmeldung vom OAuth-Callback (/api/auth/m365/callback) auswerten.
  // Vorher landete das Ergebnis unausgewertet in der URL der allgemeinen
  // Mandanten-Liste - hier wird es jetzt tatsächlich angezeigt.
  const searchParams = useSearchParams()
  const m365Ok    = searchParams.get('m365_ok')
  const m365Error = searchParams.get('m365_error')

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
      {/* Rückmeldung vom OAuth-Callback */}
      {m365Ok && (
        <div className="p-4 rounded-xl border border-s112-ok/30 bg-s112-ok-bg text-sm text-s112-ok-fg">
          Verbindung erfolgreich hergestellt.
        </div>
      )}
      {m365Error && (
        <div className="p-4 rounded-xl border border-s112-err/30 bg-s112-err-bg text-sm text-s112-err-fg space-y-1">
          <p className="font-semibold">Verbindung fehlgeschlagen</p>
          <p className="text-xs break-all">{m365Error}</p>
          {(m365Error.includes('AADSTS500113') || m365Error.includes('AADSTS50011')) && (
            <p className="text-xs">→ In Azure fehlt eine Umleitungs-URI. Unter „Authentifizierung" → „+ Plattform hinzufügen" → Web beide URIs eintragen:{' '}
              <code className="bg-white px-1 rounded">https://software112.icp-consultants.at/api/auth/m365/callback</code> und{' '}
              <code className="bg-white px-1 rounded">https://software112.icp-consultants.at/api/auth/m365/user/callback</code>.</p>
          )}
          {(m365Error.includes('AADSTS7000215') || m365Error.includes('invalid_client')) && (
            <p className="text-xs">→ Der geheime Clientschlüssel ist falsch oder abgelaufen. Bitte in Azure unter „Zertifikate &amp; Geheimnisse" ein neues Secret anlegen, den „Wert" (nicht die Geheime Text-ID) kopieren und hier neu eintragen.</p>
          )}
          {m365Error.includes('AADSTS65001') && (
            <p className="text-xs">→ Der Administrator hat die API-Berechtigungen noch nicht bestätigt. Unter „API-Berechtigungen" auf „Administratorzustimmung erteilen" klicken.</p>
          )}
        </div>
      )}

      {/* Status */}
      <div className={`flex items-center gap-3 p-4 rounded-xl border ${isConnected && tokenOk ? 'border-s112-ok/30 bg-s112-ok-bg' : 'border-s112-warn/30 bg-s112-warn-bg'}`}>
        {isConnected && tokenOk
          ? <CheckCircle2 className="w-6 h-6 text-s112-ok-fg flex-shrink-0" />
          : <AlertTriangle className="w-6 h-6 text-s112-warn-fg flex-shrink-0" />}
        <div>
          <p className="text-sm font-semibold">{isConnected ? `Verbunden als ${settings.m365_user_email}` : 'Noch nicht verbunden'}</p>
          {isConnected && tokenExpired && (
            <p className="text-xs text-s112-warn-fg">Access Token abgelaufen – wird beim nächsten E-Mail-Abruf automatisch erneuert</p>
          )}
          {isConnected && !tokenExpired && settings.m365_token_expires_at && (
            <p className="text-xs text-s112-text-2">Token gültig bis: {new Date(settings.m365_token_expires_at).toLocaleString('de-AT')}</p>
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
        <div className="bg-s112-blue-50 border border-s112-blue-100 rounded-xl p-4 text-xs space-y-1.5">
          <p className="font-semibold text-s112-blue-700">Azure AD App-Registrierung (einmalig):</p>
          <ol className="list-decimal ml-4 space-y-1 text-s112-blue-700">
            <li>portal.azure.com → App-Registrierungen → Neue Registrierung</li>
            <li>Authentifizierung → Plattform hinzufügen → Web – dort BEIDE Umleitungs-URIs eintragen (eine für diese Mandanten-Verbindung, eine für die persönliche Mailbox-Verbindung jedes einzelnen Users unter „Nachrichten"):
              <div className="mt-1 space-y-0.5">
                <code className="block bg-white px-1 rounded">https://software112.icp-consultants.at/api/auth/m365/callback</code>
                <code className="block bg-white px-1 rounded">https://software112.icp-consultants.at/api/auth/m365/user/callback</code>
              </div>
            </li>
            <li>Zertifikate & Geheimnisse → Neuer geheimer Clientschlüssel</li>
            <li>API-Berechtigungen → Microsoft Graph → delegiert: Mail.ReadWrite, Mail.ReadWrite.Shared, Mail.Send, Mail.Send.Shared, Calendars.Read, offline_access – danach „Administratorzustimmung erteilen". Die .Shared-Berechtigungen braucht Graph für geteilte Mailboxen (sonst 403 trotz Vollzugriff); nach dem Ergänzen müssen sich die Benutzer unter Nachrichten › Einstellungen einmal „Trennen &amp; neu verbinden".</li>
            <li>Optional für „Termine in Outlook anlegen" (Einladung an Kollegen aus dem CRM-Kalender): zusätzlich <b>Calendars.ReadWrite</b> delegiert + Administratorzustimmung, dann unten den Schalter setzen. Erst danach fordert die Verbindung das Schreibrecht an – vorher würde die Anmeldung aller Benutzer scheitern. Frei/Belegt der Kollegen funktioniert schon mit Calendars.Read.</li>
          </ol>
        </div>

        <div className="grid grid-cols-1 gap-3">
          <div>
            <label className="block text-xs font-medium text-s112-text-2 mb-1">Azure AD Verzeichnis-ID (Tenant ID)</label>
            <input aria-label="Azure AD Verzeichnis-ID (Tenant ID)" name="m365_tenant_id" defaultValue={settings.m365_tenant_id ?? ''} placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" className={inputCls()} />
          </div>
          <div>
            <label className="block text-xs font-medium text-s112-text-2 mb-1">Anwendungs-ID (Client ID)</label>
            <input aria-label="Anwendungs-ID (Client ID)" name="m365_client_id" defaultValue={settings.m365_client_id ?? ''} placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" className={inputCls()} />
          </div>
          <div>
            <label className="block text-xs font-medium text-s112-text-2 mb-1">Geheimer Clientschlüssel</label>
            <input aria-label="Geheimer Clientschlüssel" name="m365_client_secret" type="password" placeholder="Neu setzen (leer = unverändert)" className={inputCls()} />
          </div>
          <label className="flex items-start gap-2 cursor-pointer">
            <input type="checkbox" name="m365_kalender_schreiben" value="true" defaultChecked={!!settings.m365_kalender_schreiben} className="accent-s112-teal mt-0.5" />
            <span className="text-xs text-s112-text-1">
              Termine in Outlook anlegen (Calendars.ReadWrite ist in Entra freigegeben)
              <span className="block text-[11px] text-s112-tertiary">Benutzer müssen sich danach unter Nachrichten einmal trennen und neu verbinden, damit ihre Verbindung das Schreibrecht erhält.</span>
            </span>
          </label>
        </div>

        <div className="flex items-center gap-3">
          <button type="submit" disabled={pending}
            className="bg-s112-teal text-s112-yellow px-4 py-1.5 rounded-lg text-sm font-medium hover:bg-opacity-90 disabled:opacity-40">
            {pending ? 'Speichern…' : 'Speichern'}
          </button>
          {saved && <span className="text-xs text-s112-blue-700 font-medium">Gespeichert</span>}
          {settings.m365_tenant_id && settings.m365_client_id && (
            <a href="/api/auth/m365"
              className="ml-auto bg-s112-teal text-s112-yellow px-4 py-1.5 rounded-lg text-sm font-medium hover:opacity-90">
              Mit Microsoft 365 verbinden
            </a>
          )}
        </div>
      </form>

      {/* Webhook Info */}
      {isConnected && (
        <div className="border border-s112-border rounded-xl p-4 space-y-2">
          <p className="text-sm font-semibold text-s112-text-1">Echtzeit-Webhook</p>
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
          {subResult && <p className="text-xs font-medium text-s112-text-1 mt-2">{subResult}</p>}
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
          <button type="button" role="switch" aria-checked={aktiv} aria-label="Aktiv" onClick={() => setAktiv(v => !v)}
            className={`w-10 h-5 rounded-full transition-colors flex items-center px-0.5 ${aktiv ? 'bg-s112-teal' : 'bg-s112-line-str'}`}>
            <span className={`block w-4 h-4 rounded-full bg-white shadow transition-transform ${aktiv ? 'translate-x-5' : 'translate-x-0'}`} />
          </button>
        </label>
        <span className={`text-sm font-semibold ${aktiv ? 'text-s112-blue-700' : 'text-s112-text-2'}`}>
          E-Mail-Modul {aktiv ? 'aktiv' : 'inaktiv'}
        </span>
      </div>

      <form onSubmit={handleSave} className="space-y-5">
        {/* SMTP Ausgehend */}
        <div>
          <p className="text-xs font-semibold text-s112-text-2 uppercase tracking-wider mb-3">SMTP – Ausgehende E-Mails</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-s112-text-2 mb-1">SMTP-Host</label>
              <input aria-label="SMTP-Host" name="email_smtp_host" defaultValue={settings.email_smtp_host ?? ''} placeholder="smtp.gmail.com" className={inputCls()} />
            </div>
            <div>
              <label className="block text-xs font-medium text-s112-text-2 mb-1">Port</label>
              <input aria-label="Port" name="email_smtp_port" type="number" defaultValue={settings.email_smtp_port} className={inputCls()} />
            </div>
            <div>
              <label className="block text-xs font-medium text-s112-text-2 mb-1">Benutzername / E-Mail</label>
              <input aria-label="Benutzername / E-Mail" name="email_smtp_user" defaultValue={settings.email_smtp_user ?? ''} placeholder="name@domain.at" className={inputCls()} />
            </div>
            <div>
              <label className="block text-xs font-medium text-s112-text-2 mb-1">Passwort / App-Passwort</label>
              <input aria-label="Passwort / App-Passwort" name="email_smtp_pass" type="password" placeholder="Neu setzen (leer = unverändert)" className={inputCls()} />
            </div>
            <div className="col-span-2">
              <label className="block text-xs font-medium text-s112-text-2 mb-1">Absendername</label>
              <input aria-label="Absendername" name="email_smtp_from_name" defaultValue={settings.email_smtp_from_name ?? ''} placeholder="Weingut Gebeshuber" className={inputCls()} />
            </div>
          </div>
        </div>

        {/* IMAP Eingehend */}
        <div>
          <p className="text-xs font-semibold text-s112-text-2 uppercase tracking-wider mb-3">IMAP – Eingehende E-Mails</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-s112-text-2 mb-1">IMAP-Host</label>
              <input aria-label="IMAP-Host" name="email_imap_host" defaultValue={settings.email_imap_host ?? ''} placeholder="imap.gmail.com" className={inputCls()} />
            </div>
            <div>
              <label className="block text-xs font-medium text-s112-text-2 mb-1">Port</label>
              <input aria-label="Port" name="email_imap_port" type="number" defaultValue={settings.email_imap_port} className={inputCls()} />
            </div>
            <div className="col-span-2">
              <label className="block text-xs font-medium text-s112-text-2 mb-1">Benutzername / E-Mail</label>
              <input aria-label="Benutzername / E-Mail" name="email_imap_user" defaultValue={settings.email_imap_user ?? ''} className={inputCls()} />
            </div>
            <div className="col-span-2">
              <label className="block text-xs font-medium text-s112-text-2 mb-1">Passwort / App-Passwort</label>
              <input aria-label="Passwort / App-Passwort" name="email_imap_pass" type="password" placeholder="Neu setzen (leer = unverändert)" className={inputCls()} />
            </div>
          </div>
          {settings.email_last_poll && (
            <p className="text-xs text-s112-muted mt-2">Letzter Import: {new Date(settings.email_last_poll).toLocaleString('de-AT')}</p>
          )}
        </div>

        <div className="flex items-center gap-3">
          <button type="submit" disabled={pending}
            className="bg-s112-teal text-s112-yellow px-4 py-1.5 rounded-lg text-sm font-medium hover:bg-opacity-90 disabled:opacity-40">
            {pending ? 'Speichern…' : 'Speichern'}
          </button>
          {saved && <span className="text-xs text-s112-blue-700 font-medium">Gespeichert</span>}
        </div>
      </form>

      {/* Manueller IMAP-Poll */}
      <div className="border border-s112-border rounded-xl p-4 space-y-3">
        <p className="text-sm font-semibold text-s112-text-1">Posteingang jetzt abrufen</p>
        <p className="text-xs text-s112-muted">Importiert ungelesene E-Mails der letzten 7 Tage und legt Aktivitäten für bekannte Kontakte an.</p>
        <button type="button" onClick={handlePoll} disabled={polling}
          className="text-sm border border-s112-border px-4 py-1.5 rounded-lg hover:bg-s112-bg disabled:opacity-40">
          {polling ? 'Abrufen…' : 'Jetzt abrufen'}
        </button>
        {pollResult && <p className="text-xs font-medium text-s112-text-1">{pollResult}</p>}
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
  const [kResetVal, setKResetVal]  = useState(String(settings.account_zaehler))
  const [kZaehler,  setKZaehler]   = useState(settings.account_zaehler)

  const [ustStandard, setUstStandard] = useState(settings.ust_satz_standard)

  const resolveSuffix = (suffix: string, jahr: number) => {
    return suffix.replace(/\{JJJJ\}/g, String(jahr)).replace(/\{JJ\}/g, String(jahr).slice(-2))
  }

  // Vorschau der nächsten Rechnungsnummer. Migration 189: Suffix mit {JJ}/{JJJJ}-
  // Platzhalter (gehört zur Rechnungsnummer, NICHT zur Accountnummer - erste
  // Fassung war an der falschen Stelle, Rückmeldung 1.9.2026) - ist ein
  // Jahres-Platzhalter gesetzt, beginnt der Zähler bei jedem Jahreswechsel
  // automatisch wieder bei 1 (siehe get_next_rechnungsnummer()).
  const [prefix,   setPrefix]   = useState(settings.rechnung_prefix)
  const [stellen,  setStellen]  = useState(settings.rechnung_stellen)
  const [suffix,   setSuffix]   = useState(settings.rechnung_suffix)
  const hatJahresPlatzhalter = suffix.includes('{JJ')
  const heuer = new Date().getFullYear()
  const naechste = `${prefix}-${String(zaehler).padStart(stellen, '0')}${resolveSuffix(suffix, heuer)}`
  const naechsteFolgejahr = `${prefix}-${'1'.padStart(stellen, '0')}${resolveSuffix(suffix, heuer + 1)}`

  // Vorschau der nächsten Accountnummer (kein Suffix/Jahreswechsel-Reset -
  // Accountnummern laufen bewusst endlos weiter, siehe get_next_accountnummer()).
  const [kPrefix,  setKPrefix]  = useState(settings.account_prefix)
  const [kStellen, setKStellen] = useState(settings.account_stellen)
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
        <p className="text-xs font-semibold text-s112-text-2 uppercase tracking-wider">Standard-Umsatzsteuer</p>
        <input type="hidden" name="ust_satz_standard" value={ustStandard} />
        <div className="grid grid-cols-2 gap-3">
          {([{ val: 13, label: '13 %', hint: 'Weinproduzent (stiller Wein)' }, { val: 20, label: '20 %', hint: 'Weinhändler / Spirituosen' }] as const).map(opt => (
            <button
              key={opt.val}
              type="button"
              onClick={() => setUstStandard(opt.val)}
              className={`flex flex-col items-start px-4 py-3 rounded-xl border-2 text-left transition-colors
                ${ustStandard === opt.val
                  ? 'border-s112-teal bg-s112-teal/5 text-s112-blue-700'
                  : 'border-s112-border text-s112-text-2 hover:border-s112-teal/40'}`}
            >
              <span className="text-lg font-semibold">{opt.label}</span>
              <span className="text-xs mt-0.5 opacity-70">{opt.hint}</span>
            </button>
          ))}
        </div>

        {/* Rechnungsnummer */}
        <p className="text-xs font-semibold text-s112-text-2 uppercase tracking-wider">Rechnungsnummer</p>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="block text-xs font-medium text-s112-text-2 mb-1">Präfix</label>
            <input aria-label="Präfix"
              name="rechnung_prefix"
              value={prefix}
              onChange={e => setPrefix(e.target.value.toUpperCase())}
              maxLength={8}
              placeholder="RE"
              className={inputCls()}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-s112-text-2 mb-1">Stellen</label>
            <input aria-label="Stellen"
              name="rechnung_stellen"
              type="number"
              value={stellen}
              onChange={e => setStellen(Math.max(1, Math.min(8, parseInt(e.target.value) || 4)))}
              min={1} max={8}
              className={inputCls()}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-s112-text-2 mb-1">Suffix</label>
            <input aria-label="Suffix"
              name="rechnung_suffix"
              value={suffix}
              onChange={e => setSuffix(e.target.value)}
              maxLength={16}
              placeholder="/{JJ}"
              className={inputCls()}
            />
          </div>
        </div>
        <p className="text-xs text-s112-muted -mt-2">
          Platzhalter im Suffix: {'{JJ}'} für das zweistellige Jahr, {'{JJJJ}'} für das vierstellige. Leer lassen für keinen Suffix. Das Jahr richtet sich nach dem Rechnungsdatum.
        </p>
        <div className="bg-s112-bg border border-s112-border rounded-lg px-4 py-2.5 flex items-center justify-between">
          <p className="text-xs text-s112-muted">Nächste Rechnungsnummer</p>
          <p className="text-base font-mono font-semibold text-s112-blue-700 tracking-wider">{naechste}</p>
        </div>
        {hatJahresPlatzhalter ? (
          <div className="bg-s112-blue-50 border border-s112-blue-100 rounded-lg px-4 py-2.5 text-xs text-s112-blue-700">
            Der Zähler beginnt zu jedem Jahreswechsel wieder bei 1 – im Beispiel oben also {naechsteFolgejahr} für die erste Rechnung des Folgejahres.
            Die Nummern bleiben eindeutig, weil das Jahr Teil der Nummer ist.
          </div>
        ) : (
          <p className="text-xs text-s112-muted">
            Ohne Jahres-Platzhalter im Suffix läuft der Zähler wie bisher endlos weiter (kein automatischer Reset – sonst wären Nummern nicht mehr eindeutig).
          </p>
        )}

        {/* Accountnummer */}
        <p className="text-xs font-semibold text-s112-text-2 uppercase tracking-wider pt-2">Accountnummer</p>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-s112-text-2 mb-1">Präfix</label>
            <input aria-label="Präfix"
              name="account_prefix"
              value={kPrefix}
              onChange={e => setKPrefix(e.target.value.toUpperCase())}
              maxLength={8}
              placeholder="K"
              className={inputCls()}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-s112-text-2 mb-1">Stellen</label>
            <input aria-label="Stellen"
              name="account_stellen"
              type="number"
              value={kStellen}
              onChange={e => setKStellen(Math.max(1, Math.min(8, parseInt(e.target.value) || 4)))}
              min={1} max={8}
              className={inputCls()}
            />
          </div>
        </div>
        <div className="bg-s112-bg border border-s112-border rounded-lg px-4 py-2.5 flex items-center justify-between">
          <p className="text-xs text-s112-muted">Nächste Accountnummer</p>
          <p className="text-base font-mono font-semibold text-s112-blue-700 tracking-wider">{naechsteKunde}</p>
        </div>

        <div className="flex items-center gap-3">
          <button type="submit" disabled={pending}
            className="bg-s112-teal text-s112-yellow px-4 py-1.5 rounded-lg text-sm font-medium hover:bg-opacity-90 disabled:opacity-40">
            {pending ? 'Speichern…' : 'Speichern'}
          </button>
          {saved && <span className="text-xs text-s112-blue-700 font-medium">Gespeichert</span>}
        </div>
      </form>

      {/* Zähler zurücksetzen */}
      <div className="border border-s112-border rounded-xl p-4 space-y-3">
        <div>
          <p className="text-sm font-semibold text-s112-text-1">Zählerstand</p>
          <p className="text-xs text-s112-muted mt-0.5">
            Aktuell: <span className="font-mono font-semibold text-s112-text">{zaehler}</span>
            {' '}(nächste vergebene Nummer: <span className="font-mono text-s112-text">{naechste}</span>)
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
            className="text-sm text-s112-err hover:text-s112-err-fg border border-s112-err/30 px-3 py-1.5 rounded-lg hover:bg-s112-err-bg disabled:opacity-40 transition-colors"
          >
            Zähler setzen
          </button>
        </div>
        <p className="text-xs text-s112-muted">
          {hatJahresPlatzhalter
            ? 'Nur bei Ersteinrichtung nötig – ist ein Jahres-Platzhalter im Suffix gesetzt, läuft der Reset zum Jahreswechsel automatisch.'
            : 'Nur bei Ersteinrichtung oder Jahreswechsel. Bereits vergebene Nummern bleiben unverändert.'}
        </p>
      </div>

      {/* Accountnummer-Zähler */}
      <div className="border border-s112-border rounded-xl p-4 space-y-3">
        <div>
          <p className="text-sm font-semibold text-s112-text-1">Kunden-Zählerstand</p>
          <p className="text-xs text-s112-muted mt-0.5">
            Aktuell: <span className="font-mono font-semibold text-s112-text">{kZaehler}</span>
            {' '}(nächste: <span className="font-mono text-s112-text">{naechsteKunde}</span>)
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
            className="text-sm text-s112-err hover:text-s112-err-fg border border-s112-err/30 px-3 py-1.5 rounded-lg hover:bg-s112-err-bg disabled:opacity-40 transition-colors"
          >
            Zähler setzen
          </button>
        </div>
        <p className="text-xs text-s112-muted">
          Nur bei Ersteinrichtung. Bereits vergebene Nummern bleiben unverändert.
        </p>
      </div>
    </div>
  )
}

// ── Tab: Onboarding-Checkliste ────────────────────────────────────────────────

/** `hint` nur bei offenem Punkt; `info` immer (z. B. Einstellungen mit Standardwert, die man abstimmen sollte) */
function CheckItem({ ok, label, hint, info }: { ok: boolean; label: string; hint?: string; info?: string }) {
  return (
    <div className={`flex gap-3 p-3 rounded-xl border ${ok ? 'border-s112-ok/30 bg-s112-ok-bg' : 'border-s112-warn/30 bg-s112-warn-bg'}`}>
      {ok
        ? <CheckCircle2 className="w-5 h-5 text-s112-ok-fg flex-shrink-0 mt-0.5" />
        : <AlertTriangle className="w-5 h-5 text-s112-warn-fg flex-shrink-0 mt-0.5" />}
      <div>
        <p className={`text-sm font-medium ${ok ? 'text-s112-ok-fg' : 'text-s112-warn-fg'}`}>{label}</p>
        {!ok && hint && <p className="text-xs text-s112-warn-fg mt-0.5">{hint}</p>}
        {info && <p className={`text-xs mt-0.5 ${ok ? 'text-s112-ok-fg' : 'text-s112-warn-fg'}`}>{info}</p>}
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
        <div className="p-4 bg-s112-ok-bg border border-s112-ok/30 rounded-xl text-sm text-s112-ok-fg font-medium flex items-center gap-2">
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
        {/* KAN-134: hat immer einen Wert (Standard °KMW) – daher nur Anzeige mit Hinweis, kein offener Punkt */}
        <CheckItem ok
          label={`Mostgewicht-Einheit: ${settings.mostgewicht_einheit === 'oechsle' ? '°Oe (Öchsle)' : '°KMW (Standard)'}`}
          info="→ Tab Betrieb, Abschnitt „Kellerwirtschaft“: mit dem Betrieb abstimmen, ob er in °KMW oder °Oe misst – Formulare und Listen zeigen diese Einheit zuerst." />
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

      <div className="mt-4 p-4 bg-s112-blue-50 border border-s112-blue-100 rounded-xl text-xs text-s112-blue-700 space-y-2">
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
  // KAN-135: Das Passwort kommt nie in den Browser – settings.bawb_passwort ist nur die
  // Maske („hinterlegt“). Leer lassen = hinterlegtes behalten (Maske geht zurück).
  const hinterlegt = settings.bawb_passwort
  const [passwort, setPasswort] = useState('')
  const [entfernen, setEntfernen] = useState(false)
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
    fd.set('bawb_passwort', passwort.trim() ? passwort : (entfernen ? '' : (hinterlegt ?? '')))
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
            <h3 className="font-semibold text-s112-text mb-1">LFRZ Weinkontrolle Online (bawb.at)</h3>
            <p className="text-sm text-s112-muted">
              Österreichisches Weingesetz-Onlineportal für Erntemeldung, Betriebsmitteilung und Verarbeitungsprotokoll.
            </p>
          </div>
          <a
            href={BAWB_URL}
            target="_blank"
            rel="noreferrer"
            className="shrink-0 bg-s112-teal text-s112-yellow px-4 py-2 rounded-xl text-sm font-semibold hover:bg-opacity-90 transition-colors whitespace-nowrap"
          >
            bawb.at öffnen
          </a>
        </div>
        <p className="text-xs text-s112-muted bg-s112-warn-bg border border-s112-warn/30 rounded-lg px-3 py-2">
          Die Zugangsdaten werden in der Datenbank gespeichert (wie API-Keys). Für erhöhte Sicherheit empfiehlt sich Supabase Vault – aktuell nicht aktiviert.
        </p>
      </div>

      {/* Zugangsdaten */}
      <form onSubmit={handleSave} className="card p-5 space-y-4">
        <h3 className="font-semibold text-s112-text text-sm">Zugangsdaten</h3>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-s112-text-2 mb-1">Kennung (Betriebsnummer)</label>
            <input aria-label="Kennung (Betriebsnummer)"
              type="text"
              value={kennung}
              onChange={e => { setKennung(e.target.value); setStatus('idle') }}
              placeholder="z.B. 4489781"
              className={inputCls}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-s112-text-2 mb-1">Passwort</label>
            <div className="relative">
              <input
                type={showPw ? 'text' : 'password'}
                value={passwort}
                onChange={e => { setPasswort(e.target.value); setStatus('idle') }}
                placeholder={hinterlegt ? 'hinterlegt (verschlüsselt) – zum Ändern neu eingeben' : 'Passwort'}
                autoComplete="off"
                className={inputCls + ' pr-16'}
              />
              <button
                type="button"
                onClick={() => setShowPw(v => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-s112-muted hover:text-s112-text-1 px-1"
              >
                {showPw ? 'verbergen' : 'anzeigen'}
              </button>
            </div>
            {hinterlegt && (
              <label className="mt-1 flex items-center gap-1.5 text-xs text-s112-muted">
                <input type="checkbox" checked={entfernen} onChange={e => { setEntfernen(e.target.checked); setStatus('idle') }} />
                Hinterlegtes Passwort entfernen
              </label>
            )}
          </div>
        </div>

        {errMsg && <p className="text-xs text-s112-err-fg bg-s112-err-bg border border-s112-err/30 rounded-lg px-3 py-2">{errMsg}</p>}

        <div className="flex items-center gap-3">
          <button type="submit" disabled={status === 'saving'}
            className="bg-s112-teal text-s112-yellow px-4 py-1.5 rounded-lg text-sm font-medium hover:bg-opacity-90 disabled:opacity-50 transition-colors">
            {status === 'saving' ? 'Speichert…' : 'Zugangsdaten speichern'}
          </button>
          {status === 'ok' && <span className="text-xs text-s112-ok-fg font-medium">Gespeichert</span>}
        </div>
      </form>

      {/* Gespeicherte Zugangsdaten – Kopier-Hilfe */}
      {(settings.bawb_kennung || settings.bawb_passwort) && (
        <div className="card p-4 space-y-2 bg-s112-bg">
          <p className="text-xs font-semibold text-s112-text-1">Gespeicherte Zugangsdaten</p>
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div>
              <span className="text-s112-muted">Kennung:</span>{' '}
              <span className="font-mono font-medium text-s112-text">{settings.bawb_kennung ?? '–'}</span>
            </div>
            <div>
              <span className="text-s112-muted">Passwort:</span>{' '}
              <span className="font-medium text-s112-text">{settings.bawb_passwort ? 'hinterlegt (verschlüsselt)' : '–'}</span>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}

// ── Tab: SumUp ───────────────────────────────────────────────────────────────

function SumUpTab({ tenant, settings }: { tenant: TenantDetail; settings: TenantSettings }) {
  // S11: Schlüssel wird nie angezeigt; leer lassen = hinterlegten behalten
  const [apiKey, setApiKey]         = useState('')
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
    fd.set('sumup_api_key',       apiKey.trim() || ((settings as any).sumup_api_key ?? ''))
    fd.set('sumup_merchant_code', merchantCode)
    const res = await saveSumUpConfig(tenant.id, fd)
    setMsgIsError(!!res?.error)
    setMsg(res?.error ?? 'Gespeichert')
    setSaving(false)
  }

  return (
    <div className="max-w-lg space-y-5">
      <div className="bg-s112-warn-bg border border-s112-warn/30 rounded-xl p-4 text-sm text-s112-warn-fg">
        <strong>Hinweis:</strong> Der API-Key wird verschlüsselt gespeichert und nicht mehr angezeigt.
      </div>
      <form onSubmit={handleSave} className="space-y-4">
        <div>
          <label className="block text-xs font-medium text-s112-text-2 mb-1">SumUp API Key</label>
          <input aria-label="SumUp API Key" type="password" autoComplete="off" value={apiKey} onChange={e => setApiKey(e.target.value)}
            placeholder={(settings as any).sumup_api_key ? 'hinterlegt (verschlüsselt) – zum Ändern neu eingeben' : 'sup_sk_…'}
            className="w-full border border-s112-border rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-s112-teal/40" />
          <p className="text-xs text-s112-muted mt-1">Persönlicher Access-Token aus dem SumUp-Dashboard → API Keys</p>
        </div>
        <div>
          <label className="block text-xs font-medium text-s112-text-2 mb-1">Merchant Code</label>
          <input aria-label="Merchant Code" value={merchantCode} onChange={e => setMerchantCode(e.target.value)}
            placeholder="M…"
            className="w-full border border-s112-border rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-s112-teal/40" />
          <p className="text-xs text-s112-muted mt-1">Zu finden unter SumUp-Profil → Unternehmensinformationen</p>
        </div>
        {msg && <p className={`text-sm ${msgIsError ? 'text-s112-err-fg' : 'text-s112-ok-fg'}`}>{msg}</p>}
        <button type="submit" disabled={saving}
          className="bg-s112-teal text-s112-yellow px-5 py-2 rounded-xl text-sm font-semibold hover:bg-opacity-90 disabled:opacity-40">
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

  // Paketmodell Basis / Standard / Premium (2.9.2026), Definition lib/pakete.ts
  // KAN-10 (01.10.2026): an den Server geht nur der Paket-Schlüssel, die Preis-ID ermittelt er selbst
  const PLANS = PAKET_REIHENFOLGE.map(k => ({ key: k, id: paketPriceId(k), label: `${PAKETE[k].label} (${preisText(PAKETE[k])})` }))

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

  function handleCheckout(paket: PaketKey) {
    if (!tenant.stripe_customer_id) { setError('Zuerst Stripe Customer anlegen'); return }
    setError(null)
    startTransition(async () => {
      const r = await createStripeCheckoutSession(tenant.id, paket)
      if (r?.error) setError(r.error)
      else if (r?.url) window.location.href = r.url
    })
  }

  function handlePortal() {
    if (!tenant.stripe_customer_id) return
    startTransition(async () => {
      const r = await createStripePortalSession(tenant.id)
      if (r?.error) setError(r.error)
      else if (r?.url) window.location.href = r.url
    })
  }

  function handleCancel() {
    if (!tenant.stripe_subscription_id) return
    if (!confirm('Abo wirklich sofort kündigen?')) return
    startTransition(async () => {
      const r = await cancelStripeSubscription(tenant.id)
      if (r?.error) setError(r.error)
      else router.refresh()
    })
  }

  return (
    <div className="space-y-6">
      {error && <div className="bg-s112-err-bg border border-s112-err/30 text-s112-err-fg rounded-xl px-4 py-3 text-sm">{error}</div>}

      {/* Status-Karte */}
      <div className="card p-4 space-y-3">
        <h2 className="text-sm font-semibold text-s112-muted uppercase tracking-wider">Abo-Status</h2>
        <div className="flex items-center gap-3 flex-wrap">
          {statusMeta
            ? <span className={`text-sm font-semibold px-3 py-1 rounded-full ${statusMeta.color}`}>{statusMeta.label}</span>
            : <span className="text-sm text-s112-muted italic">Kein Stripe-Abo</span>
          }
          {planLabel && <span className="text-sm text-s112-text-2">{planLabel}</span>}
          {tenant.max_benutzer !== null && <span className="text-xs text-s112-muted">· max. {tenant.max_benutzer} Benutzer</span>}
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
              className="bg-s112-teal text-s112-yellow px-4 py-2 rounded-lg text-sm font-semibold hover:bg-opacity-90 disabled:opacity-50 whitespace-nowrap">
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
                onClick={() => handleCheckout(p.key)}
                className="border border-s112-border rounded-lg px-4 py-3 text-sm text-left hover:border-s112-teal hover:bg-s112-bg transition-colors disabled:opacity-50">
                <span className="font-medium text-s112-text">{p.label}</span>
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
              className="bg-s112-teal text-s112-yellow px-4 py-2 rounded-lg text-sm font-semibold hover:bg-opacity-90 disabled:opacity-50">
              {pending ? 'Lade…' : 'software:112 Kundenportal'}
            </button>
            <button type="button" onClick={handleCancel} disabled={pending}
              className="border border-s112-err/30 text-s112-err px-4 py-2 rounded-lg text-sm hover:bg-s112-err-bg disabled:opacity-50">
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
            <Link href="/admin/mandanten" className="hover:text-s112-blue-700 transition-colors">Mandanten</Link>
            <span>/</span>
            <span className="text-s112-text-1 font-medium">{tenant.name}</span>
          </div>
          {editName ? (
            <form onSubmit={handleRename} className="flex items-center gap-2 mt-1">
              <input value={name} onChange={e => setName(e.target.value)}
                className="text-2xl font-semibold text-s112-text border-b-2 border-s112-teal outline-none bg-transparent"
                autoFocus />
              <button type="submit" disabled={pending}
                className="text-xs bg-s112-teal text-s112-yellow px-2.5 py-1 rounded-lg disabled:opacity-40">OK</button>
              <button type="button" onClick={() => { setEditName(false); setName(tenant.name) }}
                className="text-xs text-s112-muted hover:text-s112-text-1">Abbrechen</button>
            </form>
          ) : (
            <div className="flex items-center gap-2 mt-1">
              <h1 className="text-2xl font-semibold text-s112-text">{tenant.name}</h1>
              <button aria-label="Bearbeiten" onClick={() => setEditName(true)}
                className="text-s112-muted hover:text-s112-blue-700 mt-0.5">
                <Pencil className="w-4 h-4" />
              </button>
            </div>
          )}
          <p className="text-xs text-s112-muted mt-0.5">
            {/* Kundennummer (Migration 209): S112-AT-<PLZ-Kreis><lfd. Nr.>, vergeben sobald die PLZ hinterlegt ist */}
            {tenant.kundennummer
              ? <span className="font-mono text-s112-text-1" title={`Kundennummer (für Support und Abrechnung)${bundeslandAusKundennummer(tenant.kundennummer) ? ' · ' + bundeslandAusKundennummer(tenant.kundennummer) : ''}`}>{tenant.kundennummer}</span>
              : <span className="text-s112-warn-fg" title="Wird automatisch vergeben, sobald unter Betrieb die Postleitzahl gespeichert ist">Kundennummer: noch keine – PLZ fehlt</span>}
            {' · '}{tenant.slug} · {paketAusPlan(tenant.stripe_plan) ? PAKETE[paketAusPlan(tenant.stripe_plan)!].label : 'kein Paket'} ·
            Erstellt {new Date(tenant.created_at).toLocaleDateString('de-AT')}
          </p>
        </div>

        {/* Status-Badges */}
        <div className="flex gap-2 flex-wrap justify-end">
          {settings.modul_weingarten && <span className="text-xs bg-s112-ok-bg text-s112-ok-fg px-2 py-0.5 rounded-full">Weingarten</span>}
          {settings.modul_kellerbuch && <span className="text-xs bg-[#F2F3F5] text-s112-text-1 px-2 py-0.5 rounded-full">Kellerbuch</span>}
          {settings.modul_crm        && <span className="text-xs bg-s112-blue-100 text-s112-blue-700 px-2 py-0.5 rounded-full">CRM</span>}
          {settings.modul_newsletter && <span className="text-xs bg-s112-warn-bg text-s112-warn-fg px-2 py-0.5 rounded-full">Newsletter</span>}
          {settings.modul_ea         && <span className="text-xs bg-s112-ok-bg text-s112-ok-fg px-2 py-0.5 rounded-full">{settings.buchhaltungsart === 'doppik' ? 'E&A · Doppik/BMD' : 'E&A'}</span>}
          {settings.modul_sumup      && <span className="text-xs bg-[#F2F3F5] text-s112-text-1 px-2 py-0.5 rounded-full">SumUp</span>}
          {settings.modul_export     && <span className="text-xs bg-[#F2F3F5] text-s112-text-1 px-2 py-0.5 rounded-full">Exportaufträge</span>}
          {settings.modul_controlling && <span className="text-xs bg-[#F2F3F5] text-s112-text-1 px-2 py-0.5 rounded-full">Controlling</span>}
          {tenant.stripe_status === 'active'   && <span className="text-xs bg-s112-ok-bg text-s112-ok-fg px-2 py-0.5 rounded-full">Abo aktiv</span>}
          {tenant.stripe_status === 'past_due' && <span className="text-xs bg-s112-warn-bg text-s112-warn-fg px-2 py-0.5 rounded-full">Zahlung offen</span>}
          {tenant.stripe_status === 'cancelled' && <span className="text-xs bg-[#F2F3F5] text-s112-text-2 px-2 py-0.5 rounded-full">Abo gekündigt</span>}
        </div>
      </div>

      {/* Tab-Navigation */}
      <div className="flex gap-1 border-b border-s112-border mb-6">
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
              tab === t.id
                ? 'border-s112-teal text-s112-blue-700'
                : 'border-transparent text-s112-muted hover:text-s112-text-1'
            }`}>
            {t.label}
            {t.id === 'benutzer' && members.length > 0 &&
              <span className="ml-1.5 text-xs bg-[#F2F3F5] text-s112-text-2 px-1.5 py-0.5 rounded-full">{members.length}</span>}
          </button>
        ))}
      </div>

      {/* Tab-Inhalt */}
      {tab === 'branding'   && <BrandingTab   tenant={tenant} settings={settings} />}
      {tab === 'benutzer'   && <BenutzerTab   tenant={tenant} members={members} />}
      {tab === 'brevo'      && <BrevoTab      tenant={tenant} settings={settings} />}
      {tab === 'module'     && <ModuleTab     tenant={tenant} settings={settings} />}
      {tab === 'betrieb'    && (
        <>
          <BetriebTab tenant={tenant} settings={settings} />
          <KellerwirtschaftAbschnitt tenant={tenant} settings={settings} />
        </>
      )}
      {tab === 'verkauf'    && <VerkaufTab    tenant={tenant} settings={settings} />}
      {tab === 'email'      && <EmailTab      tenant={tenant} settings={settings} />}
      {tab === 'm365'       && (
        <Suspense fallback={<p className="text-sm text-s112-muted">Laden…</p>}>
          <M365Tab tenant={tenant} settings={settings} />
        </Suspense>
      )}
      {tab === 'bawb'       && <BawbTab       tenant={tenant} settings={settings} />}
      {tab === 'sumup'      && <SumUpTab      tenant={tenant} settings={settings} />}
      {tab === 'stripe'     && <StripeTab     tenant={tenant} />}
      {tab === 'checkliste' && <ChecklisteTab tenant={tenant} settings={settings} members={members} />}
    </div>
  )
}
