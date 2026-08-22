'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

type BehaelterRow = {
  id: string; name: string; typ: string | null
  volumen_liter: number | null; standort: string | null; aktiv: boolean
}

interface Props {
  behaelter?: BehaelterRow
  action: (formData: FormData) => Promise<void>
}

export default function BehaelterForm({ behaelter, action }: Props) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setSaving(true)
    try {
      await action(new FormData(e.currentTarget))
      router.push('/kellerbuch')
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Fehler beim Speichern')
      setSaving(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3 text-sm"><strong>Fehler:</strong> {error}</div>}

      <div className="card space-y-4">
        <h2 className="text-sm font-semibold text-s112-muted uppercase tracking-wider">Basisdaten</h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="form-label">Name *</label>
            <input name="name" type="text" required defaultValue={behaelter?.name ?? ''} className="form-input" placeholder="z.B. Tank 01" />
          </div>
          <div>
            <label className="form-label">Typ</label>
            <select name="typ" defaultValue={behaelter?.typ ?? ''} className="form-input">
              <option value="">– bitte wählen –</option>
              <option value="amphore">Amphore</option>
              <option value="barrique">Barrique</option>
              <option value="betonei">Betonei</option>
              <option value="bottich">Bottich</option>
              <option value="doppelbarrique">Doppel-Barrique</option>
              <option value="gaerstaender">Gärständer</option>
              <option value="holzfass">Holzfass</option>
              <option value="immervolltank">Immervoll-Tank</option>
              <option value="lagertank">Lagertank</option>
              <option value="presse">Presse</option>
              <option value="zisterne">Zisterne</option>
              <option value="sonstiges">Sonstiges</option>
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="form-label">Volumen (Liter)</label>
            <input name="volumen_liter" type="text" inputMode="decimal"
              defaultValue={behaelter?.volumen_liter?.toString().replace('.', ',') ?? ''}
              className="form-input" placeholder="z.B. 5.000" />
          </div>
          <div>
            <label className="form-label">Standort</label>
            <input name="standort" type="text" defaultValue={behaelter?.standort ?? ''} className="form-input" placeholder="z.B. Keller Süd" />
          </div>
        </div>
      </div>

      {behaelter && (
        <div className="card">
          <label className="flex items-center gap-3 cursor-pointer">
            <input type="checkbox" name="aktiv" value="true" defaultChecked={behaelter.aktiv} className="w-4 h-4 accent-s112-teal" />
            <span className="text-sm font-medium text-gray-700">Behälter aktiv</span>
          </label>
        </div>
      )}

      <div className="flex items-center gap-3">
        <button type="submit" disabled={saving} className="bg-s112-teal text-white px-6 py-2 rounded-xl text-sm font-semibold hover:bg-opacity-90 transition-colors disabled:opacity-50">
          {saving ? 'Wird gespeichert …' : 'Speichern'}
        </button>
        <button type="button" onClick={() => router.push('/kellerbuch')} className="text-sm text-s112-muted hover:text-gray-700 transition-colors">Abbrechen</button>
      </div>
    </form>
  )
}
