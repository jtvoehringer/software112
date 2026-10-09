'use client'
// ── Auto-Aktualisierung der Server-Daten (Rückmeldung 17.9.2026) ──────────────
// Rückmeldung: „Anlegen eines neuen Kellers wurde erst nach Seite-neu-laden
// gezeigt“. Next.js hält besuchte Seiten im Router-Cache; bei Zurück-Navigation
// oder Tab-Wechsel kann dadurch ein alter Stand erscheinen, und Änderungen
// anderer Benutzer kommen ohne Neuladen gar nicht. router.refresh() holt nur
// die Server-Komponenten neu (Formular- und Client-Zustand bleiben erhalten):
//   * beim Zurückkehren in den Tab / Fokus (frühestens alle 15 s)
//   * bei Browser-Zurück/-Vor (popstate)
//   * alle 3 Minuten, solange der Tab sichtbar ist
// Während ein Textfeld aktiv ist, wird die Intervall-Aktualisierung übersprungen.
// Hat der Betriebs-Wächter den Tab gesperrt (KAN-30, Betrieb in einem anderen Tab gewechselt),
// ruht die Aktualisierung ganz: sonst lüde sie Daten des anderen Betriebs unter die Überlagerung
// bzw. leitete auf dessen /abo oder /zwei-faktor um, und die Sperre verschwände kommentarlos.
import { useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { istTabGesperrt } from '@/lib/tenant/waechter'

const MIN_ABSTAND_MS = 15_000
const INTERVALL_MS = 3 * 60_000

export default function AutoRefresh() {
  const router = useRouter()
  const letzte = useRef(0)

  useEffect(() => {
    if (!letzte.current) letzte.current = Date.now()   // Startzeitpunkt beim ersten Einhängen (nicht beim Rendern)
    const tippt = () => {
      const el = document.activeElement as HTMLElement | null
      return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)
    }
    const refresh = (erzwingen = false) => {
      if (document.visibilityState !== 'visible' || istTabGesperrt()) return
      if (!erzwingen && Date.now() - letzte.current < MIN_ABSTAND_MS) return
      letzte.current = Date.now()
      router.refresh()
    }
    const onVisible = () => { if (document.visibilityState === 'visible') refresh() }
    const onFocus = () => refresh()
    const onPop = () => refresh(true)
    const timer = setInterval(() => { if (!tippt()) refresh() }, INTERVALL_MS)
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onFocus)
    window.addEventListener('popstate', onPop)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('popstate', onPop)
    }
  }, [router])

  return null
}
