'use client'

export default function DruckKnopf() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="border border-s112-border px-4 py-1.5 rounded-lg text-sm hover:bg-s112-bg print:hidden"
    >
      Drucken
    </button>
  )
}
