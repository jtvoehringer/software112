'use client'

import { useState, useEffect } from 'react'
import { usePathname } from 'next/navigation'
import Sidebar from './Sidebar'
import type { UserRole } from '@/lib/auth/roles'
import type { TenantBranding } from '@/app/(dashboard)/layout'

interface Props {
  children: React.ReactNode
  userEmail: string
  role: UserRole
  roleLabel: string
  branding: TenantBranding
}

export default function ResponsiveLayout({ children, userEmail, role, roleLabel, branding }: Props) {
  const [drawerOpen, setDrawerOpen] = useState(false)
  const pathname = usePathname()

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

  const sidebarProps = { userEmail, role, roleLabel, branding }

  return (
    <div className="flex h-screen bg-s112-bg overflow-hidden">

      {/* ── Desktop Sidebar (ab lg sichtbar) ────────────────────────── */}
      <div className="hidden lg:flex flex-shrink-0">
        <Sidebar {...sidebarProps} />
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
          transform transition-transform duration-250 ease-in-out
          ${drawerOpen ? 'translate-x-0' : '-translate-x-full'}
        `}
      >
        {/* Schließen-Button oben rechts am Drawer */}
        <div className="absolute top-3 right-[-40px]">
          <button
            onClick={() => setDrawerOpen(false)}
            className="w-9 h-9 flex items-center justify-center bg-white rounded-full shadow text-gray-500 hover:text-gray-800"
            aria-label="Menü schließen"
          >
            ✕
          </button>
        </div>
        <Sidebar {...sidebarProps} />
      </div>

      {/* ── Haupt-Inhalt ─────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col overflow-hidden">

        {/* Mobile Top-Bar */}
        <header className="lg:hidden flex items-center gap-3 px-4 py-3 bg-white border-b border-s112-border flex-shrink-0">
          <button
            onClick={() => setDrawerOpen(true)}
            className="p-2 rounded-lg hover:bg-s112-bg text-gray-600 hover:text-gray-900 transition-colors"
            aria-label="Menü öffnen"
          >
            {/* Hamburger Icon */}
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>

          {/* Brand */}
          <div className="flex items-baseline gap-0">
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
