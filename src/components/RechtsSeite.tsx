// Rahmen der öffentlichen Rechtsseiten (KAN-300: /agb, /datenschutz, /impressum) – wie /barrierefreiheit,
// ohne App-Rahmen (das Dokument scrollt, kein data-app-rahmen).
import type { ReactNode } from 'react'
import RechtsLinks from '@/components/RechtsLinks'

export default function RechtsSeite({ titel, stand, children }: { titel: string; stand: string; children: ReactNode }) {
  return (
    <main id="inhalt" className="min-h-screen bg-s112-bg px-4 py-10">
      <div className="max-w-2xl mx-auto bg-white rounded-xl border border-s112-line p-6 sm:p-8 space-y-5 text-sm text-s112-text leading-relaxed">
        <div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/software112-logo.svg" alt="software:112" className="h-9 w-auto mb-4" />
          <h1 className="text-2xl font-semibold">{titel}</h1>
          <p className="text-s112-text-2 mt-1">Stand: {stand}</p>
        </div>
        {children}
        <p className="pt-2 border-t border-s112-line text-xs text-s112-text-2">
          <RechtsLinks />
        </p>
      </div>
    </main>
  )
}

/** Abschnitt mit Überschrift */
export function Abschnitt({ titel, children }: { titel: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="text-base font-semibold">{titel}</h2>
      {children}
    </section>
  )
}
