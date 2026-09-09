'use client'

import { useState, useTransition, useMemo } from 'react'
import { Pencil, Trash2 } from 'lucide-react'
import {
  createPipelineEintrag, updatePipelineEintrag,
  updatePipelineStufe, togglePipelineErledigt, deletePipelineEintrag,
} from '../actions'
import { PIPELINE_STUFEN, PIPELINE_KATEGORIEN } from '@/lib/crm/types'
import type { PipelineEintragRow } from '@/lib/crm/types'
import { fmtNum } from '@/lib/format'

type KontaktOption = { id: string; name: string }
type FirmaOption   = { id: string; name: string }

function inputCls() {
  return 'w-full border border-s112-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40'
}

function stufeFarbe(stufe: string) {
  return PIPELINE_STUFEN.find(s => s.value === stufe)?.farbe ?? 'bg-[#F2F3F5] text-s112-text-1'
}
function stufeLabel(stufe: string) {
  return PIPELINE_STUFEN.find(s => s.value === stufe)?.label ?? stufe
}
function kategorieLabel(value: string | null) {
  if (!value) return null
  return PIPELINE_KATEGORIEN.find(k => k.value === value)?.label ?? value
}
function fmt(n: number | null) {
  if (n == null) return null
  return fmtNum(n, 0) + ' €'
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
  const [ganztags, setGanztags] = useState(initial?.ganztags ?? true)
  const v = (f: keyof PipelineEintragRow) => (initial?.[f] ?? '') as string

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    fd.set('ganztags', ganztags ? 'true' : 'false')
    startTransition(async () => {
      if (initial) await updatePipelineEintrag(initial.id, fd)
      else await createPipelineEintrag(fd)
      onDone()
    })
  }

  return (
    <form onSubmit={handleSubmit} className="bg-s112-bg border border-s112-border rounded-xl p-5 space-y-4">
      <h3 className="text-sm font-semibold text-s112-text">{initial ? 'Eintrag bearbeiten' : 'Neue Chance'}</h3>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="sm:col-span-2">
          <label className="block text-xs font-medium text-s112-text-2 mb-1">Titel *</label>
          <input name="titel" defaultValue={v('titel')} required
            placeholder="z.B. Weinsortiment 2024 – Restaurant Zum Raben" className={inputCls()} />
        </div>
        <div>
          <label className="block text-xs font-medium text-s112-text-2 mb-1">Stufe *</label>
          <select name="stufe" defaultValue={v('stufe') || 'interessent'} required className={inputCls()}>
            {PIPELINE_STUFEN.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-s112-text-2 mb-1">Kategorie</label>
          <select name="kategorie" defaultValue={v('kategorie')} className={inputCls()}>
            <option value="">– keine –</option>
            {PIPELINE_KATEGORIEN.map(k => <option key={k.value} value={k.value}>{k.label}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-s112-text-2 mb-1">Wert (€)</label>
          <input name="wert_euro" type="number" defaultValue={v('wert_euro')} min="0" step="0.01"
            placeholder="z.B. 2400" className={inputCls()} />
        </div>
        <div>
          <label className="block text-xs font-medium text-s112-text-2 mb-1">Kontakt</label>
          <select name="kontakt_id" defaultValue={v('kontakt_id')} className={inputCls()}>
            <option value="">– kein –</option>
            {kontakte.map(k => <option key={k.id} value={k.id}>{k.name}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-s112-text-2 mb-1">Firma</label>
          <select name="firma_id" defaultValue={v('firma_id')} className={inputCls()}>
            <option value="">– keine –</option>
            {firmen.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-s112-text-2 mb-1">Wahrscheinlichkeit (%)</label>
          <input name="wahrscheinlichkeit" type="number" defaultValue={v('wahrscheinlichkeit')}
            min="0" max="100" placeholder="z.B. 60" className={inputCls()} />
        </div>
        <div>
          <label className="block text-xs font-medium text-s112-text-2 mb-1">Erwarteter Abschluss</label>
          <input name="erwartetes_datum" type="date" defaultValue={v('erwartetes_datum')} className={inputCls()} />
        </div>
        <div className="sm:col-span-2">
          <label className="block text-xs font-medium text-s112-text-2 mb-1">Uhrzeit</label>
          <div className="flex items-center gap-3 flex-wrap">
            <label className="flex items-center gap-1.5 text-xs text-s112-text-2 cursor-pointer select-none shrink-0">
              <input type="checkbox" checked={ganztags} onChange={e => setGanztags(e.target.checked)} className="rounded" />
              Ganztags
            </label>
            <div className="flex items-center gap-2">
              <span className="text-xs text-s112-tertiary">Von</span>
              <input name="uhrzeit_von" type="time" step="1800" disabled={ganztags}
                defaultValue={v('uhrzeit_von').slice(0,5)}
                className={`border border-s112-border rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40 ${ganztags ? 'opacity-30 cursor-not-allowed bg-s112-bg' : ''}`} />
              <span className="text-xs text-s112-tertiary">–</span>
              <input name="uhrzeit_bis" type="time" step="1800" disabled={ganztags}
                defaultValue={v('uhrzeit_bis').slice(0,5)}
                className={`border border-s112-border rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40 ${ganztags ? 'opacity-30 cursor-not-allowed bg-s112-bg' : ''}`} />
            </div>
          </div>
        </div>
      </div>

      <div>
        <label className="block text-xs font-medium text-s112-text-2 mb-1">Notizen</label>
        <textarea name="notizen" defaultValue={v('notizen')} rows={2}
          className={inputCls() + ' resize-none'} />
      </div>

      <div className="flex gap-2">
        <button type="submit" disabled={pending}
          className="bg-s112-teal text-white px-4 py-1.5 rounded-lg text-sm font-medium hover:bg-opacity-90 disabled:opacity-40">
          {pending ? 'Wird gespeichert…' : (initial ? 'Speichern' : 'Anlegen')}
        </button>
        <button type="button" onClick={onDone}
          className="px-4 py-1.5 rounded-lg text-sm font-medium text-s112-text-2 hover:text-s112-text">
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
  function handleErledigt(checked: boolean) {
    startTransition(async () => { await togglePipelineErledigt(eintrag.id, checked) })
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
  const katLabel = kategorieLabel(eintrag.kategorie)

  return (
    <div className={`flex items-center gap-3 py-2.5 px-4 hover:bg-s112-bg/60 transition-colors group ${eintrag.erledigt ? 'opacity-60' : ''}`}>

      {/* Erledigt-Toggle */}
      {writeOk && (
        <button
          type="button"
          onClick={() => handleErledigt(!eintrag.erledigt)}
          disabled={pending}
          title={eintrag.erledigt ? 'Als offen markieren' : 'Als erledigt markieren'}
          className={`w-6 h-6 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-colors disabled:opacity-50 ${
            eintrag.erledigt
              ? 'bg-s112-ok border-s112-ok text-white'
              : 'bg-white border-s112-line-str hover:border-s112-ok/50 text-transparent'
          }`}
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
          </svg>
        </button>
      )}

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`font-medium text-sm text-s112-text truncate ${eintrag.erledigt ? 'line-through text-s112-tertiary' : ''}`}>
            {eintrag.titel}
          </span>
          {katLabel && (
            <span className="text-xs px-1.5 py-px rounded-full bg-s112-bg border border-s112-border text-s112-muted">
              {katLabel}
            </span>
          )}
          {eintrag.wert_euro != null && (
            <span className="text-xs font-semibold text-s112-blue-700">{fmt(eintrag.wert_euro)}</span>
          )}
          {eintrag.wahrscheinlichkeit != null && (
            <span className="text-xs text-s112-muted">{eintrag.wahrscheinlichkeit}%</span>
          )}
        </div>
        <div className="flex gap-3 mt-0.5 flex-wrap">
          {eintrag.kontakt_name && <span className="text-xs text-s112-muted">{eintrag.kontakt_name}</span>}
          {eintrag.firma_name && <span className="text-xs text-s112-muted">{eintrag.firma_name}</span>}
          {abschluss && <span className="text-xs text-s112-muted">{abschluss}</span>}
          {eintrag.erledigt && eintrag.erledigt_am && (
            <span className="text-xs text-s112-ok-fg">
              {new Date(eintrag.erledigt_am).toLocaleDateString('de-AT')}
            </span>
          )}
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
        <div className="flex gap-1">
          <button onClick={() => setEditing(true)}
            title="Bearbeiten" aria-label="Bearbeiten"
            className="text-s112-muted hover:text-s112-blue-700 px-2 py-1 rounded">
            <Pencil className="w-4 h-4" />
          </button>
          <button onClick={handleDelete} disabled={pending}
            title="Löschen" aria-label="Löschen"
            className="text-s112-muted hover:text-s112-err px-2 py-1 rounded">
            <Trash2 className="w-4 h-4" />
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
          <span className="text-sm font-semibold text-s112-blue-700">{fmt(gesamtwert)}</span>
        )}
        <svg className={`w-3.5 h-3.5 text-s112-tertiary ml-auto transition-transform ${open ? 'rotate-90' : ''}`}
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
  const [showForm, setShowForm]           = useState(false)
  const [filterStufe, setFilterStufe]     = useState<string>('alle')
  const [filterKategorie, setFilterKategorie] = useState<string>('alle')
  const [filterStatus, setFilterStatus]   = useState<'alle' | 'offen' | 'erledigt'>('offen')

  // Vorhandene Kategorien für Dropdown
  const vorhandeneKategorien = useMemo(
    () => PIPELINE_KATEGORIEN.filter(k => eintraege.some(e => e.kategorie === k.value)),
    [eintraege],
  )

  // Gefilterte Einträge
  const gefiltert = useMemo(() => eintraege.filter(e => {
    if (filterStufe !== 'alle' && e.stufe !== filterStufe) return false
    if (filterKategorie !== 'alle' && e.kategorie !== filterKategorie) return false
    if (filterStatus === 'offen' && e.erledigt) return false
    if (filterStatus === 'erledigt' && !e.erledigt) return false
    return true
  }), [eintraege, filterStufe, filterKategorie, filterStatus])

  const gesamtWert = useMemo(
    () => gefiltert
      .filter(e => !['verloren', 'abschluss', 'stammkunde'].includes(e.stufe))
      .reduce((s, e) => s + (e.wert_euro ?? 0), 0),
    [gefiltert],
  )

  return (
    <div className="space-y-3">

      {/* ── Filter-Bar ── */}
      <div className="card p-3 space-y-2.5">

        {/* Stufen-Buttons */}
        <div className="flex gap-1.5 flex-wrap">
          <button
            onClick={() => setFilterStufe('alle')}
            className={`text-xs px-3 py-1 rounded-full font-medium border transition-colors ${
              filterStufe === 'alle'
                ? 'bg-s112-teal text-white border-s112-teal'
                : 'bg-white text-s112-text-2 border-s112-border hover:border-s112-teal/50'
            }`}>
            Alle ({eintraege.length})
          </button>
          {PIPELINE_STUFEN.map(s => {
            const count = eintraege.filter(e => e.stufe === s.value).length
            return (
              <button
                key={s.value}
                onClick={() => setFilterStufe(f => f === s.value ? 'alle' : s.value)}
                className={`text-xs px-3 py-1 rounded-full font-medium border transition-colors ${
                  filterStufe === s.value
                    ? s.farbe + ' border-transparent'
                    : 'bg-white text-s112-text-2 border-s112-border hover:border-s112-teal/50'
                }`}>
                {s.label} <span className="opacity-60">({count})</span>
              </button>
            )
          })}
        </div>

        {/* Kategorie + Status-Toggles */}
        <div className="flex items-center gap-3 flex-wrap">
          {vorhandeneKategorien.length > 0 && (
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-s112-muted">Kategorie:</span>
              <select
                value={filterKategorie}
                onChange={e => setFilterKategorie(e.target.value)}
                className="text-xs border border-s112-border rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-s112-teal/40">
                <option value="alle">Alle</option>
                {vorhandeneKategorien.map(k => (
                  <option key={k.value} value={k.value}>{k.label}</option>
                ))}
              </select>
            </div>
          )}
          <div className="flex items-center gap-px border border-s112-border rounded-lg overflow-hidden text-xs ml-auto">
            {(['offen', 'alle', 'erledigt'] as const).map(s => (
              <button key={s} onClick={() => setFilterStatus(s)}
                className={`px-3 py-1.5 font-medium transition-colors ${
                  filterStatus === s
                    ? 'bg-s112-teal text-white'
                    : 'bg-white text-s112-text-2 hover:bg-s112-bg'
                }`}>
                {s === 'offen' ? 'Offen' : s === 'erledigt' ? 'Erledigt' : 'Alle'}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── Summary + Button ── */}
      <div className="flex items-center gap-4">
        <div className="card px-4 py-3 flex gap-6 flex-1 flex-wrap">
          <div>
            <p className="text-xs text-s112-muted">Aktive Chancen</p>
            <p className="text-lg font-semibold text-s112-text">
              {eintraege.filter(e => !['verloren', 'stammkunde'].includes(e.stufe) && !e.erledigt).length}
            </p>
          </div>
          {gesamtWert > 0 && (
            <div>
              <p className="text-xs text-s112-muted">Potenzieller Wert</p>
              <p className="text-lg font-semibold text-s112-blue-700">{fmt(gesamtWert)}</p>
            </div>
          )}
          <div>
            <p className="text-xs text-s112-muted">Stammkunden</p>
            <p className="text-lg font-semibold text-s112-text">
              {eintraege.filter(e => e.stufe === 'stammkunde').length}
            </p>
          </div>
          <div>
            <p className="text-xs text-s112-muted">Erledigt</p>
            <p className="text-lg font-semibold text-s112-text">
              {eintraege.filter(e => e.erledigt).length}
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

      {/* ── Einträge: Flachliste (Stufenfilter aktiv) oder Gruppenansicht ── */}
      {filterStufe !== 'alle' ? (
        <div className="card p-0 overflow-hidden">
          <div className="px-4 py-3 bg-s112-bg border-b border-s112-border flex items-center gap-3">
            <span className={`text-xs px-2.5 py-0.5 rounded-full font-semibold ${stufeFarbe(filterStufe)}`}>
              {stufeLabel(filterStufe)}
            </span>
            <span className="text-sm text-s112-muted">
              {gefiltert.length} {gefiltert.length === 1 ? 'Eintrag' : 'Einträge'}
            </span>
          </div>
          {gefiltert.length === 0 ? (
            <p className="px-4 py-4 text-xs text-s112-muted italic">Keine Einträge gefunden.</p>
          ) : (
            <div className="divide-y divide-s112-border/40">
              {gefiltert.map(e => (
                <EintragZeile key={e.id} eintrag={e} kontakte={kontakte} firmen={firmen} writeOk={writeOk} />
              ))}
            </div>
          )}
        </div>
      ) : (
        PIPELINE_STUFEN.map(stufe => (
          <StufenGruppe
            key={stufe.value}
            stufe={stufe}
            eintraege={gefiltert.filter(e => e.stufe === stufe.value)}
            kontakte={kontakte}
            firmen={firmen}
            writeOk={writeOk}
          />
        ))
      )}
    </div>
  )
}
