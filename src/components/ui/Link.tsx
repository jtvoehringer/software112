'use client'
// ── Link ohne Vorabladen (Performance, 17.9.2026) ─────────────────────────────
// next/link lädt jeden sichtbaren Link im Voraus (Nav, Listen mit hunderten
// Zeilen). Da alle Seiten dynamisch sind, führt jedes Vorabladen zu einem
// Serverless-Aufruf inkl. Layout-Datenbankabfragen - in den Vercel-Logs
// tauchten beim Öffnen einer Seite 10–20 weitere Seitenrenderings auf, bei
// der Kontaktliste je sichtbarer Zeile eines. Deshalb hier prefetch={false}
// als Standard; einzelne Links können prefetch explizit wieder einschalten.
//
// Rückmeldung 17.9.2026 ("man glaubt, der Klick war erfolglos"): jeder Klick
// auf einen Link meldet den Beginn der Navigation (Ereignis s112:navigation),
// der Ladebalken unter der Kopfzeile (components/NavigationsBalken.tsx) läuft,
// bis die neue Seite da ist. LinkSpinner zeigt zusätzlich direkt am geklickten
// Link ein drehendes Symbol (Nav-Tabs).
import NextLink, { useLinkStatus } from 'next/link'
import type { ComponentProps } from 'react'
import { KREISEL_FARBE } from '@/components/ui/Kreisel'

export const NAVIGATION_EVENT = 's112:navigation'

export default function Link({ onNavigate, ...props }: ComponentProps<typeof NextLink>) {
  return (
    <NextLink
      prefetch={false}
      {...props}
      onNavigate={e => {
        let verhindert = false
        if (onNavigate) onNavigate({ preventDefault: () => { verhindert = true; e.preventDefault() } })
        if (!verhindert && typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent(NAVIGATION_EVENT, { detail: { href: String(props.href) } }))
        }
      }}
    />
  )
}

/** Drehendes Symbol, solange die Navigation dieses Links läuft (nur innerhalb eines <Link>); KAN-399: immer CD-Blau. */
export function LinkSpinner({ className = '' }: { className?: string }) {
  const { pending } = useLinkStatus()
  if (!pending) return null
  return (
    <span
      aria-hidden
      className={`inline-block w-3 h-3 rounded-full border-2 border-current border-r-transparent animate-spin align-[-1px] ${KREISEL_FARBE} ${className}`}
    />
  )
}

/** KAN-399: Link einer Breadcrumb-Leiste – mit demselben blauen Kreisel wie die Tabs, bis die Seite da ist */
export function BrotkrumenLink({ children, ...props }: ComponentProps<typeof NextLink>) {
  return (
    <Link {...props}>
      {children}
      <LinkSpinner className="ml-1" />
    </Link>
  )
}
