export default function WeinhandelLoading() {
  return (
    <div className="space-y-4 animate-pulse">
      <div className="flex items-center justify-between">
        <div className="h-8 w-40 bg-gray-200 rounded-lg" />
        <div className="h-9 w-36 bg-gray-200 rounded-lg" />
      </div>
      {/* Tabellen-Skeleton */}
      <div className="card overflow-hidden">
        <div className="flex items-center gap-3 p-4 border-b border-s112-border bg-s112-bg">
          {[30, 20, 12, 12, 10, 10].map((w, i) => (
            <div key={i} className={`h-3 bg-gray-200 rounded`} style={{ width: `${w}%` }} />
          ))}
        </div>
        {[...Array(6)].map((_, i) => (
          <div key={i} className="flex items-center gap-3 px-4 py-3.5 border-b border-s112-border/50 last:border-0">
            <div className="h-4 bg-gray-100 rounded" style={{ width: '30%' }} />
            <div className="h-4 bg-gray-100 rounded" style={{ width: '20%' }} />
            <div className="h-4 bg-gray-100 rounded" style={{ width: '12%' }} />
            <div className="h-4 bg-gray-100 rounded" style={{ width: '12%' }} />
            <div className="h-5 w-16 bg-gray-100 rounded-full" />
            <div className="ml-auto h-7 w-20 bg-gray-100 rounded-lg" />
          </div>
        ))}
      </div>
    </div>
  )
}
