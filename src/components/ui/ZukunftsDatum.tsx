'use client'

import { useId, useState, type InputHTMLAttributes } from 'react'
import { wienHeute } from '@/lib/csv'
import { ZUKUNFT_HINWEIS, liegtInZukunft } from '@/lib/datum/zukunft'

// KAN-318: Datumsfeld für Ereignisse – zeigt unter dem Feld einen Hinweis, wenn das Datum nach heute liegt (Speichern
// bleibt möglich). Alle Eigenschaften wie bei <input type="date">; gesteuert (value) und ungesteuert (defaultValue).
export default function ZukunftsDatum(props: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>) {
  const { onChange, value, defaultValue, ...rest } = props
  const [eigenerWert, setEigenerWert] = useState(String(defaultValue ?? ''))
  const hinweisId = useId()
  const wert = value !== undefined ? String(value) : eigenerWert
  const zukunft = liegtInZukunft(wert, wienHeute())
  const beschrieben = [rest['aria-describedby'], zukunft ? hinweisId : null].filter(Boolean).join(' ') || undefined
  return (
    <>
      <input
        {...rest}
        type="date"
        {...(value !== undefined ? { value } : { defaultValue })}
        aria-describedby={beschrieben}
        onChange={e => { setEigenerWert(e.target.value); onChange?.(e) }}
      />
      {/* span statt p: manche Felder stehen in einem <label>, dort ist <p> nicht erlaubt */}
      {zukunft && <span id={hinweisId} role="status" className="block text-xs text-s112-warn-fg mt-1">{ZUKUNFT_HINWEIS}</span>}
    </>
  )
}
