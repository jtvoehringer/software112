'use client'

import { useState, useTransition, useEffect } from 'react'
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
}

interface Firma {
  id: string
  name: string
  rabatt_pct: number | null
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
}

const FLASCHEN_LABEL: Record<number, string> = {
  187: '0,187 L', 375: '0,375 L', 500: '0,500 L', 750: '0,75 L',
  1000: '1,0 L', 1500: '1,5 L', 3000: '3,0 L', 6000: '6,0 L',
}

const inputCls = 'border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40 bg-white'
const labelCls = 'block text-xs font-medium text-gray-600 mb-1'

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
    setPositionen(prev => [...prev, newEmptyPosition()])
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
              <select
                value={kontaktId}
                onChange={e => {
                  const kId = e.target.value
                  setKontaktId(kId)
                  if (kId) setFirmaId('')
                  const rabatt = kontakte.find(k => k.id === kId)?.rabatt_pct ?? 0
                  setKundenRabatt(rabatt)
                  setPositionen(prev => prev.map(p => ({ ...p, rabatt_pct: String(rabatt) })))
                }}
                className={inputCls + ' w-full'}
                disabled={loading}
              >
                <option value="">– kein Kontakt –</option>
                {kontakte.map(k => (
                  <option key={k.id} value={k.id}>
                    {[k.vorname, k.nachname].filter(Boolean).join(' ')}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls}>Firma *</label>
              <select
                value={firmaId}
                onChange={e => {
                  const fId = e.target.value
                  setFirmaId(fId)
                  if (fId) setKontaktId('')
                  const rabatt = firmen.find(f => f.id === fId)?.rabatt_pct ?? 0
                  setKundenRabatt(rabatt)
                  setPositionen(prev => prev.map(p => ({ ...p, rabatt_pct: String(rabatt) })))
                }}
                className={inputCls + ' w-full'}
                disabled={loading}
              >
                <option value="">– keine Firma –</option>
                {firmen.map(f => (
                  <option key={f.id} value={f.id}>{f.name}</option>
                ))}
              </select>
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
                  <div className="flex items-ce