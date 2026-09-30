'use client'

// Stornierte Einträge in Listen ein- und ausblenden (KAN-148 Soll 9, 30.09.2026): Stornierte stehen gekennzeichnet in
// der Liste und zählen in keiner Summe; wer sie nicht sehen will, blendet sie hier aus. Ohne stornierte Einträge
// erscheint der Schalter nicht.

export default function StornierteUmschalter({ anzahl, sichtbar, onChange, className = '' }: {
  /** Anzahl stornierter Einträge in der Liste */
  anzahl: number
  sichtbar: boolean
  onChange: (sichtbar: boolean) => void
  className?: string
}) {
  if (anzahl <= 0) return null
  return (
    <label className={`inline-flex items-center gap-1.5 text-xs text-s112-text-2 cursor-pointer select-none ${className}`} data-print="hide">
      <input type="checkbox" checked={sichtbar} onChange={e => onChange(e.target.checked)}
        className="rounded border-s112-border text-s112-teal focus:ring-s112-teal/40" />
      Stornierte anzeigen ({anzahl})
    </label>
  )
}
