'use client'

// KAN-180 (01.10.2026): Cache des Service Workers leeren – auf der Login-Seite (jedes Abmelden endet dort) und bei
// „Betrieb wählen“ (Betriebswechsel). Der Worker cacht ohnehin nur statische Dateien, nie Betriebsdaten; das Leeren
// ist die vereinbarte zusätzliche Vorsicht für geteilte Geräte. Der Worker legt die Offline-Seite danach neu an.

import { useEffect } from 'react'

export default function SwCacheLeeren() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return
    navigator.serviceWorker.controller?.postMessage({ typ: 'cache-leeren' })
  }, [])
  return null
}
