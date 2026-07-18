'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { updateBehandlung } from '../../actions'

const BBCH_OPTIONS = [
  { value: '09', label: '09 – Knospenaufbruch' },
  { value: '11', label: '11 – 1. Blatt entfaltet' },
  { value: '53', label: '53 – Traubenanlage sichtbar' },
  { value: '55', label: '55 – Einzelblüten sichtbar' },
  { value: '57', label: '57 – Blütenstand gestreckt' },
  { value: '61', label: '61 – Beginn Blüte (10%)' },
  { value: '65', label: '65 – Vollblüte (50%)' },
  { value: '69', label: '69 – Ende Blüte' },
  { value: '71', label: '71 – Fruchtansatz' },
  { value: '73', label: '73 – Erbsengröße' },
  { value: '75', label: '75 – Haselnussgröße' },
  { value: '77', label: '77 – Trauben schließen sich' },
  { value: '81', label: '81 – Beginn Reife' },
  { value: '85', label: '85 – Weichwerden' },
  { value: '89', label: '89 – Vollreife' },
]
const WITTERUNG = ['sonnig', 'bewoelkt', 'regnerisch', 'wind']
const EINHEITEN_AUFWAND = ['kg_ha', 'l_ha', 'g_hl', 'ml_hl', 'kg', 'l']
const EINHEITEN_LABEL: Record<string, string> = {
  kg_ha: 'kg/ha', l_ha: 'l/ha', g_hl: 'g/hl', ml_hl: 'ml/hl', kg: 'kg', l: 'l',
}
const ART_OPTIONS = [
  { value: 'spritzung',        label: '💧 Spritzung' },
  { value: 'duengung',         label: '🌿 Düngung' },
  { value: 'bodenbearbeitung', label: '🪱 Bodenbearbeitung' },
  { value: 'schnitt',          label: '✂️ Schnitt' },
  { value: 'laubarbeit',       label: '🍃 Laubarbeit' },
  { value: 'lese',             label: '🍇 Lese' },
  { value: 'sonstiges',        label: '📋 Sonstiges' },
]
const MENGE_EINHEITEN = ['kg', 'l', 'g', 'ml']
const LAUBARBEIT_OPTIONEN = [
  { value: 'entblaettern', label: 'Entblättern' },
  { value: 'ausgeizen',    label: 'Ausgeizen' },
  { value: 'gipfeln',      label: 'Gipfeln' },
  { value: 'heften',       label: 'Heften' },
  { value: 'sonstige',     label: 'Sonstige' },
]

const BIO_SPERRE = new Set(['bio_eu', 'biodynamisch'])
const BIO_WARNUNG = new Set(['kip', 'nachhaltig'])

export type BehandlungEdit = {
  id: string
  datum: string
  datum_bis: string | null
  art: string
  psm_id: string | null
  duengemittel_id: string | null
  aufwandmenge: number | null
  aufwandmenge_einheit: string | null
  menge_gesamt: number | null
  menge_einheit: string | null
  konzentration: number | null
  wasseraufwand_l_ha: number | null
  bbch_stadium: string | null
  schaderreger: string | null
  witterung: string | null
  temperatur_c: number | null
  notizen: string | null
  bearbeitungstiefe_cm: number | null
  bearbeitungsgeraet: string | null
  schnittart: string | null
  laubarbeit_art: string | null
  einarbeitung: boolean | null
  einarbeitung_zeitpunkt: string | null
  wartezeit_tage: number | null
  weingarten_name: string | null
}

export type PSMOption = {
  id: string
  name: string
  handelsname: string | null
  oeko_zugelassen: boolean
  cu_gehalt_pct: number | null
  wartezeit_tage: number | null
}

export type DuengemittelOption = {
  id: string
  name: string
  handelsname: string | null
  typ: string | null
  wartezeit_tage: number | null
  oeko_zugelassen: boolean
}

const inputCls = 'w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40'
const labelCls = 'block text-sm font-medium text-gray-700 mb-1'

