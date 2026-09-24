'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Trash2 } from 'lucide-react'
import { deactivateFuellung } from './actions'
import { fehlerText } from '@/lib/fehler'

// Füllung aus dem Weinhandel entfernen. Seit KAN-35 (24.09.2026) nur ohne Verkäufe und
// Bestandsbuchungen; die abgefüllten Liter (und ein Abschluss-Schwund derselben Abfüllung)
// werden auf die Charge zurückgebucht. Ist Löschen schon absehbar gesperrt (`gesperrt`),
// bleibt der Knopf deaktiviert und nennt den Grund als Tooltip; eine Sperre des Servers
// kommt als deutsche Meldung direkt unter dem Knopf an.
export default function FuellungLoeschen({ id, name, gesperrt = null }: { id: string; name: string; gesperrt?: string | null }) {
  const [isPending, startTransition] = useTransition()
  const [fehler, setFehler] = useState<string | null>(null)
  const router = useRouter()

  function handleClick() {
    if (gesperrt) return
    if (!confirm(
      `„${name}“ wirklich aus dem Weinhandel entfernen?\n\n` +
      'Die abgefüllten Liter werden auf die Kellerbuch-Charge zurückgebucht (auch ein beim Abfüllen gebuchter Abschluss-Schwund). ' +
      'Nur möglich, solange es keine Verkäufe oder Bestandsbuchungen zu dieser Füllung gibt.'
    )) return
    setFehler(null)
    startTransition(async () => {
      try {
        await deactivateFuellung(id)
        router.refresh()
      } catch (err) {
        setFehler(fehlerText(err, 'Löschen fehlgeschlagen'))
      }
    })
  }

  return (
    <span className="inline-flex flex-col items-end gap-0.5">
      <button
        type="button"
        onClick={handleClick}
        disabled={isPending || !!gesperrt}
        aria-disabled={!!gesperrt}
        title={gesperrt ?? 'Löschen'}
        aria-label={gesperrt ? `Löschen nicht möglich: ${gesperrt}` : 'Löschen'}
        className={gesperrt
          ? 'text-s112-tertiary cursor-not-allowed opacity-40'
          : 'text-s112-err hover:text-s112-err-fg disabled:opacity-50'}
      >
        {isPending ? '…' : <Trash2 className="w-4 h-4" />}
      </button>
      {fehler && (
        <span role="alert" className="text-[11px] text-s112-err-fg w-[260px] max-w-[70vw] text-left whitespace-normal break-words">{fehler}</span>
      )}
    </span>
  )
}
