'use client'

import { useEffect } from 'react'
import { zahlenfeldMausrad } from '@/lib/ui/zahlenfeld'

// Sweep 117: Mausrad ändert keine Zahlenfelder mehr – Begründung in src/lib/ui/zahlenfeld.ts
export default function ZahlenfeldMausrad() {
  useEffect(() => {
    const beimMausrad = (e: WheelEvent) => { zahlenfeldMausrad(e, document.activeElement) }
    document.addEventListener('wheel', beimMausrad, { passive: true })
    return () => document.removeEventListener('wheel', beimMausrad)
  }, [])
  return null
}
