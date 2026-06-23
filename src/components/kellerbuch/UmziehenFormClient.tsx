'use client'

import { useState } from 'react'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

interface Quelle { weinausbau_id: string; brutto: number }
interface Ziel   { behaelter_id: string; menge_netto: number }

interface Props {
  gebinde: R[]
  chargen: R[]  // alle aktiven Chargen mit behaelter:behaelter_id(name) gejoint
  action: (fd: FormData) => Promise<void>
  inputCls: string
  labelCls: string
  defaultQuellen?: Quelle[]
  defaultZiele?: Ziel[]
  defaultDatum?: string
  defaultNotizen?: string
  submitLabel?: string
}

export default function UmziehenFormClient({
  gebinde, chargen, action, inputCls, labelCls,
  defaultQuellen, defaultZiele, defaultDatum, defaultNotizen, submitLabel,
}: Props) {
  const [quellen, setQuellen] = useState<Quelle[]>(
    defaultQuellen?.length ? defaultQuellen : [{ weinausbau_id: '', brutto: 0 }]
  )
  const [ziele, setZiele] = useState<Ziel[]>(
    defaultZiele?.length ? defaultZiele : [{ behaelter_id: '', menge_netto: 0 }]
  )

  const sumBrutto  = quellen.reduce((s, q) => s + (q.brutto || 0), 0)
  const sumNetto   = ziele.reduce((s, z) => s + (z.menge_netto || 0), 0)
  const schwund    = sumBrutto - sumNetto
  const ueberschuss = sumNetto > sumBrutto + 0.01

  const findCharge = (id: string) => chargen.find(c => c.id === id) ?? null

  // Aktuellen Inhalt pro Gebinde berechnen (für freie Kapazität)
  const inhaltByGebinde: Record<string, number> = {}
  for (const c of chargen) {
    if (c.behaelter_id) {
      inhaltByGebinde[c.behaelter_id] = (inhaltByGebinde[c.behaelter_id] ?? 0) + (parseFloat(String(c.menge_liter)) || 0)
    }
  }
  const freiLiter = (g: R): number | null => {
    if (!g.volumen_liter) return null
    return Math.max(0, parseFloat(String(g.volumen_liter)) - (inhaltByGebinde[g.id] ?? 0))
  }

  const addQuelle = () => setQuellen(q => [...q, { weinausbau_id: '', brutto: 0 }])
  const removeQuelle = (i: number) => setQuellen(q => q.filter((_, idx) => idx !== i))
  const updateQuelle = (i: number, field: keyof Quelle, val: string | number) =>
    setQuellen(q => q.map((item, idx) => idx === i ? { ...item, [field]: val } as Quelle : item))

  const addZiel = () => setZiele(z => [...z, { behaelter_id: '', menge_netto: 0 }])
  const removeZiel = (i: number) => setZiele(z => z.filter((_, idx) => idx !== i))
  const updateZiel = (i: number, field: keyof Ziel, val: string | number) =>
    setZiele(z => z.map((item, idx) => idx === i ? { ...item, [field]: val } as Ziel : item))

  const canSubmit = quellen.some(q => q.weinausbau_id && q.brutto > 0)
    && ziele.some(z => z.behaelter_id && z.menge_netto > 0)
    && !ueberschuss

  return (
    <form action={action} className="mt-4 space-y-6">
      <input type="hidden" name="quellen_json" value={JSON.stringify(quellen)} />
      <input type="hidden" name="ziele_json"   value={JSON.stringify(ziele)} />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className={labelCls}>Datum *</label>
          <input name="datum" type="date" required
            defaultValue={defaultDatum ?? new Date().toISOString().split('T')[0]}
            className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>Notizen</label>
          <input name="notizen" defaultValue={defaultNotizen ?? ''} placeholder="z.B. Abstich nach Gärung …" className={inputCls} />
        </div>
      </div>

      {/* QUELL-CHARGEN */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Quell-Chargen</span>
          <button type="button" onClick={addQuelle}
            className="text-xs font-medium text-s112-teal hover:underline">
            + Quelle hinzufügen
          </button>
        </div>
        <div className="space-y-2">
          {quellen.map((q, i) => {
            const charge = findCharge(q.weinausbau_id)
            const bh     = (charge?.behaelter as R | null)?.name
            const verf   = charge ? parseFloat(String(charge.menge_liter)) : null
            return (
              <div key={i} className="flex gap-2 items-start">
                <div className="flex-1 min-w-0">
                  <select
                    value={q.weinausbau_id}
                    onChange={e => updateQuelle(i, 'weinausbau_id', e.target.value)}
                    className={inputCls}
                  >
                    <option value="">– Charge wählen –</option>
                    {chargen.map((c: R) => {
                      const cbh = (c.behaelter as R | null)?.name
                      return (
                        <option key={c.id} value={c.id}>
                          {c.name}{c.jahrgang ? ` (${c.jahrgang})` : ''}{cbh ? ` · ${cbh}` : ''}
                        </option>
                      )
                    })}
                  </select>
                  {charge && (
                    <p className="text-xs text-s112-muted mt-0.5">
                      {bh ? `in: ${bh}` : 'kein Gebinde zugewiesen'} · verfügbar:{' '}
                      <span className="text-s112-teal font-medium">
                        {verf != null ? verf.toLocaleString('de-AT', { maximumFractionDigits: 2 }) : '?'} L
                      </span>
                    </p>
                  )}
                </div>
                <div className="w-36 shrink-0">
                  <input
                    type="number" step="0.01" min={0} placeholder="Brutto L"
                    value={q.brutto || ''}
                    onChange={e => updateQuelle(i, 'brutto', parseFloat(e.target.value) || 0)}
                    className={inputCls}
                  />
                </div>
                {quellen.length > 1 && (
                  <button type="button" onClick={() => removeQuelle(i)}
                    className="text-red-400 hover:text-red-600 text-sm mt-2.5 shrink-0" title="Zeile entfernen">
                    ✕
                  </button>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* ZIEL-GEBINDE */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Ziel-Gebinde</span>
          <button type="button" onClick={addZiel}
            className="text-xs font-medium text-s112-teal hover:underline">
            + Ziel hinzufügen
          </button>
        </div>
        <div className="space-y-2">
          {ziele.map((z: Ziel, i: number) => (
            <div key={i} className="flex gap-2 items-center">
              <select
                value={z.behaelter_id}
                onChange={e => updateZiel(i, 'behaelter_id', e.target.value)}
                className={`${inputCls} flex-1`}
              >
                <option value="">– Gebinde –</option>
                {gebinde.filter((g: R) => g.aktiv).map((g: R) => {
                  const frei = freiLiter(g)
                  const freiText = frei != null
                    ? ` (frei: ${frei.toLocaleString('de-AT', { maximumFractionDigits: 0 })} L)`
                    : ''
                  return (
                    <option key={g.id} value={g.id}>{g.name}{freiText}</option>
                  )
                })}
              </select>
              <input
                type="number" step="0.01" min={0} placeholder="Netto L"
                value={z.menge_netto || ''}
                onChange={e => updateZiel(i, 'menge_netto', parseFloat(e.target.value) || 0)}
                className={`${inputCls} w-36`}
              />
              {ziele.length > 1 && (
                <button type="button" onClick={() => removeZiel(i)}
                  className="text-red-400 hover:text-red-600 text-sm shrink-0" title="Zeile entfernen">
                  ✕
                </button>
              )}
            </div>
          ))}
          {ueberschuss && (
            <p className="text-xs text-red-600">
              Summe Netto ({sumNetto.toLocaleString('de-AT', { maximumFractionDigits: 2 })} L) überschreitet Brutto – bitte korrigieren.
            </p>
          )}
        </div>
      </div>

      {/* SCHWUND-BOX */}
      {sumBrutto > 0 && (
        <div className={`rounded-lg border px-4 py-2.5 text-sm ${ueberschuss ? 'bg-red-50 border-red-300' : 'bg-s112-bg border-s112-border'}`}>
          <div className="flex justify-between">
            <span className="text-s112-muted">Gesamt brutto:</span>
            <span className="font-medium tabular-nums">{sumBrutto.toLocaleString('de-AT', { maximumFractionDigits: 2 })} L</span>
          </div>
          <div className="flex justify-between">
            <span className="text-s112-muted">Gesamt netto:</span>
            <span className="font-medium tabular-nums">{sumNetto.toLocaleString('de-AT', { maximumFractionDigits: 2 })} L</span>
          </div>
          <div className="flex justify-between border-t border-s112-border/50 pt-1.5 mt-1.5">
            <span className={ueberschuss ? 'text-red-600 font-semibold' : 'text-s112-muted'}>Schwund:</span>
            <span className={`font-semibold tabular-nums ${ueberschuss ? 'text-red-600' : 'text-gray-800'}`}>
              {ueberschuss
                ? '⚠ Netto > Brutto'
                : `${schwund.toLocaleString('de-AT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} L`}
            </span>
          </div>
        </div>
      )}

      <button type="submit" disabled={!canSubmit}
        className="bg-s112-teal text-white px-5 py-2 rounded-xl text-sm font-semibold hover:bg-opacity-90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
        {submitLabel ?? 'Umzug buchen'}
      </button>
    </form>
  )
}
