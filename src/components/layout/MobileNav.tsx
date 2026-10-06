'use client'

// ── Mobilmenü (KAN-181, 01.10.2026) ─────────────────────────────────────────────
// Unter 768 px (Tailwind md) ersetzt ein Menü von links die erste Zeile der Tab-Navigation (Bereiche): alle
// Bereiche als aufklappbare Liste, der aktive Bereich ist offen. Geöffnet über den Menü-Knopf der Kopfleiste
// (Ereignis MOBILNAV_EVENT, wie die Befehlspalette). Dieselben Gruppen wie TabNav und Befehlspalette
// (buildNav in AppShell) – Rollen-, Modul- und Sandbox-Regeln gelten damit unverändert.
// Tippflächen mindestens 44 px hoch; schließt bei Seitenwechsel, Escape und Tipp auf den Hintergrund.

import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import { ChevronDown, X } from 'lucide-react'
import Link from '@/components/ui/Link'
import { activeGroup, isActivePath, type NavGroup } from '@/lib/navigation'

export const MOBILNAV_EVENT = 's112:mobilnav'

export default function MobileNav({ groups }: { groups: NavGroup[] }) {
  const pathname = usePathname()
  const aktiv = activeGroup(groups, pathname)
  const [offen, setOffen] = useState(false)
  const [aufgeklappt, setAufgeklappt] = useState<string | null>(null)

  useEffect(() => {
    const oeffnen = () => { setAufgeklappt(activeGroup(groups, window.location.pathname)?.key ?? null); setOffen(true) }
    window.addEventListener(MOBILNAV_EVENT, oeffnen)
    return () => window.removeEventListener(MOBILNAV_EVENT, oeffnen)
  }, [groups])

  // Seitenwechsel schließt das Menü
  const [letzterPfad, setLetzterPfad] = useState(pathname)
  if (letzterPfad !== pathname) { setLetzterPfad(pathname); setOffen(false) }

  useEffect(() => {
    if (!offen) return
    const taste = (e: KeyboardEvent) => { if (e.key === 'Escape') setOffen(false) }
    window.addEventListener('keydown', taste)
    return () => window.removeEventListener('keydown', taste)
  }, [offen])

  if (!offen) return null
  return (
    <div className="md:hidden">
      <div className="fixed inset-0 z-60 bg-black/40" onClick={() => setOffen(false)} aria-hidden="true" />
      <nav aria-label="Hauptnavigation (mobil)"
        className="fixed inset-y-0 left-0 z-61 w-[85vw] max-w-[320px] bg-white shadow-xl flex flex-col">
        <div className="h-14 shrink-0 flex items-center justify-between px-4 border-b border-s112-line">
          <span className="font-display text-[18px] font-light tracking-[.04em] text-s112-text">software<b className="font-semibold">:</b>112</span>
          <button type="button" onClick={() => setOffen(false)} aria-label="Menü schließen"
            className="w-11 h-11 -mr-2 flex items-center justify-center rounded-lg text-s112-text-1 hover:bg-s112-bg">
            <X size={22} strokeWidth={1.75} />
          </button>
        </div>
        <ul className="flex-1 overflow-y-auto py-2">
          {groups.map(g => {
            const Icon = g.icon
            const auf = aufgeklappt === g.key
            const istAktiv = g.key === aktiv?.key
            return (
              <li key={g.key}>
                <button type="button" onClick={() => setAufgeklappt(auf ? null : g.key)} aria-expanded={auf}
                  className={`w-full min-h-[48px] flex items-center gap-3 px-4 text-left text-[15px] ${istAktiv ? 'font-semibold text-s112-text' : 'font-medium text-s112-text-1'}`}>
                  <Icon size={19} strokeWidth={1.75} className={istAktiv ? 'text-s112-blue-700' : 'text-s112-tertiary'} />
                  <span className="flex-1">{g.label}</span>
                  <ChevronDown size={17} strokeWidth={1.75} className={`text-s112-tertiary transition-transform ${auf ? 'rotate-180' : ''}`} />
                </button>
                {auf && (
                  <ul className="pb-2">
                    {g.items.map(item => {
                      const aktivItem = isActivePath(item.href, pathname)
                        && !g.items.some(o => o !== item && o.href.length > item.href.length && isActivePath(o.href, pathname))
                      if (item.phase === 2) {
                        return (
                          <li key={item.href} className="min-h-[44px] flex items-center pl-12 pr-4 text-[14.5px] text-s112-tertiary">
                            {item.label} <span className="ml-1 text-[11px]">P2</span>
                          </li>
                        )
                      }
                      return (
                        <li key={item.href}>
                          <Link href={item.href} aria-current={aktivItem ? 'page' : undefined}
                            onClick={() => setOffen(false)}
                            className={`min-h-[44px] flex items-center ${item.child ? 'pl-16' : 'pl-12'} pr-4 text-[14.5px] ${
                              aktivItem ? 'bg-s112-blue-50 text-s112-blue-700 font-semibold' : 'text-s112-text-1 active:bg-s112-bg'
                            }`}>
                            {item.label}
                          </Link>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </li>
            )
          })}
        </ul>
      </nav>
    </div>
  )
}
