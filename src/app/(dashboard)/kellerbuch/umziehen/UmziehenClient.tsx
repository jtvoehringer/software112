'use client'

import { useState, useTransition } from 'react'
import { umziehen } from './actions'

type BehaelterMitCharge = {
  behaelter_id:   string
  behaelter_name: string
  charge_id:      string
  charge_name:    string
  jahrgang:       number | null
  menge_liter:    number
}
type Behaelter = { id: string; name: string; kapazitaet_liter: number | null }
type UmzugRow  = { id: string; von_name: string; nach_name: string; menge_liter: number; schwund_liter: number; datum: string; notizen: string | null }

function fmt(n: number | null) {
  if (n == null) return '–'
  return n.toLocaleString('de-AT', { minimumFractionDigits: 0, maximumFractionDigits: 1 }) + ' L'
}

// Quell-Zeile: Behälter wählen → Charge und Menge werden auto-gefüllt
function QuelleZeile({
  quellen, value, menge, onChange, onRemove,
}: {
  quellen:  BehaelterMitCharge[]
  value:    string   // behaelter_id
  menge:    string
  onChange: (behId: string, menge: string) => void
  onRemove: () => void
}) {
  const selected = quellen.find(q => q.behaelter_id === value) ?? null
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2 flex-wrap">
        <select
          value={value}
          onChange={e => {
            const beh = quellen.find(q => q.behaelter_id === e.target.value)
            onChange(e.target.value, beh ? String(beh.menge_liter) : '')
          }}
          required
          className="border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40 flex-1 min-w-[220px]"
        >
          <option value="">– Behälter wählen –</option>
          {quellen.map(q => (
            <option key={q.behaelter_id} value={q.behaelter_id}>
              {q.behaelter_name} · {q.charge_name}{q.jahrgang ? ` ${q.jahrgang}` : ''} · {fmt(q.menge_liter)}
            </option>
          ))}
        </select>
        <input
          type="number"
          value={menge}
          onChange={e => onChange(value, e.target.value)}
          min="0.001"
          step="0.001"
          max={selected?.menge_liter ?? undefined}
          placeholder="Liter"
          required
          className="border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40 w-28 tabular-nums"
        />
        <span className="text-xs text-s112-muted w-8">L</span>
        {selected && (
          <span className="text-xs text-s112-muted">max {fmt(selected.menge_liter)}</span>
        )}
        <button type="button" onClick={onRemove} className="text-xs text-red-400 hover:text-red-600 px-1">✕</button>
      </div>
      {selected && (
        <p className="text-xs text-s112-muted pl-1">
          Charge: <span className="font-medium text-gray-600">{selected.charge_name}</span>
        </p>
      )}
    </div>
  )
}

