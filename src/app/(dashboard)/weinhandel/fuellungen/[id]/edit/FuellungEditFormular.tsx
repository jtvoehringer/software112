'use client'

import { zielNachVorgang } from '@/lib/navigation/zurueckBrowser'
import { AbbrechenKnopf } from '@/components/navigation/Abbrechen'
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { fehlerText } from '@/lib/fehler'
import { aenderungGrundFehler } from '@/lib/storno/grund'

// Hauptformular „Füllung bearbeiten“ (KAN-35, 24.09.2026): Sperr- und Prüfmeldungen
// der Server Action (z. B. „Anzahl … nicht mehr änderbar“) erscheinen direkt unter
// dem Formular statt auf der Fehlerseite – die Eingaben bleiben erhalten. Die Felder
// rendert die Server-Seite (children). KAN-378: Der Grund der Änderung wird vorab mit derselben Regel wie in der
// Server Action bzw. der Datenbank geprüft (aenderungGrundFehler).
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
    const grundFehler = aenderungGrundFehler(fd.get('aenderung_grund'))
    if (grundFehler) { setFehler(grundFehler); return }
    startTransition(async () => {
      try {
        await action(fd)
        router.push(zielNachVorgang('/weinhandel', 'gespeichert'))   // KAN-224: zurück, woher man kam
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
          className="bg-s112-teal text-s112-yellow px-6 py-2 rounded-xl text-sm font-semibold hover:bg-s112-teal/90 transition-colors disabled:opacity-60">
          {pending ? 'Wird gespeichert …' : 'Änderungen speichern'}
        </button>
        <AbbrechenKnopf standard="/weinhandel" className="px-6 py-2 rounded-xl text-sm font-medium text-s112-text-2 hover:text-s112-text transition-colors" />
      </div>
    </form>
  )
}
