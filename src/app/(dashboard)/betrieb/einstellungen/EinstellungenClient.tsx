'use client'

import { useState, useRef, useTransition } from 'react'
import Link from '@/components/ui/Link'
import { saveBrandingOwn, uploadLogoOwn, saveBetriebOwn, saveBawbOwn, saveKellerwirtschaftOwn } from './actions'
import type { MostgewichtEinheit } from '@/lib/wein/mostgewicht'
import { BetriebsnummerFeld } from '@/components/BetriebsnummerFeld'
import { RECHTSFORMEN } from '@/lib/betrieb/rechtsform'
import type { EigeneBetriebsdaten } from './page'
import BenutzerClient from '../../benutzer/BenutzerClient'
import type { BenutzerlimitStatus } from '@/lib/pakete-server'
import type { MemberWithEmail } from '../../benutzer/actions'
import { PAKETE, preisText, istPaketKey } from '@/lib/pakete'
import { bundeslandAusKundennummer } from '@/lib/tenant/kundennummer'
import KontrastHinweis from '@/components/ui/KontrastHinweis'
import { AbbrechenKnopf } from '@/components/navigation/Abbrechen'

const BIO_STATUS_OPTS = [
  { value: 'konventionell', label: 'Konventionell' },
  { value: 'kip',           label: 'KIP (kontrolliert integrierte Produktion)' },
  { value: 'nachhaltig',    label: 'Nachhaltig' },
  { value: 'bio_eu',        label: 'Bio-EU' },
  { value: 'biodynamisch',  label: 'Biodynamisch' },
]

const BAWB_URL = 'https://services2.lfrz.at/at.lfrz.wein/frame.html'

function inputCls() {
  return 'w-full border border-s112-border rounded-lg px-3 py-1.5 text-sm focus:outline-hidden focus:ring-2 focus:ring-s112-teal/40'
}

