'use client'

import { useState, useEffect } from 'react'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

interface Gebinde { id: string; name: string; aktiv: boolean }
interface Charge  { id: string; name: string; jahrgang: number | null; menge_liter: string | number; behaelter_id: string | null }
interface Ziel    { behaelter_id: string; menge_netto: number }

interface Props {
  gebinde: Gebinde[]
  chargen: Charge[]
  action: (fd: FormData) => Promise<void>
  inputCls: string
  labelCls: string
}

export default function UmziehenFormClient({ gebinde, chargen, action, inputCls, labelCls }: Props) {
  const [vonGebindeId, setVonGebindeId] = useState('')
  const [vonChargeId,  setVonChargeId]  = useState('')
  const [brutto,       setBrutto]       = useState<number | ''>('')
  const [ziele,        setZiele]        = useState<Ziel[]>([{ behaelter_id: '', menge_netto: 0 }])

  // Chargen im gewählten Quell-Gebinde
  const inhalt = chargen.filter(c => c.behaelter_id === vonGebindeId)

  // Wenn nur eine Charge im Quell-Gebinde → automatisch vorauswählen
  useEffect(() => {
    if (inhalt.length === 1) setVonChargeId(inhalt[0].id)
    else setVonChargeId('')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vonGebindeId])

  const bruttoNum  = typeof brutto === 'number' ? brutto : 0
  const sumNetto   = ziele.reduce((s, z) => s + (z.menge_netto || 0), 0)
  const schwund    = bruttoNum - sumNetto
  const ueberschuss = sumNetto > bruttoNum + 0.01

  // Ziel-Gebinde: ohne Quell-Gebinde
  const zielGebinde = gebinde.filter(g => g.aktiv && g.id !== vonGebindeId)

  const addZiel = () => setZiele(z => [...z, { behaelter_id: '', menge_netto: 0 }])
  const removeZiel = (i: number) => setZiele(z => z.filter((_, idx) => idx !== i))
  const updateZiel = (i: number, field: keyof Ziel, val: string | number) =>
    setZiele(z => z.map((item, idx) => idx === i ? { ...item, [field]: val } as Ziel : item))

  return (
    <form action={action} className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
      {/* Versteckte Felder: Charge-ID + Ziele-JSON */}
      <input type="hidden" name="von_weinausbau_id" value={vonChargeId} />
      <input type="hidden" name="ziele_json" value={JSON.stringify(ziele)} />

      {/* Datum */}
      <div>
        <label className={labelCls}>Datum *</label>
        <input name="datum" type="date" required
          defaultValue={new Date().toISOString().split('T')[0]}
          className={inputCls} />
      </div>

      {/* Quell-Gebinde */}
      <div>
        <label className={labelCls}>Quell-Gebinde *</label>
        <select
          name="von_behaelter_id"
          required
          value={vonGebindeId}
          onChange={e => { setVonGebindeId(e.target.value) }}
          className={inputCls}
        >
          <option value="">– bitte wählen –</option>
          {gebinde.filter(g => g.aktiv).map((g: Gebinde) => (
            <option key={g.id} value={g.id}>{g.name}</option>
          ))}
        </select>
      </div>

      {/* Inhalt des Quell-Gebindes */}
      {vonGebindeId && inhalt.length === 0 && (
        <div className="sm:col-span-2 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-700">
          ⚠ Kein aktiver Weinausbau in diesem Gebinde erfasst.
        </div>
      )}

      {vonGebindeId && inhalt.length === 1 && (
        <div className="sm:col-span-2 rounded-lg bg-s112-bg border border-s112-border px-4 py-2 text-sm">
          <span className="text-s112-muted">Inhalt: </span>
          <span className="font-medium text-gray-800">{inhalt[0].name}</span>
          {inhalt[0].jahrgang && <span className="text-gray-500"> · Jahrgang {inhalt[0].jahrgang}</span>}
          <span className="ml-2 text-s112-teal font-semibold">
            {parseFloat(String(inhalt[0].menge_liter)).toLocaleString('de-AT', { maximumFractionDigits: 2 })} L verfügbar
          </span>
        </div>
      )}

      {vonGebindeId && inhalt.length > 1 && (
        <div className="sm:col-span-2">
          <label className={labelCls}>Charge (von) *</label>
          <select
            required
            value={vonChargeId}
            onChange={e => setVonChargeId(e.target.value)}
            className={inputCls}
          >
            <option value="">– Charge wählen –</option>
            {inhalt.map((c: Charge) => (
              <option key={c.id} value={c.id}>
                {c.name}{c.jahrgang ? ` (${c.jahrgang})` : ''} ·{' '}
                {parseFloat(String(c.menge_liter)).toLocaleString('de-AT', { maximumFractionDigits: 2 })} L
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Brutto-Menge */}
      <div>
        <label className={labelCls}>Menge brutto (L) *</label>
        <input
          name="brutto_liter"
          type="number"
          step="0.01"
          min={0}
          required
          value={brutto}
          placeholder="z.B. 3 000"
          onChange={e => setBrutto(parseFloat(e.target.value) || '')}
          className={inputCls}
        />
      </div>

      {/* Schwund-Anzeige */}
      <div className="flex items-end">
        <div className={`w-full rounded-lg border px-4 py-2 text-sm ${ueberschuss ? 'bg-red-50 border-red-300' : 'bg-s112-bg border-s112-border'}`}>
          <span className="text-s112-muted">Schwund: </span>
          {bruttoNum > 0 ? (
            <span className={`font-semibold ${ueberschuss ? 'text-red-600' : 'text-gray-800'}`}>
              {ueberschuss
                ? `⚠ Netto übersteigt Brutto um ${(sumNetto - bruttoNum).toLocaleString('de-AT', { maximumFractionDigits: 2 })} L`
                : `${schwund.toLocaleString('de-AT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} L`}
            </span>
          ) : <span className="text-gray-400">–</span>}
        </div>
      </div>

      {/* Ziel-Zeilen (n Stück) */}
      <div className="sm:col-span-2 space-y-2">
        <div className="flex items-center justify-between">
          <label className={labelCls + ' mb-0'}>Ziel-Gebinde und Netto-Menge *</label>
          <button
            type="button"
            onClick={addZiel}
            className="text-xs font-medium text-s112-teal hover:underline"
          >
            + Ziel hinzufügen
          </button>
        </div>
        {ziele.map((z: Ziel, i: number) => (
          <div key={i} className="flex gap-2 items-center">
            <select
              value={z.behaelter_id}
              onChange={e => updateZiel(i, 'behaelter_id', e.target.value)}
              className={`${inputCls} flex-1`}
            >
              <option value="">– Gebinde –</option>
              {zielGebinde.map((g: Gebinde) => (
                <option key={g.id} value={g.id}>{g.name}</option>
              ))}
            </select>
            <input
              type="number"
              step="0.01"
              min={0}
              placeholder="Liter netto"
              value={z.menge_netto || ''}
              onChange={e => updateZiel(i, 'menge_netto', parseFloat(e.target.value) || 0)}
              className={`${inputCls} w-36`}
            />
            {ziele.length > 1 && (
              <button
                type="button"
                onClick={() => removeZiel(i)}
                className="text-red-400 hover:text-red-600 text-base leading-none"
                title="Zeile entfernen"
              >
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

      {/* Notizen */}
      <div className="sm:col-span-2">
        <label className={labelCls}>Notizen</label>
        <input name="notizen" placeholder="z.B. Abstich nach Gärung …" className={inputCls} />
      </div>

      <div className="sm:col-span-2">
        <button
          type="submit"
          disabled={ueberschuss || !vonChargeId || bruttoNum <= 0}
          className="bg-s112-teal text-white px-5 py-2 rounded-xl text-sm font-semibold hover:bg-opacity-90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Umzug buchen
        </button>
      </div>
    </form>
  )
}
