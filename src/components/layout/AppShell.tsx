'use client'

// ── App-Rahmen aller Dashboard-Seiten (Dashboard-Relaunch 27.8.2026) ─────────
// Ersetzt ResponsiveLayout + Sidebar: Kopfleiste in CD-Blau (Topbar, KAN-142), darunter die
// horizontale Tab-Navigation (TabNav), darunter der scrollende Inhalt mit
// Fußzeile. Befehlspalette (Strg K) und Assistent-Panel bleiben global.
//
// Markenarchitektur lt. hohenstein-CD-Manual: software:112 ist Absender in der
// Kopfzeile, die Dachmarke hohenstein steht im Fußbereich – ergänzt um
// "powered by ICP Solutions" (Auftragnehmer).

import { Suspense, useMemo } from 'react'
import Image from 'next/image'
import Topbar from './Topbar'
import TabNav from './TabNav'
import MobileNav from './MobileNav'
import AssistantPanel from './AssistantPanel'
import CommandPalette from '@/components/CommandPalette'
import { APP_VERSION } from '@/lib/version'
import ZurueckLeiste from './ZurueckLeiste'
import MeldungsPopup from '@/components/MeldungsPopup'
import { MostgewichtEinheitProvider } from '@/components/wein/MostgewichtEinheit'
import { buildNav } from '@/lib/navigation'
import type { UserRole } from '@/lib/auth/roles'
import type { TenantBranding } from '@/app/(dashboard)/layout'
import type { MostgewichtEinheit } from '@/lib/wein/mostgewicht'

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
  /** canSeeAuswertungen(role) – serverseitig ermittelt (Migration 218) */
  auswertungenSichtbar?: boolean
  /** canWrite(role) – serverseitig ermittelt, steuert die Aktionen der Befehlspalette */
  darfSchreiben?: boolean
  /** Bevorzugte Mostgewicht-Einheit des Betriebs (KAN-128) – für useMostgewichtEinheit() */
  mostgewichtEinheit?: MostgewichtEinheit
}


export default function AppShell({
  children, userEmail, userName, role, roleLabel, branding, betriebCount = 1, isSandbox = false, sandboxAdminUnlock = false, darfSchreiben = false, auswertungenSichtbar = true,
  mostgewichtEinheit = 'kmw',
}: Props) {
  const groups = useMemo(() => buildNav({
    role,
    branding: { modul_ea: branding.modul_ea, modul_sumup: branding.modul_sumup, modul_export: branding.modul_export, modul_controlling: branding.modul_controlling },
    isSandbox,
    sandboxAdminUnlock,
    doppik: branding.buchhaltungsart === 'doppik',
    auswertungenSichtbar,
  }), [role, branding.modul_ea, branding.modul_sumup, branding.modul_export, branding.modul_controlling, branding.buchhaltungsart, isSandbox, sandboxAdminUnlock, auswertungenSichtbar])

  // KAN-224: Hauptpunkte der Navigation – dort kein „Zurück“
  const navHrefs = useMemo(() => groups.flatMap(g => g.items.map(i => i.href)), [groups])

  const buildSha = process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA

  return (
    // KAN-335/336 (13.10.2026): overflow-clip statt overflow-hidden – ein overflow-hidden-Rahmen ist per Programm scrollbar.
    // Nach „Speichern“ (router.replace) scrollte Next.js mit scrollIntoView auch diesen Rahmen: Kopfleiste und Reiter
    // rutschten aus dem Bild, unten blieb ein leerer Streifen. Gescrollt wird nur in <main>.
    // KAN-370/371/341 (22.10.2026): Höhe 100dvh statt 100vh – am Handy ist 100vh die Höhe ohne Browserleiste, der Rahmen
    // ragte unter die Leiste, und weil das Dokument nicht scrollt, blendet sie sich nie aus: das untere Ende jeder Seite
    // war unerreichbar. h-screen bleibt als Rückfall für Browser ohne dvh. Unten unter md Abstand für die Home-Leiste.
    <div className="h-screen supports-[height:100dvh]:h-dvh flex flex-col overflow-clip bg-s112-bg max-md:pb-[env(safe-area-inset-bottom)]">
      <Topbar userEmail={userEmail} userName={userName} roleLabel={roleLabel} branding={branding} betriebCount={betriebCount} />
      <CommandPalette groups={groups} darfSchreiben={darfSchreiben} branding={branding} betriebCount={betriebCount} />
      <TabNav groups={groups} />
      {/* KAN-181: unter 768 px Bereiche über das Menü (Knopf links in der Kopfleiste) */}
      <MobileNav groups={groups} />

      <div className="flex-1 min-h-0 flex overflow-clip">
        {/* Inhaltsbreite: 1280 px, auf großen Bildschirmen (≥ 1536 px, Tailwind 2xl)
            1600 px (Vergleich mit voller Breite am 18.9.2026: "erschlägt einen"): auf 19–21"-Monitoren bei 100 % blieb
            links und rechts ein Drittel leer. Kopfzeile und Navigation ziehen mit. */}
        {/* KAN-371: waagrecht ausdrücklich scrollbar – Überbreites (Tabellen, Formulare) bleibt verschiebbar; das Dokument
            selbst scrollt seit KAN-335/336 nicht mehr. */}
        <main id="inhalt" tabIndex={-1} className="flex-1 min-w-0 overflow-x-auto overflow-y-auto focus:outline-hidden">
          <div className="max-w-7xl 2xl:max-w-[1600px] mx-auto p-4 sm:p-6 lg:p-8 2xl:py-5">
            {/* KAN-224: „Zurück“ auf Unterseiten und Bestätigung nach dem Abschluss (useSearchParams braucht Suspense) */}
            <Suspense fallback={null}><ZurueckLeiste navHrefs={navHrefs} /></Suspense>
            {/* Bevorzugte Mostgewicht-Einheit für Formulare und Listen der Seiten (KAN-128) */}
            <MostgewichtEinheitProvider einheit={mostgewichtEinheit}>{children}</MostgewichtEinheitProvider>
          </div>

          {/* Fußzeile: Dachmarke hohenstein + Auftragnehmer ICP Solutions */}
          <footer className="max-w-7xl 2xl:max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 pb-6 pt-2 2xl:pb-3 2xl:pt-0">
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
                <a href="/barrierefreiheit" className="font-sans hover:underline">Barrierefreiheit</a>
                <span className="text-s112-line-str">·</span>
                <span title={buildSha ? `Build ${buildSha}` : undefined}>
                  {APP_VERSION}{buildSha ? ` · ${buildSha.slice(0, 7)}` : ''}
                </span>
              </div>
            </div>
          </footer>
        </main>

        {/* KAN-338: neue Fehler/Bestätigungen außer Sicht zusätzlich als Pop-up rechts unten */}
        <MeldungsPopup />
        {/* Assistent-Panel (rechts, Design-Phase D – UI-Hülle) */}
        <AssistantPanel />
      </div>
    </div>
  )
}
