import type { Metadata } from 'next'
import type { ReactNode } from 'react'

// Sweep 115: Seitentitel – die Seite ist eine Client-Komponente und kann selbst keine Metadaten exportieren
export const metadata: Metadata = { title: 'Einladung annehmen' }

export default function Layout({ children }: { children: ReactNode }) {
  return children
}
