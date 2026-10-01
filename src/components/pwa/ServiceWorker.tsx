'use client'

// KAN-180 (01.10.2026): Service Worker registrieren (nur Produktion) und nach einem Deploy den Hinweis
// „Neue Version verfügbar“ zeigen. Der neue Worker übernimmt erst nach dem Klick (Nachricht 'skip-waiting'),
// danach lädt die Seite einmal neu – so laufen Server Actions nie gegen eine fremde Version. Was der Worker
// cacht (nur statische Dateien und die Offline-Seite), steht in public/sw.js.

import { useEffect, useRef, useState } from 'react'

export default function ServiceWorker() {
  const [wartend, setWartend] = useState<ServiceWorker | null>(null)
  const neuLaden = useRef(false)

  useEffect(() => {
    if (process.env.NODE_ENV !== 'production' || !('serviceWorker' in navigator)) return
    let reg: ServiceWorkerRegistration | null = null
    let aktiv = true

    const beobachten = (r: ServiceWorkerRegistration) => {
      // Nur ein Update anbieten, wenn schon ein Worker die Seite steuert (nicht bei der ersten Installation)
      if (r.waiting && navigator.serviceWorker.controller) setWartend(r.waiting)
      r.addEventListener('updatefound', () => {
        const neu = r.installing
        neu?.addEventListener('statechange', () => {
          if (neu.state === 'installed' && navigator.serviceWorker.controller && aktiv) setWartend(neu)
        })
      })
    }
    navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' })
      .then(r => { reg = r; beobachten(r) })
      .catch(() => { /* ohne Service Worker läuft die App wie bisher */ })

    const beiWechsel = () => { if (neuLaden.current) window.location.reload() }
    navigator.serviceWorker.addEventListener('controllerchange', beiWechsel)
    // Beim Zurückkehren zur App nach neuen Versionen fragen (installierte Apps bleiben oft tagelang offen)
    const beiSichtbar = () => { if (document.visibilityState === 'visible') reg?.update().catch(() => {}) }
    document.addEventListener('visibilitychange', beiSichtbar)
    return () => {
      aktiv = false
      navigator.serviceWorker.removeEventListener('controllerchange', beiWechsel)
      document.removeEventListener('visibilitychange', beiSichtbar)
    }
  }, [])

  if (!wartend) return null
  return (
    <div role="status" className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[100] flex items-center gap-3 rounded-xl bg-s112-text text-white shadow-lg px-4 py-3 text-sm">
      <span>Neue Version von software:112 verfügbar.</span>
      <button type="button"
        onClick={() => { neuLaden.current = true; wartend.postMessage({ typ: 'skip-waiting' }) }}
        className="rounded-lg bg-white text-s112-text font-semibold px-3 py-1.5 hover:bg-s112-bg">
        Neu laden
      </button>
    </div>
  )
}
