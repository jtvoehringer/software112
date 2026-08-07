'use client'

import { useState } from 'react'
import { AlertTriangle } from 'lucide-react'

export default function BMDPage() {
  const [vonDatum, setVonDatum] = useState(new Date(new Date().getFullYear(), 0, 1).toISOString().split('T')[0])
  const [bisDatum, setBisDatum] = useState(new Date().toISOString().split('T')[0])
  const [laden, setLaden] = useState(false)
  const [info, setInfo] = useState<string | null>(null)

  async function exportBMD() {
    setLaden(true); setInfo(null)
    const res = await fetch(`/api/export/bmd?von=${vonDatum}&bis=${bisDatum}`)
    if (!res.ok) { setInfo('Fehler beim Export'); setLaden(false); return }
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `bmd_ntcs_${vonDatum}_${bisDatum}.csv`
    a.click(); URL.revokeObjectURL(url)
    setInfo('Export erfolgreich heruntergeladen.')
    setLaden(false)
  }

  return (
    <div className="space-y-6 max-w-xl">
      <div className="flex items-center gap-2 text-sm text-s112-muted">
        <span>Controlling</span>
        <span>/</span>
        <span className="text-gray-700 font-medium">BMD NTCS Export</span>
      </div>
      <div>
        <h1 className="text-2xl font-bold text-gray-900">BMD NTCS Export</h1>
        <p className="text-sm text-s112-muted mt-1">Verkaufsbuchungen im BMD NTCS-kompatiblen Format exportieren</p>
      </div>

      <div className="card p-6 space-y-4">
        <p className="text-sm font-semibold text-gray-700">Exportzeitraum wählen</p>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Von</label>
            <input type="date" value={vonDatum} onChange={e => setVonDatum(e.target.value)}
              className="w-full border border-s112-border rounded-lg px-3 py-1.5 text-sm focus:outline-none" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Bis</label>
            <input type="date" value={bisDatum} onChange={e => setBisDatum(e.target.value)}
              className="w-full border border-s112-border rounded-lg px-3 py-1.5 text-sm focus:outline-none" />
          </div>
        </div>
        <button onClick={exportBMD} disabled={laden}
          className="w-full bg-s112-teal text-white px-4 py-2.5 rounded-xl text-sm font-semibold hover:bg-opacity-90 disabled:opacity-40">
          {laden ? 'Exportiert…' : 'BMD NTCS CSV herunterladen'}
        </button>
        {info && <p className="text-sm text-green-600">{info}</p>}
      </div>

      <div className="card p-5 space-y-2 text-xs text-s112-muted">
        <p className="font-semibold text-gray-700 text-sm">Exportformat</p>
        <p>Das CSV enthält alle Verkaufsposten im Zeitraum als BMD NTCS-Buchungszeilen:</p>
        <ul className="list-disc ml-4 space-y-1">
          <li>Buchungsdatum, Belegnummer, Buchungstext</li>
          <li>Erlöskonto (40000), Debitorkonto (10000)</li>
          <li>Bruttobetrag, USt-Kennzeichen (U13 / U20)</li>
          <li>Stornierte Rechnungen werden übersprungen</li>
        </ul>
        <p className="text-amber-600 font-medium mt-2 inline-flex items-start gap-1.5"><AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />Kontennummern bitte vor dem Import mit deinem Steuerberater abstimmen.</p>
      </div>
    </div>
  )
}
