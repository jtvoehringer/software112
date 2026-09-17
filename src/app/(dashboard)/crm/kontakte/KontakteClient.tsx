'use client'

import { useState, useEffect, useRef, useTransition } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { paramsAusFilter, LISTE_SCHRITT, type ListenFilter, type Zaehler } from '@/lib/crm/liste'
import Link from '@/components/ui/Link'
import { createKontakt, updateKontakt, pruefeKontaktDublette, deleteKontakt, createAktivitaet, createPipelineEintrag } from '../actions'
import { SEGMENTE, AKTIVITAET_ARTEN, PIPELINE_STUFEN, LAENDER, DIAL_CODES, segmentLabel, segmentFarbe } from '@/lib/crm/types'
import type { KontaktRow } from '@/lib/crm/types'
import { AlertTriangle, Trash2, Pencil } from 'lucide-react'
import { fmtEur } from '@/lib/format'

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

function inputCls() {
  return 'w-full border border-s112-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40'
}

// ── Formular ──────────────────────────────────────────────────────────────────

export function KontaktForm({
  initial, firmen = [], rabattgruppen = [], defaultSegment, existingKontakte, onDone,
}: {
  initial?: KontaktRow | null
  firmen?: FirmaOption[]
  rabattgruppen?: RabattgruppeOption[]
  defaultSegment?: string
  existingKontakte?: KontaktRow[]
  onDone: () => void
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [stammkunde, setStammkunde] = useState(initial?.stammkunde ?? false)
  const [isLead, setIsLead]           = useState(initial?.is_lead ?? true)
  const [landVal, setLandVal]           = useState(initial?.land ?? 'AT')
  const [segmentVal, setSegmentVal] = useState(initial?.segment ?? defaultSegment ?? 'privat')
  const [saveError, setSaveError]   = useState<string | null>(null)
  const [dubletteWarnung, setDubletteWarnung] = useState<string | null>(null)
  const [dubletteIgnorieren, setDubletteIgnorieren] = useState(false)

  useEffect(() => {
    if (!initial && defaultSegment) setSegmentVal(defaultSegment)
  }, [defaultSegment, initial])

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    fd.set('stammkunde', stammkunde ? 'true' : 'false')
    setSaveError(null)

    // Dublettenprüfung nur bei Neuanlage (nicht beim Bearbeiten) und nicht wenn
    // bereits ignoriert - serverseitig (17.9.2026), da die Liste nicht mehr alle
    // Kontakte enthält; existingKontakte (falls übergeben) dient nur noch als
    // schneller Vorab-Check.
    if (!initial && !dubletteIgnorieren) {
      const eingabe = {
        vorname: ((fd.get('vorname') as string) ?? ''), nachname: ((fd.get('nachname') as string) ?? ''),
        strasse: ((fd.get('strasse') as string) ?? ''), plz: ((fd.get('plz') as string) ?? ''), ort: ((fd.get('ort') as string) ?? ''),
      }
      startTransition(async () => {
        const d = await pruefeKontaktDublette(eingabe)
        if (d.name) { setDubletteWarnung(`Ein Kontakt „${d.name}" ist bereits vorhanden.`); return }
        if (d.adresse) { setDubletteWarnung(`Ein Kontakt mit dieser Adresse ist bereits vorhanden: ${d.adresse}.`); return }
        const result = await createKontakt(fd)
        if (result?.error) { setSaveError(result.error); return }
        onDone()
        router.refresh()
      })
      return
    }

    startTransition(async () => {
      const result = initial
        ? await updateKontakt(initial.id, fd)
        : await createKontakt(fd)
      if (result?.error) {
        setSaveError(result.error)
        return
      }
      onDone()
      router.refresh()
    })
  }

  const v = (field: keyof KontaktRow) => (initial?.[field] ?? '') as string

  return (
    <form onSubmit={handleSubmit} className="bg-s112-bg border border-s112-border rounded-xl p-5 space-y-4">
      <h3 className="text-sm font-semibold text-s112-text">{initial ? 'Kontakt bearbeiten' : 'Neuer Kontakt'}</h3>
      {saveError && <p className="text-xs text-s112-err-fg bg-s112-err-bg border border-s112-err/30 rounded-lg px-3 py-2">{saveError}</p>}
      {dubletteWarnung && (
        <div className="bg-s112-warn-bg border border-s112-warn/30 rounded-xl px-4 py-3 text-sm">
          <p className="font-medium text-s112-warn-fg mb-1 inline-flex items-center gap-1.5"><AlertTriangle size={14} />Mögliche Dublette</p>
          <p className="text-s112-warn-fg mb-3">{dubletteWarnung}</p>
          <p className="text-s112-warn-fg mb-3">Möchten Sie den Eintrag trotzdem übernehmen oder verwerfen?</p>
          <div className="flex gap-2">
            <button type="button" onClick={() => { setDubletteIgnorieren(true); setDubletteWarnung(null); setTimeout(() => { (document.activeElement as HTMLElement)?.closest('form')?.requestSubmit() }, 10) }}
              className="bg-s112-warn-fg text-white px-4 py-1.5 rounded-lg text-xs font-semibold hover:opacity-90">
              Trotzdem übernehmen
            </button>
            <button type="button" onClick={() => { setDubletteWarnung(null); onDone() }}
              className="border border-s112-warn/50 text-s112-warn-fg px-4 py-1.5 rounded-lg text-xs font-semibold hover:bg-s112-warn-bg">
              Verwerfen
            </button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {/* Lead / Kunde Toggle */}
        <div className="sm:col-span-2 flex items-center justify-between bg-white border border-s112-border rounded-xl px-4 py-2.5">
          <div>
            <p className={`text-sm font-semibold ${isLead ? 'text-s112-warn-fg' : 'text-s112-blue-700'}`}>
              {isLead ? 'Lead' : 'Aktiv'}
            </p>
            <p className="text-xs text-s112-muted">
              {isLead ? 'Noch kein Verkauf – wird automatisch Kunde beim ersten Verkauf' : ''}
            </p>
          </div>
          <label className="flex items-center gap-2.5 cursor-pointer select-none">
            <input type="hidden" name="is_lead" value={String(isLead)} />
            <div onClick={() => setIsLead(v => !v)}
              className={`w-10 h-5 rounded-full transition-colors flex items-center px-0.5 ${isLead ? 'bg-s112-grey' : 'bg-s112-teal'}`}>
              <div className={`w-4 h-4 rounded-full bg-white shadow transition-transform ${isLead ? 'translate-x-0' : 'translate-x-5'}`} />
            </div>
            <span className={`text-sm font-semibold min-w-[48px] ${isLead ? 'text-s112-warn-fg' : 'text-s112-blue-700'}`}>
              {isLead ? 'Lead' : 'Aktiv'}
            </span>
          </label>
        </div>
        <div>
          <label className="block text-xs font-medium text-s112-text-2 mb-1">Vorname</label>
          <input name="vorname" defaultValue={v('vorname')} className={inputCls()} />
        </div>
        <div>
          <label className="block text-xs font-medium text-s112-text-2 mb-1">Nachname *</label>
          <input name="nachname" defaultValue={v('nachname')} required className={inputCls()} />
        </div>
        <div>
          <label className="block text-xs font-medium text-s112-text-2 mb-1">Segment *</label>
          <select name="segment" value={segmentVal} onChange={e => setSegmentVal(e.target.value)} required className={inputCls()}>
            {SEGMENTE.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
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
          <label className="block text-xs font-medium text-s112-text-2 mb-1">E-Mail</label>
          <input name="email" type="email" defaultValue={v('email')} className={inputCls()} />
        </div>
        <div>
          <label className="block text-xs font-medium text-s112-text-2 mb-1">Telefon</label>
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
          <label className="block text-xs font-medium text-s112-text-2 mb-1">Mobil</label>
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
          <label className="block text-xs font-medium text-s112-text-2 mb-1">Straße</label>
          <input name="strasse" defaultValue={v('strasse')} className={inputCls()} />
        </div>
        <div className="flex gap-2">
          <div className="w-28 flex-shrink-0">
            <label className="block text-xs font-medium text-s112-text-2 mb-1">PLZ</label>
            <input name="plz" defaultValue={v('plz')} className={inputCls()} />
          </div>
          <div className="flex-1">
            <label className="block text-xs font-medium text-s112-text-2 mb-1">Ort</label>
            <input name="ort" defaultValue={v('ort')} className={inputCls()} />
          </div>
        </div>
        <div>
          <label className="block text-xs font-medium text-s112-text-2 mb-1">Land</label>
          <select name="land" value={landVal} onChange={e => setLandVal(e.target.value)} className={inputCls()}>
            {LAENDER.map(l => <option key={l} value={l}>{l}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-s112-text-2 mb-1">BKI-Betriebsnummer</label>
          <input name="betrieb_nr" defaultValue={v('betrieb_nr' as keyof typeof initial)} placeholder="z.B. 4285221" className={inputCls()} />
          <p className="text-[10px] text-s112-tertiary mt-0.5">Betriebsnummer des Abnehmers für BKI-Transportliste</p>
        </div>
        <div className="flex items-center gap-2 pt-5">
          <input type="checkbox" id="stammkunde" checked={stammkunde}
            onChange={e => setStammkunde(e.target.checked)}
            className="accent-s112-teal w-4 h-4" />
          <label htmlFor="stammkunde" className="text-sm text-s112-text-1 cursor-pointer">Stammkunde</label>
        </div>
        <div>
          <label className="block text-xs font-medium text-s112-text-2 mb-1">Rabattgruppe</label>
          <select name="rabattgruppe_id" defaultValue={initial?.rabattgruppe_id ?? ''} className={inputCls()}>
            <option value="">– kein Rabatt –</option>
            {rabattgruppen.map(r => (
              <option key={r.id} value={r.id}>{r.name} ({r.rabatt_pct}%)</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-s112-text-2 mb-1">Sonderrabatt %</label>
          <input
            name="sonderrabatt_pct"
            type="number"
            min="0" max="100" step="0.5"
            defaultValue={initial?.sonderrabatt_pct ?? 0}
            placeholder="0"
            className={inputCls()}
          />
        </div>
        <div className="flex gap-2">
          <div className="flex-1">
            <label className="block text-xs font-medium text-s112-text-2 mb-1">Skonto %</label>
            <input name="skonto_pct" type="number" min="0" max="20" step="0.5"
              defaultValue={initial?.skonto_pct ?? 0} placeholder="0" className={inputCls()} />
          </div>
          <div className="flex-1">
            <label className="block text-xs font-medium text-s112-text-2 mb-1">Skonto-Frist (Tage)</label>
            <input name="skonto_tage" type="number" min="0" max="60" step="1"
              defaultValue={initial?.skonto_tage ?? 10} placeholder="10" className={inputCls()} />
          </div>
        </div>
        <div>
          <label className="block text-xs font-medium text-s112-text-2 mb-1">Zahlungsziel (Tage) *</label>
          <input name="zahlungsziel_tage" type="number" min="0" max="365" step="1" required
            defaultValue={initial?.zahlungsziel_tage ?? 14} placeholder="14" className={inputCls()} />
          <p className="text-[10px] text-s112-tertiary mt-0.5">0 = Rechnung wird mit "bei Erhalt" statt Fälligkeitsdatum gedruckt</p>
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
          {AKTIVITAET_ARTEN.map(a => <option key={a.value} value={a.value}>{a.label}</option>)}
        </select>
        <input name="datum" type="date" defaultValue={new Date().toISOString().split('T')[0]}
          required className={inputCls()} />
      </div>
      <div className="flex items-center gap-3 flex-wrap">
        <label className="flex items-center gap-1.5 text-xs text-s112-text-2 cursor-pointer select-none shrink-0">
          <input type="checkbox" checked={ganztags} onChange={e => setGanztags(e.target.checked)} className="rounded" />
          Ganztags
        </label>
        <div className="flex items-center gap-2">
          <span className="text-xs text-s112-tertiary">Von</span>
          <input name="uhrzeit_von" type="time" step="1800" disabled={ganztags}
            className={`border border-s112-border rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40 ${ganztags ? 'opacity-30 cursor-not-allowed bg-s112-bg' : ''}`} />
          <span className="text-xs text-s112-tertiary">–</span>
          <input name="uhrzeit_bis" type="time" step="1800" disabled={ganztags}
            className={`border border-s112-border rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40 ${ganztags ? 'opacity-30 cursor-not-allowed bg-s112-bg' : ''}`} />
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
        <button type="button" onClick={onDone} className="text-xs text-s112-text-2 hover:text-s112-text-1">Abbrechen</button>
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
        <label className="flex items-center gap-1.5 text-xs text-s112-text-2 cursor-pointer select-none shrink-0">
          <input type="checkbox" checked={ganztags} onChange={e => setGanztags(e.target.checked)} className="rounded" />
          Ganztags
        </label>
        <div className="flex items-center gap-2">
          <span className="text-xs text-s112-tertiary">Von</span>
          <input name="uhrzeit_von" type="time" step="1800" disabled={ganztags}
            className={`border border-s112-border rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40 ${ganztags ? 'opacity-30 cursor-not-allowed bg-s112-bg' : ''}`} />
          <span className="text-xs text-s112-tertiary">–</span>
          <input name="uhrzeit_bis" type="time" step="1800" disabled={ganztags}
            className={`border border-s112-border rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40 ${ganztags ? 'opacity-30 cursor-not-allowed bg-s112-bg' : ''}`} />
        </div>
      </div>
      <div className="flex gap-2">
        <button type="submit" disabled={pending}
          className="bg-s112-teal text-white px-3 py-1 rounded-lg text-xs font-medium disabled:opacity-40">
          {pending ? '…' : 'Eintragen'}
        </button>
        <button type="button" onClick={onDone} className="text-xs text-s112-text-2 hover:text-s112-text-1">Abbrechen</button>
      </div>
    </form>
  )
}

// ── Kontakt-Karte ─────────────────────────────────────────────────────────────

function KontaktKarte({
  kontakt, firmen, rabattgruppen, aktivitaeten, pipeline, writeOk, sortBy,
}: {
  kontakt: KontaktRow
  firmen?: FirmaOption[]
  rabattgruppen?: RabattgruppeOption[]
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
            {kontakt.accountnummer && (
              <span className="text-xs font-semibold text-s112-blue-700 font-mono bg-s112-teal/10 px-2 py-0.5 rounded">{kontakt.accountnummer}</span>
            )}
            <Link href={`/crm/kontakte/${kontakt.id}`}
              className="font-semibold text-s112-text text-sm hover:text-s112-blue-700 hover:underline">
              {name}
            </Link>
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${segmentFarbe(kontakt.segment)}`}>
              {segmentLabel(kontakt.segment)}
            </span>
            {kontakt.stammkunde && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-s112-yellow/20 text-s112-warn-fg font-medium">Stammkunde</span>
            )}
            {kontakt.is_lead
              ? <span className="text-xs px-2 py-0.5 rounded-full bg-s112-warn-bg text-s112-warn-fg font-medium">Lead</span>
              : <span className="text-xs px-2 py-0.5 rounded-full bg-s112-teal/10 text-s112-blue-700 font-medium">Aktiv</span>
            }
            {kontakt.rabattgruppe_name && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-s112-ok-bg text-s112-ok-fg font-medium">
                {kontakt.rabattgruppe_pct}% {kontakt.rabattgruppe_name}
              </span>
            )}
            {(kontakt.sonderrabatt_pct ?? 0) > 0 && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-s112-warn-bg text-s112-warn-fg font-medium">
                {kontakt.sonderrabatt_pct}% Sonderrab.
              </span>
            )}
            {kontakt.newsletter && kontakt.newsletter_bestaetigt && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-s112-ok-bg text-s112-ok-fg font-medium">Newsletter</span>
            )}
            {kontakt.newsletter && !kontakt.newsletter_bestaetigt && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-s112-warn-bg text-s112-warn-fg font-medium">ausstehend</span>
            )}
          </div>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5">
            {kontakt.firma_name && kontakt.firma_id
              ? <Link href={`/crm/firmen/${kontakt.firma_id}`} className="text-xs text-s112-muted hover:text-s112-blue-700 hover:underline">{kontakt.firma_name}</Link>
              : kontakt.firma_name && <span className="text-xs text-s112-muted">{kontakt.firma_name}</span>}
            {kontakt.email && <span className="text-xs text-s112-muted">{kontakt.email}</span>}
            {kontakt.telefon && <span className="text-xs text-s112-muted">{kontakt.telefon_vorwahl ?? '+43'} {kontakt.telefon}</span>}
            {kontakt.mobil && <span className="text-xs text-s112-muted">{kontakt.mobil_vorwahl ?? '+43'} {kontakt.mobil}</span>}
            {kontakt.ort && <span className="text-xs text-s112-muted">{kontakt.ort}{kontakt.land !== 'AT' ? `, ${kontakt.land}` : ''}</span>}
            {kontakt.zahlungsziel_tage !== 14 && (
              <span className="text-xs text-s112-muted">
                Zahlungsziel: {kontakt.zahlungsziel_tage === 0 ? 'bei Erhalt' : `${kontakt.zahlungsziel_tage} Tage`}
              </span>
            )}
          </div>
          {kontakt.notizen && (
            <p className="mt-1 text-xs text-s112-text-2 italic">{kontakt.notizen}</p>
          )}
        </div>
        {writeOk && (
          <div className="flex gap-1 flex-shrink-0">
            <button onClick={() => setEditing(true)}
              title="Bearbeiten" aria-label="Bearbeiten"
              className="text-s112-muted hover:text-s112-blue-700 px-2 py-1 rounded transition-colors">
              <Pencil size={14} />
            </button>
            <button onClick={handleDelete} disabled={pending}
              title="Löschen" aria-label="Löschen"
              className="text-s112-muted hover:text-s112-err px-2 py-1 rounded transition-colors">
              <Trash2 size={14} />
            </button>
          </div>
        )}
      </div>

      {/* Aktivitäten */}
      <div className="mt-3 border-t border-s112-border/60 pt-2">
        <button onClick={() => setShowAkt(o => !o)}
          className="text-xs text-s112-muted hover:text-s112-text-1 flex items-center gap-1">
          {showAkt ? '▾' : '▸'} {aktivitaeten.length} {aktivitaeten.length === 1 ? 'Aktivität' : 'Aktivitäten'}
        </button>

        {showAkt && (
          <div className="mt-2 space-y-1">
            {aktivitaeten.length === 0 ? (
              <p className="text-xs text-s112-muted italic">Noch keine Einträge.</p>
            ) : aktivitaeten.map(a => {
              return (
                <div key={a.id} className="flex gap-2 text-xs py-1 border-b border-s112-border/40 last:border-0">
                  <span className="text-s112-muted w-20 flex-shrink-0 tabular-nums">
                    {new Date(a.datum).toLocaleDateString('de-AT')}
                  </span>
                  <span className="font-medium text-s112-text-1">{a.betreff}</span>
                  {a.beschreibung && <span className="text-s112-text-2 truncate">{a.beschreibung}</span>}
                </div>
              )
            })}
            {writeOk && !showAktForm && (
              <button onClick={() => setShowAktForm(true)}
                className="text-xs font-medium text-s112-blue-700 border border-s112-teal/30 rounded-full px-2.5 py-0.5 hover:bg-s112-teal hover:text-white transition-colors mt-1">
                + Aktivität eintragen
              </button>
            )}
            {showAktForm && (
              <AktivitaetForm kontaktId={kontakt.id} onDone={() => setShowAktForm(false)} />
            )}
          </div>
        )}
        {!showAkt && writeOk && (
          <button onClick={() => { setShowAkt(true); setShowAktForm(true) }}
            className="text-xs font-medium text-s112-blue-700 border border-s112-teal/30 rounded-full px-2.5 py-0.5 hover:bg-s112-teal hover:text-white transition-colors mt-1 ml-4">
            + Aktivität
          </button>
        )}
      </div>

      {/* Pipeline */}
      <div className="mt-2 border-t border-s112-border/60 pt-2">
        <button onClick={() => setShowPipeline(o => !o)}
          className="text-xs text-s112-muted hover:text-s112-text-1 flex items-center gap-1">
          {showPipeline ? '▾' : '▸'} {pipeline.length} {pipeline.length === 1 ? 'Pipeline-Eintrag' : 'Pipeline-Einträge'}
        </button>
        {!showPipeline && writeOk && (
          <button onClick={() => { setShowPipeline(true); setShowPipelineForm(true) }}
            className="text-xs font-medium text-s112-blue-700 border border-s112-teal/30 rounded-full px-2.5 py-0.5 hover:bg-s112-teal hover:text-white transition-colors mt-1 ml-4">
            + Pipeline
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
                  <span className={`px-1.5 py-0.5 rounded-full font-medium text-[10px] flex-shrink-0 self-start mt-0.5 ${stufeDef?.farbe ?? 'bg-[#F2F3F5] text-s112-text-1'}`}>
                    {stufeDef?.label ?? p.stufe}
                  </span>
                  <div className="flex-1 min-w-0">
                    <span className="font-medium text-s112-text-1 block truncate">{p.titel}</span>
                    <div className="flex gap-3 text-s112-muted mt-0.5">
                      {p.wert_euro != null && (
                        <span className="text-s112-blue-700 font-semibold">
                          {fmtEur(p.wert_euro)}
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
                className="text-xs font-medium text-s112-blue-700 border border-s112-teal/30 rounded-full px-2.5 py-0.5 hover:bg-s112-teal hover:text-white transition-colors mt-1">
                + Pipeline eintragen
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
  kontakte, firmen, rabattgruppen, aktivitaetenMap, pipelineMap, writeOk, filter, gesamt, zaehler,
}: {
  kontakte: KontaktRow[]
  firmen?: FirmaOption[]
  rabattgruppen?: RabattgruppeOption[]
  aktivitaetenMap: Record<string, AktivitaetRow[]>
  pipelineMap: Record<string, PipelineRow[]>
  writeOk: boolean
  /** Aktive Filter (aus der URL, serverseitig angewendet - lib/crm/liste.ts) */
  filter: ListenFilter
  /** Treffer gesamt für den aktiven Filter (geladen sind höchstens filter.n) */
  gesamt: number
  /** Zähler je Segment / Lead über alle Kontakte des Betriebs */
  zaehler: Zaehler
}) {
  const router = useRouter()
  const pathname = usePathname()
  const [pending, startTransition] = useTransition()
  const [showForm, setShowForm] = useState(false)
  // Serverseitige Filter (17.9.2026): jede Änderung schreibt die URL, die Seite
  // lädt nur die passenden Zeilen. Suche mit 300 ms Verzögerung.
  const [suche, setSuche] = useState(filter.q)
  const sucheTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => { setSuche(filter.q) }, [filter.q])
  const setzeFilter = (aenderung: Partial<ListenFilter>) => {
    const neu = { ...filter, ...aenderung }
    if (!('n' in aenderung)) neu.n = LISTE_SCHRITT   // Filterwechsel: wieder von vorne
    startTransition(() => router.replace(`${pathname}${paramsAusFilter(neu)}`, { scroll: false }))
  }
  const sucheEingabe = (v: string) => {
    setSuche(v)
    if (sucheTimer.current) clearTimeout(sucheTimer.current)
    sucheTimer.current = setTimeout(() => setzeFilter({ q: v.trim() }), 300)
  }
  const segment = filter.segment
  const filterLead = filter.lead
  const buchstabe = filter.buchstabe
  const sortBy: 'nachname' | 'vorname' = filter.sort === 'vorname' ? 'vorname' : 'nachname'
  const BUCHSTABEN = ['Alle', ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')]
  const gefiltert = kontakte

  return (
    <div className="space-y-4">
      {/* Alphabet-Filter */}
      <div className="flex flex-wrap gap-0.5">
        {BUCHSTABEN.map(b => (
          <button key={b} onClick={() => setzeFilter({ buchstabe: b })}
            className={`min-w-[1.75rem] px-1 py-0.5 text-xs font-medium rounded transition-colors
              ${buchstabe === b
                ? 'bg-s112-teal text-white'
                : 'bg-s112-bg text-s112-text-2 hover:bg-s112-teal/10 hover:text-s112-blue-700'}`}>
            {b}
          </button>
        ))}
      </div>
      
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="search" placeholder="Name, Accountnummer, E-Mail, Telefon…"
          value={suche} onChange={e => sucheEingabe(e.target.value)}
          className="border border-s112-border rounded-lg px-3 py-1.5 text-sm w-64 focus:outline-none focus:ring-2 focus:ring-s112-teal/40"
        />
        <div className="flex gap-1">
          <button onClick={() => setzeFilter({ segment: 'alle' })}
            className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${segment === 'alle' ? 'bg-s112-teal text-white' : 'bg-s112-bg text-s112-text-2 hover:text-s112-text'}`}>
            Alle ({zaehler.gesamt})
          </button>
          {SEGMENTE.filter(s => (zaehler.segment[s.value] ?? 0) > 0 || s.value === segment).map(s => {
            const count = zaehler.segment[s.value] ?? 0
            return (
              <button key={s.value} onClick={() => setzeFilter({ segment: s.value })}
                className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${segment === s.value ? 'bg-s112-teal text-white' : 'bg-s112-bg text-s112-text-2 hover:text-s112-text'}`}>
                {s.label} ({count})
              </button>
            )
          })}
        </div>
        <button
          onClick={() => setzeFilter({ sort: sortBy === 'nachname' ? 'vorname' : 'nachname' })}
          title={`Sortierung: ${sortBy === 'nachname' ? 'nach Nachname' : 'nach Vorname'}`}
          className="text-xs text-s112-muted border border-s112-border rounded-lg px-2.5 py-1.5 hover:bg-s112-bg transition-colors flex items-center gap-1.5">
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4h13M3 8h9m-9 4h6m4 0l4-4m0 0l4 4m-4-4v12" />
          </svg>
          {sortBy === 'nachname' ? 'Nachname' : 'Vorname'}
        </button>
        <div className="flex gap-1">
          {(['alle', 'lead', 'kunde'] as const).map(v => (
            <button key={v} onClick={() => setzeFilter({ lead: v })}
              className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${filterLead === v ? 'bg-s112-teal text-white' : 'bg-s112-bg text-s112-text-2 hover:text-s112-text'}`}>
              {v === 'alle' ? 'Alle' : v === 'lead' ? 'Lead' : 'Aktiv'}
              {' '}({v === 'alle' ? zaehler.gesamt : v === 'lead' ? zaehler.lead : zaehler.kunde})
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-2">
          <a href="/api/export/kontakte" download
            className="inline-flex items-center gap-1.5 border border-s112-border text-s112-text-2 px-3 py-2 rounded-xl text-sm hover:bg-s112-bg transition-colors">
            CSV
          </a>
          {writeOk && !showForm && (
            <button onClick={() => setShowForm(true)}
              className="inline-flex items-center gap-2 bg-s112-teal text-white px-4 py-2 rounded-xl text-sm font-semibold hover:bg-opacity-90">
              + Neuer Kontakt
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
      {pending && <p className="text-xs text-s112-tertiary animate-pulse">Lade…</p>}
      {gefiltert.length === 0 ? (
        <div className="card text-center py-12 text-s112-muted text-sm">
          {zaehler.gesamt === 0 ? 'Noch keine Kontakte angelegt.' : 'Keine Treffer für diesen Filter.'}
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
          {gesamt > gefiltert.length && (
            <button type="button" disabled={pending} onClick={() => setzeFilter({ n: filter.n + LISTE_SCHRITT })}
              className="w-full card text-center py-3 text-sm font-medium text-s112-blue-700 hover:bg-s112-bg disabled:opacity-50">
              {pending ? 'Lade…' : `Mehr anzeigen (${gefiltert.length} von ${gesamt})`}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
