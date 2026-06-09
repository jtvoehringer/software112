'use client'

import { useState, useTransition, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createVerkauf } from '../actions'

// ── Typen ─────────────────────────────────────────────────────────────────────

interface Fuellung {
  id: string
  name: string
  jahrgang: number | null
  rebsorte: string | null
  flaschengroesse_ml: number | null
  bestand_flaschen: number
  vk_preis_brutto: number | null
}

interface Weinausbau {
  id: string
  name: string
  menge_liter: number | null
}

interface Kontakt {
  id: string
  vorname: string | null
  nachname: string
  firma_id: string | null
  rabatt_pct: number | null
  sonderrabatt_pct: number
}

interface Firma {
  id: string
  name: string
  rabatt_pct: number | null
  sonderrabatt_pct: number
}

interface Position {
  id:            string  // lokale key
  typ:           'flasche' | 'tank' | 'sonstiges'
  fuellung_id:   string
  weinausbau_id: string
  name:          string
  menge:         string
  einheit:       string
  preis_brutto:  string
  rabatt_pct:    string  // aus Kundenstamm
  sonderrabatt:  string  // manuell
  sonderrabatt_aktiv: boolean
  ust_satz:           string
}

const FLASCHEN_LABEL: Record<number, string> = {
  187: '0,187 L', 375: '0,375 L', 500: '0,500 L', 750: '0,75 L',
  1000: '1,0 L', 1500: '1,5 L', 3000: '3,0 L', 6000: '6,0 L',
}

const inputCls = 'border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40 bg-white'
const labelCls = 'block text-xs font-medium text-gray-600 mb-1'

// ── Dynamische Suche ──────────────────────────────────────────────────────────

interface SucheItem { id: string; label: string; sub?: string }

