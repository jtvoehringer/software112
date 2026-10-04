'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { fehlerText } from '@/lib/fehler'
import { dezimal } from '@/lib/format'
import GesperrtHinweis from '@/components/GesperrtHinweis'
import { PN_FELD_LABEL, pnAenderbareFelder, pnSperre, pnStatusLabel, type PnFormularFeld } from '@/lib/dac/workflow'

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

type WeinausbauRow = { id: string; name: string; jahrgang?: number | null }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnalyseRow = Record<string, any>
type DacRow = {
  id: string; weinausbau_id: string | null; bezeichnung: string; dac_region: string
  jahrgang: number | null; rebsorte: string | null; menge_liter: number | null
  alkohol_prozent: number | null; status: string; pruefnummer: string | null
  eingereicht_am: string | null; bescheid_am: string | null; notizen: string | null; aktiv: boolean
  // KAN-97
  status_seit?: string | null; antragsnummer?: string | null; untersuchungsnummer?: string | null
  entzug_am?: string | null; entzug_grund?: string | null
}

interface Props {
  dac?: DacRow
  weinausbau: WeinausbauRow[]
  analysen?: AnalyseRow[]
  preChargeId?: string | null
  action: (formData: FormData) => Promise<void>
}

const datumDe = (d: string | null | undefined) => (d ? new Date(d).toLocaleDateString('de-AT') : null)

