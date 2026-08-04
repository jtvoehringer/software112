'use client'

import { useState, useTransition } from 'react'
import { Pencil, Trash2, X, ChevronDown, Plus } from 'lucide-react'
import { upsertPressung, deletePressung } from '../actions'
import { fmtProzent } from '@/lib/format'
import { kmwZuQualitaet, QUALITAET_LABEL, QUALITAET_ORDER } from '@/lib/weinqualitaet'
import VerschneidungForm from '@/components/kellerbuch/VerschneidungForm'

// ── Types ─────────────────────────────────────────────────────────────────────

export type PressungWG = {
  id: string; weingarten_id: string; weingarten_name: string
  grundstueck_id?: string | null
  trauben_kg: number; rebsorte: string | null; notizen: string | null
}
export type PressungBeh = {
  id: string; behaelter_id: string | null; behaelter_name: string | null
  weinausbau_id: string | null; weinausbau_name: string | null
  menge_liter: number | null; notizen: string | null
}
export type Pressung = {
  id: string; datum: string; most_liter_gesamt: number | null
  weinbezeichnung: string | null; notizen: string | null; kmw_grad: number | null
  weingaerten: PressungWG[]; behaelter: PressungBeh[]
}
export type WGOption  = { id: string; name: string; rebsorte: string | null }
export type BehOption = { id: string; name: string; volumen_liter?: number | null }
export type WAOption  = { id: string; name: string; jahrgang: number | null }
export type LeseParzelle = {
  weingarten_id: string; weingarten_name: string
  grundstueck_id: string | null; grundstueck_nr: string | null; grundstueck_rebsorte: string | null
  menge_kg: number | null; rebsorte: string | null; klosterneuburger?: number | null
}

// ── Hilfsfunktionen ───────────────────────────────────────────────────────────

const ROT_REBSORTEN = new Set([
  'Zweigelt','Blaufränkisch','St. Laurent','Blauer Portugieser','Blauburger',
  'Cabernet Sauvignon','Merlot','Syrah','Shiraz','Pinot Noir','Blauburgunder',
  'Regent','Dornfelder','Lemberger','Primitivo','Sangiovese','Tempranillo',
])
function weinfarbe(rebsorte: string | null): 'rot' | 'weiß' | null {
  if (!rebsorte) return null
  if (ROT_REBSORTEN.has(rebsorte)) return 'rot'
  const l = rebsorte.toLowerCase()
  if (l.startsWith('blau') || l.includes('noir') || l.includes('schwarz')) return 'rot'
  return 'weiß'
}

const fmt = (n: number | null) =>
  n == null ? '–' : n.toLocaleString('de-AT', { maximumFractionDigits: 1 })

const fmtDate = (d: string) =>
  new Date(d).toLocaleDateString('de-AT', { day: '2-digit', month: '2-digit', year: 'numeric' })

// ── Pressung-Formular ─────────────────────────────────────────────────────────

type WGRow  = { weingarten_id: string; grundstueck_id: string; trauben_kg: string; rebsorte: string; notizen: string }
type BehRow = { behaelter_id: string; weinausbau_id: string; menge_liter: string; notizen: string }

const emptyWG  = (): WGRow  => ({ weingarten_id: '', grundstueck_id: '', trauben_kg: '', rebsorte: '', notizen: '' })
const emptyBeh = (): BehRow => ({ behaelter_id: '', weinausbau_id: '', menge_liter: '', notizen: '' })

