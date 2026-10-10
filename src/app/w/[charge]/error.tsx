'use client'

// Sweep 89 (KAN-281): Fehlerseite des öffentlichen Weinpasses – bei einem Lesefehler kein „nicht gefunden“ und kein
// unvollständiger Pass, sondern ein Hinweis (Deutsch und Englisch, ohne Tracking und ohne Protokoll-Aufruf: unangemeldete Seite).
export default function WeinpassFehler({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="min-h-screen bg-s112-bg flex items-start sm:items-center justify-center p-4">
      <main role="alert" className="w-full max-w-md bg-white rounded-xl shadow-xl px-6 py-8 space-y-3 text-sm text-s112-text-2">
        <p lang="de">Der Weinpass ist vorübergehend nicht verfügbar. Bitte versuchen Sie es in einigen Minuten erneut.</p>
        <p lang="en">This wine passport is temporarily unavailable. Please try again in a few minutes.</p>
        <button type="button" onClick={reset} className="text-s112-blue-700 hover:underline">Erneut versuchen / Try again</button>
      </main>
    </div>
  )
}
