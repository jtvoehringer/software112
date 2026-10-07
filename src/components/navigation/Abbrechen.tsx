'use client'

// ── Abbrechen und Rückkehr-Feld (KAN-224, 07.10.2026) ──
// AbbrechenKnopf: führt dorthin zurück, woher man kam (zurueck-Parameter → vorherige Seite im Verlauf → `standard`),
// statt auf eine fest verdrahtete Seite. ZurueckFeld: verstecktes Formularfeld `zurueck` für Server Actions, die nach
// dem Speichern per redirect(zielNachAbschluss(formData.get('zurueck'), …)) zurückführen.

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { zurueckZiel } from '@/lib/navigation/zurueckBrowser'

export function AbbrechenKnopf({ standard, className, children = 'Abbrechen' }: {
  standard: string
  className?: string
  children?: React.ReactNode
}) {
  const router = useRouter()
  return (
    <button type="button" onClick={() => router.push(zurueckZiel(standard))}
      className={className ?? 'text-sm text-s112-text-2 hover:text-s112-text-1 px-4 py-2 rounded-lg transition-colors'}>
      {children}
    </button>
  )
}

export function ZurueckFeld({ standard }: { standard: string }) {
  const [wert, setWert] = useState(standard)
  // eslint-disable-next-line react-hooks/set-state-in-effect -- Ziel steht erst im Browser fest (sessionStorage)
  useEffect(() => { setWert(zurueckZiel(standard)) }, [standard])
  return <input type="hidden" name="zurueck" value={wert} />
}
