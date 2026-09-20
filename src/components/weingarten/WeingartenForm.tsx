'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { fehlerText } from '@/lib/fehler'

type WeingartenRow = {
  id: string
  name: string
  ama_feldnummer?: string | null
  codes?: string | null
  interne_bezeichnung?: string | null
  notizen: string | null
  aktiv: boolean
}

interface Props {
  weingarten?: WeingartenRow
  action: (formData: FormData) => Promise<void>
  // Rückmeldung 24.8.2026: Formular wird jetzt auch für Rollen ohne
  // Schreibrechte (Rolle "Nur-Lesen") gerendert - actions.ts blockt
  // createWeingarten/updateWeingarten serverseitig bereits ab (requireWrite()),
  // ohne readOnly würde ein Nur-Lesen-Nutzer aber erst nach Klick auf
  // "Speichern" eine Fehlermeldung sehen. readOnly=true deaktiviert alle
  // Felder und blendet den Speichern-Button aus statt dieses Umwegs.
  readOnly?: boolean
}

export default function WeingartenForm({ weingarten, action, readOnly = false }: Props) {
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
      setError(fehlerText(err, 'Unbekannter Fehler'))
      setSaving(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {error && (
        <div className="bg-s112-err-bg border border-s112-err/30 text-s112-err-fg rounded-xl px-4 py-3 text-sm">
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
              disabled={readOnly}
              defaultValue={weingarten?.name ?? ''}
              className="form-input disabled:opacity-60 disabled:cursor-not-allowed"
              placeholder="z.B. Kremser Schmidt"
            />
          </div>
          <div>
            <label className="form-label">Interne Bezeichnung (optional)</label>
            <input
              name="interne_bezeichnung"
              type="text"
              disabled={readOnly}
              defaultValue={weingarten?.interne_bezeichnung ?? ''}
              className="form-input disabled:opacity-60 disabled:cursor-not-allowed"
              placeholder="z.B. Innerbüchl"
            />
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="form-label">AMA-Feldstücknr.</label>
            <input
              name="ama_feldnummer"
              type="text"
              maxLength={3}
              pattern="[0-9]{1,3}"
              disabled={readOnly}
              defaultValue={weingarten?.ama_feldnummer ?? ''}
              className="form-input disabled:opacity-60 disabled:cursor-not-allowed"
              placeholder="z.B. 12"
            />
          </div>
          <div>
            <label className="form-label">Codes</label>
            <input
              name="codes"
              type="text"
              disabled={readOnly}
              defaultValue={weingarten?.codes ?? ''}
              className="form-input disabled:opacity-60 disabled:cursor-not-allowed"
              placeholder="z.B. EOP,PSMBIO"
              title="EOP = Einsatz von Organismen und Pheromonen, PSMBIO = Einsatz von Pflanzenschutzmitteln laut Bio-Verordnung"
            />
          </div>
        </div>
      </div>

      {/* Notizen */}
      <div className="card space-y-4">
        <h2 className="text-sm font-semibold text-s112-muted uppercase tracking-wider">Notizen</h2>
        <textarea
          name="notizen"
          rows={4}
          disabled={readOnly}
          defaultValue={weingarten?.notizen ?? ''}
          className="form-input resize-none disabled:opacity-60 disabled:cursor-not-allowed"
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
              disabled={readOnly}
              defaultChecked={weingarten.aktiv}
              className="w-4 h-4 accent-s112-teal"
            />
            <span className="text-sm font-medium text-s112-text-1">Ried aktiv</span>
          </label>
        </div>
      )}

      {/* Aktionen */}
      <div className="flex items-center gap-3">
        {!readOnly && (
          <button
            type="submit"
            disabled={saving}
            className="bg-s112-teal text-white px-6 py-2 rounded-xl text-sm font-semibold hover:bg-opacity-90 transition-colors disabled:opacity-50"
          >
            {saving ? 'Wird gespeichert …' : 'Speichern'}
          </button>
        )}
        <button
          type="button"
          onClick={() => router.push('/weingarten')}
          className="text-sm text-s112-muted hover:text-s112-text-1 transition-colors"
        >
          {readOnly ? 'Zurück' : 'Abbrechen'}
        </button>
      </div>
    </form>
  )
}
