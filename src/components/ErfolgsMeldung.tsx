'use client'

// ── Erfolg als Pop-up melden (KAN-359, 22.10.2026) ──
// Ersatz für grüne „Gespeichert.“-Kästen im Formular: <ErfolgsMeldung text={ok} /> zeigt den Text als kurzes Pop-up
// (MeldungsPopup, eine Stelle für die ganze App), sobald er gesetzt wird bzw. sich ändert; rendert selbst nichts.
// Für Erfolge in einem Event-Handler direkt zeigeErfolg(text) aus src/lib/ui/erfolg.ts aufrufen.

import { useEffect } from 'react'
import { zeigeErfolg } from '@/lib/ui/erfolg'

export default function ErfolgsMeldung({ text }: { text: string | null | undefined | false }) {
  useEffect(() => {
    if (text) zeigeErfolg(text)
  }, [text])
  return null
}
