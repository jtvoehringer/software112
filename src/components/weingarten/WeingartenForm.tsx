'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

type WeingartenRow = {
  id: string
  name: string
  notizen: string | null
  aktiv: boolean
}

interface Props {
  weingarten?: WeingartenRow
  action: (formData: FormData) => Promise<void>
}

export default function WeingartenForm({ weingarten, action }: Props) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

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
