export default function KellerbuchLoading() {
  return (
    <div className="space-y-4 animate-pulse">
      {/* Titel + Stats */}
      <div className="h-8 w-36 bg-gray-200 rounded-lg" />
      <div className="grid grid-cols-3 gap-3">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="card p-4 text-center space-y-1.5">
            <div className="h-8 w-16 bg-gray-200 rounded mx-auto" />
            <div className="h-3 w-24 bg-gray-100 rounded mx-auto" />
          </div>
        ))}
      </div>
      {/* Behälter-Karten */}
      {[...Array(3)].map((_, i) => (
        <div key={i} className="card overflow-hidden">
          {/* Behälter-Header */}
          <div className="flex items-center gap-3 p-4 border-b border-s112-border">
            <div className="w-8 h-8 bg-gray-200 rounded" />
            <div className="flex-1 space-y-1">
              <div className="h-4 w-32 bg-gray-200 rounded" />
              <div className="h-3 w-48 bg-gray-100 rounded" />
            </div>
            <div className="w-40 h-2.5 bg-gray-200 rounded-full" />
          </div>
          {/* Chargen-Zeilen */}
          {[...Array(2)].map((_, j) => (
            <div key={j} className="flex items-center gap-4 px-4 py-3 border-b border-s112-border/50 last:border-0">
              <div className="flex-1 h-4 w-36 bg-gray-100 rounded" />
              <div className="h-4 w-16 bg-gray-100 rounded" />
              <div className="h-5 w-16 bg-gray-100 rounded-full" />
              <div className="h-4 w-24 bg-gray-100 rounded" />
              <div className="h-7 w-20 bg-gray-100 rounded-lg" />
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}
