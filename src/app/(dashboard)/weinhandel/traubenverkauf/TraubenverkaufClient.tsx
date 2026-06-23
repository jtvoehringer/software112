'use client'

import React, { useState, useTransition } from 'react'
import { upsertTraubenverkauf, deleteTraubenverkauf } from './actions'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

interface Props {
  verkaufe:     R[]
  ernteOptions: R[]   // ernte_parzellen mit weingarten, grundstueck, jahrgang joins
  kontakte:     R[]
  firmen:       R[]
  writeOk:      boolean
}

const QUALITAETEN = [
  { value: 'landwein',             label: 'Landwein' },
  { value: 'qualitaetswein',       label: 'Qualitätswein' },
  { value: 'kabinett',             label: 'Kabinett' },
  { value: 'spaetlese',            label: 'Spätlese' },
  { value: 'auslese',              label: 'Auslese' },
  { value: 'beerenauslese',        label: 'Beerenauslese' },
  { value: 'trockenbeerenauslese', label: 'Trockenbeerenauslese' },
  { value: 'eiswein',              label: 'Eiswein' },
  { value: 'dac',                  label: 'DAC' },
]

function fmtDate(d: string) {
  return new Date(d).toLocaleDateString('de-AT', { day: '2-digit', month: '2-digit', year: 'numeric' })
}
function fmt(n: number | null | undefined, digits = 2) {
  if (n == null) return '–'
  return n.toLocaleString('de-AT', { minimumFractionDigits: digits, maximumFractionDigits: digits })
}

