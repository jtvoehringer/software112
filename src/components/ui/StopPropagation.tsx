'use client'

import type { ReactNode } from 'react'

// Verhindert, dass ein Klick auf verschachtelte interaktive Elemente (Icons,
// Links, Lösch-Buttons) zusätzlich die Zeilen-Navigation von ClickableTableRow
// auslöst. WICHTIG: Der onClick-Handler muss innerhalb dieser Client-Komponente
// definiert sein – ein onClick-Handler kann NICHT als Prop aus einer Server-
// Komponente heraus an ein <div>/<Link> übergeben werden (Next.js wirft dann
// "Event handlers cannot be passed to Client Component props").
export default function StopPropagation({
  children, className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <div className={className} onClick={e => e.stopPropagation()}>
      {children}
    </div>
  )
}
