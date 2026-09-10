'use client'
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { RefreshCw } from 'lucide-react'
import { aktualisiereMorgenbericht } from './actions'

export default function AktualisierenKnopf({ klein = false }: { klein?: boolean }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [fehler, setFehler] = useState<string | null>(null)
  function los() {
    setFehler(null)
    start(async () => {
      const r = await aktualisiereMorgenbericht()
      if (!r.ok) { setFehler(r.fehler ?? 'Fehler'); return }
      router.refresh()
    })
  }
  return (
    <span className="inline-flex items-center gap-2">
      <button type="button" onClick={los} disabled={pending} title="Bericht jetzt neu erstellen (Wetter wird aufgefrischt; KI-Zusammenfassung zählt als eine Abfrage)"
        className={klein
          ? 'inline-flex items-center gap-1 text-[11.5px] text-s112-text-2 hover:text-s112-blue-700 disabled:opacity-50'
          : 'inline-flex items-center gap-1.5 bg-s112-teal text-s112-yellow px-3.5 py-1.5 rounded-lg text-[13px] font-semibold hover:bg-s112-blue-700 disabled:opacity-40'}>
        <RefreshCw size={klein ? 12 : 14} strokeWidth={1.75} className={pending ? 'animate-spin' : ''} />{pending ? 'wird erstellt …' : klein ? 'aktualisieren' : 'Jetzt erstellen'}
      </button>
      {fehler && <span className="text-[11.5px] text-s112-err-fg">{fehler}</span>}
    </span>
  )
}
