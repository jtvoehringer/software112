'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { createAktivitaet, createPipelineEintrag, toggleAktivitaetErledigt } from '../../actions'
import {
  SEGMENTE, AKTIVITAET_ARTEN, PIPELINE_STUFEN,
  segmentLabel, segmentFarbe, fmtUhrzeit,
} from '@/lib/crm/types'
import type { KontaktRow, AktivitaetRow, PipelineEintragRow } from '@/lib/crm/types'

function inputCls() {
  return 'w-full border border-s112-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40'
}

function AktivitaetForm({ kontaktId, onDone }: { kontaktId: string; onDone: () => void }) {
  const [pending, startTransition] = useTransition()
  const [ganztags, setGanztags] = useState(true)

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    fd.set('kontakt_id', kontaktId)
    fd.set('ganztags', ganztags ? 'true' : 'false')
    startTransition(async () => { await createAktivitaet(fd); onDone() })
  }

  return (
    <form onSubmit={handleSubmit} className="p-3 bg-white border border-s112-border rounded-lg space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <select name="art" defaultValue="notiz" required className={inputCls()}>
          {AKTIVITAET_ARTEN.map(a => <option key={a.value} value={a.value}>{a.icon} {a.label}</option>)}
        </select>
        <input name="datum" type="date" defaultValue={new Date().toISOString().split('T')[0]}
          required className={inputCls()} />
      </div>
      <div className="flex items-center gap-3 flex-wrap">
        <label className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer select-none shrink-0">
          <input type="checkbox" checked={ganztags} onChange={e => setGanztags(e.target.checked)} className="rounded" />
          Ganztags
        </label>
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-400">Von</span>
          <input name="uhrzeit_von" type="time" step="1800" disabled={ganztags}
            className={`border border-s112-border rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40 ${ganztags ? 'opacity-30 cursor-not-allowed bg-gray-50' : ''}`} />
          <span className="text-xs text-gray-400">-</span>
          <input name="uhrzeit_bis" type="time" step="1800" disabled={ganztags}
            className={`border border-s112-border rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40 ${ganztags ? 'opacity-30 cursor-not-allowed bg-gray-50' : ''}`} />
        </div>
      </div>
      <input name="betreff" placeholder="Betreff *" required className={inputCls()} />
      <textarea name="beschreibung" placeholder="Beschreibung (optional)" rows={2}
        className={inputCls() + ' resize-none'} />
      <div className="flex gap-2">
        <button type="submit" disabled={pending}
          className="bg-s112-teal text-white px-3 py-1 rounded-lg text-xs font-medium disabled:opacity-40">
          {pending ? '...' : 'Eintragen'}
        </button>
        <button type="button" onClick={onDone} className="text-xs text-gray-500 hover:text-gray-700">Abbrechen</button>
      </div>
    </form>
  )
}

function PipelineForm({ kontaktId, onDone }: { kontaktId: string; onDone: () => void }) {
  const [pending, startTransition] = useTransition()
  const [ganztags, setGanztags] = useState(true)

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    fd.set('kontakt_id', kontaktId)
    fd.set('ganztags', ganztags ? 'true' : 'false')
    startTransition(async () => { await createPipelineEintrag(fd); onDone() })
  }

  return (
    <form onSubmit={handleSubmit} className="p-3 bg-white border border-s112-border rounded-lg space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <select name="stufe" defaultValue="interessent" required className={inputCls()}>
          {PIPELINE_STUFEN.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
        <input name="titel" placeholder="Titel *" required className={inputCls()} />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <input name="wert_euro" type="number" step="0.01" placeholder="Wert (optional)" className={inputCls()} />
        <input name="wahrscheinlichkeit" type="number" min="0" max="100" placeholder="Wahrsch. % (optional)" className={inputCls()} />
      </div>
      <div className="flex items-center gap-3 flex-wrap">
        <label className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer select-none shrink-0">
          <input type="checkbox" checked={ganztags} onChange={e => setGanztags(e.target.checked)} className="rounded" />
          Ganztags
        </label>
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-400">Von</span>
          <input name="uhrzeit_von" type="time" step="1800" disabled={ganztags}
            className={`border border-s112-border rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40 ${ganztags ? 'opacity-30 cursor-not-allowed bg-gray-50' : ''}`} />
          <span className="text-xs text-gray-400">–</span>
          <input name="uhrzeit_bis" type="time" step="1800" disabled={ganztags}
            className={`border border-s112-border rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40 ${ganztags ? 'opacity-30 cursor-not-allowed bg-gray-50' : ''}`} />
        </div>
      </div>
      <div className="flex gap-2">
        <button type="submit" disabled={pending}
          className="bg-s112-teal text-white px-3 py-1 rounded-lg text-xs font-medium disabled:opacity-40">
          {pending ? '...' : 'Eintragen'}
        </button>
        <button type="button" onClick={onDone} className="text-xs text-gray-500 hover:text-gray-700">Abbrechen</button>
      </div>
    </form>
  )
}

