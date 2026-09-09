'use client'
import { useState, useTransition, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { X, Pencil, Trash2 } from 'lucide-react'
import type { Zeiteintrag } from './page'
import { createZeiteintrag, updateZeiteintrag, deleteZeiteintrag } from './actions'
import { fmtNum } from '@/lib/format'

// ── Phasen ────────────────────────────────────────────────────────────────────

const PHASEN = [
  { nr: 0, label: 'Phase 0 – Setup',        bg: 'bg-[#F2F3F5]',   text: 'text-s112-text-1'  },
  { nr: 1, label: 'Phase 1 – Grundmodul',   bg: 'bg-s112-blue-50',    text: 'text-s112-blue-700'  },
  { nr: 2, label: 'Phase 2 – Kellerbuch',   bg: 'bg-s112-ok-bg',   text: 'text-s112-ok-fg' },
  { nr: 3, label: 'Phase 3 – CRM & KI',     bg: 'bg-s112-warn-bg',  text: 'text-s112-warn-fg'},
  { nr: 4, label: 'Phase 4 – Abschluss',    bg: 'bg-s112-warn-bg',  text: 'text-s112-warn-fg'},
]

function phaseMeta(nr: number) {
  return PHASEN.find(p => p.nr === nr) ?? PHASEN[0]
}

// ── Hilfsfunktionen ───────────────────────────────────────────────────────────

function fmtEuro(v: number | null | undefined) {
  if (v == null) return '–'
  return fmtNum(v, 2) + ' €'
}

function fmtH(v: number) {
  return fmtNum(v, { min: 1, max: 2 }) + ' h'
}

function fmtDate(d: string) {
  return new Date(d + 'T12:00:00').toLocaleDateString('de-AT', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

const inputCls = 'border border-s112-border rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-s112-teal w-full'

// ── Formular ──────────────────────────────────────────────────────────────────

function ZeitForm({
  initial,
  onSave,
  onCancel,
}: {
  initial?: Zeiteintrag
  onSave: (fd: FormData) => Promise<void>
  onCancel: () => void
}) {
  const [pending, startTransition] = useTransition()
  const [err, setErr] = useState<string | null>(null)
  const today = new Date().toISOString().split('T')[0]

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setErr(null)
    const fd = new FormData(e.currentTarget)
    startTransition(async () => {
      try { await onSave(fd) }
      catch (ex) { setErr(ex instanceof Error ? ex.message : 'Fehler') }
    })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-s112-text-2 mb-1">Datum *</label>
          <input type="date" name="datum" required defaultValue={initial?.datum ?? today} className={inputCls} />
        </div>
        <div>
          <label className="block text-xs font-medium text-s112-text-2 mb-1">Phase *</label>
          <select name="phase" defaultValue={initial?.phase ?? 0} className={inputCls}>
            {PHASEN.map(p => (
              <option key={p.nr} value={p.nr}>{p.label}</option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label className="block text-xs font-medium text-s112-text-2 mb-1">Beschreibung *</label>
        <textarea name="beschreibung" required rows={3}
          defaultValue={initial?.beschreibung ?? ''}
          className={inputCls + ' resize-none'} />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-s112-text-2 mb-1">Stunden *</label>
          <input type="number" name="stunden" required step="0.25" min="0"
            defaultValue={initial?.stunden ?? ''} className={inputCls} />
        </div>
        <div>
          <label className="block text-xs font-medium text-s112-text-2 mb-1">Stundensatz (€)</label>
          <input type="number" name="stundensatz" step="1" min="0"
            defaultValue={initial?.stundensatz ?? 50} className={inputCls} />
        </div>
      </div>

      <div className="border-t border-s112-border/40 pt-3">
        <p className="text-xs font-medium text-s112-text-2 mb-2">Claude Token-Verbrauch (optional)</p>
        <div className="grid grid-cols-3 gap-2">
          <div>
            <label className="block text-xs text-s112-text-2 mb-1">Input Tokens</label>
            <input type="number" name="tokens_input" min="0"
              defaultValue={initial?.tokens_input ?? ''} className={inputCls} />
          </div>
          <div>
            <label className="block text-xs text-s112-text-2 mb-1">Output Tokens</label>
            <input type="number" name="tokens_output" min="0"
              defaultValue={initial?.tokens_output ?? ''} className={inputCls} />
          </div>
          <div>
            <label className="block text-xs text-s112-text-2 mb-1">Kosten (€)</label>
            <input type="number" name="token_kosten_euro" step="0.0001" min="0"
              defaultValue={initial?.token_kosten_euro ?? ''} className={inputCls} />
          </div>
        </div>
      </div>

      {err && <p className="text-xs text-s112-err-fg">{err}</p>}

      <div className="flex gap-2 pt-1">
        <button type="submit" disabled={pending}
          className="bg-s112-teal text-white px-4 py-1.5 rounded-lg text-sm font-semibold hover:bg-opacity-90 disabled:opacity-40">
          {pending ? 'Speichern…' : 'Speichern'}
        </button>
        <button type="button" onClick={onCancel}
          className="text-sm px-4 py-1.5 rounded-lg border border-s112-border text-s112-text-2 hover:bg-s112-bg">
          Abbrechen
        </button>
      </div>
    </form>
  )
}

// ── Modal ─────────────────────────────────────────────────────────────────────

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl p-6 w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-s112-text text-base">{title}</h3>
          <button onClick={onClose} className="text-s112-muted hover:text-s112-text-1"><X className="w-5 h-5" /></button>
        </div>
        {children}
      </div>
    </div>
  )
}

// ── Hauptkomponente ───────────────────────────────────────────────────────────

export default function ZeiterfassungClient({ eintraege }: { eintraege: Zeiteintrag[] }) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [showNew,   setShowNew]   = useState(false)
  const [editEntry, setEditEntry] = useState<Zeiteintrag | null>(null)
  const [deleteId,  setDeleteId]  = useState<string | null>(null)
  const [delPending, startDel]    = useTransition()
  const [filterPhase, setFilterPhase] = useState<number | null>(null)

  const filtered = filterPhase === null ? eintraege : eintraege.filter(e => e.phase === filterPhase)

  const totals = useMemo(() => ({
    stunden:      eintraege.reduce((s, e) => s + e.stunden, 0),
    betrag:       eintraege.reduce((s, e) => s + e.stunden * e.stundensatz, 0),
    tokenKosten:    eintraege.reduce((s, e) => s + (e.token_kosten_euro ?? 0), 0),
    lizenzkosten:   eintraege.reduce((s, e) => s + (e.lizenzkosten_euro ?? 0), 0),
    tokensIn:     eintraege.reduce((s, e) => s + (e.tokens_input ?? 0), 0),
    tokensOut:    eintraege.reduce((s, e) => s + (e.tokens_output ?? 0), 0),
  }), [eintraege])

  function refresh() {
    startTransition(() => { router.refresh() })
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 text-sm text-s112-muted">
        <span>Administration</span>
        <span>/</span>
        <span className="text-s112-text-1 font-medium">Zeiterfassung</span>
      </div>
      {/* ── Header ── */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold text-s112-text">Zeiterfassung</h1>
          <p className="text-sm text-s112-muted mt-0.5">software:112 · IC&P Consultants</p>
        </div>
        <button onClick={() => setShowNew(true)}
          className="bg-s112-teal text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-opacity-90">
          + Neuer Eintrag
        </button>
      </div>

      {/* ── Summen-Chips ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Stunden gesamt',   value: fmtH(totals.stunden) },
          { label: 'Betrag gesamt',    value: fmtEuro(totals.betrag) },
          { label: 'Token-Kosten',     value: fmtEuro(totals.tokenKosten) },
          { label: 'Tokens (In/Out)',  value: `${fmtNum(totals.tokensIn)} / ${fmtNum(totals.tokensOut)}` },
          { label: 'Claude Lizenzkosten', value: fmtEuro(totals.lizenzkosten) },
        ].map(({ label, value }) => (
          <div key={label} className="bg-white border border-s112-border rounded-xl p-3 shadow-sm">
            <p className="text-xs text-s112-muted">{label}</p>
            <p className="text-lg font-semibold text-s112-text mt-0.5">{value}</p>
          </div>
        ))}
      </div>

      {/* ── Phasen-Filter ── */}
      <div className="flex flex-wrap gap-2">
        <button onClick={() => setFilterPhase(null)}
          className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${filterPhase === null ? 'bg-s112-teal text-white border-s112-teal' : 'bg-white text-s112-text-2 border-s112-border hover:bg-s112-bg'}`}>
          Alle
        </button>
        {PHASEN.map(p => (
          <button key={p.nr} onClick={() => setFilterPhase(filterPhase === p.nr ? null : p.nr)}
            className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${filterPhase === p.nr ? 'bg-s112-teal text-white border-s112-teal' : `${p.bg} ${p.text} border-transparent hover:opacity-80`}`}>
            {p.label}
          </button>
        ))}
      </div>

      {/* ── Tabelle ── */}
      <div className="bg-white border border-s112-border rounded-xl shadow-sm overflow-hidden">
        <div className="overflow-x-auto overflow-y-auto max-h-[65vh]">
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10">
              <tr className="border-b border-s112-border bg-s112-bg">
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-s112-text-2 whitespace-nowrap">Datum</th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-s112-text-2">Phase</th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-s112-text-2">Beschreibung</th>
                <th className="text-right px-4 py-2.5 text-xs font-semibold text-s112-text-2 whitespace-nowrap">Stunden</th>
                <th className="text-right px-4 py-2.5 text-xs font-semibold text-s112-text-2 whitespace-nowrap">€/h</th>
                <th className="text-right px-4 py-2.5 text-xs font-semibold text-s112-text-2 whitespace-nowrap">Betrag</th>
                <th className="text-right px-4 py-2.5 text-xs font-semibold text-s112-text-2 whitespace-nowrap">Tokens In</th>
                <th className="text-right px-4 py-2.5 text-xs font-semibold text-s112-text-2 whitespace-nowrap">Tokens Out</th>
                <th className="text-right px-4 py-2.5 text-xs font-semibold text-s112-text-2 whitespace-nowrap">Token-€</th>
                <th className="text-right px-4 py-2.5 text-xs font-semibold text-s112-text-2 whitespace-nowrap">Lizenz-€</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={10} className="px-4 py-8 text-center text-s112-muted text-sm">
                    Keine Einträge vorhanden.
                  </td>
                </tr>
              )}
              {filtered.map((e, i) => {
                const phase = phaseMeta(e.phase)
                const betrag = e.stunden * e.stundensatz
                return (
                  <tr key={e.id}
                    className={`border-b border-s112-border/40 hover:bg-s112-bg/50 transition-colors ${i % 2 === 0 ? '' : 'bg-s112-bg/30'}`}>
                    <td className={`px-4 py-2.5 whitespace-nowrap text-xs font-mono ${phase.text}`}>
                      {fmtDate(e.datum)}
                    </td>
                    <td className="px-4 py-2.5">
                      <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${phase.bg} ${phase.text}`}>
                        Ph.{e.phase}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-s112-text-1 max-w-xs">
                      <span className="line-clamp-2 text-xs">{e.beschreibung}</span>
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono text-xs text-s112-text-1 whitespace-nowrap">
                      {fmtH(e.stunden)}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono text-xs text-s112-text-2 whitespace-nowrap">
                      {e.stundensatz}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono text-xs font-semibold text-s112-text whitespace-nowrap">
                      {fmtEuro(betrag)}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono text-xs text-s112-text-2 whitespace-nowrap">
                      {(e.tokens_input == null ? undefined : fmtNum(e.tokens_input)) ?? '–'}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono text-xs text-s112-text-2 whitespace-nowrap">
                      {(e.tokens_output == null ? undefined : fmtNum(e.tokens_output)) ?? '–'}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono text-xs text-s112-text-2 whitespace-nowrap">
                      {fmtEuro(e.token_kosten_euro)}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono text-xs text-s112-text-2 whitespace-nowrap">
                      {fmtEuro(e.lizenzkosten_euro)}
                    </td>
                    <td className="px-4 py-2.5 whitespace-nowrap">
                      <div className="flex items-center gap-1 justify-end">
                        <button onClick={() => setEditEntry(e)}
                          className="text-s112-muted hover:text-s112-blue-700 p-1 rounded transition-colors" title="Bearbeiten">
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button onClick={() => setDeleteId(e.id)}
                          className="text-s112-muted hover:text-s112-err p-1 rounded transition-colors" title="Löschen">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
            {filtered.length > 0 && (
              <tfoot>
                <tr className="bg-s112-teal/5 border-t-2 border-s112-teal/20">
                  <td colSpan={3} className="px-4 py-2.5 text-xs font-semibold text-s112-text-1">
                    GESAMT ({filtered.length} Einträge{filterPhase !== null ? ` – ${phaseMeta(filterPhase).label}` : ''})
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono text-xs font-semibold text-s112-text whitespace-nowrap">
                    {fmtH(filtered.reduce((s, e) => s + e.stunden, 0))}
                  </td>
                  <td />
                  <td className="px-4 py-2.5 text-right font-mono text-xs font-semibold text-s112-blue-700 whitespace-nowrap">
                    {fmtEuro(filtered.reduce((s, e) => s + e.stunden * e.stundensatz, 0))}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono text-xs font-semibold text-s112-text-1 whitespace-nowrap">
                    {fmtNum(filtered.reduce((s, e) => s + (e.tokens_input ?? 0), 0))}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono text-xs font-semibold text-s112-text-1 whitespace-nowrap">
                    {fmtNum(filtered.reduce((s, e) => s + (e.tokens_output ?? 0), 0))}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono text-xs font-semibold text-s112-text-1 whitespace-nowrap">
                    {fmtEuro(filtered.reduce((s, e) => s + (e.token_kosten_euro ?? 0), 0))}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono text-xs font-semibold text-s112-text-1 whitespace-nowrap">
                    {fmtEuro(filtered.reduce((s, e) => s + (e.lizenzkosten_euro ?? 0), 0))}
                  </td>
                  <td />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      {/* ── Neu-Modal ── */}
      {showNew && (
        <Modal title="Neuer Zeiteintrag" onClose={() => setShowNew(false)}>
          <ZeitForm
            onSave={async (fd) => { await createZeiteintrag(fd); setShowNew(false); refresh() }}
            onCancel={() => setShowNew(false)}
          />
        </Modal>
      )}

      {/* ── Edit-Modal ── */}
      {editEntry && (
        <Modal title="Eintrag bearbeiten" onClose={() => setEditEntry(null)}>
          <ZeitForm
            initial={editEntry}
            onSave={async (fd) => { await updateZeiteintrag(editEntry.id, fd); setEditEntry(null); refresh() }}
            onCancel={() => setEditEntry(null)}
          />
        </Modal>
      )}

      {/* ── Löschen-Bestätigung ── */}
      {deleteId && (
        <Modal title="Eintrag löschen?" onClose={() => setDeleteId(null)}>
          <p className="text-sm text-s112-text-2 mb-4">Dieser Zeiteintrag wird unwiderruflich gelöscht.</p>
          <div className="flex gap-2">
            <button disabled={delPending}
              onClick={() => startDel(async () => {
                await deleteZeiteintrag(deleteId)
                setDeleteId(null)
                refresh()
              })}
              className="bg-s112-err text-white px-4 py-1.5 rounded-lg text-sm font-semibold hover:bg-s112-err-fg disabled:opacity-40">
              {delPending ? 'Löschen…' : 'Löschen'}
            </button>
            <button onClick={() => setDeleteId(null)}
              className="text-sm px-4 py-1.5 rounded-lg border border-s112-border text-s112-text-2 hover:bg-s112-bg">
              Abbrechen
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}
