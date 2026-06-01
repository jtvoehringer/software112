'use client'

import { useState, useEffect, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createKontakt, updateKontakt, deleteKontakt, createAktivitaet, createPipelineEintrag } from '../actions'
import { SEGMENTE, AKTIVITAET_ARTEN, PIPELINE_STUFEN, segmentLabel, segmentFarbe } from '@/lib/crm/types'
import type { KontaktRow } from '@/lib/crm/types'

type FirmaOption = { id: string; name: string; segment: string }
type RabattgruppeOption = { id: string; name: string; rabatt_pct: number }
type AktivitaetRow = {
  id: string; art: string; betreff: string | null
  beschreibung: string | null; datum: string; erledigt: boolean
}
type PipelineRow = {
  id: string; stufe: string; titel: string
  wert_euro: number | null; wahrscheinlichkeit: number | null; erwartetes_datum: string | null
}

// ── Hilfsfunktionen ───────────────────────────────────────────────────────────

const LAENDER = ['AT', 'DE', 'CH', 'IT', 'FR', 'HU', 'SK', 'CZ', 'US', 'GB']


const DIAL_CODES = [
  { code: '+43', flag: '🇦🇹', iso: 'AT' },
  { code: '+49', flag: '🇩🇪', iso: 'DE' },
  { code: '+41', flag: '🇨🇭', iso: 'CH' },
  { code: '+423', flag: '🇱🇮', iso: 'LI' },
  { code: '+39', flag: '🇮🇹', iso: 'IT' },
  { code: '+386', flag: '🇸🇮', iso: 'SI' },
  { code: '+421', flag: '🇸🇰', iso: 'SK' },
  { code: '+420', flag: '🇨🇿', iso: 'CZ' },
  { code: '+36', flag: '🇭🇺', iso: 'HU' },
  { code: '+33', flag: '🇫🇷', iso: 'FR' },
  { code: '+31', flag: '🇳🇱', iso: 'NL' },
  { code: '+32', flag: '🇧🇪', iso: 'BE' },
  { code: '+44', flag: '🇬🇧', iso: 'GB' },
  { code: '+48', flag: '🇵🇱', iso: 'PL' },
  { code: '+1',  flag: '🇺🇸', iso: 'US' },
]

function inputCls() {
  return 'w-full border border-s112-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40'
}

// ── Formular ──────────────────────────────────────────────────────────────────

