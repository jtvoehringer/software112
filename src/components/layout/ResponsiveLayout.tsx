'use client'

import { useState, useEffect } from 'react'
import { usePathname } from 'next/navigation'
import { Menu, X } from 'lucide-react'
import Sidebar from './Sidebar'
import GlobalSearch from '@/components/GlobalSearch'
import type { UserRole } from '@/lib/auth/roles'
import type { TenantBranding } from '@/app/(dashboard)/layout'

interface Props {
  children: React.ReactNode
  userEmail: string
  userName?: string
  betriebCount?: number
  role: UserRole
  roleLabel: string
  branding: TenantBranding
}

export default function ResponsiveLayout({ children, userEmail, userName, role, roleLabel, branding, betriebCount = 1 }: Props) {
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const pathname = usePathname()

  // Collapsed-State aus localStorage wiederherstellen
  useEffect(() => {
    const stored = localStorage.getItem('s112_sidebar_collapsed')
    if (stored === 'true') setSidebarCollapsed(true)
  }, [])

  const handleToggleCollapse = () => {
    setSidebarCollapsed(prev => {
      const next = !prev
      localStorage.setItem('s112_sidebar_collapsed', String(next))
      return next
    })
  }

  // Drawer beim Navigieren schließen
  useEffect(() => {
    setDrawerOpen(false)
  }, [pathname])

  // Body-Scroll sperren wenn Drawer offen
  useEffect(() => {
    if (drawerOpen) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => { document.body.style.overflow = '' }
  }, [drawerOpen])

  const sidebarProps = { userEmail, userName, role, roleLabel, branding, betriebCount }

  return (
    <div className="flex h-screen bg-s112-bg overflow-hidden">

      {/* ── Desktop Sidebar (ab lg sichtbar) ────────────────────────── */}
      <div className="hidden lg:flex flex-shrink-0">
        <Sidebar {...sidebarProps} collapsed={sidebarCollapsed} onToggleCollapse={handleToggleCollapse} />
      </div>

      {/* ── Mobile Drawer Overlay ────────────────────────────────────── */}
      {drawerOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/40 lg:hidden"
          onClick={() => setDrawerOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* ── Mobile Drawer (Slide-in von links) ───────────────────────── */}
      <div
        className={`
          fixed inset-y-0 left-0 z-50 lg:hidden flex flex-col
          transform transition-transform duration-200 ease-in-out
          ${drawerOpen ? 'translate-x-0' : '-translate-x-full'}
        `}
      >
        {/* Schließen-Button: nur wenn Drawer offen */}
        {drawerOpen && (
          <div className="absolute top-3 right-[-44px]">
            <button
              onClick={() => setDrawerOpen(false)}
              className="w-9 h-9 flex items-center justify-center bg-white rounded-full shadow text-gray-500 hover:text-gray-800"
              aria-label="Menü schließen"
            >
              <X size={18} strokeWidth={1.75} />
            </button>
          </div>
        )}
        <Sidebar {...sidebarProps} />
      </div>

      {/* ── Haupt-Inhalt ─────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col overflow-hidden">

        {/* Top-Bar (Desktop: Suche; Mobile: Hamburger + Brand + Suche) */}
        <header className="flex items-center gap-3 px-3 lg:px-6 py-2 bg-white border-b border-s112-border flex-shrink-0">
          {/* Mobile: Hamburger */}
          <button
            onClick={() => setDrawerOpen(true)}
            className="lg:hidden flex items-center justify-center w-11 h-11 rounded-xl bg-s112-bg active:bg-s112-border text-gray-700 transition-colors"
            aria-label="Menü öffnen"
          >
            <Menu size={22} strokeWidth={1.75} />
          </button>

          {/* Mobile: Brand */}
          <div className="lg:hidden flex items-baseline gap-0">
            {branding.logo_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={branding.logo_url} alt={branding.anzeigename} className="h-7 w-auto object-contain" />
            ) : (
              <>
                <span className="text-lg font-bold text-s112-teal">software</span>
                <span className="text-lg font-bold text-s112-yellow">:</span>
                <span className="text-lg font-bold text-s112-teal">112</span>
              </>
            )}
          </div>

          {/* Spacer */}
          <div className="flex-1" />

          {/* Globale Suche */}
          <GlobalSearch />
        </header>

        {/* Content */}
        <main className="flex-1 overflow-y-auto">
          <div className="max-w-7xl mx-auto p-4 sm:p-6 lg:p-8">
            {children}
          </div>
        </main>
      </div>

    </div>
  )
}
