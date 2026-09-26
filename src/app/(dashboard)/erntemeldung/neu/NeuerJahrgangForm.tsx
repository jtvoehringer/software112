'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Info } from 'lucide-react'
import Link from '@/components/ui/Link'
import { createJahrgang } from '../actions'

export type VorhandenerJahrgang = { id: string; jahrgang: number }

// KAN-129: Felder, die ein schon bestehender Jahrgang aus diesem Formular nicht übernimmt
const ZUSATZFELDER = ['ernte_beginn', 'ernte_ende', 'notizen'] as const
const HINWEIS_ID = 'jahrgang-vorhanden-hinweis'

export default function NeuerJahrgangForm({ aktuellesJahr, vorhandene = [] }: {
  aktuellesJahr: number; vorhandene?: VorhandenerJahrgang[]
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  // KAN-129: gibt es den Jahrgang schon, führt ein Hinweis dorthin (dort wird die Lese
  // erfasst) – schon beim Tippen aus der Liste der Seite, sonst nach dem Speichern (23505)
  const [jahr, setJahr] = useState(String(aktuellesJahr))
  const [angabenGefuellt, setAngabenGefuellt] = useState(false)
  const [gemeldet, setGemeldet] = useState<VorhandenerJahrgang | null>(null)

  const jahrZahl = jahr.trim() === '' ? null : Number(jahr)
  const vorhanden = jahrZahl == null ? null
    : vorhandene.find(v => v.jahrgang === jahrZahl) ?? (gemeldet?.jahrgang === jahrZahl ? gemeldet : null)

  function handleChange(e: React.FormEvent<HTMLFormElement>) {
    const fd = new FormData(e.currentTarget)
    setJahr(String(fd.get('jahrgang') ?? ''))
    setAngabenGefuellt(ZUSATZFELDER.some(n => String(fd.get(n) ?? '').trim() !== ''))
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    const formData = new FormData(e.currentTarget)
    const jahrBeimSpeichern = jahrZahl
    startTransition(async () => {
      const result = await createJahrgang(formData)
      if (result?.vorhandenId && jahrBeimSpeichern != null) {
        setGemeldet({ id: result.vorhandenId, jahrgang: jahrBeimSpeichern })
        return
      }
      if (result?.error) { setError(result.error); return }
      router.push('/erntemeldung')
    })
  }

  return (
    <form onSubmit={handleSubmit} onChange={handleChange} className="space-y-4">
      {error && (
        <div className="bg-s112-err-bg border border-s112-err/30 text-s112-err-fg text-sm rounded-lg px-3 py-2">
          {error}
        </div>
      )}
      <div>
        <label className="block text-sm font-medium text-s112-text-1 mb-1">
          Jahrgang <span className="text-s112-err">*</span>
        </label>
        <input aria-label="Jahrgang" name="jahrgang" type="number" required
          min="1900" max="2100" defaultValue={aktuellesJahr}
          aria-describedby={vorhanden ? HINWEIS_ID : undefined}
          className="w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40" />
        {/* KAN-129: Live-Region bleibt stehen, damit Vorleseprogramme den Hinweis beim Tippen ansagen */}
        <div id={HINWEIS_ID} role="status" aria-live="polite">
          {vorhanden && (
            <div className="mt-2 flex items-start gap-2 rounded-lg border border-s112-blue-100 bg-s112-blue-50 px-3 py-2.5 text-sm text-s112-text">
              <Info size={16} strokeWidth={1.75} className="mt-0.5 shrink-0 text-s112-blue-700" aria-hidden="true" />
              <div className="space-y-2">
                <p>Den Jahrgang {vorhanden.jahrgang} gibt es bereits – die Lese erfasst du dort.</p>
                {angabenGefuellt && (
                  <p className="text-s112-text-1">
                    Ernte Beginn, Ende und Notizen aus diesem Formular werden nicht übernommen – du änderst sie in
                    der Übersicht <Link href="/erntemeldung" className="underline hover:text-s112-blue-700">„Lese“</Link> beim
                    Jahrgang {vorhanden.jahrgang} über den Stift (Bearbeiten).
                  </p>
                )}
                <Link href={`/erntemeldung/${vorhanden.id}`}
                  className="inline-flex items-center bg-s112-teal text-white px-3 py-1.5 rounded-lg text-xs font-semibold hover:bg-opacity-90 transition-colors">
                  Jahrgang {vorhanden.jahrgang} öffnen
                </Link>
              </div>
            </div>
          )}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-medium text-s112-text-1 mb-1">Ernte Beginn</label>
          <input aria-label="Ernte Beginn" name="ernte_beginn" type="date"
            className="w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40" />
        </div>
        <div>
          <label className="block text-sm font-medium text-s112-text-1 mb-1">Ernte Ende</label>
          <input aria-label="Ernte Ende" name="ernte_ende" type="date"
            className="w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40" />
        </div>
      </div>
      <div>
        <label className="block text-sm font-medium text-s112-text-1 mb-1">Notizen</label>
        <textarea aria-label="Notizen" name="notizen" rows={3}
          className="w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40" />
      </div>
      <div className="flex gap-3 pt-2">
        <button type="submit" disabled={pending || vorhanden != null}
          className="bg-s112-teal text-white px-5 py-2 rounded-xl text-sm font-semibold hover:bg-opacity-90 transition-colors disabled:opacity-40">
          {pending ? 'Anlegen…' : 'Anlegen'}
        </button>
        <a href="/erntemeldung" className="px-5 py-2 rounded-xl text-sm font-medium text-s112-text-2 hover:text-s112-text">
          Abbrechen
        </a>
      </div>
    </form>
  )
}