function KontaktForm({
  initial, firmen, rabattgruppen, defaultSegment, onDone,
}: {
  initial?: KontaktRow | null
  firmen: FirmaOption[]
  rabattgruppen: RabattgruppeOption[]
  defaultSegment?: string
  onDone: () => void
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [stammkunde, setStammkunde] = useState(initial?.stammkunde ?? false)
  const [isLead, setIsLead]           = useState(initial?.is_lead ?? true)
  const [landVal, setLandVal]           = useState(initial?.land ?? 'AT')
  const [segmentVal, setSegmentVal] = useState(initial?.segment ?? defaultSegment ?? 'privat')
  const [saveError, setSaveError]   = useState<string | null>(null)

  useEffect(() => {
    if (!initial && defaultSegment) setSegmentVal(defaultSegment)
  }, [defaultSegment, initial])

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    fd.set('stammkunde', stammkunde ? 'true' : 'false')
    setSaveError(null)
    startTransition(async () => {
      try {
        if (initial) await updateKontakt(initial.id, fd)
        else await createKontakt(fd)
        onDone()
        router.refresh()
      } catch (err) {
        setSaveError(err instanceof Error ? err.message : 'Fehler beim Speichern')
      }
    })
  }

  const v = (field: keyof KontaktRow) => (initial?.[field] ?? '') as string

  return (
    <form onSubmit={handleSubmit} className="bg-s112-bg border border-s112-border rounded-xl p-5 space-y-4">
      <h3 className="text-sm font-semibold text-gray-800">{initial ? 'Kontakt bearbeiten' : 'Neuer Kontakt'}</h3>
      {saveError && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{saveError}</p>}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {/* Lead / Kunde Toggle */}
        <div className="sm:col-span-2 flex items-center justify-between bg-white border border-s112-border rounded-xl px-4 py-2.5">
          <div>
            <p className={`text-sm font-semibold ${isLead ? 'text-amber-600' : 'text-s112-teal'}`}>
              {isLead ? '🌱 Lead' : '✅ Kunde'}
            </p>
            <p className="text-xs text-s112-muted">
              {isLead ? 'Noch kein Verkauf – wird automatisch Kunde beim ersten Verkauf' : 'Aktiver Kunde'}
            </p>
          </div>
          <label className="flex items-center gap-2.5 cursor-pointer select-none">
            <input type="hidden" name="is_lead" value={String(isLead)} />
            <div onClick={() => setIsLead(v => !v)}
              className={`w-10 h-5 rounded-full transition-colors flex items-center px-0.5 ${isLead ? 'bg-amber-400' : 'bg-s112-teal'}`}>
              <div className={`w-4 h-4 rounded-full bg-white shadow transition-transform ${isLead ? 'translate-x-0' : 'translate-x-5'}`} />
            </div>
            <span className={`text-sm font-semibold min-w-[48px] ${isLead ? 'text-amber-600' : 'text-s112-teal'}`}>
              {isLead ? 'Lead' : 'Kunde'}
            </span>
          </label>
        </div>
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
          <div className="flex gap-1.5">
            <select
              name="telefon_vorwahl"
              defaultValue={initial?.telefon_vorwahl ?? '+43'}
              onChange={e => {
                const d = DIAL_CODES.find(x => x.code === e.target.value)
                if (d) setLandVal(d.iso)
              }}
              className="border border-s112-border rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40 w-24 flex-shrink-0"
            >
              {DIAL_CODES.map(d => (
                <option key={d.code} value={d.code}>{d.flag} {d.code}</option>
              ))}
            </select>
            <input name="telefon" defaultValue={v('telefon')} className={inputCls()} />
          </div>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Mobil</label>
          <div className="flex gap-1.5">
            <select
              name="mobil_vorwahl"
              defaultValue={initial?.mobil_vorwahl ?? '+43'}
              onChange={e => {
                const d = DIAL_CODES.find(x => x.code === e.target.value)
                if (d) setLandVal(d.iso)
              }}
              className="border border-s112-border rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40 w-24 flex-shrink-0"
            >
              {DIAL_CODES.map(d => (
                <option key={d.code} value={d.code}>{d.flag} {d.code}</option>
              ))}
            </select>
            <input name="mobil" defaultValue={v('mobil')} className={inputCls()} />
          </div>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Straße</label>
          <input name="strasse" defaultValue={v('strasse')} className={inputCls()} />
        </div>
        <div className="flex gap-2">
          <div className="w-28 flex-shrink-0">
            <label className="block text-xs font-medium text-gray-600 mb-1">PLZ</label>
            <input name="plz" defaultValue={v('plz')} className={inputCls()} />
          </div>
          <div className="flex-1">
            <label className="block text-xs font-medium text-gray-600 mb-1">Ort</label>
            <input name="ort" defaultValue={v('ort')} className={inputCls()} />
          </div>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Land</label>
          <select name="land" value={landVal} onChange={e => setLandVal(e.target.value)} className={inputCls()}>
            {LAENDER.map(l => <option key={l} value={l}>{l}</option>)}
          </select>
        </div>
        <div className="flex items-center gap-2 pt-5">
          <input type="checkbox" id="stammkunde" checked={stammkunde}
            onChange={e => setStammkunde(e.target.checked)}
            className="accent-s112-teal w-4 h-4" />
          <label htmlFor="stammkunde" className="text-sm text-gray-700 cursor-pointer">Stammkunde</label>
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
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Sonderrabatt %</label>
          <input
            name="sonderrabatt_pct"
            type="number"
            min="0" max="100" step="0.5"
            defaultValue={initial?.sonderrabatt_pct ?? 0}
            placeholder="0"
            className={inputCls()}
          />
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
  const [ganztags, setGanztags] = useState(true)

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    fd.set('kontakt_id', kontaktId)
    fd.set('ganztags', ganztags ? 'true' : 'false')
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
  const [ganztags, setGanztags] = useState(true)

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    fd.set('kontakt_id', kontaktId)
    fd.set('ganztags', ganztags ? 'true' : 'false')
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
          {pending ? '…' : 'Eintragen'}
        </button>
        <button type="button" onClick={onDone} className="text-xs text-gray-500 hover:text-gray-700">Abbrechen</button>
      </div>
    </form>
  )
}

