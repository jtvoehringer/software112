'use client'

// Mostgewicht anzeigen – KAN-128 Teil A, S4 (26.09.2026)
//
// Beide Werte wie gespeichert (nichts neu gerechnet, nur ein fehlender Wert aus dem Messwert), die
// bevorzugte Einheit des Betriebs zuerst, der umgerechnete Wert mit „≈“ und gedämpft:
// „17,4 °KMW · ≈ 85,7 °Oe“ bzw. „84,0 °Oe · ≈ 17,09 °KMW“. °KMW mit weniger Stellen als
// gespeichert wird abgerundet (Entscheidung 8), °Oe mit einer Stelle. Exporte zeigen dagegen immer
// °KMW vor °Oe (eigene Spalten, lib/csv).

import { Fragment } from 'react'
import { EINHEIT_ZEICHEN, format, formatKmw, formatOechsle, type MostgewichtEinheit } from '@/lib/wein/mostgewicht'
import { mostgewichtAusGespeichert, type GespeichertesMostgewicht } from '@/lib/wein/mostgewichtFormular'
import { feldReihenfolge } from '@/lib/wein/mostgewichtEingabe'
import { useMostgewichtEinheit } from './MostgewichtEinheit'

export default function MostgewichtAnzeige({
  wert, bevorzugt, kmwStellen = 2, nurBevorzugt = false, leer = '–', className,
}: {
  /** Gespeicherte Werte ({ kmw, oechsle, einheit }) oder ein Mostgewicht aus dem Rechenkern */
  wert: GespeichertesMostgewicht | null | undefined
  /** Einheit, die zuerst steht – Standard: bevorzugte Einheit des Betriebs */
  bevorzugt?: MostgewichtEinheit
  /** °KMW-Nachkommastellen (abgerundet), Standard 2 wie gespeichert */
  kmwStellen?: 1 | 2
  /** Nur die bevorzugte Einheit zeigen (enge Tabellenspalten); beide Werte im Tooltip */
  nurBevorzugt?: boolean
  /** Text ohne Mostgewicht */
  leer?: string
  className?: string
}) {
  const betriebsEinheit = useMostgewichtEinheit()
  const zuerst = bevorzugt ?? betriebsEinheit
  const m = mostgewichtAusGespeichert(wert)
  if (!m) return <span className={className}>{leer}</span>

  const teile = feldReihenfolge(zuerst)
    .slice(0, nurBevorzugt ? 1 : 2)
    .map(einheit => ({
      einheit,
      text: einheit === 'kmw' ? `${formatKmw(m.kmw, kmwStellen)} °KMW` : `${formatOechsle(m.oechsle)} °Oe`,
      umgerechnet: einheit !== m.einheit,
    }))

  return (
    <span className={`tabular-nums whitespace-nowrap ${className ?? ''}`}
      title={`${format(m, zuerst, { kmwStellen })} – gemessen in ${EINHEIT_ZEICHEN[m.einheit]}`}>
      {teile.map((t, i) => (
        <Fragment key={t.einheit}>
          {i > 0 && <span className="text-s112-tertiary"> · </span>}
          <span className={t.umgerechnet ? 'text-s112-muted' : undefined}>{t.umgerechnet ? '≈ ' : ''}{t.text}</span>
        </Fragment>
      ))}
    </span>
  )
}
