'use client'

import { useState, useTransition } from 'react'
import { createVerschneidung } from '@/app/(dashboard)/kellerbuch/actions'

type ChargeOpt = { id: string; name: string; menge_liter: number | null }

interface Props {
  zielCharge: ChargeOpt          // aktuelle Charge = Ziel der Verschneidung
  alleChargen: ChargeOpt[]       // alle anderen aktiven Chargen = mögliche Quellen
  onDone: () => void
}

export default function VerschneidungForm({ zielCharge, alleChargen, onDone }: Props) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  // Quellen: Liste von { weinausbau_id, menge_liter (als String für Eingabe) }
  const [quellen, setQuellen] = useState<{ weinausbau_id: string; menge: string }[]>([
    { weinausbau_id: '', menge: '' },
  ])

  const verfuegbar = alleChargen.filter(c => c.id !== zielCharge.id)

  function addQuelle() {
    setQuellen(q => [...q, { weinausbau_id: '', menge: '' }])
  }
  function removeQuelle(i: number) {
    setQuellen(q => q.filter((_, idx) => idx !== i))
  }
  function updateQuelle(i: number, field: 'weinausbau_id' | 'menge', val: string) {
    setQuellen(q => q.map((r, idx) => idx === i ? { ...r, [field]: val } : r))
  }

  const gesamtLiter = quellen.reduce((s, q) => {
    const n = parseFloat(q.menge.replace(',', '.'))
    return s + (isNaN(n) ? 0 : n)
  }, 0)

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    const parsed = quellen
      .map(q => ({ weinausbau_id: q.weinausbau_id, menge_liter: parseFloat(q.menge.replace(',', '.')) }))
      .filter(q => q.weinausbau_id && !isNaN(q.menge_liter) && q.menge_liter > 0)
    if (parsed.length === 0) { setError('Mindestens eine Quell-Charge mit Menge angeben.'); return }
    const fd = new FormData(e.currentTarget)
    fd.set('quellen_json', JSON.stringify(parsed))
    fd.set('ziel_weinausbau_id', zielCharge.id)
    startTransition(async () => {
      try {
        await createVerschneidung(fd)
        onDone()
      } catch (err) {
        setError((err as Error).message)
      }
    })
  }

  const inputCls = 'border border-s112-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40'

  return (
    <form onSubmit={handleSubmit} className="bg-indigo-50/40 border border-indigo-100 rounded-xl p-4 space-y-4">
      <div className="flex items-center gap-2">
        <span className="text-lg">🍷</span>
        <h3 className="text-sm font-semibold text-gray-800">Verschneidung in <span className="text-s112-teal">{zielCharge.name}</span></h3>
      </div>

      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">Datum</label>
        <input name="datum" type="date" required
          defaultValue={new Date().toISOString().split('T')[0]}
          className={`${inputCls} w-48`} />
      </div>

      {/* Quell-Chargen */}
      <div className="space-y-2">
        <label className="block text-xs font-medium text-gray-600">Quell-Chargen</label>
        {quellen.map((q, i) => {
          const src = verfuegbar.find(c => c.id === q.weinausbau_id)
          const menge = parseFloat(q.menge.replace(',', '.'))
          const anteil = gesamtLiter > 0 && !isNaN(menge) ? Math.round(menge / gesamtLiter * 1000) / 10 : null
          return (
            <div key={i} className="flex items-center gap-2">
              <select
                value={q.weinausbau_id}
                onChange={e => updateQuelle(i, 'weinausbau_id', e.target.value)}
                className={`${inputCls} flex-1`}
              >
                <option value="">– Charge wählen –</option>
                {verfuegbar.map(c => (
                  <option key={c.id} value={c.id}>
                    {c.name}{c.menge_liter != null ? ` (${c.menge_liter.toLocaleString('de-AT')} L)` : ''}
                  </option>
                ))}
              </select>
              <div className="flex items-center gap-1">
                <input
                  type="text" inputMode="decimal" placeholder="Liter"
                  value={q.menge}
                  onChange={e => updateQuelle(i, 'menge', e.target.value)}
                  className={`${inputCls} w-28`}
                />
                {anteil != null && (
                  <span className="text-xs text-indigo-600 font-medium w-14 text-right tabular-nums">{anteil} %</span>
                )}
                {src && <span className="text-xs text-s112-muted w-10 tabular-nums">max {src.menge_liter?.toLocaleString('de-AT')}</span>}
              </div>
              {quellen.length > 1 && (
                <button type="button" onClick={() => removeQuelle(i)}
                  className="text-red-400 hover:text-red-600 text-lg leading-none px-1">×</button>
              )}
            </div>
          )
        })}
        <button type="button" onClick={addQuelle}
          className="text-xs text-s112-teal hover:underline font-medium">
          + Weitere Quelle
        </button>
      </div>

      {gesamtLiter > 0 && (
        <p className="text-xs text-indigo-700 bg-indigo-50 border border-indigo-100 rounded-lg px-3 py-2">
          Gesamt zufließend: <strong>{gesamtLiter.toLocaleString('de-AT', { maximumFractionDigits: 1 })} L</strong>
          {' → '}Zielbestand: <strong>{(parseFloat(String(zielCharge.menge_liter ?? 0)) + gesamtLiter).toLocaleString('de-AT', { maximumFractionDigits: 1 })} L</strong>
        </p>
      )}

      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">Notizen</label>
        <input name="notizen" className={`${inputCls} w-full`} placeholder="optional" />
      </div>

      {error && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}

      <div className="flex gap-2 pt-1">
        <button type="submit" disabled={pending}
          className="bg-indigo-600 text-white px-4 py-1.5 rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 transition-colors">
          {pending ? 'Speichert…' : 'Verschneidung speichern'}
        </button>
        <button type="button" onClick={onDone}
          className="px-4 py-1.5 rounded-lg text-sm font-medium text-gray-600 hover:text-gray-800">
          Abbrechen
        </button>
      </div>
    </form>
  )
}
