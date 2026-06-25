'use client'

import { useState, useTransition, useEffect, useRef } from 'react'
import Link from 'next/link'
import { createZukauf } from '../actions'

interface Kontakt  { id: string; vorname: string | null; nachname: string }
interface Firma    { id: string; name: string }
interface Behaelter { id: string; name: string; typ: string }
const TYP_ICONS: Record<string, string> = { tank: '🛢', fass: '🪵', amphore: '🏺', sonstiges: '📦' }

interface SucheItem { id: string; label: string; sub?: string }

const inputCls = 'border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40 bg-white'
const labelCls = 'block text-xs font-medium text-gray-600 mb-1'

const DEFAULT_EINHEIT: Record<string, string> = {
  wein: 'L', trauben: 'kg', most: 'L',
}

function KundenSuche({ items, value, onChange, placeholder, disabled }: {
  items: SucheItem[]
  value: string
  onChange: (id: string) => void
  placeholder: string
  disabled?: boolean
}) {
  const [query, setQuery] = useState('')
  const [open, setOpen]   = useState(false)
  const ref               = useRef<HTMLDivElement>(null)
  const selected          = items.find(i => i.id === value)

  const treffer = query.length < 1
    ? items.slice(0, 50)
    : items.filter(i => (i.label + ' ' + (i.sub ?? '')).toLowerCase().includes(query.toLowerCase())).slice(0, 50)

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  if (selected) {
    return (
      <div className="flex items-center gap-2 border border-s112-border rounded-lg px-3 py-2 bg-white text-sm">
        <span className="flex-1 truncate font-medium text-gray-800">{selected.label}</span>
        {!disabled && (
          <button type="button" onClick={() => { onChange(''); setQuery('') }}
            className="text-s112-muted hover:text-red-500 ml-1 flex-shrink-0 text-base leading-none">×</button>
        )}
      </div>
    )
  }

  return (
    <div ref={ref} className="relative">
      <input type="text" value={query}
        onChange={e => { setQuery(e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
        placeholder={placeholder}
        disabled={disabled}
        className={inputCls + ' w-full pr-8'}
        autoComplete="off"
      />
      <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-s112-muted text-xs pointer-events-none">▾</span>
      {open && treffer.length > 0 && (
        <div className="absolute z-30 left-0 right-0 mt-1 bg-white border border-s112-border rounded-xl shadow-lg max-h-60 overflow-y-auto">
          {treffer.map(item => (
            <button key={item.id} type="button"
              onMouseDown={() => { onChange(item.id); setQuery(''); setOpen(false) }}
              className="w-full text-left px-3 py-2 text-sm hover:bg-s112-teal/10 flex items-center justify-between gap-2">
              <span className="font-medium text-gray-800 truncate">{item.label}</span>
              {item.sub && <span className="text-xs text-s112-muted flex-shrink-0">{item.sub}</span>}
            </button>
          ))}
        </div>
      )}
      {open && query.length > 0 && treffer.length === 0 && (
        <div className="absolute z-30 left-0 right-0 mt-1 bg-white border border-s112-border rounded-xl shadow-lg px-3 py-2 text-sm text-s112-muted">
          Kein Eintrag gefunden
        </div>
      )}
    </div>
  )
}

export default function ZukaufNeuPage() {
  const [isPending, startTransition] = useTransition()
  const [error, setError]            = useState<string | null>(null)

  const [kontakte,    setKontakte]    = useState<Kontakt[]>([])
  const [firmen,      setFirmen]      = useState<Firma[]>([])
  const [behaelter,   setBehaelter]   = useState<Behaelter[]>([])
  const [weinausbauListe, setWeinausbauListe] = useState<{ id: string; name: string; behaelter_id: string | null; rebsorte: string | null }[]>([])
  const [loading,     setLoading]     = useState(true)

  // Formular
  const [datum,             setDatum]            = useState(new Date().toISOString().split('T')[0])
  const [art,               setArt]              = useState<'wein' | 'trauben' | 'most'>('trauben')
  const [lieferantKontakt,  setLieferantKontakt] = useState('')
  const [lieferantFirma,    setLieferantFirma]   = useState('')
  const [menge,             setMenge]            = useState('')
  const [einheit,           setEinheit]          = useState('kg')
  const [preisGesamt,       setPreisGesamt]      = useState('')
  const [rebsorte,          setRebsorte]         = useState('')
  const [jahrgang,          setJahrgang]         = useState('')
  const [zielBehaelter,        setZielBehaelter]       = useState('')
  const [einstandspreisLiter,  setEinstandspreisLiter] = useState('')
  const [notizen,              setNotizen]             = useState('')

  // Rebsortenmix: bestehende Chargen im Ziel-Behälter mit anderer Rebsorte?
  const andereChargenImZiel = zielBehaelter && rebsorte
    ? weinausbauListe.filter(
        w => w.behaelter_id === zielBehaelter && w.rebsorte && w.rebsorte !== rebsorte
      )
    : []
  const hatRebsortenmixZukauf = andereChargenImZiel.length > 0

  // Wenn Art wechselt → Einheit anpassen
  function handleArtChange(a: 'wein' | 'trauben' | 'most') {
    setArt(a)
    setEinheit(DEFAULT_EINHEIT[a] ?? 'kg')
    if (a === 'trauben') setZielBehaelter('')
  }

  useEffect(() => {
    async function load() {
      try {
        const [r1, r2] = await Promise.all([
          fetch('/api/verkauf-stammdaten'),
          fetch('/api/zukauf-stammdaten'),
        ])
        if (r1.ok) {
          const j1 = await r1.json()
          setKontakte(j1.kontakte ?? [])
          setFirmen(j1.firmen ?? [])
        }
        if (r2.ok) {
          const j2 = await r2.json()
          setBehaelter(j2.behaelter ?? [])
          setWeinausbauListe(j2.weinausbau ?? [])
        }
      } catch {
        // ignore
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  // Preis/Einheit auto
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
    fd.set('lieferant_kontakt_id', lieferantKontakt)
    fd.set('lieferant_firma_id',   lieferantFirma)
    fd.set('menge',                menge)
    fd.set('einheit',              einheit)
    fd.set('preis_gesamt',         preisGesamt)
    fd.set('rebsorte',             rebsorte)
    fd.set('jahrgang',             jahrgang)
    fd.set('ziel_behaelter_id',       zielBehaelter)
    fd.set('einstandspreis_pro_liter', einstandspreisLiter)
    fd.set('notizen',                 notizen)

    startTransition(async () => {
      try {
        await createZukauf(fd)
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
        <span className="text-gray-800 font-medium">Neuer Zukauf</span>
      </nav>

      <h1 className="text-xl font-bold text-gray-900">Neuer Zukauf</h1>

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
                      onChange={() => handleArtChange(a)}
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

        {/* Lieferant */}
        <div className="card p-5 space-y-4">
          <h2 className="font-semibold text-gray-700 text-sm">Lieferant</h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>Kontakt (Person)</label>
              <KundenSuche
                items={kontakte.map(k => ({
                  id: k.id,
                  label: [k.vorname, k.nachname].filter(Boolean).join(' '),
                }))}
                value={lieferantKontakt}
                onChange={id => { setLieferantKontakt(id); if (id) setLieferantFirma('') }}
                placeholder="Name suchen…"
                disabled={loading}
              />
            </div>
            <div>
              <label className={labelCls}>Firma</label>
              <KundenSuche
                items={firmen.map(f => ({ id: f.id, label: f.name }))}
                value={lieferantFirma}
                onChange={id => { setLieferantFirma(id); if (id) setLieferantKontakt('') }}
                placeholder="Firmenname suchen…"
                disabled={loading}
              />
            </div>
          </div>
          <p className="text-xs text-s112-muted">Lieferant ist optional – kann auch leer bleiben.</p>
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
            {(art === 'wein' || art === 'most') && (
              <div>
                <label className={labelCls}>Einstandspreis / L (€)</label>
                <input type="number" value={einstandspreisLiter} onChange={e => setEinstandspreisLiter(e.target.value)}
                  step="0.0001" min="0" placeholder="0.0000"
                  className={inputCls + ' w-full'} />
              </div>
            )}
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
                className={inputCls + ' w-full'} disabled={loading}>
                <option value="">– keines –</option>
                {behaelter.map(b => (
                  <option key={b.id} value={b.id}>
                    {TYP_ICONS[b.typ] ?? '📦'} {b.name}
                  </option>
                ))}
              </select>
            </div>
            {hatRebsortenmixZukauf && (
              <div className="bg-amber-50 border border-amber-300 rounded-lg px-3 py-2.5 text-sm text-amber-800">
                <span className="font-semibold">⚠ Rebsortenverschnitt:</span>{' '}
                Das gewählte Gebinde enthält bereits Chargen mit anderer Rebsorte:{' '}
                <strong>{andereChargenImZiel.map(c => `${c.name} (${c.rebsorte})`).join(', ')}</strong>.
                Nach dem Speichern wird das Verschneiden-Formular geöffnet.
              </div>
            )}
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
            {isPending ? 'Speichern…' : '✓ Zukauf speichern'}
          </button>
        </div>
      </form>
    </div>
  )
}
