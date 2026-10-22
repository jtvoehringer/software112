'use client'

// KAN-174 F: LP-Pickerl auf der Kellerbuch-Übersicht mit einem Klick entfernen
// KAN-359: Fehler direkt am Pickerl (role="alert") statt Browser-Dialog – als span, weil das Pickerl in Zeilen aus
// Inline-Elementen steht (ein div wäre dort ungültig).
import { useState, useTransition } from 'react'
import { X } from 'lucide-react'
import { pickerlEntfernen } from './actions'
import { fehlerText } from '@/lib/fehler'

export default function PickerlEntfernen({ behaelterId, text }: { behaelterId: string; text: string }) {
  const [pending, start] = useTransition()
  const [fehler, setFehler] = useState<string | null>(null)
  return (
    <span className="inline-flex flex-col items-start gap-0.5 align-top">
      <span className="inline-flex items-center gap-1 text-[10.5px] font-semibold px-1.5 py-px rounded-sm bg-s112-warn-bg text-s112-warn-fg border border-s112-warn/30">
        {text}
        <button type="button" disabled={pending} title="Pickerl entfernen" aria-label={`Pickerl „${text}“ entfernen`}
          onClick={() => start(async () => {
            setFehler(null)
            try { await pickerlEntfernen(behaelterId) } catch (e) { setFehler(fehlerText(e, 'Pickerl konnte nicht entfernt werden')) }
          })}
          className="hover:opacity-70 disabled:opacity-40"><X size={11} /></button>
      </span>
      {fehler && <span role="alert" className="block text-[11px] leading-snug text-s112-err-fg max-w-[240px] whitespace-normal">{fehler}</span>}
    </span>
  )
}
