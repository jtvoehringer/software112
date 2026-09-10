'use client'
import { Printer } from 'lucide-react'

export default function DruckenKnopf() {
  return (
    <button type="button" onClick={() => window.print()} data-print="hide"
      className="inline-flex items-center gap-1.5 bg-s112-teal text-s112-yellow px-3.5 py-1.5 rounded-lg text-[13px] font-semibold hover:bg-s112-blue-700">
      <Printer size={14} strokeWidth={1.75} />Drucken / PDF
    </button>
  )
}
