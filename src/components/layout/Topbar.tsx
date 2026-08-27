'use client'

// ── Navy-Kopfleiste (Dashboard-Relaunch 27.8.2026) ────────────────────────────
// Markenarchitektur lt. hohenstein-CD-Manual: in der Anwendung tritt
// software:112 als Absender auf (Wortmarke links), hohenstein steht im
// Fußbereich (siehe AppShell). Rechts daneben der Mandant – Logo und/oder
// Anzeigename aus tenant_einstellungen (in "Mein Betrieb" anpassbar).
// Rechts: Befehlspalette (Strg K), Benachrichtigungen, Benutzermenü
// (Profil, Betrieb wechseln, Abmelden).

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Search, Bell, LogOut, ArrowLeftRight, User, ChevronDown } from 'lucide-react'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'
import type { TenantBranding } from '@/app/(dashboard)/layout'

export const PALETTE_EVENT = 's112:palette'

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
    <header className="bg-s112-navy text-white shrink-0 z-40 shadow-[0_1px_4px_rgba(14,60,98,.25)]">
      <div className="h-14 max-w-[1280px] mx-auto px-4 lg:px-6 flex items-center gap-3 lg:gap-5">

        {/* Wortmarke software:112 */}
        <Link href="/dashboard" className="shrink-0 font-display text-[21px] font-light tracking-[.04em] whitespace-nowrap leading-none hover:opacity-90 transition-opacity">
          software<b className="font-bold text-s112-blue-300">:</b>112
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

          {/* Benachrichtigungen */}
          <div className="relative" ref={notifRef}>
            <button
              type="button"
              onClick={() => setNotifOpen(o => !o)}
              className="w-8 h-8 flex items-center justify-center rounded-md text-white/80 hover:bg-white/10 hover:text-white transition-colors"
              aria-label="Benachrichtigungen"
              title="Benachrichtigungen"
            >
              <Bell size={17} strokeWidth={1.5} />
            </button>
            {notifOpen && (
              <div className="absolute right-0 top-10 z-50 w-64 bg-white rounded-xl border border-s112-line shadow-lg p-3 text-s112-text">
                <p className="text-xs font-semibold mb-1">Benachrichtigungen</p>
                <p className="text-xs text-s112-tertiary">Keine neuen Benachrichtigungen.</p>
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
