'use client'

import { useState, useTransition, useEffect } from 'react'
import Link from 'next/link'
import { updateZukauf } from '../../actions'

interface Behaelter { id: string; name: string; typ: string }

interface InitialValues {
  datum:                string
  art:                  string
  lieferant_kontakt_id: string
  lieferant_firma_id:   string
  menge:                string
  einheit:              string
  preis_gesamt:         string
  rebsorte:             string
  jahrgang:             string
  ziel_behaelter_id:    string
  notizen:              string
}

const TYP_ICONS: Record<string, string> = { tank: '🛢', fass: '🪵', amphore: '🏺', sonstiges: '📦' }
const inputCls = 'border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40 bg-white'
const labelCls = 'block text-xs font-medium text-gray-600 mb-1'

export default function ZukaufEditForm({
  id,
  initial,
  lieferantName,
}: {
  id: string
  initial: InitialValues
  lieferantName: string
}) {
  const [isPending, startTransition] = useTransition()
  const [error, setError]            = useState<string | null>(null)
  const [behaelter, setBehaelter]    = useState<Behaelter[]>([])

  const [datum,           setDatum]          = useState(initial.datum)
  const [art,             setArt]            = useState<'wein' | 'trauben' | 'most'>(initial.art as any)
  const [menge,           setMenge]          = useState(initial.menge)
  const [einheit,         setEinheit]        = useState(initial.einheit)
  const [preisGesamt,     setPreisGesamt]    = useState(initial.preis_gesamt)
  const [rebsorte,        setRebsorte]       = useState(initial.rebsorte)
  const [jahrgang,        setJahrgang]       = useState(initial.jahrgang)
  const [zielBehaelter,   setZielBehaelter]  = useState(initial.ziel_behaelter_id)
  const [notizen,         setNotizen]        = useState(initial.notizen)

  useEffect(() => {
    fetch('/api/zukauf-stammdaten').then(r => r.json()).then(j => {
      setBehaelter(j.behaelter ?? [])
    }).catch(() => {})
  }, [])

  const preisProEinheit =
    menge && preisGesamt && parseFloat(menge) > 0
      ? (parseFloat(preisGesamt) / parseFloat(menge)).toFixed(4)
      : null

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!menge || parseFloat(menge) <= 0) {
      setError('Menge muss größer als 0 sein.')
      return
    }
    const fd = new FormData()
    fd.set('datum',                datum)
    fd.set('art',                  art)
    fd.set('lieferant_kontakt_id', initial.lieferant_kontakt_id)
    fd.set('lieferant_firma_id',   initial.lieferant_firma_id)
    fd.set('menge',                menge)
    fd.set('einheit',              einheit)
    fd.set('preis_gesamt',         preisGesamt)
    fd.set('rebsorte',             rebsorte)
    fd.set('jahrgang',             jahrgang)
    fd.set('ziel_behaelter_id',    zielBehaelter)
    fd.set('notizen',              notizen)

    startTransition(async () => {
      try {
        await updateZukauf(id, fd)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Fehler beim Speichern')
      }
    })
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <nav className="flex items-center gap-2 text-sm text-s112-muted">
        <Link href="/weinhandel/zukauf" className="hover:text-s112-teal">Zukäufe</Link>
        <span>/</span>
        <span className="text-gray-800 font-medium">Bearbeiten</span>
      </nav>

      <h1 className="text-xl font-bold text-gray-900">Zukauf bearbeiten</h1>

      {lieferantName && (
        <p className="text-sm text-s112-muted">
          Lieferant: <span className="font-medium text-gray-700">{lieferantName}</span>
          <span className="ml-2 text-xs">(Lieferant-Zuordnung nur beim Neuanlegen änderbar)</span>
        </p>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">{error}</div>
      )}

      <form onSubmit={handleSubmit} className="space-y-5">

        {/* Art + Datum */}
        <div className="card p-5 space-y-4">
          <h2 className="font-semibold text-gray-700 text-sm">Grunddaten</h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>Datum *</label>
              <input type="date" value={datum} onChange={e => setDatum(e.target.value)}
                required className={inputCls + ' w-full'} />
            </div>
            <div>
              <label className={labelCls}>Art *</label>
              <div className="flex gap-3 mt-1.5">
                {(['wein', 'trauben', 'most'] as const).map(a => (
                  <label key={a} className="flex items-center gap-1.5 cursor-pointer">
                    <input type="radio" name="art" value={a} checked={art === a}
                      onChange={() => setArt(a)}
                      className="accent-s112-teal" />
                    <span className="text-sm text-gray-700">
                      {a === 'wein' ? '🍷 Wein' : a === 'trauben' ? '🍇 Trauben' : '🌊 Most'}
                    </span>
                  </label>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Menge, Preis, Rebsorte */}
        <div className="card p-5 space-y-4">
          <h2 className="font-semibold text-gray-700 text-sm">Menge & Preis</h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div>
              <label className={labelCls}>Menge *</label>
              <input type="number" value={menge} onChange={e => setMenge(e.target.value)}
                required min="0.001" step="0.001" placeholder="0"
                className={inputCls + ' w-full'} />
            </div>
            <div>
              <label className={labelCls}>Einheit</label>
              <select value={einheit} onChange={e => setEinheit(e.target.value)}
                className={inputCls + ' w-full'}>
                <option value="kg">kg</option>
                <option value="L">L</option>
                <option value="t">t</option>
                <option value="Stk">Stk</option>
              </select>
            </div>
            <div>
              <label className={labelCls}>Gesamtpreis (€)</label>
              <input type="number" value={preisGesamt} onChange={e => setPreisGesamt(e.target.value)}
                step="0.01" min="0" placeholder="0.00"
                className={inputCls + ' w-full'} />
            </div>
            <div>
              <label className={labelCls}>Preis / {einheit}</label>
              <div className={inputCls + ' w-full bg-s112-bg text-s112-muted cursor-not-allowed text-right tabular-nums'}>
                {preisProEinheit != null
                  ? `€ ${Number(preisProEinheit).toLocaleString('de-AT', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`
                  : '–'}
              </div>
            </div>
            <div>
              <label className={labelCls}>Rebsorte</label>
              <input type="text" value={rebsorte} onChange={e => setRebsorte(e.target.value)}
                placeholder="z.B. Grüner Veltliner"
                className={inputCls + ' w-full'} />
            </div>
            <div>
              <label className={labelCls}>Jahrgang</label>
              <input type="number" value={jahrgang} onChange={e => setJahrgang(e.target.value)}
                min="1900" max="2100" placeholder="z.B. 2024"
                className={inputCls + ' w-full'} />
            </div>
          </div>
        </div>

        {/* Gebinde-Zuweisung (nur Wein / Most) */}
        {(art === 'wein' || art === 'most') && (
          <div className="card p-5 space-y-3">
            <h2 className="font-semibold text-gray-700 text-sm">In Gebinde füllen</h2>
            <div>
              <label className={labelCls}>Gebinde (optional)</label>
              <select value={zielBehaelter} onChange={e => setZielBehaelter(e.target.value)}
                className={inputCls + ' w-full'}>
                <option value="">– keines –</option>
                {behaelter.map(b => (
                  <option key={b.id} value={b.id}>
                    {TYP_ICONS[b.typ] ?? '📦'} {b.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}

        {/* Notizen */}
        <div className="card p-5">
          <label className={labelCls}>Notizen</label>
          <textarea value={notizen} onChange={e => setNotizen(e.target.value)}
            rows={3} placeholder="Qualitätsmerkmale, Bedingungen, sonstige Anmerkungen…"
            className={inputCls + ' w-full resize-none'} />
        </div>

        {/* Submit */}
        <div className="flex justify-end gap-3">
          <Link href="/weinhandel/zukauf"
            className="text-sm text-s112-muted hover:text-gray-700 px-4 py-2">
            Abbrechen
          </Link>
          <button type="submit" disabled={isPending}
            className="bg-s112-teal text-white px-6 py-2 rounded-xl text-sm font-semibold hover:bg-opacity-90 transition-colors disabled:opacity-50">
            {isPending ? 'Speichern…' : '✓ Änderungen speichern'}
          </button>
        </div>
      </form>
    </div>
  )
}
