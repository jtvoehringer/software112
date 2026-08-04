'use client'

export default function PrintButton() {
  return (
    <button
      onClick={() => window.print()}
      className="flex items-center gap-2 border border-s112-border text-gray-700 px-4 py-2 rounded-xl text-sm font-semibold hover:bg-s112-bg transition-colors"
    >
      Drucken / Als PDF speichern
    </button>
  )
}
