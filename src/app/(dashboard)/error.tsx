'use client'

import { useEffect } from 'react'
import { fehlerText } from '@/lib/fehler'
import { BETRIEB_GEWECHSELT_MELDUNG } from '@/lib/tenant/waechter'
import { NUR_LESEN_TITEL, SCHREIBSPERRE_MELDUNG } from '@/lib/abo/regeln'

// Fehlergrenze des Arbeitsbereichs (20.9.2026): statt der weißen Next-Seite eine
// deutsche Meldung mit „Erneut versuchen“; der Fehler wird ans Systemprotokoll
// gemeldet (Migration 222) und erscheint im Systembericht der Super-Admins.
// Betriebswechsel in einem anderen Tab (KAN-30): Die Ablehnung einer Aktion aus einem
// veralteten Tab ist gewollt – kein Systemfehler, daher nicht protokolliert; statt „Erneut
// versuchen“ (reset rendert mit demselben veralteten Stand) wird die Seite neu geladen.
// Nur-Lesen-Modus (KAN-5): Eine Speicheraktion bei gesperrtem Abo ist ebenfalls gewollt
// abgelehnt – kein Systemfehler; Hinweis mit Link zum Abo, „Zurück zur Seite“ rendert neu.
export default function DashboardFehler({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const betriebGewechselt = fehlerText(error, '') === BETRIEB_GEWECHSELT_MELDUNG
  const nurLesen = fehlerText(error, '') === SCHREIBSPERRE_MELDUNG

  useEffect(() => {
    if (betriebGewechselt || nurLesen) return
    const text = fehlerText(error, 'Unbekannter Fehler')
    fetch('/api/system/ereignis', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ meldung: text, digest: error.digest ?? null, pfad: window.location.pathname, name: error.name }),
      keepalive: true,
    }).catch(() => { /* Meldung ist Zusatznutzen */ })
  }, [error, betriebGewechselt, nurLesen])

  if (nurLesen) {
    return (
      <div role="alert" className="max-w-xl mx-auto mt-16 bg-white border border-s112-border rounded-xl p-6">
        <h1 className="text-lg font-semibold text-s112-text mb-2">{NUR_LESEN_TITEL}</h1>
        <p className="text-sm text-s112-text-1 mb-5">
          {SCHREIBSPERRE_MELDUNG} Ansehen, Drucken und Exportieren bleiben möglich.
        </p>
        <div className="flex gap-2 flex-wrap">
          <button type="button" onClick={reset} className="px-4 py-2 rounded-lg bg-s112-teal text-s112-yellow text-sm font-medium hover:opacity-90">Zurück zur Seite</button>
          <a href="/abo" className="px-4 py-2 rounded-lg border border-s112-border text-sm text-s112-text-1 hover:bg-s112-bg">Zum Abo</a>
        </div>
      </div>
    )
  }

  if (betriebGewechselt) {
    return (
      <div role="alert" className="max-w-xl mx-auto mt-16 bg-white border border-s112-border rounded-xl p-6">
        <h1 className="text-lg font-semibold text-s112-text mb-2">Betrieb gewechselt</h1>
        <p className="text-sm text-s112-text-1 mb-5">
          {BETRIEB_GEWECHSELT_MELDUNG} Die Aktion wurde nicht ausgeführt, damit nichts im falschen Betrieb gespeichert wird.
        </p>
        <button type="button" onClick={() => window.location.reload()} className="px-4 py-2 rounded-lg bg-s112-teal text-s112-yellow text-sm font-medium hover:opacity-90">Seite neu laden</button>
      </div>
    )
  }

  const text = fehlerText(error, 'Beim Laden dieser Seite ist ein unerwarteter Fehler aufgetreten.')

  return (
    <div className="max-w-xl mx-auto mt-16 bg-white border border-s112-border rounded-xl p-6">
      <h1 className="text-lg font-semibold text-s112-text mb-2">Da ist etwas schiefgelaufen</h1>
      <p className="text-sm text-s112-text-1 mb-4 break-words">{text}</p>
      <p className="text-xs text-s112-muted mb-5">
        Der Fehler wurde automatisch protokolliert{error.digest ? ` (Kennung ${error.digest.slice(0, 12)})` : ''}. Wenn er wiederholt auftritt, bitte mit Uhrzeit und Seite melden.
      </p>
      <div className="flex gap-2">
        <button type="button" onClick={reset} className="px-4 py-2 rounded-lg bg-s112-teal text-s112-yellow text-sm font-medium hover:opacity-90">Erneut versuchen</button>
        <a href="/dashboard" className="px-4 py-2 rounded-lg border border-s112-border text-sm text-s112-text-1 hover:bg-s112-bg">Zum Dashboard</a>
      </div>
    </div>
  )
}
