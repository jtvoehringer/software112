'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Trash2 } from 'lucide-react'
import { deleteZukauf } from './actions'

export default function ZukaufLoeschen({ id, info }: { id: string; info: string }) {
  const [isPending, startTransition] = useTransition()
  const router = useRouter()

  function handleClick() {
    if (!confirm(`Zukauf „${info}" wirklich löschen?`)) return
    startTransition(async () => {
      await deleteZukauf(id)
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
      {isPending ? '…' : <Trash2 className="w-4 h-4" />}
    </button>
  )
}
