export default function BetriebWaehlenLoading() {
  return (
    <div className="w-full max-w-md">
      <div className="text-center mb-8 animate-pulse">
        <div className="h-8 w-40 bg-gray-200 rounded-lg mx-auto" />
        <div className="h-4 w-56 bg-gray-100 rounded mx-auto mt-2" />
      </div>
      <div className="space-y-3 animate-pulse">
        {[...Array(2)].map((_, i) => (
          <div key={i} className="bg-white border border-s112-border rounded-xl px-5 py-4">
            <div className="h-4 w-40 bg-gray-200 rounded mb-2" />
            <div className="h-3 w-24 bg-gray-100 rounded" />
          </div>
        ))}
      </div>
    </div>
  )
}
