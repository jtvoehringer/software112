'use client'

import Link from 'next/link'
import Image from 'next/image'
import { useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'
import type { UserRole } from '@/lib/auth/roles'
import type { TenantBranding } from '@/app/(dashboard)/layout'

// ── Navigationsstruktur ────────────────────────────────────────────

type NavItem = {
  href: string; label: string; phase?: number; adminOnly?: boolean; child?: boolean
  hideIfModul?: Array<'modul_ea' | 'modul_fibu' | 'modul_sumup'>
}
type NavGroup = {
  kind: 'group'; label: string; icon: string; items: NavItem[]; adminOnly?: boolean
  modulKey?: 'modul_ea' | 'modul_fibu' | 'modul_sumup'
}
type NavLink = {
  kind: 'link'; href: string; label: string; icon: string
  phase?: number; adminOnly?: boolean
  modulKey?: 'modul_ea' | 'modul_fibu' | 'modul_sumup'
}
type NavEntry = NavGroup | NavLink

const NAV: NavEntry[] = [
  { kind: 'link',  href: '/dashboard',   label: 'Übersicht', icon: '⊞' },
  { kind: 'link',  href: '/nachrichten', label: 'E-Mail',    icon: '📬' },

  {
    kind: 'group', label: 'Rieden', icon: '🌿',
    items: [
      { href: '/weingarten',         label: 'Rieden',         phase: 1 },
      { href: '/pflanzenschutz',     label: 'PSM-Stammdaten', phase: 1 },
      { href: '/behandlungen',       label: 'Behandlungen',   phase: 1 },
      { href: '/behandlungen/lager', label: 'PSM-Lager',      phase: 1, child: true },
      { href: '/erntemeldung',       label: 'Lese',           phase: 1 },
    ],
  },

  {
    kind: 'group', label: 'Kellerbuch', icon: '🍷',
    items: [
      { href: '/kellerbuch',                  label: 'Übersicht',      phase: 1 },
      { href: '/kellerbuch/gebinde',          label: 'Gebinde',        phase: 1, child: true },
      { href: '/kellerbuch/weinausbau',        label: 'Chargen',        phase: 1, child: true },
      { href: '/kellerbuch/kellerplan',       label: 'Kellerplan',     phase: 1 },
      { href: '/dac',                         label: 'Prüfnummer',     phase: 1 },
      { href: '/kellerbuch/rueckverfolgung',  label: 'Rückverfolgung', phase: 1 },
    ],
  },

  {
    kind: 'group', label: 'Warenwirtschaft', icon: '🛒',
    items: [
      { href: '/weinhandel',              label: 'Warenlager',  phase: 1 },
      { href: '/weinhandel/verkauf',        label: 'Verkauf',       phase: 1 },
      { href: '/weinhandel/offene-posten',  label: 'Offene Posten',  phase: 1 },
      { href: '/weinhandel/zukauf',          label: 'Zukauf',         phase: 1 },
      { href: '/weinhandel/sonstige-artikel', label: 'Sonstiges-Produkte', phase: 1 },
      { href: '/weinhandel/preisliste',    label: 'Preisliste',     phase: 1 },
      { href: '/weinhandel/rabattgruppen', label: 'Rabattgruppen',  phase: 1 },
      { href: '/weinexport',               label: 'Exportaufträge' },
    ],
  },

  {
    kind: 'group', label: 'Controlling', icon: '🧮',
    items: [
      { href: '/controlling/export',        label: 'Datenexport' },
      { href: '/controlling/bmd',           label: 'BMD NTCS'         },
      { href: '/controlling/kostenrechnung',label: 'Kostenrechnung'   },
    ],
  },

  {
    kind: 'group', label: 'E&A-Rechnung', icon: '📒', modulKey: 'modul_ea',
    items: [
      { href: '/buchhaltung',              label: 'Buchungen'         },
      { href: '/buchhaltung/kategorien',   label: 'Kategorien', child: true },
      { href: '/buchhaltung/dauerauftraege', label: 'Daueraufträge', child: true },
      { href: '/buchhaltung/uva',          label: 'UVA-Meldung'      },
      { href: '/weinhandel/offene-posten', label: 'Offene Posten'    },
    ],
  },

  {
    kind: 'group', label: 'FIBU', icon: '📘', modulKey: 'modul_fibu',
    items: [
      { href: '/fibu',              label: 'Journal'        },
      { href: '/fibu/kontenplan',   label: 'Kontenplan', child: true },
      { href: '/weinhandel/offene-posten', label: 'Offene Posten'    },
    ],
  },

  {
    kind: 'group', label: 'CRM', icon: '👥',
    items: [
      { href: '/crm',           label: 'Kalender'  },
      { href: '/crm/kontakte',  label: 'Kontakte'  },
      { href: '/crm/kontakte/visitkarte', label: 'Visitenkarte scannen', child: true },
      { href: '/crm/firmen',    label: 'Firmen'    },
      { href: '/crm/pipeline',  label: 'Pipeline'  },
    ],
  },

  { kind: 'link', href: '/reports', label: 'Auswertungen', icon: '📊' },
  { kind: 'link', href: '/ki',      label: 'Frag dein Weingut', icon: '🤖' },

  {
    kind: 'group', label: 'Hilfe', icon: '❓',
    items: [
      { href: '/hilfe/handbuch', label: 'Handbuch' },
      { href: '/hilfe/faq',     label: 'FAQ'      },
    ],
  },

  {
    kind: 'group', label: 'Administration', icon: '⚙️', adminOnly: true,
    items: [
      { href: '/admin/mandanten',   label: 'Mandanten' },
      { href: '/admin/release-notes', label: 'Release Notes' },
      { href: '/admin/import',      label: 'Datenimport' },
      { href: '/admin/benutzer',    label: 'System-Admin', adminOnly: true },
      { href: '/admin/onboarding',  label: 'Onboarding Guide', adminOnly: true },
      { href: '/admin/zeiterfassung', label: 'Zeiterfassung',      adminOnly: true },
    ],
  },
]

// ── Hilfsfunktionen ───────────────────────────────────────────────

// Paths that only match exactly (no prefix-matching for sub-routes)
const EXACT_PATHS = new Set(['/dashboard', '/crm', '/weinhandel', '/auswertungen', '/kellerbuch', '/reports', '/behandlungen'])

function isActive(href: string, pathname: string) {
  return pathname === href || (!EXACT_PATHS.has(href) && pathname.startsWith(href))
}

function groupIsActive(items: NavItem[], pathname: string) {
  return items.some(i => isActive(i.href, pathname))
}

// ── Sub-Item ──────────────────────────────────────────────────────────────

function SubItem({ item, pathname }: { item: NavItem; pathname: string }) {
  const active = isActive(item.href, pathname)
  const phase2 = item.phase === 2
  const indent = item.child

  if (phase2) {
    return (
      <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg opacity-40 cursor-not-allowed text-sm ${indent ? 'ml-3' : ''}`}>
        <span className={`rounded-full bg-gray-300 ml-1 ${indent ? 'w-1 h-1' : 'w-1.5 h-1.5'}`} />
        <span className="text-gray-500">{item.label}</span>
        <span className="ml-auto text-xs text-gray-400">P2</span>
      </div>
    )
  }

  return (
    <Link
      href={item.href}
      className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm transition-colors ${indent ? 'ml-3' : ''} ${active ? 'bg-s112-teal text-s112-yellow font-medium' : 'text-s112-teal hover:bg-s112-teal/10'}`}
    >
      <span className={`rounded-full flex-shrink-0 ${indent ? 'w-1 h-1' : 'w-1.5 h-1.5'} ${active ? 'bg-s112-yellow' : 'bg-s112-teal/40'}`} />
      {item.label}
    </Link>
  )
}

// ── Gruppe ────────────────────────────────────────────────────────────────────────

function NavGroupItem({
  entry, pathname, isAdmin,
}: {
  entry: NavGroup; pathname: string; isAdmin: boolean
}) {
  const active = groupIsActive(entry.items, pathname)
  const [open, setOpen] = useState(active)
  const router = useRouter()

  const visibleItems = entry.items.filter(i => !i.adminOnly || isAdmin)

  return (
    <div>
      <button
        onClick={() => {
          const firstItem = entry.items.filter(i => !i.adminOnly || isAdmin).find(i => i.phase !== 2)
          if (firstItem && !active) router.push(firstItem.href)
          setOpen(o => !o)
        }}
        className={`w-full flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium transition-colors ${active ? 'text-s112-teal font-semibold' : 'text-s112-teal hover:bg-s112-teal/10'}`}
      >
        <span className="w-5 text-center text-base">{entry.icon}</span>
        <span className="flex-1 text-left">{entry.label}</span>
        <svg
          className={`w-3.5 h-3.5 text-s112-teal transition-transform ${open ? 'rotate-90' : ''}`}
          fill="none" stroke="currentColor" viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
      </button>

      {open && (
        <div className="ml-4 mt-0.5 space-y-0.5 border-l-2 border-s112-border pl-2">
          {visibleItems.map(item => (
            <SubItem key={item.href} item={item} pathname={pathname} />
          ))}
        </div>
      )}
    </div>
  )
}

// ── Haupt-Sidebar ────────────────────────────────────────────────────────────────

interface SidebarProps {
  userEmail: string
  userName?: string
  role: UserRole
  roleLabel: string
  branding: TenantBranding
  betriebCount?: number
  collapsed?: boolean
  onToggleCollapse?: () => void
}

export default function Sidebar({ userEmail, userName, role, roleLabel, branding, betriebCount = 1, collapsed = false, onToggleCollapse }: SidebarProps) {
  const pathname = usePathname()
  const router   = useRouter()
  const supabase = createSupabaseBrowserClient()
  const isAdmin  = role === 'system_admin' || role === 'tenant_admin'

  const handleLogout = async () => {
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  return (
    <aside className={`flex-shrink-0 bg-white border-r border-s112-border flex flex-col h-full transition-[width] duration-200 ease-in-out ${collapsed ? 'w-14' : 'w-60'}`}>
      {/* Kunden-Logo + Collapse-Toggle */}
      <div className={`border-b border-s112-border flex items-center ${collapsed ? 'px-2 py-4 justify-center' : 'px-5 py-4 justify-between'}`}>
        {!collapsed && (
          <Link href="/dashboard" className="block min-w-0">
            {branding.logo_url ? (
              <Image
                src={branding.logo_url}
                alt={branding.anzeigename}
                width={140} height={40}
                className="object-contain object-left max-h-10 w-auto"
                priority
              />
            ) : (
              <div className="flex items-baseline gap-0">
                <span className="text-xl font-bold text-s112-teal">software</span>
                <span className="text-xl font-bold text-s112-yellow">:</span>
                <span className="text-xl font-bold text-s112-teal">112</span>
              </div>
            )}
            <p className="text-xs text-s112-muted mt-0.5 truncate">{branding.logo_url ? branding.anzeigename : 'Weinbau-Management'}</p>
          </Link>
        )}
        {collapsed && (
          <Link href="/dashboard" title="Übersicht">
            <span className="text-xl font-bold text-s112-teal">⊞</span>
          </Link>
        )}
        {onToggleCollapse && (
          <button
            onClick={onToggleCollapse}
            title={collapsed ? 'Sidebar aufklappen' : 'Sidebar einklappen'}
            className={`flex-shrink-0 p-1 rounded-lg text-s112-muted hover:text-s112-teal hover:bg-s112-teal/10 transition-colors ${collapsed ? 'mt-2' : ''}`}
          >
            <svg className={`w-4 h-4 transition-transform duration-200 ${collapsed ? 'rotate-180' : ''}`}
              fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 19l-7-7 7-7M18 19l-7-7 7-7" />
            </svg>
          </button>
        )}
      </div>

      {/* Navigation */}
      <nav className={`flex-1 py-4 space-y-1 overflow-y-auto ${collapsed ? 'px-1.5' : 'px-3'}`}>
        {NAV.map((entry, i) => {
          if (entry.kind === 'group') {
            if (entry.adminOnly && !isAdmin) return null
            if (entry.modulKey && !branding[entry.modulKey]) return null
            const filteredItems = entry.items.filter(it =>
              !it.hideIfModul?.some(m => branding[m as keyof TenantBranding])
            )
            const filteredEntry = { ...entry, items: filteredItems }
            if (collapsed) {
              // Im Collapsed-Modus: nur Icon als Link zum ersten Sub-Item
              const firstItem = filteredItems.filter(it => !it.adminOnly || isAdmin).find(it => it.phase !== 2)
              const isGroupActive = groupIsActive(filteredItems, pathname)
              if (!firstItem) return null
              return (
                <Link key={i} href={firstItem.href} title={entry.label}
                  className={`flex items-center justify-center w-10 h-10 rounded-xl text-base transition-colors mx-auto ${isGroupActive ? 'bg-s112-teal text-white' : 'text-s112-teal hover:bg-s112-teal/10'}`}>
                  {entry.icon}
                </Link>
              )
            }
            return (
              <NavGroupItem key={i} entry={filteredEntry} pathname={pathname} isAdmin={isAdmin} />
            )
          }

          // Einzel-Link
          if (entry.adminOnly && !isAdmin) return null
          if (entry.modulKey && !branding[entry.modulKey]) return null
          const active   = isActive(entry.href, pathname)
          const disabled = entry.phase === 2

          if (disabled) {
            if (collapsed) return null
            return (
              <div key={entry.href} className="flex items-center gap-2 px-3 py-2 rounded-xl opacity-40 cursor-not-allowed text-sm text-gray-500">
                <span className="w-5 text-center">{entry.icon}</span>
                {entry.label}
                <span className="ml-auto text-xs">P2</span>
              </div>
            )
          }

          if (collapsed) {
            return (
              <Link key={entry.href} href={entry.href} title={entry.label}
                className={`flex items-center justify-center w-10 h-10 rounded-xl text-base transition-colors mx-auto ${active ? 'bg-s112-teal text-white' : 'text-s112-teal hover:bg-s112-teal/10'}`}>
                <span>{entry.icon}</span>
              </Link>
            )
          }

          return (
            <Link
              key={entry.href}
              href={entry.href}
              className={`flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium transition-colors ${active ? 'bg-s112-teal text-s112-yellow' : 'text-s112-teal hover:bg-s112-teal/10'}`}
            >
              <span className="w-5 text-center">{entry.icon}</span>
              {entry.label}
            </Link>
          )
        })}
      </nav>

      {/* User Footer */}
      <div className={`border-t border-s112-border ${collapsed ? 'px-1.5 py-4 flex flex-col items-center gap-2' : 'px-4 py-4'}`}>
        {collapsed ? (
          <>
            <button onClick={handleLogout} title="Abmelden"
              className="w-10 h-10 flex items-center justify-center rounded-xl text-s112-muted hover:text-red-600 hover:bg-red-50 transition-colors text-base">
              ⏻
            </button>
          </>
        ) : (
          <>
            <p className="text-xs font-medium text-gray-700 truncate">{userName || userEmail}</p>
            <p className="text-[10px] text-s112-muted truncate">{userEmail}</p>
            <p className="text-xs font-medium text-s112-teal mt-0.5">{roleLabel}</p>
            <a href="/profil"
              className="text-xs text-s112-muted hover:text-s112-teal transition-colors mt-1.5 block">
              ✏ Profil bearbeiten
            </a>
            {betriebCount > 1 && (
              <a href="/betrieb-waehlen"
                className="text-xs text-s112-teal hover:underline transition-colors mt-1.5 block">
                ⇄ Betrieb wechseln
              </a>
            )}
            <button
              onClick={handleLogout}
              className="text-xs text-s112-muted hover:text-red-600 transition-colors mt-1.5"
            >
              Abmelden
            </button>

            <p className="text-[10px] text-gray-400 mt-2">
              v2.2.1 · Juni 2026
              {process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA && (
                <span className="ml-1 opacity-60">· {process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA.slice(0, 7)}</span>
              )}
            </p>
            {/* IC&P Branding */}
            <div className="mt-2 pt-2 border-t border-s112-border/40 flex items-center gap-2">
              <Image
                src="/icp-logo.png"
                alt="IC&P Consultants"
                width={20} height={20}
                className="rounded-full opacity-60 flex-shrink-0"
              />
              <p className="text-[9px] text-s112-muted/50 leading-tight">
                &copy; IC&amp;P Consultants e.U.
              </p>
            </div>
          </>
        )}
      </div>
    </aside>
  )
}
