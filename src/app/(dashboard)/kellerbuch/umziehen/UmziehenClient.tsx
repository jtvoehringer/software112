'use client'

import { useState, useTransition } from 'react'
import { umziehen } from './actions'

type Charge    = { id: string; name: string; jahrgang: number | null; menge_liter: number | null; behaelter_name: string | null }
type Behaelter = { id: string; name: string; kapazitaet_liter: number | null }
type UmzugRow  = { id: string; von_name: string; nach_name: string; menge_liter: number; schwund_liter: number; datum: string; notizen: string | null }

function fmt(n: number | null) {
  if (n == null) return '–'
  return n.toLocaleString('de-AT', { minimumFractionDigits: 0, maximumFractionDigits: 1 }) + ' L'
}

function QuelleZeile({
  chargen, value, menge, maxMenge, onChange, onRemove,
}: {
  chargen: Charge[]
  value: string
  menge: string
  maxMenge: number | null
  onChange: (id: string, menge: string) => void
  onRemove: () => void
}) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <select
        value={value}
        onChange={e => onChange(e.target.value, menge)}
        required
        className="border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40 flex-1 min-w-[200px]"
      >
        <option value="">– Charge wählen –</option>
        {chargen.map(c => (
          <option key={c.id} value={c.id}>
            {c.name}{c.jahrgang ? ` ${c.jahrgang}` : ''} · {fmt(c.menge_liter)}
            {c.behaelter_name ? ` (${c.behaelter_name})` : ''}
          </option>
        ))}
      </select>
      <input
        type="number"
        value={menge}
        onChange={e => onChange(value, e.target.value)}
        min="0.001"
        step="0.001"
        max={maxMenge ?? undefined}
        placeholder="Liter"
        required
        className="border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40 w-28 tabular-nums"
      />
      <span className="text-xs text-s112-muted w-8">L</span>
      {maxMenge != null && menge && (
        <span className="text-xs text-s112-muted">max {fmt(maxMenge)}</span>
      )}
      <button type="button" onClick={onRemove} className="text-xs text-red-400 hover:text-red-600 px-1">✕</button>
    </div>
  )
}

function ZielZeile({
  behaelter, value, menge, onChange, onRemove,
}: {
  behaelter: Behaelter[]
  value: string
  menge: string
  onChange: (id: string, menge: string) => void
  onRemove: () => void
}) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <select
        value={value}
        onChange={e => onChange(e.target.value, menge)}
        required
        className="border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40 flex-1 min-w-[200px]"
      >
        <option value="">– Behälter wählen –</option>
        {behaelter.map(b => (
          <option key={b.id} value={b.id}>
            {b.name}{b.kapazitaet_liter ? ` (${fmt(b.kapazitaet_liter)})` : ''}
          </option>
        ))}
      </select>
      <input
        type="number"
        value={menge}
        onChange={e => onChange(value, e.target.value)}
        min="0.001"
        step="0.001"
        placeholder="Liter"
        required
        className="border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40 w-28 tabular-nums"
      />
      <span className="text-xs text-s112-muted w-8">L</span>
      <button type="button" onClick={onRemove} className="text-xs text-red-400 hover:text-red-600 px-1">✕</button>
    </div>
  )
}

// ── Formular ──────────────────────────────────────────────────────────────────

