'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

const REBSORTEN = [
  'Grüner Veltliner', 'Riesling', 'Welschriesling', 'Müller-Thurgau',
  'Chardonnay', 'Sauvignon Blanc', 'Weißburgunder', 'Grauburgunder',
  'Muskateller', 'Neuburger', 'Roter Veltliner', 'Traminer',
  'Zweigelt', 'Blaufränkisch', 'St. Laurent', 'Pinot Noir',
  'Blauburger', 'Merlot', 'Cabernet Sauvignon', 'Syrah',
]

const REBSORTE_WEINART: Record<string, 'rot' | 'weiss'> = {
  'Grüner Veltliner': 'weiss', 'Riesling': 'weiss', 'Welschriesling': 'weiss',
  'Müller-Thurgau': 'weiss', 'Chardonnay': 'weiss', 'Sauvignon Blanc': 'weiss',
  'Weißburgunder': 'weiss', 'Grauburgunder': 'weiss', 'Muskateller': 'weiss',
  'Neuburger': 'weiss', 'Roter Veltliner': 'weiss', 'Traminer': 'weiss',
  'Zweigelt': 'rot', 'Blaufränkisch': 'rot', 'St. Laurent': 'rot',
  'Pinot Noir': 'rot', 'Blauburger': 'rot', 'Merlot': 'rot',
  'Cabernet Sauvignon': 'rot', 'Syrah': 'rot',
}

type WeingartenRow = {
  id: string
  name: string
  rebsorte: string | null
  pflanzjahr: number | null
  bewirtschaftung: string | null
  bewirtschaftung_seit: string | null
  notizen: string | null
  aktiv: boolean
  weinart: string | null
}

interface Props {
  weingarten?: WeingartenRow
  action: (formData: FormData) => Promise<void>
}

export default function WeingartenForm({ weingarten, action }: Props) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [weinart, setWeinart] = useState<string>(weingarten?.weinart ?? 'unbekannt')
  const [bewirtschaftung, setBewirtschaftung] = useState<string>(weingarten?.bewirtschaftung ?? '')

  function handleRebsorteChange(val: string) {
    const mapped = REBSORTE_WEINART[val]
    if (mapped) setWeinart(mapped)
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setSaving(true)
    const fd = new FormData(e.currentTarget)
    try {
      await action(fd)
      router.push('/weingarten')
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unbekannter Fehler')
      setSaving(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3 text-sm">
          <strong>Fehler:</strong> {error}
        </div>
      )}

      {/* Basisdaten */}
      <div className="card space-y-4">
        <h2 className="text-sm font-semibold text-s112-muted uppercase tracking-wider">Basisdaten</h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="form-label">Riedname *</label>
            <input
              name="name"
              type="text"
              required
              defaultValue={weingarten?.name ?? ''}
              className="form-input"
              placeholder="z.B. Kremser Schmidt"
            />
          </div>
          <div>
            <label className="form-label">Rebsorte</label>
            <input
              name="rebsorte"
              type="text"
              list="rebsorten-list"
              defaultValue={weingarten?.rebsorte ?? ''}
              className="form-input"
              placeholder="Rebsorte wählen oder eingeben"
              onChange={e => handleRebsorteChange(e.target.value)}
            />
            <datalist id="rebsorten-list">
              {REBSORTEN.map(r => <option key={r} value={r} />)}
            </datalist>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="form-label">Pflanzjahr</label>
            <input
              name="pflanzjahr"
              type="number"
              min="1900"
              max="2100"
              defaultValue={weingarten?.pflanzjahr ?? ''}
              className="form-input"
              placeholder="z.B. 1995"
            />
          </div>
          <div>
            <label className="form-label">Weinart</label>
            <select
              name="weinart"
              value={weinart}
              onChange={e => setWeinart(e.target.value)}
              className="form-input"
            >
              <option value="weiss">⬜ Weißwein</option>
              <option value="rot">🟥 Rotwein</option>
              <option value="unbekannt">– unbekannt –</option>
            </select>
            <p className="text-xs text-s112-muted mt-1">Wird aus Rebsorte vorgeschlagen</p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="form-label">Bewirtschaftung</label>
            <select
              name="bewirtschaftung"
              value={bewirtschaftung}
              onChange={e => setBewirtschaftung(e.target.value)}
              className="form-input"
            >
              <option value="">– bitte wählen –</option>
              <option value="biodynamisch">Biodynamisch</option>
              <option value="biologisch">Biologisch/Organisch</option>
              <option value="in_umstellung">In Umstellung</option>
              <option value="nachhaltig">Nachhaltig</option>
              <option value="kip">KIP</option>
              <option value="konventionell">Konventionell</option>
            </select>
          </div>
          {bewirtschaftung === 'in_umstellung' && (
            <div>
              <label className="form-label">In Umstellung seit</label>
              <input
                name="bewirtschaftung_seit"
                type="date"
                defaultValue={weingarten?.bewirtschaftung_seit ?? ''}
                className="form-input"
              />
            </div>
          )}
        </div>
      </div>

      {/* Notizen */}
      <div className="card space-y-4">
        <h2 className="text-sm font-semibold text-s112-muted uppercase tracking-wider">Notizen</h2>
        <textarea
          name="notizen"
          rows={4}
          defaultValue={weingarten?.notizen ?? ''}
          className="form-input resize-none"
          placeholder="Besonderheiten, Bodenart, Ausrichtung …"
        />
      </div>

      {/* Aktiv-Toggle nur beim Bearbeiten */}
      {weingarten && (
        <div className="card">
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              name="aktiv"
              value="true"
              defaultChecked={weingarten.aktiv}
              className="w-4 h-4 accent-s112-teal"
            />
            <span className="text-sm font-medium text-gray-700">Ried aktiv</span>
          </label>
        </div>
      )}

      {/* Aktionen */}
      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={saving}
          className="bg-s112-teal text-white px-6 py-2 rounded-xl text-sm font-semibold hover:bg-opacity-90 transition-colors disabled:opacity-50"
        >
          {saving ? 'Wird gespeichert …' : 'Speichern'}
        </button>
        <button
          type="button"
          onClick={() => router.push('/weingarten')}
          className="text-sm text-s112-muted hover:text-gray-700 transition-colors"
        >
          Abbrechen
        </button>
      </div>
    </form>
  )
}
