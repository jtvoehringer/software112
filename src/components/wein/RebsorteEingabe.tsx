'use client'

// KAN-89: Rebsorte als Freitext mit Vorschlagsliste der BKI-Kürzelliste – das amtliche Kürzel ergibt sich aus dem
// Namen (bkiRebsorteKuerzel, Synonyme, Groß-/Kleinschreibung, ß = ss) und wird gleich angezeigt; ohne Kürzel ein Hinweis.

import { useState } from 'react'
import { bkiRebsorteKuerzel, REBSORTE_KUERZEL } from '@/lib/wein/bki_kuerzel'

const NAMEN = Object.keys(REBSORTE_KUERZEL).sort((a, b) => a.localeCompare(b, 'de'))

export default function RebsorteEingabe({ name = 'rebsorte', defaultValue, className, id = 'rebsorten-bki' }: {
  name?: string
  defaultValue?: string | null
  className?: string
  id?: string
}) {
  const [wert, setWert] = useState(defaultValue ?? '')
  const kuerzel = wert.trim() ? bkiRebsorteKuerzel(wert) : null
  return (
    <>
      <input aria-label="Rebsorte" name={name} list={id} value={wert} onChange={e => setWert(e.target.value)}
        placeholder="z.B. Grüner Veltliner" className={className} />
      <datalist id={id}>{NAMEN.map(n => <option key={n} value={n} />)}</datalist>
      {wert.trim() !== '' && (
        <p className={`text-xs mt-1 ${kuerzel ? 'text-s112-muted' : 'text-s112-warn-fg'}`}>
          {kuerzel ? `Amtliches Kürzel: ${kuerzel}` : 'Kein amtliches BKI-Kürzel – bitte eine Sorte aus der Liste wählen.'}
        </p>
      )}
    </>
  )
}
