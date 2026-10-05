'use client'

// KAN-89: Sammelkorrektur einer Rebsorte ohne Kürzel (alle Zeilen der Tabelle mit diesem Wert)

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { fehlerText } from '@/lib/fehler'
import { rebsorteErsetzen } from './actions'

export default function RebsortenKorrektur({ tabelle, wert, vorschlag, sorten }: {
  tabelle: string
  wert: string
  vorschlag: string | null
  sorten: { name: string; kuerzel: string }[]
}) {
  const router = useRouter()
  const [ziel, setZiel] = useState(vorschlag ?? '')
  const [pending, start] = useTransition()
  const [meldung, setMeldung] = useState<{ ok: boolean; text: string } | null>(null)

  function ersetzen() {
    setMeldung(null)
    start(async () => {
      try {
        const e = await rebsorteErsetzen(tabelle, wert, ziel)
        setMeldung({ ok: e.uebersprungen === 0, text: `${e.geaendert} geändert${e.hinweis ? ` – ${e.hinweis}` : ''}` })
        router.refresh()
      } catch (err) {
        setMeldung({ ok: false, text: fehlerText(err) })
      }
    })
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <select aria-label={`Ersetzen „${wert}“ durch`} value={ziel} onChange={e => setZiel(e.target.value)}
        className="border border-s112-border rounded-lg px-2 py-1.5 text-base sm:text-sm min-w-0 max-w-[16rem]">
        <option value="">– keine Rebsorte (leeren) –</option>
        {sorten.map(s => <option key={s.kuerzel} value={s.name}>{s.name} ({s.kuerzel})</option>)}
      </select>
      <button type="button" onClick={ersetzen} disabled={pending}
        className="bg-s112-teal text-s112-yellow px-3 py-1.5 rounded-lg text-sm font-medium disabled:opacity-50">
        {pending ? 'Ersetzt …' : 'Ersetzen'}
      </button>
      {meldung && <span role="status" className={`text-xs ${meldung.ok ? 'text-s112-ok-fg' : 'text-s112-warn-fg'}`}>{meldung.text}</span>}
    </div>
  )
}
