'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'

const NAV_ITEMS = [
  { href: '/dashboard',    label: 'Übersicht',   icon: '⊞' },
  { href: '/weingarten',   label: 'Weingarten',  icon: '🌿' },
  { href: '/kellerbuch',   label: 'Kellerbuch',  icon: '🍷' },
  { href: '/dac',          label: 'DAC',         icon: '📋' },
  { href: '/weinhandel',   label: 'Weinhandel',  icon: '🛒' },
  { href: '/reports',      label: 'Reports',     icon: '📁' },
]

interface SidebarProps {
  userEmail: string
}

export default function Sidebar({ userEmail }: SidebarProps) {
  const pathname = usePathname()
  const router   = useRouter()
  const supabase = createSupabaseBrowserClient()

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
      <nav className="flex-1 px-3 py-4 space-y-1">
        {NAV_ITEMS.map(item => {
          const isActive = pathname === item.href ||
            (item.href !== '/dashboard' && pathname.startsWith(item.href))
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
        <p className="text-xs text-s112-muted truncate mb-2">{userEmail}</p>
        <button
          onClick={handleLogout}
          className="text-xs text-s112-muted hover:text-red-600 transition-colors"
        >
          Abmelden
        </button>
      </div>
    </aside>
  )
}
