'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Undo2 } from 'lucide-react'
import { fehlerText } from '@/lib/fehler'

// Verkauf stornieren (KAN-35, 24.09.2026): erwartbare Ablehnungen („bereits storniert“,
// fehlende Freigabe Kellerbuch bei Tankpositionen, Gebinde inzwischen belegt …) erscheinen
// als Meldung neben dem Knopf statt auf der Fehlerseite.
export default function StornoKnopf({
  action,
  meldung,
}: {
  action: () => Promise<void>
  meldung: string
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [fehler, setFehler] = useState<string | null>(null)

  function stornieren() {
    if (!window.confirm(meldung)) return
    setFehler(null)
    startTransition(async () => {
      try {
        await action()
        router.refresh()
      } catch (err) {
        setFehler(fehlerText(err, 'Storno fehlgeschlagen'))
        router.refresh()   // Teil-Storno (z. B. E&A) zeigt den neuen Stand
      }
    })
  }

  return (
    <span className="inline-flex flex-col items-end gap-1">
      <button type="button" onClick={stornieren} disabled={pending}
        title="Stornieren" aria-label="Stornieren"
        className="text-s112-warn-fg hover:text-s112-warn-fg disabled:opacity-50">
        {pending ? '…' : <Undo2 size={16} />}
      </button>
      {fehler && (
        <span role="alert" className="text-xs text-s112-err-fg bg-s112-err-bg border border-s112-err/30 rounded-lg px-3 py-2 w-[320px] max-w-[80vw] text-left whitespace-normal break-words">
          {fehler}
        </span>
      )}
    </span>
  )
}
