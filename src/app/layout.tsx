import type { Metadata, Viewport } from 'next'

// Design-System 2026-08: Poppins (Wortmarke/Überschriften), IBM Plex Sans (UI/Fließtext),
// IBM Plex Mono (Zahlen/Belegnummern) — löst Inter ab, siehe project_design_relaunch.md.
//
// Selbst gehostet über @fontsource (Schriftdateien liegen im npm-Paket, kein
// Live-Fetch von fonts.gstatic.com beim Build) statt next/font/google — dessen
// build-zeitiger Font-Download ist am 14.8.2026 wiederholt mit 404s von
// Google Fonts fehlgeschlagen und hat den Vercel-Build komplett blockiert.
// Die CSS-Variablen --font-poppins/--font-plex-sans/--font-plex-mono werden
// dafür statisch in globals.css gesetzt (siehe dort).
import '@fontsource/poppins/latin-600.css'
import '@fontsource/poppins/latin-700.css'
import '@fontsource/ibm-plex-sans/latin-400.css'
import '@fontsource/ibm-plex-sans/latin-500.css'
import '@fontsource/ibm-plex-sans/latin-600.css'
import '@fontsource/ibm-plex-mono/latin-400.css'
import '@fontsource/ibm-plex-mono/latin-500.css'
import './globals.css'
import ServiceWorker from '@/components/pwa/ServiceWorker'

export const metadata: Metadata = {
  title: {
    default: 'software:112',
    template: '%s | software:112',
  },
  description: 'Vom Rebstock bis zur Rechnung. Alles in einem System.',
  icons: {
    icon: [
      { url: '/favicon.svg', type: 'image/svg+xml' },
      { url: '/favicon-32.png', sizes: '32x32', type: 'image/png' },
      { url: '/favicon-16.png', sizes: '16x16', type: 'image/png' },
    ],
    apple: '/favicon-180.png',
    shortcut: '/favicon.ico',
  },
  // KAN-179: als App installierbar – das Manifest (app/manifest.ts) verlinkt Next selbst; hier iOS „Zum Home-Bildschirm“ im Vollbild
  appleWebApp: {
    capable: true,
    title: 'software:112',
    statusBarStyle: 'default',
  },
  applicationName: 'software:112',
}

// Next 16: themeColor gehört in viewport, nicht mehr in metadata.
export const viewport: Viewport = {
  themeColor: '#4F86D6',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="de">
      <body>
        {children}
        {/* KAN-180: Service Worker (Offline-Seite, Hinweis auf neue Version) – nur Produktion */}
        <ServiceWorker />
      </body>
    </html>
  )
}
