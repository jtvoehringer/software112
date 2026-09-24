'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Trash2 } from 'lucide-react'
import { deleteZukauf } from './actions'
import { fehlerText } from '@/lib/fehler'

// Löschen (Soft-Delete) eines Zukaufs. Seit KAN-35 (24.09.2026) lehnt deleteZukauf ab,
// sobald an der Zielcharge Folgebuchungen hängen oder Trauben aus dem Zukauf verpresst
// bzw. verkauft wurden – die Meldung sagt, was hängt und was stattdessen zu tun ist,
// und erscheint hier direkt unter dem Knopf.
export default function ZukaufLoeschen({ id, info, hatCharge }: { id: string; info: string; hatCharge: boolean }) {
  const [isPending, startTransition] = useTransition()
  const [fehler, setFehler] = useState<string | null>(null)
  const router = useRouter()

  function handleClick() {
    const frage = hatCharge
      ? `Zukauf „${info}" wirklich löschen?\n\nDie zugehörige Charge im Kellerbuch wird dabei auf 0 L gesetzt und abgeschlossen.`
      : `Zukauf „${info}" wirklich löschen?`
    if (!confirm(frage)) return
    setFehler(null)
    startTransition(async () => {
      try {
        await deleteZukauf(id)
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
        disabled={isPending}
        title="Löschen" aria-label="Löschen"
        className="text-s112-err hover:text-s112-err-fg disabled:opacity-50"
      >
        {isPending ? '…' : <Trash2 className="w-4 h-4" />}
      </button>
      {fehler && (
        <span role="alert" className="text-[11px] leading-snug text-s112-err-fg whitespace-normal text-right max-w-[280px]">
          {fehler}
        </span>
      )}
    </span>
  )
}
