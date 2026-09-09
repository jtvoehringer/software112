'use client'

import { useState, useRef, useTransition } from 'react'
import Link from 'next/link'
import { saveBrandingOwn, uploadLogoOwn, saveBetriebOwn, saveBawbOwn } from './actions'
import type { EigeneBetriebsdaten } from './page'
import BenutzerClient from '../../benutzer/BenutzerClient'
import type { BenutzerlimitStatus } from '@/lib/pakete-server'
import type { MemberWithEmail } from '../../benutzer/actions'
import { PAKETE, preisText, istPaketKey } from '@/lib/pakete'

const BIO_STATUS_OPTS = [
  { value: 'konventionell', label: 'Konventionell' },
  { value: 'kip',           label: 'KIP (kontrolliert integrierte Produktion)' },
  { value: 'nachhaltig',    label: 'Nachhaltig' },
  { value: 'bio_eu',        label: 'Bio-EU' },
  { value: 'biodynamisch',  label: 'Biodynamisch' },
]

const BAWB_URL = 'https://services2.lfrz.at/at.lfrz.wein/frame.html'

function inputCls() {
  return 'w-full border border-s112-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40'
}

type Tab = 'branding' | 'benutzer' | 'betrieb' | 'bawb' | 'abo'

export default function EinstellungenClient({
  daten, members, benutzerlimit, isSystemAdmin,
}: {
  daten: EigeneBetriebsdaten
  members: MemberWithEmail[]
  benutzerlimit?: BenutzerlimitStatus
  isSystemAdmin: boolean
}) {
  const [tab, setTab] = useState<Tab>('branding')

  const TABS: { id: Tab; label: string; count?: number }[] = [
    { id: 'branding', label: 'Branding' },
    { id: 'benutzer', label: 'Benutzer', count: members.length },
    { id: 'betrieb',  label: 'Betrieb' },
    { id: 'bawb',     label: 'bawb.at' },
    { id: 'abo',      label: 'Abo & Paket' },
  ]

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-s112-text">{daten.tenantName}</h1>
        <p className="text-sm text-s112-muted mt-0.5">
          Einstellungen deines Betriebs
          {isSystemAdmin && (
            <>
              {' · '}
              <Link href="/admin/mandanten" className="text-s112-blue-700 hover:underline">
                Vollständige Verwaltung (alle Mandanten)
              </Link>
            </>
          )}
        </p>
      </div>

      <div className="flex gap-1 border-b border-s112-border mb-6">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-3.5 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === t.id
                ? 'border-s112-teal text-s112-blue-700'
                : 'border-transparent text-s112-muted hover:text-s112-text-1'
            }`}
          >
            {t.label}
            {t.count !== undefined && t.count > 0 && (
              <span className="ml-1.5 text-xs text-s112-tertiary">{t.count}</span>
            )}
          </button>
        ))}
      </div>

      {tab === 'branding' && <BrandingTabOwn daten={daten} />}
      {tab === 'benutzer' && <BenutzerClient members={members} limit={benutzerlimit} />}
      {tab === 'betrieb'  && <BetriebTabOwn daten={daten} />}
      {tab === 'bawb'     && <BawbTabOwn daten={daten} />}
      {tab === 'abo'      && <AboTabOwn daten={daten} />}
    </div>
  )
}

// ── Tab: Abo & Paket ─────────────────────────────────────────────────────────
// Rückmeldung 4.9.2026: der Betriebsleiter konnte sein Abo nirgends erreichen
// (/abo war nur über den Zahlungs-Hinweis verlinkt). Hier die Zusammenfassung,
// der Wechsel selbst läuft weiter auf /abo (Stripe, Buchhaltungsfrage).

function AboTabOwn({ daten }: { daten: EigeneBetriebsdaten }) {
  const p = istPaketKey(daten.paket) ? PAKETE[daten.paket] : null
  const statusText: Record<string, string> = {
    active: 'aktiv', trialing: 'Testphase', past_due: 'Zahlung offen', cancelled: 'gekündigt', canceled: 'gekündigt', unpaid: 'unbezahlt',
  }
  return (
    <div className="max-w-lg space-y-4">
      <div className="card space-y-3">
        <h2 className="text-sm font-semibold text-s112-muted uppercase tracking-wider">Gebuchtes Paket</h2>
        {p ? (
          <>
            <p className="text-lg font-semibold text-s112-text">{p.label} <span className="text-sm font-normal text-s112-blue-700">{preisText(p)}</span></p>
            <p className="text-sm text-s112-text-1">
              {p.maxBenutzer === null ? 'Unbegrenzt Benutzer' : `${p.maxBenutzer} Benutzer`} · KI-Abfragen {p.kiLimit === null ? 'unbegrenzt' : `${p.kiLimit}/Monat`}
              {daten.stripe_status && <> · Abo {statusText[daten.stripe_status] ?? daten.stripe_status}</>}
            </p>
            <ul className="text-xs text-s112-muted space-y-0.5">
              {p.leistungen.map(l => <li key={l}>· {l}</li>)}
            </ul>
          </>
        ) : (
          <p className="text-sm text-s112-text-1">Noch kein Paket gebucht.</p>
        )}
        {daten.modul_ea && (
          <p className="text-xs text-s112-text-1 border-t border-s112-border pt-3">
            Buchhaltung: <span className="font-medium">{daten.buchhaltungsart === 'doppik' ? 'doppelte Buchhaltung beim Steuerberater (BMD-Übergabe)' : 'E&A-Rechnung in software:112'}</span>
          </p>
        )}
        <Link href="/abo" className="inline-block bg-s112-teal text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-opacity-90">
          Abo &amp; Paket verwalten →
        </Link>
        <p className="text-[11.5px] text-s112-muted">
          Paket wechseln (sofort wirksam, anteilig abgerechnet), Zahlungsdaten und Rechnungen, Buchhaltungsart umstellen.
        </p>
      </div>
    </div>
  )
}

// ── Tab: Branding ─────────────────────────────────────────────────────────────

function BrandingTabOwn({ daten }: { daten: EigeneBetriebsdaten }) {
  const [pending, startTransition] = useTransition()
  const [saved, setSaved]         = useState(false)
  const [primary, setPrimary]     = useState(daten.primary_color)
  const [secondary, setSecondary] = useState(daten.secondary_color)
  const [logoUrl, setLogoUrl]     = useState(daten.logo_url ?? '')
  const [logoUploading, setLogoUploading] = useState(false)
  const [logoError, setLogoError] = useState<string | null>(null)
  const logoInputRef = useRef<HTMLInputElement>(null)

  function handleLogoFile(file: File) {
    setLogoUploading(true)
    setLogoError(null)
    const fd = new FormData()
    fd.append('file', file)
    startTransition(async () => {
      const result = await uploadLogoOwn(fd)
      setLogoUploading(false)
      if (result.error) setLogoError(result.error)
      else if (result.url) setLogoUrl(result.url)
    })
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    startTransition(async () => {
      await saveBrandingOwn(fd)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5 max-w-lg">
      <div>
        <label className="block text-xs font-medium text-s112-text-2 mb-1">Anzeigename</label>
        <input name="anzeigename" defaultValue={daten.anzeigename ?? daten.tenantName}
          placeholder={daten.tenantName} className={inputCls()} />
        <p className="text-xs text-s112-muted mt-1">Wird in der Sidebar unter dem Logo angezeigt.</p>
      </div>

      <div>
        <label className="block text-xs font-medium text-s112-text-2 mb-1">Logo</label>
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
            className="text-xs font-medium bg-s112-teal/10 hover:bg-s112-teal/20 text-s112-blue-700 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-40"
          >
            {logoUploading ? 'Hochladen…' : 'Logo-Datei hochladen'}
          </button>
          {logoError && <span className="text-xs text-s112-err">{logoError}</span>}
        </div>
        <p className="text-xs text-s112-muted mt-1">PNG, JPG, WebP oder SVG, max. 2 MB. Empfohlen: max. 140×40 px.</p>

        <input name="logo_url" value={logoUrl} onChange={e => setLogoUrl(e.target.value)}
          placeholder="/logos/mein-logo.png oder https://..." className={inputCls() + ' mt-2'} />

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

      <div>
        <label className="block text-xs font-medium text-s112-text-2 mb-1">Session Timeout (Minuten)</label>
        <input name="session_timeout_minuten" type="number" min="5" max="480"
          defaultValue={daten.session_timeout_minuten ?? ''}
          placeholder="Leer = kein Timeout" className={inputCls()} style={{ maxWidth: '180px' }} />
        <p className="text-xs text-s112-muted mt-1">
          Nach dieser Inaktivitätsdauer erscheint ein Hinweis. Leer lassen = kein automatischer Logout.
        </p>
      </div>

      {/* Dashboard-Regeln (Migration 179): steuern Kanban "Messung fällig", die
          Fristen-Ampel und den Zähler in der Glocke – vorher Code-Konstanten. */}
      <div className="pt-2 border-t border-s112-border">
        <p className="text-sm font-semibold text-s112-text-1 mb-2">Dashboard-Regeln</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-s112-text-2 mb-1">Gärkontrolle fällig nach (Tage)</label>
            <input name="gaerung_messintervall_tage" type="number" min="1" max="60" required
              defaultValue={daten.gaerung_messintervall_tage} className={inputCls()} style={{ maxWidth: '180px' }} />
            <p className="text-xs text-s112-muted mt-1">Charge in Gärung ohne Weinanalyse seit so vielen Tagen gilt als „Messung fällig“ (Kellerbuch-Kanban, Übersicht, Glocke).</p>
          </div>
          <div>
            <label className="block text-xs font-medium text-s112-text-2 mb-1">Fristen-Vorwarnung (Tage)</label>
            <input name="fristen_vorwarnung_tage" type="number" min="1" max="365" required
              defaultValue={daten.fristen_vorwarnung_tage} className={inputCls()} style={{ maxWidth: '180px' }} />
            <p className="text-xs text-s112-muted mt-1">So viele Tage vor dem Termin springt eine Frist von „offen“ auf „fällig“ (Ampel, Glocke, Offene Aufgaben).</p>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button type="submit" disabled={pending}
          className="bg-s112-teal text-white px-4 py-1.5 rounded-lg text-sm font-medium hover:bg-opacity-90 disabled:opacity-40">
          {pending ? 'Speichern…' : 'Speichern'}
        </button>
        {saved && <span className="text-xs text-s112-blue-700 font-medium">Gespeichert</span>}
      </div>
    </form>
  )
}

// ── Tab: Betrieb ─────────────────────────────────────────────────────────────

function BetriebTabOwn({ daten }: { daten: EigeneBetriebsdaten }) {
  const [pending, startTransition] = useTransition()
  const [saved, setSaved]         = useState(false)

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    startTransition(async () => {
      await saveBetriebOwn(fd)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6 max-w-lg">
      <div>
        <p className="text-xs font-semibold text-s112-text-1 uppercase tracking-wide mb-3">Betriebsdaten (Briefkopf)</p>
        <div className="grid grid-cols-1 gap-3">
          <div>
            <label className="block text-xs font-medium text-s112-text-2 mb-1">Betriebsname *</label>
            <input name="betrieb_name" defaultValue={daten.betrieb_name ?? ''} required className={inputCls()} placeholder="Weingut Gebeshuber" />
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div className="col-span-2">
              <label className="block text-xs font-medium text-s112-text-2 mb-1">Straße + Nr.</label>
              <input name="betrieb_strasse" defaultValue={daten.betrieb_strasse ?? ''} className={inputCls()} placeholder="Hauptstraße 1" />
            </div>
            <div>
              <label className="block text-xs font-medium text-s112-text-2 mb-1">PLZ</label>
              <input name="betrieb_plz" defaultValue={daten.betrieb_plz ?? ''} className={inputCls()} placeholder="3421" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-s112-text-2 mb-1">Ort</label>
            <input name="betrieb_ort" defaultValue={daten.betrieb_ort ?? ''} className={inputCls()} placeholder="Krems an der Donau" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-xs font-medium text-s112-text-2 mb-1">Telefon</label>
              <input name="betrieb_telefon" defaultValue={daten.betrieb_telefon ?? ''} className={inputCls()} placeholder="+43 2732 12345" />
            </div>
            <div>
              <label className="block text-xs font-medium text-s112-text-2 mb-1">E-Mail</label>
              <input name="betrieb_email" type="email" defaultValue={daten.betrieb_email ?? ''} className={inputCls()} placeholder="office@weingut.at" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-xs font-medium text-s112-text-2 mb-1">Website</label>
              <input name="betrieb_website" defaultValue={daten.betrieb_website ?? ''} className={inputCls()} placeholder="www.weingut.at" />
            </div>
            <div>
              <label className="block text-xs font-medium text-s112-text-2 mb-1">UID-Nummer</label>
              <input name="betrieb_uid" defaultValue={daten.betrieb_uid ?? ''} className={inputCls()} placeholder="ATU12345678" />
            </div>
            <div>
              <label className="block text-xs font-medium text-s112-text-2 mb-1">Weinbau-Betriebsnummer</label>
              <input name="betrieb_betriebsnummer" defaultValue={daten.betrieb_betriebsnummer ?? ''} className={inputCls()} placeholder="z.B. 4489781" />
              <p className="text-[10px] text-s112-tertiary mt-0.5">Für Transportbescheinigung &amp; Prüfnummernantrag</p>
            </div>
            {/* Betriebsbeginn / Systemstart der E&A-Rechnung (Migration 180) */}
            <div>
              <label className="block text-xs font-medium text-s112-text-2 mb-1">Betriebsbeginn E&amp;A-Rechnung</label>
              <input name="ea_betriebsbeginn" type="date" defaultValue={daten.ea_betriebsbeginn ?? ''} className={inputCls()} />
              <p className="text-[10px] text-s112-tertiary mt-0.5">Systemstart: Monate davor gelten nicht als offen (Monatsabschluss, UVA, Dashboard). Leer = keine Einschränkung.</p>
            </div>
          </div>
        </div>
      </div>

      <div>
        <p className="text-xs font-semibold text-s112-text-1 uppercase tracking-wide mb-3">Bewirtschaftung</p>
        <div>
          <label className="block text-xs font-medium text-s112-text-2 mb-1">Status</label>
          <select name="bio_status" defaultValue={daten.bio_status} className={inputCls()} style={{ maxWidth: '320px' }}>
            {BIO_STATUS_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <p className="text-[10px] text-s112-tertiary mt-0.5">
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
            <input name="rechnung_iban" defaultValue={daten.rechnung_iban ?? ''} className={inputCls()} placeholder="AT12 3456 7890 1234 5678" />
          </div>
          <div>
            <label className="block text-xs font-medium text-s112-text-2 mb-1">BIC</label>
            <input name="rechnung_bic" defaultValue={daten.rechnung_bic ?? ''} className={inputCls()} placeholder="RLNWATWWXXX" style={{ maxWidth: '320px' }} />
          </div>
        </div>
      </div>

      <div>
        <p className="text-xs font-semibold text-s112-text-1 uppercase tracking-wide mb-3">Rechnungs-Fußtext</p>
        <textarea name="rechnung_fusstext" defaultValue={daten.rechnung_fusstext ?? ''}
          rows={3} placeholder="z.B. Gemäß § 6 Abs. 1 Z 8 UStG befreit von der Umsatzsteuer."
          className="w-full border border-s112-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40 resize-none" />
      </div>

      <div className="flex items-center gap-3">
        <button type="submit" disabled={pending}
          className="bg-s112-teal text-white px-4 py-1.5 rounded-lg text-sm font-medium hover:bg-opacity-90 disabled:opacity-40">
          {pending ? 'Speichern…' : 'Speichern'}
        </button>
        {saved && <span className="text-xs text-s112-blue-700 font-medium">Gespeichert</span>}
      </div>
    </form>
  )
}

// ── Tab: bawb.at ─────────────────────────────────────────────────────────────

function BawbTabOwn({ daten }: { daten: EigeneBetriebsdaten }) {
  const [kennung, setKennung]   = useState(daten.bawb_kennung ?? '')
  const [passwort, setPasswort] = useState(daten.bawb_passwort ?? '')
  const [showPw, setShowPw]     = useState(false)
  const [status, setStatus]     = useState<'idle' | 'saving' | 'ok' | 'err'>('idle')
  const [errMsg, setErrMsg]     = useState<string | null>(null)
  const [, startTransition]     = useTransition()

  const cls = 'w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40'

  function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setStatus('saving'); setErrMsg(null)
    const fd = new FormData()
    fd.set('bawb_kennung', kennung.trim())
    fd.set('bawb_passwort', passwort)
    startTransition(async () => {
      const res = await saveBawbOwn(fd)
      if (res?.error) { setStatus('err'); setErrMsg(res.error) }
      else setStatus('ok')
    })
  }

  return (
    <div className="space-y-5">
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
            className="shrink-0 bg-s112-teal text-white px-4 py-2 rounded-xl text-sm font-semibold hover:bg-opacity-90 transition-colors whitespace-nowrap"
          >
            bawb.at öffnen
          </a>
        </div>
        <p className="text-xs text-s112-muted bg-s112-warn-bg border border-s112-warn/30 rounded-lg px-3 py-2">
          Die Zugangsdaten werden in der Datenbank gespeichert (wie API-Keys). Für erhöhte Sicherheit empfiehlt sich Supabase Vault – aktuell nicht aktiviert.
        </p>
      </div>

      <form onSubmit={handleSave} className="card p-5 space-y-4">
        <h3 className="font-semibold text-s112-text text-sm">Zugangsdaten</h3>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-s112-text-2 mb-1">Kennung (Betriebsnummer)</label>
            <input
              type="text"
              value={kennung}
              onChange={e => { setKennung(e.target.value); setStatus('idle') }}
              placeholder="z.B. 4489781"
              className={cls}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-s112-text-2 mb-1">Passwort</label>
            <div className="relative">
              <input
                type={showPw ? 'text' : 'password'}
                value={passwort}
                onChange={e => { setPasswort(e.target.value); setStatus('idle') }}
                placeholder="Passwort"
                className={cls + ' pr-16'}
              />
              <button
                type="button"
                onClick={() => setShowPw(v => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-s112-muted hover:text-s112-text-1 px-1"
              >
                {showPw ? 'verbergen' : 'anzeigen'}
              </button>
            </div>
          </div>
        </div>

        {errMsg && <p className="text-xs text-s112-err-fg bg-s112-err-bg border border-s112-err/30 rounded-lg px-3 py-2">{errMsg}</p>}

        <div className="flex items-center gap-3">
          <button type="submit" disabled={status === 'saving'}
            className="bg-s112-teal text-white px-4 py-1.5 rounded-lg text-sm font-medium hover:bg-opacity-90 disabled:opacity-40">
            {status === 'saving' ? 'Speichern…' : 'Speichern'}
          </button>
          {status === 'ok' && <span className="text-xs text-s112-blue-700 font-medium">Gespeichert</span>}
        </div>
      </form>
    </div>
  )
}
