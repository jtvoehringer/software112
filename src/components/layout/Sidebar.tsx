'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'
import type { UserRole } from '@/lib/auth/roles'

const NAV_ITEMS = [
  { href: '/dashboard',   label: 'Übersicht',  icon: '⊞', phase: 0 },
  { href: '/lagen',       label: 'Lagen',      icon: '🗺', phase: 1 },
  { href: '/weingarten',  label: 'Weingarten', icon: '🌿', phase: 1 },
  { href: '/kellerbuch',  label: 'Kellerbuch', icon: '🍷', phase: 1 },
  { href: '/dac',         label: 'DAC',        icon: '📋', phase: 1 },
  { href: '/weinhandel',  label: 'Weinhandel', icon: '🛒', phase: 2 },
  { href: '/reports',     label: 'Reports',    icon: '📁', phase: 2 },
  { href: '/benutzer',    label: 'Benutzer',   icon: '👥', phase: 0, adminOnly: true },
]

interface SidebarProps {
  userEmail: string
  role: UserRole
  roleLabel: string
}

export default function Sidebar({ userEmail, role, roleLabel }: SidebarProps) {
  const pathname = usePathname()
  const router   = useRouter()
  const supabase = createSupabaseBrowserClient()

  const handleLogout = async () => {
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  const isAdmin = role === 'system_admin' || role === 'tenant_admin'

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
      <nav className="flex-1 px-3 py-4 space-y-1">
        {NAV_ITEMS.map(item => {
          if (item.adminOnly && !isAdmin) return null
          const isActive = pathname === item.href ||
            (item.href !== '/dashboard' && pathname.startsWith(item.href))
          const isDisabled = item.phase === 2

          if (isDisabled) return (
            <div key={item.href} className="nav-item opacity-40 cursor-not-allowed">
              <span className="w-5 text-center">{item.icon}</span>
              {item.label}
              <span className="ml-auto text-xs">P2</span>
            </div>
          )

          return (
            <Link
              key={item.href}
              href={item.href}
              className={`nav-item ${isActive ? 'active' : ''}`}
            >
              <span className="w-5 text-center">{item.icon}</span>
              {item.label}
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
