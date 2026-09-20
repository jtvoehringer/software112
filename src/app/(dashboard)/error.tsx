'use client'

import { useEffect } from 'react'
import { fehlerText } from '@/lib/fehler'

// Fehlergrenze des Arbeitsbereichs (20.9.2026): statt der weißen Next-Seite eine
// deutsche Meldung mit „Erneut versuchen“; der Fehler wird ans Systemprotokoll
// gemeldet (Migration 222) und erscheint im Systembericht der Super-Admins.
export default function DashboardFehler({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    const text = fehlerText(error, 'Unbekannter Fehler')
    fetch('/api/system/ereignis', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ meldung: text, digest: error.digest ?? null, pfad: window.location.pathname, name: error.name }),
      keepalive: true,
    }).catch(() => { /* Meldung ist Zusatznutzen */ })
  }, [error])

  const text = fehlerText(error, 'Beim Laden dieser Seite ist ein unerwarteter Fehler aufgetreten.')

  return (
    <div className="max-w-xl mx-auto mt-16 bg-white border border-s112-border rounded-xl p-6">
      <h1 className="text-lg font-semibold text-s112-text mb-2">Da ist etwas schiefgelaufen</h1>
      <p className="text-sm text-s112-text-1 mb-4 break-words">{text}</p>
      <p className="text-xs text-s112-muted mb-5">
        Der Fehler wurde automatisch protokolliert{error.digest ? ` (Kennung ${error.digest.slice(0, 12)})` : ''}. Wenn er wiederholt auftritt, bitte mit Uhrzeit und Seite melden.
      </p>
      <div className="flex gap-2">
        <button type="button" onClick={reset} className="px-4 py-2 rounded-lg bg-s112-teal text-white text-sm font-medium hover:opacity-90">Erneut versuchen</button>
        <a href="/dashboard" className="px-4 py-2 rounded-lg border border-s112-border text-sm text-s112-text-1 hover:bg-s112-bg">Zum Dashboard</a>
      </div>
    </div>
  )
}
