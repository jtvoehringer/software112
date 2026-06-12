'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

const DAC_REGIONEN = [
  { value: 'weinviertel',           label: 'Weinviertel DAC' },
  { value: 'kamptal',               label: 'Kamptal DAC' },
  { value: 'kremstal',              label: 'Kremstal DAC' },
  { value: 'wachau',                label: 'Wachau (Vinea Wachau)' },
  { value: 'wagram',                label: 'Wagram DAC' },
  { value: 'traisental',            label: 'Traisental DAC' },
  { value: 'carnuntum',             label: 'Carnuntum DAC' },
  { value: 'leithaberg',            label: 'Leithaberg DAC' },
  { value: 'neusiedlersee',         label: 'Neusiedlersee DAC' },
  { value: 'mittelburgenland',      label: 'Mittelburgenland DAC' },
  { value: 'eisenberg',             label: 'Eisenberg DAC' },
  { value: 'rosalia',               label: 'Rosalia DAC' },
  { value: 'thermenregion',         label: 'Thermenregion DAC' },
  { value: 'wiener_gemischter_satz',label: 'Wiener Gemischter Satz DAC' },
  { value: 'sonstiges',             label: 'Sonstiges' },
]

const REBSORTEN = [
  'Grüner Veltliner','Riesling','Welschriesling','Zweigelt',
  'Blaufränkisch','St. Laurent','Chardonnay','Weißburgunder',
  'Grauburgunder','Sauvignon Blanc','Pinot Noir',
]

type WeinausbauRow = { id: string; name: string }
type DacRow = {
  id: string; weinausbau_id: string | null; bezeichnung: string; dac_region: string
  jahrgang: number | null; rebsorte: string | null; menge_liter: number | null
  alkohol_prozent: number | null; status: string; pruefnummer: string | null
  eingereicht_am: string | null; bescheid_am: string | null; notizen: string | null; aktiv: boolean
}

interface Props {
  dac?: DacRow
  weinausbau: WeinausbauRow[]
  action: (formData: FormData) => Promise<void>
}

