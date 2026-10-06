export default function BetriebWaehlenLoading() {
  return (
    <div className="w-full max-w-md">
      <div className="text-center mb-8 animate-pulse">
        <div className="h-8 w-40 bg-s112-line rounded-lg mx-auto" />
        <div className="h-4 w-56 bg-[#F2F3F5] rounded-sm mx-auto mt-2" />
      </div>
      <div className="space-y-3 animate-pulse">
        {[...Array(2)].map((_, i) => (
          <div key={i} className="bg-white border border-s112-border rounded-xl px-5 py-4">
            <div className="h-4 w-40 bg-s112-line rounded-sm mb-2" />
            <div className="h-3 w-24 bg-[#F2F3F5] rounded-sm" />
          </div>
        ))}
      </div>
    </div>
  )
}
