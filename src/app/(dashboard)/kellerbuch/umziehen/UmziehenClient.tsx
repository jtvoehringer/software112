'use client'

import { useState, useTransition } from 'react'
import { umziehen } from './actions'
import { qualitaetLabel, minQualitaet } from '@/lib/wein/qualitaet'

export type WeinausbauItem = {
  id: string
  name: string
  jahrgang: number | null
  rebsorte: string | null
  menge_liter: number | null
  qualitaetsstufe: string | null
  behaelter_id: string | null
  behaelter_name: string | null
  status: string
}

export type BehaelterItem = {
  id: string
  name: string
  volumen_liter: number | null
}

export type UmzugItem = {
  id: string
  datum: string
  von_name: string
  nach_name: string
  menge_liter: number
  schwund_liter: number
  verschnitt: boolean
  qualitaet_vorher: string | null
  qualitaet_nachher: string | null
  notizen: string | null
}

// ── Hilfsfunktionen ───────────────────────────────────────────────────────────

function fmt(n: number | null) {
  if (n === null || n === undefined) return '–'
  return n.toLocaleString('de-AT', { maximumFractionDigits: 1 })
}

// Gibt die aktuelle Charge in einem Behälter zurück (falls vorhanden)
function chargeInBehaelter(behId: string, chargen: WeinausbauItem[]): WeinausbauItem | null {
  return chargen.find(c => c.behaelter_id === behId && c.status !== 'abgeschlossen') ?? null
}

// ── Formular ──────────────────────────────────────────────────────────────────

