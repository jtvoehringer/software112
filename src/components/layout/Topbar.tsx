'use client'

// ── Navy-Kopfleiste (Dashboard-Relaunch 27.8.2026) ────────────────────────────
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
import type { Hinweis } from '@/app/api/dashboard/hinweise/route'

const HINWEISE_INTERVALL_MS = 5 * 60 * 1000

export const PALETTE_EVENT = 's112:palette'
/** Fordert die Topbar auf, den Fristenzähler neu zu laden */
export const HINWEISE_EVENT = 's112:hinweise'

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

  // Fristenzähler laden – beim Start und danach alle 5 Minuten (Topbar lebt im
  // Layout und bleibt bei Client-Navigation erhalten, daher kein Reload je Seite).
  useEffect(() => {
    let aktiv = true
    const laden = async () => {
      try {
        const res = await fetch('/api/dashboard/hinweise', { cache: 'no-store' })
        if (!res.ok) return
        const json = await res.json()
        if (aktiv) setHinweise(Array.isArray(json.hinweise) ? json.hinweise : [])
      } catch { /* Netzfehler: alten Stand behalten */ }
    }
    void laden()
    const t = setInterval(laden, HINWEISE_INTERVALL_MS)
    // z.B. nach "Frist erledigt" in der Fristen-Sicht sofort aktualisieren
    window.addEventListener(HINWEISE_EVENT, laden)
    return () => { aktiv = false; clearInterval(t); window.removeEventListener(HINWEISE_EVENT, laden) }
  }, [])
  const anzahl = hinweise?.length ?? 0
  const anzahlErr = hinweise?.filter(h => h.tone === 'err').length ?? 0

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
    <header className="bg-s112-text text-white shrink-0 z-40 shadow-[0_1px_4px_rgba(34,37,43,.25)]">
      <div className="h-14 max-w-[1280px] 2xl:max-w-[1600px] mx-auto px-4 lg:px-6 flex items-center gap-3 lg:gap-5">

        {/* Wortmarke software:112 */}
        <Link href="/dashboard" className="shrink-0 font-display text-[21px] font-light tracking-[.04em] whitespace-nowrap leading-none hover:opacity-90 transition-opacity">
          software<b className="font-semibold text-s112-blue-300">:</b>112
        </Link>

        {/* Mandant: Logo und/oder Anzeigename (tenant_einstellungen) */}
        <div className="min-w-0 flex-1 flex items-center gap-2.5 border-l border-white/25 pl-3 lg:pl-5 h-8" title={`Betrieb: ${branding.anzeigename}`}>
          {branding.logo_url && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={branding.logo_url} alt={branding.anzeigename} className="h-7 w-auto max-w-[140px] object-contain bg-white/90 rounded px-1 py-0.5 shrink-0" />
          )}
          <span className="hidden md:inline font-mono text-[10.5px] tracking-[.08em] uppercase text-white/45 shrink-0">Betrieb</span>
          <span className="truncate text-[13.5px] text-white/85">{branding.anzeigename}</span>
        </div>

        <div className="ml-auto flex items-center gap-1.5 lg:gap-2.5 shrink-0">
          {/* Befehlspalette */}
          <button
            type="button"
            onClick={() => window.dispatchEvent(new Event(PALETTE_EVENT))}
            className="inline-flex items-center gap-2 h-8 px-2.5 rounded-md bg-white/10 hover:bg-white/15 text-white/80 hover:text-white text-[13px] transition-colors"
            title="Suchen oder Befehl (Strg K)"
          >
            <Search size={15} strokeWidth={1.75} />
            <span className="hidden lg:inline">Suchen oder Befehl …</span>
            <kbd className="hidden md:inline font-mono text-[10.5px] text-white/60 border border-white/25 rounded-sm px-1.5 py-px">Strg K</kbd>
          </button>

          {/* Benachrichtigungen: Fristenzähler */}
          <div className="relative" ref={notifRef}>
            <button
              type="button"
              onClick={() => setNotifOpen(o => !o)}
              className="relative w-8 h-8 flex items-center justify-center rounded-md text-white/80 hover:bg-white/10 hover:text-white transition-colors"
              aria-label={anzahl ? `${anzahl} Hinweise` : 'Benachrichtigungen'}
              title={anzahl ? `${anzahl} offene Hinweise (Fristen, Gärkontrollen)` : 'Benachrichtigungen'}
            >
              <Bell size={17} strokeWidth={1.5} />
              {anzahl > 0 && (
                <span className={`absolute -top-0.5 -right-0.5 min-w-[17px] h-[17px] px-1 rounded-full font-mono text-[10px] font-semibold leading-[17px] text-center text-white ${anzahlErr > 0 ? 'bg-s112-err' : 'bg-s112-warn'}`}>
                  {anzahl > 99 ? '99+' : anzahl}
                </span>
              )}
            </button>
            {notifOpen && (
              <div className="absolute right-0 top-10 z-50 w-80 bg-white rounded-xl border border-s112-line shadow-lg text-s112-text overflow-hidden">
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
              className="flex items-center gap-2 h-8 pl-1 pr-2 rounded-md hover:bg-white/10 transition-colors"
              title={displayName}
            >
              <span className="w-[26px] h-[26px] rounded-full bg-s112-grey text-white flex items-center justify-center text-[10.5px] font-semibold">
                {initials(displayName)}
              </span>
              <span className="hidden md:inline font-mono text-[11px] tracking-[.08em] uppercase text-white/60">{roleLabel}</span>
              <ChevronDown size={13} strokeWidth={1.75} className={`text-white/60 transition-transform ${menuOpen ? 'rotate-180' : ''}`} />
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
