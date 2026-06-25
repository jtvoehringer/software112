'use client'

import { useState, useTransition, useEffect } from 'react'
import { useRouter } from 'next/navigation'

type Gebinde = { id: string; name: string; volumen_liter?: number | null }
type Charge  = { id: string; name: string; menge_liter: number | null; behaelter_id?: string | null; rebsorte?: string | null }

interface Props {
  chargeId:        string
  chargeName:      string
  verfuegbarLiter: number
  gebinde:         Gebinde[]
  alleChargen:     Charge[]
  action:          (fd: FormData) => Promise<void>
  initialOpen?:    boolean
  quelleRebsorte?: string | null
}

export default function UmziehenWidget({ chargeId, chargeName, verfuegbarLiter, gebinde, alleChargen, action, initialOpen = false, quelleRebsorte = null }: Props) {
  const router  = useRouter()
  const [open,  setOpen]  = useState(initialOpen)
  useEffect(() => { setOpen(initialOpen) }, [initialOpen])
  const [brutto, setBrutto] = useState('')
  const [netto,  setNetto]  = useState('')
  const [zielId, setZielId] = useState('')
  const [datum,  setDatum]  = useState(new Date().toISOString().split('T')[0])
  const [notizen, setNotizen] = useState('')
  const [error,  setError]  = useState<string | null>(null)
  const [pending, start]    = useTransition()

  // Freie Kapazität pro Gebinde
  const inhalt: Record<string, number> = {}
  for (const c of alleChargen) {
    if (c.behaelter_id) inhalt[c.behaelter_id] = (inhalt[c.behaelter_id] ?? 0) + (parseFloat(String(c.menge_liter)) || 0)
  }
  const frei = (g: Gebinde) =>
    g.volumen_liter != null ? Math.max(0, g.volumen_liter - (inhalt[g.id] ?? 0)) : null

  // Rebsortenmix: gibt es im Ziel-Gebinde Chargen mit anderer Rebsorte?
  const andereRebsorten = zielId && quelleRebsorte
    ? [...new Set(
        alleChargen
          .filter(c => c.behaelter_id === zielId && c.rebsorte && c.rebsorte !== quelleRebsorte)
          .map(c => c.rebsorte as string)
      )]
    : []
  const hatRebsortenmix = andereRebsorten.length > 0

  const bruttoVal = parseFloat(brutto.replace(',', '.')) || 0
  const nettoVal  = parseFloat(netto.replace(',', '.'))  || 0
  const schwund   = bruttoVal - nettoVal

  const selectedGebinde = gebinde.find(g => g.id === zielId)
  const restKapGebinde   = selectedGebinde ? frei(selectedGebinde) : null
  const canSubmit = bruttoVal > 0 && nettoVal > 0
    && nettoVal <= bruttoVal + 0.01
    && bruttoVal <= verfuegbarLiter + 0.01
    && (restKapGebinde == null || nettoVal <= restKapGebinde + 0.01)
    && !!zielId

  function handleClose() {
    setOpen(false)
    router.push(`/kellerbuch/weinausbau/${chargeId}`)
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    const fd = new FormData()
    fd.set('quellen_json', JSON.stringify([{ weinausbau_id: chargeId, menge: bruttoVal }]))
    fd.set('ziele_json',   JSON.stringify([{ behaelter_id: zielId, menge: nettoVal }]))
    fd.set('datum',   datum)
    fd.set('notizen', notizen)
    start(async () => {
      try {
        await action(fd)
        setBrutto(''); setNetto(''); setZielId(''); setNotizen('')
        if (hatRebsortenmix) {
          router.push(`/kellerbuch/weinausbau/${chargeId}?form=verschneiden`)
        } else {
          router.push(`/kellerbuch/weinausbau/${chargeId}`)
        }
        router.refresh()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Fehler beim Umziehen')
      }
    })
  }

  if (!open) return null

  return (
    <section>
      <h2 className="font-semibold text-gray-800 mb-3">Umziehen</h2>
      <div className="card space-y-4">
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-2.5 text-sm">{error}</div>
        )}
        <form onSubmit={handleSubmit} className="space-y-4">

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="form-label">Datum *</label>
              <input type="date" value={datum} onChange={e => setDatum(e.target.value)} className="form-input" required />
            </div>
            <div>
              <label className="form-label">Notizen</label>
              <input type="text" value={notizen} onChange={e => setNotizen(e.target.value)}
                placeholder="z.B. Abstich nach Gärung …" className="form-input" />
            </div>
          </div>

          {/* Quelle – gesperrt */}
          <div>
            <label className="form-label">Quelle (diese Partie)</label>
            <div className="form-input bg-gray-50 text-gray-500 cursor-not-allowed select-none">{chargeName}</div>
            <p className="text-xs text-s112-muted mt-1">
              Verfügbar: <span className="text-s112-teal font-medium">
                {verfuegbarLiter.toLocaleString('de-AT', { maximumFractionDigits: 2 })} L
              </span>
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="form-label">Brutto (Liter) *</label>
              <input type="text" inputMode="decimal" value={brutto}
                onChange={e => setBrutto(e.target.value)} placeholder="z.B. 1.200" className="form-input" />
              {bruttoVal > verfuegbarLiter + 0.01 && (
                <p className="text-xs text-red-600 mt-1">Überschreitet verfügbaren Bestand</p>
              )}
            </div>
            <div>
              <label className="form-label">Netto (Liter) *</label>
              <input type="text" inputMode="decimal" value={netto}
                onChange={e => setNetto(e.target.value)} placeholder="z.B. 1.190" className="form-input" />
              {nettoVal > bruttoVal + 0.01 && (
                <p className="text-xs text-red-600 mt-1">Netto &gt; Brutto nicht erlaubt</p>
              )}
            </div>
          </div>

          {/* Schwund-Vorschau */}
          {bruttoVal > 0 && nettoVal > 0 && nettoVal <= bruttoVal + 0.01 && (
            <div className="bg-s112-bg border border-s112-border rounded-lg px-4 py-2 text-sm flex justify-between">
              <span className="text-s112-muted">Schwund:</span>
              <span className="font-medium tabular-nums">
                {schwund.toLocaleString('de-AT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} L
              </span>
            </div>
          )}

          {/* Ziel-Gebinde */}
          <div>
            <label className="form-label">Ziel-Gebinde *</label>
            <select value={zielId} onChange={e => setZielId(e.target.value)} className="form-input">
              <option value="">– Gebinde wählen –</option>
              {gebinde.map(g => {
                const inh = inhalt[g.id] ?? 0
                const f   = frei(g)
                const kap = g.volumen_liter
                const fmt = (n: number) => n.toLocaleString('de-AT', { maximumFractionDigits: 0 })
                const info = kap != null
                  ? ` · ${fmt(kap)} L Kap · ${fmt(inh)} L Inh · ${fmt(f ?? 0)} L frei`
                  : inh > 0 ? ` · ${fmt(inh)} L Inh` : ''
                return (
                  <option key={g.id} value={g.id}>{g.name}{info}</option>
                )
              })}
            </select>
            {zielId && (() => {
              const g = gebinde.find(g => g.id === zielId)
              if (!g) return null
              const inhaltJetzt = inhalt[g.id] ?? 0
              const restJetzt   = frei(g)
              const restNach    = restJetzt != null ? restJetzt - nettoVal : null
              const ueber       = restJetzt != null && nettoVal > restJetzt + 0.01
              return (
                <div className="mt-2 grid grid-cols-3 gap-2 bg-s112-bg border border-s112-border rounded-lg px-4 py-2.5 text-xs">
                  <div>
                    <p className="text-s112-muted mb-0.5">Kapazität</p>
                    <p className="font-medium tabular-nums">{g.volumen_liter != null ? g.volumen_liter.toLocaleString('de-AT') + ' L' : '–'}</p>
                  </div>
                  <div>
                    <p className="text-s112-muted mb-0.5">Inhalt jetzt</p>
                    <p className="font-medium tabular-nums">{inhaltJetzt.toLocaleString('de-AT', { maximumFractionDigits: 1 })} L</p>
                  </div>
                  <div>
                    <p className="text-s112-muted mb-0.5">{nettoVal > 0 ? 'Rest nach Umzug' : 'Restkapazität'}</p>
                    <p className={`font-medium tabular-nums ${ueber ? 'text-red-600' : 'text-s112-teal'}`}>
                      {restJetzt != null ? (nettoVal > 0 ? restNach : restJetzt)!.toLocaleString('de-AT', { maximumFractionDigits: 1 }) + ' L' : '–'}
                    </p>
                  </div>
                </div>
              )
            })()}
            {(() => {
              const g = gebinde.find(g => g.id === zielId)
              const f = g ? frei(g) : null
              return f != null && nettoVal > f + 0.01 ? (
                <p className="text-xs text-red-600 mt-1">Netto überschreitet Restkapazität des Gebindes</p>
              ) : null
            })()}
            {hatRebsortenmix && (
              <div className="mt-2 bg-amber-50 border border-amber-300 rounded-lg px-3 py-2 text-xs text-amber-800">
                <span className="font-semibold">⚠ Rebsortenverschnitt:</span>{' '}
                Das Ziel-Gebinde enthält bereits Chargen mit Rebsorte <strong>{andereRebsorten.join(', ')}</strong>.
                Nach dem Umzug wird automatisch das Verschneiden-Formular geöffnet.
              </div>
            )}
          </div>

          <div className="flex items-center gap-3">
            <button type="submit" disabled={!canSubmit || pending}
              className="bg-s112-teal text-white px-5 py-2 rounded-xl text-sm font-semibold hover:bg-opacity-90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
              {pending ? 'Wird gebucht …' : 'Umzug buchen'}
            </button>
             <button type="button" onClick={handleClose}
              className="text-sm text-s112-muted hover:text-gray-700 transition-colors">
              Abbrechen
            </button>
          </div>
        </form>
      </div>
    </section>
  )
}
