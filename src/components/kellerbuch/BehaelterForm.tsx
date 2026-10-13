'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { hierBleiben, zielNachVorgang, zurueckZiel } from '@/lib/navigation/zurueckBrowser'
import { fehlerText } from '@/lib/fehler'

type BehaelterRow = {
  id: string; name: string; typ: string | null
  volumen_liter: number | null; standort: string | null; aktiv: boolean
  notizen?: string | null; stapler?: boolean; gemeinsam?: boolean
  /** KAN-174 F: Hinweis Lohnproduktion */
  lp_pickerl?: string | null
}

interface Props {
  behaelter?: BehaelterRow
  action: (formData: FormData) => Promise<void>
  /** Partnerbetriebe (Kellergemeinschaft) - zeigt den Freigabe-Schalter; null = keine */
  partner?: string | null
}

export default function BehaelterForm({ behaelter, action, partner = null }: Props) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setSaving(true)
    try {
      await action(new FormData(e.currentTarget))
      // KAN-334: Bearbeiten auf der Detailseite bleibt dort (mit Bestätigung), Neuanlage zurück im selben Bereich
      if (behaelter) { router.replace(hierBleiben(), { scroll: false }); setSaving(false) }
      else router.push(zielNachVorgang('/kellerbuch', 'gespeichert'))
      router.refresh()
    } catch (err) {
      setError(fehlerText(err, 'Fehler beim Speichern'))
      setSaving(false)
    }
  }

  return (
    <form data-ungespeichert onSubmit={handleSubmit} className="space-y-6">
      {error && <div className="bg-s112-err-bg border border-s112-err/30 text-s112-err-fg rounded-xl px-4 py-3 text-sm"><strong>Fehler:</strong> {error}</div>}

      <div className="card space-y-4">
        <h2 className="text-sm font-semibold text-s112-muted uppercase tracking-wider">Basisdaten</h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="form-label">Name *</label>
            <input aria-label="Name" name="name" type="text" required defaultValue={behaelter?.name ?? ''} className="form-input" placeholder="z.B. Tank 01" />
          </div>
          <div>
            <label className="form-label">Typ</label>
            <select aria-label="Typ" name="typ" defaultValue={behaelter?.typ ?? ''} className="form-input">
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
              <option value="stahltank">Stahltank</option>
              <option value="presse">Presse</option>
              <option value="zisterne">Zisterne</option>
              <option value="sonstiges">Sonstiges</option>
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="form-label">Volumen (Liter)</label>
            <input aria-label="Volumen (Liter)" name="volumen_liter" type="text" inputMode="decimal"
              defaultValue={behaelter?.volumen_liter?.toString().replace('.', ',') ?? ''}
              className="form-input" placeholder="z.B. 5.000" />
          </div>
          <div>
            <label className="form-label">Standort</label>
            <input aria-label="Standort" name="standort" type="text" defaultValue={behaelter?.standort ?? ''} className="form-input" placeholder="z.B. Keller Süd" />
          </div>
          <div className="sm:col-span-2">
            <label className="form-label">Notizen</label>
            <input aria-label="Notizen" name="notizen" type="text" defaultValue={behaelter?.notizen ?? ''} className="form-input" placeholder="z.B. geliehen, Besonderheiten" />
          </div>
          {/* KAN-174 F: LP-Pickerl – nur Hinweis für die Sachbearbeiter, in keiner Aufzeichnung; leeren = entfernen */}
          <div className="sm:col-span-2">
            <label className="form-label">LP-Pickerl (Lohnproduktion)</label>
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-s112-text-2 shrink-0">LP +</span>
              <input aria-label="LP-Pickerl" name="lp_pickerl" type="text" maxLength={60} defaultValue={behaelter?.lp_pickerl ?? ''} className="form-input" placeholder="z.B. Huber – leer lassen, wenn frei" />
            </div>
            <p className="text-xs text-s112-muted mt-1">Nur ein Hinweis (z. B. reserviert für Lohnproduktion) – zählt in keinem Bestand und keiner Meldung.</p>
          </div>
          <div className="sm:col-span-2 flex flex-wrap gap-5">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" name="stapler" value="true" defaultChecked={!!behaelter?.stapler} className="w-4 h-4 accent-s112-teal" />
              <span className="text-sm text-s112-text-1">mit Stapler versetzbar</span>
            </label>
            {partner && (
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="hidden" name="gemeinsam_sichtbar" value="1" />
                <input type="checkbox" name="gemeinsam" value="true" defaultChecked={behaelter?.gemeinsam !== false} className="w-4 h-4 accent-s112-teal" />
                <span className="text-sm text-s112-text-1">für Partnerbetriebe freigegeben ({partner})</span>
              </label>
            )}
          </div>
        </div>
      </div>

      {behaelter && (
        <div className="card">
          <label className="flex items-center gap-3 cursor-pointer">
            <input type="checkbox" name="aktiv" value="true" defaultChecked={behaelter.aktiv} className="w-4 h-4 accent-s112-teal" />
            <span className="text-sm font-medium text-s112-text-1">Behälter aktiv</span>
          </label>
        </div>
      )}

      <div className="flex items-center gap-3">
        <button type="submit" disabled={saving} className="bg-s112-teal text-s112-yellow px-6 py-2 rounded-xl text-sm font-semibold hover:bg-s112-teal/90 transition-colors disabled:opacity-50">
          {saving ? 'Wird gespeichert …' : 'Speichern'}
        </button>
        <button type="button" onClick={() => router.push(zurueckZiel('/kellerbuch'))} className="text-sm text-s112-muted hover:text-s112-text-1 transition-colors">Abbrechen</button>
      </div>
    </form>
  )
}
