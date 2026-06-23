import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
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
    icon: '/favicon.ico',
    apple: '/favicon-192.png',
    shortcut: '/favicon.ico',
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="de" className={inter.variable}>
      <body>{children}</body>
    </html>
  )
}