type Tab = 'branding' | 'benutzer' | 'betrieb' | 'keller' | 'bawb' | 'abo'

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
    { id: 'keller',   label: 'Kellerwirtschaft' },
    { id: 'bawb',     label: 'bawb.at' },
    { id: 'abo',      label: 'Abo & Paket' },
  ]

  return (
    <div>
      <div className="mb-6">
        <AbbrechenKnopf standard="/dashboard" className="mb-2 inline-flex items-center gap-1.5 text-sm text-s112-text-2 hover:text-s112-blue-700 transition-colors">← Zurück</AbbrechenKnopf>{/* KAN-333 */}
        <h1 className="text-2xl font-semibold text-s112-text">{daten.tenantName}</h1>
        <p className="text-sm text-s112-muted mt-0.5">
          {/* Kundennummer (Migration 209) - bitte bei Support-Anfragen angeben */}
          {daten.kundennummer
            ? <><span title={`Kundennummer${bundeslandAusKundennummer(daten.kundennummer) ? ' · ' + bundeslandAusKundennummer(daten.kundennummer) : ''}`}>Kundennummer <span className="font-mono text-s112-text-1">{daten.kundennummer}</span></span>{' · '}</>
            : <><span className="text-s112-warn-fg" title="Wird automatisch vergeben, sobald unter Betrieb die Postleitzahl gespeichert ist">Kundennummer folgt nach Eingabe der PLZ</span>{' · '}</>}
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
      {tab === 'keller'   && <KellerwirtschaftTabOwn daten={daten} />}
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
        <Link href="/abo" className="inline-block bg-s112-teal text-s112-yellow px-4 py-2 rounded-lg text-sm font-medium hover:bg-s112-teal/90">
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
  const [fehler, setFehler]       = useState<string | null>(null)
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
    setFehler(null)
    startTransition(async () => {
      // Ergebnis auswerten – der Server lehnt z. B. im Nur-Lesen-Modus (KAN-5) mit { error } ab
      const r = await saveBrandingOwn(fd)
      if (r && 'error' in r && r.error) { setFehler(r.error); return }
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    })
  }

  return (
    <form data-ungespeichert onSubmit={handleSubmit} className="space-y-5 max-w-lg">
      <div>
        <label className="block text-xs font-medium text-s112-text-2 mb-1">Anzeigename</label>
        <input aria-label="Anzeigename" name="anzeigename" defaultValue={daten.anzeigename ?? daten.tenantName}
          placeholder={daten.tenantName} className={inputCls()} />
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
              className="w-8 h-8 rounded-sm border border-s112-border cursor-pointer p-0.5 shrink-0" />
            <input name="primary_color" value={primary} onChange={e => setPrimary(e.target.value)}
              className="flex-1 border border-s112-border rounded-lg px-3 py-1.5 text-sm font-mono focus:outline-hidden focus:ring-2 focus:ring-s112-teal/40" />
          </div>
        </div>
        <div>
          <label className="block text-xs font-medium text-s112-text-2 mb-1">Sekundärfarbe</label>
          <div className="flex gap-2 items-center">
            <input type="color" value={secondary} onChange={e => setSecondary(e.target.value)}
              className="w-8 h-8 rounded-sm border border-s112-border cursor-pointer p-0.5 shrink-0" />
            <input name="secondary_color" value={secondary} onChange={e => setSecondary(e.target.value)}
              className="flex-1 border border-s112-border rounded-lg px-3 py-1.5 text-sm font-mono focus:outline-hidden focus:ring-2 focus:ring-s112-teal/40" />
          </div>
        </div>
      </div>
      <KontrastHinweis primary={primary} secondary={secondary} name={daten.anzeigename || daten.tenantName} onUebernehmen={setPrimary} />

      <div>
        <label className="block text-xs font-medium text-s112-text-2 mb-1">Session Timeout (Minuten)</label>
        <input aria-label="Session Timeout (Minuten)" name="session_timeout_minuten" type="number" step="1" min="5" max="480"
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
            <input aria-label="Gärkontrolle fällig nach (Tage)" name="gaerung_messintervall_tage" type="number" step="1" min="1" max="60" required
              defaultValue={daten.gaerung_messintervall_tage} className={inputCls()} style={{ maxWidth: '180px' }} />
            <p className="text-xs text-s112-muted mt-1">Charge in Gärung ohne Weinanalyse seit so vielen Tagen gilt als „Messung fällig“ (Kellerbuch-Kanban, Übersicht, Glocke).</p>
          </div>
          <div>
            <label className="block text-xs font-medium text-s112-text-2 mb-1">Fristen-Vorwarnung (Tage)</label>
            <input aria-label="Fristen-Vorwarnung (Tage)" name="fristen_vorwarnung_tage" type="number" step="1" min="1" max="365" required
              defaultValue={daten.fristen_vorwarnung_tage} className={inputCls()} style={{ maxWidth: '180px' }} />
            <p className="text-xs text-s112-muted mt-1">So viele Tage vor dem Termin springt eine Frist von „offen“ auf „fällig“ (Ampel, Glocke, Offene Aufgaben).</p>
          </div>
          <div>
            <label className="block text-xs font-medium text-s112-text-2 mb-1">Erfassungsfrist Pflanzenschutz (Stunden)</label>
            <input aria-label="Erfassungsfrist Pflanzenschutz (Stunden)" name="psm_erfassungsfrist_h" type="number" step="1" min="1" max="720" required
              defaultValue={daten.psm_erfassungsfrist_h} className={inputCls()} style={{ maxWidth: '180px' }} />
            <p className="text-xs text-s112-muted mt-1">Ab Ende des Anwendungstags (24:00); später erfasste Pflanzenschutz-Maßnahmen und Düngungen gelten als „nacherfasst“ (Ampel bis 72 h gelb, darüber rot).</p>
          </div>
          {/* KAN-418 Teil 5: Standardfrist einer Reservierung */}
          <div>
            <label className="block text-xs font-medium text-s112-text-2 mb-1">Reservierung gilt (Tage)</label>
            <input aria-label="Reservierung gilt (Tage)" name="auftrag_reservierung_tage" type="number" step="1" min="1" max="365" required
              defaultValue={daten.auftrag_reservierung_tage} className={inputCls()} style={{ maxWidth: '180px' }} />
            <p className="text-xs text-s112-muted mt-1">Vorschlag für „Reserviert bis“ bei einem neuen Auftrag. Eine abgelaufene Reservierung bleibt bestehen und erscheint als Hinweis (Warenwirtschaft-Übersicht, Glocke).</p>
          </div>
        </div>
      </div>

      {/* Morgenbericht & Wetter (Migration 201, Jour fixe 9.9.2026) */}
      <div className="pt-2 border-t border-s112-border">
        <p className="text-sm font-semibold text-s112-text-1 mb-2">Morgenbericht & Wetter</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <label className="flex items-start gap-2 text-sm text-s112-text">
            <input name="morgenbericht_aktiv" type="checkbox" defaultChecked={daten.morgenbericht_aktiv} className="mt-1 accent-s112-teal" />
            <span>Morgenbericht täglich um 7 Uhr erstellen<span className="block text-xs text-s112-muted">Prüft Fristen, Gärkontrollen, Zahlungsziele, Belege, Bestände, Wartefristen, Kontakte und Abo; Zusammenfassung mit KI zählt als eine Abfrage im KI-Kontingent.</span></span>
          </label>
          <label className="flex items-start gap-2 text-sm text-s112-text">
            <input name="wetter_aktiv" type="checkbox" defaultChecked={daten.wetter_aktiv} className="mt-1 accent-s112-teal" />
            <span>Wetter & Empfehlungen je Ried<span className="block text-xs text-s112-muted">GeoSphere Austria (Rückblick 1 km, Prognose 2,5 km) für Rieden mit Koordinaten – Standard und Premium.</span></span>
          </label>
          <div>
            <label className="block text-xs font-medium text-s112-text-2 mb-1">Belag abgewaschen ab (mm Regen seit Behandlung)</label>
            <input aria-label="Belag abgewaschen ab (mm Regen seit Behandlung)" name="wetter_abwasch_mm" type="number" step="1" min="5" max="100" required defaultValue={daten.wetter_abwasch_mm} className={inputCls()} style={{ maxWidth: '180px' }} />
            <p className="text-xs text-s112-muted mt-1">Faustregel 20–30 mm; ab 60 % davon gilt der Belag als nachlassend.</p>
          </div>
          <div>
            <label className="block text-xs font-medium text-s112-text-2 mb-1">Spritzintervall (Tage, Mai–August)</label>
            <input aria-label="Spritzintervall (Tage, Mai–August)" name="wetter_intervall_tage" type="number" step="1" min="5" max="60" required defaultValue={daten.wetter_intervall_tage} className={inputCls()} style={{ maxWidth: '180px' }} />
            <p className="text-xs text-s112-muted mt-1">Länger ohne Behandlung → Hinweis „Spritzintervall abgelaufen“ im Morgenbericht.</p>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button type="submit" disabled={pending}
          className="bg-s112-teal text-s112-yellow px-4 py-1.5 rounded-lg text-sm font-medium hover:bg-s112-teal/90 disabled:opacity-40">
          {pending ? 'Speichern…' : 'Speichern'}
        </button>
        {saved && <span className="text-xs text-s112-blue-700 font-medium">Gespeichert</span>}
      </div>
      {fehler && <p role="alert" className="text-sm text-s112-err-fg">{fehler}</p>}
    </form>
  )
}

