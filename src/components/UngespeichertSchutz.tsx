'use client'

import { useEffect } from 'react'
import { GEAENDERT_ATTR, MELDUNG, SCHUTZ_ATTR, offeneAenderungen, schutzFormular, verlaesstSeite } from '@/lib/ui/ungespeichert'

// Sweep 119: Rückfrage vor dem Verlassen eines geänderten, nicht abgesendeten Formulars – Begründung in
// src/lib/ui/ungespeichert.ts. Ein Baustein für die ganze App; Formulare melden sich mit data-ungespeichert an.
export default function UngespeichertSchutz() {
  useEffect(() => {
    const geaendert = (e: Event) => { schutzFormular(e.target)?.setAttribute(GEAENDERT_ATTR, '1') }
    const sauber = (e: Event) => {
      const f = e.target as HTMLFormElement | null
      if (f?.hasAttribute?.(SCHUTZ_ATTR)) f.removeAttribute(GEAENDERT_ATTR)
    }
    const vorDemVerlassen = (e: BeforeUnloadEvent) => {
      if (offeneAenderungen(document).length === 0) return
      e.preventDefault()
      e.returnValue = ''   // ältere Browser zeigen die Rückfrage nur damit
    }
    // Capture-Phase am Dokument: vor dem Klick-Handler von next/link (React hängt an der Wurzel darunter)
    const linkKlick = (e: MouseEvent) => {
      const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null
      if (!a) return
      const offen = offeneAenderungen(document, a)
      if (offen.length === 0 || !verlaesstSeite(e, a, window.location.href)) return
      if (window.confirm(MELDUNG)) offen.forEach(f => f.removeAttribute(GEAENDERT_ATTR))
      else { e.preventDefault(); e.stopPropagation() }
    }
    document.addEventListener('input', geaendert, true)
    document.addEventListener('change', geaendert, true)
    document.addEventListener('submit', sauber, true)
    document.addEventListener('reset', sauber, true)
    document.addEventListener('click', linkKlick, true)
    window.addEventListener('beforeunload', vorDemVerlassen)
    return () => {
      document.removeEventListener('input', geaendert, true)
      document.removeEventListener('change', geaendert, true)
      document.removeEventListener('submit', sauber, true)
      document.removeEventListener('reset', sauber, true)
      document.removeEventListener('click', linkKlick, true)
      window.removeEventListener('beforeunload', vorDemVerlassen)
    }
  }, [])
  return null
}
