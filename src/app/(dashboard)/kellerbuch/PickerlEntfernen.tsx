'use client'

// KAN-174 F: LP-Pickerl auf der Kellerbuch-Übersicht mit einem Klick entfernen
import { useTransition } from 'react'
import { X } from 'lucide-react'
import { pickerlEntfernen } from './actions'
import { fehlerText } from '@/lib/fehler'

export default function PickerlEntfernen({ behaelterId, text }: { behaelterId: string; text: string }) {
  const [pending, start] = useTransition()
  return (
    <span className="inline-flex items-center gap-1 text-[10.5px] font-semibold px-1.5 py-px rounded-sm bg-s112-warn-bg text-s112-warn-fg border border-s112-warn/30">
      {text}
      <button type="button" disabled={pending} title="Pickerl entfernen" aria-label={`Pickerl „${text}“ entfernen`}
        onClick={() => start(async () => {
          try { await pickerlEntfernen(behaelterId) } catch (e) { window.alert(fehlerText(e, 'Pickerl konnte nicht entfernt werden')) }
        })}
        className="hover:opacity-70 disabled:opacity-40"><X size={11} /></button>
    </span>
  )
}
