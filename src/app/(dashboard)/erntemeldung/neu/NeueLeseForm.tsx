'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Info } from 'lucide-react'
import { fehlerText } from '@/lib/fehler'
import { jahrgangAusEingabe, leseNummer } from '@/lib/wein/lesen'
import { neueLese } from '../actions'
import LeseFelder from '../LeseFelder'

export type VorhandenerJahrgang = { id: string; jahrgang: number; lesen: number[] }

const HINWEIS_ID = 'lese-jahrgang-hinweis'

// KAN-129: „Neue Lese“ – Jahrgang wählen (wird bei Bedarf angelegt), dazu Art, Bezeichnung, Zeitraum, Notizen.
// Nach dem Speichern geht es direkt zum Reiter der neuen Lese in der Jahrgangsseite.
export default function NeueLeseForm({ vorschlag, vorhandene = [] }: {
  vorschlag: number; vorhandene?: VorhandenerJahrgang[]
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [jahr, setJahr] = useState(String(vorschlag))

  const jahrZahl = jahrgangAusEingabe(jahr)
  const vorhanden = jahrZahl == null ? null : vorhandene.find(v => v.jahrgang === jahrZahl) ?? null
  const naechsteNr = vorhanden && vorhanden.lesen.length > 0 ? Math.max(...vorhanden.lesen) + 1 : 1

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    const formData = new FormData(e.currentTarget)
    startTransition(async () => {
      try {
        const result = await neueLese(formData)
        if (result.error) { setError(result.error); return }
        router.push(result.jahrgangId ? `/erntemeldung/${result.jahrgangId}?lese=${result.lfdNr}` : '/erntemeldung')
      } catch (err) {
        setError(fehlerText(err, 'Die Lese konnte nicht angelegt werden.'))
      }
    })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && (
        <div role="alert" className="bg-s112-err-bg border border-s112-err/30 text-s112-err-fg text-sm rounded-lg px-3 py-2">
          {error}
        </div>
      )}
      <div>
        <label htmlFor="lese-jahrgang" className="block text-sm font-medium text-s112-text-1 mb-1">
          Jahrgang <span className="text-s112-err">*</span>
        </label>
        <input id="lese-jahrgang" name="jahrgang" type="number" step="1" required min="1900" max="2100"
          value={jahr} onChange={e => setJahr(e.target.value)}
          aria-describedby={HINWEIS_ID}
          className="w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-hidden focus:ring-2 focus:ring-s112-teal/40" />
        {/* Live-Region bleibt stehen, damit Vorleseprogramme den Hinweis beim Tippen ansagen */}
        <div id={HINWEIS_ID} role="status" aria-live="polite">
          {jahrZahl != null && (
            <div className="mt-2 flex items-start gap-2 rounded-lg border border-s112-blue-100 bg-s112-blue-50 px-3 py-2 text-sm text-s112-text">
              <Info size={16} strokeWidth={1.75} className="mt-0.5 shrink-0 text-s112-blue-700" aria-hidden="true" />
              <p>
                {vorhanden
                  ? <>Jahrgang {jahrZahl} hat {vorhanden.lesen.length === 1 ? 'eine Lese' : `${vorhanden.lesen.length} Lesen`} ({vorhanden.lesen.map(n => leseNummer(jahrZahl, n)).join(', ')}) – die neue Lese wird voraussichtlich <strong>{leseNummer(jahrZahl, naechsteNr)}</strong>.</>
                  : <>Jahrgang {jahrZahl} wird neu angelegt – die Lese wird <strong>{leseNummer(jahrZahl, 1)}</strong>.</>}
              </p>
            </div>
          )}
        </div>
      </div>
      <LeseFelder jahrgang={jahrZahl} />
      <div className="flex gap-3 pt-2">
        <button type="submit" disabled={pending || jahrZahl == null}
          className="bg-s112-teal text-s112-yellow px-5 py-2 rounded-xl text-sm font-semibold hover:bg-s112-teal/90 transition-colors disabled:opacity-40">
          {pending ? 'Anlegen…' : 'Lese anlegen'}
        </button>
        <a href="/erntemeldung" className="px-5 py-2 rounded-xl text-sm font-medium text-s112-text-2 hover:text-s112-text">
          Abbrechen
        </a>
      </div>
    </form>
  )
}
