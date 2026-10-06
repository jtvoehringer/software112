'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { fuellungEtikettieren, etikettierungStornieren } from '../../../actions'
import { fehlerText } from '@/lib/fehler'
import { etikettierenFehler } from '@/lib/handel/etikettierung'
import StornoButton from '@/components/StornoButton'

// KAN-41 Paket 3d: unetikettierte Flaschen etikettieren (Datum, Stück, Notiz)
export default function EtikettierenForm({ fuellungId, bestandUnetikettiert, heute, abfuelldatum }: {
  fuellungId: string; bestandUnetikettiert: number; heute: string; abfuelldatum: string | null
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [datum, setDatum] = useState(heute)
  const [menge, setMenge] = useState('')
  const [notizen, setNotizen] = useState('')
  const [fehler, setFehler] = useState<string | null>(null)
  const inputCls = 'w-full border border-s112-border rounded-lg px-3 py-2.5 sm:py-1.5 text-base sm:text-sm focus:outline-hidden focus:ring-2 focus:ring-s112-teal/40'

  function absenden(e: React.FormEvent) {
    e.preventDefault()
    setFehler(null)
    const n = Number(menge)
    const f = etikettierenFehler({ menge: menge.trim() ? n : null, bestandUnetikettiert, datum, heute, abfuelldatum })
    if (f) { setFehler(f); return }
    const fd = new FormData()
    fd.set('datum', datum)
    fd.set('menge_stk', menge)
    fd.set('notizen', notizen)
    startTransition(async () => {
      try {
        await fuellungEtikettieren(fuellungId, fd)
        setMenge('')
        setNotizen('')
        router.refresh()
      } catch (err) {
        setFehler(fehlerText(err, 'Etikettierung konnte nicht gebucht werden'))
      }
    })
  }

  return (
    <form onSubmit={absenden} className="space-y-3">
      {fehler && <div role="alert" className="bg-s112-err-bg border border-s112-err/30 text-s112-err-fg px-3 py-2 rounded-lg text-sm">{fehler}</div>}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div>
          <label htmlFor="etikett-datum" className="block text-xs font-medium text-s112-text-2 mb-1">Datum *</label>
          <input id="etikett-datum" type="date" value={datum} max={heute} min={abfuelldatum ?? undefined}
            onChange={e => setDatum(e.target.value)} required className={inputCls} />
        </div>
        <div>
          <label htmlFor="etikett-menge" className="block text-xs font-medium text-s112-text-2 mb-1">Flaschen *</label>
          <input id="etikett-menge" type="number" min={1} max={bestandUnetikettiert} step={1} value={menge}
            onChange={e => setMenge(e.target.value)} required placeholder={`max. ${bestandUnetikettiert}`} className={inputCls} />
          <button type="button" onClick={() => setMenge(String(bestandUnetikettiert))}
            className="mt-1 text-xs text-s112-blue-700 hover:underline">Alle ({bestandUnetikettiert})</button>
        </div>
        <div>
          <label htmlFor="etikett-notizen" className="block text-xs font-medium text-s112-text-2 mb-1">Notiz</label>
          <input id="etikett-notizen" type="text" value={notizen} onChange={e => setNotizen(e.target.value)} className={inputCls} />
        </div>
      </div>
      <button type="submit" disabled={pending}
        className="bg-s112-teal text-s112-yellow px-4 py-2 rounded-lg text-sm font-medium hover:bg-s112-teal/90 disabled:opacity-50">
        {pending ? 'Wird gebucht …' : 'Etikettieren'}
      </button>
    </form>
  )
}

export function EtikettierungStorno({ id, fuellungId }: { id: string; fuellungId: string }) {
  const router = useRouter()
  return (
    <StornoButton schwebend
      action={grund => etikettierungStornieren(id, fuellungId, grund)}
      hinweis="Die Flaschen gelten wieder als unetikettiert – schon verkaufte bzw. ausgebuchte Flaschen verhindern das Stornieren."
      danach={() => router.refresh()} />
  )
}