// ── Tab: Betrieb ─────────────────────────────────────────────────────────────

function BetriebTabOwn({ daten }: { daten: EigeneBetriebsdaten }) {
  const [pending, startTransition] = useTransition()
  const [saved, setSaved]         = useState(false)
  const [fehler, setFehler]       = useState<string | null>(null)

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    setFehler(null)
    startTransition(async () => {
      // Ergebnis auswerten – der Server lehnt z. B. im Nur-Lesen-Modus (KAN-5) mit { error } ab
      const r = await saveBetriebOwn(fd)
      if (r && 'error' in r && r.error) { setFehler(r.error); return }
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    })
  }

  return (
    <form data-ungespeichert onSubmit={handleSubmit} className="space-y-6 max-w-lg">
      <div>
        <p className="text-xs font-semibold text-s112-text-1 uppercase tracking-wide mb-3">Betriebsdaten (Briefkopf)</p>
        <div className="grid grid-cols-1 gap-3">
          <div>
            <label className="block text-xs font-medium text-s112-text-2 mb-1">Betriebsname *</label>
            <input aria-label="Betriebsname" name="betrieb_name" defaultValue={daten.betrieb_name ?? ''} required className={inputCls()} placeholder="Weingut Gebeshuber" />
          </div>
          {/* KAN-48 AP11: Angaben für das BKI-Blatt „Betriebsdaten“ */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-xs font-medium text-s112-text-2 mb-1">Rechtsform</label>
              <select aria-label="Rechtsform" name="betrieb_rechtsform" defaultValue={daten.betrieb_rechtsform ?? ''} className={inputCls()}>
                <option value="">– nicht angegeben –</option>
                {Object.entries(RECHTSFORMEN).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-s112-text-2 mb-1">Bezeichnung der Betriebsstätte</label>
              <input aria-label="Bezeichnung der Betriebsstätte" name="betrieb_betriebsstaette" defaultValue={daten.betrieb_betriebsstaette ?? ''} className={inputCls()} placeholder="leer = Betriebsname" />
            </div>
            <div>
              <label className="block text-xs font-medium text-s112-text-2 mb-1">Vorname (natürliche Person)</label>
              <input aria-label="Vorname" name="betrieb_vorname" defaultValue={daten.betrieb_vorname ?? ''} className={inputCls()} />
            </div>
            <div>
              <label className="block text-xs font-medium text-s112-text-2 mb-1">Nachname (natürliche Person)</label>
              <input aria-label="Nachname" name="betrieb_nachname" defaultValue={daten.betrieb_nachname ?? ''} className={inputCls()} />
            </div>
          </div>
          <p className="text-[11px] text-s112-tertiary -mt-1">Für die BKI-Schnittstelle: Bei einer natürlichen Person werden Vor- und Nachname gemeldet, sonst der Betriebsname als Firmenname.</p>
          <div className="grid grid-cols-3 gap-2">
            <div className="col-span-2">
              <label className="block text-xs font-medium text-s112-text-2 mb-1">Straße + Nr.</label>
              <input aria-label="Straße + Nr." name="betrieb_strasse" defaultValue={daten.betrieb_strasse ?? ''} className={inputCls()} placeholder="Hauptstraße 1" />
            </div>
            <div>
              <label className="block text-xs font-medium text-s112-text-2 mb-1">PLZ</label>
              <input inputMode="numeric" aria-label="PLZ" name="betrieb_plz" defaultValue={daten.betrieb_plz ?? ''} className={inputCls()} placeholder="3421" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-s112-text-2 mb-1">Ort</label>
            <input aria-label="Ort" name="betrieb_ort" defaultValue={daten.betrieb_ort ?? ''} className={inputCls()} placeholder="Krems an der Donau" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-xs font-medium text-s112-text-2 mb-1">Telefon</label>
              <input aria-label="Telefon" name="betrieb_telefon" defaultValue={daten.betrieb_telefon ?? ''} className={inputCls()} placeholder="+43 2732 12345" />
            </div>
            <div>
              <label className="block text-xs font-medium text-s112-text-2 mb-1">E-Mail</label>
              <input aria-label="E-Mail" name="betrieb_email" type="email" defaultValue={daten.betrieb_email ?? ''} className={inputCls()} placeholder="office@weingut.at" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-xs font-medium text-s112-text-2 mb-1">Website</label>
              <input aria-label="Website" name="betrieb_website" defaultValue={daten.betrieb_website ?? ''} className={inputCls()} placeholder="www.weingut.at" />
            </div>
            <div>
              <label className="block text-xs font-medium text-s112-text-2 mb-1">UID-Nummer</label>
              <input aria-label="UID-Nummer" name="betrieb_uid" defaultValue={daten.betrieb_uid ?? ''} className={inputCls()} placeholder="ATU12345678" />
            </div>
            {/* KAN-432: Angaben für den Weinexport */}
            <div>
              <label className="block text-xs font-medium text-s112-text-2 mb-1">EORI-Nummer</label>
              <input aria-label="EORI-Nummer" name="betrieb_eori" maxLength={30} defaultValue={daten.betrieb_eori ?? ''} className={inputCls()} placeholder="ATEOS1000012345" />
              <p className="text-xs text-s112-muted mt-1">Nur für die Ausfuhr in Länder außerhalb der EU nötig (vergibt der Zoll).</p>
            </div>
            <div>
              <label className="block text-xs font-medium text-s112-text-2 mb-1">Flaschen je Karton (Export)</label>
              <input aria-label="Flaschen je Karton (Export)" name="export_flaschen_je_karton" type="number" step="1" min="1" max="60" required
                defaultValue={daten.export_flaschen_je_karton} className={inputCls()} style={{ maxWidth: '180px' }} />
              <p className="text-xs text-s112-muted mt-1">Vorschlag für neue Positionen im Exportauftrag; je Position änderbar.</p>
            </div>
            {/* KAN-434: Nummern für die Ursprungserklärung auf der Exportrechnung */}
            <div>
              <label className="block text-xs font-medium text-s112-text-2 mb-1">REX-Nummer</label>
              <input aria-label="REX-Nummer" name="betrieb_rex_nummer" maxLength={40} defaultValue={daten.betrieb_rex_nummer ?? ''} className={inputCls()} placeholder="ATREX…" />
              <p className="text-xs text-s112-muted mt-1">Registrierter Ausführer – für die Ursprungserklärung über 6.000 € (z. B. Vereinigtes Königreich, Japan).</p>
            </div>
            <div>
              <label className="block text-xs font-medium text-s112-text-2 mb-1">Bewilligung Ermächtigter Ausführer</label>
              <input aria-label="Bewilligung Ermächtigter Ausführer" name="betrieb_ea_bewilligung" maxLength={40} defaultValue={daten.betrieb_ea_bewilligung ?? ''} className={inputCls()} placeholder="AT/…" />
              <p className="text-xs text-s112-muted mt-1">Bewilligungsnummer des Zollamts – für die Ursprungserklärung über 6.000 € (z. B. Südkorea).</p>
            </div>
            <div className="sm:col-span-2">
              <label className="inline-flex items-start gap-2 text-sm text-s112-text-1">
                <input type="checkbox" name="kleiner_weinerzeuger" defaultChecked={daten.kleiner_weinerzeuger} className="mt-0.5" />
                <span>Kleiner Weinerzeuger <span className="text-s112-muted">(im Durchschnitt unter 1.000 hl Wein je Weinwirtschaftsjahr – für das Begleitdokument beim Versand in andere EU-Länder)</span></span>
              </label>
            </div>
            {/* KAN-261: Betriebsart nur Anzeige, Betriebsnummer nur für Weinproduzenten Pflicht */}
            <BetriebsnummerFeld betriebsart={daten.betriebsart} betriebsnummer={daten.betrieb_betriebsnummer}
              waehlbar={false} inputClassName={inputCls()} />
            {/* Betriebsbeginn / Systemstart der E&A-Rechnung (Migration 180) */}
            <div>
              <label className="block text-xs font-medium text-s112-text-2 mb-1">Betriebsbeginn E&amp;A-Rechnung</label>
              <input aria-label="Betriebsbeginn E&A-Rechnung" name="ea_betriebsbeginn" type="date" defaultValue={daten.ea_betriebsbeginn ?? ''} className={inputCls()} />
              <p className="text-[11px] text-s112-tertiary mt-0.5">Systemstart: Monate davor gelten nicht als offen (Monatsabschluss, UVA, Dashboard). Leer = keine Einschränkung.</p>
            </div>
          </div>
        </div>
      </div>

      <div>
        <p className="text-xs font-semibold text-s112-text-1 uppercase tracking-wide mb-3">Bewirtschaftung</p>
        <div>
          <label className="block text-xs font-medium text-s112-text-2 mb-1">Status</label>
          <select aria-label="Status" name="bio_status" defaultValue={daten.bio_status} className={inputCls()} style={{ maxWidth: '320px' }}>
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
            <input aria-label="IBAN" name="rechnung_iban" defaultValue={daten.rechnung_iban ?? ''} className={inputCls()} placeholder="AT12 3456 7890 1234 5678" />
          </div>
          <div>
            <label className="block text-xs font-medium text-s112-text-2 mb-1">BIC</label>
            <input aria-label="BIC" name="rechnung_bic" defaultValue={daten.rechnung_bic ?? ''} className={inputCls()} placeholder="RLNWATWWXXX" style={{ maxWidth: '320px' }} />
          </div>
        </div>
      </div>

      <div>
        <p className="text-xs font-semibold text-s112-text-1 uppercase tracking-wide mb-3">Rechnungs-Fußtext</p>
        <textarea name="rechnung_fusstext" defaultValue={daten.rechnung_fusstext ?? ''}
          rows={3} placeholder="z.B. Gemäß § 6 Abs. 1 Z 8 UStG befreit von der Umsatzsteuer."
          className="w-full border border-s112-border rounded-lg px-3 py-1.5 text-sm focus:outline-hidden focus:ring-2 focus:ring-s112-teal/40 resize-none" />
      </div>

      <div className="flex items-center gap-3">
        <button type="submit" disabled={pending}
          className="bg-s112-teal text-s112-yellow px-4 py-1.5 rounded-lg text-sm font-medium hover:bg-s112-teal/90 disabled:opacity-40">
          {pending ? 'Speichern…' : 'Speichern'}
        </button>
        {saved && <span className="text-xs text-s112-blue-700 font-medium">Gespeichert</span>}
      </div>
      {fehler && <p role="alert" className="text-sm text-s112-err-fg">{fehler}</p>}
    </form>
  )
}

// ── Tab: Kellerwirtschaft (KAN-128 Teil A, S3) ───────────────────────────────
// Bevorzugte Mostgewicht-Einheit des Betriebs (tenant_einstellungen.mostgewicht_einheit): steuert
// nur, welche Einheit Formulare und Listen zuerst zeigen (useMostgewichtEinheit).

const MOSTGEWICHT_EINHEIT_OPTS: { value: MostgewichtEinheit; label: string; text: string }[] = [
  { value: 'kmw',     label: '°KMW (Klosterneuburger Mostwaage)', text: 'Einheit des österreichischen Weingesetzes – Standard.' },
  { value: 'oechsle', label: '°Oe (Öchsle)',                      text: 'Wenn du meist in Öchsle misst, z. B. mit Dichtemesser oder Öchsle-Refraktometer.' },
]

function KellerwirtschaftTabOwn({ daten }: { daten: EigeneBetriebsdaten }) {
  const [pending, startTransition] = useTransition()
  const [saved, setSaved]         = useState(false)
  const [fehler, setFehler]       = useState<string | null>(null)

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    setFehler(null)
    startTransition(async () => {
      // Ergebnis auswerten – der Server lehnt z. B. im Nur-Lesen-Modus (KAN-5) mit { error } ab
      const r = await saveKellerwirtschaftOwn(fd)
      if (r && 'error' in r && r.error) { setFehler(r.error); return }
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5 max-w-lg">
      <fieldset aria-describedby="mostgewicht-einheit-hinweis">
        <legend className="text-xs font-semibold text-s112-text-1 uppercase tracking-wide mb-3">Mostgewicht – bevorzugte Einheit</legend>
        <div className="space-y-2">
          {MOSTGEWICHT_EINHEIT_OPTS.map(o => (
            <label key={o.value} className="flex items-start gap-2 text-sm text-s112-text">
              <input type="radio" name="mostgewicht_einheit" value={o.value} required
                defaultChecked={daten.mostgewicht_einheit === o.value} className="mt-1 accent-s112-teal" />
              <span>{o.label}<span className="block text-xs text-s112-muted">{o.text}</span></span>
            </label>
          ))}
        </div>
        <p id="mostgewicht-einheit-hinweis" className="text-xs text-s112-muted mt-3">
          Formulare und Listen zeigen diese Einheit zuerst, die andere umgerechnet daneben (≈). Die gemessene
          Einheit wird bei jedem Eintrag mitgespeichert und bleibt davon unabhängig – ein Zukauf-Lieferschein
          in °KMW bleibt z. B. in °KMW erfasst, auch wenn du sonst in °Oe misst. Qualitätsstufen richten sich
          immer nach °KMW; Behördenmeldungen und Exporte zeigen °KMW vor °Oe.
        </p>
      </fieldset>

      <div className="flex items-center gap-3">
        <button type="submit" disabled={pending}
          className="bg-s112-teal text-s112-yellow px-4 py-1.5 rounded-lg text-sm font-medium hover:bg-s112-teal/90 disabled:opacity-40">
          {pending ? 'Speichern…' : 'Speichern'}
        </button>
        {saved && <span className="text-xs text-s112-blue-700 font-medium">Gespeichert</span>}
      </div>
      {fehler && <p role="alert" className="text-sm text-s112-err-fg">{fehler}</p>}
    </form>
  )
}

// ── Tab: bawb.at ─────────────────────────────────────────────────────────────

function BawbTabOwn({ daten }: { daten: EigeneBetriebsdaten }) {
  const [kennung, setKennung]   = useState(daten.bawb_kennung ?? '')
  // KAN-135: Das Passwort kommt nie in den Browser – daten.bawb_passwort ist nur die
  // Maske („hinterlegt“). Leer lassen = hinterlegtes behalten (Maske geht zurück).
  const hinterlegt = daten.bawb_passwort
  const [passwort, setPasswort] = useState('')
  const [entfernen, setEntfernen] = useState(false)
  const [showPw, setShowPw]     = useState(false)
  const [status, setStatus]     = useState<'idle' | 'saving' | 'ok' | 'err'>('idle')
  const [errMsg, setErrMsg]     = useState<string | null>(null)
  const [, startTransition]     = useTransition()

  const cls = 'w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-hidden focus:ring-2 focus:ring-s112-teal/40'

  function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setStatus('saving'); setErrMsg(null)
    const fd = new FormData()
    fd.set('bawb_kennung', kennung.trim())
    fd.set('bawb_passwort', passwort.trim() ? passwort : (entfernen ? '' : (hinterlegt ?? '')))
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
            className="shrink-0 bg-s112-teal text-s112-yellow px-4 py-2 rounded-xl text-sm font-semibold hover:bg-s112-teal/90 transition-colors whitespace-nowrap"
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
            <input inputMode="numeric" aria-label="Kennung (Betriebsnummer)"
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
                placeholder={hinterlegt ? 'hinterlegt (verschlüsselt) – zum Ändern neu eingeben' : 'Passwort'}
                autoComplete="off"
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
            {hinterlegt && (
              <label className="mt-1 flex items-center gap-1.5 text-xs text-s112-muted">
                <input type="checkbox" checked={entfernen} onChange={e => { setEntfernen(e.target.checked); setStatus('idle') }} />
                Hinterlegtes Passwort entfernen
              </label>
            )}
          </div>
        </div>

        {errMsg && <p role="alert" className="text-xs text-s112-err-fg bg-s112-err-bg border border-s112-err/30 rounded-lg px-3 py-2">{errMsg}</p>}

        <div className="flex items-center gap-3">
          <button type="submit" disabled={status === 'saving'}
            className="bg-s112-teal text-s112-yellow px-4 py-1.5 rounded-lg text-sm font-medium hover:bg-s112-teal/90 disabled:opacity-40">
            {status === 'saving' ? 'Speichern…' : 'Speichern'}
          </button>
          {status === 'ok' && <span className="text-xs text-s112-blue-700 font-medium">Gespeichert</span>}
        </div>
      </form>
    </div>
  )
}
