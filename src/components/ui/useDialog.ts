'use client'

// ── Barrierefreie Dialoge (Barrierefreiheit B3, 23.9.2026) ─────────────────────
// Für die bestehenden Overlays (fixed inset-0 …): Rückgabewert auf das innere
// Dialog-Panel spreaden – <div {...dialog} className="bg-white …">.
//  - role="dialog" + aria-modal + Name für Vorleseprogramme
//  - Fokus beim Öffnen ins Dialog, Tab bleibt im Dialog (Fokusfalle)
//  - Escape schließt, Fokus kehrt danach zum auslösenden Element zurück
import { useEffect, useLayoutEffect, useRef } from 'react'

const FOKUSSIERBAR = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

export function useDialog(offen: boolean, onClose: (() => void) | undefined, name: string) {
  const ref = useRef<HTMLDivElement>(null)
  const schliessen = useRef(onClose)
  // aktuellen Callback nach jedem Commit merken (nicht beim Rendern schreiben) – gelesen nur im Tastendruck
  useLayoutEffect(() => { schliessen.current = onClose })

  useEffect(() => {
    if (!offen) return
    const vorher = document.activeElement as HTMLElement | null
    const panel = ref.current
    // Fokus ins Dialog: erstes Feld mit autoFocus bzw. erstes fokussierbares Element, sonst das Panel
    const t = window.setTimeout(() => {
      if (!panel || panel.contains(document.activeElement)) return
      const ziel = panel.querySelector<HTMLElement>('[autofocus]') ?? panel.querySelector<HTMLElement>(FOKUSSIERBAR)
      ;(ziel ?? panel).focus()
    }, 0)

    const taste = (e: KeyboardEvent) => {
      if (!panel) return
      if (e.key === 'Escape' && schliessen.current) {
        e.stopPropagation()
        schliessen.current()
        return
      }
      if (e.key !== 'Tab') return
      const elemente = [...panel.querySelectorAll<HTMLElement>(FOKUSSIERBAR)].filter(el => el.offsetParent !== null)
      if (elemente.length === 0) { e.preventDefault(); panel.focus(); return }
      const erstes = elemente[0], letztes = elemente[elemente.length - 1]
      if (e.shiftKey && (document.activeElement === erstes || document.activeElement === panel)) { e.preventDefault(); letztes.focus() }
      else if (!e.shiftKey && document.activeElement === letztes) { e.preventDefault(); erstes.focus() }
    }
    document.addEventListener('keydown', taste, true)
    return () => {
      window.clearTimeout(t)
      document.removeEventListener('keydown', taste, true)
      if (vorher && document.contains(vorher)) vorher.focus()
    }
  }, [offen])

  return { ref, role: 'dialog' as const, 'aria-modal': true, 'aria-label': name, tabIndex: -1 }
}
