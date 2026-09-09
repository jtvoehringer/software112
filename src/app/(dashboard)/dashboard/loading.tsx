export default function DashboardLoading() {
  return (
    <div className="space-y-6 animate-pulse">
      {/* Begrüßung */}
      <div className="space-y-1.5">
        <div className="h-8 w-48 bg-s112-line rounded-lg" />
        <div className="h-4 w-64 bg-[#F2F3F5] rounded" />
      </div>

      {/* KPI-Kacheln */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="card p-4 space-y-2">
            <div className="h-3 w-20 bg-[#F2F3F5] rounded" />
            <div className="h-8 w-28 bg-s112-line rounded-lg" />
            <div className="h-3 w-16 bg-[#F2F3F5] rounded" />
          </div>
        ))}
      </div>

      {/* Drei Spalten */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="card p-5 space-y-3">
            <div className="h-4 w-32 bg-s112-line rounded" />
            {[...Array(4)].map((_, j) => (
              <div key={j} className="flex gap-3 py-2 border-b border-s112-border last:border-0">
                <div className="flex-1 space-y-1">
                  <div className="h-3.5 w-full bg-[#F2F3F5] rounded" />
                  <div className="h-3 w-24 bg-[#F2F3F5] rounded" />
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>

      {/* Schnellzugriff */}
      <div className="space-y-3">
        <div className="h-3 w-24 bg-[#F2F3F5] rounded" />
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          <div className="h-14 bg-s112-line rounded-xl" />
          {[...Array(4)].map((_, i) => (
            <div key={i} className="card h-14" />
          ))}
        </div>
      </div>
    </div>
  )
}
