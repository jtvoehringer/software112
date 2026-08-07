'use client'

export default function RueckverfolgungPrintButton() {
  return (
    <button
      onClick={() => window.print()}
      className="text-xs bg-gray-100 hover:bg-gray-200 text-gray-600 font-medium px-3 py-1.5 rounded-lg transition-colors print:hidden"
    >
      PDF / Drucken
    </button>
  )
}