function UmziehenForm({ chargen, behaelter }: { chargen: Charge[]; behaelter: Behaelter[] }) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [datum, setDatum]     = useState(new Date().toISOString().split('T')[0])
  const [notizen, setNotizen] = useState('')

  type QEntry = { id: string; chargeId: string; menge: string }
  type ZEntry = { id: string; behId: string;   menge: string }

  const [quellen, setQuellen] = useState<QEntry[]>([{ id: crypto.randomUUID(), chargeId: '', menge: '' }])
  const [ziele,   setZiele]   = useState<ZEntry[]>([{ id: crypto.randomUUID(), behId:     '', menge: '' }])

  const totalVon  = quellen.reduce((s, q) => s + (parseFloat(q.menge) || 0), 0)
  const totalNach = ziele.reduce((s, z)   => s + (parseFloat(z.menge) || 0), 0)
  const schwund   = Math.max(0, +(totalVon - totalNach).toFixed(3))

  function updateQuelle(id: string, chargeId: string, menge: string) {
    setQuellen(prev => prev.map(q => q.id === id ? { ...q, chargeId, menge } : q))
    // Auto-fill menge when charge selected and menge empty
    if (chargeId && !menge) {
      const c = chargen.find(x => x.id === chargeId)
      if (c?.menge_liter) {
        setQuellen(prev => prev.map(q => q.id === id ? { ...q, chargeId, menge: String(c.menge_liter) } : q))
      }
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (quellen.some(q => !q.chargeId || !q.menge)) { setError('Alle Quell-Zeilen ausfüllen.'); return }
    if (ziele.some(z => !z.behId || !z.menge))       { setError('Alle Ziel-Zeilen ausfüllen.'); return }
    if (schwund < 0) { setError('Ziel-Menge größer als Quell-Menge.'); return }

    const fd = new FormData()
    fd.set('quellen_json', JSON.stringify(quellen.map(q => ({ weinausbau_id: q.chargeId, menge: parseFloat(q.menge) }))))
    fd.set('ziele_json',   JSON.stringify(ziele.map(z => ({ behaelter_id: z.behId, menge: parseFloat(z.menge) }))))
    fd.set('datum', datum)
    fd.set('notizen', notizen)
    startTransition(async () => {
      try { await umziehen(fd) }
      catch (err) { setError(err instanceof Error ? err.message : 'Fehler'); }
    })
  }

  return (
    <form onSubmit={handleSubmit} className="card p-5 space-y-5">
      {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-2 text-sm">{error}</div>}

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Datum *</label>
          <input type="date" value={datum} onChange={e => setDatum(e.target.value)} required
            className="border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40 w-full" />
        </div>
      </div>

      {/* Von-Zeilen */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-700">Von (Quellen)</h3>
          <button type="button" onClick={() => setQuellen(p => [...p, { id: crypto.randomUUID(), chargeId: '', menge: '' }])}
            className="text-xs text-s112-teal hover:underline">+ Quelle</button>
        </div>
        {quellen.map(q => {
          const c = chargen.find(x => x.id === q.chargeId)
          return (
            <QuelleZeile key={q.id} chargen={chargen}
              value={q.chargeId} menge={q.menge}
              maxMenge={c?.menge_liter ?? null}
              onChange={(cId, m) => updateQuelle(q.id, cId, m)}
              onRemove={() => quellen.length > 1 && setQuellen(p => p.filter(x => x.id !== q.id))} />
          )
        })}
        <div className="text-xs text-s112-muted text-right tabular-nums">
          Gesamt: <span className="font-semibold text-gray-700">{fmt(totalVon)}</span>
        </div>
      </div>

      {/* Nach-Zeilen */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-700">Nach (Ziele)</h3>
          <button type="button" onClick={() => setZiele(p => [...p, { id: crypto.randomUUID(), behId: '', menge: '' }])}
            className="text-xs text-s112-teal hover:underline">+ Ziel</button>
        </div>
        {ziele.map(z => (
          <ZielZeile key={z.id} behaelter={behaelter}
            value={z.behId} menge={z.menge}
            onChange={(bId, m) => setZiele(p => p.map(x => x.id === z.id ? { ...x, behId: bId, menge: m } : x))}
            onRemove={() => ziele.length > 1 && setZiele(p => p.filter(x => x.id !== z.id))} />
        ))}
        <div className="text-xs text-s112-muted text-right tabular-nums">
          Gesamt: <span className="font-semibold text-gray-700">{fmt(totalNach)}</span>
        </div>
      </div>

      {/* Auto-Schwund */}
      <div className={`flex items-center justify-between px-4 py-2.5 rounded-lg ${schwund > 0 ? 'bg-amber-50 border border-amber-200' : 'bg-s112-bg border border-s112-border'}`}>
        <span className="text-sm font-medium text-gray-700">Schwund (auto-berechnet)</span>
        <span className={`text-sm font-bold tabular-nums ${schwund > 0 ? 'text-amber-700' : 'text-s112-muted'}`}>{fmt(schwund)}</span>
      </div>

      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">Notizen</label>
        <input type="text" value={notizen} onChange={e => setNotizen(e.target.value)}
          className="border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40 w-full"
          placeholder="Optional" />
      </div>

      <button type="submit" disabled={pending}
        className="bg-s112-teal text-white px-5 py-2 rounded-xl text-sm font-semibold hover:bg-opacity-90 disabled:opacity-40 w-full">
        {pending ? 'Wird verarbeitet…' : `Umziehen (${fmt(totalVon)} → ${fmt(totalNach)}${schwund > 0 ? `, ${fmt(schwund)} Schwund` : ''})`}
      </button>
    </form>
  )
}

// ── Hauptkomponente ───────────────────────────────────────────────────────────

export default function UmziehenClient({
  chargen, behaelter, umzuege, writeOk,
}: {
  chargen:   Charge[]
  behaelter: Behaelter[]
  umzuege:   UmzugRow[]
  writeOk:   boolean
}) {
  const [showForm, setShowForm] = useState(false)

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Umziehen</h1>
          <p className="text-sm text-s112-muted mt-0.5">Chargen zwischen Behältern verschieben · Schwund wird automatisch berechnet</p>
        </div>
        {writeOk && (
          <button onClick={() => setShowForm(o => !o)}
            className="bg-s112-teal text-white px-4 py-2 rounded-xl text-sm font-semibold hover:bg-opacity-90">
            {showForm ? 'Abbrechen' : '＋ Neuer Umzug'}
          </button>
        )}
      </div>

      {showForm && writeOk && <UmziehenForm chargen={chargen} behaelter={behaelter} />}

      {/* Protokoll */}
      <div className="space-y-2">
        <h2 className="text-base font-semibold text-gray-800">Umzug-Protokoll</h2>
        {umzuege.length === 0 ? (
          <div className="card p-6 text-center text-s112-muted text-sm">Noch keine Umzüge protokolliert.</div>
        ) : (
          <div className="card p-0 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-s112-bg border-b border-s112-border">
                  <th className="text-left px-4 py-2.5 font-semibold text-gray-700">Datum</th>
                  <th className="text-left px-4 py-2.5 font-semibold text-gray-700">Von Charge</th>
                  <th className="text-left px-4 py-2.5 font-semibold text-gray-700">Nach Behälter</th>
                  <th className="text-right px-4 py-2.5 font-semibold text-gray-700">Menge</th>
                  <th className="text-right px-4 py-2.5 font-semibold text-gray-700">Schwund</th>
                </tr>
              </thead>
              <tbody>
                {umzuege.map((u, i) => (
                  <tr key={i} className="border-b border-s112-border last:border-0 hover:bg-s112-bg/50">
                    <td className="px-4 py-2.5 tabular-nums text-s112-muted text-xs">{new Date(u.datum).toLocaleDateString('de-AT')}</td>
                    <td className="px-4 py-2.5 font-medium text-gray-800">{u.von_name}</td>
                    <td className="px-4 py-2.5 text-gray-600">{u.nach_name}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-s112-teal font-semibold">{fmt(u.menge_liter)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-s112-muted">
                      {u.schwund_liter > 0 ? fmt(u.schwund_liter) : '–'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