export default function TraubenverkaufClient({ verkaufe, ernteOptions, kontakte, firmen, writeOk }: Props) {
  const [showForm, setShowForm]      = useState(false)
  const [editRow, setEditRow]        = useState<R | null>(null)
  const [error, setError]            = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)

  // Formular-State
  const [wgId, setWgId]             = useState('')
  const [gstId, setGstId]           = useState('')
  const [jahrgangId, setJahrgangId] = useState('')
  const [jahrgangNr, setJahrgangNr] = useState<number | null>(null)
  const [kmw, setKmw]               = useState('')
  const [qualitaet, setQualitaet]   = useState('')
  const [herkunft, setHerkunft]     = useState('')
  const [kaeuferTyp, setKaeuferTyp] = useState<'firma' | 'kontakt'>('firma')

  // Distinct Weingärten aus ernteOptions
  const wgMap = new Map<string, R>()
  for (const e of ernteOptions) {
    const wg = e.weingarten as R | null
    if (wg && !wgMap.has(wg.id)) wgMap.set(wg.id, wg)
  }
  const wgList = Array.from(wgMap.values()).sort((a, b) => a.name.localeCompare(b.name, 'de'))

  // GSTs für gewählte Ried
  const gstList: R[] = []
  const seenGst = new Set<string>()
  for (const e of ernteOptions) {
    const wg  = e.weingarten as R | null
    const gst = e.grundstueck as R | null
    if (wg?.id === wgId && gst && !seenGst.has(gst.id)) {
      seenGst.add(gst.id)
      gstList.push(gst)
    }
  }
  gstList.sort((a, b) => (a.gst_nr ?? '').localeCompare(b.gst_nr ?? '', 'de', { numeric: true }))

  function fillFromErnte(newWgId: string, newGstId: string) {
    const match = ernteOptions.find(e => {
      const wg  = e.weingarten as R | null
      const gst = e.grundstueck as R | null
      if (wg?.id !== newWgId) return false
      if (newGstId && gst?.id !== newGstId) return false
      if (!newGstId && gst != null) return false
      return true
    }) ?? ernteOptions.find(e => (e.weingarten as R | null)?.id === newWgId)
    if (match) {
      if (match.klosterneuburger != null) setKmw(String(match.klosterneuburger).replace('.', ','))
      if (match.qualitaetsstufe) setQualitaet(match.qualitaetsstufe)
      const jg = match.jahrgang as R | null
      if (jg) { setJahrgangId(jg.id); setJahrgangNr(jg.jahrgang) }
      const wg  = match.weingarten as R | null
      const gst = match.grundstueck as R | null
      setHerkunft((gst as R | null)?.trauben_herkunft_code ?? wg?.trauben_herkunft_code ?? '')
    }
  }

  function handleWgChange(newWgId: string) {
    setWgId(newWgId); setGstId('')
    if (newWgId) fillFromErnte(newWgId, '')
    else { setKmw(''); setQualitaet(''); setJahrgangId(''); setJahrgangNr(null); setHerkunft('') }
  }

  function handleGstChange(newGstId: string) {
    setGstId(newGstId)
    if (wgId) fillFromErnte(wgId, newGstId)
  }

  function openNew() {
    setEditRow(null); setWgId(''); setGstId(''); setJahrgangId(''); setJahrgangNr(null)
    setKmw(''); setQualitaet(''); setHerkunft(''); setKaeuferTyp('firma')
    setError(null); setShowForm(true)
  }

  function openEdit(v: R) {
    setEditRow(v)
    const wg  = v.weingarten as R | null
    const gst = v.grundstueck as R | null
    const jg  = v.jahrgang as R | null
    setWgId(wg?.id ?? ''); setGstId(gst?.id ?? '')
    setJahrgangId(jg?.id ?? ''); setJahrgangNr(jg?.jahrgang ?? null)
    setKmw(v.kmw_grad != null ? String(v.kmw_grad).replace('.', ',') : '')
    setQualitaet(v.qualitaetsstufe ?? ''); setHerkunft(v.herkunft_code ?? '')
    setKaeuferTyp(v.firma_id ? 'firma' : 'kontakt')
    setError(null); setShowForm(true)
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); setError(null)
    const fd = new FormData(e.currentTarget)
    fd.set('herkunft_code', herkunft)
    fd.set('jahrgang_id', jahrgangId)
    fd.set('grundstueck_id', gstId)
    if (kaeuferTyp === 'kontakt') fd.set('firma_id', '')
    else fd.set('kontakt_id', '')
    startTransition(async () => {
      try {
        await upsertTraubenverkauf(fd)
        setShowForm(false); setEditRow(null)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unbekannter Fehler')
      }
    })
  }

  function handleDelete(id: string) {
    startTransition(async () => {
      try { await deleteTraubenverkauf(id); setDeleteConfirm(null) }
      catch (err) { setError(err instanceof Error ? err.message : 'Fehler beim Löschen') }
    })
  }

  function handleCSV() {
    const BOM = '﻿'
    const headers = ['Liefernummer','Datum','Ried','GST','Jahrgang','Menge kg','Preis EUR/kg','KMW Grad','Qualitaet','Gesundheit','Herkunftscode','Kaeufer','Notizen']
    const rows: string[][] = [headers]
    for (const v of verkaufe) {
      const wg  = v.weingarten as R | null
      const gst = v.grundstueck as R | null
      const jg  = v.jahrgang as R | null
      const kaeufer = (v.firma as R | null)?.name ??
        ([(v.kontakt as R | null)?.vorname, (v.kontakt as R | null)?.nachname].filter(Boolean).join(' ') || '')
      rows.push([
        v.liefernummer ?? '', fmtDate(v.datum),
        wg?.name ?? '', gst?.gst_nr ?? '', jg?.jahrgang ?? '',
        String(v.menge_kg).replace('.', ','),
        v.preis_per_kg != null ? String(v.preis_per_kg).replace('.', ',') : '',
        v.kmw_grad != null ? String(v.kmw_grad).replace('.', ',') : '',
        v.qualitaetsstufe ?? '', v.gesundheit ?? '', v.herkunft_code ?? '', kaeufer, v.notizen ?? '',
      ])
    }
    const csv = rows.map(r => r.map(c => '"' + String(c).replace(/"/g, '""') + '"').join(';')).join('\r\n')
    const blob = new Blob([BOM + csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = 'traubenverkauf.csv'; a.click()
    URL.revokeObjectURL(url)
  }

  const sumKg  = verkaufe.reduce((s, v) => s + Number(v.menge_kg ?? 0), 0)
  const sumEur = verkaufe.reduce((s, v) => v.preis_per_kg != null ? s + Number(v.menge_kg) * Number(v.preis_per_kg) : s, 0)
  const inp = 'w-full border border-s112-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40 bg-white'
  const btnToggle = (active: boolean) => `px-3 py-1 text-xs rounded-lg font-medium transition-colors ${active ? 'bg-s112-teal text-white' : 'bg-s112-bg border border-s112-border text-gray-600 hover:border-s112-teal'}`

  return (
    <div className={`space-y-6 ${isPending ? 'opacity-60 pointer-events-none' : ''}`}>

      {/* Aktions-Leiste */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          {verkaufe.length > 0 && (
            <>
              <span className="text-sm text-s112-muted">{sumKg.toLocaleString('de-AT')} kg gesamt</span>
              {sumEur > 0 && (
                <span className="text-sm font-semibold text-gray-800">
                  {'·'} {'€'} {sumEur.toLocaleString('de-AT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
              )}
            </>
          )}
        </div>
        <div className="flex items-center gap-3">
          {verkaufe.length > 0 && (
            <button onClick={handleCSV} className="text-xs bg-gray-100 hover:bg-gray-200 text-gray-600 font-medium px-3 py-1.5 rounded-lg transition-colors">
              CSV exportieren
            </button>
          )}
          {writeOk && !showForm && (
            <button onClick={openNew} className="bg-s112-teal text-white px-4 py-1.5 rounded-lg text-sm font-semibold hover:bg-opacity-90 transition-colors">
              + Traubenverkauf
            </button>
          )}
        </div>
      </div>

      {/* Formular */}
      {showForm && writeOk && (
        <div className="card border-2 border-s112-teal/30">
          <h2 className="text-sm font-semibold text-gray-800 mb-4">
            {editRow ? 'Traubenverkauf bearbeiten' : 'Neuer Traubenverkauf'}
          </h2>
          {error && (
            <div className="mb-3 bg-red-50 border border-red-200 text-red-700 rounded-lg px-3 py-2 text-xs">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {editRow && <input type="hidden" name="existing_id" value={editRow.id} />}
            <input type="hidden" name="weingarten_id" value={wgId} />

            <div className="grid grid-cols-2 gap-3">

              {/* Ried */}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Ried *</label>
                <select value={wgId} onChange={e => handleWgChange(e.target.value)} required className={inp}>
                  <option value="">– Ried wählen –</option>
                  {wgList.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                </select>
                {ernteOptions.length === 0 && (
                  <p className="text-xs text-amber-600 mt-1">Noch keine Ernte vorhanden.</p>
                )}
              </div>

              {/* GST */}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Grundstück (GST)</label>
                <select value={gstId} onChange={e => handleGstChange(e.target.value)} disabled={!wgId || gstList.length === 0} className={inp}>
                  <option value="">– gesamt (alle GST) –</option>
                  {gstList.map(g => (
                    <option key={g.id} value={g.id}>
                      {'GST ' + g.gst_nr + (g.rebsorte ? ' – ' + g.rebsorte : '')}
                    </option>
                  ))}
                </select>
              </div>

              {/* Jahrgang (abgeleitet) */}
              {jahrgangNr && (
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Jahrgang (abgeleitet)</label>
                  <div className={inp + ' bg-s112-bg text-gray-500 cursor-not-allowed'}>{jahrgangNr}</div>
                </div>
              )}

              {/* Lieferdatum */}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Lieferdatum *</label>
                <input name="datum" type="date" required
                  defaultValue={editRow?.datum ?? new Date().toISOString().split('T')[0]}
                  className={inp} />
              </div>

              {/* Menge */}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Menge (kg) *</label>
                <input name="menge_kg" type="text" inputMode="decimal" required
                  defaultValue={editRow?.menge_kg ?? ''} placeholder="z.B. 1.250" className={inp} />
              </div>

              {/* Preis */}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Preis (EUR/kg)</label>
                <input name="preis_per_kg" type="text" inputMode="decimal"
                  defaultValue={editRow?.preis_per_kg ?? ''} placeholder="z.B. 0,65" className={inp} />
              </div>

              {/* KMW */}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">KMW Grad</label>
                <input name="klosterneuburger" type="text" inputMode="decimal"
                  value={kmw} onChange={e => setKmw(e.target.value)}
                  placeholder="z.B. 17,5" className={inp} />
              </div>

              {/* Qualität */}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Qualitätsstufe</label>
                <select name="qualitaetsstufe" value={qualitaet} onChange={e => setQualitaet(e.target.value)} className={inp}>
                  <option value="">– keine –</option>
                  {QUALITAETEN.map(q => <option key={q.value} value={q.value}>{q.label}</option>)}
                </select>
              </div>

              {/* Gesundheit */}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Traubengesundheit</label>
                <select name="gesundheit" defaultValue={editRow?.gesundheit ?? 'G'} className={inp}>
                  <option value="G">G – Gut (Standard)</option>
                  <option value="K">K – Krank / beschädigt</option>
                </select>
              </div>

              {/* Herkunft-Code */}
              {herkunft && (
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Herkunft-Code (BKI)</label>
                  <div className={inp + ' bg-s112-bg text-gray-500 cursor-not-allowed'}>{herkunft}</div>
                </div>
              )}

            </div>

            {/* Käufer */}
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-2">Käufer</label>
              <div className="flex gap-2 mb-2">
                <button type="button" onClick={() => setKaeuferTyp('firma')} className={btnToggle(kaeuferTyp === 'firma')}>
                  Firma
                </button>
                <button type="button" onClick={() => setKaeuferTyp('kontakt')} className={btnToggle(kaeuferTyp === 'kontakt')}>
                  Privatperson
                </button>
              </div>
              {kaeuferTyp === 'firma' ? (
                <select name="firma_id" defaultValue={editRow?.firma_id ?? ''} className={inp}>
                  <option value="">– Firma wählen –</option>
                  {firmen.map(f => (
                    <option key={f.id} value={f.id}>
                      {f.name}{f.betrieb_nr ? ' (Betr.Nr. ' + f.betrieb_nr + ')' : ''}
                    </option>
                  ))}
                </select>
              ) : (
                <select name="kontakt_id" defaultValue={editRow?.kontakt_id ?? ''} className={inp}>
                  <option value="">– Kontakt wählen –</option>
                  {kontakte.map(k => (
                    <option key={k.id} value={k.id}>
                      {k.vorname} {k.nachname}{k.betrieb_nr ? ' (Betr.Nr. ' + k.betrieb_nr + ')' : ''}
                    </option>
                  ))}
                </select>
              )}
            </div>

            {/* Notizen */}
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Notizen</label>
              <input name="notizen" type="text" defaultValue={editRow?.notizen ?? ''} placeholder="optional" className={inp} />
            </div>

            <div className="flex gap-2 pt-1">
              <button type="submit" disabled={isPending || !wgId}
                className="bg-s112-teal text-white px-4 py-1.5 rounded-lg text-sm font-medium hover:bg-opacity-90 disabled:opacity-50 transition-colors">
                {isPending ? 'Speichert…' : 'Speichern'}
              </button>
              <button type="button" onClick={() => { setShowForm(false); setEditRow(null) }}
                className="px-4 py-1.5 text-sm text-gray-600 hover:text-gray-800">
                Abbrechen
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Liste */}
      {verkaufe.length === 0 && !showForm ? (
        <div className="card text-center py-10 text-s112-muted text-sm">
          Noch keine Traubenverkäufe erfasst.
        </div>
      ) : (
        <div className="space-y-2">
          {verkaufe.map(v => {
            const wg     = v.weingarten as R | null
            const gst    = v.grundstueck as R | null
            const jg     = v.jahrgang as R | null
            const firma  = v.firma as R | null
            const kontkt = v.kontakt as R | null
            const kaeufer = firma?.name ?? ([kontkt?.vorname, kontkt?.nachname].filter(Boolean).join(' ') || '–')
            return (
              <div key={v.id} className="card">
                {deleteConfirm === v.id ? (
                  <div className="flex items-center justify-between">
                    <p className="text-sm text-red-700 font-medium">Traubenverkauf wirklich löschen?</p>
                    <div className="flex gap-2">
                      <button onClick={() => handleDelete(v.id)} className="text-xs bg-red-600 text-white px-3 py-1 rounded-lg hover:bg-red-700">
                        Ja, löschen
                      </button>
                      <button onClick={() => setDeleteConfirm(null)} className="text-xs text-gray-600 px-3 py-1 rounded-lg hover:bg-gray-100">
                        Abbrechen
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-start justify-between gap-2">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        {v.liefernummer && (
                          <span className="font-mono text-xs bg-s112-teal/10 text-s112-teal px-2 py-0.5 rounded-full font-semibold">
                            {v.liefernummer}
                          </span>
                        )}
                        <span className="font-medium text-gray-800 text-sm">{fmtDate(v.datum)}</span>
                        <span className="text-sm text-gray-700">{'·'} {wg?.name ?? '–'}</span>
                        {gst && (
                          <span className="text-xs font-mono text-s112-muted bg-s112-bg px-1.5 py-0.5 rounded">
                            GST {gst.gst_nr}
                          </span>
                        )}
                        {jg && <span className="text-xs text-s112-muted">JG {jg.jahrgang}</span>}
                        {v.gesundheit === 'K' && (
                          <span className="text-xs bg-orange-100 text-orange-700 px-2 py-0.5 rounded-full font-medium">
                            K {'–'} Krank
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 text-xs text-s112-muted flex-wrap">
                        <span className="font-semibold text-gray-700">{fmt(v.menge_kg, 0)} kg</span>
                        {v.preis_per_kg != null && (
                          <span>
                            {'·'} EUR {fmt(v.preis_per_kg)}/kg{' '}
                            <span className="font-medium text-gray-700">
                              = EUR {fmt(Number(v.menge_kg) * Number(v.preis_per_kg), 2)}
                            </span>
                          </span>
                        )}
                        {v.kmw_grad != null && <span>{'·'} {fmt(v.kmw_grad)} KMW Grad</span>}
                        {v.qualitaetsstufe && <span>{'·'} {v.qualitaetsstufe}</span>}
                        {v.herkunft_code && <span className="font-mono">{'·'} {v.herkunft_code}</span>}
                        <span>{'·'} {kaeufer}</span>
                        {v.notizen && <span className="italic">{'·'} {v.notizen}</span>}
                      </div>
                    </div>
                    {writeOk && (
                      <div className="flex items-center gap-2 shrink-0 text-xs">
                        <button onClick={() => openEdit(v)} className="text-s112-teal hover:underline">
                          Bearb.
                        </button>
                        <button onClick={() => setDeleteConfirm(v.id)} className="text-red-400 hover:text-red-600">
                          Löschen
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
