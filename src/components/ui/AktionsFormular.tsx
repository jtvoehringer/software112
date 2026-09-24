'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { fehlerText } from '@/lib/fehler'

// Formular für serverseitig gerenderte Felder (children), das die Server Action per
// onSubmit aufruft (KAN-35, 24.09.2026): erwartbare Ablehnungen („… nicht möglich, weil …“)
// erscheinen als Meldung im Formular statt auf der Fehlerseite, die Eingaben bleiben
// erhalten. Leitet die Action selbst weiter (redirect), übernimmt Next.js das; sonst wird
// die Seite neu geladen (router.refresh) und optional eine Erfolgsmeldung gezeigt.
export default function AktionsFormular({
  action,
  children,
  className,
  erfolgsMeldung,
  fehlerErsatz = 'Speichern fehlgeschlagen',
}: {
  action: (fd: FormData) => Promise<unknown>
  children: React.ReactNode
  className?: string
  erfolgsMeldung?: string
  fehlerErsatz?: string
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [fehler, setFehler] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)

  function absenden(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setFehler(null)
    setOk(null)
    const fd = new FormData(e.currentTarget)
    startTransition(async () => {
      try {
        await action(fd)
        if (erfolgsMeldung) setOk(erfolgsMeldung)
        router.refresh()
      } catch (err) {
        setFehler(fehlerText(err, fehlerErsatz))
      }
    })
  }

  return (
    <form onSubmit={absenden} className={className} aria-busy={pending}>
      {children}
      {fehler && (
        <p role="alert" className="basis-full w-full text-sm text-s112-err-fg bg-s112-err-bg border border-s112-err/30 rounded-lg px-4 py-2">
          {fehler}
        </p>
      )}
      {ok && <p role="status" className="basis-full w-full text-sm text-s112-ok-fg">{ok}</p>}
    </form>
  )
}