// ── Kontakt-Karte ─────────────────────────────────────────────────────────────

function KontaktKarte({
  kontakt, firmen, rabattgruppen, aktivitaeten, pipeline, writeOk, sortBy,
}: {
  kontakt: KontaktRow
  firmen: FirmaOption[]
  rabattgruppen: RabattgruppeOption[]
  aktivitaeten: AktivitaetRow[]
  pipeline: PipelineRow[]
  writeOk: boolean
  sortBy: 'nachname' | 'vorname'
}) {
  const [editing, setEditing] = useState(false)
  const [showAkt, setShowAkt] = useState(false)
  const [showAktForm, setShowAktForm] = useState(false)
  const [showPipeline, setShowPipeline] = useState(false)
  const [showPipelineForm, setShowPipelineForm] = useState(false)
  const [pending, startTransition] = useTransition()

  const name = sortBy === 'nachname'
    ? [kontakt.nachname, kontakt.vorname].filter(Boolean).join(' ')
    : [kontakt.vorname, kontakt.nachname].filter(Boolean).join(' ')

  function handleDelete() {
    if (!confirm(`Kontakt "${name}" wirklich löschen?`)) return
    startTransition(async () => { await deleteKontakt(kontakt.id) })
  }

  if (editing) return (
    <KontaktForm initial={kontakt} firmen={firmen} rabattgruppen={rabattgruppen} onDone={() => setEditing(false)} />
  )

  return (
    <div className="card p-4">
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            {kontakt.kundennummer && (
              <span className="text-xs font-bold text-s112-teal font-mono bg-s112-teal/10 px-2 py-0.5 rounded">{kontakt.kundennummer}</span>
            )}
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
            {kontakt.is_lead
              ? <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 font-medium">🌱 Lead</span>
              : <span className="text-xs px-2 py-0.5 rounded-full bg-s112-teal/10 text-s112-teal font-medium">✅ Kunde</span>
            }
            {kontakt.rabattgruppe_name && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700 font-medium">
                {kontakt.rabattgruppe_pct}% {kontakt.rabattgruppe_name}
              </span>
            )}
            {(kontakt.sonderrabatt_pct ?? 0) > 0 && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-orange-100 text-orange-700 font-medium">
                {kontakt.sonderrabatt_pct}% Sonderrab.
              </span>
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
                className="text-xs font-medium text-s112-teal border border-s112-teal/30 rounded-full px-2.5 py-0.5 hover:bg-s112-teal hover:text-white transition-colors mt-1">
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
            className="text-xs font-medium text-s112-teal border border-s112-teal/30 rounded-full px-2.5 py-0.5 hover:bg-s112-teal hover:text-white transition-colors mt-1 ml-4">
            ＋ Aktivität
          </button>
        )}
      </div>

      {/* Pipeline */}
      <div className="mt-2 border-t border-s112-border/60 pt-2">
        <button onClick={() => setShowPipeline(o => !o)}
          className="text-xs text-s112-muted hover:text-gray-700 flex items-center gap-1">
          {showPipeline ? '▾' : '▸'} {pipeline.length} {pipeline.length === 1 ? 'Pipeline-Eintrag' : 'Pipeline-Einträge'}
        </button>
        {!showPipeline && writeOk && (
          <button onClick={() => { setShowPipeline(true); setShowPipelineForm(true) }}
            className="text-xs font-medium text-s112-teal border border-s112-teal/30 rounded-full px-2.5 py-0.5 hover:bg-s112-teal hover:text-white transition-colors mt-1 ml-4">
            ＋ Pipeline
          </button>
        )}

        {showPipeline && (
          <div className="mt-2 space-y-1">
            {pipeline.length === 0 ? (
              <p className="text-xs text-s112-muted italic">Noch keine Einträge.</p>
            ) : pipeline.map(p => {
              const stufeDef = PIPELINE_STUFEN.find(s => s.value === p.stufe)
              return (
                <div key={p.id} className="flex gap-2 text-xs py-1 border-b border-s112-border/40 last:border-0">
                  <span className={`px-1.5 py-0.5 rounded-full font-medium text-[10px] flex-shrink-0 self-start mt-0.5 ${stufeDef?.farbe ?? 'bg-gray-100 text-gray-700'}`}>
                    {stufeDef?.label ?? p.stufe}
                  </span>
                  <div className="flex-1 min-w-0">
                    <span className="font-medium text-gray-700 block truncate">{p.titel}</span>
                    <div className="flex gap-3 text-s112-muted mt-0.5">
                      {p.wert_euro != null && (
                        <span className="text-s112-teal font-semibold">
                          {p.wert_euro.toLocaleString('de-AT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })}
                        </span>
                      )}
                      {p.erwartetes_datum && (
                        <span>{new Date(p.erwartetes_datum).toLocaleDateString('de-AT')}</span>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
            {writeOk && !showPipelineForm && (
              <button onClick={() => setShowPipelineForm(true)}
                className="text-xs font-medium text-s112-teal border border-s112-teal/30 rounded-full px-2.5 py-0.5 hover:bg-s112-teal hover:text-white transition-colors mt-1">
                ＋ Pipeline eintragen
              </button>
            )}
            {showPipelineForm && (
              <PipelineForm kontaktId={kontakt.id} onDone={() => setShowPipelineForm(false)} />
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Hauptkomponente ───────────────────────────────────────────────────────────

export type { AktivitaetRow, PipelineRow }

export default function KontakteClient({
  kontakte, firmen, rabattgruppen, aktivitaetenMap, pipelineMap, writeOk,
}: {
  kontakte: KontaktRow[]
  firmen: FirmaOption[]
  rabattgruppen: RabattgruppeOption[]
  aktivitaetenMap: Record<string, AktivitaetRow[]>
  pipelineMap: Record<string, PipelineRow[]>
  writeOk: boolean
}) {
  const [showForm, setShowForm] = useState(false)
  const [suche, setSuche] = useState('')
  const [segment, setSegment] = useState<string>('alle')
  const [sortBy, setSortBy] = useState<'nachname' | 'vorname'>('nachname')

  const gefiltert = kontakte
    .filter(k => {
      const name = [k.kundennummer, k.vorname, k.nachname, k.email, k.mobil, k.telefon, k.firma_name].filter(Boolean).join(' ').toLowerCase()
      const matchSuche = !suche || name.includes(suche.toLowerCase())
      const matchSeg = segment === 'alle' || k.segment === segment
      return matchSuche && matchSeg
    })
    .sort((a, b) => {
      const ka = sortBy === 'nachname' ? a.nachname : (a.vorname ?? a.nachname)
      const kb = sortBy === 'nachname' ? b.nachname : (b.vorname ?? b.nachname)
      return ka.localeCompare(kb, 'de')
    })

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="search" placeholder="Name, Kundennummer, E-Mail, Telefon…"
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
        <button
          onClick={() => setSortBy(s => s === 'nachname' ? 'vorname' : 'nachname')}
          title={`Sortierung: ${sortBy === 'nachname' ? 'nach Nachname' : 'nach Vorname'}`}
          className="text-xs text-s112-muted border border-s112-border rounded-lg px-2.5 py-1.5 hover:bg-s112-bg transition-colors flex items-center gap-1.5">
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4h13M3 8h9m-9 4h6m4 0l4-4m0 0l4 4m-4-4v12" />
          </svg>
          {sortBy === 'nachname' ? 'Nachname' : 'Vorname'}
        </button>
        <div className="ml-auto flex items-center gap-2">
          <a href="/api/export/kontakte" download
            className="inline-flex items-center gap-1.5 border border-s112-border text-gray-600 px-3 py-2 rounded-xl text-sm hover:bg-s112-bg transition-colors">
            ⬇ CSV
          </a>
          {writeOk && !showForm && (
            <button onClick={() => setShowForm(true)}
              className="inline-flex items-center gap-2 bg-s112-teal text-white px-4 py-2 rounded-xl text-sm font-semibold hover:bg-opacity-90">
              <span>＋</span> Neuer Kontakt
            </button>
          )}
        </div>
      </div>

      {/* Formular */}
      {showForm && (
        <KontaktForm
          firmen={firmen}
          rabattgruppen={rabattgruppen}
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
              rabattgruppen={rabattgruppen}
              aktivitaeten={aktivitaetenMap[k.id] ?? []}
              pipeline={pipelineMap[k.id] ?? []}
              writeOk={writeOk}
              sortBy={sortBy}
            />
          ))}
        </div>
      )}
    </div>
  )
}
