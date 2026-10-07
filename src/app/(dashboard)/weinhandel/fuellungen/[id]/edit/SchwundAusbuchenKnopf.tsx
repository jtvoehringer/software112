'use client'

import { zielNachVorgang } from '@/lib/navigation/zurueckBrowser'
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { schwundAusbuchen } from '../../../actions'
import { fehlerText } from '@/lib/fehler'
import { fmtNum } from '@/lib/format'

// Restmenge der Charge als Schwund ausbuchen (KAN-35, 24.09.2026): eigenes Bedienelement
// AUSSERHALB des Bearbeiten-Formulars (vorher verschachteltes <form>). Die Buchung wird
// als datierte Schwundzeile ins Bewegungsbuch geschrieben (schwund_buchen). Weil der
// Knopf auch bei nur teilweise abgefüllten Chargen erscheint, fragt er mit Liter-Angabe
// nach – bei großem Rest (> 20 % der Füllmenge) mit ausdrücklicher Warnung.
export default function SchwundAusbuchenKnopf({
  fuellungId,
  liter,
  chargeName,
  fuellmenge,
}: {
  fuellungId: string
  liter: number
  chargeName: string
  fuellmenge: number
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [fehler, setFehler] = useState<string | null>(null)
  const gross = fuellmenge > 0 && liter > fuellmenge * 0.2

  function handleClick() {
    const text =
      `${fmtNum(liter, 2)} L Restbestand der Charge „${chargeName}“ als Schwund ausbuchen und die Charge abschließen?\n\n` +
      'Die Buchung wird mit dem Abfülldatum ins Bewegungsbuch des Gebindes eingetragen.' +
      (gross
        ? `\n\nACHTUNG: Das sind mehr als 20 % der Füllmenge dieser Füllung (${fmtNum(fuellmenge, 2)} L). ` +
          'Wurde die Charge nur teilweise abgefüllt, bitte abbrechen – der Rest bleibt dann im Tank.'
        : '')
    if (!window.confirm(text)) return
    setFehler(null)
    startTransition(async () => {
      try {
        await schwundAusbuchen(fuellungId)
        router.push(zielNachVorgang('/weinhandel', 'schwund'))   // KAN-224
      } catch (err) {
        setFehler(fehlerText(err, 'Schwund konnte nicht gebucht werden'))
      }
    })
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={handleClick}
        disabled={pending}
        className="bg-s112-warn-fg text-white px-4 py-2 rounded-lg text-sm font-semibold hover:opacity-90 transition-colors disabled:opacity-60"
      >
        {pending ? 'Wird gebucht …' : `${fmtNum(liter, 2)} L als Schwund ausbuchen & Charge abschließen`}
      </button>
      {fehler && (
        <p role="alert" className="text-xs text-s112-err-fg bg-s112-err-bg border border-s112-err/30 rounded-lg px-3 py-2">{fehler}</p>
      )}
    </div>
  )
}
