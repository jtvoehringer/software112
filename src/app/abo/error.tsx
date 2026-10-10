'use client'

import { useEffect } from 'react'
import { fehlerText } from '@/lib/fehler'

// Sweep 86 (KAN-278): Fehlergrenze der Abo-Seite (liegt außerhalb des Arbeitsbereichs) – bei einem Lesefehler eine
// deutsche Meldung statt „kein Abo“; gemeldet ans Systemprotokoll wie im Arbeitsbereich.
export default function AboFehler({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    fetch('/api/system/ereignis', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ meldung: fehlerText(error, 'Unbekannter Fehler'), digest: error.digest ?? null, pfad: window.location.pathname, name: error.name }),
      keepalive: true,
    }).catch(() => { /* Meldung ist Zusatznutzen */ })
  }, [error])

  return (
    <div role="alert" className="max-w-xl mx-auto mt-16 bg-white border border-s112-border rounded-xl p-6">
      <h1 className="text-lg font-semibold text-s112-text mb-2">Abo konnte nicht geladen werden</h1>
      <p className="text-sm text-s112-text-1 mb-5">Die Daten zu Abo und Zahlung sind gerade nicht lesbar. Bitte in einigen Minuten erneut versuchen.</p>
      <button type="button" onClick={reset} className="px-4 py-2 rounded-lg bg-s112-teal text-s112-yellow text-sm font-medium hover:opacity-90">Erneut versuchen</button>
    </div>
  )
}
