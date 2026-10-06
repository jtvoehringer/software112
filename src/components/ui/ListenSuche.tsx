import Link from '@/components/ui/Link'

// KAN-90: einfache Suche über einer Liste (GET-Formular, Parameter q) – weitere Parameter der Seite bleiben erhalten.
export default function ListenSuche({ q, platzhalter, pfad, behalten = {} }: {
  q: string
  platzhalter: string
  pfad: string
  behalten?: Record<string, string | undefined>
}) {
  return (
    <form method="get" action={pfad} className="flex flex-wrap items-end gap-2">
      {Object.entries(behalten).map(([k, v]) => v ? <input key={k} type="hidden" name={k} value={v} /> : null)}
      <div className="flex-1 min-w-[12rem]">
        <label className="block text-xs font-medium text-s112-text-2 mb-1">Suche</label>
        <input aria-label="Suche" name="q" defaultValue={q} placeholder={platzhalter}
          className="w-full border border-s112-border rounded-lg px-3 py-1.5 text-sm focus:outline-none" />
      </div>
      <button type="submit" className="bg-s112-teal text-s112-yellow px-4 py-1.5 rounded-lg text-sm">Suchen</button>
      {q && (
        <Link href={`${pfad}${Object.values(behalten).some(Boolean) ? '?' + new URLSearchParams(Object.entries(behalten).filter((e): e is [string, string] => !!e[1])).toString() : ''}`}
          className="text-xs text-s112-blue-700 hover:underline py-2">Zurücksetzen</Link>
      )}
    </form>
  )
}
