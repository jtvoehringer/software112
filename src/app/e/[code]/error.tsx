'use client'

// Sweep 86 (KAN-278): Fehlerseite der öffentlichen E-Label-Seite – bei einem Lesefehler kein Etikett ohne Zutaten oder
// Allergene, sondern ein Hinweis (Deutsch und Englisch, ohne Tracking und ohne Protokoll-Aufruf: unangemeldete Seite).
export default function ElabelFehler({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="min-h-screen bg-s112-bg flex items-start sm:items-center justify-center p-4">
      <main role="alert" className="w-full max-w-md bg-white rounded-xl shadow-xl px-6 py-8 space-y-3 text-sm text-s112-text-2">
        <p lang="de">Das E-Label ist vorübergehend nicht verfügbar. Bitte versuchen Sie es in einigen Minuten erneut.</p>
        <p lang="en">This e-label is temporarily unavailable. Please try again in a few minutes.</p>
        <button type="button" onClick={reset} className="text-s112-blue-700 hover:underline">Erneut versuchen / Try again</button>
      </main>
    </div>
  )
}
