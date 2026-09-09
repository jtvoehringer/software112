'use client'

export default function PrintButton() {
  return (
    <button
      onClick={() => window.print()}
      className="flex items-center gap-2 border border-s112-border text-s112-text-2 px-3 py-2 rounded-xl text-sm hover:bg-s112-bg transition-colors print:hidden"
    >
      Drucken
    </button>
  )
}
