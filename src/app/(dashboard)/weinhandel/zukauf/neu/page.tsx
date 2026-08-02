'use client'

import { useState, useTransition, useEffect, useRef } from 'react'
import Link from 'next/link'
import { createZukauf } from '../actions'
import { QUALITAET_LABEL, QUALITAET_ORDER } from '@/lib/weinqualitaet'
import { AlertTriangle } from 'lucide-react'

interface Kontakt  { id: string; vorname: string | null; nachname: string }
interface Firma    { id: string; name: string }
interface Behaelter { id: string; name: string; typ: string; volumen_liter: number | null }

interface SucheItem { id: string; label: string; sub?: string }

const inputCls = 'border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40 bg-white'
const labelCls = 'block text-xs font-medium text-gray-600 mb-1'

const DEFAULT_EINHEIT: Record<string, string> = {
  wein: 'L', trauben: 'kg', most: 'L',
}

// Qualitätsstufen die beim Zukauf relevant sind
const ZUKAUF_QUALITAETEN = [
  'landwein', 'qualitaetswein', 'kabinett', 'spaetlese', 'auslese',
  'beerenauslese', 'ausbruch', 'trockenbeerenauslese', 'eiswein', 'strohwein',
  'dac', 'reserve',
] as const

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

  const [kontakte,        setKontakte]        = useState<Kontakt[]>([])
  const [firmen,          setFirmen]          = useState<Firma[]>([])
  const [behaelter,       setBehaelter]       = useState<Behaelter[]>([])
  const [weinausbauListe, setWeinausbauListe] = useState<{ id: string; name: string; behaelter_id: string | null; rebsorte: string | null; menge_liter: number | null }[]>([])
  const [loading,         setLoading]         = useState(true)

  // ── Grunddaten ────────────────────────────────────────────────────────────
  const [datum,           setDatum]           = useState(new Date().toISOString().split('T')[0])
  const [uhrzeit,         setUhrzeit]         = useState('')
  const [art,             setArt]             = useState<'wein' | 'trauben' | 'most'>('wein')

  // ── Lieferant / Versender ─────────────────────────────────────────────────
  const [lieferantKontakt, setLieferantKontakt] = useState('')
  const [lieferantFirma,   setLieferantFirma]   = useState('')

  // ── Transportmittel ───────────────────────────────────────────────────────
  const [zugmaschine,  setZugmaschine]  = useState('')
  const [anhaenger1,   setAnhaenger1]   = useState('')
  const [anhaenger2,   setAnhaenger2]   = useState('')

  // ── Ware ──────────────────────────────────────────────────────────────────
  const [weinart,       setWeinart]       = useState<'weiss' | 'rot' | 'rose' | 'unbekannt'>('unbekannt')
  const [rebsorte,      setRebsorte]      = useState('')
  const [qualitaet,     setQualitaet]     = useState('')
  const [jahrgang,      setJahrgang]      = useState('')
  const [herkunft,      setHerkunft]      = useState('')
  const [anreicherung,  setAnreicherung]  = useState(false)
  const [kmw,           setKmw]           = useState('')
  const [alkohol,       setAlkohol]       = useState('')
  const [pruefnummer,   setPruefnummer]   = useState('')

  // ── Menge & Preis ─────────────────────────────────────────────────────────
  const [menge,               setMenge]               = useState('')
  const [einheit,             setEinheit]             = useState('L')
  const [preisGesamt,         setPreisGesamt]         = useState('')
  const [einstandspreisLiter, setEinstandspreisLiter] = useState('')

  // ── Gebinde ───────────────────────────────────────────────────────────────
  const [zielBehaelter, setZielBehaelter] = useState('')

  // ── Notizen ───────────────────────────────────────────────────────────────
  const [notizen, setNotizen] = useState('')

  // Rebsortenmix-Warnung
  const andereChargenImZiel = zielBehaelter && rebsorte
    ? weinausbauListe.filter(w => w.behaelter_id === zielBehaelter && w.rebsorte && w.rebsorte !== rebsorte)
    : []
  const hatRebsortenmixZukauf = andereChargenImZiel.length > 0

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
        if (r1.ok) { const j1 = await r1.json(); setKontakte(j1.kontakte ?? []); setFirmen(j1.firmen ?? []) }
        if (r2.ok) { const j2 = await r2.json(); setBehaelter(j2.behaelter ?? []); setWeinausbauListe(j2.weinausbau ?? []) }
      } catch { /* ignore */ } finally { setLoading(false) }
    }
    load()
  }, [])

  const preisProEinheit = menge && preisGesamt && parseFloat(menge) > 0
    ? (parseFloat(preisGesamt) / parseFloat(menge)).toFixed(4)
    : null

  useEffect(() => {
    if (einheit === 'L' && preisProEinheit) setEinstandspreisLiter(preisProEinheit)
  }, [preisProEinheit, einheit])

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!menge || parseFloat(menge) <= 0) { setError('Menge muss größer als 0 sein.'); return }
    const fd = new FormData()
    fd.set('datum',                   datum)
    fd.set('lieferung_uhrzeit',       uhrzeit)
    fd.set('art',                     art)
    fd.set('lieferant_kontakt_id',    lieferantKontakt)
    fd.set('lieferant_firma_id',      lieferantFirma)
    fd.set('transport_zugmaschine',   zugmaschine)
    fd.set('transport_anhaenger1',    anhaenger1)
    fd.set('transport_anhaenger2',    anhaenger2)
    fd.set('weinart',                 weinart)
    fd.set('rebsorte',                rebsorte)
    fd.set('qualitaetsstufe',         qualitaet)
    fd.set('jahrgang',                jahrgang)
    fd.set('herkunft',                herkunft)
    fd.set('anreicherung',            anreicherung ? 'true' : 'false')
    fd.set('kmw',                     kmw)
    fd.set('alkohol_pct',             alkohol)
    fd.set('staatliche_pruefnummer',  pruefnummer)
    fd.set('menge',                   menge)
    fd.set('einheit',                 einheit)
    fd.set('preis_gesamt',            preisGesamt)
    fd.set('einstandspreis_pro_liter', einstandspreisLiter)
    fd.set('ziel_behaelter_id',       zielBehaelter)
    fd.set('notizen',                 notizen)
    startTransition(async () => {
      try { await createZukauf(fd) }
      catch (err) { setError(err instanceof Error ? err.message : 'Fehler beim Speichern') }
    })
  }

  const ART_OPTIONS: { value: 'wein' | 'most' | 'trauben'; label: string }[] = [
    { value: 'wein',    label: 'Wein' },
    { value: 'most',    label: 'Traubenmost' },
    { value: 'trauben', label: 'Trauben' },
  ]

  return (
    <div className="space-y-6 max-w-2xl">
      <nav className="flex items-center gap-2 text-sm text-s112-muted">
        <Link href="/weinhandel/zukauf" className="hover:text-s112-teal">Zukäufe</Link>
        <span>/</span>
        <span className="text-gray-800 font-medium">Neuer Zukauf</span>
      </nav>

      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-900">Neuer Zukauf</h1>
        <span className="text-xs text-s112-muted bg-s112-bg border border-s112-border rounded-full px-3 py-1">
          Transportbescheinigung gem. Weingesetz
        </span>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">{error}</div>
      )}

      <form onSubmit={handleSubmit} className="space-y-5">

        {/* ── 1. Lieferung ──────────────────────────────────────────────── */}
        <div className="card p-5 space-y-4">
          <h2 className="font-semibold text-gray-700 text-sm uppercase tracking-wide">Lieferung</h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>Datum *</label>
              <input type="date" value={datum} onChange={e => setDatum(e.target.value)}
                required className={inputCls + ' w-full'} />
            </div>
            <div>
              <label className={labelCls}>Uhrzeit</label>
              <input type="time" value={uhrzeit} onChange={e => setUhrzeit(e.target.value)}
                className={inputCls + ' w-full'} />
            </div>
          </div>
          <div>
            <label className={labelCls}>Art *</label>
            <div className="flex gap-4 mt-1.5">
              {ART_OPTIONS.map(({ value, label }) => (
                <label key={value} className="flex items-center gap-1.5 cursor-pointer">
                  <input type="radio" name="art" value={value} checked={art === value}
                    onChange={() => handleArtChange(value)} className="accent-s112-teal" />
                  <span className="text-sm text-gray-700">{label}</span>
                </label>
              ))}
            </div>
          </div>
        </div>

        {/* ── 2. Versender / Lieferant ──────────────────────────────────── */}
        <div className="card p-5 space-y-4">
          <h2 className="font-semibold text-gray-700 text-sm uppercase tracking-wide">Versender / Lieferant</h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>Kontakt (Person)</label>
              <KundenSuche
                items={kontakte.map(k => ({ id: k.id, label: [k.vorname, k.nachname].filter(Boolean).join(' ') }))}
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
        </div>

        {/* ── 3. Transportmittel ────────────────────────────────────────── */}
        <div className="card p-5 space-y-4">
          <h2 className="font-semibold text-gray-700 text-sm uppercase tracking-wide">Transportmittel</h2>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className={labelCls}>Zugmaschine (Kennzeichen)</label>
              <input type="text" value={zugmaschine} onChange={e => setZugmaschine(e.target.value)}
                placeholder="z.B. W-123AB"
                className={inputCls + ' w-full'} />
            </div>
            <div>
              <label className={labelCls}>1. Anhänger</label>
              <input type="text" value={anhaenger1} onChange={e => setAnhaenger1(e.target.value)}
                placeholder="Kennzeichen"
                className={inputCls + ' w-full'} />
            </div>
            <div>
              <label className={labelCls}>2. Anhänger</label>
              <input type="text" value={anhaenger2} onChange={e => setAnhaenger2(e.target.value)}
                placeholder="Kennzeichen"
                className={inputCls + ' w-full'} />
            </div>
          </div>
        </div>

        {/* ── 4. Ware ───────────────────────────────────────────────────── */}
        <div className="card p-5 space-y-4">
          <h2 className="font-semibold text-gray-700 text-sm uppercase tracking-wide">Ware</h2>

          {/* Weinart */}
          <div>
            <label className={labelCls}>Weinart *</label>
            <div className="flex gap-4 mt-1.5">
              {([['weiss','Weißwein','bg-yellow-300'],['rot','Rotwein','bg-red-600'],['rose','Rosé','bg-pink-300'],['unbekannt','Unbekannt','bg-gray-200']] as const).map(([val, lbl, dot]) => (
                <label key={val} className="flex items-center gap-1.5 cursor-pointer">
                  <input type="radio" name="weinart" value={val} checked={weinart === val}
                    onChange={() => setWeinart(val)} className="accent-s112-teal" />
                  <span className={`inline-block w-2.5 h-2.5 rounded-full border border-black/10 ${dot}`} />
                  <span className="text-sm text-gray-700">{lbl}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>Rebsorte(n)</label>
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

            {/* Qualitätsstufe – nur bei Wein/Most */}
            {(art === 'wein' || art === 'most') && (
              <div>
                <label className={labelCls}>Qualitätsstufe</label>
                <select value={qualitaet} onChange={e => setQualitaet(e.target.value)}
                  className={inputCls + ' w-full'}>
                  <option value="">– nicht angegeben –</option>
                  {ZUKAUF_QUALITAETEN.map(q => (
                    <option key={q} value={q}>{QUALITAET_LABEL[q] ?? q}</option>
                  ))}
                </select>
              </div>
            )}

            <div>
              <label className={labelCls}>Herkunft</label>
              <input type="text" value={herkunft} onChange={e => setHerkunft(e.target.value)}
                placeholder="z.B. Kamptal, Wachau"
                className={inputCls + ' w-full'} />
            </div>

            {/* KMW – bei Trauben und Traubenmost */}
            {(art === 'trauben' || art === 'most') && (
              <div>
                <label className={labelCls}>°KMW</label>
                <input type="number" value={kmw} onChange={e => setKmw(e.target.value)}
                  step="0.1" min="0" max="50" placeholder="z.B. 19.5"
                  className={inputCls + ' w-full'} />
              </div>
            )}

            {/* Alkohol – bei Wein */}
            {art === 'wein' && (
              <div>
                <label className={labelCls}>Alkoholgehalt (%vol)</label>
                <input type="number" value={alkohol} onChange={e => setAlkohol(e.target.value)}
                  step="0.1" min="0" max="25" placeholder="z.B. 12.5"
                  className={inputCls + ' w-full'} />
              </div>
            )}

            {/* Staatl. Prüfnummer – bei Wein */}
            {art === 'wein' && (
              <div>
                <label className={labelCls}>Staatl. Prüfnummer</label>
                <input type="text" value={pruefnummer} onChange={e => setPruefnummer(e.target.value)}
                  placeholder="z.B. 1234/26"
                  className={inputCls + ' w-full'} />
              </div>
            )}
          </div>

          {/* Anreicherung – bei Trauben und Most */}
          {(art === 'trauben' || art === 'most') && (
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={anreicherung} onChange={e => setAnreicherung(e.target.checked)}
                className="accent-s112-teal w-4 h-4" />
              <span className="text-sm text-gray-700">Anreicherung (Zuckerung) erfolgt / geplant</span>
            </label>
          )}
        </div>

        {/* ── 5. Menge & Preis ──────────────────────────────────────────── */}
        <div className="card p-5 space-y-4">
          <h2 className="font-semibold text-gray-700 text-sm uppercase tracking-wide">Menge & Preis</h2>
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
                {einheit === 'L' ? (
                  <>
                    <div className={inputCls + ' w-full bg-s112-bg text-s112-muted cursor-not-allowed text-right tabular-nums'}>
                      {einstandspreisLiter
                        ? `€ ${Number(einstandspreisLiter).toLocaleString('de-AT', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`
                        : '–'}
                    </div>
                    <p className="text-xs text-s112-muted mt-1">Automatisch aus Gesamtpreis ÷ Menge</p>
                  </>
                ) : (
                  <input type="number" value={einstandspreisLiter} onChange={e => setEinstandspreisLiter(e.target.value)}
                    step="0.0001" min="0" placeholder="0.0000"
                    className={inputCls + ' w-full'} />
                )}
              </div>
            )}
          </div>
        </div>

        {/* ── 6. Gebinde (nur Wein / Most) ──────────────────────────────── */}
        {(art === 'wein' || art === 'most') && (
          <div className="card p-5 space-y-3">
            <h2 className="font-semibold text-gray-700 text-sm uppercase tracking-wide">In Gebinde füllen</h2>
            <div>
              <label className={labelCls}>Gebinde (optional)</label>
              <select value={zielBehaelter} onChange={e => setZielBehaelter(e.target.value)}
                className={inputCls + ' w-full'} disabled={loading}>
                <option value="">– keines –</option>
                {behaelter.map(b => {
                  const vol = b.volumen_liter
                  const chargen = weinausbauListe.filter(w => w.behaelter_id === b.id)
                  const inhalt = chargen.reduce((s, w) => s + (w.menge_liter ?? 0), 0)
                  const rest = vol != null ? vol - inhalt : null
                  const rebsorten = [...new Set(chargen.map(w => w.rebsorte).filter(Boolean))].join(', ')
                  const kapSuffix = vol != null ? ` · ${vol.toLocaleString('de-AT')} L` : ''
                  const inhaltSuffix = inhalt > 0 ? ` · Inhalt: ${inhalt.toLocaleString('de-AT')} L${rebsorten ? ` (${rebsorten})` : ''}` : ' · leer'
                  const restSuffix = rest != null ? ` · Rest: ${rest.toLocaleString('de-AT')} L` : ''
                  return (
                    <option key={b.id} value={b.id}>
                      {b.name}{kapSuffix}{inhaltSuffix}{restSuffix}
                    </option>
                  )
                })}
              </select>
            </div>

            {/* Detail-Panel für gewähltes Gebinde */}
            {zielBehaelter && (() => {
              const b = behaelter.find(x => x.id === zielBehaelter)
              const vol = b?.volumen_liter ?? null
              const chargen = weinausbauListe.filter(w => w.behaelter_id === zielBehaelter)
              const inhalt = chargen.reduce((s, w) => s + (w.menge_liter ?? 0), 0)
              const mengeNum = parseFloat(menge) || 0
              const restNach = vol != null ? vol - inhalt - mengeNum : null
              const ueber = restNach != null && restNach < -0.01
              const isMix = rebsorte && chargen.some(c => c.rebsorte && c.rebsorte !== rebsorte)
              return (
                <div className="bg-s112-bg border border-s112-border rounded-xl px-4 py-3 space-y-2 text-xs">
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <p className="text-s112-muted mb-0.5">Kapazität</p>
                      <p className="font-semibold text-gray-800">{vol != null ? vol.toLocaleString('de-AT') + ' L' : '–'}</p>
                    </div>
                    <div>
                      <p className="text-s112-muted mb-0.5">Inhalt jetzt</p>
                      <p className="font-semibold text-gray-800">
                        {inhalt.toLocaleString('de-AT', { maximumFractionDigits: 1 })} L
                        {chargen.length > 0 && (
                          <span className="ml-1 font-normal text-s112-muted">
                            ({[...new Set(chargen.map(c => c.rebsorte).filter(Boolean))].join(', ') || '–'})
                          </span>
                        )}
                      </p>
                    </div>
                    <div>
                      <p className="text-s112-muted mb-0.5">{mengeNum > 0 ? 'Rest nach Zukauf' : 'Restkapazität'}</p>
                      <p className={`font-semibold ${ueber ? 'text-red-600' : 'text-s112-teal'}`}>
                        {vol != null
                          ? (mengeNum > 0 ? restNach! : vol - inhalt).toLocaleString('de-AT', { maximumFractionDigits: 1 }) + ' L'
                          : '–'}
                      </p>
                    </div>
                  </div>
                  {ueber && (
                    <p className="text-red-600 font-semibold flex items-center gap-1.5">
                      <AlertTriangle size={14} /> Behälter hat nicht genug Kapazität
                    </p>
                  )}
                </div>
              )
            })()}

            {hatRebsortenmixZukauf && (
              <div className="bg-amber-50 border border-amber-300 rounded-lg px-3 py-2.5 text-sm text-amber-800">
                <span className="font-semibold inline-flex items-center gap-1.5"><AlertTriangle size={14} /> Rebsortenverschnitt:</span>{' '}
                Das gewählte Gebinde enthält bereits Chargen mit anderer Rebsorte:{' '}
                <strong>{andereChargenImZiel.map(c => `${c.name} (${c.rebsorte})`).join(', ')}</strong>.
                Nach dem Speichern wird das Verschneiden-Formular geöffnet.
              </div>
            )}
          </div>
        )}

        {/* ── 7. Notizen ────────────────────────────────────────────────── */}
        <div className="card p-5">
          <label className={labelCls}>Notizen</label>
          <textarea value={notizen} onChange={e => setNotizen(e.target.value)}
            rows={3} placeholder="Qualitätsmerkmale, Bedingungen, sonstige Anmerkungen…"
            className={inputCls + ' w-full resize-none'} />
        </div>

        {/* ── Submit ────────────────────────────────────────────────────── */}
        <div className="flex justify-end gap-3">
          <Link href="/weinhandel/zukauf"
            className="text-sm text-s112-muted hover:text-gray-700 px-4 py-2">
            Abbrechen
          </Link>
          <button type="submit" disabled={isPending}
            className="bg-s112-teal text-white px-6 py-2 rounded-xl text-sm font-semibold hover:bg-opacity-90 transition-colors disabled:opacity-50">
            {isPending ? 'Speichern…' : 'Zukauf speichern'}
          </button>
        </div>
      </form>
    </div>
  )
}
