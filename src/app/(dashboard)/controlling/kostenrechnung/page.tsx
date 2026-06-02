'use client'

import { useState, useEffect, useTransition } from 'react'

type Kostenstelle = { id: string; name: string; kuerzel: string | null }
type Kostenart    = { id: string; name: string; kategorie: string | null }
type Eintrag      = { id: string; datum: string; betrag: number; beschreibung: string | null; kostenstelle: { name: string } | null; kostenart: { name: string } | null }

const KAT_LABEL: Record<string, string> = {
  betriebsmittel: 'Betriebsmittel', personal: 'Personal', energie: 'Energie',
  abschreibung: 'Abschreibung', pacht: 'Pacht', sonstiges: 'Sonstiges',
}

export default function KostenrechnungPage() {
  const [tab, setTab] = useState<'buchungen'|'kostenstellen'|'kostenarten'>('buchungen')
  const [eintraege, setEintraege]       = useState<Eintrag[]>([])
  const [kostenstellen, setKostenstellen] = useState<Kostenstelle[]>([])
  const [kostenarten, setKostenarten]   = useState<Kostenart[]>([])
  const [laden, setLaden]               = useState(true)
  const [showForm, setShowForm]         = useState(false)
  const [pending, startTransition]      = useTransition()

  const [ksId, setKsId]   = useState('')
  const [kaId, setKaId]   = useState('')
  const [datum, setDatum] = useState(new Date().toISOString().split('T')[0])
  const [betrag, setBetrag] = useState('')
  const [beschreibung, setBeschreibung] = useState('')

  useEffect(() => { loadData() }, [])

  async function loadData() {
    setLaden(true)
    const [eRes, ksRes, kaRes] = await Promise.all([
      fetch('/api/kostenrechnung?action=eintraege'),
      fetch('/api/kostenrechnung?action=kostenstellen'),
      fetch('/api/kostenrechnung?action=kostenarten'),
    ])
    setEintraege((await eRes.json()).eintraege ?? [])
    setKostenstellen((await ksRes.json()).kostenstellen ?? [])
    setKostenarten((await kaRes.json()).kostenarten ?? [])
    setLaden(false)
  }

  async function handleEintrag(e: React.FormEvent) {
    e.preventDefault()
    await fetch('/api/kostenrechnung', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'eintrag', kostenstelle_id: ksId || null, kostenart_id: kaId || null, datum, betrag: parseFloat(betrag), beschreibung: beschreibung || null }),
    })
    setShowForm(false); setBetrag(''); setBeschreibung('')
    loadData()
  }

  const gesamtJahr = eintraege.filter(e => e.datum.startsWith(new Date().getFullYear().toString())).reduce((s, e) => s + e.betrag, 0)

  return (
    <div className="space-y-5 max-w-4xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Kostenrechnung</h1>
          <p className="text-sm text-s112-muted mt-1">Betriebskosten erfassen und auswerten</p>
        </div>
        {tab === 'buchungen' && (
          <button onClick={() => setShowForm(v => !v)}
            className="bg-s112-teal text-white px-4 py-2 rounded-xl text-sm font-semibold hover:bg-opacity-90">
            + Kosten buchen
          </button>
        )}
      </div>

      {/* KPI */}
      <div className="grid grid-cols-2 gap-4">
        <div className="card p-4">
          <p className="text-xs text-s112-muted">Gesamtkosten {new Date().getFullYear()}</p>
          <p className="text-2xl font-bold text-s112-teal tabular-nums mt-1">
            {gesamtJahr.toLocaleString('de-AT', { style: 'currency', currency: 'EUR' })}
          </p>
        </div>
        <div className="card p-4">
          <p className="text-xs text-s112-muted">Buchungen gesamt</p>
          <p className="text-2xl font-bold text-gray-800 mt-1">{eintraege.length}</p>
        </div>
      </div>

      {/* Neuer Eintrag */}
      {showForm && (
        <form onSubmit={handleEintrag} className="card p-5 space-y-3">
          <p className="text-sm font-semibold text-gray-800">Neue Kostenbuchung</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Datum</label>
              <input type="date" value={datum} onChange={e => setDatum(e.target.value)} required className="w-full border border-s112-border rounded-lg px-3 py-1.5 text-sm focus:outline-none" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Betrag (€) *</label>
              <input type="number" step="0.01" min="0" value={betrag} onChange={e => setBetrag(e.target.value)} required className="w-full border border-s112-border rounded-lg px-3 py-1.5 text-sm focus:outline-none" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Kostenstelle</label>
              <select value={ksId} onChange={e => setKsId(e.target.value)} className="w-full border border-s112-border rounded-lg px-3 py-1.5 text-sm focus:outline-none">
                <option value="">– keine –</option>
                {kostenstellen.map(k => <option key={k.id} value={k.id}>{k.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Kostenart</label>
              <select value={kaId} onChange={e => setKaId(e.target.value)} className="w-full border border-s112-border rounded-lg px-3 py-1.5 text-sm focus:outline-none">
                <option value="">– keine –</option>
                {kostenarten.map(k => <option key={k.id} value={k.id}>{k.name}</option>)}
              </select>
            </div>
            <div className="col-span-2">
              <label className="block text-xs font-medium text-gray-600 mb-1">Beschreibung</label>
              <input value={beschreibung} onChange={e => setBeschreibung(e.target.value)} className="w-full border border-s112-border rounded-lg px-3 py-1.5 text-sm focus:outline-none" />
            </div>
          </div>
          <div className="flex gap-2">
            <button type="submit" disabled={pending} className="bg-s112-teal text-white px-4 py-1.5 rounded-lg text-sm font-medium hover:bg-opacity-90 disabled:opacity-40">Buchen</button>
            <button type="button" onClick={() => setShowForm(false)} className="text-sm px-4 py-1.5 rounded-lg border border-s112-border text-gray-600">Abbrechen</button>
          </div>
        </form>
      )}

      {/* Tabs */}
      <div className="flex gap-1">
        {[['buchungen','📋 Buchungen'],['kostenstellen','🏢 Kostenstellen'],['kostenarten','🏷 Kostenarten']].map(([id, label]) => (
          <button key={id} onClick={() => setTab(id as typeof tab)}
            className={`px-3 py-1.5 text-sm font-medium rounded-lg ${tab === id ? 'bg-s112-teal text-white' : 'bg-s112-bg text-gray-600 hover:bg-s112-teal/10'}`}>
            {label}
          </button>
        ))}
      </div>

      {/* Buchungen */}
      {tab === 'buchungen' && (
        <div className="card overflow-hidden">
          {laden ? <p className="text-center py-8 text-s112-muted">Lädt…</p> : eintraege.length === 0 ? (
            <p className="text-center py-8 text-s112-muted">Noch keine Buchungen. Klicke "+ Kosten buchen" um zu starten.</p>
          ) : (
            <table className="w-full text-sm">
              <thead><tr className="bg-s112-bg border-b border-s112-border text-xs text-gray-600">
                <th className="text-left px-4 py-2.5 font-semibold">Datum</th>
                <th className="text-left px-4 py-2.5 font-semibold">Beschreibung</th>
                <th className="text-left px-4 py-2.5 font-semibold">Kostenstelle</th>
                <th className="text-left px-4 py-2.5 font-semibold">Kostenart</th>
                <th className="text-right px-4 py-2.5 font-semibold">Betrag</th>
              </tr></thead>
              <tbody>
                {eintraege.map((e, i) => (
                  <tr key={e.id} className={`border-b border-s112-border/40 ${i%2===1?'bg-s112-bg/30':''}`}>
                    <td className="px-4 py-2.5 tabular-nums text-s112-muted">{new Date(e.datum).toLocaleDateString('de-AT')}</td>
                    <td className="px-4 py-2.5 text-gray-700">{e.beschreibung ?? '–'}</td>
                    <td className="px-4 py-2.5 text-xs text-s112-muted">{e.kostenstelle?.name ?? '–'}</td>
                    <td className="px-4 py-2.5 text-xs text-s112-muted">{e.kostenart?.name ?? '–'}</td>
                    <td className="px-4 py-2.5 text-right font-semibold tabular-nums">{e.betrag.toLocaleString('de-AT', { style: 'currency', currency: 'EUR' })}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Kostenstellen */}
      {tab === 'kostenstellen' && (
        <div className="card p-5 space-y-3">
          <p className="text-sm font-semibold text-gray-700">Kostenstellen werden beim ersten Start automatisch angelegt. Weitere per SQL oder Admin hinzufügen.</p>
          <div className="space-y-1">
            {kostenstellen.map(k => (
              <div key={k.id} className="flex items-center gap-3 py-2 border-b border-s112-border/40">
                <span className="font-mono text-xs text-s112-muted w-16">{k.kuerzel ?? '–'}</span>
                <span className="text-sm font-medium text-gray-800">{k.name}</span>
              </div>
            ))}
            {kostenstellen.length === 0 && <p className="text-s112-muted text-sm">Migration 041 + Standard-Daten ausführen.</p>}
          </div>
        </div>
      )}

      {/* Kostenarten */}
      {tab === 'kostenarten' && (
        <div className="card p-5 space-y-1">
          {kostenarten.map(k => (
            <div key={k.id} className="flex items-center gap-3 py-2 border-b border-s112-border/40">
              <span className="text-xs bg-s112-bg border border-s112-border px-2 py-0.5 rounded text-gray-500">{KAT_LABEL[k.kategorie ?? ''] ?? k.kategorie ?? '–'}</span>
              <span className="text-sm font-medium text-gray-800">{k.name}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
