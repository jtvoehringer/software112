import Link from '@/components/ui/Link'

// Zeitraum von–bis als GET-Formular (searchParams von/bis, 'JJJJ-MM-TT'). Dieselben
// Parameter gehen 1:1 an die CSV (/meldungen/<id>/csv?von=…&bis=…). Ohne Angabe gilt der
// gesamte Zeitraum. Weitere Parameter der Seite (z. B. tab) über `versteckt` mitgeben.
export default function ZeitraumFormular({
  von,
  bis,
  zuruecksetzen,
  versteckt = {},
  className = '',
}: {
  von: string | null
  bis: string | null
  /** Link ohne Zeitraum (Zurücksetzen) */
  zuruecksetzen: string
  versteckt?: Record<string, string>
  className?: string
}) {
  const feld = 'border border-s112-border rounded-lg px-2.5 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-s112-teal/40'
  return (
    <form method="get" className={`flex flex-wrap items-end gap-2 print:hidden ${className}`}>
      {Object.entries(versteckt).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      <label className="text-xs text-s112-text-2">
        <span className="block mb-0.5 font-medium">Von</span>
        <input type="date" name="von" defaultValue={von ?? ''} aria-label="Zeitraum von" className={feld} />
      </label>
      <label className="text-xs text-s112-text-2">
        <span className="block mb-0.5 font-medium">Bis</span>
        <input type="date" name="bis" defaultValue={bis ?? ''} aria-label="Zeitraum bis" className={feld} />
      </label>
      <button type="submit" className="text-xs border border-s112-teal text-s112-blue-700 px-3 py-1.5 rounded-lg hover:bg-s112-teal/5 font-medium">
        Zeitraum anzeigen
      </button>
      {(von || bis) && (
        <Link href={zuruecksetzen} className="text-xs text-s112-muted hover:text-s112-blue-700 py-1.5">Gesamter Zeitraum</Link>
      )}
    </form>
  )
}
