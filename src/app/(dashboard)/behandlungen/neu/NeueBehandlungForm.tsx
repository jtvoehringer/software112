'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { createBehandlung } from '../actions'
import type { PSM, WeingartenOption } from './page'

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
const EINHEITEN = ['kg_ha', 'l_ha', 'g_hl', 'ml_hl', 'kg', 'l']
const EINHEIT_LABEL: Record<string, string> = {
  kg_ha: 'kg/ha', l_ha: 'l/ha', g_hl: 'g/hl', ml_hl: 'ml/hl', kg: 'kg', l: 'l',
}

export default function NeueBehandlungForm({
  psm, weingaerten,
}: {
  psm: PSM[]; weingaerten: WeingartenOption[]
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [selectedPsmId, setSelectedPsmId] = useState('')
  const [selectedWGs, setSelectedWGs] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)

  // Gewähltes PSM
  const selectedPsm = psm.find(p => p.id === selectedPsmId)

  // Weingärten nach Lage gruppieren
  const lagenMap = new Map<string, WeingartenOption[]>()
  for (const w of weingaerten) {
    const key = w.lage_name ?? '(Keine Lage)'
    const arr = lagenMap.get(key) ?? []
    arr.push(w)
    lagenMap.set(key, arr)
  }
  const lagen = Array.from(lagenMap.entries()).sort(([a], [b]) => a.localeCompare(b, 'de'))

  function toggleWG(id: string, spritzbar: boolean) {
    if (!spritzbar) return
    setSelectedWGs(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function toggleLage(wgs: WeingartenOption[]) {
    const spritzbare = wgs.filter(w => w.spritzbar).map(w => w.id)
    const allSelected = spritzbare.every(id => selectedWGs.has(id))
    setSelectedWGs(prev => {
      const next = new Set(prev)
      if (allSelected) {
        spritzbare.forEach(id => next.delete(id))
      } else {
        spritzbare.forEach(id => next.add(id))
      }
      return next
    })
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    if (selectedWGs.size === 0) { setError('Bitte mindestens einen Weingarten auswählen.'); return }
    const fd = new FormData(e.currentTarget)
    // Weingarten-IDs manuell hinzufügen
    selectedWGs.forEach(id => fd.append('weingarten_ids', id))
    startTransition(async () => {
      try {
        await createBehandlung(fd)
        router.push('/behandlungen')
        router.refresh()
      } catch (err) {
        setError((err as Error).message)
      }
    })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">

      {/* Basisdaten */}
      <div className="card space-y-4">
        <h2 className="text-base font-semibold text-gray-800">Behandlung</h2>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Datum <span className="text-red-500">*</span>
            </label>
            <input name="datum" type="date" required
              defaultValue={new Date().toISOString().split('T')[0]}
              className="w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">BBCH-Stadium</label>
            <select name="bbch_stadium"
              className="w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40">
              <option value="">– Auswählen –</option>
              {BBCH_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
        </div>

        {/* PSM */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Spritzmittel (PSM)</label>
          <select name="psm_id" value={selectedPsmId}
            onChange={e => setSelectedPsmId(e.target.value)}
            className="w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40">
            <option value="">– Auswählen –</option>
            {psm.map(p => (
              <option key={p.id} value={p.id}>
                {p.name}{p.handelsname ? ` (${p.handelsname})` : ''}{p.oeko_zugelassen ? ' 🌿' : ''}
              </option>
            ))}
          </select>
          {selectedPsm?.wartezeit_tage != null && (
            <p className="text-xs text-amber-600 mt-1">
              ⏳ Wartezeit: {selectedPsm.wartezeit_tage} Tage vor Ernte
            </p>
          )}
          {/* Hidden field für Wartezeit */}
          <input type="hidden" name="wartezeit_tage" value={selectedPsm?.wartezeit_tage ?? ''} />
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Aufwandmenge</label>
            <input name="aufwandmenge" type="number" step="0.001" min="0" placeholder="z.B. 3.0"
              className="w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Einheit</label>
            <select name="aufwandmenge_einheit"
              className="w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40">
              {EINHEITEN.map(e => <option key={e} value={e}>{EINHEIT_LABEL[e]}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Wasser (l/ha)</label>
            <input name="wasseraufwand_l_ha" type="number" step="1" min="0" placeholder="z.B. 500"
              className="w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40" />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Witterung</label>
            <select name="witterung"
              className="w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40">
              <option value="">–</option>
              {WITTERUNG.map(w => <option key={w} value={w}>{w.charAt(0).toUpperCase() + w.slice(1)}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Temperatur (°C)</label>
            <input name="temperatur_c" type="number" step="0.1" placeholder="z.B. 18.5"
              className="w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40" />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Notizen</label>
          <textarea name="notizen" rows={2}
            className="w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40" />
        </div>
      </div>

      {/* Weingarten-Auswahl */}
      <div className="card">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-semibold text-gray-800">
            Weingärten auswählen
            {selectedWGs.size > 0 && (
              <span className="ml-2 text-sm text-s112-teal font-normal">{selectedWGs.size} ausgewählt</span>
            )}
          </h2>
          <button type="button" onClick={() => setSelectedWGs(new Set(weingaerten.filter(w => w.spritzbar).map(w => w.id)))}
            className="text-xs text-s112-teal hover:underline">
            Alle auswählen
          </button>
        </div>

        <div className="space-y-3">
          {lagen.map(([lageName, wgs]) => {
            const spritzbare = wgs.filter(w => w.spritzbar)
            const allSelected = spritzbare.length > 0 && spritzbare.every(w => selectedWGs.has(w.id))
            const someSelected = spritzbare.some(w => selectedWGs.has(w.id))

            return (
              <div key={lageName} className="border border-s112-border rounded-xl overflow-hidden">
                {/* Lage-Header */}
                <div
                  className="flex items-center gap-3 px-3 py-2 bg-s112-bg cursor-pointer hover:bg-s112-bg/80 transition-colors"
                  onClick={() => toggleLage(wgs)}
                >
                  <input
                    type="checkbox"
                    readOnly
                    checked={allSelected}
                    ref={el => { if (el) el.indeterminate = someSelected && !allSelected }}
                    className="accent-s112-teal"
                  />
                  <span className="text-sm font-semibold text-gray-800">{lageName}</span>
                  <span className="text-xs text-s112-muted">{spritzbare.length} spritzbar</span>
                </div>
                {/* Weingärten */}
                <div className="divide-y divide-s112-border/40">
                  {wgs.map(w => (
                    <label
                      key={w.id}
                      className={`flex items-center gap-3 px-4 py-2 text-sm transition-colors
                        ${w.spritzbar ? 'cursor-pointer hover:bg-s112-bg/40' : 'opacity-40 cursor-not-allowed bg-gray-50'}`}
                    >
                      <input
                        type="checkbox"
                        checked={selectedWGs.has(w.id)}
                        onChange={() => toggleWG(w.id, w.spritzbar)}
                        disabled={!w.spritzbar}
                        className="accent-s112-teal"
                      />
                      <span className={`font-medium ${selectedWGs.has(w.id) ? 'text-s112-teal' : 'text-gray-800'}`}>
                        {w.name}
                      </span>
                      {!w.spritzbar && (
                        <span className="text-xs bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded-full ml-auto">
                          Brache / Gerodet
                        </span>
                      )}
                    </label>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3 text-sm">
          {error}
        </div>
      )}

      <div className="flex gap-3">
        <button type="submit" disabled={pending || selectedWGs.size === 0}
          className="bg-s112-teal text-white px-6 py-2.5 rounded-xl text-sm font-semibold hover:bg-opacity-90 disabled:opacity-50 transition-colors">
          {pending ? 'Speichert…' : `Behandlung erfassen (${selectedWGs.size} Weingarten/Weingärten)`}
        </button>
        <a href="/behandlungen" className="px-5 py-2.5 rounded-xl text-sm font-medium text-gray-600 hover:text-gray-800">
          Abbrechen
        </a>
      </div>
    </form>
  )
}