function PressungForm({ jahrgangId, pressung, wgOptions, behOptions, waOptions, leseParzellen, verfuegbareKgByGST, behaelterMitCharge, onDone }: {
  jahrgangId: string; pressung?: Pressung
  wgOptions: WGOption[]; behOptions: BehOption[]; waOptions: WAOption[]
  leseParzellen: LeseParzelle[]; verfuegbareKgByGST: Record<string, number>
  behaelterMitCharge?: Record<string, { weinausbau_id: string; name: string; rebsorte?: string | null; menge_liter?: number | null; qualitaetsstufe?: string | null; herkunft_code?: string | null }[]>; onDone: () => void
}) {
  const [datum, setDatum]                   = useState(pressung?.datum ?? new Date().toISOString().split('T')[0])
  const [mostLiter, setMostLiter]           = useState(pressung?.most_liter_gesamt?.toString().replace('.', ',') ?? '')
  const [weinbezeichnung, setWeinbez]       = useState(pressung?.weinbezeichnung ?? '')
  const [notizen, setNotizen]               = useState(pressung?.notizen ?? '')
  const [qualitaetsstufe, setQualitaetsstufe] = useState<string>('')

  // Pre-fill aus Erntedaten: eine Zeile pro Parzelle (GST oder Ried)
  // Verfügbare kg direkt per GST-ID (kein proportionales Verteilen mehr)
  function gstVerfuegbar(gstId: string | null): number {
    return gstId ? (verfuegbareKgByGST[gstId] ?? 0) : 0
  }

  const defaultWGRows: WGRow[] = pressung
    ? pressung.weingaerten.map(w => ({
        weingarten_id: w.weingarten_id, grundstueck_id: w.grundstueck_id ?? '',
        trauben_kg: w.trauben_kg.toString().replace('.', ','),
        rebsorte: w.rebsorte ?? '', notizen: w.notizen ?? '',
      }))
    : (() => {
        const rows = leseParzellen
          .filter(p => (p.menge_kg ?? 0) > 0 && gstVerfuegbar(p.grundstueck_id) > 0)
          .map(p => ({
            weingarten_id: p.weingarten_id,
            grundstueck_id: p.grundstueck_id ?? '',
            trauben_kg: gstVerfuegbar(p.grundstueck_id).toString().replace('.', ','),
            rebsorte: p.grundstueck_rebsorte ?? p.rebsorte ?? '',
            notizen: '',
          }))
        return rows.length > 0 ? rows : [emptyWG()]
      })()
  const [wgRows, setWgRows] = useState<WGRow[]>(defaultWGRows)
  const [behRows, setBehRows] = useState<BehRow[]>(
    pressung?.behaelter.map(b => ({
      behaelter_id: b.behaelter_id ?? '', weinausbau_id: b.weinausbau_id ?? '',
      menge_liter: b.menge_liter?.toString().replace('.', ',') ?? '', notizen: b.notizen ?? '',
    })) ?? [emptyBeh()]
  )

  // KMW gewichteter Durchschnitt aus den AUSGEWÄHLTEN WG-Zeilen (reaktiv zu wgRows)
  const kmwFromWgRows = (() => {
    let sumKg = 0, sumKmw = 0
    for (const row of wgRows) {
      const kg = parseFloat(row.trauben_kg.replace(',', '.')) || 0
      if (kg <= 0) continue
      const parzelle = leseParzellen.find(p =>
        p.weingarten_id === row.weingarten_id &&
        (p.grundstueck_id ?? '') === row.grundstueck_id
      )
      if (parzelle?.klosterneuburger != null) {
        sumKg  += kg
        sumKmw += parzelle.klosterneuburger * kg
      }
    }
    if (sumKg === 0) return pressung?.kmw_grad ?? null
    return Math.round((sumKmw / sumKg) * 10) / 10
  })()
  const kmwGrad      = kmwFromWgRows?.toString().replace('.', ',') ?? ''
  const kmwNum       = parseFloat(kmwGrad.replace(',', '.'))
  const kmwQualitaet = !isNaN(kmwNum) && kmwNum > 0 ? kmwZuQualitaet(kmwNum) : null
  const [pending, startTransition] = useTransition()

  type VerschneidungData = {
    newCharge:       { id: string; name: string; menge_liter?: number | null; qualitaetsstufe?: string | null; herkunft_code?: string | null }
    existingChargen: { weinausbau_id: string; name: string; menge_liter?: number | null; qualitaetsstufe?: string | null; herkunft_code?: string | null }[]
  }
  const [verschneidung, setVerschneidung]         = useState<VerschneidungData | null>(null)
  const [verschneidungOpen, setVerschneidungOpen] = useState(false)

  const gesamtKg = wgRows.reduce((s, r) => s + (parseFloat(r.trauben_kg.replace(',', '.')) || 0), 0)
  const mostL    = parseFloat(mostLiter.replace(',', '.')) || 0
  const ausbeute = gesamtKg > 0 && mostL > 0 ? (mostL / gesamtKg) * 100 : null

  // GST-/Ried-Optionen aus Erntedaten: eine Option pro Parzelle
  const gstOptionen = leseParzellen.map(p => ({
    compositeId: `${p.weingarten_id}|${p.grundstueck_id ?? ''}`,
    weingarten_id: p.weingarten_id,
    grundstueck_id: p.grundstueck_id ?? '',
    label: p.grundstueck_nr
      ? `GST ${p.grundstueck_nr} · ${p.weingarten_name}`
      : p.weingarten_name,
    rebsorte: p.grundstueck_rebsorte ?? p.rebsorte ?? '',
    menge_kg: p.menge_kg ?? 0,
    verfuegbar_kg: gstVerfuegbar(p.grundstueck_id),
  }))

  function updateWG(i: number, field: keyof WGRow | 'compositeId', val: string) {
    if (field === 'compositeId') {
      const opt = gstOptionen.find(o => o.compositeId === val)
      if (opt) {
        setWgRows(rows => rows.map((r, j) => j === i ? {
          ...r,
          weingarten_id: opt.weingarten_id,
          grundstueck_id: opt.grundstueck_id,
          rebsorte: opt.rebsorte,
        } : r))
      }
    } else {
      setWgRows(rows => rows.map((r, j) => j === i ? { ...r, [field]: val } : r))
    }
  }
  function updateBeh(i: number, field: keyof BehRow, val: string) {
    setBehRows(rows => rows.map((r, j) => j === i ? { ...r, [field]: val } : r))
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const fd = new FormData()
    fd.append('jahrgang_id', jahrgangId)
    if (pressung) fd.append('existing_id', pressung.id)
    fd.append('datum', datum)
    fd.append('most_liter_gesamt', mostLiter)
    fd.append('weinbezeichnung', weinbezeichnung)
    fd.append('kmw_grad', kmwGrad)
    fd.append('qualitaetsstufe', qualitaetsstufe)
    fd.append('notizen', notizen)
    fd.append('weingaerten_json', JSON.stringify(
      wgRows.filter(r => r.weingarten_id && r.trauben_kg).map(r => ({
        weingarten_id: r.weingarten_id,
        grundstueck_id: r.grundstueck_id || undefined,
        trauben_kg: parseFloat(r.trauben_kg.replace(',', '.')),
        rebsorte: r.rebsorte || undefined,
        notizen: r.notizen || undefined,
      }))
    ))
    fd.append('behaelter_json', JSON.stringify(
      behRows.filter(r => r.behaelter_id || r.weinausbau_id).map(r => ({
        behaelter_id: r.behaelter_id || undefined,
        weinausbau_id: r.weinausbau_id || undefined,
        menge_liter: r.menge_liter ? parseFloat(r.menge_liter.replace(',', '.')) : undefined,
        notizen: r.notizen || undefined,
      }))
    ))
    startTransition(async () => {
      try {
        const result = await upsertPressung(fd)
        // Prüfen ob neue Charge in Behälter mit bestehenden Chargen gedrückt wurde
        if (!pressung && behaelterMitCharge && result.neu.length > 0) {
          // Verschnitt-Prompt immer wenn Behälter bereits Chargen hat
          const konflikt = result.neu.find(n => {
            const existing = behaelterMitCharge[n.behaelter_id] ?? []
            return existing.length > 0
          })
          if (konflikt) {
            setVerschneidung({
              newCharge: { id: konflikt.weinausbau_id, name: konflikt.name, menge_liter: konflikt.menge_liter ?? null, qualitaetsstufe: konflikt.qualitaetsstufe ?? null, herkunft_code: konflikt.herkunft_code ?? null },
              existingChargen: behaelterMitCharge[konflikt.behaelter_id],
            })
            return
          }
        }
        onDone()
      } catch (err) {
        console.error('Pressung Fehler:', err)
        alert('Fehler beim Speichern: ' + (err instanceof Error ? err.message : 'Unbekannter Fehler'))
      }
    })
  }

  const inp = "w-full border border-s112-border rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40"

  // ── Nach dem Speichern: Verschneidungs-Prompt ─────────────────────────────
  if (verschneidung) {
    // Korrekte Richtung: bestehende Charge = Ziel (Basis), neue Pressung-Charge = Quelle
    const zielCharge = {
      id:          verschneidung.existingChargen[0].weinausbau_id,
      name:        verschneidung.existingChargen[0].name,
      menge_liter: verschneidung.existingChargen[0].menge_liter ?? null,
      qualitaetsstufe: verschneidung.existingChargen[0].qualitaetsstufe ?? null,
      herkunft_code:   verschneidung.existingChargen[0].herkunft_code ?? null,
    }
    const alleChargen = [
      zielCharge,
      {
        id: verschneidung.newCharge.id, name: verschneidung.newCharge.name, menge_liter: verschneidung.newCharge.menge_liter ?? null,
        qualitaetsstufe: verschneidung.newCharge.qualitaetsstufe ?? null, herkunft_code: verschneidung.newCharge.herkunft_code ?? null,
      },
    ]
    if (verschneidungOpen) {
      return (
        <div className="bg-s112-bg border border-amber-200 rounded-xl p-4">
          <p className="text-sm font-semibold text-gray-800 mb-3">Chargen verschneiden</p>
          <VerschneidungForm
            zielCharge={zielCharge}
            alleChargen={alleChargen}
            initialQuelleId={verschneidung.newCharge.id}
            initialQuelleMenge={verschneidung.newCharge.menge_liter != null ? String(verschneidung.newCharge.menge_liter) : ''}
            onDone={() => { setVerschneidung(null); setVerschneidungOpen(false); onDone() }}
          />
        </div>
      )
    }
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 space-y-3">
        <p className="text-sm font-semibold text-amber-800">Pressung gespeichert</p>
        <p className="text-sm text-amber-700">
          Die neue Charge <strong>{verschneidung.newCharge.name}</strong> wurde in einen
          Behälter mit bestehenden Chargen gefüllt:
          {' '}<strong>{verschneidung.existingChargen.map(c => c.name).join(', ')}</strong>.
          Sollen die Weine jetzt verschnitten werden?
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setVerschneidungOpen(true)}
            className="bg-s112-teal text-white px-4 py-1.5 rounded-lg text-sm font-medium hover:bg-opacity-90"
          >
            Jetzt verschneiden
          </button>
          <button
            type="button"
            onClick={() => { setVerschneidung(null); onDone() }}
            className="px-4 py-1.5 text-sm text-gray-600 hover:text-gray-800"
          >
            Später / Kein Verschnitt
          </button>
        </div>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="bg-s112-bg border border-s112-border rounded-xl p-4 space-y-4">
      <h3 className="text-sm font-semibold text-gray-800">{pressung ? 'Pressung bearbeiten' : 'Pressung erfassen'}</h3>

      {/* Datum + Most + Bezeichnung */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Datum *</label>
          <input type="date" value={datum} onChange={e => setDatum(e.target.value)} required className={inp} />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Mostausbeute gesamt (L)</label>
          <input type="text" inputMode="decimal" value={mostLiter} onChange={e => setMostLiter(e.target.value)}
            placeholder="z.B. 1.050" className={inp} />
        </div>
        <div className="col-span-2">
          <label className="block text-xs font-medium text-gray-600 mb-1">KMW° & Qualitätsstufe</label>
          <div className="flex items-center gap-2">
            <div className="border border-s112-border rounded-lg px-2 py-1.5 text-sm bg-s112-bg text-gray-700 cursor-not-allowed whitespace-nowrap shrink-0">
              {kmwGrad ? `${kmwGrad} °KMW` : <span className="text-s112-muted text-xs">– kein KMW</span>}
            </div>
            {kmwQualitaet && (
              <button
                type="button"
                onClick={() => setQualitaetsstufe(kmwQualitaet)}
                className="shrink-0 text-xs font-semibold px-2 py-1 rounded-full bg-amber-100 text-amber-800 whitespace-nowrap hover:bg-amber-200 transition-colors cursor-pointer"
              >
                → {QUALITAET_LABEL[kmwQualitaet]}
              </button>
            )}
            <select
              value={qualitaetsstufe}
              onChange={e => setQualitaetsstufe(e.target.value)}
              className={inp}
            >
              <option value="">– Qualitätsstufe –</option>
              {(['wein','landwein','qualitaetswein','kabinett','spaetlese','auslese','beerenauslese','ausbruch','trockenbeerenauslese','eiswein','strohwein'] as const).map(q => (
                <option key={q} value={q}>{QUALITAET_LABEL[q]}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="col-span-2">
          <label className="block text-xs font-medium text-gray-600 mb-1">
            Bezeichnung <span className="text-s112-muted font-normal">(z.B. Gemischter Satz – optional)</span>
          </label>
          <input type="text" value={weinbezeichnung} onChange={e => setWeinbez(e.target.value)}
            placeholder="Leer lassen für reinsortige Weine" className={inp} />
          {(() => {
            const rebsorten = wgRows.map(r => r.rebsorte).filter(Boolean)
            const unique = [...new Set(rebsorten)]
            const autoRebsorte = unique.length === 1 ? unique[0] : unique.length > 1 ? 'Sortenverschnitt' : null
            const preview = weinbezeichnung.trim() || autoRebsorte
              || `Pressung ${datum ? new Date(datum).toLocaleDateString('de-AT', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '…'}`
            return (
              <p className="text-xs text-s112-muted mt-1">
                → Charge: <strong className="text-gray-700">&ldquo;{preview}&rdquo;</strong>
              </p>
            )
          })()}
        </div>
      </div>

      {/* Live-Kalkulation */}
      {gesamtKg > 0 && (
        <div className="flex gap-4 text-xs bg-white border border-s112-border rounded-lg px-3 py-2">
          <span className="text-gray-600">Trauben: <strong className="text-gray-900">{fmt(gesamtKg)} kg</strong></span>
          {mostL > 0 && <>
            <span className="text-gray-400">→</span>
            <span className="text-gray-600">Most: <strong className="text-gray-900">{fmt(mostL)} L</strong></span>
            <span className="text-gray-400">→</span>
            <span className={`font-semibold ${ausbeute && ausbeute < 65 ? 'text-amber-600' : 'text-green-700'}`}>
              {fmtProzent(ausbeute)} % Ausbeute
            </span>
            <span className="text-gray-400 ml-auto">Faustregel: 70 %</span>
          </>}
        </div>
      )}

      {/* Gelesene GST */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <label className="text-xs font-semibold text-gray-700">Gelesene GST</label>
          <button type="button" onClick={() => setWgRows(r => [...r, emptyWG()])}
            className="text-xs text-s112-teal hover:underline">GST</button>
        </div>
        <div className="space-y-1.5">
          {wgRows.map((row, i) => {
            const compositeId = `${row.weingarten_id}|${row.grundstueck_id}`
            return (
              <div key={i} className="grid grid-cols-12 gap-1.5 items-center">
                <div className="col-span-5">
                  <select
                    value={row.weingarten_id ? compositeId : ''}
                    onChange={e => updateWG(i, 'compositeId', e.target.value)}
                    className={inp}
                  >
                    <option value="">– GST/Ried –</option>
                    {gstOptionen.map(opt => (
                      <option key={opt.compositeId} value={opt.compositeId}>
                        {opt.label} – {opt.verfuegbar_kg.toLocaleString('de-AT', { maximumFractionDigits: 0 })} kg verf.
                      </option>
                    ))}
                  </select>
                </div>
                <div className="col-span-2">
                  <input type="text" inputMode="decimal" value={row.trauben_kg}
                    onChange={e => updateWG(i, 'trauben_kg', e.target.value)}
                    placeholder="kg" className={inp} />
                </div>
                <div className="col-span-3 flex items-center px-2">
                  <span className="text-sm text-gray-600 truncate">
                    {row.rebsorte || <span className="text-gray-400 text-xs">–</span>}
                  </span>
                </div>
                <div className="col-span-2 flex justify-end">
                  {wgRows.length > 1 && (
                    <button type="button" onClick={() => setWgRows(r => r.filter((_, j) => j !== i))}
                      className="text-xs text-red-400 hover:text-red-600 px-1"><X size={14} /></button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Befüllte Behälter/Chargen */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <label className="text-xs font-semibold text-gray-700">Most in Behälter/Charge</label>
          <button type="button" onClick={() => setBehRows(r => [...r, emptyBeh()])}
            className="text-xs text-s112-teal hover:underline">Behälter</button>
        </div>
        <div className="space-y-1.5">
          {behRows.map((row, i) => (
            <div key={i} className="grid grid-cols-12 gap-1.5 items-center">
              <div className="col-span-6">
                <select value={row.behaelter_id} onChange={e => updateBeh(i, 'behaelter_id', e.target.value)} className={inp}>
                  <option value="">– Behälter –</option>
                  {behOptions.map(b => {
                    const vol = b.volumen_liter ?? null
                    const existing = behaelterMitCharge?.[b.id] ?? []
                    const inhalt = existing.reduce((s, c) => s + (parseFloat(String(c.menge_liter ?? 0)) || 0), 0)
                    const frei = vol != null ? vol - inhalt : null
                    const kapSuffix = vol != null
                      ? ` · ${vol.toLocaleString('de-AT')} L · frei: ${frei!.toLocaleString('de-AT', { maximumFractionDigits: 0 })} L`
                      : ''
                    const inhaltSuffix = existing.length > 0
                      ? ` [${existing.map(c => c.rebsorte ? `${c.name} (${c.rebsorte})` : c.name).join(', ')}]`
                      : ' [leer]'
                    return <option key={b.id} value={b.id}>{b.name}{kapSuffix}{inhaltSuffix}</option>
                  })}
                </select>
                {row.behaelter_id && (() => {
                  const beh = behOptions.find(b => b.id === row.behaelter_id)
                  const vol = beh?.volumen_liter ?? null
                  const existing = behaelterMitCharge?.[row.behaelter_id] ?? []
                  const inhaltJetzt = existing.reduce((s, c) => s + (parseFloat(String(c.menge_liter ?? 0)) || 0), 0)
                  const eingabe = parseFloat(row.menge_liter.replace(',', '.')) || 0
                  const restNach = vol != null ? vol - inhaltJetzt - eingabe : null
                  const ueber = restNach != null && restNach < -0.01

                  // Rebsorten- und Farbprüfung
                  const rebsortenInForm = [...new Set(wgRows.map(r => r.rebsorte).filter(Boolean))]
                  const pressungFarbe = weinfarbe(rebsortenInForm[0] ?? null)
                  const existingFarben = existing.map(e => weinfarbe(e.rebsorte ?? null)).filter(Boolean)
                  const isFarbmix = pressungFarbe != null && existingFarben.some(f => f !== pressungFarbe)
                  const isMix = existing.length > 0 && rebsortenInForm.length > 0
                    && existing.some(e => e.rebsorte && !rebsortenInForm.includes(e.rebsorte))

                  return (
                    <div className="mt-1.5 bg-s112-bg border border-s112-border rounded-lg px-3 py-2 text-xs space-y-2">
                      {/* Kapazitäts-Zahlen */}
                      <div className="grid grid-cols-3 gap-1.5">
                        <div>
                          <p className="text-s112-muted mb-0.5">Kapazität</p>
                          <p className="font-medium tabular-nums">{vol != null ? vol.toLocaleString('de-AT') + ' L' : '–'}</p>
                        </div>
                        <div>
                          <p className="text-s112-muted mb-0.5">Inhalt jetzt</p>
                          <p className="font-medium tabular-nums">{inhaltJetzt.toLocaleString('de-AT', { maximumFractionDigits: 1 })} L</p>
                        </div>
                        <div>
                          <p className="text-s112-muted mb-0.5">{eingabe > 0 ? 'Rest nach Pressung' : 'Restkapazität'}</p>
                          <p className={`font-medium tabular-nums ${ueber ? 'text-red-600' : 'text-s112-teal'}`}>
                            {vol != null ? (eingabe > 0 ? restNach! : vol - inhaltJetzt).toLocaleString('de-AT', { maximumFractionDigits: 1 }) + ' L' : '–'}
                          </p>
                        </div>
                      </div>

                      {/* Bestehende Chargen */}
                      {existing.length > 0 && (
                        <div className={`rounded px-2 py-1.5 border ${isFarbmix ? 'bg-red-50 border-red-300' : isMix ? 'bg-amber-50 border-amber-200' : 'bg-white border-s112-border'}`}>
                          <p className={`font-medium mb-1 ${isFarbmix ? 'text-red-700' : isMix ? 'text-amber-700' : 'text-gray-600'}`}>
                            {isFarbmix ? 'Rotwein/Weißwein-Mischung nicht erlaubt!' : isMix ? 'Rebsortenverschnitt' : 'Enthält bereits'}
                          </p>
                          <ul className="space-y-0.5">
                            {existing.map((c, ci) => (
                              <li key={ci} className="flex justify-between">
                                <span className={isFarbmix ? 'text-red-700' : isMix ? 'text-amber-700' : 'text-gray-700'}>
                                  {c.name}{c.rebsorte ? ` · ${c.rebsorte}` : ''}
                                </span>
                                <span className="tabular-nums text-gray-500 ml-2">
                                  {c.menge_liter != null ? c.menge_liter.toLocaleString('de-AT', { maximumFractionDigits: 1 }) + ' L' : '–'}
                                </span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {ueber && <p className="text-red-600 font-medium">Behälter hat nicht genug Kapazität</p>}
                    </div>
                  )
                })()}
              </div>
              <div className="col-span-4">
                <input type="text" inputMode="decimal" value={row.menge_liter}
                  onChange={e => updateBeh(i, 'menge_liter', e.target.value)}
                  placeholder="Liter" className={inp} />
              </div>
              <div className="col-span-2 flex justify-end">
                {behRows.length > 1 && (
                  <button type="button" onClick={() => setBehRows(r => r.filter((_, j) => j !== i))}
                    className="text-xs text-red-400 hover:text-red-600 px-1"><X size={14} /></button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Notizen */}
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">Notizen</label>
        <input type="text" value={notizen} onChange={e => setNotizen(e.target.value)}
          placeholder="z.B. Nachtlese, Botrytis teilweise …" className={inp} />
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

export default function PressungSection({ jahrgangId, pressungen, wgOptions, behOptions, waOptions, leseParzellen, verfuegbareKgByGST, behaelterMitCharge, writeOk, adminOk }: {
  jahrgangId: string; pressungen: Pressung[]
  wgOptions: WGOption[]; behOptions: BehOption[]; waOptions: WAOption[]
  leseParzellen: LeseParzelle[]; verfuegbareKgByGST: Record<string, number>
  behaelterMitCharge?: Record<string, { weinausbau_id: string; name: string; rebsorte?: string | null; menge_liter?: number | null; qualitaetsstufe?: string | null; herkunft_code?: string | null }[]>; writeOk: boolean; adminOk: boolean
}) {
  const [showForm, setShowForm]    = useState(false)
  const [editId, setEditId]        = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const [collapsed, setCollapsed]  = useState(false)

  const gesamtKg    = pressungen.flatMap(p => p.weingaerten).reduce((s, w) => s + w.trauben_kg, 0)
  const gesamtLiter = pressungen.reduce((s, p) => s + (p.most_liter_gesamt ?? 0), 0)
  const ausbeute    = gesamtKg > 0 && gesamtLiter > 0 ? (gesamtLiter / gesamtKg) * 100 : null
  const gesamtVerfuegbarKg = Object.values(verfuegbareKgByGST).reduce((s, v) => s + v, 0)

  function handleDelete(id: string) {
    if (!confirm('Pressung löschen?')) return
    startTransition(() => deletePressung(id, jahrgangId))
  }

  return (
    <div className={`card space-y-4 ${pending ? 'opacity-60 pointer-events-none' : ''}`}>
      <div className="flex items-center justify-between">
        <button type="button" onClick={() => setCollapsed(c => !c)}
          className="flex items-center gap-1.5 text-left" title={collapsed ? 'Pressungen einblenden' : 'Pressungen ausblenden'}>
          <ChevronDown size={16} className={`text-s112-muted transition-transform ${collapsed ? '-rotate-90' : ''}`} />
          <h2 className="text-base font-semibold text-gray-800">Pressungen</h2>
        </button>
        <div className="flex items-center gap-3">
          {pressungen.length > 0 && (
            <span className="text-xs text-s112-muted">
              {fmt(gesamtKg)} kg → {fmt(gesamtLiter)} L
              {ausbeute && <span className="ml-1 font-medium text-gray-700">({ausbeute.toFixed(1)} %)</span>}
            </span>
          )}
          {writeOk && !showForm && (
            gesamtVerfuegbarKg > 0
              ? <button onClick={() => { setShowForm(true); setEditId(null); setCollapsed(false) }}
                  className="inline-flex items-center gap-1.5 bg-s112-teal text-white font-semibold px-3 py-1.5 rounded-lg text-xs hover:bg-opacity-90 transition-colors shadow-sm">
                  <Plus size={14} strokeWidth={2.5} /> Pressung erfassen
                </button>
              : <span className="text-xs text-amber-600 font-medium bg-amber-50 px-3 py-1.5 rounded-lg">
                  Keine Trauben für Pressung verfügbar
                </span>
          )}
        </div>
      </div>

      {collapsed ? null : (
      <>
      {/* Saisonstatistik */}
      {pressungen.length > 0 && (
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-s112-bg rounded-xl p-3 text-center">
            <p className="text-lg font-bold text-gray-800">{fmt(gesamtKg / 1000)} t</p>
            <p className="text-xs text-s112-muted">Trauben gesamt</p>
          </div>
          <div className="bg-s112-bg rounded-xl p-3 text-center">
            <p className="text-lg font-bold text-gray-800">{fmt(gesamtLiter)} L</p>
            <p className="text-xs text-s112-muted">Most gesamt</p>
          </div>
          <div className="bg-s112-bg rounded-xl p-3 text-center">
            <p className={`text-lg font-bold ${ausbeute && ausbeute < 65 ? 'text-amber-600' : 'text-green-700'}`}>
              {ausbeute ? `${ausbeute.toFixed(1)} %` : '–'}
            </p>
            <p className="text-xs text-s112-muted">Ausbeute (FK 70 %)</p>
          </div>
        </div>
      )}

      {/* Neues Formular */}
      {showForm && !editId && (
        <PressungForm jahrgangId={jahrgangId} wgOptions={wgOptions} behOptions={behOptions}
          waOptions={waOptions} leseParzellen={leseParzellen} verfuegbareKgByGST={verfuegbareKgByGST}
          behaelterMitCharge={behaelterMitCharge} onDone={() => setShowForm(false)} />
      )}

      {/* Pressung-Liste */}
      {pressungen.length === 0 && !showForm ? (
        <div className="border border-dashed border-s112-border rounded-xl p-8 text-center text-sm text-s112-muted">
          Noch keine Pressungen erfasst.
        </div>
      ) : (
        <div className="space-y-3">
          {pressungen.map(p => {
            const pKg = p.weingaerten.reduce((s, w) => s + w.trauben_kg, 0)
            const pAusbeute = pKg > 0 && p.most_liter_gesamt ? (p.most_liter_gesamt / pKg) * 100 : null
            return (
              <div key={p.id}>
                {editId === p.id ? (
                  <PressungForm pressung={p} jahrgangId={jahrgangId} wgOptions={wgOptions}
                    behOptions={behOptions} waOptions={waOptions} leseParzellen={leseParzellen}
                    verfuegbareKgByGST={verfuegbareKgByGST} behaelterMitCharge={undefined}
                    onDone={() => setEditId(null)} />
                ) : (
                  <div className="group border border-s112-border rounded-xl p-3">
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-gray-800 text-sm">{fmtDate(p.datum)}</span>
                          {p.weinbezeichnung && (
                            <span className="bg-s112-teal/10 text-s112-teal text-xs font-semibold px-2 py-0.5 rounded-full">
                              {p.weinbezeichnung}
                            </span>
                          )}
                        </div>
                        {p.notizen && <span className="text-xs text-s112-muted">{p.notizen}</span>}
                      </div>
                      <div className="flex items-center gap-3 text-xs shrink-0">
                        <span className="text-gray-600">{fmt(pKg)} kg</span>
                        {p.most_liter_gesamt && <>
                          <span className="text-gray-400">→</span>
                          <span className="text-gray-600">{fmt(p.most_liter_gesamt)} L</span>
                          {pAusbeute && <span className={`font-semibold ${pAusbeute < 65 ? 'text-amber-600' : 'text-green-700'}`}>
                            {fmtProzent(pAusbeute)} %
                          </span>}
                        </>}
                        {p.kmw_grad != null && (
                          <span className="font-semibold text-amber-800 bg-amber-100 px-2 py-0.5 rounded-full">
                            {p.kmw_grad.toString().replace('.', ',')} °KMW
                            {' · '}{QUALITAET_LABEL[kmwZuQualitaet(p.kmw_grad)]}
                          </span>
                        )}
                        <span className="flex items-center gap-2">
                          {writeOk && <button onClick={() => setEditId(p.id)} title="Bearbeiten" aria-label="Bearbeiten" className="text-s112-teal hover:text-s112-teal/70"><Pencil size={14} /></button>}
                          {adminOk && <button onClick={() => handleDelete(p.id)} title="Löschen" aria-label="Löschen" className="text-red-400 hover:text-red-600"><Trash2 size={14} /></button>}
                        </span>
                      </div>
                    </div>

                    {/* Weingärten */}
                    {p.weingaerten.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mb-2">
                        {p.weingaerten.map(w => (
                          <span key={w.id} className="inline-flex items-center gap-1 bg-green-50 border border-green-200 text-green-800 text-xs px-2 py-0.5 rounded-full">
                            {w.weingarten_name}
                            {w.rebsorte && <span className="text-green-600">· {w.rebsorte}</span>}
                            <span className="font-medium">· {fmt(w.trauben_kg)} kg</span>
                          </span>
                        ))}
                      </div>
                    )}

                    {/* Behälter */}
                    {p.behaelter.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {p.behaelter.map(b => (
                          b.weinausbau_id ? (
                            <a key={b.id} href={`/kellerbuch/weinausbau/${b.weinausbau_id}/buch`}
                              className="inline-flex items-center gap-1 bg-blue-50 border border-blue-200 text-blue-800 text-xs px-2 py-0.5 rounded-full hover:bg-blue-100 transition-colors">
                              {b.behaelter_name ? `${b.behaelter_name} · ` : ''}{b.weinausbau_name ?? '–'}
                              {b.menge_liter && <span className="font-medium">· {fmt(b.menge_liter)} L</span>}
                              <span className="text-blue-400">→ KB</span>
                            </a>
                          ) : (
                            <span key={b.id} className="inline-flex items-center gap-1 bg-amber-50 border border-amber-200 text-amber-800 text-xs px-2 py-0.5 rounded-full">
                              {b.behaelter_name ?? '–'}
                              {b.menge_liter && <span className="font-medium">· {fmt(b.menge_liter)} L</span>}
                              <span className="text-amber-500 ml-0.5">keine Charge</span>
                            </span>
                          )
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
      </>
      )}
    </div>
  )
}