export default function DacForm({ dac, weinausbau, action }: Props) {
  const router = useRouter()
  const [isDac, setIsDac] = useState(dac ? !!dac.dac_region && dac.dac_region !== 'sonstiges' : false)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setSaving(true)
    const raw = new FormData(e.currentTarget)
    const normalized = new FormData()
    raw.forEach((value, key) => {
      if (['menge_liter', 'alkohol_prozent'].includes(key) && typeof value === 'string') {
        normalized.append(key, value.replace(',', '.'))
      } else {
        normalized.append(key, value)
      }
    })
    try {
      await action(normalized)
      router.push('/dac')
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Fehler beim Speichern')
      setSaving(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3 text-sm"><strong>Fehler:</strong> {error}</div>}

      {/* Antragsdaten */}
      <div className="card space-y-4">
        <h2 className="text-sm font-semibold text-s112-muted uppercase tracking-wider">Antragsdaten</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="sm:col-span-2">
            <label className="form-label">Bezeichnung *</label>
            <input name="bezeichnung" type="text" required defaultValue={dac?.bezeichnung ?? ''} className="form-input" placeholder="z.B. Grüner Veltliner Kremser Schmidt 2025" />
          </div>
          <div className="sm:col-span-2">
            <label className="flex items-center gap-2.5 cursor-pointer select-none">
              <div onClick={() => setIsDac(v => !v)}
                className={`w-9 h-5 rounded-full transition-colors flex-shrink-0 ${isDac ? 'bg-s112-teal' : 'bg-gray-300'}`}>
                <div className={`w-4 h-4 bg-white rounded-full shadow mt-0.5 transition-transform ${isDac ? 'translate-x-4' : 'translate-x-0.5'}`} />
              </div>
              <span className="text-sm font-medium text-gray-700">DAC-Antrag (mit Lagenbezeichnung)</span>
            </label>
          </div>
          {isDac && (
            <div>
              <label className="form-label">DAC-Region *</label>
              <select name="dac_region" required={isDac} defaultValue={dac?.dac_region ?? ''} className="form-input">
                <option value="">– bitte wählen –</option>
                {DAC_REGIONEN.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
            </div>
          )}
          {!isDac && <input type="hidden" name="dac_region" value="sonstiges" />}
          <div>
            <label className="form-label">Weinausbau-Charge</label>
            <select name="weinausbau_id" defaultValue={dac?.weinausbau_id ?? ''} className="form-input">
              <option value="">– keine Verknüpfung –</option>
              {weinausbau.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div>
            <label className="form-label">Jahrgang</label>
            <input name="jahrgang" type="number" min="1900" max="2100" defaultValue={dac?.jahrgang ?? new Date().getFullYear()} className="form-input" />
          </div>
          <div>
            <label className="form-label">Rebsorte</label>
            <input name="rebsorte" type="text" list="rebsorten-dac" defaultValue={dac?.rebsorte ?? ''} className="form-input" />
            <datalist id="rebsorten-dac">{REBSORTEN.map(r => <option key={r} value={r} />)}</datalist>
          </div>
          <div>
            <label className="form-label">Menge (Liter)</label>
            <input name="menge_liter" type="text" inputMode="decimal" defaultValue={dac?.menge_liter?.toString().replace('.', ',') ?? ''} className="form-input" placeholder="z.B. 1.500" />
          </div>
          <div>
            <label className="form-label">Alkohol (% vol)</label>
            <input name="alkohol_prozent" type="text" inputMode="decimal" defaultValue={dac?.alkohol_prozent?.toString().replace('.', ',') ?? ''} className="form-input" placeholder="z.B. 12,5" />
          </div>
        </div>
      </div>

      {/* Status & Prüfnummer */}
      <div className="card space-y-4">
        <h2 className="text-sm font-semibold text-s112-muted uppercase tracking-wider">Status & Prüfnummer</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="form-label">Status</label>
            <select name="status" defaultValue={dac?.status ?? 'entwurf'} className="form-input">
              <option value="entwurf">📝 Entwurf</option>
              <option value="eingereicht">📬 Eingereicht</option>
              <option value="in_pruefung">🔍 In Prüfung</option>
              <option value="genehmigt">✅ Genehmigt</option>
              <option value="abgelehnt">❌ Abgelehnt</option>
            </select>
          </div>
          <div>
            <label className="form-label">Prüfnummer</label>
            <input name="pruefnummer" type="text" defaultValue={dac?.pruefnummer ?? ''} className="form-input font-mono" placeholder="nach Genehmigung eintragen" />
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="form-label">Eingereicht am</label>
            <input name="eingereicht_am" type="date" defaultValue={dac?.eingereicht_am ?? ''} className="form-input" />
          </div>
          <div>
            <label className="form-label">Bescheid am</label>
            <input name="bescheid_am" type="date" defaultValue={dac?.bescheid_am ?? ''} className="form-input" />
          </div>
        </div>
      </div>

      {/* Notizen */}
      <div className="card space-y-4">
        <h2 className="text-sm font-semibold text-s112-muted uppercase tracking-wider">Notizen</h2>
        <textarea name="notizen" rows={3} defaultValue={dac?.notizen ?? ''} className="form-input resize-none" placeholder="Kostnotizen, Anmerkungen zur Prüfung …" />
      </div>

      {dac && (
        <div className="card">
          <label className="flex items-center gap-3 cursor-pointer">
            <input type="checkbox" name="aktiv" value="true" defaultChecked={dac.aktiv} className="w-4 h-4 accent-s112-teal" />
            <span className="text-sm font-medium text-gray-700">Antrag aktiv</span>
          </label>
        </div>
      )}

      <div className="flex items-center gap-3">
        <button type="submit" disabled={saving} className="bg-s112-teal text-white px-6 py-2 rounded-xl text-sm font-semibold hover:bg-opacity-90 transition-colors disabled:opacity-50">
          {saving ? 'Wird gespeichert …' : 'Speichern'}
        </button>
        <button type="button" onClick={() => router.push('/dac')} className="text-sm text-s112-muted hover:text-gray-700 transition-colors">Abbrechen</button>
      </div>
    </form>
  )
}
