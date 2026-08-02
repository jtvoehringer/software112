'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createFibuBuchungssatz } from '../actions'
import { Trash2 } from 'lucide-react'

type Konto = { id: string; konto_nr: number; konto_name: string; typ: string }
type Zeile = { konto_id: string; seite: 'soll' | 'haben'; betrag: string }

interface Props { konten: Konto[]; tenantId: string }

export default function FibuNeuClient({ konten }: Props) {
  const router = useRouter()
  const [saving, setSaving]     = useState(false)
  const [fehler, setFehler]     = useState<string | null>(null)
  const [belegdatum, setBelegdatum] = useState(new Date().toISOString().split('T')[0])
  const [beschreibung, setBeschreibung] = useState('')
  const [zeilen, setZeilen]     = useState<Zeile[]>([
    { konto_id: '', seite: 'soll',  betrag: '' },
    { konto_id: '', seite: 'haben', betrag: '' },
  ])

  function updateZeile(i: number, field: keyof Zeile, val: string) {
    setZeilen(z => z.map((row, idx) => idx === i ? { ...row, [field]: val } : row))
  }
  function addZeile() {
    setZeilen(z => [...z, { konto_id: '', seite: 'soll', betrag: '' }])
  }
  function removeZeile(i: number) {
    if (zeilen.length <= 2) return
    setZeilen(z => z.filter((_, idx) => idx !== i))
  }

  const sollSumme  = zeilen.filter(z => z.seite === 'soll').reduce((s, z) => s + (parseFloat(z.betrag) || 0), 0)
  const habenSumme = zeilen.filter(z => z.seite === 'haben').reduce((s, z) => s + (parseFloat(z.betrag) || 0), 0)
  const ausgeglichen = Math.abs(sollSumme - habenSumme) < 0.01

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setFehler(null)

    if (!ausgeglichen) {
      setFehler(`Buchungssatz nicht ausgeglichen: Soll ${sollSumme.toFixed(2)} ≠ Haben ${habenSumme.toFixed(2)}`)
      return
    }
    if (zeilen.some(z => !z.konto_id || !z.betrag)) {
      setFehler('Alle Zeilen müssen Konto und Betrag haben')
      return
    }

    setSaving(true)
    const fd = new FormData()
    fd.set('belegdatum',   belegdatum)
    fd.set('beschreibung', beschreibung)
    zeilen.forEach((z, i) => {
      fd.set(`konto_id_${i}`, z.konto_id)
      fd.set(`seite_${i}`,    z.seite)
      fd.set(`betrag_${i}`,   z.betrag)
    })

    const result = await createFibuBuchungssatz(fd)
    if (result?.error) {
      setFehler(result.error)
      setSaving(false)
      return
    }
    router.push('/fibu')
  }

  const fmt = (n: number) => n.toLocaleString('de-AT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <Link href="/fibu" className="text-sm text-s112-muted hover:text-gray-700">← Journal</Link>
        <h1 className="text-2xl font-bold text-gray-900">Neuer Buchungssatz</h1>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        {/* Kopfdaten */}
        <div className="bg-white rounded-2xl border border-s112-border p-5">
          <h2 className="font-semibold text-gray-800 mb-4">Belegdaten</h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Belegdatum *</label>
              <input type="date" value={belegdatum} onChange={e => setBelegdatum(e.target.value)} required
                className="w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Buchungstext *</label>
              <input value={beschreibung} onChange={e => setBeschreibung(e.target.value)} required
                placeholder="z.B. Eingangsrechnung Flaschenhersteller"
                className="w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40" />
            </div>
          </div>
        </div>

        {/* Buchungszeilen */}
        <div className="bg-white rounded-2xl border border-s112-border p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-gray-800">Buchungszeilen (Soll / Haben)</h2>
            <button type="button" onClick={addZeile}
              className="text-xs text-s112-teal border border-s112-teal px-3 py-1 rounded-lg hover:bg-s112-teal/5">
              + Zeile
            </button>
          </div>

          {/* Header */}
          <div className="grid grid-cols-12 gap-2 mb-2 text-xs font-medium text-gray-500">
            <div className="col-span-6">Konto</div>
            <div className="col-span-3">Soll / Haben</div>
            <div className="col-span-2 text-right">Betrag (€)</div>
            <div className="col-span-1" />
          </div>

          {zeilen.map((zeile, i) => (
            <div key={i} className="grid grid-cols-12 gap-2 mb-2 items-center">
              <div className="col-span-6">
                <select value={zeile.konto_id} onChange={e => updateZeile(i, 'konto_id', e.target.value)}
                  className="w-full border border-s112-border rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-s112-teal/40">
                  <option value="">– Konto wählen –</option>
                  {konten.map(k => (
                    <option key={k.id} value={k.id}>{k.konto_nr} · {k.konto_name}</option>
                  ))}
                </select>
              </div>
              <div className="col-span-3">
                <select value={zeile.seite} onChange={e => updateZeile(i, 'seite', e.target.value as 'soll' | 'haben')}
                  className="w-full border border-s112-border rounded-lg px-2 py-1.5 text-sm focus:outline-none">
                  <option value="soll">Soll</option>
                  <option value="haben">Haben</option>
                </select>
              </div>
              <div className="col-span-2">
                <input type="number" step="0.01" min="0.01" value={zeile.betrag}
                  onChange={e => updateZeile(i, 'betrag', e.target.value)}
                  placeholder="0.00"
                  className="w-full border border-s112-border rounded-lg px-2 py-1.5 text-sm text-right focus:outline-none" />
              </div>
              <div className="col-span-1 flex justify-center">
                <button type="button" onClick={() => removeZeile(i)}
                  disabled={zeilen.length <= 2}
                  className="text-red-400 hover:text-red-600 disabled:opacity-20 text-xs">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}

          {/* Summen-Kontrolle */}
          <div className="mt-4 pt-4 border-t border-s112-border grid grid-cols-2 gap-4 text-sm">
            <div className="text-right">
              <span className="text-gray-500">Soll:</span>
              <span className="ml-2 font-mono font-semibold text-orange-600">€ {fmt(sollSumme)}</span>
            </div>
            <div className="text-right">
              <span className="text-gray-500">Haben:</span>
              <span className="ml-2 font-mono font-semibold text-blue-600">€ {fmt(habenSumme)}</span>
            </div>
          </div>
          {!ausgeglichen && sollSumme > 0 && habenSumme > 0 && (
            <p className="text-xs text-red-500 mt-2 text-center">
              Differenz: € {fmt(Math.abs(sollSumme - habenSumme))} – Buchungssatz muss ausgeglichen sein
            </p>
          )}
          {ausgeglichen && sollSumme > 0 && (
            <p className="text-xs text-green-600 mt-2 text-center">Ausgeglichen</p>
          )}
        </div>

        {fehler && <p className="text-red-600 text-sm">{fehler}</p>}

        <div className="flex gap-3">
          <button type="submit" disabled={saving || !ausgeglichen}
            className="bg-s112-teal text-white px-6 py-2.5 rounded-xl text-sm font-semibold hover:bg-opacity-90 disabled:opacity-40">
            {saving ? 'Buchen…' : 'Buchungssatz speichern'}
          </button>
          <Link href="/fibu"
            className="px-6 py-2.5 rounded-xl text-sm border border-s112-border text-gray-600 hover:bg-s112-bg">
            Abbrechen
          </Link>
        </div>
      </form>
    </div>
  )
}
