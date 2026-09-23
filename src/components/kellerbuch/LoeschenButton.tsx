'use client'

import { useState } from 'react'
import { Trash2 } from 'lucide-react'
import { fehlerText } from '@/lib/fehler'

interface Props {
  action: () => Promise<void | { error?: string }>
  bestaetigung?: string
}

export default function LoeschenButton({ action, bestaetigung = 'Eintrag wirklich löschen?' }: Props) {
  const [error, setError]     = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function handleClick() {
    if (!window.confirm(bestaetigung)) return
    setError(null)
    setPending(true)
    try {
      const result = await action()
      if (result && 'error' in result && result.error) {
        setError(result.error)
      }
    } catch (err) {
      setError(fehlerText(err, 'Löschen fehlgeschlagen'))
    } finally {
      setPending(false)
    }
  }

  return (
    <span className="inline-flex flex-col items-end gap-0.5">
      <button type="button" onClick={handleClick} disabled={pending}
        title="Löschen" aria-label="Löschen"
        className="text-s112-err hover:text-s112-err-fg disabled:opacity-50">
        {pending ? '…' : <Trash2 className="w-4 h-4" />}
      </button>
      {error && <span className="text-[11px] text-s112-err-fg max-w-[180px] text-right">{error}</span>}
    </span>
  )
}