function KundenSuche({ items, value, onChange, placeholder, disabled }: {
  items: SucheItem[]
  value: string
  onChange: (id: string) => void
  placeholder: string
  disabled?: boolean
}) {
  const [query, setQuery]   = useState('')
  const [open, setOpen]     = useState(false)
  const ref                 = useRef<HTMLDivElement>(null)

  const selected = items.find(i => i.id === value)

  const treffer = query.length < 1
    ? items.slice(0, 50)
    : items.filter(i =>
        (i.label + ' ' + (i.sub ?? '')).toLowerCase().includes(query.toLowerCase())
      ).slice(0, 50)

  // Klick außerhalb schließt Dropdown
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
        {selected.sub && <span className="text-xs text-s112-muted truncate">{selected.sub}</span>}
        {!disabled && (
          <button type="button" onClick={() => { onChange(''); setQuery('') }}
            className="text-s112-muted hover:text-red-500 ml-1 flex-shrink-0 text-base leading-none">×</button>
        )}
      </div>
    )
  }

  return (
    <div ref={ref} className="relative">
      <input
        type="text"
        value={query}
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

// ── Haupt-Komponente ──────────────────────────────────────────────────────────

export default function NeuerVerkaufPage() {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  // Stammdaten vom Server holen
  const [fuellungen,  setFuellungen]  = useState<Fuellung[]>([])
  const [weinausbau,  setWeinausbau]  = useState<Weinausbau[]>([])
  const [kontakte,    setKontakte]    = useState<Kontakt[]>([])
  const [firmen,      setFirmen]      = useState<Firma[]>([])
  const [loading,     setLoading]     = useState(true)
  const [ustStandard, setUstStandard] = useState(13)

  // Formular-State
  const [datum,            setDatum]           = useState(new Date().toISOString().split('T')[0])
  const [rechnungsnummer,  setRechnungsnummer] = useState('')
  const [kontaktId,        setKontaktId]       = useState('')
  const [firmaId,          setFirmaId]         = useState('')
  const [notizen,          setNotizen]         = useState('')
  const [kundenRabatt,     setKundenRabatt]    = useState(0) // % aus Kundenstamm

  // Positionen
  const [positionen, setPositionen] = useState<Position[]>([
    newEmptyPosition(),
  ])

  function newEmptyPosition(): Position {
    return {
      id:            crypto.randomUUID(),
      typ:           'flasche',
      fuellung_id:   '',
      weinausbau_id: '',
      name:          '',
      menge:         '1',
      einheit:       'Stk',
      preis_brutto:  '',
      rabatt_pct:    '0',
      sonderrabatt:  '0',
      sonderrabatt_aktiv: false,
      ust_satz:           '13',
    }
  }

  // Stammdaten laden
  useEffect(() => {
    async function load() {
      try {
        const res = await fetch('/api/verkauf-stammdaten')
        if (!res.ok) throw new Error('Laden fehlgeschlagen')
        const json = await res.json()
        setFuellungen(json.fuellungen ?? [])
        setWeinausbau(json.weinausbau ?? [])
        setKontakte(json.kontakte ?? [])
        setFirmen(json.firmen ?? [])
        const ust = json.ust_satz_standard ?? 13
        setUstStandard(ust)
        // Initiale leere Position mit korrektem USt-Satz befüllen
        setPositionen([{ ...newEmptyPosition(), ust_satz: String(ust) }])
      } catch {
        // Fehler beim Laden der Stammdaten – Felder bleiben leer
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  // Position ändern
  function updatePos(idx: number, patch: Partial<Position>) {
    setPositionen(prev => {
      const next = [...prev]
      next[idx] = { ...next[idx], ...patch }

      // Wenn Füllung gewählt → Felder automatisch befüllen
      if (patch.fuellung_id) {
        const f = fuellungen.find(x => x.id === patch.fuellung_id)
        if (f) {
          const label = [f.name, f.jahrgang, f.flaschengroesse_ml ? FLASCHEN_LABEL[f.flaschengroesse_ml] : null]
            .filter(Boolean).join(' · ')
          next[idx].name         = label
          next[idx].preis_brutto = f.vk_preis_brutto != null ? String(f.vk_preis_brutto) : ''
          next[idx].einheit      = 'Stk'
        }
      }

      // Wenn Weinausbau gewählt → Name befüllen
      if (patch.weinausbau_id) {
        const w = weinausbau.find(x => x.id === patch.weinausbau_id)
        if (w) {
          next[idx].name   = w.name
          next[idx].einheit = 'L'
        }
      }

      return next
    })
  }

  function addPosition() {
    setPositionen(prev => [...prev, { ...newEmptyPosition(), ust_satz: String(ustStandard) }])
  }

  function removePosition(idx: number) {
    setPositionen(prev => prev.filter((_, i) => i !== idx))
  }

  // Gesamt berechnen (mit Rabatten)
  const gesamt = positionen.reduce((s, p) => {
    const preis  = parseFloat(p.preis_brutto) || 0
    const menge  = parseFloat(p.menge) || 0
    const rabatt = (parseFloat(p.rabatt_pct) || 0) / 100
    const sonder = p.sonderrabatt_aktiv ? (parseFloat(p.sonderrabatt) || 0) / 100 : 0
    const effektivPreis = preis * (1 - rabatt) * (1 - sonder)
    return s + effektivPreis * menge
  }, 0)

  // Submit
  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    const posForServer = positionen.map(p => ({
      typ:           p.typ,
      fuellung_id:   p.fuellung_id   || null,
      weinausbau_id: p.weinausbau_id || null,
      name:          p.name,
      menge:         parseFloat(p.menge) || 0,
      einheit:       p.einheit,
      preis_brutto:  parseFloat(p.preis_brutto) || null,
      rabatt_pct:       parseFloat(p.rabatt_pct) || 0,
      sonderrabatt_pct: p.sonderrabatt_aktiv ? (parseFloat(p.sonderrabatt) || 0) : 0,
      ust_satz:         parseFloat(p.ust_satz) || ustStandard,
    }))

    if (!kontaktId && !firmaId) {
      setError('Bitte Kontakt oder Firma auswählen.')
      return
    }
    if (posForServer.some(p => !p.name || p.menge <= 0)) {
      setError('Alle Positionen benötigen einen Namen und eine Menge > 0.')
      return
    }

    const formData = new FormData()
    formData.set('datum',           datum)
    formData.set('rechnungsnummer', rechnungsnummer)
    formData.set('kontakt_id',      kontaktId)
    formData.set('firma_id',        firmaId)
    formData.set('notizen',         notizen)
    formData.set('positionen_json', JSON.stringify(posForServer))

    startTransition(async () => {
      try {
        await createVerkauf(formData)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Fehler beim Speichern')
      }
    })
  }

  return (
    <div className="space-y-6 max-w-3xl">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-2 text-sm text-s112-muted">
        <Link href="/weinhandel/verkauf" className="hover:text-s112-teal">Verkauf</Link>
        <span>/</span>
        <span className="text-gray-800 font-medium">Neuer Verkauf</span>
      </nav>

      <h1 className="text-xl font-bold text-gray-900">Neuer Verkauf</h1>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">

        {/* Kopfdaten */}
        <div className="card p-5 space-y-4">
          <h2 className="font-semibold text-gray-700 text-sm">Belegdaten</h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>Datum *</label>
              <input
                type="date"
                value={datum}
                onChange={e => setDatum(e.target.value)}
                required
                className={inputCls + ' w-full'}
              />
            </div>
            <div>
              <label className={labelCls}>Rechnungsnummer</label>
              <input
                type="text"
                value=""
                readOnly
                disabled
                placeholder="Wird automatisch vergeben"
                className={inputCls + ' w-full bg-s112-bg text-s112-muted cursor-not-allowed'}
              />
              <p className="text-xs text-s112-muted mt-1">Automatisch generiert beim Speichern</p>
            </div>
            <div>
              <label className={labelCls}>Kontakt (Person) *</label>
              <KundenSuche
                items={kontakte.map(k => ({
                  id: k.id,
                  label: [k.vorname, k.nachname].filter(Boolean).join(' '),
                }))}
                value={kontaktId}
                onChange={kId => {
                  setKontaktId(kId)
                  if (kId) setFirmaId('')
                  const k = kontakte.find(x => x.id === kId)
                  const rabatt = k?.rabatt_pct ?? 0
                  const sonder = k?.sonderrabatt_pct ?? 0
                  setKundenRabatt(rabatt)
                  setPositionen(prev => prev.map(p => ({
                    ...p,
                    rabatt_pct: String(rabatt),
                    sonderrabatt: String(sonder),
                    sonderrabatt_aktiv: sonder > 0,
                  })))
                }}
                placeholder="Name suchen…"
                disabled={loading}
              />
            </div>
            <div>
              <label className={labelCls}>Firma *</label>
              <KundenSuche
                items={firmen.map(f => ({ id: f.id, label: f.name }))}
                value={firmaId}
                onChange={fId => {
                  setFirmaId(fId)
                  if (fId) setKontaktId('')
                  const f = firmen.find(x => x.id === fId)
                  const rabatt = f?.rabatt_pct ?? 0
                  const sonder = f?.sonderrabatt_pct ?? 0
                  setKundenRabatt(rabatt)
                  setPositionen(prev => prev.map(p => ({
                    ...p,
                    rabatt_pct: String(rabatt),
                    sonderrabatt: String(sonder),
                    sonderrabatt_aktiv: sonder > 0,
                  })))
                }}
                placeholder="Firmenname suchen…"
                disabled={loading}
              />
            </div>
            <div className="col-span-2">
              <label className={labelCls}>Notizen</label>
              <input
                type="text"
                value={notizen}
                onChange={e => setNotizen(e.target.value)}
                placeholder="Interne Notizen zum Vorgang"
                className={inputCls + ' w-full'}
              />
            </div>
          </div>
        </div>

        {/* Positionen */}
        <div className="card p-5 space-y-4">
          <h2 className="font-semibold text-gray-700 text-sm">Positionen</h2>

          {positionen.map((pos, idx) => (
            <div key={pos.id} className="border border-s112-border rounded-lg p-4 space-y-3 relative">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-gray-500">Position {idx + 1}</span>
                {positionen.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removePosition(idx)}
                    className="text-xs text-red-400 hover:text-red-600"
                  >
                    ×  entfernen
                  </button>
                )}
              </div>

              {/* Typ */}
              <div className="flex gap-3">
                {(['flasche', 'tank', 'sonstiges'] as const).map(t => (
                  <label key={t} className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="radio"
                      name={`typ-${pos.id}`}
                      value={t}
                      checked={pos.typ === t}
                      onChange={() => updatePos(idx, {
                        typ: t,
                        fuellung_id: '',
                        weinausbau_id: '',
                        name: '',
                        einheit: t === 'tank' ? 'L' : 'Stk',
                      })}
                      className="accent-s112-teal"
                    />
                    <span className="text-xs capitalize text-gray-600">
                      {t === 'flasche' ? 'Flasche' : t === 'tank' ? 'Tank / Liter' : 'Sonstiges'}
                    </span>
                  </label>
                ))}
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {/* Produkt-Auswahl */}
                {pos.typ === 'flasche' && (
                  <div className="col-span-2">
                    <label className={labelCls}>Füllung (Lager)</label>
                    <select
                      value={pos.fuellung_id}
                      onChange={e => updatePos(idx, { fuellung_id: e.target.value })}
                      className={inputCls + ' w-full'}
                      disabled={loading}
                    >
                      <option value="">– manuell –</option>
                      {fuellungen.map(f => (
                        <option key={f.id} value={f.id}>
                          {f.name}{f.jahrgang ? ` (${f.jahrgang})` : ''}
                          {f.flaschengroesse_ml ? ` · ${FLASCHEN_LABEL[f.flaschengroesse_ml] ?? f.flaschengroesse_ml + 'ml'}` : ''}
                          {' '}· Bestand: {f.bestand_flaschen}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {pos.typ === 'tank' && (
                  <div className="col-span-2">
                    <label className={labelCls}>Weinausbau-Charge</label>
                    <select
                      value={pos.weinausbau_id}
                      onChange={e => updatePos(idx, { weinausbau_id: e.target.value })}
                      className={inputCls + ' w-full'}
                      disabled={loading}
                    >
                      <option value="">– manuell –</option>
                      {weinausbau.map(w => (
                        <option key={w.id} value={w.id}>
                          {w.name}{w.menge_liter != null ? ` · ${w.menge_liter} L` : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {/* Name */}
                <div className={pos.typ === 'sonstiges' ? 'col-span-2' : 'col-span-2'}>
                  <label className={labelCls}>Bezeichnung *</label>
                  <input
                    type="text"
                    value={pos.name}
                    onChange={e => updatePos(idx, { name: e.target.value })}
                    required
                    placeholder="Produktbezeichnung"
                    className={inputCls + ' w-full'}
                  />
                </div>

                {/* Menge */}
                <div>
                  <label className={labelCls}>Menge *</label>
                  <input
                    type="number"
                    value={pos.menge}
                    onChange={e => updatePos(idx, { menge: e.target.value })}
                    required
                    min={pos.typ === 'tank' ? 0.01 : 1}
                    step={pos.typ === 'tank' ? '0.01' : '1'}
                    className={inputCls + ' w-full'}
                  />
                </div>

                {/* Einheit */}
                <div>
                  <label className={labelCls}>Einheit</label>
                  <select
                    value={pos.einheit}
                    onChange={e => updatePos(idx, { einheit: e.target.value })}
                    className={inputCls + ' w-full'}
                  >
                    <option>Stk</option>
                    <option>L</option>
                    <option>Karton</option>
                    <option>Flasche</option>
                    <option>Pauschal</option>
                  </select>
                </div>

                {/* Preis */}
                <div>
                  <label className={labelCls}>Preis/Einheit (€, brutto)</label>
                  <input
                    type="number"
                    value={pos.preis_brutto}
                    onChange={e => updatePos(idx, { preis_brutto: e.target.value })}
                    step="0.01"
                    min={0}
                    placeholder="0.00"
                    className={inputCls + ' w-full'}
                  />
                </div>

                {/* Zeilen-Summe */}
                <div className="flex items-end">
                  <div className="text-right w-full">
                    <p className="text-xs text-s112-muted mb-1">Zeile</p>
                    <p className="font-semibold text-s112-teal tabular-nums text-sm">
                      {(() => {
                        const preis  = parseFloat(pos.preis_brutto) || 0
                        const menge  = parseFloat(pos.menge) || 0
                        const rabatt = (parseFloat(pos.rabatt_pct) || 0) / 100
                        const sonder = pos.sonderrabatt_aktiv ? (parseFloat(pos.sonderrabatt) || 0) / 100 : 0
                        return (preis * (1 - rabatt) * (1 - sonder) * menge)
                          .toLocaleString('de-AT', { style: 'currency', currency: 'EUR' })
                      })()}
                    </p>
                  </div>
                </div>
              </div>

              {/* Rabatt-Zeile */}
              <div className="flex items-center gap-4 mt-2 flex-wrap">
                {/* Kundenrabatt (read-only wenn gesetzt) */}
                {parseFloat(pos.rabatt_pct) > 0 && (
                  <span className="text-xs text-green-700 bg-green-50 border border-green-200 rounded-full px-2.5 py-0.5 font-medium">
                    {pos.rabatt_pct}% Kundenrabatt
                  </span>
                )}

                {/* Sonderrabatt-Toggle */}
                <label className="flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={pos.sonderrabatt_aktiv}
                    onChange={e => updatePos(idx, { sonderrabatt_aktiv: e.target.checked })}
                    className="rounded accent-s112-teal"
                  />
                  Sonderrabatt
                </label>
                {pos.sonderrabatt_aktiv && (
                  <div className="flex items-center gap-1.5">
                    <input
                      type="number"
                      value={pos.sonderrabatt}
                      onChange={e => updatePos(idx, { sonderrabatt: e.target.value })}
                      min="0" max="100" step="0.5"
                      placeholder="0"
                      className="border border-s112-border rounded-lg px-2 py-1 text-xs w-16 focus:outline-none focus:ring-2 focus:ring-s112-teal/40"
                    />
                    <span className="text-xs text-gray-400">%</span>
                  </div>
                )}
                {(parseFloat(pos.rabatt_pct) > 0 || pos.sonderrabatt_aktiv) && (
                  <span className="text-xs text-gray-400 ml-auto">
                    Listenpreis: {((parseFloat(pos.preis_brutto) || 0) * (parseFloat(pos.menge) || 0))
                      .toLocaleString('de-AT', { style: 'currency', currency: 'EUR' })}
                  </span>
                )}
              </div>
            </div>
          ))}

          <button
            type="button"
            onClick={addPosition}
            className="text-xs text-s112-teal border border-s112-teal/40 px-3 py-1.5 rounded-lg hover:bg-s112-teal/5"
          >
            + Position hinzufügen
          </button>
        </div>

        {/* Gesamt + Submit */}
        <div className="card p-5 flex items-center justify-between">
          <div>
            <p className="text-xs text-s112-muted">Gesamtbetrag (brutto)</p>
            <p className="text-2xl font-bold text-s112-teal tabular-nums">
              {gesamt.toLocaleString('de-AT', { style: 'currency', currency: 'EUR' })}
            </p>
            <p className="text-xs text-s112-muted mt-0.5">inkl. MwSt.</p>
          </div>
          <div className="flex gap-3">
            <Link
              href="/weinhandel/verkauf"
              className="text-sm text-s112-muted hover:text-gray-700 px-4 py-2"
            >
              Abbrechen
            </Link>
            <button
              type="submit"
              disabled={isPending}
              className="bg-s112-teal text-white px-6 py-2 rounded-xl text-sm font-semibold hover:bg-opacity-90 transition-colors disabled:opacity-50"
            >
              {isPending ? 'Speichern…' : '✓ Verkauf speichern'}
            </button>
          </div>
        </div>

      </form>
    </div>
  )
}