function UmziehenForm({
  chargen, behaelter, onDone,
}: {
  chargen: WeinausbauItem[]
  behaelter: BehaelterItem[]
  onDone: () => void
}) {
  const [vonId, setVonId]         = useState('')
  const [nachBehId, setNachBehId] = useState('')
  const [menge, setMenge]         = useState('')
  const [schwund, setSchwund]     = useState('0')
  const [datum, setDatum]         = useState(new Date().toISOString().split('T')[0])
  const [notizen, setNotizen]     = useState('')
  const [verschnittOk, setVerschnittOk] = useState(false)
  const [pending, startTransition] = useTransition()

  const vonCharge  = chargen.find(c => c.id === vonId) ?? null
  const zielCharge = nachBehId ? chargeInBehaelter(nachBehId, chargen) : null
  const verschnitt = !!zielCharge && zielCharge.id !== vonId

  // Qualität nach Verschnitt
  const resultQualitaet = verschnitt
    ? minQualitaet(vonCharge?.qualitaetsstufe ?? null, zielCharge!.qualitaetsstufe ?? null)
    : vonCharge?.qualitaetsstufe ?? null
  const qualitaetSinkt = verschnitt && resultQualitaet !== (vonCharge?.qualitaetsstufe ?? null)

  // Vorbefüllen wenn Von-Charge gewählt
  function handleVonChange(id: string) {
    setVonId(id)
    const c = chargen.find(ch => ch.id === id)
    if (c?.menge_liter) setMenge(c.menge_liter.toString().replace('.', ','))
    setNachBehId('')
    setVerschnittOk(false)
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const fd = new FormData()
    fd.append('von_weinausbau_id', vonId)
    fd.append('nach_behaelter_id', nachBehId)
    fd.append('menge_liter', menge)
    fd.append('schwund_liter', schwund)
    fd.append('datum', datum)
    fd.append('notizen', notizen)
    startTransition(async () => {
      await umziehen(fd)
      onDone()
    })
  }

  const canSubmit = vonId && nachBehId && menge && nachBehId !== vonCharge?.behaelter_id
    && (!verschnitt || verschnittOk)

  // Behälter für Ziel-Dropdown: alle außer dem aktuellen der Von-Charge
  const zielBehaelter = behaelter.filter(b => b.id !== vonCharge?.behaelter_id)

  return (
    <form onSubmit={handleSubmit} className="bg-s112-bg border border-s112-border rounded-xl p-5 space-y-4">
      <h3 className="text-sm font-semibold text-gray-800">Neuer Umzug</h3>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* Von-Charge */}
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Von Charge *</label>
          <select value={vonId} onChange={e => handleVonChange(e.target.value)} required
            className="w-full border border-s112-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40">
            <option value="">– Charge wählen –</option>
            {chargen.map(c => (
              <option key={c.id} value={c.id}>
                {c.name}{c.jahrgang ? ` ${c.jahrgang}` : ''} · {fmt(c.menge_liter)} L
                {c.behaelter_name ? ` · ${c.behaelter_name}` : ''}
              </option>
            ))}
          </select>
          {vonCharge && (
            <p className="mt-1 text-xs text-s112-muted">
              Qualität: <span className="font-medium text-gray-700">{qualitaetLabel(vonCharge.qualitaetsstufe)}</span>
            </p>
          )}
        </div>

        {/* Nach-Behälter */}
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">In Behälter *</label>
          <select value={nachBehId} onChange={e => { setNachBehId(e.target.value); setVerschnittOk(false) }} required
            disabled={!vonId}
            className="w-full border border-s112-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40 disabled:opacity-50">
            <option value="">– Behälter wählen –</option>
            {zielBehaelter.map(b => {
              const belegung = chargeInBehaelter(b.id, chargen)
              return (
                <option key={b.id} value={b.id}>
                  {b.name}{b.volumen_liter ? ` (${fmt(b.volumen_liter)} L)` : ''}
                  {belegung ? ` ⚠ belegt: ${belegung.name}` : ' · leer'}
                </option>
              )
            })}
          </select>
        </div>

        {/* Datum */}
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Datum *</label>
          <input type="date" value={datum} onChange={e => setDatum(e.target.value)} required
            className="w-full border border-s112-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40" />
        </div>

        {/* Menge */}
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Menge (Liter) *</label>
          <input type="text" inputMode="decimal" value={menge} onChange={e => setMenge(e.target.value)} required
            placeholder="z.B. 800"
            className="w-full border border-s112-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40" />
        </div>

        {/* Schwund */}
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Schwund (Liter)</label>
          <input type="text" inputMode="decimal" value={schwund} onChange={e => setSchwund(e.target.value)}
            placeholder="0"
            className="w-full border border-s112-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40" />
        </div>

        {/* Notizen */}
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Notizen</label>
          <input type="text" value={notizen} onChange={e => setNotizen(e.target.value)}
            placeholder="z.B. Abstich nach Gärung"
            className="w-full border border-s112-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40" />
        </div>
      </div>

      {/* Verschnitt-Warnung */}
      {verschnitt && nachBehId && (
        <div className={`rounded-xl border p-4 ${qualitaetSinkt ? 'bg-amber-50 border-amber-300' : 'bg-blue-50 border-blue-200'}`}>
          <p className={`text-sm font-semibold mb-1 ${qualitaetSinkt ? 'text-amber-800' : 'text-blue-800'}`}>
            {qualitaetSinkt ? '⚠️ Verschnitt – Qualitätsstufe sinkt' : 'ℹ️ Verschnitt'}
          </p>
          <p className="text-xs text-gray-700 mb-1">
            Im Zielbehälter befindet sich bereits:{' '}
            <span className="font-medium">{zielCharge!.name}</span>
            {' · '}{fmt(zielCharge!.menge_liter)} L
            {' · '}<span className="font-medium">{qualitaetLabel(zielCharge!.qualitaetsstufe)}</span>
          </p>
          {qualitaetSinkt && (
            <p className="text-xs text-amber-700 mb-3">
              Ergebnis: Qualitätsstufe sinkt von{' '}
              <span className="font-semibold">{qualitaetLabel(vonCharge?.qualitaetsstufe ?? null)}</span>
              {' '}auf{' '}
              <span className="font-semibold">{qualitaetLabel(resultQualitaet)}</span>
            </p>
          )}
          {!qualitaetSinkt && (
            <p className="text-xs text-blue-700 mb-3">
              Qualitätsstufe bleibt: <span className="font-semibold">{qualitaetLabel(resultQualitaet)}</span>
            </p>
          )}
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={verschnittOk} onChange={e => setVerschnittOk(e.target.checked)}
              className="accent-s112-teal w-4 h-4" />
            <span className="text-xs font-medium text-gray-700">Ich bestätige diesen Verschnitt</span>
          </label>
        </div>
      )}

      <div className="flex gap-2 pt-1">
        <button type="submit" disabled={!canSubmit || pending}
          className="bg-s112-teal text-white px-4 py-1.5 rounded-lg text-sm font-medium hover:bg-opacity-90 disabled:opacity-40">
          {pending ? 'Wird umgezogen…' : 'Umziehen'}
        </button>
        <button type="button" onClick={onDone}
          className="px-4 py-1.5 rounded-lg text-sm font-medium text-gray-600 hover:text-gray-800">
          Abbrechen
        </button>
      </div>
    </form>
  )
}

