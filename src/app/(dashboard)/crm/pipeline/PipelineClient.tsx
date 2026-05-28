'use client'

import { useState, useTransition } from 'react'
import { createPipelineEintrag, updatePipelineEintrag, updatePipelineStufe, deletePipelineEintrag } from '../actions'
import { PIPELINE_STUFEN, segmentLabel } from '@/lib/crm/types'
import type { PipelineEintragRow } from '@/lib/crm/types'

type KontaktOption = { id: string; name: string }
type FirmaOption   = { id: string; name: string }

function inputCls() {
  return 'w-full border border-s112-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40'
}

function stufeFarbe(stufe: string) {
  return PIPELINE_STUFEN.find(s => s.value === stufe)?.farbe ?? 'bg-gray-100 text-gray-700'
}
function stufeLabel(stufe: string) {
  return PIPELINE_STUFEN.find(s => s.value === stufe)?.label ?? stufe
}

function fmt(n: number | null) {
  if (n == null) return null
  return n.toLocaleString('de-AT', { minimumFractionDigits: 0, maximumFractionDigits: 0 }) + ' €'
}

// ── Formular ──────────────────────────────────────────────────────────────────

function PipelineForm({
  initial, kontakte, firmen, onDone,
}: {
  initial?: PipelineEintragRow | null
  kontakte: KontaktOption[]
  firmen: FirmaOption[]
  onDone: () => void
}) {
  const [pending, startTransition] = useTransition()
  const v = (f: keyof PipelineEintragRow) => (initial?.[f] ?? '') as string

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    startTransition(async () => {
      if (initial) await updatePipelineEintrag(initial.id, fd)
      else await createPipelineEintrag(fd)
      onDone()
    })
  }

  return (
    <form onSubmit={handleSubmit} className="bg-s112-bg border border-s112-border rounded-xl p-5 space-y-4">
      <h3 className="text-sm font-semibold text-gray-800">{initial ? 'Eintrag bearbeiten' : 'Neue Chance'}</h3>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="sm:col-span-2">
          <label className="block text-xs font-medium text-gray-600 mb-1">Titel *</label>
          <input name="titel" defaultValue={v('titel')} required placeholder="z.B. Weinsortiment 2024 – Restaurant Zum Raben"
            className={inputCls()} />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Stufe *</label>
          <select name="stufe" defaultValue={v('stufe') || 'interessent'} required className={inputCls()}>
            {PIPELINE_STUFEN.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Wert (€)</label>
          <input name="wert_euro" type="number" defaultValue={v('wert_euro')} min="0" step="0.01"
            placeholder="z.B. 2400" className={inputCls()} />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Kontakt</label>
          <select name="kontakt_id" defaultValue={v('kontakt_id')} className={inputCls()}>
            <option value="">– kein –</option>
            {kontakte.map(k => <option key={k.id} value={k.id}>{k.name}</option>)}
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
          <label className="block text-xs font-medium text-gray-600 mb-1">Wahrscheinlichkeit (%)</label>
          <input name="wahrscheinlichkeit" type="number" defaultValue={v('wahrscheinlichkeit')}
            min="0" max="100" placeholder="z.B. 60" className={inputCls()} />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Erwarteter Abschluss</label>
          <input name="erwartetes_datum" type="date" defaultValue={v('erwartetes_datum')} className={inputCls()} />
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

// ── Eintrag-Zeile ─────────────────────────────────────────────────────────────

function EintragZeile({
  eintrag, kontakte, firmen, writeOk,
}: {
  eintrag: PipelineEintragRow
  kontakte: KontaktOption[]
  firmen: FirmaOption[]
  writeOk: boolean
}) {
  const [editing, setEditing] = useState(false)
  const [pending, startTransition] = useTransition()

  function handleStufe(stufe: string) {
    startTransition(async () => { await updatePipelineStufe(eintrag.id, stufe) })
  }

  function handleDelete() {
    if (!confirm(`"${eintrag.titel}" wirklich löschen?`)) return
    startTransition(async () => { await deletePipelineEintrag(eintrag.id) })
  }

  if (editing) return (
    <PipelineForm initial={eintrag} kontakte={kontakte} firmen={firmen} onDone={() => setEditing(false)} />
  )

  const abschluss = eintrag.erwartetes_datum
    ? new Date(eintrag.erwartetes_datum).toLocaleDateString('de-AT')
    : null

  return (
    <div className="flex items-center gap-3 py-2.5 px-4 hover:bg-s112-bg/60 transition-colors group">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium text-sm text-gray-900 truncate">{eintrag.titel}</span>
          {eintrag.wert_euro != null && (
            <span className="text-xs font-semibold text-s112-teal">{fmt(eintrag.wert_euro)}</span>
          )}
          {eintrag.wahrscheinlichkeit != null && (
            <span className="text-xs text-s112-muted">{eintrag.wahrscheinlichkeit}%</span>
          )}
        </div>
        <div className="flex gap-3 mt-0.5">
          {eintrag.kontakt_name && <span className="text-xs text-s112-muted">👤 {eintrag.kontakt_name}</span>}
          {eintrag.firma_name && <span className="text-xs text-s112-muted">🏢 {eintrag.firma_name}</span>}
          {abschluss && <span className="text-xs text-s112-muted">📅 {abschluss}</span>}
        </div>
      </div>

      {/* Stufe wechseln */}
      {writeOk && (
        <select
          value={eintrag.stufe}
          onChange={e => handleStufe(e.target.value)}
          disabled={pending}
          className="text-xs border border-s112-border rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-s112-teal/40 disabled:opacity-50"
        >
          {PIPELINE_STUFEN.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
      )}

      {writeOk && (
        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button onClick={() => setEditing(true)}
            className="text-xs text-s112-muted hover:text-s112-teal px-2 py-1 rounded">
            Bearbeiten
          </button>
          <button onClick={handleDelete} disabled={pending}
            className="text-xs text-s112-muted hover:text-red-500 px-2 py-1 rounded">
            Löschen
          </button>
        </div>
      )}
    </div>
  )
}

// ── Stufen-Gruppe ─────────────────────────────────────────────────────────────

function StufenGruppe({
  stufe, eintraege, kontakte, firmen, writeOk,
}: {
  stufe: typeof PIPELINE_STUFEN[number]
  eintraege: PipelineEintragRow[]
  kontakte: KontaktOption[]
  firmen: FirmaOption[]
  writeOk: boolean
}) {
  const [open, setOpen] = useState(stufe.value !== 'verloren')
  const gesamtwert = eintraege.reduce((s, e) => s + (e.wert_euro ?? 0), 0)

  return (
    <div className="card p-0 overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-3 px-4 py-3 bg-s112-bg hover:bg-s112-bg/80 transition-colors"
      >
        <span className={`text-xs px-2.5 py-0.5 rounded-full font-semibold ${stufe.farbe}`}>
          {stufe.label}
        </span>
        <span className="text-sm text-s112-muted">{eintraege.length} {eintraege.length === 1 ? 'Eintrag' : 'Einträge'}</span>
        {gesamtwert > 0 && (
          <span className="text-sm font-semibold text-s112-teal">{fmt(gesamtwert)}</span>
        )}
        <svg className={`w-3.5 h-3.5 text-gray-400 ml-auto transition-transform ${open ? 'rotate-90' : ''}`}
          fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
      </button>

      {open && eintraege.length > 0 && (
        <div className="divide-y divide-s112-border/40">
          {eintraege.map(e => (
            <EintragZeile key={e.id} eintrag={e} kontakte={kontakte} firmen={firmen} writeOk={writeOk} />
          ))}
        </div>
      )}

      {open && eintraege.length === 0 && (
        <p className="px-4 py-3 text-xs text-s112-muted italic">Keine Einträge in dieser Stufe.</p>
      )}
    </div>
  )
}

// ── Hauptkomponente ───────────────────────────────────────────────────────────

export default function PipelineClient({
  eintraege, kontakte, firmen, writeOk,
}: {
  eintraege: PipelineEintragRow[]
  kontakte: KontaktOption[]
  firmen: FirmaOption[]
  writeOk: boolean
}) {
  const [showForm, setShowForm] = useState(false)

  const gesamtWert = eintraege
    .filter(e => !['verloren', 'abschluss', 'stammkunde'].includes(e.stufe))
    .reduce((s, e) => s + (e.wert_euro ?? 0), 0)

  return (
    <div className="space-y-3">
      {/* Summary + Button */}
      <div className="flex items-center gap-4">
        <div className="card px-4 py-3 flex gap-6 flex-1">
          <div>
            <p className="text-xs text-s112-muted">Aktive Chancen</p>
            <p className="text-lg font-bold text-gray-900">
              {eintraege.filter(e => !['verloren', 'stammkunde'].includes(e.stufe)).length}
            </p>
          </div>
          {gesamtWert > 0 && (
            <div>
              <p className="text-xs text-s112-muted">Potenzieller Wert</p>
              <p className="text-lg font-bold text-s112-teal">{fmt(gesamtWert)}</p>
            </div>
          )}
          <div>
            <p className="text-xs text-s112-muted">Stammkunden</p>
            <p className="text-lg font-bold text-gray-900">
              {eintraege.filter(e => e.stufe === 'stammkunde').length}
            </p>
          </div>
        </div>
        {writeOk && !showForm && (
          <button onClick={() => setShowForm(true)}
            className="inline-flex items-center gap-2 bg-s112-teal text-white px-4 py-2 rounded-xl text-sm font-semibold hover:bg-opacity-90 whitespace-nowrap">
            <span>＋</span> Neue Chance
          </button>
        )}
      </div>

      {showForm && (
        <PipelineForm kontakte={kontakte} firmen={firmen} onDone={() => setShowForm(false)} />
      )}

      {/* Stufen */}
      {PIPELINE_STUFEN.map(stufe => (
        <StufenGruppe
          key={stufe.value}
          stufe={stufe}
          eintraege={eintraege.filter(e => e.stufe === stufe.value)}
          kontakte={kontakte}
          firmen={firmen}
          writeOk={writeOk}
        />
      ))}
    </div>
  )
}
