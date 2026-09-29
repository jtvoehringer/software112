'use client'

export default function PrintButton() {
  return (
    <button
      onClick={() => window.print()}
      className="no-print text-xs font-medium text-s112-blue-700 border border-s112-teal/30 rounded-full px-3 py-1 hover:bg-s112-teal hover:text-s112-yellow transition-colors"
    >
      Drucken / PDF
    </button>
  )
}