function AktivitaetKarte({ a, writeOk }: { a: AktivitaetRow; writeOk: boolean }) {
  const [pending, startTransition] = useTransition()
  const artDef = AKTIVITAET_ARTEN.find(x => x.value === a.art)
  const von = fmtUhrzeit(a.uhrzeit_von)
  const bis = fmtUhrzeit(a.uhrzeit_bis)

  function handleErledigt() {
    startTransition(async () => { await toggleAktivitaetErledigt(a.id, !a.erledigt) })
  }

  return (
    <div className={`card p-4 flex gap-3 ${a.erledigt ? 'opacity-60' : ''}`}>
      {writeOk && (
        <button type="button" onClick={handleErledigt} disabled={pending}
          title={a.erledigt ? 'Als offen markieren' : 'Als erledigt markieren'}
          className={`mt-0.5 w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-colors disabled:opacity-50 ${
            a.erledigt ? 'bg-green-500 border-green-500 text-white' : 'bg-white border-gray-300 hover:border-green-400 text-transparent'
          }`}>
          <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
          </svg>
        </button>
      )}
      <div className="flex-shrink-0 w-8 h-8 rounded-full bg-s112-bg flex items-center justify-center text-base">
        {artDef?.icon ?? '•'}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-s112-muted tabular-nums">
            {new Date(a.datum).toLocaleDateString('de-AT')}
          </span>
          {!a.ganztags && von && (
            <span className="text-xs font-medium text-s112-teal tabular-nums">
              {von}{bis ? `-${bis}` : ''}
            </span>
          )}
          <span className="text-xs text-s112-muted">{artDef?.label ?? a.art}</span>
        </div>
        <p className={`text-sm font-medium text-gray-800 mt-0.5 ${a.erledigt ? 'line-through text-gray-400' : ''}`}>
          {a.betreff}
        </p>
        {a.beschreibung && (
          <p className="text-xs text-gray-500 mt-0.5">{a.beschreibung}</p>
        )}
      </div>
    </div>
  )
}

