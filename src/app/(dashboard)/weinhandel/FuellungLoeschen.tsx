'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { deactivateFuellung } from './actions'

export default function FuellungLoeschen({ id, name }: { id: string; name: string }) {
  const [isPending, startTransition] = useTransition()
  const router = useRouter()

  function handleClick() {
    if (!confirm(`"${name}" wirklich aus dem Weinhandel entfernen?`)) return
    startTransition(async () => {
      await deactivateFuellung(id)
      router.refresh()
    })
  }

  return (
    <button
      onClick={handleClick}
      disabled={isPending}
      title="Löschen" aria-label="Löschen"
      className="text-red-500 hover:text-red-700 disabled:opacity-50"
    >
      {isPending ? '…' : '🗑️'}
    </button>
  )
}
