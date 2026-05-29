'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { createAktivitaet, createPipelineEintrag, toggleAktivitaetErledigt } from '../../actions'
import {
  AKTIVITAET_ARTEN, PIPELINE_STUFEN,
  segmentLabel, segmentFarbe, fmtUhrzeit,
} from '@/lib/crm/types'
import type { FirmaRow, KontaktRow, AktivitaetRow, PipelineEintragRow } from '@/lib/crm/types'

function inputCls() {
  return 'w-full border border-s112-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40'
}

// ── Aktivitäts-Formular ───────────────────────────────────────────────────────

function AktivitaetForm({ firmaId, onDone }: { firmaId: string; onDone: () => void }) {
  const [pending, startTransition] = useTransition()
  const [ganztags, setGanztags] = useState(true)

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    fd.set('firma_id', firmaId)
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

      {/* Uhrzeit – immer sichtbar, bei Ganztags deaktiviert */}
      <div className="flex items-center gap-3 flex-wrap">
        <label className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer select-none shrink-0">
          <input type="checkbox" checked={ganztags} onChange={e => setGanztags(e.target.checked)}
            className="rounded" />
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

      <input name="betreff" placeholder="Betreff *" required className={inputCls()} />
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

// ── Pipeline-Formular ─────────────────────────────────────────────────────────

function PipelineForm({ firmaId, onDone }: { firmaId: string; onDone: () => void }) {
  const [pending, startTransition] = useTransition()

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    fd.set('firma_id', firmaId)
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
        <input name="wert_euro" type="number" step="0.01" placeholder="Wert € (optional)" className={inputCls()} />
        <input name="erwartetes_datum" type="date" className={inputCls()} />
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

// ── Aktivitäts-Karte ──────────────────────────────────────────────────────────

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
        <button
          type="button"
          onClick={handleErledigt}
          disabled={pending}
          title={a.erledigt ? 'Als offen markieren' : 'Als erledigt markieren'}
          className={`mt-0.5 w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-colors disabled:opacity-50 ${
            a.erledigt
              ? 'bg-green-500 border-green-500 text-white'
              : 'bg-white border-gray-300 hover:border-green-400 text-transparent'
          }`}
        >
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
              {von}{bis ? `–${bis}` : ''}
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

// ── Hauptkomponente ───────────────────────────────────────────────────────────

type Tab = 'kontakte' | 'aktivitaeten' | 'pipeline'

export default function FirmaDetailClient({
  firma, kontakte, aktivitaeten, pipeline, writeOk,
}: {
  firma: FirmaRow
  kontakte: KontaktRow[]
  aktivitaeten: AktivitaetRow[]
  pipeline: PipelineEintragRow[]
  writeOk: boolean
}) {
  const [tab, setTab] = useState<Tab>('kontakte')
  const [showAktForm, setShowAktForm] = useState(false)
  const [showPipelineForm, setShowPipelineForm] = useState(false)

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-2 text-sm text-s112-muted">
        <Link href="/crm/firmen" className="hover:text-s112-teal">Firmen</Link>
        <span>/</span>
        <span className="text-gray-800 font-medium">{firma.name}</span>
      </nav>

      {/* Kopfbereich */}
      <div className="card p-5">
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 rounded-lg bg-s112-teal/10 flex items-center justify-center text-s112-teal font-bold text-lg flex-shrink-0">
            {firma.name[0].toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-2xl font-bold text-gray-900">{firma.name}</h1>
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${segmentFarbe(firma.segment)}`}>
                {segmentLabel(firma.segment)}
              </span>
              {firma.land && firma.land !== 'AT' && (
                <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 font-medium">{firma.land}</span>
              )}
            </div>
            <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1">
              {firma.email && (
                <a href={`mailto:${firma.email}`} className="text-sm text-s112-teal hover:underline flex items-center gap-1">
                  <span>✉</span> {firma.email}
                </a>
              )}
              {firma.telefon && (
                <span className="text-sm text-gray-600 flex items-center gap-1">
                  <span>📞</span> {firma.telefon}
                </span>
              )}
              {firma.website && (
                <a href={firma.website} target="_blank" rel="noopener noreferrer"
                  className="text-sm text-s112-teal hover:underline flex items-center gap-1">
                  <span>🌐</span> {firma.website.replace(/^https?:\/\//, '')}
                </a>
              )}
              {(firma.plz || firma.ort) && (
                <span className="text-sm text-gray-600 flex items-center gap-1">
                  <span>📍</span> {[firma.strasse, firma.plz && firma.ort ? `${firma.plz} ${firma.ort}` : (firma.plz ?? firma.ort)].filter(Boolean).join(', ')}
                </span>
              )}
              {firma.uid_nummer && (
                <span className="text-sm text-gray-600">UID: {firma.uid_nummer}</span>
              )}
              {firma.zahlungsziel_tage != null && (
                <span className="text-sm text-gray-600">Zahlungsziel: {firma.zahlungsziel_tage} Tage</span>
              )}
            </div>
            {firma.notizen && (
              <p className="mt-2 text-sm text-gray-500 italic">{firma.notizen}</p>
            )}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-s112-border">
        <div className="flex gap-0">
          {([
            { id: 'kontakte',     label: `Kontakte (${kontakte.length})`        },
            { id: 'aktivitaeten', label: `Aktivitaeten (${aktivitaeten.length})` },
            { id: 'pipeline',     label: `Pipeline (${pipeline.length})`        },
          ] as { id: Tab; label: string }[]).map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                tab === t.id
                  ? 'border-s112-teal text-s112-teal'
                  : 'border-transparent text-s112-muted hover:text-gray-700'
              }`}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab: Kontakte */}
      {tab === 'kontakte' && (
        <div className="space-y-2">
          {kontakte.length === 0 ? (
            <div className="card p-6 text-center text-s112-muted text-sm">
              Keine Kontakte zu dieser Firma.
            </div>
          ) : kontakte.map(k => {
            const kName = [k.vorname, k.nachname].filter(Boolean).join(' ')
            return (
              <div key={k.id} className="card p-4 flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-s112-teal/10 flex items-center justify-center text-s112-teal font-semibold text-sm flex-shrink-0">
                  {(k.vorname?.[0] ?? k.nachname[0]).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Link href={`/crm/kontakte/${k.id}`}
                      className="text-sm font-medium text-gray-800 hover:text-s112-teal hover:underline">
                      {kName}
                    </Link>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${segmentFarbe(k.segment)}`}>
                      {segmentLabel(k.segment)}
                    </span>
                    {k.stammkunde && (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-s112-yellow/20 text-amber-700 font-medium">Stammkunde</span>
                    )}
                  </div>
                  {k.email && (
                    <a href={`mailto:${k.email}`} className="text-xs text-s112-teal hover:underline">{k.email}</a>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Tab: Aktivitaeten */}
      {tab === 'aktivitaeten' && (
        <div className="space-y-3">
          <div className="flex justify-end">
            {writeOk && !showAktForm && (
              <button onClick={() => setShowAktForm(true)}
                className="text-xs font-medium text-s112-teal border border-s112-teal/30 rounded-full px-2.5 py-0.5 hover:bg-s112-teal hover:text-white transition-colors">
                + Aktivitaet
              </button>
            )}
          </div>

          {showAktForm && (
            <AktivitaetForm firmaId={firma.id} onDone={() => setShowAktForm(false)} />
          )}

          {aktivitaeten.length === 0 && !showAktForm ? (
            <div className="card p-6 text-center text-s112-muted text-sm">
              Noch keine Aktivitaeten erfasst.
            </div>
          ) : (
            <div className="space-y-2">
              {aktivitaeten.map(a => (
                <AktivitaetKarte key={a.id} a={a} writeOk={writeOk} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Tab: Pipeline */}
      {tab === 'pipeline' && (
        <div className="space-y-3">
          <div className="flex justify-end">
            {writeOk && !showPipelineForm && (
              <button onClick={() => setShowPipelineForm(true)}
                className="text-xs font-medium text-s112-teal border border-s112-teal/30 rounded-full px-2.5 py-0.5 hover:bg-s112-teal hover:text-white transition-colors">
                + Pipeline-Eintrag
              </button>
            )}
          </div>

          {showPipelineForm && (
            <PipelineForm firmaId={firma.id} onDone={() => setShowPipelineForm(false)} />
          )}

          {pipeline.length === 0 && !showPipelineForm ? (
            <div className="card p-6 text-center text-s112-muted text-sm">
              Noch keine Pipeline-Eintraege zu dieser Firma.
            </div>
          ) : (
            <div className="space-y-2">
              {pipeline.map(p => {
                const stufeDef = PIPELINE_STUFEN.find(s => s.value === p.stufe)
                const abschluss = p.erwartetes_datum
                  ? new Date(p.erwartetes_datum).toLocaleDateString('de-AT')
                  : null
                return (
                  <div key={p.id} className="card p-4 space-y-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`text-xs px-2.5 py-0.5 rounded-full font-semibold ${stufeDef?.farbe ?? 'bg-gray-100 text-gray-700'}`}>
                        {stufeDef?.label ?? p.stufe}
                      </span>
                      <span className="text-sm font-medium text-gray-800">{p.titel}</span>
                    </div>
                    <div className="flex gap-4 text-xs text-s112-muted flex-wrap">
                      {p.wert_euro != null && (
                        <span className="font-semibold text-s112-teal">
                          {p.wert_euro.toLocaleString('de-AT', { style: 'currency', currency: 'EUR' })}
                        </span>
                      )}
                      {p.wahrscheinlichkeit != null && <span>{p.wahrscheinlichkeit}%</span>}
                      {abschluss && <span>{abschluss}</span>}
                    </div>
                    {p.notizen && (
                      <p className="text-xs text-gray-500 italic">{p.notizen}</p>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
