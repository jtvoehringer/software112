// Generisches Lade-Skelett für loading.tsx (Performance, 17.9.2026): Next zeigt
// es sofort beim Navigieren, während die Server-Komponente noch Daten lädt -
// die Seite fühlt sich deutlich schneller an, obwohl die Ladezeit gleich bleibt.
// Varianten: 'tabelle' (Titel, Kennzahlen, Zeilen) und 'zweispaltig'
// (Liste links, Detail rechts - z.B. Nachrichten).
export default function SeitenSkeleton({ variante = 'tabelle', zeilen = 8, kennzahlen = 3 }: {
  variante?: 'tabelle' | 'zweispaltig'; zeilen?: number; kennzahlen?: number
}) {
  if (variante === 'zweispaltig') {
    return (
      <div className="flex gap-4 animate-pulse min-h-[60vh]">
        <div className="w-56 space-y-2">
          {[...Array(8)].map((_, i) => <div key={i} className="h-7 bg-[#F2F3F5] rounded-lg" />)}
        </div>
        <div className="w-80 space-y-2">
          {[...Array(zeilen)].map((_, i) => (
            <div key={i} className="border border-s112-border rounded-xl p-3 space-y-1.5">
              <div className="h-3 w-32 bg-s112-line rounded-sm" />
              <div className="h-3 w-56 bg-[#F2F3F5] rounded-sm" />
              <div className="h-3 w-40 bg-[#F2F3F5] rounded-sm" />
            </div>
          ))}
        </div>
        <div className="flex-1 card p-6 space-y-3">
          <div className="h-6 w-2/3 bg-s112-line rounded-sm" />
          <div className="h-3 w-1/2 bg-[#F2F3F5] rounded-sm" />
          <div className="h-px bg-s112-border my-2" />
          {[...Array(6)].map((_, i) => <div key={i} className="h-3 bg-[#F2F3F5] rounded-sm" style={{ width: `${90 - i * 9}%` }} />)}
        </div>
      </div>
    )
  }
  return (
    <div className="space-y-4 animate-pulse">
      <div className="flex items-center justify-between">
        <div className="space-y-1.5">
          <div className="h-8 w-44 bg-s112-line rounded-lg" />
          <div className="h-3 w-64 bg-[#F2F3F5] rounded-sm" />
        </div>
        <div className="h-9 w-32 bg-s112-line rounded-lg" />
      </div>
      {kennzahlen > 0 && (
        <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${kennzahlen}, minmax(0, 1fr))` }}>
          {[...Array(kennzahlen)].map((_, i) => (
            <div key={i} className="card p-4 space-y-1.5">
              <div className="h-3 w-20 bg-[#F2F3F5] rounded-sm" />
              <div className="h-7 w-24 bg-s112-line rounded-sm" />
            </div>
          ))}
        </div>
      )}
      <div className="card overflow-hidden">
        <div className="flex gap-4 px-4 py-3 border-b border-s112-border">
          {[...Array(5)].map((_, i) => <div key={i} className="h-3 flex-1 bg-s112-line rounded-sm" />)}
        </div>
        {[...Array(zeilen)].map((_, i) => (
          <div key={i} className="flex gap-4 px-4 py-3 border-b border-s112-border/50 last:border-0">
            {[...Array(5)].map((_, j) => <div key={j} className="h-4 flex-1 bg-[#F2F3F5] rounded-sm" />)}
          </div>
        ))}
      </div>
    </div>
  )
}
