'use client'

// ── Kopfleiste (Dashboard-Relaunch 27.8.2026) ─────────────────────────────────
// Seit KAN-142 (26.09.2026) in CD-Blau s112-blue-700 (#2F63AC, Weiß darauf 6,0:1)
// statt Anthrazit. Folgen für alles auf der Fläche (Kontraste lt. WCAG geprüft):
//  - Weiß mit Deckkraft erst ab /85 (4,8:1) für Text; /45–/60 wie auf Anthrazit
//    reichen auf Blau nicht (2,5–3,3:1).
//  - Suchfeld (bg-black/15, Hover /25) und Hover der Symbol-Knöpfe (bg-black/15)
//    als dunklere Einlage statt heller (bg-white/10 senkt Weiß auf 4,8:1).
//  - Wortmarke einfarbig Weiß (CD: „einfarbig weiß auf Blau“) – der Logo-blaue
//    Doppelpunkt hätte auf Blau nur 2,4:1.
//  - Fokusrahmen Weiß (FOKUS_HELL): der globale Rahmen #2F63AC (globals.css)
//    wäre auf der gleichfarbigen Fläche unsichtbar.
// Markenarchitektur lt. hohenstein-CD-Manual: in der Anwendung tritt
// software:112 als Absender auf (Wortmarke links), hohenstein steht im
// Fußbereich (siehe AppShell). Rechts daneben der Mandant – Logo und/oder
// Anzeigename aus tenant_einstellungen (in "Mein Betrieb" anpassbar).
// Rechts: Befehlspalette (Strg K), Benachrichtigungen (Fristenzähler aus
// /api/dashboard/hinweise: überfällige/fällige Fristen + fällige Gärkontrollen),
// Benutzermenü (Profil, Betrieb wechseln, Abmelden).

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from '@/components/ui/Link'
import { Search, Bell, LogOut, ArrowLeftRight, User, ChevronDown } from 'lucide-react'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'
import type { TenantBranding } from '@/app/(dashboard)/layout'
import type { Hinweis, Benachrichtigung } from '@/app/api/dashboard/hinweise/route'

const HINWEISE_INTERVALL_MS = 5 * 60 * 1000

export const PALETTE_EVENT = 's112:palette'
/** Fordert die Topbar auf, den Fristenzähler neu zu laden */
export const HINWEISE_EVENT = 's112:hinweise'

/** Fokusrahmen auf der blauen Fläche: nur die Farbe, Breite und Abstand kommen
 *  aus globals.css (dort mit !important, daher auch hier !important) */
const FOKUS_HELL = 'focus-visible:!outline-white'

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

