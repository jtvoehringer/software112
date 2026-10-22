'use client'

import { useState } from 'react'
import { Trash2, Undo2 } from 'lucide-react'
import { fehlerText } from '@/lib/fehler'
import { frageAufteilen, rueckfrage } from '@/lib/ui/rueckfrage'

interface Props {
  action: () => Promise<void | { error?: string }>
  bestaetigung?: string
  /** Beschriftung für Tooltip/Screenreader, z. B. „Stornieren“ (Standard: „Löschen“) */
  label?: string
}

// Seit KAN-35 kommen hier oft längere Sperrmeldungen an („… nicht mehr stornierbar, weil …
// Bitte …“). Die Meldung bricht deshalb um (die Tabellenzellen stehen auf whitespace-nowrap)
// und wird Screenreadern angesagt (role="alert").
// KAN-359: Rückfrage über den eigenen Dialog (Titel = Frage bis zum ersten „?“, Rest = Erklärung, Knopf = label).
export default function LoeschenButton({ action, bestaetigung = 'Eintrag löschen?', label = 'Löschen' }: Props) {
  const [error, setError]     = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const storno = label.toLowerCase().startsWith('storn')

  async function handleClick() {
    if (!(await rueckfrage({ ...frageAufteilen(bestaetigung), bestaetigen: label, gefaehrlich: true }))) return
    setError(null)
    setPending(true)
    try {
      const result = await action()
      if (result && 'error' in result && result.error) {
        setError(result.error)
      }
    } catch (err) {
      setError(fehlerText(err, storno ? 'Storno fehlgeschlagen' : 'Löschen fehlgeschlagen'))
    } finally {
      setPending(false)
    }
  }

  return (
    <span className="inline-flex flex-col items-end gap-0.5 align-top">
      <button type="button" onClick={handleClick} disabled={pending}
        title={label} aria-label={label}
        className="text-s112-err hover:text-s112-err-fg disabled:opacity-50">
        {pending ? '…' : storno ? <Undo2 className="w-4 h-4" /> : <Trash2 className="w-4 h-4" />}
      </button>
      {error && (
        <span role="alert" className="block text-[11px] leading-snug text-s112-err-fg w-[240px] max-w-[70vw] text-left whitespace-normal wrap-break-word">
          {error}
        </span>
      )}
    </span>
  )
}
