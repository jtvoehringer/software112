// ── Ladekreisel (KAN-399, 01.11.2026) ────────────────────────────────────────
// Einheitlich in CD-Blau #2F63AC (s112-blue-700) – fest, nicht die Primärfarbe des Betriebs (Entscheidung Jörgen).
// Für Anmeldung, Zwei-Faktor, Betriebsauswahl, Willkommen; drehende Links (Tabs, Breadcrumbs) über LinkSpinner.

export const KREISEL_FARBE = 'text-s112-blue-700'

/** aufKnopf: auf einem farbigen Knopf (btn-primary) in dessen Schriftfarbe – Blau auf Blau wäre unsichtbar */
export default function Kreisel({ className = 'w-4 h-4', aufKnopf = false }: { className?: string; aufKnopf?: boolean }) {
  return (
    <svg className={`${className} animate-spin shrink-0${aufKnopf ? '' : ` ${KREISEL_FARBE}`}`} fill="none" viewBox="0 0 24 24" aria-hidden="true">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  )
}
