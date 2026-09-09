export default function CRMLoading() {
  return (
    <div className="space-y-4 animate-pulse">
      {/* Titel */}
      <div className="flex items-start justify-between">
        <div className="space-y-1.5">
          <div className="h-8 w-40 bg-s112-line rounded-lg" />
          <div className="h-4 w-48 bg-[#F2F3F5] rounded" />
        </div>
        <div className="h-8 w-48 bg-[#F2F3F5] rounded-lg" />
      </div>
      {/* Navigation */}
      <div className="flex items-center gap-2">
        <div className="h-8 w-8 bg-[#F2F3F5] rounded-lg" />
        <div className="h-5 w-52 bg-[#F2F3F5] rounded" />
        <div className="h-8 w-8 bg-[#F2F3F5] rounded-lg" />
      </div>
      {/* Kalender-Rahmen */}
      <div className="border border-s112-border rounded-xl overflow-hidden">
        <div className="grid grid-cols-7 border-b border-s112-border">
          {[...Array(7)].map((_, i) => (
            <div key={i} className="p-3 bg-s112-bg space-y-1 flex flex-col items-center">
              <div className="h-3 w-6 bg-s112-line rounded" />
              <div className="h-7 w-7 bg-s112-line rounded-full" />
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7 divide-x divide-s112-border bg-white" style={{ height: '480px' }}>
          {[...Array(7)].map((_, i) => (
            <div key={i} className="p-2 space-y-1.5">
              {i === 3 && (
                <>
                  <div className="h-5 bg-s112-err-bg rounded" />
                  <div className="h-5 bg-s112-blue-100 rounded" />
                  <div className="h-5 bg-s112-ok-bg rounded" />
                </>
              )}
              {i === 1 && <div className="h-5 bg-s112-warn-bg rounded" />}
              {i === 5 && <div className="h-5 bg-[#F2F3F5] rounded" />}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
