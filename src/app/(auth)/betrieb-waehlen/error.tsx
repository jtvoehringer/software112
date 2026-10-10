'use client'

import { useEffect } from 'react'
import { fehlerText } from '@/lib/fehler'

// Sweep 89 (KAN-281): Fehlergrenze der Betriebsauswahl – ein Lesefehler hieß bisher „Kein aktiver Betrieb“.
// Gemeldet ans Systemprotokoll wie im Arbeitsbereich.
export default function BetriebWaehlenFehler({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    fetch('/api/system/ereignis', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ meldung: fehlerText(error, 'Unbekannter Fehler'), digest: error.digest ?? null, pfad: window.location.pathname, name: error.name }),
      keepalive: true,
    }).catch(() => { /* Meldung ist Zusatznutzen */ })
  }, [error])

  return (
    <div className="min-h-screen bg-s112-bg flex items-center justify-center p-4">
      <div role="alert" className="w-full max-w-md rounded-xl border border-s112-border bg-white p-6">
        <h1 className="text-lg font-semibold text-s112-text-1">Betriebe konnten nicht geladen werden</h1>
        <p className="mt-2 text-sm text-s112-muted">Deine Betriebe sind gerade nicht lesbar. Bitte in einigen Minuten erneut versuchen.</p>
        <button type="button" onClick={reset} className="mt-5 px-4 py-2 rounded-lg bg-s112-teal text-s112-yellow text-sm font-medium hover:opacity-90">Erneut versuchen</button>
      </div>
    </div>
  )
}
