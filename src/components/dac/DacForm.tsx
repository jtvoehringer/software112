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
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnalyseRow = Record<string, any>
type DacRow = {
  id: string; weinausbau_id: string | null; bezeichnung: string; dac_region: string
  jahrgang: number | null; rebsorte: string | null; menge_liter: number | null
  alkohol_prozent: number | null; status: string; pruefnummer: string | null
  eingereicht_am: string | null; bescheid_am: string | null; notizen: string | null; aktiv: boolean
}

interface Props {
  dac?: DacRow
  weinausbau: WeinausbauRow[]
  analysen?: AnalyseRow[]
  preChargeId?: string | null
  action: (formData: FormData) => Promise<void>
}

export default function DacForm({ dac, weinausbau, analysen = [], preChargeId, action }: Props) {
  const router = useRouter()
  const [isDac, setIsDac] = useState(dac ? !!dac.dac_region && dac.dac_region !== 'sonstiges' : false)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [alkohol, setAlkohol] = useState<string>(
    dac?.alkohol_prozent?.toString().replace('.', ',') ?? ''
  )

  const latestAnalyse = analysen[0] ?? null

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
      {error && <div className="bg-s112-err-bg border border-s112-err/30 text-s112-err-fg rounded-xl px-4 py-3 text-sm"><strong>Fehler:</strong> {error}</div>}

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
                className={`w-9 h-5 rounded-full transition-colors flex-shrink-0 ${isDac ? 'bg-s112-teal' : 'bg-s112-line-str'}`}>
                <div className={`w-4 h-4 bg-white rounded-full shadow mt-0.5 transition-transform ${isDac ? 'translate-x-4' : 'translate-x-0.5'}`} />
              </div>
              <span className="text-sm font-medium text-s112-text-1">DAC-Antrag (mit Lagenbezeichnung)</span>
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
            <select name="weinausbau_id" defaultValue={dac?.weinausbau_id ?? preChargeId ?? ''} className="form-input">
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
            <div className="flex gap-2 items-center">
              <input
                name="alkohol_prozent"
                type="text"
                inputMode="decimal"
                value={alkohol}
                onChange={e => setAlkohol(e.target.value)}
                className="form-input"
                placeholder="z.B. 12,5"
              />
              {latestAnalyse?.alkohol_vol != null && (
                <button
                  type="button"
                  onClick={() => setAlkohol(String(latestAnalyse.alkohol_vol).replace('.', ','))}
                  className="flex-shrink-0 text-xs bg-s112-blue-50 text-s112-blue-700 border border-s112-blue-100 px-2 py-1.5 rounded-lg hover:bg-s112-blue-100 transition-colors whitespace-nowrap"
                  title="Wert aus letzter Analyse übernehmen"
                >
                  {String(latestAnalyse.alkohol_vol).replace('.', ',')} %
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Status & Prüfnummer */}
      <div className="card space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-s112-muted uppercase tracking-wider">Status & Prüfnummer</h2>
          <a
            href="https://services2.lfrz.at/at.lfrz.wein/frame.html"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 bg-s112-teal text-white text-xs font-semibold px-3 py-1.5 rounded-lg hover:bg-opacity-90 transition-colors"
          >
            bawb.at öffnen
          </a>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="form-label">Status</label>
            <select name="status" defaultValue={dac?.status ?? 'entwurf'} className="form-input">
              <option value="entwurf">Entwurf</option>
              <option value="eingereicht">Eingereicht</option>
              <option value="in_pruefung">In Prüfung</option>
              <option value="genehmigt">Genehmigt</option>
              <option value="abgelehnt">Abgelehnt</option>
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

      {/* Laboranalysen – Referenzpanel */}
      {analysen.length > 0 && (
        <div className="card space-y-3 border-s112-blue-100 bg-s112-blue-50/30">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-s112-blue-700 uppercase tracking-wider">Laboranalysen ({analysen.length})</h2>
          </div>
          {analysen.map((a, i) => (
            <div key={i} className="bg-white rounded-lg border border-s112-blue-100 p-3">
              <p className="text-xs font-semibold text-s112-text-2 mb-2">
                {new Date(a.analyse_datum).toLocaleDateString('de-AT')}
                {a.labor ? ` · ${a.labor}` : ''}
              </p>
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-x-4 gap-y-1 text-xs">
                {a.alkohol_vol      != null && <span><span className="text-s112-muted">Alkohol </span><strong>{a.alkohol_vol} %</strong></span>}
                {a.restzucker_gl    != null && <span><span className="text-s112-muted">Restzucker </span><strong>{a.restzucker_gl} g/l</strong></span>}
                {a.gesamtsaeure_gl  != null && <span><span className="text-s112-muted">Ges.säure </span><strong>{a.gesamtsaeure_gl} g/l</strong></span>}
                {a.ph_wert          != null && <span><span className="text-s112-muted">pH </span><strong>{a.ph_wert}</strong></span>}
                {a['flüchtige_saeure_gl'] != null && <span><span className="text-s112-muted">Fl.Säure </span><strong>{a['flüchtige_saeure_gl']} g/l</strong></span>}
                {a.freie_so2_mgl    != null && <span><span className="text-s112-muted">SO₂ frei </span><strong>{a.freie_so2_mgl} mg/l</strong></span>}
                {a.gesamt_so2_mgl   != null && <span><span className="text-s112-muted">SO₂ ges. </span><strong>{a.gesamt_so2_mgl} mg/l</strong></span>}
              </div>
            </div>
          ))}
        </div>
      )}

      {analysen.length === 0 && (dac?.weinausbau_id || preChargeId) && (
        <div className="card border-s112-warn/30 bg-s112-warn-bg/40 text-sm text-s112-warn-fg flex items-center gap-3">
          <span>Für diese Charge gibt es noch keine Laboranalyse. <a href={`/kellerbuch/weinausbau/${dac?.weinausbau_id ?? preChargeId}/analysen/neu`} className="underline font-medium">Jetzt erfassen →</a></span>
        </div>
      )}

      {dac && (
        <div className="card">
          <label className="flex items-center gap-3 cursor-pointer">
            <input type="checkbox" name="aktiv" value="true" defaultChecked={dac.aktiv} className="w-4 h-4 accent-s112-teal" />
            <span className="text-sm font-medium text-s112-text-1">Antrag aktiv</span>
          </label>
        </div>
      )}

      <div className="flex items-center gap-3">
           <button type="submit" disabled={saving} className="bg-s112-teal text-white px-6 py-2 rounded-xl text-sm font-semibold hover:bg-opacity-90 transition-colors disabled:opacity-50">
          {saving ? 'Wird gespeichert …' : 'Speichern'}
        </button>
        <button type="button" onClick={() => router.push('/dac')} className="text-sm text-s112-muted hover:text-s112-text-1 transition-colors">Abbrechen</button>
      </div>
    </form>
  )
}
