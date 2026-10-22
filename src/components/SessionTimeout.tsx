'use client'
import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'
import { Bell } from 'lucide-react'
import { useDialog } from '@/components/ui/useDialog'

import { timeoutMinuten as zeitspanne } from '@/lib/auth/sitzung'
// KAN-286: Sitzungs-Cookie (ohne Ablaufdatum) mit letzter Aktivität und Zeitspanne – der Proxy prüft es serverseitig
import { sitzungsCookieSchreiben } from '@/lib/auth/sitzungCookie'

interface Props { timeoutMinuten?: number | null }

// Sweep 111: Konstante auf Modulebene (vorher im Komponentenkörper – fehlte in den useCallback-Abhängigkeiten)
const WARN_BEFORE = 2 * 60 * 1000 // 2 Min Vorwarnung

export default function SessionTimeout({ timeoutMinuten: eingestellt }: Props) {
  // KAN-286: ohne Einstellung des Betriebs gilt der Standard (60 Minuten) – vorher lief die Sitzung dann nie ab
  const timeoutMinuten = zeitspanne(eingestellt)
  const letzterSchreib = useRef(0)
  const router = useRouter()
  const [warnung, setWarnung] = useState(false)
  const timerRef  = useRef<NodeJS.Timeout | null>(null)
  const warnRef   = useRef<NodeJS.Timeout | null>(null)
  // Bugfix 07.10.2026: Solange die Warnung offen ist, zählt Maus/Tastatur nicht als Aktivität – sonst schloss schon das
  // mousedown des Klicks auf „Abmelden“ den Dialog (reset), und der Klick erreichte den Knopf nie. Nur „Aktiv bleiben“
  // (bzw. Escape) setzt den Timer dann zurück.
  const warnungRef = useRef(false)

  const abmelden = useCallback(async () => {
    const s = createSupabaseBrowserClient()
    sitzungsCookieSchreiben(timeoutMinuten, true)
    await s.auth.signOut()
    router.push('/login?grund=timeout')
    router.refresh()
  }, [router, timeoutMinuten])

  const reset = useCallback(() => {
    if (!timeoutMinuten) return
    // KAN-286: Aktivität auch serverseitig festhalten – höchstens einmal pro Minute
    if (Date.now() - letzterSchreib.current > 60_000) { letzterSchreib.current = Date.now(); sitzungsCookieSchreiben(timeoutMinuten) }
    warnungRef.current = false
    setWarnung(false)
    if (timerRef.current)  clearTimeout(timerRef.current)
    if (warnRef.current)   clearTimeout(warnRef.current)
    const ms = timeoutMinuten * 60 * 1000
    warnRef.current  = setTimeout(() => { warnungRef.current = true; setWarnung(true) }, ms - WARN_BEFORE)
    timerRef.current = setTimeout(abmelden, ms)
  }, [timeoutMinuten, abmelden])

  /** Aktivität im Fenster: nur ohne offene Warnung den Timer zurücksetzen */
  const aktivitaet = useCallback(() => {
    if (!warnungRef.current) reset()
  }, [reset])

  useEffect(() => {
    if (!timeoutMinuten) return
    const events = ['mousedown','keydown','touchstart','scroll']
    events.forEach(e => window.addEventListener(e, aktivitaet, { passive: true }))
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Laden/Abonnieren im Effekt: Lade- bzw. Startzustand setzen, Ergebnis kommt asynchron
    reset()
    return () => {
      events.forEach(e => window.removeEventListener(e, aktivitaet))
      if (timerRef.current) clearTimeout(timerRef.current)
      if (warnRef.current)  clearTimeout(warnRef.current)
    }
  }, [reset, aktivitaet, timeoutMinuten])

  const dialog = useDialog(!!timeoutMinuten && warnung, reset, 'Sitzung läuft ab')
  if (!timeoutMinuten || !warnung) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div {...dialog} className="bg-white rounded-xl shadow-2xl p-6 w-full max-w-sm mx-4 max-h-[calc(100dvh-2rem)] overflow-y-auto text-center space-y-4">
        <Bell className="w-9 h-9 mx-auto text-s112-warn-fg" strokeWidth={1.75} />
        <h2 className="text-lg font-semibold text-s112-text">Sitzung läuft ab</h2>
        <p className="text-sm text-s112-muted">
          Du wirst in 2 Minuten automatisch abgemeldet.
        </p>
        <div className="flex gap-3">
          <button onClick={reset}
            className="flex-1 bg-s112-teal text-s112-yellow py-2.5 rounded-xl font-semibold hover:bg-s112-teal/90 text-sm">
            Aktiv bleiben
          </button>
          <button onClick={abmelden}
            className="px-4 py-2.5 rounded-xl border border-s112-border text-s112-text-2 hover:bg-s112-bg text-sm">
            Abmelden
          </button>
        </div>
      </div>
    </div>
  )
}
