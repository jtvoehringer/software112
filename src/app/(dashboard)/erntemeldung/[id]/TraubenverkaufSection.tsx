'use client'

import { useState, useTransition } from 'react'
import { createTraubenverkauf, updateTraubenverkauf, deleteTraubenverkauf } from '../actions'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

export type Traubenverkauf = {
  id: string
  weingarten_id: string; weingarten_name: string
  kontakt_id: string | null; kontakt_name: string | null
  firma_id: string | null; firma_name: string | null
  datum: string; menge_kg: number
  preis_per_kg: number | null; kmw_grad: number | null
  qualitaetsstufe: string | null; gesundheit: string
  herkunft_code: string | null; notizen: string | null
  liefernummer: string | null
}
export type TVWGOption = { id: string; name: string; herkunft_code: string | null }
export type TVKontaktOption = { id: string; name: string; betrieb_nr: string | null }
export type TVFirmaOption  = { id: string; name: string; betrieb_nr: string | null }
export type TVLeseParzelle = { weingarten_id: string; klosterneuburger: number | null; qualitaetsstufe: string | null }

const QUALITAETEN = [
  { value: 'qualitaetswein', label: 'Qualitätswein' },
  { value: 'kabinett', label: 'Kabinett' },
  { value: 'spaetlese', label: 'Spätlese' },
  { value: 'auslese', label: 'Auslese' },
  { value: 'beerenauslese', label: 'Beerenauslese' },
  { value: 'trockenbeerenauslese', label: 'TBA' },
  { value: 'eiswein', label: 'Eiswein' },
  { value: 'landwein', label: 'Landwein' },
]

const fmt = (n: number | null) =>
  n == null ? '–' : n.toLocaleString('de-AT', { maximumFractionDigits: 2 })
const fmtDate = (d: string) =>
  new Date(d).toLocaleDateString('de-AT', { day: '2-digit', month: '2-digit', year: 'numeric' })

// ── Formular ──────────────────────────────────────────────────────────────────

