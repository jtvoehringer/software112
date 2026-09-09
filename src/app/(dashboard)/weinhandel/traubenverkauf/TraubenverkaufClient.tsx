'use client'

import React, { useState, useTransition } from 'react'
import { Pencil, Trash2 } from 'lucide-react'
import { upsertTraubenverkauf, deleteTraubenverkauf } from './actions'
import { formatRebsorteMitKuerzel } from '@/lib/wein/bki_kuerzel'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

interface Props {
  verkaufe:     R[]
  ernteOptions: R[]   // ernte_parzellen mit weingarten, grundstueck, jahrgang joins
  zukaufOptions: R[]  // zugekaufte Trauben (zukauf_posten, art='trauben') mit verfuegbar_kg
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

export default function TraubenverkaufClient({ verkaufe, ernteOptions, zukaufOptions, kontakte, firmen, writeOk }: Props) {
  const [showForm, setShowForm]      = useState(false)
  const [editRow, setEditRow]        = useState<R | null>(null)
  const [error, setError]            = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)

  // Formular-State
  // Quelle: eigene Ernte (Ried/GST) oder zugekaufte Trauben (siehe Migration 141)
  const [quelle, setQuelle]         = useState<'ernte' | 'zukauf'>('ernte')
  const [zukaufId, setZukaufId]     = useState('')
  const [wgId, setWgId]             = useState('')
  const [gstId, setGstId]           = useState('')
  const [jahrgangId, setJahrgangId] = useState('')
  const [jahrgangNr, setJahrgangNr] = useState<number | null>(null)
  const [kmw, setKmw]               = useState('')
  const [qualitaet, setQualitaet]   = useState('')
  const [herkunft, setHerkunft]     = useState('')
  const [kaeuferTyp, setKaeuferTyp] = useState<'firma' | 'kontakt'>('firma')

  // Verfügbare kg je Zukauf-Posten, während einer Bearbeitung um die eigene
  // Zeile bereinigt (analog verfuegbareKgByWG/GST unten).
  const verfuegbarZukauf = (zId: string) => {
    const opt = zukaufOptions.find(z => z.id === zId)
    if (!opt) return 0
    const eigenerAnteil = editRow && editRow.zukauf_posten_id === zId ? Number(editRow.menge_kg ?? 0) : 0
    return Math.max(0, Number(opt.verfuegbar_kg ?? 0) + eigenerAnteil)
  }

  // Distinct Weingärten aus ernteOptions
  const wgMap = new Map<string, R>()
  for (const e of ernteOptions) {
    const wg = e.weingarten as R | null
    if (wg && !wgMap.has(wg.id)) wgMap.set(wg.id, wg)
  }
  const wgList = Array.from(wgMap.values()).sort((a, b) => a.name.localeCompare(b.name, 'de'))

  // Geerntete kg pro WG aus ernteOptions
  const ernteKgByWG: Record<string, number> = {}
  for (const e of ernteOptions) {
    const wg = e.weingarten as R | null
    if (wg) ernteKgByWG[wg.id] = (ernteKgByWG[wg.id] ?? 0) + Number(e.menge_kg ?? 0)
  }
  // Verkaufte kg pro WG aus bestehenden Verkäufen
  const verkauftKgByWG: Record<string, number> = {}
  for (const v of verkaufe) {
    if (!editRow || v.id !== editRow.id) {
      const wgId_ = v.weingarten_id as string | undefined
      if (wgId_) verkauftKgByWG[wgId_] = (verkauftKgByWG[wgId_] ?? 0) + Number(v.menge_kg ?? 0)
    }
  }
  const verfuegbareKgByWG = (wId: string) => Math.max(0, (ernteKgByWG[wId] ?? 0) - (verkauftKgByWG[wId] ?? 0))

