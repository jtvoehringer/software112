'use client'

import { useState } from 'react'

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
      setError(err instanceof Error ? err.message : 'Löschen fehlgeschlagen')
    } finally {
      setPending(false)
    }
  }

  return (
    <span className="inline-flex flex-col items-end gap-0.5">
      <button type="button" onClick={handleClick} disabled={pending}
        className="text-xs text-red-500 hover:underline disabled:opacity-50">
        {pending ? 'Löschen…' : 'Löschen'}
      </button>
      {error && <span className="text-[10px] text-red-600 max-w-[180px] text-right">{error}</span>}
    </span>
  )
}
