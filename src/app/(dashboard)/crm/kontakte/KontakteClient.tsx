'use client'

import { useState, useEffect, useTransition } from 'react'
import Link from 'next/link'
import { createKontakt, updateKontakt, deleteKontakt, createAktivitaet, createPipelineEintrag } from '../actions'
import { SEGMENTE, AKTIVITAET_ARTEN, PIPELINE_STUFEN, segmentLabel, segmentFarbe } from '@/lib/crm/types'
import type { KontaktRow } from '@/lib/crm/types'

type FirmaOption = { id: string; name: string; segment: string }
type AktivitaetRow = {
  id: string; art: string; betreff: string | null
  beschreibung: string | null; datum: string; erledigt: boolean
}

// ── Hilfsfunktionen ───────────────────────────────────────────────────────────

const LAENDER = ['AT', 'DE', 'CH', 'IT', 'FR', 'HU', 'SK', 'CZ', 'US', 'GB']

function inputCls() {
  return 'w-full border border-s112-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40'
}

// ── Formular ──────────────────────────────────────────────────────────────────

function KontaktForm({
  initial, firmen, defaultSegment, onDone,
}: {
  initial?: KontaktRow | null
  firmen: FirmaOption[]
  defaultSegment?: string
  onDone: () => void
}) {
  const [pending, startTransition] = useTransition()
  const [stammkunde, setStammkunde] = useState(initial?.stammkunde ?? false)
  const [segmentVal, setSegmentVal] = useState(initial?.segment ?? defaultSegment ?? 'privat')

  // Folgt dem Filter-Button, solange kein bestehender Kontakt bearbeitet wird
  useEffect(() => {
    if (!initial && defaultSegment) setSegmentVal(defaultSegment)
  }, [defaultSegment, initial])

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    fd.set('stammkunde', stammkunde ? 'true' : 'false')
    startTransition(async () => {
      if (initial) await updateKontakt(initial.id, fd)
      else await createKontakt(fd)
      onDone()
    })
  }

  const v = (field: keyof KontaktRow) => (initial?.[field] ?? '') as string

  return (
    <form onSubmit={handleSubmit} className="bg-s112-bg border border-s112-border rounded-xl p-5 space-y-4">
      <h3 className="text-sm font-semibold text-gray-800">{initial ? 'Kontakt bearbeiten' : 'Neuer Kontakt'}</h3>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Vorname</label>
          <input name="vorname" defaultValue={v('vorname')} className={inputCls()} />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Nachname *</label>
          <input name="nachname" defaultValue={v('nachname')} required className={inputCls()} />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Segment *</label>
          <select name="segment" value={segmentVal} onChange={e => setSegmentVal(e.target.value)} required className={inputCls()}>
            {SEGMENTE.map(s => <option key={s.value} value={s.value}>{s.icon} {s.label}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Firma</label>
          <select name="firma_id" defaultValue={v('firma_id')} className={inputCls()}>
            <option value="">– keine –</option>
            {firmen.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">E-Mail</label>
          <input name="email" type="email" defaultValue={v('email')} className={inputCls()} />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Telefon</label>
          <input name="telefon" defaultValue={v('telefon')} className={inputCls()} />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Mobil</label>
          <input name="mobil" defaultValue={v('mobil')} className={inputCls()} />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Ort</label>
          <input name="ort" defaultValue={v('ort')} className={inputCls()} />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Land</label>
          <select name="land" defaultValue={v('land') || 'AT'} className={inputCls()}>
            {LAENDER.map(l => <option key={l} value={l}>{l}</option>)}
          </select>
        </div>
        <div className="flex items-center gap-2 pt-5">
          <input type="checkbox" id="stammkunde" checked={stammkunde}
            onChange={e => setStammkunde(e.target.checked)}
            className="accent-s112-teal w-4 h-4" />
          <label htmlFor="stammkunde" className="text-sm text-gray-700 cursor-pointer">Stammkunde</label>
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

// ── Aktivitäts-Log ────────────────────────────────────────────────────────────

function AktivitaetForm({ kontaktId, onDone }: { kontaktId: string; onDone: () => void }) {
  const [pending, startTransition] = useTransition()

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    fd.set('kontakt_id', kontaktId)
    startTransition(async () => { await createAktivitaet(fd); onDone() })
  }

  return (
    <form onSubmit={handleSubmit} className="mt-3 p-3 bg-white border border-s112-border rounded-lg space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <select name="art" defaultValue="notiz" required className={inputCls()}>
          {AKTIVITAET_ARTEN.map(a => <option key={a.value} value={a.value}>{a.icon} {a.label}</option>)}
        </select>
        <input name="datum" type="date" defaultValue={new Date().toISOString().split('T')[0]}
          required className={inputCls()} />
      </div>
      <input name="betreff" placeholder="Betreff" required className={inputCls()} />
      <textarea name="beschreibung" placeholder="Beschreibung (optional)" rows={2}
        className={inputCls() + ' resize-none'} />
      <div className="flex gap-2">
        <button type="submit" disabled={pending}
          className="bg-s112-teal text-white px-3 py-1 rounded-lg text-xs font-medium disabled:opacity-40">
          {pending ? '…' : 'Eintragen'}
        </button>
        <button type="button" onClick={onDone} className="text-xs text-gray-500 hover:text-gray-700">Abbrechen</button>
      </div>
    </form>
  )
}

// ── Pipeline-Mini-Formular ────────────────────────────────────────────────────

function PipelineForm({ kontaktId, onDone }: { kontaktId: string; onDone: () => void }) {
  const [pending, startTransition] = useTransition()

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    fd.set('kontakt_id', kontaktId)
    startTransition(async () => { await createPipelineEintrag(fd); onDone() })
  }

  return (
    <form onSubmit={handleSubmit} className="mt-3 p-3 bg-white border border-s112-border rounded-lg space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <select name="stufe" defaultValue="interessent" required className={inputCls()}>
          {PIPELINE_STUFEN.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
        <input name="titel" placeholder="Titel *" required className={inputCls()} />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <input name="wert_euro" type="number" step="0.01" placeholder="Wert € (optional)" className={inputCls()} />
        <input name="wahrscheinlichkeit" type="number" min="0" max="100" placeholder="Wahrsch. % (optional)" className={inputCls()} />
      </div>
      <div className="flex gap-2">
        <button type="submit" disabled={pending}
          className="bg-s112-teal text-white px-3 py-1 rounded-lg text-xs font-medium disabled:opacity-40">
          {pending ? '…' : 'Eintragen'}
        </button>
        <button type="button" onClick={onDone} className="text-xs text-gray-500 hover:text-gray-700">Abbrechen</button>
      </div>
    </form>
  )
}

// ── Kontakt-Karte ─────────────────────────────────────────────────────────────

function KontaktKarte({
  kontakt, firmen, aktivitaeten, writeOk,
}: {
  kontakt: KontaktRow
  firmen: FirmaOption[]
  aktivitaeten: AktivitaetRow[]
  writeOk: boolean
}) {
  const [editing, setEditing] = useState(false)
  const [showAkt, setShowAkt] = useState(false)
  const [showAktForm, setShowAktForm] = useState(false)
  const [showPipelineForm, setShowPipelineForm] = useState(false)
  const [pending, startTransition] = useTransition()

  const name = [kontakt.vorname, kontakt.nachname].filter(Boolean).join(' ')
  const aktIcon = AKTIVITAET_ARTEN.find(a => a.value === 'notiz')?.icon ?? '•'

  function handleDelete() {
    if (!confirm(`Kontakt "${name}" wirklich löschen?`)) return
    startTransition(async () => { await deleteKontakt(kontakt.id) })
  }

  if (editing) return (
    <KontaktForm initial={kontakt} firmen={firmen} onDone={() => setEditing(false)} />
  )

  return (
    <div className="card p-4">
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-full bg-s112-teal/10 flex items-center justify-center text-s112-teal font-semibold text-sm flex-shrink-0">
          {(kontakt.vorname?.[0] ?? kontakt.nachname[0]).toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <Link href={`/crm/kontakte/${kontakt.id}`}
              className="font-semibold text-gray-900 text-sm hover:text-s112-teal hover:underline">
              {name}
            </Link>
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${segmentFarbe(kontakt.segment)}`}>
              {segmentLabel(kontakt.segment)}
            </span>
            {kontakt.stammkunde && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-s112-yellow/20 text-amber-700 font-medium">⭐ Stammkunde</span>
            )}
            {kontakt.newsletter && kontakt.newsletter_bestaetigt && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700 font-medium">✉ Newsletter</span>
            )}
            {kontakt.newsletter && !kontakt.newsletter_bestaetigt && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-yellow-100 text-yellow-700 font-medium">✉ ausstehend</span>
            )}
          </div>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5">
            {kontakt.firma_name && <span className="text-xs text-s112-muted">🏢 {kontakt.firma_name}</span>}
            {kontakt.email && <span className="text-xs text-s112-muted">✉ {kontakt.email}</span>}
            {kontakt.telefon && <span className="text-xs text-s112-muted">📞 {kontakt.telefon}</span>}
            {kontakt.mobil && <span className="text-xs text-s112-muted">📱 {kontakt.mobil}</span>}
            {kontakt.ort && <span className="text-xs text-s112-muted">📍 {kontakt.ort}{kontakt.land !== 'AT' ? `, ${kontakt.land}` : ''}</span>}
          </div>
          {kontakt.notizen && (
            <p className="mt-1 text-xs text-gray-500 italic">{kontakt.notizen}</p>
          )}
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

      {/* Aktivitäten */}
      <div className="mt-3 border-t border-s112-border/60 pt-2">
        <button onClick={() => setShowAkt(o => !o)}
          className="text-xs text-s112-muted hover:text-gray-700 flex items-center gap-1">
          {showAkt ? '▾' : '▸'} {aktivitaeten.length} {aktivitaeten.length === 1 ? 'Aktivität' : 'Aktivitäten'}
        </button>

        {showAkt && (
          <div className="mt-2 space-y-1">
            {aktivitaeten.length === 0 ? (
              <p className="text-xs text-s112-muted italic">Noch keine Einträge.</p>
            ) : aktivitaeten.map(a => {
              const artDef = AKTIVITAET_ARTEN.find(x => x.value === a.art)
              return (
                <div key={a.id} className="flex gap-2 text-xs py-1 border-b border-s112-border/40 last:border-0">
                  <span className="flex-shrink-0 w-4">{artDef?.icon ?? '•'}</span>
                  <span className="text-s112-muted w-20 flex-shrink-0 tabular-nums">
                    {new Date(a.datum).toLocaleDateString('de-AT')}
                  </span>
                  <span className="font-medium text-gray-700">{a.betreff}</span>
                  {a.beschreibung && <span className="text-gray-500 truncate">{a.beschreibung}</span>}
                </div>
              )
            })}
            {writeOk && !showAktForm && (
              <button onClick={() => setShowAktForm(true)}
                className="text-xs text-s112-teal hover:underline mt-1">
                ＋ Aktivität eintragen
              </button>
            )}
            {showAktForm && (
              <AktivitaetForm kontaktId={kontakt.id} onDone={() => setShowAktForm(false)} />
            )}
          </div>
        )}
        {!showAkt && writeOk && (
          <button onClick={() => { setShowAkt(true); setShowAktForm(true) }}
            className="text-xs text-s112-teal hover:underline mt-1 ml-4">
            ＋ Aktivität
          </button>
        )}
      </div>

      {/* Pipeline */}
      {writeOk && (
        <div className="mt-2 border-t border-s112-border/60 pt-2">
          {!showPipelineForm ? (
            <button onClick={() => setShowPipelineForm(true)}
              className="text-xs text-s112-teal hover:underline">
              ＋ Pipeline
            </button>
          ) : (
            <PipelineForm kontaktId={kontakt.id} onDone={() => setShowPipelineForm(false)} />
          )}
        </div>
      )}
    </div>
  )
}

// ── Hauptkomponente ───────────────────────────────────────────────────────────

export type { AktivitaetRow }

export default function KontakteClient({
  kontakte, firmen, aktivitaetenMap, writeOk,
}: {
  kontakte: KontaktRow[]
  firmen: FirmaOption[]
  aktivitaetenMap: Record<string, AktivitaetRow[]>
  writeOk: boolean
}) {
  const [showForm, setShowForm] = useState(false)
  const [suche, setSuche] = useState('')
  const [segment, setSegment] = useState<string>('alle')

  const gefiltert = kontakte.filter(k => {
    const name = [k.vorname, k.nachname, k.email, k.firma_name].filter(Boolean).join(' ').toLowerCase()
    const matchSuche = !suche || name.includes(suche.toLowerCase())
    const matchSeg = segment === 'alle' || k.segment === segment
    return matchSuche && matchSeg
  })

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="search" placeholder="Suche nach Name, E-Mail, Firma…"
          value={suche} onChange={e => setSuche(e.target.value)}
          className="border border-s112-border rounded-lg px-3 py-1.5 text-sm w-64 focus:outline-none focus:ring-2 focus:ring-s112-teal/40"
        />
        <div className="flex gap-1">
          <button onClick={() => setSegment('alle')}
            className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${segment === 'alle' ? 'bg-s112-teal text-white' : 'bg-s112-bg text-gray-600 hover:text-gray-900'}`}>
            Alle ({kontakte.length})
          </button>
          {SEGMENTE.map(s => {
            const count = kontakte.filter(k => k.segment === s.value).length
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
            <span>＋</span> Neuer Kontakt
          </button>
        )}
      </div>

      {/* Formular */}
      {showForm && (
        <KontaktForm
          firmen={firmen}
          defaultSegment={segment !== 'alle' ? segment : undefined}
          onDone={() => setShowForm(false)}
        />
      )}

      {/* Liste */}
      {gefiltert.length === 0 ? (
        <div className="card text-center py-12 text-s112-muted text-sm">
          {kontakte.length === 0 ? 'Noch keine Kontakte angelegt.' : 'Keine Treffer für diesen Filter.'}
        </div>
      ) : (
        <div className="space-y-2">
          {gefiltert.map(k => (
            <KontaktKarte
              key={k.id}
              kontakt={k}
              firmen={firmen}
              aktivitaeten={aktivitaetenMap[k.id] ?? []}
              writeOk={writeOk}
            />
          ))}
        </div>
      )}
    </div>
  )
}
