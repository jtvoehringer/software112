'use client'

// KAN-416 Punkt 1 (11.11.2026): „Interne Notiz“ und „Text auf Rechnung“ am Lieferschein nachträglich ändern.
// Der Text auf Rechnung ist nur änderbar, solange keine Rechnung dazu erstellt ist (dieselbe Regel sperrt die Datenbank).

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { fehlerText } from '@/lib/fehler'
import { zeigeErfolg } from '@/lib/ui/erfolg'
import { zielNachSpeichern } from '@/lib/navigation/zurueckBrowser'
import { NOTIZ_MAX, RECHNUNGSTEXT_MAX, notizFehler, rechnungstextFehler } from '@/lib/verkauf/rechnungstext'

export default function LieferscheinTexte({ notiz, rechnungstext, darfSchreiben, textAenderbar, speichern }: {
  notiz: string | null
  rechnungstext: string | null
  /** Schreibrecht Warenwirtschaft und Verkauf nicht storniert */
  darfSchreiben: boolean
  /** false, sobald eine Rechnung zum Lieferschein erstellt ist */
  textAenderbar: boolean
  speichern: (formData: FormData) => Promise<{ error?: string } | void>
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [n, setN] = useState(notiz ?? '')
  const [t, setT] = useState(rechnungstext ?? '')
  const [fehler, setFehler] = useState<string | null>(null)
  const geaendert = n !== (notiz ?? '') || (textAenderbar && t !== (rechnungstext ?? ''))

  function absenden(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setFehler(null)
    const f = notizFehler(n) ?? (textAenderbar ? rechnungstextFehler(t) : null)
    if (f) { setFehler(f); return }
    const fd = new FormData()
    fd.set('notizen', n)
    if (textAenderbar) fd.set('rechnungstext', t)
    startTransition(async () => {
      try {
        const r = await speichern(fd)
        if (r && r.error) { setFehler(r.error); return }
        zeigeErfolg('Texte gespeichert.')
        // UAT 12.11.2026 (KAN-416): nach dem Speichern zurück zur vorigen Übersicht (Verkaufsliste), nicht im Formular bleiben
        router.push(zielNachSpeichern('/weinhandel/verkauf'))
        router.refresh()
      } catch (err) {
        setFehler(fehlerText(err, 'Die Texte wurden nicht gespeichert'))
      }
    })
  }

  if (!darfSchreiben) {
    if (!notiz && !rechnungstext) return null
    return (
      <div className="mt-3 pt-3 border-t border-s112-border text-sm space-y-2">
        {rechnungstext && <p><span className="text-s112-muted">Text auf Rechnung:</span> <span className="whitespace-pre-line">{rechnungstext}</span></p>}
        {notiz && <p className="text-s112-muted italic whitespace-pre-line">Interne Notiz: {notiz}</p>}
      </div>
    )
  }

  return (
    <form onSubmit={absenden} className="mt-3 pt-3 border-t border-s112-border grid grid-cols-1 md:grid-cols-2 gap-4 text-sm print:hidden">
      <label className="block">
        <span className="block text-xs font-medium text-s112-text-2 mb-1">Text auf Rechnung</span>
        <textarea value={t} onChange={e => setT(e.target.value)} rows={3} maxLength={RECHNUNGSTEXT_MAX} disabled={!textAenderbar || pending}
          placeholder="z. B. Bestellung Nr. 4711 vom 3.11., Lieferung frei Haus" className="input w-full py-2 text-sm disabled:bg-s112-bg" />
        <span className="block text-xs text-s112-muted mt-1">
          {textAenderbar
            ? 'Wird auf der Rechnung unter den Positionen gedruckt. Änderbar, bis die Rechnung erstellt ist.'
            : 'Die Rechnung ist erstellt – der gedruckte Text lässt sich nicht mehr ändern.'}
        </span>
      </label>
      <label className="block">
        <span className="block text-xs font-medium text-s112-text-2 mb-1">Interne Notiz</span>
        <textarea value={n} onChange={e => setN(e.target.value)} rows={3} maxLength={NOTIZ_MAX} disabled={pending}
          placeholder="Nur für den Betrieb" className="input w-full py-2 text-sm" />
        <span className="block text-xs text-s112-muted mt-1">Wird nie gedruckt und lässt sich jederzeit ändern.</span>
      </label>
      {fehler && <div role="alert" className="md:col-span-2 bg-s112-err-bg border border-s112-err/30 text-sm text-s112-err-fg rounded-lg px-3 py-2">{fehler}</div>}
      <div className="md:col-span-2">
        <button type="submit" disabled={pending || !geaendert}
          className="bg-s112-teal text-s112-yellow text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-50">
          {pending ? 'Speichert …' : 'Texte speichern'}
        </button>
      </div>
    </form>
  )
}
