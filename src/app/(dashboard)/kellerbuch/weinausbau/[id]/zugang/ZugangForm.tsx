'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { zugangskorrekturBuchen, zugangskorrekturStornieren } from '../../../actions'
import { fehlerText } from '@/lib/fehler'
import { zahlAus } from '@/lib/format'
import { ZUGANGSKORREKTUR_ARTEN, zugangskorrekturFehler } from '@/lib/kellerbuch/zugangskorrektur'
import StornoButton from '@/components/StornoButton'

// KAN-53: Formular „Zugang korrigieren“ – Datum, Menge, Art, Grund; Prüfnummern-Rückfrage per window.confirm
export default function ZugangForm({ chargeId, heute }: { chargeId: string; heute: string }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [datum, setDatum] = useState(heute)
  const [menge, setMenge] = useState('')
  const [art, setArt] = useState('')
  const [grund, setGrund] = useState('')
  const [fehler, setFehler] = useState<string | null>(null)
  const inputCls = 'w-full border border-s112-border rounded-lg px-3 py-2.5 sm:py-1.5 text-base sm:text-sm focus:outline-hidden focus:ring-2 focus:ring-s112-teal/40'

  function absenden(e: React.FormEvent) {
    e.preventDefault()
    setFehler(null)
    const f = zugangskorrekturFehler({ art, menge: zahlAus(menge), grund, datum, heute })
    if (f) { setFehler(f); return }
    const fd = new FormData()
    fd.set('weinausbau_id', chargeId)
    fd.set('datum', datum)
    fd.set('menge', menge)
    fd.set('art', art)
    fd.set('grund', grund)
    startTransition(async () => {
      try {
        const r = await zugangskorrekturBuchen(fd)
        if (r?.bestaetigung) {
          if (!window.confirm(r.bestaetigung)) return
          fd.set('pn_bestaetigt', '1')
          await zugangskorrekturBuchen(fd)
        }
        setMenge('')
        setGrund('')
        router.refresh()
      } catch (err) {
        setFehler(fehlerText(err, 'Zugangskorrektur konnte nicht gebucht werden'))
      }
    })
  }

  return (
    <form onSubmit={absenden} className="card p-4 space-y-4">
      {fehler && <div role="alert" className="bg-s112-err-bg border border-s112-err/30 text-s112-err-fg px-3 py-2 rounded-lg text-sm">{fehler}</div>}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div>
          <label htmlFor="zugang-datum" className="block text-xs font-medium text-s112-text-2 mb-1">Datum *</label>
          <input id="zugang-datum" type="date" value={datum} max={heute} onChange={e => setDatum(e.target.value)} required className={inputCls} />
        </div>
        <div>
          <label htmlFor="zugang-menge" className="block text-xs font-medium text-s112-text-2 mb-1">Zusätzliche Menge (L) *</label>
          <input id="zugang-menge" type="text" inputMode="decimal" value={menge} onChange={e => setMenge(e.target.value)} required className={inputCls} />
        </div>
        <div>
          <label htmlFor="zugang-art" className="block text-xs font-medium text-s112-text-2 mb-1">Art *</label>
          <select id="zugang-art" value={art} onChange={e => setArt(e.target.value)} required className={inputCls}>
            <option value="">– bitte wählen –</option>
            {ZUGANGSKORREKTUR_ARTEN.map(a => <option key={a.value} value={a.value}>{a.label}</option>)}
          </select>
        </div>
      </div>
      <div>
        <label htmlFor="zugang-grund" className="block text-xs font-medium text-s112-text-2 mb-1">Grund * (mind. 10 Zeichen, steht im Kellerbuch)</label>
        <input id="zugang-grund" type="text" value={grund} onChange={e => setGrund(e.target.value)} required
          placeholder="z. B. Inventur 30.09.: Tank 3 nachgemessen, 12 L mehr" className={inputCls} />
      </div>
      <button type="submit" disabled={pending}
        className="bg-s112-teal text-s112-yellow px-4 py-2 rounded-lg text-sm font-medium hover:bg-s112-teal/90 disabled:opacity-50">
        {pending ? 'Wird gebucht …' : 'Zugang buchen'}
      </button>
    </form>
  )
}

export function ZugangStorno({ id, chargeId }: { id: string; chargeId: string }) {
  const router = useRouter()
  return (
    <StornoButton schwebend
      action={grund => zugangskorrekturStornieren(id, chargeId, grund)}
      hinweis="Die Menge geht wieder von der Charge ab; im Kellerbuch steht eine Gegenbuchung am heutigen Tag. Eine dadurch erloschene Prüfnummer gilt wieder."
      danach={() => router.refresh()} />
  )
}