export default function Topbar({
  userEmail, userName, roleLabel, branding, betriebCount = 1,
}: {
  userEmail: string
  userName?: string
  roleLabel: string
  branding: TenantBranding
  betriebCount?: number
}) {
  const router   = useRouter()
  const [menuOpen, setMenuOpen]   = useState(false)
  const [notifOpen, setNotifOpen] = useState(false)
  const menuRef  = useRef<HTMLDivElement>(null)
  const notifRef = useRef<HTMLDivElement>(null)
  const displayName = userName || userEmail
  const [hinweise, setHinweise] = useState<Hinweis[] | null>(null) // null = noch nicht geladen
  const [benachr, setBenachr]   = useState<Benachrichtigung[]>([])  // persönliche, ungelesene (Migration 224)

  // Fristenzähler laden – beim Start und danach alle 5 Minuten (Topbar lebt im
  // Layout und bleibt bei Client-Navigation erhalten, daher kein Reload je Seite).
  useEffect(() => {
    let aktiv = true
    const laden = async () => {
      try {
        const res = await fetch('/api/dashboard/hinweise', { cache: 'no-store' })
        if (!res.ok) return
        const json = await res.json()
        if (aktiv) {
          setHinweise(Array.isArray(json.hinweise) ? json.hinweise : [])
          setBenachr(Array.isArray(json.benachrichtigungen) ? json.benachrichtigungen : [])
        }
      } catch { /* Netzfehler: alten Stand behalten */ }
    }
    void laden()
    const t = setInterval(laden, HINWEISE_INTERVALL_MS)
    // z.B. nach "Frist erledigt" in der Fristen-Sicht sofort aktualisieren
    window.addEventListener(HINWEISE_EVENT, laden)
    return () => { aktiv = false; clearInterval(t); window.removeEventListener(HINWEISE_EVENT, laden) }
  }, [])
  const anzahl = (hinweise?.length ?? 0) + benachr.length
  const anzahlErr = hinweise?.filter(h => h.tone === 'err').length ?? 0
  // Glocken-Badge: Fehler rot, Hinweise gelb (Zahl weiß: 4,8:1 bzw. 5,4:1), reine
  // Benachrichtigungen weiß mit blauer Zahl (6,0:1). Rot und Gelb heben sich von
  // der blauen Fläche kaum durch Helligkeit ab (1,3:1 bzw. 1,1:1) – daher der
  // weiße Ring (6,0:1 zur Fläche).
  const badgeFarbe = anzahlErr > 0
    ? 'bg-s112-err text-white ring-1 ring-white'
    : benachr.length > 0 && !hinweise?.length
      ? 'bg-white text-s112-blue-700'
      : 'bg-s112-warn-fg text-white ring-1 ring-white'

  // Benachrichtigung(en) als gelesen markieren – sofort aus der Liste nehmen, Server im Hintergrund
  const gelesen = (ids: string[] | 'alle') => {
    setBenachr(b => ids === 'alle' ? [] : b.filter(x => !ids.includes(x.id)))
    void fetch('/api/benachrichtigungen', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(ids === 'alle' ? { alle: true } : { ids }),
    }).catch(() => { /* beim nächsten Laden erneut sichtbar */ })
  }
  const artText = (a: string) => a === 'aufgabe_zugewiesen' ? 'Zugewiesen' : a === 'aufgabe_alle' ? 'Für alle' : a === 'erwaehnung' ? 'Erwähnung' : 'System'
  const wannText = (iso: string) => {
    const d = new Date(iso), diff = (Date.now() - d.getTime()) / 60000
    if (diff < 60) return `vor ${Math.max(1, Math.round(diff))} Min.`
    if (diff < 60 * 24) return `vor ${Math.round(diff / 60)} Std.`
    return d.toLocaleDateString('de-AT', { day: 'numeric', month: 'short' })
  }

  // Dropdowns bei Außenklick schließen
  useEffect(() => {
    if (!menuOpen && !notifOpen) return
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) setNotifOpen(false)
    }
    window.addEventListener('mousedown', handler)
    return () => window.removeEventListener('mousedown', handler)
  }, [menuOpen, notifOpen])

  const handleLogout = async () => {
    const supabase = createSupabaseBrowserClient()
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  return (
    <header className="bg-s112-blue-700 text-white shrink-0 z-40 shadow-[0_1px_4px_rgba(31,66,115,.35)]">
      <div className="h-14 max-w-[1280px] 2xl:max-w-[1600px] mx-auto px-4 lg:px-6 flex items-center gap-3 lg:gap-5">

        {/* Wortmarke software:112 – auf Blau einfarbig Weiß (siehe Dateikopf) */}
        <Link href="/dashboard" className={`shrink-0 font-display text-[21px] font-light tracking-[.04em] whitespace-nowrap leading-none hover:opacity-90 transition-opacity ${FOKUS_HELL}`}>
          software<b className="font-semibold">:</b>112
        </Link>

        {/* Mandant: Logo und/oder Anzeigename (tenant_einstellungen) */}
        <div className="min-w-0 flex-1 flex items-center gap-2.5 border-l border-white/35 pl-3 lg:pl-5 h-8" title={`Betrieb: ${branding.anzeigename}`}>
          {branding.logo_url && (
            // Logo-Kachel voll weiß: Mandantenlogos sind für hellen Grund gemacht
            // eslint-disable-next-line @next/next/no-img-element
            <img src={branding.logo_url} alt={branding.anzeigename} className="h-7 w-auto max-w-[140px] object-contain bg-white rounded px-1 py-0.5 shrink-0" />
          )}
          {/* Label und Name auf einer Grundlinie (Mono-Schrift sitzt sonst optisch zu hoch) */}
          <div className="min-w-0 flex items-baseline gap-2.5 leading-none">
            <span className="hidden md:inline font-mono text-[10.5px] tracking-[.08em] uppercase text-white/85 shrink-0">Betrieb</span>
            <span className="min-w-0 truncate text-[13.5px] text-white">{branding.anzeigename}</span>
          </div>
        </div>

        <div className="ml-auto flex items-center gap-1.5 lg:gap-2.5 shrink-0">
          {/* Befehlspalette */}
          <button
            type="button"
            onClick={() => window.dispatchEvent(new Event(PALETTE_EVENT))}
            className={`inline-flex items-center gap-2 h-8 px-2.5 rounded-md bg-black/15 hover:bg-black/25 text-white/85 hover:text-white text-[13px] transition-colors ${FOKUS_HELL}`}
            title="Suchen oder Befehl (Strg K)"
          >
            <Search size={15} strokeWidth={1.75} />
            <span className="hidden lg:inline">Suchen oder Befehl …</span>
            <kbd className="hidden md:inline font-mono text-[10.5px] text-white/85 border border-white/40 rounded-sm px-1.5 py-px">Strg K</kbd>
          </button>

          {/* Benachrichtigungen: Fristenzähler */}
          <div className="relative" ref={notifRef}>
            <button
              type="button"
              onClick={() => setNotifOpen(o => !o)}
              className={`relative w-8 h-8 flex items-center justify-center rounded-md text-white/90 hover:bg-black/15 hover:text-white transition-colors ${FOKUS_HELL}`}
              aria-label={anzahl ? `${anzahl} Hinweise` : 'Benachrichtigungen'}
              title={anzahl ? `${anzahl} offene Hinweise (Aufgaben, Fristen, Gärkontrollen)` : 'Benachrichtigungen'}
            >
              <Bell size={17} strokeWidth={1.5} />
              {anzahl > 0 && (
                <span className={`absolute -top-0.5 -right-0.5 min-w-[17px] h-[17px] px-1 rounded-full font-mono text-[11px] font-semibold leading-[17px] text-center ${badgeFarbe}`}>
                  {anzahl > 99 ? '99+' : anzahl}
                </span>
              )}
            </button>
            {notifOpen && (
              <div className="absolute right-0 top-10 z-50 w-80 bg-white rounded-xl border border-s112-line shadow-lg text-s112-text overflow-hidden">
                {/* Persönliche Benachrichtigungen (Aufgabe zugewiesen, für alle, @Erwähnung) */}
                {benachr.length > 0 && (
                  <>
                    <div className="flex items-center justify-between px-3.5 py-2.5 border-b border-s112-line bg-s112-bg/60">
                      <p className="text-xs font-semibold">Für mich <span className="font-normal text-s112-tertiary">({benachr.length})</span></p>
                      <button type="button" onClick={() => gelesen('alle')} className="text-[11.5px] text-s112-blue-700 hover:underline">alle gelesen</button>
                    </div>
                    <ul className="max-h-[40vh] overflow-y-auto py-1 border-b border-s112-line">
                      {benachr.map(b => (
                        <li key={b.id} className="flex items-start gap-2 px-3.5 py-2 hover:bg-s112-bg">
                          <Link href={b.href ?? '/crm'} onClick={() => { gelesen([b.id]); setNotifOpen(false) }} className="flex items-start gap-2.5 min-w-0 flex-1">
                            <span className="mt-1.5 w-2 h-2 rounded-full shrink-0 bg-s112-blue-700" />
                            <span className="min-w-0">
                              <span className="block text-[12.5px] font-medium truncate">{b.titel}</span>
                              <span className="block text-[11px] text-s112-text-2 truncate">{artText(b.art)} · {wannText(b.erstellt_am)}{b.text ? ` · ${b.text}` : ''}</span>
                            </span>
                          </Link>
                          <button type="button" onClick={() => gelesen([b.id])} title="Als gelesen markieren"
                            className="shrink-0 text-s112-tertiary hover:text-s112-text-1 text-[11px] leading-5 px-1">✓</button>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
                <div className="flex items-center justify-between px-3.5 py-2.5 border-b border-s112-line">
                  <p className="text-xs font-semibold">Hinweise</p>
                  <Link href="/dashboard/fristen" onClick={() => setNotifOpen(false)} className="text-[11.5px] text-s112-blue-700 hover:underline">alle Fristen →</Link>
                </div>
                {hinweise === null ? (
                  <p className="px-3.5 py-4 text-xs text-s112-tertiary">Wird geladen …</p>
                ) : hinweise.length === 0 ? (
                  <p className="px-3.5 py-4 text-xs text-s112-tertiary">Nichts Dringendes – keine fälligen Fristen oder Gärkontrollen.</p>
                ) : (
                  <ul className="max-h-[60vh] overflow-y-auto py-1">
                    {hinweise.map(h => (
                      <li key={h.key}>
                        <Link href={h.href} onClick={() => setNotifOpen(false)} className="flex items-start gap-2.5 px-3.5 py-2 hover:bg-s112-bg">
                          <span className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${h.tone === 'err' ? 'bg-s112-err' : 'bg-s112-warn'}`} />
                          <span className="min-w-0">
                            <span className="block text-[12.5px] font-medium truncate">{h.titel}</span>
                            <span className="block text-[11px] text-s112-text-2 truncate">{h.detail}</span>
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>

          {/* Benutzermenü */}
          <div className="relative" ref={menuRef}>
            <button
              type="button"
              onClick={() => setMenuOpen(o => !o)}
              aria-expanded={menuOpen}
              className={`flex items-center gap-2 h-8 pl-1 pr-2 rounded-md hover:bg-black/15 transition-colors ${FOKUS_HELL}`}
              title={displayName}
            >
              {/* Avatar hellblau mit blauen Initialen (5,4:1); Logo-Grau mit Weiß hätte 2,8:1 */}
              <span className="w-[26px] h-[26px] rounded-full bg-s112-blue-50 text-s112-blue-700 flex items-center justify-center text-[10.5px] font-semibold">
                {initials(displayName)}
              </span>
              <span className="hidden md:inline font-mono text-[11px] tracking-[.08em] uppercase text-white/85">{roleLabel}</span>
              <ChevronDown size={13} strokeWidth={1.75} className={`text-white/85 transition-transform ${menuOpen ? 'rotate-180' : ''}`} />
            </button>
            {menuOpen && (
              <div className="absolute right-0 top-10 z-50 w-60 bg-white rounded-xl border border-s112-line shadow-lg p-1.5 text-s112-text">
                <div className="px-2.5 py-2 border-b border-s112-line mb-1">
                  <p className="text-[12.5px] font-semibold truncate">{displayName}</p>
                  <p className="text-[11px] text-s112-tertiary truncate">{userEmail}</p>
                  <p className="text-[11px] text-s112-tertiary">{roleLabel}</p>
                </div>
                <Link href="/profil" onClick={() => setMenuOpen(false)}
                  className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[13px] hover:bg-s112-bg">
                  <User size={15} strokeWidth={1.75} className="text-s112-text-2" /> Profil bearbeiten
                </Link>
                {betriebCount > 1 && (
                  <a href="/betrieb-waehlen"
                    className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[13px] hover:bg-s112-bg">
                    <ArrowLeftRight size={15} strokeWidth={1.75} className="text-s112-text-2" /> Betrieb wechseln
                  </a>
                )}
                <button type="button" onClick={handleLogout}
                  className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[13px] text-left hover:bg-s112-err-bg hover:text-s112-err-fg">
                  <LogOut size={15} strokeWidth={1.75} /> Abmelden
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  )
}
