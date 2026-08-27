'use client'

// ── App-Rahmen aller Dashboard-Seiten (Dashboard-Relaunch 27.8.2026) ─────────
// Ersetzt ResponsiveLayout + Sidebar: Navy-Kopfleiste (Topbar), darunter die
// horizontale Tab-Navigation (TabNav), darunter der scrollende Inhalt mit
// Fußzeile. Befehlspalette (Strg K) und Assistent-Panel bleiben global.
//
// Markenarchitektur lt. hohenstein-CD-Manual: software:112 ist Absender in der
// Kopfzeile, die Dachmarke hohenstein steht im Fußbereich – ergänzt um
// "powered by ICP Solutions" (Auftragnehmer).

import { useMemo } from 'react'
import Image from 'next/image'
import Topbar from './Topbar'
import TabNav from './TabNav'
import AssistantPanel from './AssistantPanel'
import CommandPalette from '@/components/CommandPalette'
import { buildNav } from '@/lib/navigation'
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
  isSandbox?: boolean
  // Sandbox-Sonderfreigabe (siehe isSandboxAdminUnlock in lib/auth/roles.ts) -
  // schaltet ausschließlich die Administrations-Seiten frei, unabhängig von
  // der Rolle. Bereits serverseitig in layout.tsx geprüft.
  sandboxAdminUnlock?: boolean
  /** canWrite(role) – serverseitig ermittelt, steuert die Aktionen der Befehlspalette */
  darfSchreiben?: boolean
}

export const APP_VERSION = 'v2.3.0 · August 2026'

export default function AppShell({
  children, userEmail, userName, role, roleLabel, branding, betriebCount = 1, isSandbox = false, sandboxAdminUnlock = false, darfSchreiben = false,
}: Props) {
  const groups = useMemo(() => buildNav({
    role,
    branding: { modul_ea: branding.modul_ea, modul_sumup: branding.modul_sumup, modul_export: branding.modul_export },
    isSandbox,
    sandboxAdminUnlock,
  }), [role, branding.modul_ea, branding.modul_sumup, branding.modul_export, isSandbox, sandboxAdminUnlock])

  const buildSha = process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-s112-bg">
      <Topbar userEmail={userEmail} userName={userName} roleLabel={roleLabel} branding={branding} betriebCount={betriebCount} />
      <CommandPalette groups={groups} darfSchreiben={darfSchreiben} branding={branding} betriebCount={betriebCount} />
      <TabNav groups={groups} />

      <div className="flex-1 min-h-0 flex overflow-hidden">
        <main className="flex-1 min-w-0 overflow-y-auto">
          <div className="max-w-7xl mx-auto p-4 sm:p-6 lg:p-8">
            {children}
          </div>

          {/* Fußzeile: Dachmarke hohenstein + Auftragnehmer ICP Solutions */}
          <footer className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-6 pt-2">
            <div className="border-t border-s112-line pt-4 flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
              <div className="flex items-center gap-4">
                <Image src="/logos/hohenstein-logo.png" alt="hohenstein consulting solutions" width={480} height={165}
                  className="h-7 w-auto object-contain" />
                <span className="hidden sm:inline text-[11px] text-s112-tertiary">software:112 ist ein Produkt von hohenstein consulting solutions</span>
              </div>
              <div className="flex items-center gap-3 font-mono text-[10.5px] text-s112-tertiary">
                <span className="flex items-center gap-1.5">
                  powered by
                  <Image src="/icp-logo.png" alt="ICP Solutions" width={2000} height={432} className="h-[22px] w-auto object-contain" />
                </span>
                <span className="text-s112-line-str">·</span>
                <span title={buildSha ? `Build ${buildSha}` : undefined}>
                  {APP_VERSION}{buildSha ? ` · ${buildSha.slice(0, 7)}` : ''}
                </span>
              </div>
            </div>
          </footer>
        </main>

        {/* Assistent-Panel (rechts, Design-Phase D – UI-Hülle) */}
        <AssistantPanel />
      </div>
    </div>
  )
}