export default function BehandlungEditForm({
  behandlung, psm, duengemittel, bioStatus,
}: {
  behandlung: BehandlungEdit
  psm: PSMOption[]
  duengemittel: DuengemittelOption[]
  bioStatus: string
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [art, setArt] = useState(behandlung.art)
  const [selectedPsmId, setSelectedPsmId] = useState(behandlung.psm_id ?? '')
  const [selectedDuengemittelId, setSelectedDuengemittelId] = useState(behandlung.duengemittel_id ?? '')
  const [error, setError] = useState<string | null>(null)

  const selectedPsm = psm.find(p => p.id === selectedPsmId)
  const selectedDuengemittel = duengemittel.find(d => d.id === selectedDuengemittelId)

  const gewaehltesMittelOeko =
    art === 'spritzung' || art === 'sonstiges' ? selectedPsm?.oeko_zugelassen :
    art === 'duengung'  ? selectedDuengemittel?.oeko_zugelassen :
    undefined
  const mittelNichtOeko = gewaehltesMittelOeko === false
  const bioSperre  = BIO_SPERRE.has(bioStatus) && mittelNichtOeko
  const bioWarnung = !bioSperre && BIO_WARNUNG.has(bioStatus) && mittelNichtOeko

  const updateWithId = updateBehandlung.bind(null, behandlung.id)

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    if (bioSperre) {
      setError('Dieses Mittel ist nicht öko-zugelassen und passt nicht zum Bio-Status des Betriebs. Bitte ein zugelassenes Mittel wählen.')
      return
    }
    const fd = new FormData(e.currentTarget)
    // wartezeit_tage aus dem gewählten PSM/Düngemittel
    const wartezeit = selectedPsm?.wartezeit_tage ?? selectedDuengemittel?.wartezeit_tage
    if (wartezeit != null) {
      fd.set('wartezeit_tage', String(wartezeit))
    }
    startTransition(async () => {
      try {
        await updateWithId(fd)
        router.push('/behandlungen')
        router.refresh()
      } catch (err) {
        setError((err as Error).message)
      }
    })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">

      {/* Weingarten-Info (readonly) */}
      {behandlung.weingarten_name && (
        <div className="card bg-s112-bg/50 p-4 flex items-center gap-3">
          <span className="text-2xl">🌿</span>
          <div>
            <p className="text-xs text-s112-muted">Weingarten (nicht änderbar)</p>
            <p className="font-semibold text-gray-800">{behandlung.weingarten_name}</p>
          </div>
        </div>
      )}

      {/* Art & Datum */}
      <div className="card space-y-4">
        <h2 className="text-base font-semibold text-gray-800">Maßnahme</h2>

        <div>
          <label className={labelCls}>Art</label>
          <div className="flex flex-wrap gap-2">
            {ART_OPTIONS.map(o => (
              <label key={o.value} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-sm cursor-pointer transition-colors
                ${art === o.value
                  ? 'bg-s112-teal text-white border-s112-teal'
                  : 'bg-white text-gray-700 border-s112-border hover:border-s112-teal/50'}`}>
                <input type="radio" name="art" value={o.value} checked={art === o.value}
                  onChange={() => setArt(o.value)} className="sr-only" />
                {o.label}
              </label>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelCls}>Datum von <span className="text-red-500">*</span></label>
            <input name="datum" type="date" required defaultValue={behandlung.datum} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Datum bis</label>
            <input name="datum_bis" type="date" defaultValue={behandlung.datum_bis ?? ''} className={inputCls} />
          </div>
        </div>

        {/* PSM */}
        {(art === 'spritzung' || art === 'sonstiges') && (
          <div>
            <label className={labelCls}>Spritzmittel / Mittel (PSM)</label>
            <select name="psm_id" value={selectedPsmId}
              onChange={e => setSelectedPsmId(e.target.value)}
              className={inputCls}>
              <option value="">– keines –</option>
              {psm.map(p => (
                <option key={p.id} value={p.id}>
                  {p.name}{p.handelsname ? ` (${p.handelsname})` : ''}
                  {p.oeko_zugelassen ? ' 🌿' : ''}
                  {p.cu_gehalt_pct ? ` · Cu ${p.cu_gehalt_pct}%` : ''}
                </option>
              ))}
            </select>
            {selectedPsm?.wartezeit_tage != null && (
              <p className="text-xs text-amber-600 mt-1">⏳ Wartezeit: {selectedPsm.wartezeit_tage} Tage vor Ernte</p>
            )}
          </div>
        )}

        {/* Düngemittel */}
        {art === 'duengung' && (
          <div>
            <label className={labelCls}>Düngemittel</label>
            <select name="duengemittel_id" value={selectedDuengemittelId}
              onChange={e => setSelectedDuengemittelId(e.target.value)}
              className={inputCls}>
              <option value="">– keines –</option>
              {duengemittel.map(d => (
                <option key={d.id} value={d.id}>
                  {d.name}{d.handelsname ? ` (${d.handelsname})` : ''}
                  {d.typ ? ` · ${d.typ}` : ''}
                  {d.oeko_zugelassen ? ' 🌿' : ''}
                </option>
              ))}
            </select>
            {selectedDuengemittel?.wartezeit_tage != null && (
              <p className="text-xs text-amber-600 mt-1">⏳ Wartezeit: {selectedDuengemittel.wartezeit_tage} Tage vor Ernte</p>
            )}
          </div>
        )}

        {bioSperre && (
          <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3 text-sm">
            ⛔ Das gewählte Mittel ist nicht öko-zugelassen – passt nicht zum Bio-Status des Betriebs. Speichern ist gesperrt.
          </div>
        )}
        {bioWarnung && (
          <div className="bg-amber-50 border border-amber-200 text-amber-700 rounded-xl px-4 py-3 text-sm">
            ⚠️ Das gewählte Mittel ist nicht öko-zugelassen – bitte prüfen, ob das beabsichtigt ist.
          </div>
        )}

        {/* Mengen */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>Gesamtmenge eingesetzt</label>
            <div className="flex gap-2">
              <input name="menge_gesamt" type="number" step="0.001" min="0"
                defaultValue={behandlung.menge_gesamt ?? ''}
                className="flex-1 border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40" />
              <select name="menge_einheit" defaultValue={behandlung.menge_einheit ?? 'kg'}
                className="w-20 border border-s112-border rounded-lg px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40">
                {MENGE_EINHEITEN.map(e => <option key={e} value={e}>{e}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className={labelCls}>Konzentration (%)</label>
            <input name="konzentration" type="number" step="0.01" min="0" max="100"
              defaultValue={behandlung.konzentration ?? ''}
              className={inputCls} />
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className={labelCls}>Aufwandmenge (Etikett)</label>
            <input name="aufwandmenge" type="number" step="0.001" min="0"
              defaultValue={behandlung.aufwandmenge ?? ''} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Einheit</label>
            <select name="aufwandmenge_einheit"
              defaultValue={behandlung.aufwandmenge_einheit ?? 'l_ha'}
              className={inputCls}>
              {EINHEITEN_AUFWAND.map(e => <option key={e} value={e}>{EINHEITEN_LABEL[e]}</option>)}
            </select>
          </div>
          <div>
            <label className={labelCls}>Wasser (l/ha)</label>
            <input name="wasseraufwand_l_ha" type="number" step="1" min="0"
              defaultValue={behandlung.wasseraufwand_l_ha ?? ''} className={inputCls} />
          </div>
        </div>

        {art === 'spritzung' && (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>BBCH-Stadium</label>
              <select name="bbch_stadium" defaultValue={behandlung.bbch_stadium ?? ''} className={inputCls}>
                <option value="">– Auswählen –</option>
                {BBCH_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>Schaderreger</label>
              <input name="schaderreger" type="text"
                defaultValue={behandlung.schaderreger ?? ''} className={inputCls}
                placeholder="z.B. Peronospora" />
            </div>
          </div>
        )}

        {/* Düngung: Einarbeitung */}
        {art === 'duengung' && (
          <div className="grid grid-cols-2 gap-3 items-end">
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input type="checkbox" name="einarbeitung" defaultChecked={!!behandlung.einarbeitung} className="accent-s112-teal" />
              Eingearbeitet
            </label>
            <div>
              <label className={labelCls}>Zeitpunkt Einarbeitung</label>
              <input name="einarbeitung_zeitpunkt" type="date"
                defaultValue={behandlung.einarbeitung_zeitpunkt ?? ''} className={inputCls} />
            </div>
          </div>
        )}

        {/* Bodenbearbeitung */}
        {art === 'bodenbearbeitung' && (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Bearbeitungstiefe (cm)</label>
              <input name="bearbeitungstiefe_cm" type="number" step="1" min="0"
                defaultValue={behandlung.bearbeitungstiefe_cm ?? ''} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Gerät</label>
              <input name="bearbeitungsgeraet" type="text"
                defaultValue={behandlung.bearbeitungsgeraet ?? ''} className={inputCls} placeholder="z.B. Grubber" />
            </div>
          </div>
        )}

        {/* Schnitt */}
        {art === 'schnitt' && (
          <div>
            <label className={labelCls}>Schnittart</label>
            <input name="schnittart" type="text"
              defaultValue={behandlung.schnittart ?? ''} className={inputCls} placeholder="z.B. Guyot, Kordon" />
          </div>
        )}

        {/* Laubarbeit */}
        {art === 'laubarbeit' && (
          <div>
            <label className={labelCls}>Art der Laubarbeit</label>
            <select name="laubarbeit_art" defaultValue={behandlung.laubarbeit_art ?? ''} className={inputCls}>
              <option value="">– Auswählen –</option>
              {LAUBARBEIT_OPTIONEN.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>Witterung</label>
            <select name="witterung" defaultValue={behandlung.witterung ?? ''} className={inputCls}>
              <option value="">–</option>
              {WITTERUNG.map(w => <option key={w} value={w}>{w.charAt(0).toUpperCase() + w.slice(1)}</option>)}
            </select>
          </div>
          <div>
            <label className={labelCls}>Temperatur (°C)</label>
            <input name="temperatur_c" type="number" step="0.1"
              defaultValue={behandlung.temperatur_c ?? ''} className={inputCls} />
          </div>
        </div>

        <div>
          <label className={labelCls}>Notizen</label>
          <textarea name="notizen" rows={2} defaultValue={behandlung.notizen ?? ''}
            className={inputCls.replace('w-full', 'w-full')} />
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3 text-sm">{error}</div>
      )}

      <div className="flex gap-3">
        <button type="submit" disabled={pending || bioSperre}
          className="bg-s112-teal text-white px-6 py-2.5 rounded-xl text-sm font-semibold hover:bg-opacity-90 disabled:opacity-50 transition-colors">
          {pending ? 'Speichert…' : 'Änderungen speichern'}
        </button>
        <a href="/behandlungen" className="px-5 py-2.5 rounded-xl text-sm font-medium text-gray-600 hover:text-gray-800">
          Abbrechen
        </a>
      </div>
    </form>
  )
}
