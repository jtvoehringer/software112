'use client'

import Link from 'next/link'
import { useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'
import type { UserRole } from '@/lib/auth/roles'

// ── Navigationsstruktur ───────────────────────────────────────────────────────

type NavItem = {
  href: string; label: string; phase?: number; adminOnly?: boolean
}
type NavGroup = {
  kind: 'group'; label: string; icon: string; items: NavItem[]
}
type NavLink = {
  kind: 'link'; href: string; label: string; icon: string
  phase?: number; adminOnly?: boolean
}
type NavEntry = NavGroup | NavLink

const NAV: NavEntry[] = [
  { kind: 'link',  href: '/dashboard', label: 'Übersicht', icon: '⊞' },

  {
    kind: 'group', label: 'Weingarten', icon: '🌿',
    items: [
      { href: '/lagen',        label: 'Lagen',         phase: 1 },
      { href: '/weingarten',   label: 'Weingärten',    phase: 1 },
      { href: '/behandlungen', label: 'Behandlungen',  phase: 1 },
      { href: '/erntemeldung', label: 'Erntemeldung',  phase: 2 },
    ],
  },

  {
    kind: 'group', label: 'Kellerbuch', icon: '🍷',
    items: [
      { href: '/kellerbuch', label: 'Vinifizierung',  phase: 1 },
      { href: '/dac',        label: 'DAC & Prüfnr.',  phase: 1 },
      { href: '/umziehen',   label: 'Umziehen',       phase: 2 },
    ],
  },

  { kind: 'link', href: '/weinhandel', label: 'Weinhandel', icon: '🛒', phase: 2 },
  { kind: 'link', href: '/reports',    label: 'Reports',    icon: '📁', phase: 2 },
  { kind: 'link', href: '/benutzer',   label: 'Benutzer',   icon: '👥', adminOnly: true },
]

// ── Hilfsfunktionen ───────────────────────────────────────────────────────────

function isActive(href: string, pathname: string) {
  return pathname === href || (href !== '/dashboard' && pathname.startsWith(href))
}

function groupIsActive(items: NavItem[], pathname: string) {
  return items.some(i => isActive(i.href, pathname))
}

// ── Sub-Item ──────────────────────────────────────────────────────────────────

function SubItem({ item, pathname }: { item: NavItem; pathname: string }) {
  const active  = isActive(item.href, pathname)
  const phase2  = item.phase === 2

  if (phase2) {
    return (
      <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg opacity-40 cursor-not-allowed text-sm">
        <span className="w-1.5 h-1.5 rounded-full bg-gray-300 ml-1" />
        <span className="text-gray-500">{item.label}</span>
        <span className="ml-auto text-xs text-gray-400">P2</span>
      </div>
    )
  }

  return (
    <Link
      href={item.href}
      className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm transition-colors
        ${active
          ? 'bg-s112-teal/10 text-s112-teal font-medium'
          : 'text-gray-600 hover:bg-s112-bg hover:text-gray-900'
        }`}
    >
      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${active ? 'bg-s112-teal' : 'bg-gray-300'}`} />
      {item.label}
    </Link>
  )
}

// ── Gruppe ────────────────────────────────────────────────────────────────────

function NavGroupItem({
  entry, pathname, isAdmin,
}: {
  entry: NavGroup; pathname: string; isAdmin: boolean
}) {
  const active = groupIsActive(entry.items, pathname)
  const [open, setOpen] = useState(active)

  const visibleItems = entry.items.filter(i => !i.adminOnly || isAdmin)

  return (
    <div>
      <button
        onClick={() => setOpen(o => !o)}
        className={`w-full flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium transition-colors
          ${active ? 'text-s112-teal' : 'text-gray-700 hover:bg-s112-bg hover:text-gray-900'}`}
      >
        <span className="w-5 text-center text-base">{entry.icon}</span>
        <span className="flex-1 text-left">{entry.label}</span>
        <svg
          className={`w-3.5 h-3.5 text-gray-400 transition-transform ${open ? 'rotate-90' : ''}`}
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

// ── Haupt-Sidebar ─────────────────────────────────────────────────────────────

interface SidebarProps {
  userEmail: string
  role: UserRole
  roleLabel: string
}

export default function Sidebar({ userEmail, role, roleLabel }: SidebarProps) {
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
    <aside className="w-60 flex-shrink-0 bg-white border-r border-s112-border flex flex-col">
      {/* Logo */}
      <div className="px-6 py-5 border-b border-s112-border">
        <Link href="/dashboard" className="flex items-baseline gap-0">
          <span className="text-xl font-bold text-s112-teal">software</span>
          <span className="text-xl font-bold text-s112-yellow">:</span>
          <span className="text-xl font-bold text-s112-teal">112</span>
        </Link>
        <p className="text-xs text-s112-muted mt-0.5">Weinbau-Management</p>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
        {NAV.map((entry, i) => {
          if (entry.kind === 'group') {
            return (
              <NavGroupItem key={i} entry={entry} pathname={pathname} isAdmin={isAdmin} />
            )
          }

          // Einzel-Link
          if (entry.adminOnly && !isAdmin) return null
          const active   = isActive(entry.href, pathname)
          const disabled = entry.phase === 2

          if (disabled) return (
            <div key={entry.href} className="flex items-center gap-2 px-3 py-2 rounded-xl opacity-40 cursor-not-allowed text-sm text-gray-500">
              <span className="w-5 text-center">{entry.icon}</span>
              {entry.label}
              <span className="ml-auto text-xs">P2</span>
            </div>
          )

          return (
            <Link
              key={entry.href}
              href={entry.href}
              className={`flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium transition-colors
                ${active ? 'bg-s112-teal text-white' : 'text-gray-700 hover:bg-s112-bg hover:text-gray-900'}`}
            >
              <span className="w-5 text-center">{entry.icon}</span>
              {entry.label}
            </Link>
          )
        })}
      </nav>

      {/* User Footer */}
      <div className="px-4 py-4 border-t border-s112-border">
        <p className="text-xs text-s112-muted truncate">{userEmail}</p>
        <p className="text-xs font-medium text-s112-teal mt-0.5">{roleLabel}</p>
        <button
          onClick={handleLogout}
          className="text-xs text-s112-muted hover:text-red-600 transition-colors mt-2"
        >
          Abmelden
        </button>
      </div>
    </aside>
  )
}
