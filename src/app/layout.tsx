import type { Metadata, Viewport } from 'next'
import { Poppins, IBM_Plex_Sans, IBM_Plex_Mono } from 'next/font/google'
import './globals.css'

// Design-System 2026-08: Poppins (Wortmarke/Überschriften), IBM Plex Sans (UI/Fließtext),
// IBM Plex Mono (Zahlen/Belegnummern) — löst Inter ab, siehe project_design_relaunch.md.
const poppins = Poppins({
  subsets: ['latin'],
  weight: ['600', '700'],
  variable: '--font-poppins',
  display: 'swap',
  preload: false,
})
const plexSans = IBM_Plex_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-plex-sans',
  display: 'swap',
  preload: false,
})
const plexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-plex-mono',
  display: 'swap',
  preload: false,
})

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
    <html lang="de" className={`${poppins.variable} ${plexSans.variable} ${plexMono.variable}`}>
      <body>{children}</body>
    </html>
  )
}
