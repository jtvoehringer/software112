'use client'
import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'

interface Props { timeoutMinuten?: number | null }

export default function SessionTimeout({ timeoutMinuten }: Props) {
  const router = useRouter()
  const [warnung, setWarnung] = useState(false)
  const timerRef  = useRef<NodeJS.Timeout | null>(null)
  const warnRef   = useRef<NodeJS.Timeout | null>(null)
  const WARN_BEFORE = 2 * 60 * 1000 // 2 Min Vorwarnung

  const abmelden = useCallback(async () => {
    const s = createSupabaseBrowserClient()
    await s.auth.signOut()
    router.push('/login?grund=timeout')
  }, [router])

  const reset = useCallback(() => {
    if (!timeoutMinuten) return
    setWarnung(false)
    if (timerRef.current)  clearTimeout(timerRef.current)
    if (warnRef.current)   clearTimeout(warnRef.current)
    const ms = timeoutMinuten * 60 * 1000
    warnRef.current  = setTimeout(() => setWarnung(true), ms - WARN_BEFORE)
    timerRef.current = setTimeout(abmelden, ms)
  }, [timeoutMinuten, abmelden])

  useEffect(() => {
    if (!timeoutMinuten) return
    const events = ['mousedown','keydown','touchstart','scroll']
    events.forEach(e => window.addEventListener(e, reset, { passive: true }))
    reset()
    return () => {
      events.forEach(e => window.removeEventListener(e, reset))
      if (timerRef.current) clearTimeout(timerRef.current)
      if (warnRef.current)  clearTimeout(warnRef.current)
    }
  }, [reset, timeoutMinuten])

  if (!timeoutMinuten || !warnung) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-sm mx-4 text-center space-y-4">
        <p className="text-3xl">⏱</p>
        <h2 className="text-lg font-bold text-gray-900">Sitzung läuft ab</h2>
        <p className="text-sm text-s112-muted">
          Du wirst in 2 Minuten automatisch abgemeldet.
        </p>
        <div className="flex gap-3">
          <button onClick={reset}
            className="flex-1 bg-s112-teal text-white py-2.5 rounded-xl font-semibold hover:bg-opacity-90 text-sm">
            Aktiv bleiben
          </button>
          <button onClick={abmelden}
            className="px-4 py-2.5 rounded-xl border border-s112-border text-gray-600 hover:bg-s112-bg text-sm">
            Abmelden
          </button>
        </div>
      </div>
    </div>
  )
}
