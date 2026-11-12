'use client'

// KAN-426 (12.11.2026): Filter „Import“ in Kontakt- und Firmenliste – Auswahl der im Betrieb vorhandenen
// Import-Bezeichnungen (import_quelle) mit Anzahl. Erscheint nur, wenn es Importe gibt oder ein Filter gesetzt ist.

import type { ImportZaehler } from '@/lib/crm/importBezeichnung'

export default function ImportFilter({ importe, wert, onChange }: {
  importe: ImportZaehler[]
  wert: string
  onChange: (imp: string) => void
}) {
  if (importe.length === 0 && !wert) return null
  const bekannt = importe.some(i => i.bezeichnung === wert)
  return (
    <select aria-label="Nach Import filtern" value={wert} onChange={e => onChange(e.target.value)}
      className={`max-w-[16rem] border rounded-lg px-2.5 py-2 text-sm focus:outline-hidden focus:ring-2 focus:ring-s112-teal/40 ${wert ? 'border-s112-teal text-s112-text font-medium' : 'border-s112-border text-s112-text-2'}`}>
      <option value="">Alle Importe</option>
      {importe.map(i => <option key={i.bezeichnung} value={i.bezeichnung}>{i.bezeichnung} ({i.anzahl})</option>)}
      {/* Filter aus der Adresse, zu dem es (mit den übrigen Filtern) nichts gibt – bleibt abwählbar */}
      {wert && !bekannt && <option value={wert}>{wert} (0)</option>}
    </select>
  )
}
