'use client'

// KAN-232: Formular „Grundwein zur Lohnversektung versenden“ – Charge, Sektkellerei, Datum, Notizen.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { fmtNum } from '@/lib/format'
import { versandFehler } from '@/lib/kellerbuch/lohnversektung'
import { lohnversektungVersenden } from '../actions'
import { fehlerText } from '@/lib/fehler'
import { AbbrechenKnopf } from '@/components/navigation/Abbrechen'
import { zielNachVorgang } from '@/lib/navigation/zurueckBrowser'

type Charge = { id: string; name: string; liter: number; gebinde: string | null }
type Firma = { id: string; name: string }

export default function VersandForm({ chargen, firmen, heute, vorauswahl }: { chargen: Charge[]; firmen: Firma[]; heute: string; vorauswahl: string | null }) {
  const router = useRouter()
  const [weinausbauId, setWeinausbauId] = useState(vorauswahl && chargen.some(c => c.id === vorauswahl) ? vorauswahl : '')
  const [firmaId, setFirmaId] = useState('')
  const [datum, setDatum] = useState(heute)
  const [notizen, setNotizen] = useState('')
  const [fehler, setFehler] = useState<string | null>(null)
  const [laeuft, starten] = useTransition()
  const charge = chargen.find(c => c.id === weinausbauId) ?? null

  const senden = (e: React.FormEvent) => {
    e.preventDefault()
    const f = versandFehler({ weinausbauId, firmaId, datum, heute })
    if (f) { setFehler(f); return }
    setFehler(null)
    starten(async () => {
      try {
        await lohnversektungVersenden({ weinausbauId, firmaId, datum, notizen })
        router.push(zielNachVorgang('/kellerbuch/lohnversektung', 'gespeichert'))   // KAN-334: zurück im selben Bereich (z. B. Charge)
      } catch (err) {
        setFehler(fehlerText(err))
      }
    })
  }

  const feld = 'w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-hidden focus:ring-2 focus:ring-s112-teal/40'
  return (
    <form onSubmit={senden} className="card p-5 space-y-4">
      <label className="block text-sm space-y-1">
        <span className="font-medium text-s112-text-1">Grundwein-Charge *</span>
        <select value={weinausbauId} onChange={e => setWeinausbauId(e.target.value)} required className={feld}>
          <option value="">– Charge wählen –</option>
          {chargen.map(c => <option key={c.id} value={c.id}>{c.name} · {fmtNum(c.liter, { max: 2 })} L{c.gebinde ? ` · ${c.gebinde}` : ''}</option>)}
        </select>
        {charge && <span className="block text-xs text-s112-muted">Versendet werden {fmtNum(charge.liter, { max: 2 })} L – die ganze Charge.</span>}
      </label>
      <label className="block text-sm space-y-1">
        <span className="font-medium text-s112-text-1">Sektkellerei (Versekter) *</span>
        <select value={firmaId} onChange={e => setFirmaId(e.target.value)} required className={feld}>
          <option value="">– Firma wählen –</option>
          {firmen.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
        </select>
      </label>
      <label className="block text-sm space-y-1">
        <span className="font-medium text-s112-text-1">Versanddatum *</span>
        <input type="date" value={datum} max={heute} onChange={e => setDatum(e.target.value)} required className={feld} />
      </label>
      <label className="block text-sm space-y-1">
        <span className="font-medium text-s112-text-1">Notizen</span>
        <textarea value={notizen} onChange={e => setNotizen(e.target.value)} rows={2} className={feld} />
      </label>
      {fehler && <p className="text-sm text-s112-err-fg" role="alert">{fehler}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <button type="submit" disabled={laeuft} className="btn-primary disabled:opacity-50">{laeuft ? 'Wird gebucht …' : 'Versand buchen'}</button>
        <AbbrechenKnopf standard="/kellerbuch/lohnversektung" />{/* KAN-333 */}
      </div>
    </form>
  )
}