export default function DacForm({ dac, weinausbau, analysen = [], preChargeId, action }: Props) {
  // KAN-97: Felder, die der Status noch zulässt (wie die Freeze-Trigger der Datenbank); neuer Antrag = Entwurf
  const aenderbar = pnAenderbareFelder(dac?.status ?? 'entwurf')
  const gesperrt = (f: PnFormularFeld) => !aenderbar.includes(f)
  const sperre = dac ? pnSperre(dac) : null
  const router = useRouter()
  const [isDac, setIsDac] = useState(dac ? !!dac.dac_region && dac.dac_region !== 'sonstiges' : false)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  // KAN-84 (Kleinfix, vgl. KAN-98): Jahrgang aus der gewählten Charge vorschlagen statt des aktuellen Jahrs
  const jahrgangDerCharge = (id: string | null | undefined) => weinausbau.find(w => w.id === id)?.jahrgang ?? null
  const [jahrgang, setJahrgang] = useState<string>(
    String(dac?.jahrgang ?? jahrgangDerCharge(dac?.weinausbau_id ?? preChargeId) ?? new Date().getFullYear()))
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
        normalized.append(key, dezimal(value))
      } else {
        normalized.append(key, value)
      }
    })
    try {
      await action(normalized)
      router.push('/dac')
      router.refresh()
    } catch (err) {
      setError(fehlerText(err, 'Fehler beim Speichern'))
      setSaving(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {sperre && (
        <GesperrtHinweis grund={sperre.grund} seit={datumDe(sperre.seit)}
          erlaubt={aenderbar.map(f => PN_FELD_LABEL[f] ?? f)} />
      )}
      {error && <div className="bg-s112-err-bg border border-s112-err/30 text-s112-err-fg rounded-xl px-4 py-3 text-sm"><strong>Fehler:</strong> {error}</div>}

      {/* Antragsdaten */}
      <div className="card space-y-4">
        <h2 className="text-sm font-semibold text-s112-muted uppercase tracking-wider">Antragsdaten</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="sm:col-span-2">
            <label className="form-label">Bezeichnung *</label>
            <input aria-label="Bezeichnung" name="bezeichnung" type="text" required disabled={gesperrt('bezeichnung')} defaultValue={dac?.bezeichnung ?? ''} className="form-input" placeholder="z.B. Grüner Veltliner Kremser Schmidt 2025" />
          </div>
          <div className="sm:col-span-2">
            <label className="flex items-center gap-2.5 cursor-pointer select-none">
              <button type="button" role="switch" aria-checked={isDac} onClick={() => setIsDac(v => !v)} disabled={gesperrt('dac_region')}
                className={`w-9 h-5 rounded-full transition-colors flex-shrink-0 ${isDac ? 'bg-s112-teal' : 'bg-s112-line-str'}`}>
                <span className={`block w-4 h-4 bg-white rounded-full shadow mt-0.5 transition-transform ${isDac ? 'translate-x-4' : 'translate-x-0.5'}`} />
              </button>
              <span className="text-sm font-medium text-s112-text-1">DAC-Antrag (mit Lagenbezeichnung)</span>
            </label>
          </div>
          {isDac && (
            <div>
              <label className="form-label">DAC-Region *</label>
              <select aria-label="DAC-Region" name="dac_region" required={isDac} disabled={gesperrt('dac_region')} defaultValue={dac?.dac_region ?? ''} className="form-input">
                <option value="">– bitte wählen –</option>
                {DAC_REGIONEN.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
            </div>
          )}
          {!isDac && <input type="hidden" name="dac_region" value="sonstiges" />}
          <div>
            <label className="form-label">Weinausbau-Charge</label>
            <select aria-label="Weinausbau-Charge" name="weinausbau_id" disabled={gesperrt('weinausbau_id')} defaultValue={dac?.weinausbau_id ?? preChargeId ?? ''} className="form-input"
              onChange={e => { const jg = jahrgangDerCharge(e.target.value); if (jg != null) setJahrgang(String(jg)) }}>
              <option value="">– keine Verknüpfung –</option>
              {weinausbau.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div>
            <label className="form-label">Jahrgang</label>
            <input aria-label="Jahrgang" name="jahrgang" type="number" disabled={gesperrt('jahrgang')} min="1900" max="2100" value={jahrgang} onChange={e => setJahrgang(e.target.value)} className="form-input" />
          </div>
          <div>
            <label className="form-label">Rebsorte</label>
            <input aria-label="Rebsorte" name="rebsorte" type="text" disabled={gesperrt('rebsorte')} list="rebsorten-dac" defaultValue={dac?.rebsorte ?? ''} className="form-input" />
            <datalist id="rebsorten-dac">{REBSORTEN.map(r => <option key={r} value={r} />)}</datalist>
          </div>
          <div>
            <label className="form-label">Menge (Liter)</label>
            <input aria-label="Menge (Liter)" name="menge_liter" type="text" disabled={gesperrt('menge_liter')} inputMode="decimal" defaultValue={dac?.menge_liter?.toString().replace('.', ',') ?? ''} className="form-input" placeholder="z.B. 1.500" />
          </div>
          <div>
            <label className="form-label">Alkohol (% vol)</label>
            <div className="flex gap-2 items-center">
              <input
                name="alkohol_prozent"
                disabled={gesperrt('alkohol_prozent')}
                type="text"
                inputMode="decimal"
                value={alkohol}
                onChange={e => setAlkohol(e.target.value)}
                className="form-input"
                placeholder="z.B. 12,5"
              />
              {latestAnalyse?.alkohol_vol != null && !gesperrt('alkohol_prozent') && (
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
            className="inline-flex items-center gap-1.5 bg-s112-teal text-s112-yellow text-xs font-semibold px-3 py-1.5 rounded-lg hover:bg-opacity-90 transition-colors"
          >
            bawb.at öffnen
          </a>
        </div>
        {/* KAN-97: Status nur über die Statuswechsel auf der Detailseite – hier nur Anzeige */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
          <div>
            <span className="form-label">Status</span>
            <p className="font-medium">{pnStatusLabel(dac?.status ?? 'entwurf')}{dac?.status_seit ? ` seit ${datumDe(dac.status_seit)}` : ''}</p>
          </div>
          <div>
            <span className="form-label">Eingereicht am</span>
            <p>{datumDe(dac?.eingereicht_am) ?? '–'}</p>
          </div>
          <div>
            <span className="form-label">Bescheid am</span>
            <p>{datumDe(dac?.bescheid_am) ?? '–'}</p>
          </div>
          {dac?.entzug_am && (
            <div className="sm:col-span-3 text-s112-err-fg">Entzogen am {datumDe(dac.entzug_am)}{dac.entzug_grund ? ` – ${dac.entzug_grund}` : ''}</div>
          )}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="form-label">Prüfnummer</label>
            <input aria-label="Prüfnummer" name="pruefnummer" type="text" disabled={gesperrt('pruefnummer')} defaultValue={dac?.pruefnummer ?? ''} className="form-input font-mono" placeholder="bei Einreichung bzw. Zuteilung" />
          </div>
          <div>
            <label className="form-label">Antragsnummer</label>
            <input aria-label="Antragsnummer" name="antragsnummer" type="text" maxLength={60} disabled={gesperrt('antragsnummer')} defaultValue={dac?.antragsnummer ?? ''} className="form-input font-mono" />
          </div>
          <div>
            <label className="form-label">Untersuchungsnummer</label>
            <input aria-label="Untersuchungsnummer" name="untersuchungsnummer" type="text" maxLength={60} disabled={gesperrt('untersuchungsnummer')} defaultValue={dac?.untersuchungsnummer ?? ''} className="form-input font-mono" />
          </div>
        </div>
      </div>

      {/* Notizen */}
      <div className="card space-y-4">
        <h2 className="text-sm font-semibold text-s112-muted uppercase tracking-wider">Notizen</h2>
        <textarea name="notizen" rows={3} disabled={gesperrt('notizen')} defaultValue={dac?.notizen ?? ''} className="form-input resize-none" placeholder="Kostnotizen, Anmerkungen zur Prüfung …" />
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
           <button type="submit" disabled={saving} className="bg-s112-teal text-s112-yellow px-6 py-2 rounded-xl text-sm font-semibold hover:bg-opacity-90 transition-colors disabled:opacity-50">
          {saving ? 'Wird gespeichert …' : 'Speichern'}
        </button>
        <button type="button" onClick={() => router.push('/dac')} className="text-sm text-s112-muted hover:text-s112-text-1 transition-colors">Abbrechen</button>
      </div>
    </form>
  )
}
