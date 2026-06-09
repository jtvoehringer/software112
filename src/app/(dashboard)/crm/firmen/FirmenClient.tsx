'use client'

import { useState, useEffect, useTransition } from 'react'
import Link from 'next/link'
import { createFirma, updateFirma, deleteFirma } from '../actions'
import { SEGMENTE, segmentLabel, segmentFarbe } from '@/lib/crm/types'
import type { FirmaRow } from '@/lib/crm/types'

type KontaktKurz = { id: string; vorname: string | null; nachname: string; segment: string }

function inputCls() {
  return 'w-full border border-s112-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40'
}

const WAEHRUNGEN = ['EUR', 'USD', 'GBP', 'CHF', 'HUF', 'CZK']
const LAENDER = ['AT', 'DE', 'CH', 'IT', 'FR', 'HU', 'SK', 'CZ', 'US', 'GB']

// ── Formular ──────────────────────────────────────────────────────────────────

function FirmaForm({ initial, rabattgruppen, defaultSegment, onDone }: { initial?: FirmaRow | null; rabattgruppen: {id:string;name:string;rabatt_pct:number}[]; defaultSegment?: string; onDone: () => void }) {
  const [pending, startTransition] = useTransition()
  const [segmentVal, setSegmentVal] = useState(initial?.segment ?? defaultSegment ?? 'handel')
  const v = (field: keyof FirmaRow) => (initial?.[field] ?? '') as string

  useEffect(() => {
    if (!initial && defaultSegment) setSegmentVal(defaultSegment)
  }, [defaultSegment, initial])

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    startTransition(async () => {
      if (initial) await updateFirma(initial.id, fd)
      else await createFirma(fd)
      onDone()
    })
  }

  return (
    <form onSubmit={handleSubmit} className="bg-s112-bg border border-s112-border rounded-xl p-5 space-y-4">
      <h3 className="text-sm font-semibold text-gray-800">{initial ? 'Firma bearbeiten' : 'Neue Firma'}</h3>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="sm:col-span-2">
          <label className="block text-xs font-medium text-gray-600 mb-1">Firmenname *</label>
          <input name="name" defaultValue={v('name')} required className={inputCls()} />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Segment *</label>
          <select name="segment" value={segmentVal} onChange={e => setSegmentVal(e.target.value)} required className={inputCls()}>
            {SEGMENTE.filter(s => s.value !== 'privat').map(s =>
              <option key={s.value} value={s.value}>{s.icon} {s.label}</option>
            )}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">UID-Nummer</label>
          <input name="uid_nummer" defaultValue={v('uid_nummer')} placeholder="ATU…" className={inputCls()} />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Straße</label>
          <input name="strasse" defaultValue={v('strasse')} className={inputCls()} />
        </div>
        <div className="grid grid-cols-3 gap-2">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">PLZ</label>
            <input name="plz" defaultValue={v('plz')} className={inputCls()} />
          </div>
          <div className="col-span-2">
            <label className="block text-xs font-medium text-gray-600 mb-1">Ort</label>
            <input name="ort" defaultValue={v('ort')} className={inputCls()} />
          </div>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Land</label>
          <select name="land" defaultValue={v('land') || 'AT'} className={inputCls()}>
            {LAENDER.map(l => <option key={l} value={l}>{l}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Telefon</label>
          <input name="telefon" defaultValue={v('telefon')} className={inputCls()} />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">E-Mail</label>
          <input name="email" type="email" defaultValue={v('email')} className={inputCls()} />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Website</label>
          <input name="website" defaultValue={v('website')} placeholder="https://…" className={inputCls()} />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Zahlungsziel (Tage)</label>
          <input name="zahlungsziel_tage" type="number" defaultValue={v('zahlungsziel_tage') || '30'}
            min="0" max="365" className={inputCls()} />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Währung</label>
          <select name="waehrung" defaultValue={v('waehrung') || 'EUR'} className={inputCls()}>
            {WAEHRUNGEN.map(w => <option key={w} value={w}>{w}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Rabattgruppe</label>
          <select name="rabattgruppe_id" defaultValue={initial?.rabattgruppe_id ?? ''} className={inputCls()}>
            <option value="">– kein Rabatt –</option>
            {rabattgruppen.map(r => (
              <option key={r.id} value={r.id}>{r.name} ({r.rabatt_pct}%)</option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">Notizen</label>
        <textarea name="notizen" defaultValue={v('notizen')} rows={2}
          className={inputCls() + ' resize-none'} />
      </div>

      <div className="flex gap-2">
        <button type="submit" disabled={pending}
          className="bg-s112-teal text-white px-4 py-1.5 rounded-lg text-sm font-medium hover:bg-opacity-90 disabled:opacity-40">
          {pending ? 'Wird gespeichert…' : (initial ? 'Speichern' : 'Anlegen')}
        </button>
        <button type="button" onClick={onDone}
          className="px-4 py-1.5 rounded-lg text-sm font-medium text-gray-600 hover:text-gray-800">
          Abbrechen
        </button>
      </div>
    </form>
  )
}

// ── Firma-Karte ───────────────────────────────────────────────────────────────

function FirmaKarte({
  firma, kontakte, rabattgruppen, writeOk,
}: {
  firma: FirmaRow
  kontakte: KontaktKurz[]
  rabattgruppen: {id:string;name:string;rabatt_pct:number}[]
  writeOk: boolean
}) {
  const [editing, setEditing] = useState(false)
  const [showKontakte, setShowKontakte] = useState(false)
  const [pending, startTransition] = useTransition()

  function handleDelete() {
    if (!confirm(`Firma "${firma.name}" wirklich löschen?`)) return
    startTransition(async () => { await deleteFirma(firma.id) })
  }

  if (editing) return <FirmaForm initial={firma} rabattgruppen={rabattgruppen} onDone={() => setEditing(false)} />

  return (
    <div className="card p-4">
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-lg bg-s112-teal/10 flex items-center justify-center text-s112-teal font-bold text-sm flex-shrink-0">
          {firma.name[0].toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            {firma.kundennummer && (
              <span className="text-xs font-mono text-s112-muted">{firma.kundennummer}</span>
            )}
            <Link href={`/crm/firmen/${firma.id}`}
              className="font-semibold text-gray-900 text-sm hover:text-s112-teal hover:underline">
              {firma.name}
            </Link>
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${segmentFarbe(firma.segment)}`}>
              {segmentLabel(firma.segment)}
            </span>
            {firma.land !== 'AT' && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 font-medium">{firma.land}</span>
            )}
          </div>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5">
            {firma.ort && <span className="text-xs text-s112-muted">📍 {firma.plz ? `${firma.plz} ` : ''}{firma.ort}</span>}
            {firma.email && <span className="text-xs text-s112-muted">✉ {firma.email}</span>}
            {firma.telefon && <span className="text-xs text-s112-muted">📞 {firma.telefon}</span>}
            {firma.uid_nummer && <span className="text-xs text-s112-muted">UID: {firma.uid_nummer}</span>}
            {firma.zahlungsziel_tage != null && firma.zahlungsziel_tage !== 30 && (
              <span className="text-xs text-s112-muted">Zahlungsziel: {firma.zahlungsziel_tage} Tage</span>
            )}
          </div>
          {firma.notizen && <p className="mt-1 text-xs text-gray-500 italic">{firma.notizen}</p>}
        </div>
        {writeOk && (
          <div className="flex gap-1 flex-shrink-0">
            <button onClick={() => setEditing(true)}
              className="text-xs text-s112-muted hover:text-s112-teal px-2 py-1 rounded transition-colors">
              Bearbeiten
            </button>
            <button onClick={handleDelete} disabled={pending}
              className="text-xs text-s112-muted hover:text-red-500 px-2 py-1 rounded transition-colors">
              Löschen
            </button>
          </div>
        )}
      </div>

      {/* Kontakte */}
      {kontakte.length > 0 && (
        <div className="mt-3 border-t border-s112-border/60 pt-2">
          <button onClick={() => setShowKontakte(o => !o)}
            className="text-xs text-s112-muted hover:text-gray-700 flex items-center gap-1">
            {showKontakte ? '▾' : '▸'} {kontakte.length} {kontakte.length === 1 ? 'Kontakt' : 'Kontakte'}
          </button>
          {showKontakte && (
            <div className="mt-2 flex flex-wrap gap-2">
              {kontakte.map(k => (
                <span key={k.id} className="text-xs bg-s112-bg border border-s112-border rounded-lg px-2 py-0.5">
                  {[k.vorname, k.nachname].filter(Boolean).join(' ')}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Hauptkomponente ───────────────────────────────────────────────────────────

export default function FirmenClient({
  firmen, kontakteMap, rabattgruppen, writeOk,
}: {
  firmen: FirmaRow[]
  kontakteMap: Record<string, KontaktKurz[]>
  rabattgruppen: {id:string;name:string;rabatt_pct:number}[]
  writeOk: boolean
}) {
  const [showForm, setShowForm] = useState(false)
  const [suche, setSuche] = useState('')
  const [segment, setSegment] = useState('alle')

  const gefiltert = firmen.filter(f => {
    const text = [f.kundennummer, f.name, f.ort, f.email, f.telefon].filter(Boolean).join(' ').toLowerCase()
    return (!suche || text.includes(suche.toLowerCase())) &&
           (segment === 'alle' || f.segment === segment)
  })

  const bSegmente = SEGMENTE.filter(s => s.value !== 'privat')

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <input type="search" placeholder="Name, Kundennummer, E-Mail, Ort…"
          value={suche} onChange={e => setSuche(e.target.value)}
          className="border border-s112-border rounded-lg px-3 py-1.5 text-sm w-64 focus:outline-none focus:ring-2 focus:ring-s112-teal/40" />
        <div className="flex gap-1">
          <button onClick={() => setSegment('alle')}
            className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${segment === 'alle' ? 'bg-s112-teal text-white' : 'bg-s112-bg text-gray-600 hover:text-gray-900'}`}>
            Alle ({firmen.length})
          </button>
          {bSegmente.map(s => {
            const count = firmen.filter(f => f.segment === s.value).length
            if (count === 0) return null
            return (
              <button key={s.value} onClick={() => setSegment(s.value)}
                className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${segment === s.value ? 'bg-s112-teal text-white' : 'bg-s112-bg text-gray-600 hover:text-gray-900'}`}>
                {s.icon} {s.label} ({count})
              </button>
            )
          })}
        </div>
        {writeOk && !showForm && (
          <button onClick={() => setShowForm(true)}
            className="ml-auto inline-flex items-center gap-2 bg-s112-teal text-white px-4 py-2 rounded-xl text-sm font-semibold hover:bg-opacity-90">
            <span>＋</span> Neue Firma
          </button>
        )}
      </div>

      {showForm && (
        <FirmaForm
          rabattgruppen={rabattgruppen}
          defaultSegment={segment !== 'alle' ? segment : undefined}
          onDone={() => setShowForm(false)}
        />
      )}

      {gefiltert.length === 0 ? (
        <div className="card text-center py-12 text-s112-muted text-sm">
          {firmen.length === 0 ? 'Noch keine Firmen angelegt.' : 'Keine Treffer für diesen Filter.'}
        </div>
      ) : (
        <div className="space-y-2">
          {gefiltert.map(f => (
            <FirmaKarte key={f.id} firma={f}
              kontakte={kontakteMap[f.id] ?? []}
              rabattgruppen={rabattgruppen}
              writeOk={writeOk} />
          ))}
        </div>
      )}
    </div>
  )
}
