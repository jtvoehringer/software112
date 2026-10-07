'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from '@/components/ui/Link'
import { createAnalyse } from '@/app/(dashboard)/kellerbuch/actions'
import { fehlerText } from '@/lib/fehler'
import { dezimal } from '@/lib/format'
import MostgewichtEingabe from '@/components/wein/MostgewichtEingabe'

interface Props {
  params: Promise<{ id: string }>
}

function DecimalInput({ name, label, unit, placeholder }: {
  name: string; label: string; unit?: string; placeholder?: string
}) {
  return (
    <div>
      <label className="form-label">{label}{unit ? <span className="text-s112-muted"> ({unit})</span> : null}</label>
      <input
        name={name}
        type="text"
        inputMode="decimal"
        className="form-input py-2.5 sm:py-2 text-base sm:text-sm"
        placeholder={placeholder ?? '–'}
      />
    </div>
  )
}

export default function AnalyseNeuPage({ params }: Props) {
  const router = useRouter()
  const [weinausbauId, setWeinausbauId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  // params auflösen beim ersten Render via useEffect-ähnlichem Pattern (params ist Promise)
  // Wir nutzen use() hier nicht (Next 14 RC), stattdessen lesen wir params.then direkt
  if (!weinausbauId) {
    params.then(p => setWeinausbauId(p.id))
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!weinausbauId) return
    setError(null)
    setSaving(true)

    const raw = new FormData(e.currentTarget)
    // Dezimalkomma normalisieren
    const fd = new FormData()
    raw.forEach((value, key) => {
      // KAN-203: das Mostgewicht prüft und rechnet die Server Action selbst (mostgewichtAusFormular) – unverändert senden
      fd.append(key, typeof value === 'string' && !key.startsWith('mostgewicht_') ? dezimal(value) : value)
    })
    fd.append('weinausbau_id', weinausbauId)

    try {
      await createAnalyse(fd)
      router.push(`/kellerbuch/weinausbau/${weinausbauId}/analysen`)
      router.refresh()
    } catch (err) {
      setError(fehlerText(err, 'Unbekannter Fehler'))
      setSaving(false)
    }
  }

  if (!weinausbauId) return null

  return (
    <div className="max-w-2xl space-y-6">

      {/* Breadcrumb */}
      <nav className="flex items-center gap-2 text-sm text-s112-muted flex-wrap">
        <Link href="/kellerbuch" className="hover:text-s112-blue-700">Kellerbuch</Link>
        <span>/</span>
        <Link href={`/kellerbuch/weinausbau/${weinausbauId}`} className="hover:text-s112-blue-700">Charge</Link>
        <span>/</span>
        <Link href={`/kellerbuch/weinausbau/${weinausbauId}/analysen`} className="hover:text-s112-blue-700">Laboranalysen</Link>
        <span>/</span>
        <span className="text-s112-text font-medium">Neue Analyse</span>
      </nav>

      <h1 className="text-2xl font-semibold text-s112-text">Laboranalyse erfassen</h1>

      <form onSubmit={handleSubmit} className="space-y-6">
        {error && (
          <div className="bg-s112-err-bg border border-s112-err/30 text-s112-err-fg rounded-xl px-4 py-3 text-sm">
            <strong>Fehler:</strong> {error}
          </div>
        )}

        {/* Metadaten */}
        <div className="card space-y-4">
          <h2 className="text-sm font-semibold text-s112-muted uppercase tracking-wider">Analyse-Metadaten</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="form-label">Datum *</label>
              <input aria-label="Datum"
                name="analyse_datum"
                type="date"
                required
                defaultValue={new Date().toISOString().slice(0, 10)}
                className="form-input py-2.5 sm:py-2 text-base sm:text-sm"
              />
            </div>
            <div>
              <label className="form-label">Labor</label>
              <input aria-label="Labor"
                name="labor"
                type="text"
                list="labor-list"
                className="form-input py-2.5 sm:py-2 text-base sm:text-sm"
                placeholder="z.B. Eigenlabor, BOKU Wien"
              />
              <datalist id="labor-list">
                <option value="Eigenlabor" />
                <option value="BOKU Wien" />
                <option value="Staatliches Labor" />
                <option value="Lacon GmbH" />
              </datalist>
            </div>
            <div>
              <label className="form-label">Probe-Nr.</label>
              <input aria-label="Probe-Nr." name="probe_nr" type="text" className="form-input py-2.5 sm:py-2 text-base sm:text-sm" placeholder="Interne Probennummer" />
            </div>
          </div>
        </div>

        {/* Chemische Parameter */}
        <div className="card space-y-4">
          <h2 className="text-sm font-semibold text-s112-muted uppercase tracking-wider">Chemische Parameter</h2>
          <p className="text-xs text-s112-muted">Dezimaltrenner: Komma oder Punkt (z.B. 12,5 oder 12.5)</p>
          {/* KAN-203: Mostgewicht im Gärverlauf (optional) – Messwert in °KMW oder °Oe, die andere Einheit wird umgerechnet */}
          <MostgewichtEingabe name="mostgewicht" label="Mostgewicht (Gärverlauf)" />
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            <DecimalInput name="alkohol_vol"        label="Alkohol"         unit="% vol"  placeholder="z.B. 12,5" />
            <DecimalInput name="restzucker_gl"      label="Restzucker"      unit="g/l"    placeholder="z.B. 3,2" />
            <DecimalInput name="gesamtsaeure_gl"    label="Gesamtsäure"     unit="g/l"    placeholder="z.B. 5,8" />
            <DecimalInput name="ph_wert"            label="pH-Wert"                       placeholder="z.B. 3,20" />
            <DecimalInput name="fluechtige_saeure_gl" label="Flüchtige Säure" unit="g/l" placeholder="z.B. 0,42" />
            <DecimalInput name="freie_so2_mgl"      label="Freies SO₂"      unit="mg/l"   placeholder="z.B. 28" />
            <DecimalInput name="gesamt_so2_mgl"     label="Gesamt-SO₂"      unit="mg/l"   placeholder="z.B. 95" />
          </div>
        </div>

        {/* Bewertung */}
        <div className="card space-y-4">
          <h2 className="text-sm font-semibold text-s112-muted uppercase tracking-wider">Bewertung & Notizen</h2>
          <div>
            <label className="form-label">Bewertung</label>
            <textarea aria-label="Bewertung" name="bewertung" rows={2} className="form-input resize-none py-2.5 sm:py-2 text-base sm:text-sm"
              placeholder="Kommentar zur Analyse …" />
          </div>
          <div>
            <label className="form-label">Notizen</label>
            <textarea aria-label="Notizen" name="notizen" rows={2} className="form-input resize-none py-2.5 sm:py-2 text-base sm:text-sm"
              placeholder="Interne Notizen …" />
          </div>
        </div>

        {/* KAN-181: am Handy bleibt die Leiste beim Scrollen unten sichtbar */}
        <div className="flex items-center gap-3 max-sm:sticky max-sm:bottom-0 max-sm:-mx-4 max-sm:px-4 max-sm:py-3 max-sm:bg-s112-bg max-sm:border-t max-sm:border-s112-line max-sm:z-10">
          <button
            type="submit"
            disabled={saving}
            className="flex-1 sm:flex-none bg-s112-teal text-s112-yellow px-6 py-3 sm:py-2 rounded-xl text-base sm:text-sm font-semibold hover:bg-s112-teal/90 transition-colors disabled:opacity-50"
          >
            {saving ? 'Wird gespeichert …' : 'Analyse speichern'}
          </button>
          <Link
            href={`/kellerbuch/weinausbau/${weinausbauId}/analysen`}
            className="text-sm text-s112-muted hover:text-s112-text-1 transition-colors"
          >
            Abbrechen
          </Link>
        </div>
      </form>
    </div>
  )
}
