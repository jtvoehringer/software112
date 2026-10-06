'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { verarbeitungBuchen } from '../../../actions'
import { fehlerText } from '@/lib/fehler'
import { fmtNum, zahlAus } from '@/lib/format'
import { VERARBEITUNG_ZWECKE, verarbeitungFehler } from '@/lib/kellerbuch/verarbeitung'

// KAN-41 Paket 3a: Formular „Verarbeiten“ – Datum, Menge (höchstens der Bestand), Zweck, Notiz
export default function VerarbeitenForm({ chargeId, bestand, heute }: { chargeId: string; bestand: number; heute: string }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [datum, setDatum] = useState(heute)
  const [menge, setMenge] = useState('')
  const [zweck, setZweck] = useState('')
  const [notizen, setNotizen] = useState('')
  const [fehler, setFehler] = useState<string | null>(null)
  const inputCls = 'w-full border border-s112-border rounded-lg px-3 py-2.5 sm:py-1.5 text-base sm:text-sm focus:outline-hidden focus:ring-2 focus:ring-s112-teal/40'

  function absenden(e: React.FormEvent) {
    e.preventDefault()
    setFehler(null)
    const f = verarbeitungFehler({ zweck, menge: zahlAus(menge), bestand, datum, heute })
    if (f) { setFehler(f); return }
    const fd = new FormData()
    fd.set('weinausbau_id', chargeId)
    fd.set('datum', datum)
    fd.set('menge', menge)
    fd.set('zweck', zweck)
    fd.set('notizen', notizen)
    startTransition(async () => {
      try {
        await verarbeitungBuchen(fd)
        setMenge('')
        setNotizen('')
        router.refresh()
      } catch (err) {
        setFehler(fehlerText(err, 'Verarbeitung konnte nicht gebucht werden'))
      }
    })
  }

  return (
    <form onSubmit={absenden} className="card p-4 space-y-4">
      {fehler && <div role="alert" className="bg-s112-err-bg border border-s112-err/30 text-s112-err-fg px-3 py-2 rounded-lg text-sm">{fehler}</div>}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div>
          <label htmlFor="verarbeitung-datum" className="block text-xs font-medium text-s112-text-2 mb-1">Datum *</label>
          <input id="verarbeitung-datum" type="date" value={datum} max={heute} onChange={e => setDatum(e.target.value)} required className={inputCls} />
        </div>
        <div>
          <label htmlFor="verarbeitung-menge" className="block text-xs font-medium text-s112-text-2 mb-1">Menge (L) *</label>
          <input id="verarbeitung-menge" type="text" inputMode="decimal" value={menge} onChange={e => setMenge(e.target.value)} required
            placeholder={`max. ${fmtNum(bestand)}`} className={inputCls} />
          <button type="button" onClick={() => setMenge(String(bestand).replace('.', ','))}
            className="mt-1 text-xs text-s112-blue-700 hover:underline">Ganze Menge ({fmtNum(bestand)} L)</button>
        </div>
        <div>
          <label htmlFor="verarbeitung-zweck" className="block text-xs font-medium text-s112-text-2 mb-1">Zweck *</label>
          <select id="verarbeitung-zweck" value={zweck} onChange={e => setZweck(e.target.value)} required className={inputCls}>
            <option value="">– bitte wählen –</option>
            {VERARBEITUNG_ZWECKE.map(z => <option key={z.value} value={z.value}>{z.label}</option>)}
          </select>
        </div>
      </div>
      <div>
        <label htmlFor="verarbeitung-notizen" className="block text-xs font-medium text-s112-text-2 mb-1">Notiz</label>
        <input id="verarbeitung-notizen" type="text" value={notizen} onChange={e => setNotizen(e.target.value)}
          placeholder="z. B. Abnehmer, Beleg" className={inputCls} />
      </div>
      <button type="submit" disabled={pending}
        className="bg-s112-teal text-s112-yellow px-4 py-2 rounded-lg text-sm font-medium hover:bg-s112-teal/90 disabled:opacity-50">
        {pending ? 'Wird gebucht …' : 'Verarbeitung buchen'}
      </button>
    </form>
  )
}
