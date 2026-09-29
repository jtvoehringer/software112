'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from '@/components/ui/Link'
import { fehlerText } from '@/lib/fehler'

// Hauptformular „Füllung bearbeiten“ (KAN-35, 24.09.2026): Sperr- und Prüfmeldungen
// der Server Action (z. B. „Anzahl … nicht mehr änderbar“) erscheinen direkt unter
// dem Formular statt auf der Fehlerseite – die Eingaben bleiben erhalten. Die Felder
// rendert die Server-Seite (children).
export default function FuellungEditFormular({
  action,
  children,
}: {
  action: (fd: FormData) => Promise<void>
  children: React.ReactNode
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [fehler, setFehler] = useState<string | null>(null)

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setFehler(null)
    const fd = new FormData(e.currentTarget)
    startTransition(async () => {
      try {
        await action(fd)
        router.push('/weinhandel')
      } catch (err) {
        setFehler(fehlerText(err, 'Speichern fehlgeschlagen'))
      }
    })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {children}

      {fehler && (
        <p role="alert" className="text-sm text-s112-err-fg bg-s112-err-bg border border-s112-err/30 rounded-lg px-4 py-2">
          {fehler}
        </p>
      )}

      <div className="flex gap-3">
        <button
          type="submit"
          disabled={pending}
          className="bg-s112-teal text-s112-yellow px-6 py-2 rounded-xl text-sm font-semibold hover:bg-opacity-90 transition-colors disabled:opacity-60">
          {pending ? 'Wird gespeichert …' : 'Änderungen speichern'}
        </button>
        <Link href="/weinhandel" className="px-6 py-2 rounded-xl text-sm font-medium text-s112-text-2 hover:text-s112-text transition-colors">
          Abbrechen
        </Link>
      </div>
    </form>
  )
}