  // Geerntete kg pro GST aus ernteOptions
  const ernteKgByGST: Record<string, number> = {}
  for (const e of ernteOptions) {
    const gst = e.grundstueck as R | null
    if (gst) ernteKgByGST[gst.id] = (ernteKgByGST[gst.id] ?? 0) + Number(e.menge_kg ?? 0)
  }
  // Verkaufte kg pro GST aus bestehenden Verkäufen
  const verkauftKgByGST: Record<string, number> = {}
  for (const v of verkaufe) {
    if (!editRow || v.id !== editRow.id) {
      const gId = v.grundstueck_id as string | undefined
      if (gId) verkauftKgByGST[gId] = (verkauftKgByGST[gId] ?? 0) + Number(v.menge_kg ?? 0)
    }
  }
  const verfuegbareKgByGST = (gId: string) => Math.max(0, (ernteKgByGST[gId] ?? 0) - (verkauftKgByGST[gId] ?? 0))

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
    setEditRow(null); setQuelle('ernte'); setZukaufId('')
    setWgId(''); setGstId(''); setJahrgangId(''); setJahrgangNr(null)
    setKmw(''); setQualitaet(''); setHerkunft(''); setKaeuferTyp('firma')
    setError(null); setShowForm(true)
  }

  function openEdit(v: R) {
    setEditRow(v)
    const wg  = v.weingarten as R | null
    const gst = v.grundstueck as R | null
    const jg  = v.jahrgang as R | null
    setQuelle(v.zukauf_posten_id ? 'zukauf' : 'ernte')
    setZukaufId(v.zukauf_posten_id ?? '')
    setWgId(wg?.id ?? ''); setGstId(gst?.id ?? '')
    setJahrgangId(jg?.id ?? ''); setJahrgangNr(jg?.jahrgang ?? null)
    setKmw(v.kmw_grad != null ? String(v.kmw_grad).replace('.', ',') : '')
    setQualitaet(v.qualitaetsstufe ?? ''); setHerkunft(v.herkunft_code ?? '')
    setKaeuferTyp(v.firma_id ? 'firma' : 'kontakt')
    setError(null); setShowForm(true)
  }

  function handleZukaufChange(newZukaufId: string) {
    setZukaufId(newZukaufId)
    const opt = zukaufOptions.find(z => z.id === newZukaufId)
    if (opt) {
      setHerkunft(opt.herkunft ?? '')
    }
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); setError(null)
    const fd = new FormData(e.currentTarget)
    fd.set('herkunft_code', herkunft)
    fd.set('jahrgang_id', jahrgangId)
    if (quelle === 'zukauf') {
      fd.set('weingarten_id', '')
      fd.set('grundstueck_id', '')
      fd.set('zukauf_posten_id', zukaufId)
    } else {
      fd.set('weingarten_id', wgId)
      fd.set('grundstueck_id', gstId)
      fd.set('zukauf_posten_id', '')
    }
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
  const btnToggle = (active: boolean) => `px-3 py-1 text-xs rounded-lg font-medium transition-colors ${active ? 'bg-s112-teal text-white' : 'bg-s112-bg border border-s112-border text-s112-text-2 hover:border-s112-teal'}`

  return (
    <div className={`space-y-6 ${isPending ? 'opacity-60 pointer-events-none' : ''}`}>

      {/* Aktions-Leiste */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          {verkaufe.length > 0 && (
            <>
              <span className="text-sm text-s112-muted">{sumKg.toLocaleString('de-AT')} kg gesamt</span>
              {sumEur > 0 && (
                <span className="text-sm font-semibold text-s112-text">
                  {'·'} {'€'} {sumEur.toLocaleString('de-AT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
              )}
            </>
          )}
        </div>
        <div className="flex items-center gap-3">
          {verkaufe.length > 0 && (
            <button onClick={handleCSV} className="text-xs bg-[#F2F3F5] hover:bg-s112-line text-s112-text-2 font-medium px-3 py-1.5 rounded-lg transition-colors">
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
          <h2 className="text-sm font-semibold text-s112-text mb-4">
            {editRow ? 'Traubenverkauf bearbeiten' : 'Neuer Traubenverkauf'}
          </h2>
          {error && (
            <div className="mb-3 bg-s112-err-bg border border-s112-err/30 text-s112-err-fg rounded-lg px-3 py-2 text-xs">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {editRow && <input type="hidden" name="existing_id" value={editRow.id} />}
            <input type="hidden" name="weingarten_id" value={wgId} />
            <input type="hidden" name="zukauf_posten_id" value={zukaufId} />

            {/* Quelle */}
            <div>
              <label className="block text-xs font-medium text-s112-text-2 mb-2">Quelle</label>
              <div className="flex gap-2">
                <button type="button" onClick={() => setQuelle('ernte')} className={btnToggle(quelle === 'ernte')}>
                  Eigene Ernte
                </button>
                <button type="button" onClick={() => setQuelle('zukauf')} className={btnToggle(quelle === 'zukauf')}>
                  Zukauf
                </button>
              </div>
            </div>

            {quelle === 'zukauf' ? (
              <div>
                <label className="block text-xs font-medium text-s112-text-2 mb-1">Zukauf-Posten *</label>
                <select value={zukaufId} onChange={e => handleZukaufChange(e.target.value)} required className={inp}>
                  <option value="">– Zukauf wählen –</option>
                  {zukaufOptions.map(z => (
                    <option key={z.id} value={z.id}>
                      {fmtDate(z.datum)}{z.rebsorte ? ' · ' + formatRebsorteMitKuerzel(z.rebsorte) : ''}{' · '}{z.lieferant}
                      {' – '}{verfuegbarZukauf(z.id).toLocaleString('de-AT', { maximumFractionDigits: 0 })} kg verf.
                    </option>
                  ))}
                </select>
                {zukaufOptions.length === 0 && (
                  <p className="text-xs text-s112-warn-fg mt-1">Keine zugekauften Trauben vorhanden.</p>
                )}
                {zukaufId && (
                  <p className="text-xs text-s112-muted mt-1">
                    Verfügbar: <span className="font-medium text-s112-text-1">{verfuegbarZukauf(zukaufId).toLocaleString('de-AT', { maximumFractionDigits: 0 })} kg</span>
                  </p>
                )}
              </div>
            ) : (
            <div className="grid grid-cols-2 gap-3">

              {/* Ried */}
              <div>
                <label className="block text-xs font-medium text-s112-text-2 mb-1">Ried *</label>
                <select value={wgId} onChange={e => handleWgChange(e.target.value)} required className={inp}>
                  <option value="">– Ried wählen –</option>
                  {wgList.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                </select>
                {ernteOptions.length === 0 && (
                  <p className="text-xs text-s112-warn-fg mt-1">Noch keine Ernte vorhanden.</p>
                )}
                {wgId && (
                  <p className="text-xs text-s112-muted mt-1">
                    Verfügbar: <span className="font-medium text-s112-text-1">{verfuegbareKgByWG(wgId).toLocaleString('de-AT', { maximumFractionDigits: 0 })} kg</span>
                  </p>
                )}
              </div>

              {/* GST */}
              <div>
                <label className="block text-xs font-medium text-s112-text-2 mb-1">Grundstück (GST)</label>
                <select value={gstId} onChange={e => handleGstChange(e.target.value)} disabled={!wgId || gstList.length === 0} className={inp}>
                  <option value="">– gesamt (alle GST) –</option>
                  {gstList.map(g => (
                    <option key={g.id} value={g.id}>
                      {'GST ' + g.gst_nr + (g.rebsorte ? ' – ' + formatRebsorteMitKuerzel(g.rebsorte) : '')}
                    </option>
                  ))}
                </select>
                {gstId && (
                  <p className="text-xs text-s112-muted mt-1">
                    Verfügbar: <span className="font-medium text-s112-text-1">{verfuegbareKgByGST(gstId).toLocaleString('de-AT', { maximumFractionDigits: 0 })} kg</span>
                  </p>
                )}
              </div>
            </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              {/* Jahrgang (abgeleitet) */}
              {jahrgangNr && (
                <div>
                  <label className="block text-xs font-medium text-s112-text-2 mb-1">Jahrgang (abgeleitet)</label>
                  <div className={inp + ' bg-s112-bg text-s112-text-2 cursor-not-allowed'}>{jahrgangNr}</div>
                </div>
              )}

              {/* Lieferdatum */}
              <div>
                <label className="block text-xs font-medium text-s112-text-2 mb-1">Lieferdatum *</label>
                <input name="datum" type="date" required
                  defaultValue={editRow?.datum ?? new Date().toISOString().split('T')[0]}
                  className={inp} />
              </div>

              {/* Menge */}
              <div>
                <label className="block text-xs font-medium text-s112-text-2 mb-1">Menge (kg) *</label>
                <input name="menge_kg" type="text" inputMode="decimal" required
                  defaultValue={editRow?.menge_kg ?? ''} placeholder="z.B. 1.250" className={inp} />
              </div>

              {/* Preis */}
              <div>
                <label className="block text-xs font-medium text-s112-text-2 mb-1">Preis (EUR/kg)</label>
                <input name="preis_per_kg" type="text" inputMode="decimal"
                  defaultValue={editRow?.preis_per_kg ?? ''} placeholder="z.B. 0,65" className={inp} />
              </div>

              {/* KMW */}
              <div>
                <label className="block text-xs font-medium text-s112-text-2 mb-1">KMW Grad</label>
                <input name="klosterneuburger" type="text" inputMode="decimal"
                  value={kmw} onChange={e => setKmw(e.target.value)}
                  placeholder="z.B. 17,5" className={inp} />
              </div>

              {/* Qualität */}
              <div>
                <label className="block text-xs font-medium text-s112-text-2 mb-1">Qualitätsstufe</label>
                <select name="qualitaetsstufe" value={qualitaet} onChange={e => setQualitaet(e.target.value)} className={inp}>
                  <option value="">– keine –</option>
                  {QUALITAETEN.map(q => <option key={q.value} value={q.value}>{q.label}</option>)}
                </select>
              </div>

              {/* Gesundheit */}
              <div>
                <label className="block text-xs font-medium text-s112-text-2 mb-1">Traubengesundheit</label>
                <select name="gesundheit" defaultValue={editRow?.gesundheit ?? 'G'} className={inp}>
                  <option value="G">G – Gut (Standard)</option>
                  <option value="K">K – Krank / beschädigt</option>
                </select>
              </div>

              {/* Herkunft-Code */}
              {herkunft && (
                <div>
                  <label className="block text-xs font-medium text-s112-text-2 mb-1">Herkunft-Code (BKI)</label>
                  <div className={inp + ' bg-s112-bg text-s112-text-2 cursor-not-allowed'}>{herkunft}</div>
                </div>
              )}

            </div>

            {/* Käufer */}
            <div>
              <label className="block text-xs font-medium text-s112-text-2 mb-2">Käufer</label>
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
              <label className="block text-xs font-medium text-s112-text-2 mb-1">Notizen</label>
              <input name="notizen" type="text" defaultValue={editRow?.notizen ?? ''} placeholder="optional" className={inp} />
            </div>

            <div className="flex gap-2 pt-1">
              <button type="submit" disabled={isPending || (quelle === 'ernte' ? !wgId : !zukaufId)}
                className="bg-s112-teal text-white px-4 py-1.5 rounded-lg text-sm font-medium hover:bg-opacity-90 disabled:opacity-50 transition-colors">
                {isPending ? 'Speichert…' : 'Speichern'}
              </button>
              <button type="button" onClick={() => { setShowForm(false); setEditRow(null) }}
                className="px-4 py-1.5 text-sm text-s112-text-2 hover:text-s112-text">
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
            // Quelle-Label: eigener Weingarten ODER zugekaufter Posten (Migration 141)
            const zukaufPosten = v.zukauf_posten_id
              ? zukaufOptions.find(z => z.id === v.zukauf_posten_id)
              : null
            const quelleLabel = wg?.name
              ?? (zukaufPosten
                    ? `Zukauf – ${zukaufPosten.rebsorte ? formatRebsorteMitKuerzel(zukaufPosten.rebsorte) : '–'}${zukaufPosten.lieferant ? ' (' + zukaufPosten.lieferant + ')' : ''}`
                    : (v.zukauf_posten_id ? 'Zukauf' : '–'))
            return (
              <div key={v.id} className="group card">
                {deleteConfirm === v.id ? (
                  <div className="flex items-center justify-between">
                    <p className="text-sm text-s112-err-fg font-medium">Traubenverkauf wirklich löschen?</p>
                    <div className="flex gap-2">
                      <button onClick={() => handleDelete(v.id)} className="text-xs bg-s112-err text-white px-3 py-1 rounded-lg hover:bg-s112-err-fg">
                        Ja, löschen
                      </button>
                      <button onClick={() => setDeleteConfirm(null)} className="text-xs text-s112-text-2 px-3 py-1 rounded-lg hover:bg-[#F2F3F5]">
                        Abbrechen
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-start justify-between gap-2">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        {v.liefernummer && (
                          <span className="font-mono text-xs bg-s112-teal/10 text-s112-blue-700 px-2 py-0.5 rounded-full font-semibold">
                            {v.liefernummer}
                          </span>
                        )}
                        <span className="font-medium text-s112-text text-sm">{fmtDate(v.datum)}</span>
                        <span className="text-sm text-s112-text-1">{'·'} {quelleLabel}</span>
                        {gst && (
                          <span className="text-xs font-mono text-s112-muted bg-s112-bg px-1.5 py-0.5 rounded">
                            GST {gst.gst_nr}
                          </span>
                        )}
                        {jg && <span className="text-xs text-s112-muted">JG {jg.jahrgang}</span>}
                        {v.gesundheit === 'K' && (
                          <span className="text-xs bg-s112-warn-bg text-s112-warn-fg px-2 py-0.5 rounded-full font-medium">
                            K {'–'} Krank
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 text-xs text-s112-muted flex-wrap">
                        <span className="font-semibold text-s112-text-1">{fmt(v.menge_kg, 0)} kg</span>
                        {v.preis_per_kg != null && (
                          <span>
                            {'·'} EUR {fmt(v.preis_per_kg)}/kg{' '}
                            <span className="font-medium text-s112-text-1">
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
                        <button onClick={() => openEdit(v)} title="Bearbeiten" aria-label="Bearbeiten" className="text-s112-blue-700 hover:text-s112-blue-700/70">
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button onClick={() => setDeleteConfirm(v.id)} title="Löschen" aria-label="Löschen" className="text-s112-err hover:text-s112-err-fg">
                          <Trash2 className="w-4 h-4" />
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