// ── Hauptkomponente ───────────────────────────────────────────────────────────

export default function UmziehenClient({
  chargen, behaelter, umzuege, writeOk,
}: {
  chargen: WeinausbauItem[]
  behaelter: BehaelterItem[]
  umzuege: UmzugItem[]
  writeOk: boolean
}) {
  const [showForm, setShowForm] = useState(false)

  return (
    <div className="space-y-6">
      {/* Formular */}
      {showForm ? (
        <UmziehenForm chargen={chargen} behaelter={behaelter} onDone={() => setShowForm(false)} />
      ) : writeOk ? (
        <button onClick={() => setShowForm(true)}
          className="inline-flex items-center gap-2 bg-s112-teal text-white px-4 py-2 rounded-xl text-sm font-semibold hover:bg-opacity-90 transition-colors">
          <span>↔</span> Neuer Umzug
        </button>
      ) : null}

      {/* Protokoll */}
      <div>
        <h2 className="font-semibold text-gray-800 mb-3">Umzug-Protokoll</h2>
        {umzuege.length === 0 ? (
          <div className="card text-center py-10 text-s112-muted text-sm">
            Noch keine Umzüge protokolliert.
          </div>
        ) : (
          <div className="card p-0 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-s112-border bg-s112-bg">
                  <th className="text-left px-4 py-2 text-xs font-semibold text-s112-muted">Datum</th>
                  <th className="text-left px-4 py-2 text-xs font-semibold text-s112-muted">Von Charge</th>
                  <th className="text-left px-4 py-2 text-xs font-semibold text-s112-muted">Nach Behälter</th>
                  <th className="text-right px-4 py-2 text-xs font-semibold text-s112-muted">Menge</th>
                  <th className="text-right px-4 py-2 text-xs font-semibold text-s112-muted">Schwund</th>
                  <th className="text-left px-4 py-2 text-xs font-semibold text-s112-muted">Qualität</th>
                  <th className="text-left px-4 py-2 text-xs font-semibold text-s112-muted">Notizen</th>
                </tr>
              </thead>
              <tbody>
                {umzuege.map((u, i) => (
                  <tr key={u.id} className={`border-b border-s112-border/40 last:border-0 ${i % 2 === 1 ? 'bg-s112-bg/50' : ''}`}>
                    <td className="px-4 py-2.5 text-s112-muted tabular-nums text-xs">
                      {new Date(u.datum).toLocaleDateString('de-AT')}
                    </td>
                    <td className="px-4 py-2.5 font-medium text-gray-900 text-xs">{u.von_name}</td>
                    <td className="px-4 py-2.5 text-s112-muted text-xs">{u.nach_name}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-xs">{fmt(u.menge_liter)} L</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-xs text-amber-600">
                      {u.schwund_liter > 0 ? `${fmt(u.schwund_liter)} L` : '–'}
                    </td>
                    <td className="px-4 py-2.5 text-xs">
                      {u.verschnitt ? (
                        <span className={u.qualitaet_vorher !== u.qualitaet_nachher ? 'text-amber-600 font-medium' : 'text-blue-600'}>
                          {qualitaetLabel(u.qualitaet_vorher)} → {qualitaetLabel(u.qualitaet_nachher)}
                        </span>
                      ) : (
                        <span className="text-s112-muted">{qualitaetLabel(u.qualitaet_nachher)}</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-s112-muted">{u.notizen ?? '–'}</td>
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
