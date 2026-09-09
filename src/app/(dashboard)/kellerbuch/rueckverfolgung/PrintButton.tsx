'use client'

export default function RueckverfolgungPrintButton() {
  return (
    <button
      onClick={() => window.print()}
      className="text-xs bg-[#F2F3F5] hover:bg-s112-line text-s112-text-2 font-medium px-3 py-1.5 rounded-lg transition-colors print:hidden"
    >
      PDF / Drucken
    </button>
  )
}
