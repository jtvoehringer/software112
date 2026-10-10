'use client'

import { useRouter } from 'next/navigation'
import type { ReactNode } from 'react'

// Macht eine ganze <tr> per Klick navigierbar. Für Tastatur und Screenreader
// bleibt der Name/die Nummer des Objekts in der Zeile ein echter Link (seit dem
// Sweep „Name statt Details-Knopf“ gibt es keinen eigenen Details-Knopf mehr,
// siehe scripts/tests/sweep-namenslinks.test.mjs). Interaktive Elemente innerhalb der Zeile (Bearbeiten-
// /Löschen-Icons etc.) sollten ihren Klick-Handler mit stopPropagation() versehen
// bzw. in einen Wrapper mit onClick={e => e.stopPropagation()} gelegt werden,
// damit sie nicht zusätzlich die Zeilen-Navigation auslösen.
export default function ClickableTableRow({
  href, className = '', children,
}: {
  href: string
  className?: string
  children: ReactNode
}) {
  const router = useRouter()
  return (
    // a11y-ignore: Komfortfläche – per Tastatur führt der Link (Name/Nummer) in der Zeile zum selben Ziel
    <tr
      onClick={() => router.push(href)}
      className={`cursor-pointer ${className}`}
    >
      {children}
    </tr>
  )
}
