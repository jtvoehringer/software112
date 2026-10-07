'use client'

// ── Drucken / PDF mit Wahl Hoch- oder Querformat (KAN-172, 07.10.2026) ──
// Gemeinsamer Druckknopf: „Hoch“ bzw. „Quer“ wählt das Papierformat, der Knopf druckt (Browser-Druck = PDF).

import { useState } from 'react'
import { druckeSeite, type DruckFormat } from '@/lib/druck'

export default function DruckFormatKnopf({ label = 'Drucken / PDF', standard = 'hoch', klein = false }: {
  label?: string
  standard?: DruckFormat
  /** kleine Ausführung (neben dem CSV-Knopf) */
  klein?: boolean
}) {
  const [format, setFormat] = useState<DruckFormat>(standard)
  const groesse = klein ? 'text-xs px-2.5 py-1.5' : 'text-sm px-3 py-1.5'
  return (
    <span className="inline-flex items-center gap-1 print:hidden">
      <span role="group" aria-label="Papierformat" className="inline-flex rounded-lg border border-s112-border overflow-hidden">
        {(['hoch', 'quer'] as const).map(f => (
          <button key={f} type="button" onClick={() => setFormat(f)} aria-pressed={format === f}
            title={f === 'hoch' ? 'Hochformat (A4)' : 'Querformat (A4)'}
            className={`${klein ? 'text-[11px] px-2 py-1.5' : 'text-xs px-2.5 py-1.5'} ${format === f ? 'bg-s112-teal text-s112-yellow' : 'bg-white text-s112-text-2 hover:bg-s112-bg'}`}>
            {f === 'hoch' ? 'Hoch' : 'Quer'}
          </button>
        ))}
      </span>
      <button type="button" onClick={() => druckeSeite(format)}
        className={`${groesse} bg-[#F2F3F5] hover:bg-s112-line text-s112-text-2 font-medium rounded-lg transition-colors`}>
        {label}
      </button>
    </span>
  )
}
