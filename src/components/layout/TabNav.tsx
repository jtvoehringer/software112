'use client'

// ── Horizontale Hauptnavigation (Dashboard-Relaunch 27.8.2026) ────────────────
// Zeile 1: Bereiche als Tabs mit Unterstrich in der Aktionsfarbe (s112-teal,
// per Mandant überschreibbar). Zeile 2: Seiten des aktiven Bereichs als Chips.
// Beide Zeilen scrollen auf schmalen Bildschirmen horizontal – ein Mobile-
// Drawer ist damit nicht mehr nötig.

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { activeGroup, isActivePath, type NavGroup } from '@/lib/navigation'

export default function TabNav({ groups }: { groups: NavGroup[] }) {
  const pathname = usePathname()
  const aktiv = activeGroup(groups, pathname)

  return (
    <nav className="bg-s112-surface border-b border-s112-line shrink-0 z-30" aria-label="Hauptnavigation">
      {/* Zeile 1: Bereiche */}
      <div className="max-w-[1280px] mx-auto px-2 lg:px-3 flex gap-0.5 overflow-x-auto [scrollbar-width:none]">
        {groups.map(g => {
          const active = g.key === aktiv?.key
          return (
            <Link
              key={g.key}
              href={g.items[0].href}
              aria-current={active ? 'true' : undefined}
              className={`px-3.5 pt-[13px] pb-[10px] text-[14.5px] whitespace-nowrap border-b-[3px] transition-colors duration-[120ms] ${
                active
                  ? 'text-s112-text font-semibold border-s112-teal'
                  : 'text-s112-text-1 font-medium border-transparent hover:text-s112-text'
              }`}
            >
              {g.label}
            </Link>
          )
        })}
      </div>

      {/* Zeile 2: Seiten des aktiven Bereichs */}
      {aktiv && (
        <div className="border-t border-s112-line bg-s112-bg/70">
          <div className="max-w-[1280px] mx-auto px-3 lg:px-4 py-1.5 flex gap-1 overflow-x-auto [scrollbar-width:none]">
            {aktiv.items.map(item => {
              const active = isActivePath(item.href, pathname)
                // Bei mehreren passenden Items (z.B. /kellerbuch vs. /kellerbuch/kellerplan)
                // nur das längste als aktiv markieren
                && !aktiv.items.some(o => o !== item && o.href.length > item.href.length && isActivePath(o.href, pathname))
              const disabled = item.phase === 2
              if (disabled) {
                return (
                  <span key={item.href} className="inline-flex items-center px-2.5 py-[5px] rounded-md text-[13px] whitespace-nowrap opacity-40 cursor-not-allowed">
                    {item.label} <span className="ml-1 text-[10px]">P2</span>
                  </span>
                )
              }
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? 'page' : undefined}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-[5px] rounded-md text-[13px] whitespace-nowrap transition-colors duration-[120ms] ${item.child ? 'ml-[-2px] text-[12.5px]' : ''} ${
                    active
                      ? 'bg-s112-blue-50 text-s112-blue-700 font-semibold'
                      : 'text-s112-text-1 hover:bg-s112-line/60 hover:text-s112-text'
                  }`}
                >
                  {item.child && <span className="w-1 h-1 rounded-full bg-s112-tertiary/70" />}
                  {item.label}
                </Link>
              )
            })}
          </div>
        </div>
      )}
    </nav>
  )
}
