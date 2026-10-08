'use client'

// KAN-103 (08.10.2026): Lieferschein ohne Rechnung („Rechnung später“) – Rechnung erstellen. Datum (Standard heute) und
// Preise je Position (Entscheidung: Preise erst bei der Rechnung, vorbelegt aus dem Lieferschein); Nummer, Leistungszeitraum
// und das Umhängen bereits erfasster Zahlungen übernimmt die RPC s112_rechnung_erstellen.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { FileText } from 'lucide-react'
import { fehlerText } from '@/lib/fehler'
import { fmtNum } from '@/lib/format'

type Position = { id: string; name: string; menge: number; einheit: string | null; preis_brutto: number | null; rabatt_pct: number | null }

const inp = 'w-full border border-s112-border rounded-lg px-2 py-1.5 text-sm text-right tabular-nums focus:outline-hidden focus:ring-2 focus:ring-s112-teal/40 bg-white'
const zahlText = (n: number | null) => (n == null ? '' : String(n).replace('.', ','))

export default function RechnungErstellenPanel({ heute, lieferdatum, positionen, action }: {
  heute: string
  lieferdatum: string
  positionen: Position[]
  action: (formData: FormData) => Promise<{ rechnungId: string }>
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [offen, setOffen] = useState(false)
  const [fehler, setFehler] = useState<string | null>(null)

  function senden(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    setFehler(null)
    startTransition(async () => {
      try {
        await action(fd)
        setOffen(false)
        router.refresh()
      } catch (err) {
        setFehler(fehlerText(err, 'Rechnung konnte nicht erstellt werden'))
      }
    })
  }

  return (
    <div className="card p-4 no-print border-s112-warn/40">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-s112-text">
          <span className="inline-block text-xs font-semibold bg-s112-warn-bg text-s112-warn-fg px-2 py-0.5 rounded-full mr-2">Nicht berechnet</span>
          Für diesen Lieferschein gibt es noch keine Rechnung.
        </p>
        {!offen && (
          <button type="button" onClick={() => setOffen(true)} className="btn-primary inline-flex items-center gap-1.5 text-sm">
            <FileText size={15} aria-hidden /> Rechnung erstellen
          </button>
        )}
      </div>
      {offen && (
        <form onSubmit={senden} className="mt-4 space-y-3">
          <div className="max-w-[12rem]">
            <label htmlFor="rechnungsdatum" className="block text-xs font-medium text-s112-text-2 mb-1">Rechnungsdatum *</label>
            <input id="rechnungsdatum" name="rechnungsdatum" type="date" defaultValue={heute} min={lieferdatum} max={heute}
              className="w-full border border-s112-border rounded-lg px-2 py-1.5 text-sm bg-white" required />
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-s112-muted text-left">
                <th className="py-1 font-medium">Position</th>
                <th className="py-1 font-medium text-right w-20">Menge</th>
                <th className="py-1 font-medium text-right w-28">Preis brutto €</th>
                <th className="py-1 font-medium text-right w-24">Rabatt %</th>
              </tr>
            </thead>
            <tbody>
              {positionen.map(p => (
                <tr key={p.id} className="border-t border-s112-line">
                  <td className="py-1.5 pr-2">{p.name}</td>
                  <td className="py-1.5 text-right tabular-nums">{fmtNum(p.menge, { max: 2 })} {p.einheit ?? ''}</td>
                  <td className="py-1.5 pl-2">
                    <label htmlFor={`preis_${p.id}`} className="sr-only">Preis für {p.name}</label>
                    <input id={`preis_${p.id}`} name={`preis_${p.id}`} inputMode="decimal" defaultValue={zahlText(p.preis_brutto)} className={inp} />
                  </td>
                  <td className="py-1.5 pl-2">
                    <label htmlFor={`rabatt_${p.id}`} className="sr-only">Rabatt für {p.name}</label>
                    <input id={`rabatt_${p.id}`} name={`rabatt_${p.id}`} inputMode="decimal" defaultValue={zahlText(p.rabatt_pct ?? 0)} className={inp} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div>
            <label htmlFor="rechnung_notizen" className="block text-xs font-medium text-s112-text-2 mb-1">Notiz zur Rechnung</label>
            <input id="rechnung_notizen" name="rechnung_notizen" className="w-full border border-s112-border rounded-lg px-2 py-1.5 text-sm bg-white" />
          </div>
          {fehler && <p role="alert" className="text-sm text-s112-err">{fehler}</p>}
          <div className="flex gap-2">
            <button type="submit" disabled={pending} className="btn-primary text-sm">{pending ? 'Erstellt …' : 'Rechnung erstellen'}</button>
            <button type="button" onClick={() => { setOffen(false); setFehler(null) }} className="btn-secondary text-sm">Abbrechen</button>
          </div>
        </form>
      )}
    </div>
  )
}