function TVForm({ jahrgangId, tv, wgOptions, leseParzellen, kontaktOptions, firmaOptions, onDone }: {
  jahrgangId: string
  tv?: Traubenverkauf
  wgOptions: TVWGOption[]
  leseParzellen: TVLeseParzelle[]
  kontaktOptions: TVKontaktOption[]
  firmaOptions: TVFirmaOption[]
  onDone: () => void
}) {
  const [wgId, setWgId]         = useState(tv?.weingarten_id ?? '')
  // Käufer-Typ: Firma ist Standard
  const initType = tv ? (tv.firma_id ? 'firma' : 'kontakt') : 'firma'
  const [buyerType, setBuyerType] = useState<'firma' | 'kontakt'>(initType)
  const [kontaktId, setKontakt] = useState(tv?.kontakt_id ?? '')
  const [firmaId, setFirma]     = useState(tv?.firma_id ?? '')
  const [datum, setDatum]       = useState(tv?.datum ?? new Date().toISOString().split('T')[0])
  const [mengeKg, setMengeKg]   = useState(tv?.menge_kg?.toString().replace('.', ',') ?? '')
  const [preis, setPreis]       = useState(tv?.preis_per_kg?.toString().replace('.', ',') ?? '')
  const [kmw, setKmw]           = useState(tv?.kmw_grad?.toString().replace('.', ',') ?? '')
  const [qualitaet, setQualitaet] = useState(tv?.qualitaetsstufe ?? '')
  const [gesundheit, setGesundheit] = useState(tv?.gesundheit ?? 'G')
  const [notizen, setNotizen]   = useState(tv?.notizen ?? '')
  const [pending, startTransition] = useTransition()

  const selectedWG = wgOptions.find(w => w.id === wgId)
  const herkunftCode = selectedWG?.herkunft_code ?? ''

  function handleWgChange(newWgId: string) {
    setWgId(newWgId)
    if (!tv && newWgId) {
      // KMW + Qualität aus letzter Lese-Parzelle dieser Ried vorausfüllen
      const match = leseParzellen.find(p => p.weingarten_id === newWgId)
      if (match) {
        if (match.klosterneuburger != null) setKmw(match.klosterneuburger.toString().replace('.', ','))
        if (match.qualitaetsstufe) setQualitaet(match.qualitaetsstufe)
      }
    }
  }

  const gesamtWert = mengeKg && preis
    ? parseFloat(mengeKg.replace(',', '.')) * parseFloat(preis.replace(',', '.'))
    : null

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const fd = new FormData()
    fd.append('jahrgang_id', jahrgangId)
    fd.append('weingarten_id', wgId)
    if (kontaktId) fd.append('kontakt_id', kontaktId)
    if (firmaId) fd.append('firma_id', firmaId)
    fd.append('datum', datum)
    fd.append('menge_kg', mengeKg)
    if (preis) fd.append('preis_per_kg', preis)
    if (kmw) fd.append('kmw_grad', kmw)
    if (qualitaet) fd.append('qualitaetsstufe', qualitaet)
    fd.append('gesundheit', gesundheit)
    if (herkunftCode) fd.append('herkunft_code', herkunftCode)
    if (notizen) fd.append('notizen', notizen)
    startTransition(async () => {
      if (tv) await updateTraubenverkauf(tv.id, fd)
      else await createTraubenverkauf(fd)
      onDone()
    })
  }

  const inp = 'w-full border border-s112-border rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40'

  return (
    <form onSubmit={handleSubmit} className="bg-s112-bg border border-s112-border rounded-xl p-4 space-y-4">
      <h3 className="text-sm font-semibold text-gray-800">{tv ? 'Traubenverkauf bearbeiten' : 'Traubenverkauf erfassen'}</h3>

      <div className="grid grid-cols-2 gap-3">
        {/* Ried */}
        <div className="col-span-2">
          <label className="block text-xs font-medium text-gray-600 mb-1">Ried *</label>
          <select value={wgId} onChange={e => handleWgChange(e.target.value)} required className={inp}>
            <option value="">– Ried wählen –</option>
            {wgOptions.map(w => (
              <option key={w.id} value={w.id}>
                {w.name}{w.herkunft_code ? ` (${w.herkunft_code})` : ''}
              </option>
            ))}
          </select>
        </div>

        {/* Datum */}
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Datum *</label>
          <input type="date" value={datum} onChange={e => setDatum(e.target.value)} required className={inp} />
        </div>

        {/* Menge kg */}
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Menge (kg) *</label>
          <input type="text" inputMode="decimal" value={mengeKg} onChange={e => setMengeKg(e.target.value)}
            placeholder="z.B. 1.250" required className={inp} />
        </div>

        {/* Preis/kg */}
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Preis (€/kg)</label>
          <input type="text" inputMode="decimal" value={preis} onChange={e => setPreis(e.target.value)}
            placeholder="z.B. 0,65" className={inp} />
        </div>

        {/* KMW */}
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">KMW°</label>
          <input type="text" inputMode="decimal" value={kmw} onChange={e => setKmw(e.target.value)}
            placeholder="z.B. 17,5" className={inp} />
        </div>

        {/* Qualitätsstufe */}
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Qualitätsstufe</label>
          <select value={qualitaet} onChange={e => setQualitaet(e.target.value)} className={inp}>
            <option value="">– keine –</option>
            {QUALITAETEN.map(q => <option key={q.value} value={q.value}>{q.label}</option>)}
          </select>
        </div>

        {/* Gesundheit */}
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Gesundheit</label>
          <select value={gesundheit} onChange={e => setGesundheit(e.target.value)} className={inp}>
            <option value="G">G – Gut</option>
            <option value="K">K – Krank/beschädigt</option>
          </select>
        </div>

        {/* Herkunftscode (read-only aus WG) */}
        {herkunftCode && (
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Herkunftscode (BKI)</label>
            <div className={inp + ' bg-white text-gray-500 cursor-not-allowed'}>{herkunftCode}</div>
          </div>
        )}
      </div>

      {/* Abnehmer */}
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-2">Käufer</label>
        <div className="flex gap-2 mb-2">
          <button type="button"
            onClick={() => { setBuyerType('firma'); setKontakt('') }}
            className={`px-3 py-1 text-xs rounded-lg font-medium transition-colors ${buyerType === 'firma' ? 'bg-s112-teal text-white' : 'bg-s112-bg border border-s112-border text-gray-600 hover:border-s112-teal'}`}>
            Firma
          </button>
          <button type="button"
            onClick={() => { setBuyerType('kontakt'); setFirma('') }}
            className={`px-3 py-1 text-xs rounded-lg font-medium transition-colors ${buyerType === 'kontakt' ? 'bg-s112-teal text-white' : 'bg-s112-bg border border-s112-border text-gray-600 hover:border-s112-teal'}`}>
            Privatperson
          </button>
        </div>
        {buyerType === 'firma' ? (
          <select value={firmaId} onChange={e => setFirma(e.target.value)} className={inp}>
            <option value="">– Firma wählen –</option>
            {firmaOptions.map(f => (
              <option key={f.id} value={f.id}>{f.name}{f.betrieb_nr ? ` (Betr.Nr. ${f.betrieb_nr})` : ''}</option>
            ))}
          </select>
        ) : (
          <select value={kontaktId} onChange={e => setKontakt(e.target.value)} className={inp}>
            <option value="">– Kontakt wählen –</option>
            {kontaktOptions.map(k => (
              <option key={k.id} value={k.id}>{k.name}{k.betrieb_nr ? ` (Betr.Nr. ${k.betrieb_nr})` : ''}</option>
            ))}
          </select>
        )}
      </div>

      {/* Live-Kalkulation */}
      {gesamtWert != null && gesamtWert > 0 && (
        <div className="flex gap-4 text-xs bg-white border border-s112-border rounded-lg px-3 py-2">
          <span className="text-gray-600">
            Gesamtwert: <strong className="text-gray-900">
              € {gesamtWert.toLocaleString('de-AT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </strong>
          </span>
        </div>
      )}

      {/* Notizen */}
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">Notizen</label>
        <input type="text" value={notizen} onChange={e => setNotizen(e.target.value)}
          placeholder="z.B. Abholung durch Genossenschaft …" className={inp} />
      </div>

      <div className="flex gap-2 pt-1">
        <button type="submit" disabled={pending}
          className="bg-s112-teal text-white px-4 py-1.5 rounded-lg text-sm font-medium hover:bg-opacity-90 disabled:opacity-50">
          {pending ? 'Speichert…' : 'Speichern'}
        </button>
        <button type="button" onClick={onDone} className="px-4 py-1.5 text-sm text-gray-600 hover:text-gray-800">
          Abbrechen
        </button>
      </div>
    </form>
  )
}

// ── Hauptexport ───────────────────────────────────────────────────────────────

export default function TraubenverkaufSection({
  jahrgangId, verkauefe, wgOptions, leseParzellen, kontaktOptions, firmaOptions, writeOk, adminOk,
}: {
  jahrgangId: string
  verkauefe: Traubenverkauf[]
  wgOptions: TVWGOption[]
  leseParzellen: TVLeseParzelle[]
  kontaktOptions: TVKontaktOption[]
  firmaOptions: TVFirmaOption[]
  writeOk: boolean; adminOk: boolean
}) {
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId]     = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const gesamtKg = verkauefe.reduce((s, v) => s + v.menge_kg, 0)
  const gesamtWert = verkauefe.reduce((s, v) => s + (v.menge_kg * (v.preis_per_kg ?? 0)), 0)

  function handleDelete(id: string) {
    if (!confirm('Traubenverkauf löschen?')) return
    startTransition(() => deleteTraubenverkauf(id, jahrgangId))
  }

  function handleCSV() {
    // CSV-Export als BKI-Transportliste
    const rows: string[][] = [
      ['Liefernummer', 'Datum', 'Weingarten', 'Herkunftscode', 'Menge kg', 'Preis €/kg', 'KMW°', 'Qualität', 'Gesundheit', 'Abnehmer'],
    ]
    for (const v of verkauefe) {
      rows.push([
        v.liefernummer ?? '',
        fmtDate(v.datum),
        v.weingarten_name,
        v.herkunft_code ?? '',
        v.menge_kg.toString().replace('.', ','),
        v.preis_per_kg?.toString().replace('.', ',') ?? '',
        v.kmw_grad?.toString().replace('.', ',') ?? '',
        v.qualitaetsstufe ?? '',
        v.gesundheit,
        v.firma_name ?? v.kontakt_name ?? '',
      ])
    }
    const csv = rows.map(r => r.map(c => `"${c.replace(/"/g, '""')}"`).join(';')).join('\r\n')
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href = url; a.download = `traubenverkauf_${jahrgangId}.csv`
    a.click(); URL.revokeObjectURL(url)
  }

  return (
    <div className={`card space-y-4 ${pending ? 'opacity-60 pointer-events-none' : ''}`}>
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-gray-800">Traubenverkauf</h2>
          <p className="text-xs text-s112-muted">Verkauf von Weintrauben gem. § 3 Weingesetz-Formularverordnung</p>
        </div>
        <div className="flex items-center gap-3">
          {verkauefe.length > 0 && (
            <span className="text-xs text-s112-muted">
              {fmt(gesamtKg)} kg
              {gesamtWert > 0 && <span className="ml-1 font-medium text-gray-700">
                · € {gesamtWert.toLocaleString('de-AT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>}
            </span>
          )}
          {verkauefe.length > 0 && (
            <button onClick={handleCSV}
              className="text-xs bg-gray-100 hover:bg-gray-200 text-gray-600 font-medium px-3 py-1.5 rounded-lg transition-colors">
              ↓ CSV
            </button>
          )}
          {writeOk && !showForm && (
            <button onClick={() => { setShowForm(true); setEditId(null) }}
              className="text-xs bg-s112-teal/10 hover:bg-s112-teal/20 text-s112-teal font-medium px-3 py-1.5 rounded-lg transition-colors">
              ＋ Traubenverkauf
            </button>
          )}
        </div>
      </div>

      {showForm && !editId && (
        <TVForm jahrgangId={jahrgangId} wgOptions={wgOptions} leseParzellen={leseParzellen}
          kontaktOptions={kontaktOptions} firmaOptions={firmaOptions}
          onDone={() => setShowForm(false)} />
      )}

      {verkauefe.length === 0 && !showForm ? (
        <div className="border border-dashed border-s112-border rounded-xl p-8 text-center text-sm text-s112-muted">
          Noch keine Traubenverkäufe erfasst.
        </div>
      ) : (
        <div className="space-y-2">
          {verkauefe.map(v => (
            <div key={v.id}>
              {editId === v.id ? (
                <TVForm tv={v} jahrgangId={jahrgangId} wgOptions={wgOptions} leseParzellen={leseParzellen}
                  kontaktOptions={kontaktOptions} firmaOptions={firmaOptions}
                  onDone={() => setEditId(null)} />
              ) : (
                <div className="group border border-s112-border rounded-xl p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        {v.liefernummer && (
                          <span className="font-mono text-xs bg-s112-teal/10 text-s112-teal px-2 py-0.5 rounded-full font-semibold">
                            {v.liefernummer}
                          </span>
                        )}
                        <span className="font-medium text-gray-800 text-sm">{fmtDate(v.datum)}</span>
                        <span className="text-sm text-gray-700">· {v.weingarten_name}</span>
                        {v.gesundheit === 'K' && (
                          <span className="text-xs bg-orange-100 text-orange-700 px-2 py-0.5 rounded-full font-medium">K – Krank</span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 text-xs text-s112-muted flex-wrap">
                        <span className="font-semibold text-gray-700">{fmt(v.menge_kg)} kg</span>
                        {v.preis_per_kg != null && (
                          <span>· € {v.preis_per_kg.toLocaleString('de-AT', { minimumFractionDigits: 2 })}/kg
                            <span className="ml-1 font-medium text-gray-700">
                              = € {(v.menge_kg * v.preis_per_kg).toLocaleString('de-AT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </span>
                          </span>
                        )}
                        {v.kmw_grad != null && <span>· {v.kmw_grad.toString().replace('.', ',')} °KMW</span>}
                        {v.qualitaetsstufe && <span>· {v.qualitaetsstufe}</span>}
                        {(v.firma_name ?? v.kontakt_name) && (
                          <span>· {v.firma_name ?? v.kontakt_name}</span>
                        )}
                        {v.notizen && <span className="italic">· {v.notizen}</span>}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0 text-xs opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                      {writeOk && (
                        <button onClick={() => setEditId(v.id)} title="Bearbeiten" aria-label="Bearbeiten" className="text-s112-teal hover:text-s112-teal/70">✏️</button>
                      )}
                      {adminOk && (
                        <button onClick={() => handleDelete(v.id)} title="Löschen" aria-label="Löschen" className="text-red-400 hover:text-red-600">🗑️</button>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