export default function KontaktDetailClient({
  kontakt, firmaSegment, aktivitaeten, pipeline, writeOk,
}: {
  kontakt: KontaktRow
  firmaSegment: string | null
  aktivitaeten: AktivitaetRow[]
  pipeline: PipelineEintragRow[]
  writeOk: boolean
}) {
  const [showAktForm, setShowAktForm] = useState(false)
  const [showPipelineForm, setShowPipelineForm] = useState(false)

  const name = [kontakt.vorname, kontakt.nachname].filter(Boolean).join(' ')

  return (
    <div className="space-y-6">
      <nav className="flex items-center gap-2 text-sm text-s112-muted">
        <Link href="/crm/kontakte" className="hover:text-s112-teal">Kontakte</Link>
        <span>/</span>
        <span className="text-gray-800 font-medium">{name}</span>
      </nav>

      <div className="flex items-center gap-4">
        <div className="flex flex-col items-center justify-center bg-s112-bg border border-s112-border rounded-xl px-3 py-2 flex-shrink-0 min-w-[72px]">
          <span className="text-[10px] text-s112-muted font-medium uppercase tracking-wide">Kd.-Nr.</span>
          <span className="text-sm font-bold text-s112-teal tabular-nums">{kontakt.kundennummer ?? '–'}</span>
        </div>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{name}</h1>
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${segmentFarbe(kontakt.segment)}`}>
              {segmentLabel(kontakt.segment)}
            </span>
            {kontakt.stammkunde && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-s112-yellow/20 text-amber-700 font-medium">Stammkunde</span>
            )}
            {kontakt.newsletter && kontakt.newsletter_bestaetigt && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700 font-medium">Newsletter</span>
            )}
            {kontakt.newsletter && !kontakt.newsletter_bestaetigt && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-yellow-100 text-yellow-700 font-medium">ausstehend</span>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        <div className="lg:col-span-2 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-gray-800">Aktivitäten</h2>
            {writeOk && !showAktForm && (
              <button onClick={() => setShowAktForm(true)} className="text-xs text-s112-teal hover:underline font-medium">
                + Aktivität
              </button>
            )}
          </div>

          {showAktForm && (
            <AktivitaetForm kontaktId={kontakt.id} onDone={() => setShowAktForm(false)} />
          )}

          {aktivitaeten.length === 0 && !showAktForm ? (
            <div className="card p-6 text-center text-s112-muted text-sm">
              Noch keine Aktivitäten erfasst.
            </div>
          ) : (
            <div className="space-y-2">
              {aktivitaeten.map(a => (
                <AktivitaetKarte key={a.id} a={a} writeOk={writeOk} />
              ))}
            </div>
          )}
        </div>

        <div className="space-y-4">

          <div className="card p-4 space-y-2">
            <h2 className="text-sm font-semibold text-gray-800 mb-3">Kontaktdaten</h2>
            {kontakt.email && (
              <div className="flex items-center gap-2 text-sm">
                <span className="text-s112-muted w-5">E</span>
                <a href={`mailto:${kontakt.email}`} className="text-s112-teal hover:underline">{kontakt.email}</a>
              </div>
            )}
            {kontakt.telefon && (
              <div className="flex items-center gap-2 text-sm">
                <span className="text-s112-muted w-5">T</span>
                <span className="text-gray-700">{kontakt.telefon}</span>
              </div>
            )}
            {kontakt.mobil && (
              <div className="flex items-center gap-2 text-sm">
                <span className="text-s112-muted w-5">M</span>
                <span className="text-gray-700">{kontakt.mobil}</span>
              </div>
            )}
            {kontakt.ort && (
              <div className="flex items-center gap-2 text-sm">
                <span className="text-s112-muted w-5">O</span>
                <span className="text-gray-700">{kontakt.ort}{kontakt.land && kontakt.land !== 'AT' ? `, ${kontakt.land}` : ''}</span>
              </div>
            )}
            {kontakt.firma_name && (
              <div className="flex items-center gap-2 text-sm">
                <span className="text-s112-muted w-5">F</span>
                <span className="text-gray-700">{kontakt.firma_name}</span>
                {firmaSegment && (
                  <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${segmentFarbe(firmaSegment)}`}>
                    {segmentLabel(firmaSegment)}
                  </span>
                )}
              </div>
            )}
            {kontakt.notizen && (
              <p className="text-xs text-gray-500 italic pt-1 border-t border-s112-border/60">{kontakt.notizen}</p>
            )}
          </div>

          <div className="card p-4 space-y-2">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-gray-800">Pipeline</h2>
              {writeOk && !showPipelineForm && (
                <button onClick={() => setShowPipelineForm(true)} className="text-xs text-s112-teal hover:underline font-medium">
                  + Eintrag
                </button>
              )}
            </div>

            {showPipelineForm && (
              <PipelineForm kontaktId={kontakt.id} onDone={() => setShowPipelineForm(false)} />
            )}

            {pipeline.length === 0 && !showPipelineForm ? (
              <p className="text-xs text-s112-muted italic">Noch keine Pipeline-Einträge.</p>
            ) : (
              <div className="space-y-2">
                {pipeline.map(p => {
                  const stufeDef = PIPELINE_STUFEN.find(s => s.value === p.stufe)
                  return (
                    <div key={p.id} className="border border-s112-border/60 rounded-lg p-3 space-y-1">
                      <div className="flex items-center gap-2">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${stufeDef?.farbe ?? 'bg-gray-100 text-gray-700'}`}>
                          {stufeDef?.label ?? p.stufe}
                        </span>
                        {p.erledigt && (
                          <span className="text-xs px-1.5 py-0.5 rounded-full bg-green-100 text-green-700 font-medium">Erledigt</span>
                        )}
                      </div>
                      <p className="text-sm font-medium text-gray-800">{p.titel}</p>
                      <div className="flex gap-3 text-xs text-s112-muted">
                        {p.wert_euro != null && (
                          <span>{p.wert_euro.toLocaleString('de-AT', { style: 'currency', currency: 'EUR' })}</span>
                        )}
                        {p.wahrscheinlichkeit != null && <span>{p.wahrscheinlichkeit}%</span>}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

        </div>
      </div>
    </div>
  )
}