function ZielZeile({
  behaelter, value, menge, onChange, onRemove,
}: {
  behaelter: Behaelter[]
  value:     string
  menge:     string
  onChange:  (id: string, menge: string) => void
  onRemove:  () => void
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

function UmziehenForm({ quellen, behaelter }: { quellen: BehaelterMitCharge[]; behaelter: Behaelter[] }) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [datum, setDatum]     = useState(new Date().toISOString().split('T')[0])
  const [notizen, setNotizen] = useState('')

  type QEntry = { id: string; behId: string; menge: string }
  type ZEntry = { id: string; behId: string; menge: string }

  const [quellenState, setQuellen] = useState<QEntry[]>([{ id: crypto.randomUUID(), behId: '', menge: '' }])
  const [ziele, setZiele]         = useState<ZEntry[]>([{ id: crypto.randomUUID(), behId: '', menge: '' }])

  const totalVon  = quellenState.reduce((s, q) => s + (parseFloat(q.menge) || 0), 0)
  const totalNach = ziele.reduce((s, z)         => s + (parseFloat(z.menge) || 0), 0)
  const schwund   = Math.max(0, +(totalVon - totalNach).toFixed(3))

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (quellenState.some(q => !q.behId || !q.menge)) { setError('Alle Quell-Zeilen ausfüllen.'); return }
    if (ziele.some(z => !z.behId || !z.menge))         { setError('Alle Ziel-Zeilen ausfüllen.'); return }
    if (schwund < 0)                                    { setError('Ziel-Menge größer als Quell-Menge.'); return }

    // Behälter → weinausbau_id auflösen
    const quellenResolved = quellenState.map(q => {
      const match = quellen.find(x => x.behaelter_id === q.behId)
      if (!match) throw new Error(`Keine Charge für Behälter gefunden`)
      return { weinausbau_id: match.charge_id, menge: parseFloat(q.menge) }
    })

    const fd = new FormData()
    fd.set('quellen_json', JSON.stringify(quellenResolved))
    fd.set('ziele_json',   JSON.stringify(ziele.map(z => ({ behaelter_id: z.behId, menge: parseFloat(z.menge) }))))
    fd.set('datum', datum)
    fd.set('notizen', notizen)
    startTransition(async () => {
      try { await umziehen(fd) }
      catch (err) { setError(err instanceof Error ? err.message : 'Fehler') }
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

      {/* Von-Behälter */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-700">Von Behälter (Quelle)</h3>
          <button type="button"
            onClick={() => setQuellen(p => [...p, { id: crypto.randomUUID(), behId: '', menge: '' }])}
            className="text-xs text-s112-teal hover:underline">
            + Quelle
          </button>
        </div>
        {quellenState.map(q => (
          <QuelleZeile key={q.id}
            quellen={quellen}
            value={q.behId}
            menge={q.menge}
            onChange={(bId, m) => setQuellen(p => p.map(x => x.id === q.id ? { ...x, behId: bId, menge: m } : x))}
            onRemove={() => quellenState.length > 1 && setQuellen(p => p.filter(x => x.id !== q.id))}
          />
        ))}
        <div className="text-xs text-s112-muted text-right tabular-nums">
          Gesamt: <span className="font-semibold text-gray-700">{fmt(totalVon)}</span>
        </div>
      </div>

      {/* Nach-Behälter */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-700">Nach Behälter (Ziel)</h3>
          <button type="button"
            onClick={() => setZiele(p => [...p, { id: crypto.randomUUID(), behId: '', menge: '' }])}
            className="text-xs text-s112-teal hover:underline">
            + Ziel
          </button>
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

      {/* Schwund */}
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
        {pending
          ? 'Wird verarbeitet…'
          : `Umziehen (${fmt(totalVon)} → ${fmt(totalNach)}${schwund > 0 ? `, ${fmt(schwund)} Schwund` : ''})`}
      </button>
    </form>
  )
}

// ── Hauptkomponente ───────────────────────────────────────────────────────────

export default function UmziehenClient({
  behaelterMitChargen, behaelter, umzuege, writeOk,
}: {
  behaelterMitChargen: BehaelterMitCharge[]
  behaelter:           Behaelter[]
  umzuege:             UmzugRow[]
  writeOk:             boolean
}) {
  const [showForm, setShowForm] = useState(false)

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Umziehen</h1>
          <p className="text-sm text-s112-muted mt-0.5">Wein zwischen Behältern verschieben · Schwund wird automatisch berechnet</p>
        </div>
        {writeOk && (
          <button onClick={() => setShowForm(o => !o)}
            className="bg-s112-teal text-white px-4 py-2 rounded-xl text-sm font-semibold hover:bg-opacity-90">
            {showForm ? 'Abbrechen' : '＋ Neuer Umzug'}
          </button>
        )}
      </div>

      {showForm && writeOk && (
        <UmziehenForm quellen={behaelterMitChargen} behaelter={behaelter} />
      )}

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
                  <th className="text-left px-4 py-2.5 font-semibold text-gray-700">Von</th>
                  <th className="text-left px-4 py-2.5 font-semibold text-gray-700">Nach Behälter</th>
                  <th className="text-right px-4 py-2.5 font-semibold text-gray-700">Menge</th>
                  <th className="text-right px-4 py-2.5 font-semibold text-gray-700">Schwund</th>
                </tr>
              </thead>
              <tbody>
                {umzuege.map((u, i) => (
                  <tr key={i} className="border-b border-s112-border last:border-0 hover:bg-s112-bg/50">
                    <td className="px-4 py-2.5 tabular-nums text-s112-muted text-xs">
                      {new Date(u.datum).toLocaleDateString('de-AT')}
                    </td>
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
