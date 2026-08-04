'use client'

import { useRouter } from 'next/navigation'
import type { ReactNode } from 'react'

// Macht eine ganze <tr> per Klick navigierbar (nicht nur einen einzelnen Link/
// "Details →"-Text darin). Interaktive Elemente innerhalb der Zeile (Bearbeiten-
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
    <tr
      onClick={() => router.push(href)}
      className={`cursor-pointer ${className}`}
    >
      {children}
    </tr>
  )
}
