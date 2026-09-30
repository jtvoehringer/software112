'use client'

import { useRouter } from 'next/navigation'
import { Trash2 } from 'lucide-react'
import { deactivateFuellung } from './actions'
import StornoButton from '@/components/StornoButton'

// Füllung aus dem Weinhandel stornieren. Seit KAN-35 (24.09.2026) nur ohne Verkäufe und
// Bestandsbuchungen; die abgefüllten Liter (und ein Abschluss-Schwund derselben Abfüllung)
// werden auf die Charge zurückgebucht. Seit KAN-145 (B3, 30.09.2026) mit Pflicht-Grund: Die Füllung
// bleibt als storniert stehen (Bewegungsbuch: Buchung und Gegenbuchung, Weinbuch: Kennzeichen).
// Ist der Storno schon absehbar gesperrt (`gesperrt`), bleibt der Knopf deaktiviert und nennt den
// Grund als Tooltip; eine Sperre des Servers erscheint als Meldung direkt unter dem Knopf.
export default function FuellungLoeschen({ id, name, gesperrt = null }: { id: string; name: string; gesperrt?: string | null }) {
  const router = useRouter()

  if (gesperrt) {
    return (
      <button type="button" disabled aria-disabled title={gesperrt} aria-label={`Stornieren nicht möglich: ${gesperrt}`}
        className="text-s112-tertiary cursor-not-allowed opacity-40">
        <Trash2 className="w-4 h-4" />
      </button>
    )
  }

  return (
    <StornoButton
      action={grund => deactivateFuellung(id, grund)}
      danach={() => router.refresh()}
      hinweis={`„${name}“ stornieren: Die abgefüllten Liter werden auf die Kellerbuch-Charge zurückgebucht (auch ein beim Abfüllen gebuchter Abschluss-Schwund); die Füllung bleibt als storniert stehen.`} />
  )
}
