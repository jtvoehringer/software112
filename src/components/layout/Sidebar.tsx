'use client'

import Link from 'next/link'
import Image from 'next/image'
import { useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'
import type { UserRole } from '@/lib/auth/roles'
import type { TenantBranding } from '@/app/(dashboard)/layout'
import {
  LayoutDashboard, Grape, BookOpen, Warehouse, Calculator, ReceiptText,
  Users, BarChart3, Sparkles, HelpCircle, Settings, ChevronRight,
  ArrowLeftRight, LogOut, PanelLeftClose, PanelLeft,
  type LucideIcon,
} from 'lucide-react'

// ── Navigationsstruktur ────────────────────────────────────────────
// Icon-Zuordnung folgt der Design-System-Regel (siehe project_design_relaunch.md,
// Phase B): Icons nur auf Gruppen-/Top-Level-Ebene, 18px, stroke-width 1.5, keine
// Icons in Untermenüpunkten oder Textbuttons.

type ModulKey = 'modul_ea' | 'modul_sumup' | 'modul_export'
type NavItem = {
  href: string; label: string; phase?: number; adminOnly?: boolean; child?: boolean
  hideIfModul?: Array<ModulKey>
  // Gegenstück zu hideIfModul: Item nur zeigen, wenn dieses Modul aktiv ist
  // (z.B. Exportaufträge - anders als E&A/SumUp kein eigener Gruppen-Header,
  // daher hier auf Item-Ebene statt via NavGroup.modulKey).
  requireModul?: ModulKey
}
type NavGroup = {
  kind: 'group'; label: string; icon: LucideIcon; items: NavItem[]; adminOnly?: boolean
  modulKey?: ModulKey
}
type NavLink = {
  kind: 'link'; href: string; label: string; icon: LucideIcon
  phase?: number; adminOnly?: boolean
  modulKey?: ModulKey
}
type NavOverline = { kind: 'overline'; label: string }
type NavEntry = NavGroup | NavLink | NavOverline

const NAV: NavEntry[] = [
  { kind: 'link',  href: '/dashboard',   label: 'Übersicht', icon: LayoutDashboard },

  {
    kind: 'group', label: 'Rieden', icon: Grape,
    items: [
      { href: '/weingarten',         label: 'Rieden',         phase: 1 },
      { href: '/behandlungen',       label: 'Maßnahmen',      phase: 1 },
      { href: '/behandlungen/lager', label: 'Betriebsmittel', phase: 1 },
      { href: '/erntemeldung',       label: 'Lese',           phase: 1 },
    ],
  },

  {
    kind: 'group', label: 'Kellerbuch', icon: BookOpen,
    items: [
      { href: '/kellerbuch',                  label: 'Übersicht',      phase: 1 },
      { href: '/kellerbuch/kellerplan',       label: 'Kellerplan',     phase: 1 },
      { href: '/dac',                         label: 'Prüfnummer',     phase: 1 },
      { href: '/kellerbuch/rueckverfolgung',  label: 'Rückverfolgung', phase: 1 },
    ],
  },

  {
    kind: 'group', label: 'Warenwirtschaft', icon: Warehouse,
    items: [
      { href: '/weinhandel',              label: 'Warenlager',  phase: 1 },
      { href: '/weinhandel/verkauf',        label: 'Verkauf',       phase: 1 },
      { href: '/weinhandel/offene-posten',  label: 'Offene Posten',  phase: 1 },
      { href: '/weinhandel/zukauf',          label: 'Zukauf',         phase: 1 },
      { href: '/weinhandel/sonstige-artikel', label: 'Sonstiges-Produkte', phase: 1 },
      { href: '/weinhandel/rabattgruppen', label: 'Rabattgruppen',  phase: 1 },
      { href: '/weinexport',               label: 'Exportaufträge', requireModul: 'modul_export' },
    ],
  },

  {
    kind: 'group', label: 'CRM', icon: Users,
    items: [
      { href: '/nachrichten',  label: 'E-Mail'    },
      { href: '/crm',           label: 'Kalender'  },
      { href: '/crm/kontakte',  label: 'Kontakte'  },
      { href: '/crm/kontakte/visitkarte', label: 'Visitenkarte scannen', child: true },
      { href: '/crm/firmen',    label: 'Firmen'    },
      { href: '/crm/pipeline',  label: 'Pipeline'  },
    ],
  },

  {
    kind: 'group', label: 'E&A-Rechnung', icon: ReceiptText, modulKey: 'modul_ea',
    items: [
      { href: '/buchhaltung',              label: 'Buchungen'         },
      { href: '/buchhaltung/kategorien',   label: 'Kategorien', child: true },
      { href: '/buchhaltung/dauerauftraege', label: 'Daueraufträge', child: true },
      { href: '/buchhaltung/uva',          label: 'UVA-Meldung'      },
      { href: '/weinhandel/offene-posten', label: 'Offene Posten'    },
      { href: '/controlling/bmd',          label: 'BMD NTCS'         },
    ],
  },

  {
    kind: 'group', label: 'Controlling', icon: Calculator,
    items: [
      { href: '/controlling/export',        label: 'Datenexport' },
      { href: '/controlling/kostenrechnung',label: 'Kostenrechnung'   },
    ],
  },

  { kind: 'link', href: '/reports', label: 'Auswertungen', icon: BarChart3 },
  { kind: 'link', href: '/ki',      label: 'Frag dein Weingut', icon: Sparkles },

  { kind: 'overline', label: 'System' },

  {
    kind: 'group', label: 'Hilfe', icon: HelpCircle,
    items: [
      { href: '/hilfe/handbuch', label: 'Handbuch' },
      { href: '/hilfe/faq',     label: 'FAQ'      },
    ],
  },

  {
    kind: 'group', label: 'Administration', icon: Settings, adminOnly: true,
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

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

// ── Overline (Gruppen-Kategorie) ───────────────────────────────────────────

function Overline({ label }: { label: string }) {
  return (
    <p className="px-2.5 py-1.5 mt-2 first:mt-0 text-[10px] font-semibold uppercase tracking-[.14em] text-s112-tertiary">
      {label}
    </p>
  )
}

// ── Sub-Item ──────────────────────────────────────────────────────────────

function SubItem({ item, pathname }: { item: NavItem; pathname: string }) {
  const active = isActive(item.href, pathname)
  const phase2 = item.phase === 2
  const indent = item.child

  if (phase2) {
    return (
      <div className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg opacity-40 cursor-not-allowed text-sm ${indent ? 'ml-3' : ''}`}>
        <span className={`rounded-full bg-gray-300 ml-1 ${indent ? 'w-1 h-1' : 'w-1.5 h-1.5'}`} />
        <span className="text-gray-500">{item.label}</span>
        <span className="ml-auto text-xs text-gray-400">P2</span>
      </div>
    )
  }

  return (
    <Link
      href={item.href}
      className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[13.5px] transition-colors duration-[120ms] ease-out ${indent ? 'ml-3' : ''} ${
        active
          ? 'bg-s112-blue-50 text-s112-blue-700 font-semibold'
          : 'text-s112-text-1 hover:bg-s112-bg hover:text-s112-text'
      }`}
    >
      <span className={`rounded-full flex-shrink-0 ${indent ? 'w-1 h-1' : 'w-1.5 h-1.5'} ${active ? 'bg-s112-blue-700' : 'bg-s112-tertiary/60'}`} />
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
  const Icon = entry.icon

  const visibleItems = entry.items.filter(i => !i.adminOnly || isAdmin)

  return (
    <div>
      <button
        onClick={() => {
          // Klick auf den Modul-Header springt immer auf die Hauptseite des
          // Moduls (erstes Sub-Item) – analog zu allen Modulen, unabhängig
          // davon, ob man sich bereits auf einer Unterseite dieses Moduls
          // befindet (vorher: Sprung nur, wenn das Modul noch nicht aktiv war).
          const firstItem = entry.items.filter(i => !i.adminOnly || isAdmin).find(i => i.phase !== 2)
          if (firstItem) router.push(firstItem.href)
          setOpen(o => !o)
        }}
        className={`w-full flex items-center gap-[11px] px-2.5 py-[9px] rounded-lg text-[13.5px] font-medium transition-colors duration-[120ms] ease-out ${
          active
            ? 'bg-s112-blue-50 text-s112-blue-700 font-semibold'
            : 'text-s112-text-1 hover:bg-s112-bg hover:text-s112-text'
        }`}
      >
        <Icon size={18} strokeWidth={1.5} className="flex-shrink-0" />
        <span className="flex-1 text-left">{entry.label}</span>
        <ChevronRight
          size={14} strokeWidth={1.75}
          className={`flex-shrink-0 transition-transform duration-[120ms] ${open ? 'rotate-90' : ''}`}
        />
      </button>

      {open && (
        <div className="ml-4 mt-0.5 space-y-0.5 border-l-2 border-s112-line pl-2">
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
  const displayName = userName || userEmail
  const [userMenuOpen, setUserMenuOpen] = useState(false)

  const handleLogout = async () => {
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  return (
    <aside className={`flex-shrink-0 bg-s112-surface border-r border-s112-line flex flex-col h-full transition-[width] duration-200 ease-in-out ${collapsed ? 'w-16' : 'w-56'}`}>
      {/* Logo-Lockup + Collapse-Toggle */}
      <div className={`border-b border-s112-line flex items-center ${collapsed ? 'px-2 py-4 justify-center' : 'px-3.5 py-4 justify-between'}`}>
        {!collapsed && (
          <Link href="/dashboard" className="flex items-center gap-2.5 min-w-0">
            {branding.logo_url ? (
              <Image
                src={branding.logo_url}
                alt={branding.anzeigename}
                width={140} height={40}
                className="object-contain object-left max-h-10 w-auto"
                priority
              />
            ) : (
              <>
                <span className="flex-shrink-0 w-[30px] h-[30px] rounded-lg bg-s112-teal flex items-center justify-center">
                  <span className="font-display font-bold text-[11px] text-s112-yellow tracking-[-.02em]">112</span>
                </span>
                <span className="font-display font-semibold text-[15px] text-s112-text truncate">software:112</span>
              </>
            )}
          </Link>
        )}
        {collapsed && (
          <Link href="/dashboard" title="Übersicht" className="w-[30px] h-[30px] rounded-lg bg-s112-teal flex items-center justify-center">
            <span className="font-display font-bold text-[11px] text-s112-yellow tracking-[-.02em]">112</span>
          </Link>
        )}
        {onToggleCollapse && (
          <button
            onClick={onToggleCollapse}
            title={collapsed ? 'Sidebar aufklappen' : 'Sidebar einklappen'}
            className={`flex-shrink-0 p-1 rounded-lg text-s112-text-2 hover:text-s112-blue-700 hover:bg-s112-blue-50 transition-colors ${collapsed ? 'mt-2' : ''}`}
          >
            {collapsed ? <PanelLeft size={16} strokeWidth={1.5} /> : <PanelLeftClose size={16} strokeWidth={1.5} />}
          </button>
        )}
      </div>

      {/* Navigation */}
      <nav className={`flex-1 py-3 space-y-0.5 overflow-y-auto ${collapsed ? 'px-1.5' : 'px-2.5'}`}>
        {NAV.map((entry, i) => {
          if (entry.kind === 'overline') {
            if (collapsed) return null
            return <Overline key={`ol-${i}`} label={entry.label} />
          }

          if (entry.kind === 'group') {
            if (entry.adminOnly && !isAdmin) return null
            if (entry.modulKey && !branding[entry.modulKey]) return null
            const filteredItems = entry.items.filter(it =>
              !it.hideIfModul?.some(m => branding[m as keyof TenantBranding]) &&
              (!it.requireModul || branding[it.requireModul as keyof TenantBranding])
            )
            const filteredEntry = { ...entry, items: filteredItems }
            const Icon = entry.icon
            if (collapsed) {
              // Im Collapsed-Modus: nur Icon als Link zum ersten Sub-Item
              const firstItem = filteredItems.filter(it => !it.adminOnly || isAdmin).find(it => it.phase !== 2)
              const isGroupActive = groupIsActive(filteredItems, pathname)
              if (!firstItem) return null
              return (
                <Link key={i} href={firstItem.href} title={entry.label}
                  className={`flex items-center justify-center w-10 h-10 rounded-lg transition-colors mx-auto ${isGroupActive ? 'bg-s112-blue-50 text-s112-blue-700' : 'text-s112-text-1 hover:bg-s112-bg hover:text-s112-text'}`}>
                  <Icon size={18} strokeWidth={1.5} />
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
          const Icon = entry.icon

          if (disabled) {
            if (collapsed) return null
            return (
              <div key={entry.href} className="flex items-center gap-[11px] px-2.5 py-[9px] rounded-lg opacity-40 cursor-not-allowed text-[13.5px] text-gray-500">
                <Icon size={18} strokeWidth={1.5} />
                {entry.label}
                <span className="ml-auto text-xs">P2</span>
              </div>
            )
          }

          if (collapsed) {
            return (
              <Link key={entry.href} href={entry.href} title={entry.label}
                className={`flex items-center justify-center w-10 h-10 rounded-lg transition-colors mx-auto ${active ? 'bg-s112-blue-50 text-s112-blue-700' : 'text-s112-text-1 hover:bg-s112-bg hover:text-s112-text'}`}>
                <Icon size={18} strokeWidth={1.5} />
              </Link>
            )
          }

          return (
            <Link
              key={entry.href}
              href={entry.href}
              className={`flex items-center gap-[11px] px-2.5 py-[9px] rounded-lg text-[13.5px] font-medium transition-colors duration-[120ms] ease-out ${
                active
                  ? 'bg-s112-blue-50 text-s112-blue-700 font-semibold'
                  : 'text-s112-text-1 hover:bg-s112-bg hover:text-s112-text'
              }`}
            >
              <Icon size={18} strokeWidth={1.5} />
              {entry.label}
            </Link>
          )
        })}
      </nav>

      {/* User Footer */}
      <div className={`border-t border-s112-line ${collapsed ? 'px-1.5 py-4 flex flex-col items-center gap-2' : 'px-2.5 py-3'}`}>
        {collapsed ? (
          <button onClick={handleLogout} title="Abmelden"
            className="w-10 h-10 flex items-center justify-center rounded-lg text-s112-text-2 hover:text-red-600 hover:bg-red-50 transition-colors">
            <LogOut size={18} strokeWidth={1.5} />
          </button>
        ) : (
          <>
            <button
              type="button"
              onClick={() => setUserMenuOpen(o => !o)}
              aria-expanded={userMenuOpen}
              title={userMenuOpen ? 'Weniger anzeigen' : 'Mehr anzeigen'}
              className="w-full rounded-[10px] bg-s112-bg p-2.5 flex items-center gap-2.5 hover:bg-s112-line/60 transition-colors"
            >
              <span className="flex-shrink-0 w-7 h-7 rounded-full bg-s112-grey text-white flex items-center justify-center text-[11px] font-semibold">
                {initials(displayName)}
              </span>
              <div className="min-w-0 flex-1 text-left">
                <p className="text-[12.5px] font-semibold text-s112-text truncate">{displayName}</p>
                {userMenuOpen && (
                  <p className="text-[11px] text-s112-tertiary truncate">{roleLabel}</p>
                )}
              </div>
              <ChevronRight size={13} strokeWidth={1.75}
                className={`flex-shrink-0 text-s112-tertiary transition-transform ${userMenuOpen ? 'rotate-90' : ''}`} />
            </button>

            {userMenuOpen && (
              <>
                <a href="/profil"
                  className="text-xs text-s112-text-1 hover:text-s112-blue-700 transition-colors mt-2 block">
                  Profil bearbeiten
                </a>
                {betriebCount > 1 && (
                  <a href="/betrieb-waehlen"
                    className="text-xs text-s112-text-1 hover:text-s112-blue-700 transition-colors mt-1.5 flex items-center gap-1">
                    <ArrowLeftRight size={12} strokeWidth={1.75} />
                    Betrieb wechseln
                  </a>
                )}
                <button
                  onClick={handleLogout}
                  className="text-xs text-s112-text-1 hover:text-red-600 transition-colors mt-1.5"
                >
                  Abmelden
                </button>

                <p className="text-[10px] text-s112-tertiary mt-2">
                  v2.2.1 · Juni 2026
                  {process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA && (
                    <span className="ml-1 opacity-60">· {process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA.slice(0, 7)}</span>
                  )}
                </p>
                {/* ICP-Branding */}
                <div className="mt-2 pt-2 border-t border-s112-line flex items-center gap-1.5">
                  <span className="text-[9px] text-s112-tertiary flex-shrink-0">&copy;</span>
                  <Image
                    src="/icp-logo.png"
                    alt="ICP Solutions"
                    width={41} height={14}
                    className="object-contain object-left opacity-70 hover:opacity-100 transition-opacity"
                  />
                </div>
              </>
            )}
          </>
        )}
      </div>
    </aside>
  )
}
