'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { createAktivitaet, createPipelineEintrag, toggleAktivitaetErledigt, updateAktivitaet, deleteAktivitaet } from '../../actions'
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
          {AKTIVITAET_ARTEN.filter(a => !('nurAnzeige' in a)).map(a => <option key={a.value} value={a.value}>{a.icon} {a.label}</option>)}
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

function AktivitaetKarte({ a, writeOk, kontaktEmail }: { a: AktivitaetRow; writeOk: boolean; kontaktEmail?: string }) {
  const [pending, startTransition] = useTransition()
  const [editMode, setEditMode]   = useState(false)
  const [replyOpen, setReplyOpen]   = useState(false)
  const [replyText, setReplyText]   = useState('')
  const [replySending, setReplySending] = useState(false)
  const [emailOpen, setEmailOpen]   = useState(false)
  const [ganztags, setGanztags]   = useState(a.ganztags ?? true)
  const artDef = AKTIVITAET_ARTEN.find(x => x.value === a.art)
  const von = fmtUhrzeit(a.uhrzeit_von)
  const bis = fmtUhrzeit(a.uhrzeit_bis)

  function handleErledigt() {
    startTransition(async () => { await toggleAktivitaetErledigt(a.id, !a.erledigt) })
  }

  function handleSave(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    startTransition(async () => {
      await updateAktivitaet(a.id, fd)
      setEditMode(false)
    })
  }

  function handleDelete() {
    if (!confirm('Aktivität wirklich löschen?')) return
    startTransition(async () => { await deleteAktivitaet(a.id) })
  }

  // Verkauf-Aktivität: kein Erledigt-Toggle, kein Strikethrough, UUID → Link
  if (a.art === 'verkauf') {
    const postenId = a.beschreibung?.replace('Verkaufsposten: ', '') ?? null
    const isStorniert = a.betreff?.includes('STORNIERT')
    return (
      <div className="card p-4 flex gap-3">
        <div className="flex-shrink-0 w-8 h-8 rounded-full bg-s112-bg flex items-center justify-center text-base">
          🧾
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-s112-muted tabular-nums">
              {new Date(a.datum).toLocaleDateString('de-AT')}
            </span>
            <span className="text-xs font-medium text-s112-teal">Verkauf</span>
            {isStorniert && (
              <span className="text-xs px-1.5 py-0.5 rounded-full bg-red-100 text-red-700 font-medium">Storniert</span>
            )}
          </div>
          <p className="text-sm font-medium text-gray-800 mt-0.5">{a.betreff}</p>
          {postenId && postenId !== a.beschreibung && (
            <a href={`/weinhandel/verkauf/${postenId}`}
              className="text-xs text-s112-teal hover:underline mt-0.5 inline-block">
              → Beleg ansehen
            </a>
          )}
        </div>
      </div>
    )
  }

  // Edit-Modus
  if (editMode) {
    return (
      <div className="card p-4 border-s112-teal/30">
        <form onSubmit={handleSave} className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Art</label>
              <select name="art" defaultValue={a.art} className={inputCls()}>
                {a.art === 'email' && <input type="hidden" name="art" value="email" />}
                {AKTIVITAET_ARTEN.filter(x => !('nurAnzeige' in x) || x.value === a.art).map(x => (
                  <option key={x.value} value={x.value} disabled={'nurAnzeige' in x}>{x.icon} {x.label}{('nurAnzeige' in x) ? ' (automatisch)' : ''}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Datum</label>
              <input type="date" name="datum" defaultValue={a.datum ?? ''} required className={inputCls()} />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Betreff</label>
            <input type="text" name="betreff" defaultValue={a.betreff ?? ''} className={inputCls()} />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Notiz</label>
            <textarea name="beschreibung" defaultValue={a.beschreibung ?? ''} rows={2} className={inputCls()} />
          </div>
          <div className="flex items-center gap-4 flex-wrap text-xs">
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={ganztags}
                onChange={e => setGanztags(e.target.checked)}
                className="rounded"
              />
              <input type="hidden" name="ganztags" value={String(ganztags)} />
              Ganztags
            </label>
            {!ganztags && (
              <div className="flex items-center gap-1.5">
                <input type="time" name="uhrzeit_von" defaultValue={a.uhrzeit_von ?? ''} className="border border-s112-border rounded px-2 py-1 text-xs focus:outline-none" />
                <span className="text-gray-400">–</span>
                <input type="time" name="uhrzeit_bis" defaultValue={a.uhrzeit_bis ?? ''} className="border border-s112-border rounded px-2 py-1 text-xs focus:outline-none" />
              </div>
            )}
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input type="checkbox" name="erledigt" value="true" defaultChecked={a.erledigt ?? false} className="rounded" />
              Erledigt
            </label>
          </div>
          <div className="flex gap-2 pt-1">
            <button type="submit" disabled={pending}
              className="bg-s112-teal text-white px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-opacity-90 disabled:opacity-40">
              {pending ? 'Speichern…' : 'Speichern'}
            </button>
            <button type="button" onClick={() => setEditMode(false)}
              className="text-xs px-3 py-1.5 rounded-lg border border-s112-border text-gray-600 hover:bg-s112-bg">
              Abbrechen
            </button>
            <button type="button" onClick={handleDelete} disabled={pending}
              className="ml-auto text-xs px-3 py-1.5 rounded-lg text-red-500 hover:bg-red-50 border border-red-200 disabled:opacity-40">
              Löschen
            </button>
          </div>
        </form>
      </div>
    )
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
              {von}{bis ? `–${bis}` : ''}
            </span>
          )}
          <span className="text-xs text-s112-muted">{artDef?.label ?? a.art}</span>
        </div>
        {a.art === 'email' ? (
          <button type="button" onClick={() => setEmailOpen(v => !v)}
            className={`text-sm font-medium text-left w-full ${a.email_body ? 'text-s112-teal hover:underline' : 'text-gray-800'} mt-0.5 block ${a.erledigt ? 'line-through opacity-50' : ''}`}>
            {a.betreff} {a.email_body ? (emailOpen ? '▴' : '▾') : ''}
          </button>
        ) : (
          <p className={`text-sm font-medium text-gray-800 mt-0.5 ${a.erledigt ? 'line-through text-gray-400' : ''}`}>
            {a.betreff}
          </p>
        )}
        {a.art === 'email' && emailOpen && a.email_body && (
          <div className="mt-2 border border-s112-border rounded-lg overflow-hidden">
            <div className="bg-s112-bg px-3 py-1.5 text-[10px] text-s112-muted space-y-0.5">
              {a.email_von && <div><span className="font-medium">Von:</span> {a.email_von_name ? `${a.email_von_name} <${a.email_von}>` : a.email_von}</div>}
              {a.email_an  && <div><span className="font-medium">An:</span> {a.email_an}</div>}
            </div>
            {a.email_body_html
              ? <div className="px-3 py-2 text-xs text-gray-700 prose prose-xs max-w-none"
                  dangerouslySetInnerHTML={{ __html: a.email_body_html }} />
              : <pre className="px-3 py-2 text-xs text-gray-700 whitespace-pre-wrap font-sans">{a.email_body}</pre>
            }
          </div>
        )}
        {a.beschreibung && !emailOpen && a.art !== 'email' && (
          <p className="text-xs text-gray-500 mt-0.5">{a.beschreibung}</p>
        )}
        {/* Inline-Antworten für Email-Aktivitäten */}
        {a.art === 'email' && replyOpen && (
          <div className="mt-2 space-y-2">
            <textarea value={replyText} onChange={e => setReplyText(e.target.value)} rows={3}
              placeholder={`Antwort an ${kontaktEmail ?? '...'}`}
              className="w-full border border-s112-border rounded-lg px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-s112-teal/40 resize-none" />
            <div className="flex gap-2">
              <button type="button" disabled={replySending || !replyText.trim()} onClick={async () => {
                if (!kontaktEmail || !replyText.trim()) return
                setReplySending(true)
                await fetch('/api/email/unified', {
                  method: 'POST', headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ an: kontaktEmail, betreff: `Re: ${a.betreff ?? ''}`, text: replyText }),
                })
                setReplySending(false); setReplyOpen(false); setReplyText('')
              }} className="text-xs bg-s112-teal text-white px-3 py-1.5 rounded-lg hover:bg-opacity-90 disabled:opacity-40">
                {replySending ? 'Senden…' : '↩ Senden'}
              </button>
              <button type="button" onClick={() => setReplyOpen(false)}
                className="text-xs border border-s112-border text-gray-600 px-3 py-1.5 rounded-lg hover:bg-s112-bg">
                Abbrechen
              </button>
            </div>
          </div>
        )}
      </div>
      <div className="flex flex-col gap-1 flex-shrink-0">
        {a.art === 'email' && kontaktEmail && !replyOpen && (
          <button type="button" onClick={() => setReplyOpen(true)} title="Antworten"
            className="text-xs text-s112-teal border border-s112-teal/30 px-2 py-1 rounded-lg hover:bg-s112-teal/5">
            ↩
          </button>
        )}
        {writeOk && a.art === 'email' && (
          <button type="button" title="Email-Aktivität löschen"
            onClick={() => { if (confirm('Email aus Aktivitätenliste entfernen?')) startTransition(async () => { await deleteAktivitaet(a.id) }) }}
            className="text-gray-300 hover:text-red-400 transition-colors text-sm leading-none">
            ✕
          </button>
        )}
        {writeOk && a.art !== 'email' && (
          <button type="button" onClick={() => setEditMode(true)} title="Bearbeiten"
            className="text-gray-300 hover:text-s112-teal transition-colors text-base leading-none">
            ✏
          </button>
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
  const [showEmailModal, setShowEmailModal] = useState(false)
  const [emailBetreff, setEmailBetreff]   = useState('')
  const [emailText, setEmailText]         = useState('')
  const [emailSending, setEmailSending]   = useState(false)
  const [emailResult, setEmailResult]     = useState<string | null>(null)

  async function sendEmail(e: React.FormEvent) {
    e.preventDefault()
    setEmailSending(true); setEmailResult(null)
    try {
      const res = await fetch('/api/email/unified', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          an: kontakt.email, betreff: emailBetreff, text: emailText,
          kontakt_id: kontakt.id,
        }),
      })
      const json = await res.json()
      if (!res.ok || json.fehler) { setEmailResult('Fehler: ' + (json.fehler ?? 'Unbekannt')); return }
      setEmailResult('✓ E-Mail gesendet'); setEmailBetreff(''); setEmailText('')
      setTimeout(() => { setShowEmailModal(false); setEmailResult(null) }, 1500)
    } catch (err) { setEmailResult('Fehler: ' + String(err)) }
    finally { setEmailSending(false) }
  }

  const [showAktForm, setShowAktForm] = useState(false)
  const [notizText, setNotizText]   = useState('')
  const [notizLaden, setNotizLaden] = useState(false)
  const [expandedThreads, setExpandedThreads] = useState<Set<string>>(new Set())

  // E-Mail-Aktivitäten nach email_conversation_id gruppieren
  function groupEmailsByThread(akts: AktivitaetRow[]) {
    const threads: Record<string, AktivitaetRow[]> = {}
    const singles: AktivitaetRow[] = []
    akts.forEach(a => {
      if (a.art !== 'email') { singles.push(a); return }
      const cid = a.email_conversation_id
      if (!cid) { singles.push(a); return }
      if (!threads[cid]) threads[cid] = []
      threads[cid].push(a)
    })
    Object.entries(threads).forEach(([cid, msgs]) => {
      if (msgs.length === 1) singles.push(msgs[0])
    })
    return { threads: Object.fromEntries(Object.entries(threads).filter(([,m]) => m.length > 1)), singles }
  }
  const [copiedNum, setCopiedNum] = useState<string | null>(null)

  function handlePhoneClick(e: React.MouseEvent<HTMLAnchorElement>, fullNumber: string) {
    const isMobile = 'ontouchstart' in window || navigator.maxTouchPoints > 0
    if (!isMobile) {
      e.preventDefault()
      const num = fullNumber.replace(/[^+\d]/g, '')
      navigator.clipboard.writeText(num).catch(() => {})
      setCopiedNum(num)
      setTimeout(() => setCopiedNum(null), 2000)
    }
    // Mobile: normales tel:-Verhalten
  }
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
            {kontakt.is_lead && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 font-medium">🌱 Lead</span>
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
            <div className="flex items-center gap-3">
              <h2 className="text-base font-semibold text-gray-800">Aktivitäten</h2>
              <Link href="/crm" className="text-xs text-s112-muted hover:text-s112-teal">→ Kalender</Link>
            </div>
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
              {(() => {
                const { threads, singles } = groupEmailsByThread(aktivitaeten.filter(a => a.art !== 'verkauf' && a.art !== 'notiz'))
                return (
                  <>
                    {/* E-Mail-Threads */}
                    {Object.entries(threads).map(([threadId, msgs]) => {
                      const expanded = expandedThreads.has(threadId)
                      const latest = msgs[msgs.length - 1]
                      return (
                        <div key={threadId} className="border border-s112-border rounded-xl overflow-hidden">
                          <button type="button"
                            onClick={() => setExpandedThreads(prev => {
                              const next = new Set(prev)
                              expanded ? next.delete(threadId) : next.add(threadId)
                              return next
                            })}
                            className="w-full flex items-center gap-3 px-4 py-2.5 bg-blue-50 hover:bg-blue-100 transition-colors text-left">
                            <span className="text-base">✉️</span>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium text-gray-800 truncate">{latest.betreff}</p>
                              <p className="text-xs text-s112-muted">{msgs.length} E-Mail{msgs.length !== 1 ? 's' : ''} · {new Date(latest.datum).toLocaleDateString('de-AT')} · {expanded ? 'einklappen ▴' : 'ausklappen ▾'}</p>
                            </div>
                            <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-semibold">{msgs.length}</span>
                          </button>
                          {expanded && (
                            <div className="divide-y divide-s112-border/40">
                              {msgs.map(a => <AktivitaetKarte key={a.id} a={a} writeOk={writeOk} kontaktEmail={kontakt.email ?? undefined} />)}
                            </div>
                          )}
                        </div>
                      )
                    })}
                    {/* Einzelne Aktivitäten */}
                    {singles.map(a => <AktivitaetKarte key={a.id} a={a} writeOk={writeOk} kontaktEmail={kontakt.email ?? undefined} />)}
                  </>
                )
              })()}
            </div>
          )}
        </div>

        <div className="space-y-4">
          <h2 className="text-base font-semibold text-gray-800">Informationen</h2>

          <div className="card p-4 space-y-2">
            <h2 className="text-sm font-semibold text-gray-800 mb-3">Kontaktdaten</h2>
            {kontakt.email && (
              <div className="flex items-center gap-2 text-sm">
                <span className="text-lg">✉️</span>
                <a href={`mailto:${kontakt.email}`} className="text-s112-teal hover:underline">{kontakt.email}</a>
                {writeOk && (
                  <button onClick={() => setShowEmailModal(true)}
                    className="ml-auto text-xs border border-s112-border px-2 py-0.5 rounded-lg text-gray-600 hover:bg-s112-bg flex-shrink-0">
                    ✉ Senden
                  </button>
                )}
              </div>
            )}
            {kontakt.telefon && (
              <div className="flex items-center gap-2 text-sm">
                <span className="text-lg">📞</span>
                <a href={`tel:${kontakt.telefon_vorwahl ?? '+43'}${kontakt.telefon?.replace(/\s/g, '')}`} onClick={e => handlePhoneClick(e, `${kontakt.telefon_vorwahl ?? '+43'} ${kontakt.telefon}`)} className="text-gray-700 hover:text-s112-teal cursor-pointer">{kontakt.telefon_vorwahl ?? '+43'} {kontakt.telefon}</a>
              </div>
            )}
            {kontakt.mobil && (
              <div className="flex items-center gap-2 text-sm">
                <span className="text-lg">📱</span>
                <a href={`tel:${kontakt.mobil_vorwahl ?? '+43'}${kontakt.mobil?.replace(/\s/g, '')}`} onClick={e => handlePhoneClick(e, `${kontakt.mobil_vorwahl ?? '+43'} ${kontakt.mobil}`)} className="text-gray-700 hover:text-s112-teal cursor-pointer">{kontakt.mobil_vorwahl ?? '+43'} {kontakt.mobil}</a>
              </div>
            )}
            {kontakt.strasse && (
              <div className="flex items-center gap-2 text-sm">
                <span className="text-lg">🏠</span>
                <span className="text-gray-700">{kontakt.strasse}</span>
              </div>
            )}
            {kontakt.ort && (
              <div className="flex items-center gap-2 text-sm">
                <span className="text-lg">📍</span>
                <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([kontakt.strasse, kontakt.plz, kontakt.ort, kontakt.land ?? 'Österreich'].filter(Boolean).join(', '))}`} target="_blank" rel="noopener noreferrer" className="text-gray-700 hover:text-s112-teal">{kontakt.plz ? `${kontakt.plz} ` : ''}{kontakt.ort}{kontakt.land && kontakt.land !== 'AT' ? `, ${kontakt.land}` : ''}</a>
              </div>
            )}
            {kontakt.firma_name && (
              <div className="flex items-center gap-2 text-sm">
                <span className="text-lg">🏢</span>
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
          {/* ── Notizen ── */}
          <div className="card p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-800">Notizen</h2>
              <span className="text-xs text-s112-muted">{aktivitaeten.filter(a => a.art === 'notiz').length} Einträge</span>
            </div>
            {/* Neue Notiz */}
            {writeOk && (
              <form onSubmit={async e => {
                e.preventDefault()
                if (!notizText.trim()) return
                setNotizLaden(true)
                const fd = new FormData()
                fd.set('kontakt_id', kontakt.id); fd.set('art', 'notiz'); fd.set('betreff', notizText); fd.set('datum', new Date().toISOString().split('T')[0]); fd.set('ganztags', 'true'); fd.set('erledigt', 'false')
                await createAktivitaet(fd)
                setNotizText(''); setNotizLaden(false)
              }} className="flex gap-2">
                <input value={notizText} onChange={e => setNotizText(e.target.value)}
                  placeholder="Neue Notiz…" required
                  className="flex-1 border border-s112-border rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-s112-teal/40" />
                <button type="submit" disabled={notizLaden}
                  className="bg-s112-teal text-white px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-opacity-90 disabled:opacity-40">
                  +
                </button>
              </form>
            )}
            {/* Notizen-Liste */}
            <div className="space-y-1 max-h-48 overflow-y-auto">
              {[...aktivitaeten.filter(a => a.art === 'notiz')].sort((a,b) => Number(a.erledigt) - Number(b.erledigt)).map(n => (
                <div key={n.id} className={`flex items-start gap-2 py-1.5 border-b border-s112-border/30 last:border-0 ${n.erledigt ? 'opacity-50' : ''}`}>
                  <button type="button" onClick={() => toggleAktivitaetErledigt(n.id, !n.erledigt)}
                    className={`mt-0.5 w-4 h-4 rounded border flex-shrink-0 flex items-center justify-center ${n.erledigt ? 'bg-green-500 border-green-500' : 'border-gray-300'}`}>
                    {n.erledigt && <svg className="w-2.5 h-2.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>}
                  </button>
                  <div className="flex-1 min-w-0">
                    <p className={`text-xs ${n.erledigt ? 'line-through text-gray-400' : 'text-gray-700'}`}>{n.betreff}</p>
                    <p className="text-[10px] text-s112-muted">{new Date(n.datum).toLocaleDateString('de-AT')}</p>
                  </div>
                </div>
              ))}
              {aktivitaeten.filter(a => a.art === 'notiz').length === 0 && (
                <p className="text-xs text-s112-muted text-center py-2">Noch keine Notizen</p>
              )}
            </div>
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
                    <div key={p.id} className="border border-s112-border/60 rounded-lg p-3 space-y-1 hover:border-s112-teal/40 transition-colors">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${stufeDef?.farbe ?? 'bg-gray-100 text-gray-700'}`}>
                            {stufeDef?.label ?? p.stufe}
                          </span>
                          {p.erledigt && (
                            <span className="text-xs px-1.5 py-0.5 rounded-full bg-green-100 text-green-700 font-medium">Erledigt</span>
                          )}
                        </div>
                        <Link href="/crm/pipeline" className="text-xs text-s112-teal hover:underline flex-shrink-0">→ Pipeline</Link>
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

              {/* Verkäufe aus Aktivitäten-Log */}
              {(() => {
                const verkaufAkts = aktivitaeten.filter(a => a.art === 'verkauf').sort((a, b) => {
        const dateDiff = new Date(b.datum).getTime() - new Date(a.datum).getTime()
        if (dateDiff !== 0) return dateDiff
        // Gleicher Tag: nach Rechnungsnummer (im betreff) absteigend
        return (b.betreff ?? '').localeCompare(a.betreff ?? '', 'de', { numeric: true })
      })
                if (verkaufAkts.length === 0) return null
                return (
                  <div className="card p-4 space-y-2">
                    <h2 className="text-sm font-semibold text-gray-800 mb-3">Verkäufe ({verkaufAkts.length})</h2>
                    <div className="space-y-1">
                      {verkaufAkts.map(a => {
                        const postenId = a.beschreibung?.replace('Verkaufsposten: ', '') ?? null
                        const isStorniert = a.betreff?.includes('STORNIERT')
                        const isBezahlt  = a.betreff?.includes('Bezahlt')
                        return (
                          <div key={a.id} className="flex items-center justify-between text-xs py-1.5 border-b border-s112-border/40 last:border-0">
                            <div className="flex-1 min-w-0">
                              <span className="tabular-nums text-s112-muted mr-2">{new Date(a.datum).toLocaleDateString('de-AT')}</span>
                              <span className="font-medium text-gray-800">{a.betreff}</span>
                            </div>
                            <div className="flex items-center gap-2 ml-2 flex-shrink-0">
                              {isStorniert && <span className="px-1.5 py-0.5 rounded-full bg-red-100 text-red-700 font-medium">Storniert</span>}
                              {isBezahlt  && <span className="px-1.5 py-0.5 rounded-full bg-green-100 text-green-700 font-medium">Bezahlt</span>}
                              {!isStorniert && !isBezahlt && <span className="px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 font-medium">Offen</span>}
                              {postenId && (
                                <a href={`/weinhandel/verkauf/${postenId}`}
                                  className="text-s112-teal hover:underline">→</a>
                              )}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )
              })()}

        </div>
      </div>

      {/* ── E-Mail senden Modal ── */}
      {showEmailModal && kontakt.email && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          onClick={() => setShowEmailModal(false)}>
          <div className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-md mx-4"
            onClick={e => e.stopPropagation()}>
            <h3 className="text-base font-bold text-gray-900 mb-4">✉ E-Mail senden</h3>
            <form onSubmit={sendEmail} className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">An</label>
                <input value={kontakt.email} readOnly className="w-full border border-s112-border rounded-lg px-3 py-1.5 text-sm bg-s112-bg" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Betreff *</label>
                <input value={emailBetreff} onChange={e => setEmailBetreff(e.target.value)} required autoFocus
                  className="w-full border border-s112-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Nachricht</label>
                <textarea value={emailText} onChange={e => setEmailText(e.target.value)} rows={5}
                  className="w-full border border-s112-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40 resize-none" />
              </div>
              {emailResult && <p className={`text-xs font-medium ${emailResult.startsWith('✓') ? 'text-green-600' : 'text-red-600'}`}>{emailResult}</p>}
              <div className="flex gap-2 pt-1">
                <button type="submit" disabled={emailSending}
                  className="bg-s112-teal text-white px-4 py-1.5 rounded-lg text-sm font-medium hover:bg-opacity-90 disabled:opacity-40">
                  {emailSending ? 'Senden…' : '✉ Senden'}
                </button>
                <button type="button" onClick={() => setShowEmailModal(false)}
                  className="text-sm px-4 py-1.5 rounded-lg border border-s112-border text-gray-600 hover:bg-s112-bg">
                  Abbrechen
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Kopiert-Toast */}
      {copiedNum && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-gray-900 text-white text-sm px-4 py-2 rounded-xl shadow-lg">
          📋 {copiedNum} kopiert
        </div>
      )}
    </div>
  )
}
