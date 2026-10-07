'use client'

import { useState, useTransition } from 'react'
import LieferadressenKarte, { type LieferadresseZeile } from '@/components/crm/LieferadressenKarte'
import { landAnzeige } from '@/lib/katalog/laender'
import { useRouter } from 'next/navigation'
import Link from '@/components/ui/Link'
import { createAktivitaet, createPipelineEintrag, toggleAktivitaetErledigt, updateAktivitaet, deleteAktivitaet, deleteFirma, setzeFirmaAktiv } from '../../actions'
import { loeschenOderDeaktivieren } from '@/lib/stammdaten/loeschDialog'
import {
  AKTIVITAET_ARTEN, PIPELINE_STUFEN,
  segmentLabel, segmentFarbe, fmtUhrzeit,
} from '@/lib/crm/types'
import type { FirmaRow, KontaktRow, AktivitaetRow, PipelineEintragRow, VerkaufRow } from '@/lib/crm/types'
import { verkaufSumme } from '@/lib/crm/types'
import { FirmaForm } from '../FirmenClient'
import {
  Receipt, Trash2, Pencil, Mail, Phone, Smartphone, Globe, MapPin, Reply, Check, X,
  ClipboardCheck, Handshake, Wine, Building2, Car, FileText, ShoppingCart,
  MoreHorizontal, Palmtree, UserX, StickyNote, PowerOff, RotateCcw,
} from 'lucide-react'
import { fmtEur } from '@/lib/format'
import { useDialog } from '@/components/ui/useDialog'
import EmailHtmlAnzeige from '@/components/EmailHtmlAnzeige'

// Aktivitäts-Art -> Lucide-Icon (Timeline-Avatar). Gleiches Vokabular wie im
// CRM-Kalender (CRMUebersichtClient.tsx); dort werden Icons in Status-Chips
// bewusst entfernt statt ersetzt, hier ist der Kontext ein Timeline-Avatar
// (wie EVENT_STYLE in kellerbuch/weinausbau/[id]/buch/page.tsx), daher erlaubt.
const AKT_ICON: Record<string, typeof Phone> = {
  notiz: StickyNote,
  email: Mail,
  anruf: Phone,
  besprechung: Handshake,
  verkostung: Wine,
  messe: Building2,
  besuch: Car,
  angebot: FileText,
  verkauf: ShoppingCart,
  sonstiges: MoreHorizontal,
  urlaub: Palmtree,
  abwesenheit: UserX,
}

function inputCls() {
  return 'w-full border border-s112-border rounded-lg px-3 py-1.5 text-sm focus:outline-hidden focus:ring-2 focus:ring-s112-teal/40'
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
          {AKTIVITAET_ARTEN.filter(a => !('nurAnzeige' in a)).map(a => <option key={a.value} value={a.value}>{a.label}</option>)}
        </select>
        <input name="datum" type="date" defaultValue={new Date().toISOString().split('T')[0]}
          required className={inputCls()} />
      </div>

      {/* Uhrzeit – immer sichtbar, bei Ganztags deaktiviert */}
      <div className="flex items-center gap-3 flex-wrap">
        <label className="flex items-center gap-1.5 text-xs text-s112-text-2 cursor-pointer select-none shrink-0">
          <input type="checkbox" checked={ganztags} onChange={e => setGanztags(e.target.checked)}
            className="rounded-sm" />
          Ganztags
        </label>
        <div className="flex items-center gap-2">
          <span className="text-xs text-s112-tertiary">Von</span>
          <input name="uhrzeit_von" type="time" step="1800" disabled={ganztags}
            className={`border border-s112-border rounded-lg px-2 py-1 text-sm focus:outline-hidden focus:ring-2 focus:ring-s112-teal/40 ${ganztags ? 'opacity-30 cursor-not-allowed bg-s112-bg' : ''}`} />
          <span className="text-xs text-s112-tertiary">–</span>
          <input name="uhrzeit_bis" type="time" step="1800" disabled={ganztags}
            className={`border border-s112-border rounded-lg px-2 py-1 text-sm focus:outline-hidden focus:ring-2 focus:ring-s112-teal/40 ${ganztags ? 'opacity-30 cursor-not-allowed bg-s112-bg' : ''}`} />
        </div>
      </div>

      <input name="betreff" placeholder="Betreff *" required className={inputCls()} />
      <textarea name="beschreibung" placeholder="Beschreibung (optional)" rows={2}
        className={inputCls() + ' resize-none'} />
      <div className="flex gap-2">
        <button type="submit" disabled={pending}
          className="bg-s112-teal text-s112-yellow px-3 py-1 rounded-lg text-xs font-medium disabled:opacity-40">
          {pending ? '…' : 'Eintragen'}
        </button>
        <button type="button" onClick={onDone} className="text-xs text-s112-text-2 hover:text-s112-text-1">Abbrechen</button>
      </div>
    </form>
  )
}

// ── Pipeline-Formular ─────────────────────────────────────────────────────────

function PipelineForm({ firmaId, onDone }: { firmaId: string; onDone: () => void }) {
  const [pending, startTransition] = useTransition()
  const [ganztags, setGanztags] = useState(true)

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    fd.set('firma_id', firmaId)
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
        <input name="wert_euro" type="number" step="0.01" placeholder="Wert € (optional)" className={inputCls()} />
        <input name="erwartetes_datum" type="date" className={inputCls()} />
      </div>
      <div className="flex items-center gap-3 flex-wrap">
        <label className="flex items-center gap-1.5 text-xs text-s112-text-2 cursor-pointer select-none shrink-0">
          <input type="checkbox" checked={ganztags} onChange={e => setGanztags(e.target.checked)} className="rounded-sm" />
          Ganztags
        </label>
        <div className="flex items-center gap-2">
          <span className="text-xs text-s112-tertiary">Von</span>
          <input name="uhrzeit_von" type="time" step="1800" disabled={ganztags}
            className={`border border-s112-border rounded-lg px-2 py-1 text-sm focus:outline-hidden focus:ring-2 focus:ring-s112-teal/40 ${ganztags ? 'opacity-30 cursor-not-allowed bg-s112-bg' : ''}`} />
          <span className="text-xs text-s112-tertiary">–</span>
          <input name="uhrzeit_bis" type="time" step="1800" disabled={ganztags}
            className={`border border-s112-border rounded-lg px-2 py-1 text-sm focus:outline-hidden focus:ring-2 focus:ring-s112-teal/40 ${ganztags ? 'opacity-30 cursor-not-allowed bg-s112-bg' : ''}`} />
        </div>
      </div>
      <div className="flex gap-2">
        <button type="submit" disabled={pending}
          className="bg-s112-teal text-s112-yellow px-3 py-1 rounded-lg text-xs font-medium disabled:opacity-40">
          {pending ? '…' : 'Eintragen'}
        </button>
        <button type="button" onClick={onDone} className="text-xs text-s112-text-2 hover:text-s112-text-1">Abbrechen</button>
      </div>
    </form>
  )
}

// ── Aktivitäts-Karte ──────────────────────────────────────────────────────────

function AktivitaetKarte({ a, writeOk, firmaEmail, firmaId }: { a: AktivitaetRow; writeOk: boolean; firmaEmail?: string; firmaId?: string }) {
  const [pending, startTransition] = useTransition()
  const [editMode, setEditMode]   = useState(false)
  const [replyOpen, setReplyOpen]   = useState(false)
  const [replyText, setReplyText]   = useState('')
  const [replySending, setReplySending] = useState(false)
  const [emailOpen, setEmailOpen]   = useState(false)
  const [ganztags, setGanztags]   = useState(a.ganztags ?? true)
  const artDef = AKTIVITAET_ARTEN.find(x => x.value === a.art)
  const ArtIcon = AKT_ICON[a.art] ?? StickyNote
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
        <div className="shrink-0 w-8 h-8 rounded-full bg-s112-bg flex items-center justify-center text-s112-blue-700">
          <Receipt size={16} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-s112-muted tabular-nums">
              {new Date(a.datum).toLocaleDateString('de-AT')}
            </span>
            <span className="text-xs font-medium text-s112-blue-700">Verkauf</span>
            {isStorniert && (
              <span className="text-xs px-1.5 py-0.5 rounded-full bg-s112-err-bg text-s112-err-fg font-medium">Storniert</span>
            )}
          </div>
          {/* Sweep Namenslinks: der Betreff selbst führt zum verknüpften Verkauf */}
          <p className="text-sm font-medium text-s112-text mt-0.5">
            {postenId && postenId !== a.beschreibung
              ? <Link href={`/weinhandel/verkauf/${postenId}`} className="font-medium text-s112-blue-700 hover:underline">{a.betreff || 'Verkauf'}</Link>
              : a.betreff}
          </p>
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
              <label className="block text-xs font-medium text-s112-text-2 mb-1">Art</label>
              <select aria-label="Art" name="art" defaultValue={a.art} className={inputCls()}>
                {a.art === 'email' && <input type="hidden" name="art" value="email" />}
                {AKTIVITAET_ARTEN.filter(x => !('nurAnzeige' in x) || x.value === a.art).map(x => (
                  <option key={x.value} value={x.value} disabled={'nurAnzeige' in x}>{x.label}{('nurAnzeige' in x) ? ' (automatisch)' : ''}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-s112-text-2 mb-1">Datum</label>
              <input aria-label="Datum" type="date" name="datum" defaultValue={a.datum ?? ''} required className={inputCls()} />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-s112-text-2 mb-1">Betreff</label>
            <input aria-label="Betreff" type="text" name="betreff" defaultValue={a.betreff ?? ''} className={inputCls()} />
          </div>
          <div>
            <label className="block text-xs font-medium text-s112-text-2 mb-1">Bericht</label>
            <textarea aria-label="Bericht" name="beschreibung" defaultValue={a.beschreibung ?? ''} rows={2} className={inputCls()} />
          </div>
          <div className="flex items-center gap-4 flex-wrap text-xs">
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={ganztags}
                onChange={e => setGanztags(e.target.checked)}
                className="rounded-sm"
              />
              <input type="hidden" name="ganztags" value={String(ganztags)} />
              Ganztags
            </label>
            {!ganztags && (
              <div className="flex items-center gap-1.5">
                <input type="time" name="uhrzeit_von" step="1800" defaultValue={a.uhrzeit_von ?? ''} className="border border-s112-border rounded-sm px-2 py-1 text-xs focus:outline-hidden" />
                <span className="text-s112-tertiary">–</span>
                <input type="time" name="uhrzeit_bis" step="1800" defaultValue={a.uhrzeit_bis ?? ''} className="border border-s112-border rounded-sm px-2 py-1 text-xs focus:outline-hidden" />
              </div>
            )}
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input type="checkbox" name="erledigt" value="true" defaultChecked={a.erledigt ?? false} className="rounded-sm" />
              Erledigt
            </label>
          </div>
          <div className="flex gap-2 pt-1">
            <button type="submit" disabled={pending}
              className="bg-s112-teal text-s112-yellow px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-s112-teal/90 disabled:opacity-40">
              {pending ? 'Speichern…' : 'Speichern'}
            </button>
            <button type="button" onClick={() => setEditMode(false)}
              className="text-xs px-3 py-1.5 rounded-lg border border-s112-border text-s112-text-2 hover:bg-s112-bg">
              Abbrechen
            </button>
            <button type="button" onClick={handleDelete} disabled={pending}
              title="Löschen" aria-label="Löschen"
              className="ml-auto text-xs px-3 py-1.5 rounded-lg text-s112-err hover:bg-s112-err-bg border border-s112-err/30 disabled:opacity-40">
              <Trash2 size={14} />
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
          className={`mt-0.5 w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors disabled:opacity-50 ${
            a.erledigt ? 'bg-s112-ok border-s112-ok text-white' : 'bg-white border-s112-line-str hover:border-s112-ok/50 text-transparent'
          }`}>
          <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
          </svg>
        </button>
      )}
      <div className="shrink-0 w-8 h-8 rounded-full bg-s112-bg flex items-center justify-center text-s112-text-2">
        <ArtIcon size={16} strokeWidth={1.75} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-s112-muted tabular-nums">
            {new Date(a.datum).toLocaleDateString('de-AT')}
          </span>
          {!a.ganztags && von && (
            <span className="text-xs font-medium text-s112-blue-700 tabular-nums">
              {von}{bis ? `–${bis}` : ''}
            </span>
          )}
          <span className="text-xs text-s112-muted">{artDef?.label ?? a.art}</span>
          {a.ist_privat && <span className="text-xs bg-[#F2F3F5] text-s112-text-2 px-1.5 py-0.5 rounded-sm">Privat</span>}
        </div>
        {a.art === 'email' ? (
          <button type="button" onClick={() => setEmailOpen(v => !v)}
            className={`text-sm font-medium text-left w-full text-s112-blue-700 hover:underline mt-0.5 block ${a.erledigt ? 'opacity-60' : ''}`}>
            {a.betreff ?? '(kein Betreff)'} {emailOpen ? '▴' : '▾'}
          </button>
        ) : (
          <p className={`text-sm font-medium text-s112-text mt-0.5 ${a.erledigt ? 'text-s112-tertiary' : ''}`}>
            {a.betreff}
          </p>
        )}
        {a.art === 'email' && emailOpen && (
          <div className="mt-2 border border-s112-border rounded-lg overflow-hidden">
            <div className="bg-s112-bg px-3 py-1.5 text-[11px] text-s112-muted space-y-0.5 border-b border-s112-border">
              {a.email_von && <div><span className="font-medium">Von:</span> {a.email_von_name ? `${a.email_von_name} <${a.email_von}>` : a.email_von}</div>}
              {a.email_an  && <div><span className="font-medium">An:</span> {a.email_an}</div>}
              {a.datum     && <div><span className="font-medium">Datum:</span> {new Date(a.datum).toLocaleDateString('de-AT')}</div>}
            </div>
            {a.email_body
              ? (a.email_body_html
                  // KAN-137: fremdes Mail-HTML nur in der Sandbox (keine Skripte, eigene Herkunft)
                  ? <EmailHtmlAnzeige html={a.email_body_html} schriftgroesse="12px" innenabstand="8px 12px"
                      className="w-full border-0 block bg-white" style={{ height: '16rem' }} />
                  : <pre className="px-3 py-2 text-xs text-s112-text-1 whitespace-pre-wrap font-sans max-h-64 overflow-y-auto">{a.email_body}</pre>)
              : a.beschreibung
                ? <p className="px-3 py-2 text-xs text-s112-text-1 italic">{a.beschreibung}</p>
                : <p className="px-3 py-2 text-xs text-s112-muted italic">Inhalt in /nachrichten öffnen um vollständig zu laden</p>
            }
          </div>
        )}
        {a.beschreibung && !emailOpen && a.art !== 'email' && (
          <p className="text-xs text-s112-text-2 mt-0.5">{a.beschreibung}</p>
        )}
        {a.art === 'email' && replyOpen && (
          <div className="mt-2 space-y-2">
            <textarea value={replyText} onChange={e => setReplyText(e.target.value)} rows={3}
              placeholder={`Antwort an ${firmaEmail ?? '...'}`}
              className="w-full border border-s112-border rounded-lg px-3 py-2 text-xs focus:outline-hidden focus:ring-2 focus:ring-s112-teal/40 resize-none" />
            <div className="flex gap-2">
              <button type="button" disabled={replySending || !replyText.trim()} onClick={async () => {
                if (!firmaEmail || !replyText.trim()) return
                setReplySending(true)
                await fetch('/api/email/unified', {
                  method: 'POST', headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ an: firmaEmail, betreff: `Re: ${a.betreff ?? ''}`, text: replyText, firma_id: firmaId ?? null }),
                })
                setReplySending(false); setReplyOpen(false); setReplyText('')
              }} className="text-xs bg-s112-teal text-s112-yellow px-3 py-1.5 rounded-lg hover:bg-s112-teal/90 disabled:opacity-40">
                {replySending ? 'Senden…' : 'Senden'}
              </button>
              <button type="button" onClick={() => setReplyOpen(false)}
                className="text-xs border border-s112-border text-s112-text-2 px-3 py-1.5 rounded-lg hover:bg-s112-bg">
                Abbrechen
              </button>
            </div>
          </div>
        )}
      </div>
      <div className="flex flex-col gap-1 shrink-0">
        {a.art === 'email' && firmaEmail && !replyOpen && (
          <button type="button" onClick={() => setReplyOpen(true)} title="Antworten"
            className="text-xs text-s112-blue-700 border border-s112-teal/30 px-2 py-1 rounded-lg hover:bg-s112-teal/5">
            <Reply size={13} />
          </button>
        )}
        {writeOk && a.art === 'email' && (
          <button type="button" title="Email-Aktivität löschen"
            onClick={() => { if (confirm('Email aus Aktivitätenliste entfernen?')) startTransition(async () => { await deleteAktivitaet(a.id) }) }}
            className="text-s112-tertiary hover:text-s112-err transition-colors">
            <Trash2 size={14} />
          </button>
        )}
        {writeOk && a.art !== 'email' && (
          <button type="button" onClick={() => setEditMode(true)} title="Bearbeiten"
            className="text-s112-tertiary hover:text-s112-blue-700 transition-colors">
            <Pencil size={14} />
          </button>
        )}
      </div>
    </div>
  )
}

// ── Hauptkomponente ───────────────────────────────────────────────────────────

type Tab = 'kontakte' | 'aktivitaeten' | 'pipeline' | 'verkauefe' | 'notizen'

export default function FirmaDetailClient({
  firma, kontakte, aktivitaeten, pipeline, rabattgruppen = [], verkaeufe = [], writeOk, lieferadressen = [],
}: {
  firma: FirmaRow
  /** KAN-176: weitere Lieferadressen */
  lieferadressen?: LieferadresseZeile[]
  kontakte: KontaktRow[]
  aktivitaeten: AktivitaetRow[]
  pipeline: PipelineEintragRow[]
  rabattgruppen?: { id: string; name: string; rabatt_pct: number }[]
  verkaeufe?: VerkaufRow[]
  writeOk: boolean
}) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [deletePending, startDeleteTransition] = useTransition()

  function handleDelete() {
    if (!confirm(`Firma „${firma.name}" wirklich löschen?`)) return
    startDeleteTransition(async () => {
      const ergebnis = await loeschenOderDeaktivieren(() => deleteFirma(firma.id), () => setzeFirmaAktiv(firma.id, false))
      if (ergebnis === 'geloescht') router.push('/crm/firmen')
      router.refresh()
    })
  }
  // KAN-150 F1: deaktivieren statt löschen bzw. wieder aktivieren
  function handleAktiv(aktiv: boolean) {
    startDeleteTransition(async () => {
      const r = await setzeFirmaAktiv(firma.id, aktiv)
      if (r.error) alert(r.error)
      router.refresh()
    })
  }

  function sortAktivitaeten(akts: AktivitaetRow[]) {
    const offen    = akts.filter(a => !a.erledigt).sort((a, b) => {
      const dCmp = new Date(b.datum).getTime() - new Date(a.datum).getTime()
      return dCmp !== 0 ? dCmp : (a.betreff ?? '').localeCompare(b.betreff ?? '', 'de')
    })
    const erledigt = akts.filter(a =>  a.erledigt).sort((a, b) => {
      const dCmp = new Date(b.datum).getTime() - new Date(a.datum).getTime()
      return dCmp !== 0 ? dCmp : (a.betreff ?? '').localeCompare(b.betreff ?? '', 'de')
    })
    return [...offen, ...erledigt]
  }

  const verkaeufeSorted = [...verkaeufe].sort((a, b) => {
    const dateDiff = new Date(b.datum).getTime() - new Date(a.datum).getTime()
    if (dateDiff !== 0) return dateDiff
    return (b.rechnungsnummer ?? '').localeCompare(a.rechnungsnummer ?? '', 'de', { numeric: true })
  })

  const [tab, setTab] = useState<Tab>('kontakte')
  const [expandedThreads, setExpandedThreads] = useState<Set<string>>(new Set())
  const [showEmailModal, setShowEmailModal] = useState(false)
  const dlgEmail = useDialog(showEmailModal, () => setShowEmailModal(false), 'E-Mail senden')
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
        body: JSON.stringify({ an: firma.email, firma_id: firma.id, betreff: emailBetreff, text: emailText }),
      })
      const json = await res.json()
      if (!res.ok || json.fehler) { setEmailResult('Fehler: ' + (json.fehler ?? 'Unbekannt')); return }
      setEmailResult('E-Mail gesendet'); setEmailBetreff(''); setEmailText('')
      setTimeout(() => { setShowEmailModal(false); setEmailResult(null) }, 1500)
    } catch (err) { setEmailResult('Fehler: ' + String(err)) }
    finally { setEmailSending(false) }
  }

  const [showAktForm, setShowAktForm] = useState(false)
  const [notizText, setNotizText]   = useState('')
  const [notizLaden, setNotizLaden] = useState(false)
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
  }
  const [showPipelineForm, setShowPipelineForm] = useState(false)

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-2 text-sm text-s112-muted">
        <Link href="/crm/firmen" className="hover:text-s112-blue-700">Firmen</Link>
        <span>/</span>
        <span className="text-s112-text font-medium">{firma.name}</span>
      </nav>

      {/* Kopfbereich */}
      {editing ? (
        <FirmaForm
          initial={firma}
          rabattgruppen={rabattgruppen}
          onDone={() => { setEditing(false); router.refresh() }}
        />
      ) : (
      <div className="card p-5">
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 rounded-lg bg-s112-teal/10 flex items-center justify-center text-s112-blue-700 font-semibold text-lg shrink-0">
            {firma.name[0].toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-2xl font-semibold text-s112-text">{firma.name}</h1>
              {firma.aktiv === false && <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-[#F2F3F5] text-s112-text-2" title="Deaktiviert – bleibt auf bestehenden Belegen, erscheint nicht in Auswahllisten">inaktiv</span>}
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${segmentFarbe(firma.segment)}`}>
                {segmentLabel(firma.segment)}
              </span>
            {firma.is_lead && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-s112-warn-bg text-s112-warn-fg font-medium">Lead</span>
            )}
              {firma.ist_kunde && (
                <span className="text-xs px-2 py-0.5 rounded-full bg-s112-blue-100 text-s112-blue-700 font-medium">Kunde</span>
              )}
              {firma.ist_lieferant && (
                <span className="text-xs px-2 py-0.5 rounded-full bg-[#F2F3F5] text-s112-text-1 font-medium">Lieferant</span>
              )}
              {firma.land && firma.land !== 'AT' && (
                <span className="text-xs px-2 py-0.5 rounded-full bg-[#F2F3F5] text-s112-text-2 font-medium" title={firma.land}>{landAnzeige(firma.land)}</span>
              )}
            </div>
            <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1">
              {firma.email && (
                <a href={`mailto:${firma.email}`} className="text-sm text-s112-blue-700 hover:underline flex items-center gap-1">
                  <Mail size={14} /> {firma.email}
                </a>
              )}
              {(firma.email_weitere ?? []).map(e => (
                <a key={e} href={`mailto:${e}`} title="weitere E-Mail-Adresse" className="text-sm text-s112-text-1 hover:text-s112-blue-700 hover:underline flex items-center gap-1">
                  <Mail size={14} className="text-s112-tertiary" /> {e}
                </a>
              ))}
              {firma.telefon && (
                <a href={`tel:${firma.telefon_vorwahl ?? '+43'}${firma.telefon?.replace(/\s/g, '')}`}
                  onClick={e => handlePhoneClick(e, `${firma.telefon_vorwahl ?? '+43'} ${firma.telefon}`)}
                  className="text-sm text-s112-text-2 hover:text-s112-blue-700 flex items-center gap-1">
                  <Phone size={14} /> {firma.telefon_vorwahl ?? '+43'} {firma.telefon}
                </a>
              )}
              {firma.mobil && (
                <a href={`tel:${firma.mobil_vorwahl ?? '+43'}${firma.mobil?.replace(/\s/g, '')}`}
                  onClick={e => handlePhoneClick(e, `${firma.mobil_vorwahl ?? '+43'} ${firma.mobil}`)}
                  className="text-sm text-s112-text-2 hover:text-s112-blue-700 flex items-center gap-1">
                  <Smartphone size={14} /> {firma.mobil_vorwahl ?? '+43'} {firma.mobil}
                </a>
              )}
              {firma.website && (
                <a href={firma.website} target="_blank" rel="noopener noreferrer"
                  className="text-sm text-s112-blue-700 hover:underline flex items-center gap-1">
                  <Globe size={14} /> {firma.website.replace(/^https?:\/\//, '')}
                </a>
              )}
              {(firma.plz || firma.ort) && (
                <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([firma.strasse, firma.plz, firma.ort, 'Österreich'].filter(Boolean).join(', '))}`}
                  target="_blank" rel="noopener noreferrer"
                  className="text-sm text-s112-text-2 hover:text-s112-blue-700 flex items-center gap-1">
                  <MapPin size={14} /> {[firma.strasse, firma.plz && firma.ort ? `${firma.plz} ${firma.ort}` : (firma.plz ?? firma.ort)].filter(Boolean).join(', ')}
                </a>
              )}
              {firma.uid_nummer && (
                <span className="text-sm text-s112-text-2">UID: {firma.uid_nummer}</span>
              )}
              {firma.debitor_nr && (
                <span className="text-sm text-s112-text-2">DebitorNr.: {firma.debitor_nr}</span>
              )}
              <span className="text-sm text-s112-text-2">
                Zahlungsziel: {firma.zahlungsziel_tage === 0 ? 'bei Erhalt' : `${firma.zahlungsziel_tage} Tage`}
              </span>
            </div>
            {firma.notizen && (
              <p className="mt-2 text-sm text-s112-text-2 italic">{firma.notizen}</p>
            )}
          </div>
          {writeOk && (
            <div className="flex gap-2 shrink-0 self-start">
              <button
                onClick={() => setEditing(true)}
                title="Bearbeiten" aria-label="Bearbeiten"
                className="inline-flex items-center justify-center border border-s112-border text-s112-text-2 w-8 h-8 rounded-lg hover:bg-s112-bg transition-colors">
                <Pencil size={15} />
              </button>
              <button
                onClick={() => handleAktiv(firma.aktiv === false)}
                disabled={deletePending}
                title={firma.aktiv === false ? 'Reaktivieren' : 'Deaktivieren'} aria-label={firma.aktiv === false ? 'Reaktivieren' : 'Deaktivieren'}
                className="inline-flex items-center justify-center border border-s112-border text-s112-text-2 w-8 h-8 rounded-lg hover:bg-s112-bg transition-colors disabled:opacity-40">
                {firma.aktiv === false ? <RotateCcw size={15} /> : <PowerOff size={15} />}
              </button>
              <button
                onClick={handleDelete}
                disabled={deletePending}
                title="Löschen" aria-label="Löschen"
                className="inline-flex items-center justify-center border border-s112-err/30 text-s112-err-fg w-8 h-8 rounded-lg hover:bg-s112-err-bg transition-colors disabled:opacity-40">
                <Trash2 size={15} />
              </button>
            </div>
          )}
        </div>
      </div>
      )}

      {/* KAN-176: Lieferadressen */}
      <div className="card p-4">
        <LieferadressenKarte adressen={lieferadressen} firmaId={firma.id} writeOk={writeOk} />
      </div>

      {/* Tabs */}
      <div className="border-b border-s112-border">
        <div className="flex gap-0">
          {([
            { id: 'kontakte',     label: `Kontakte (${kontakte.length})`        },
            { id: 'aktivitaeten', label: `Aktivitäten (${aktivitaeten.filter(a => a.art !== 'verkauf').length})` },
            { id: 'pipeline',     label: `Pipeline (${pipeline.length})`        },
            { id: 'verkauefe',    label: `Verkäufe (${verkaeufeSorted.length})` },
            { id: 'notizen', label: `Notizen (${aktivitaeten.filter(a => a.art === 'notiz').length})` },
          ] as { id: Tab; label: string }[]).map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                tab === t.id
                  ? 'border-s112-teal text-s112-blue-700'
                  : 'border-transparent text-s112-muted hover:text-s112-text-1'
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
                <div className="w-8 h-8 rounded-full bg-s112-teal/10 flex items-center justify-center text-s112-blue-700 font-semibold text-sm shrink-0">
                  {(k.vorname?.[0] ?? k.nachname[0]).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Link href={`/crm/kontakte/${k.id}`}
                      className="text-sm font-medium text-s112-text hover:text-s112-blue-700 hover:underline">
                      {kName}
                    </Link>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${segmentFarbe(k.segment)}`}>
                      {segmentLabel(k.segment)}
                    </span>
                    {k.stammkunde && (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-s112-yellow/20 text-s112-warn-fg font-medium">Stammkunde</span>
                    )}
                  </div>
                  {k.email && (
                    <a href={`mailto:${k.email}`} className="text-xs text-s112-blue-700 hover:underline">{k.email}</a>
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
          <div className="flex items-center justify-between gap-2">
            <Link href="/crm" className="text-xs text-s112-muted hover:text-s112-blue-700">→ Kalender</Link>
            {writeOk && !showAktForm && (
              <button onClick={() => setShowAktForm(true)}
                className="text-xs font-medium text-s112-blue-700 border border-s112-teal/30 rounded-full px-2.5 py-0.5 hover:bg-s112-teal hover:text-s112-yellow transition-colors">
                + Aktivität
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
              {(() => {
                const emails = aktivitaeten.filter(a => a.art === 'email')
                const others = aktivitaeten.filter(a => a.art !== 'verkauf' && a.art !== 'notiz' && a.art !== 'email')
                // Thread-Gruppierung
                const threads: Record<string, AktivitaetRow[]> = {}
                const singles: AktivitaetRow[] = []
                emails.forEach(a => {
                  const cid = a.email_conversation_id ?? (a.betreff ?? '').replace(/^(Re|AW|Fwd|WG|FW|Antwort)(:\s*)+/gi,'').trim().toLowerCase()
                  if (!cid) { singles.push(a); return }
                  if (!threads[cid]) threads[cid] = []
                  threads[cid].push(a)
                })
                Object.entries(threads).forEach(([cid, msgs]) => {
                  if (msgs.length === 1) singles.push(msgs[0])
                  else threads[cid] = msgs.sort((a,b) => new Date(a.datum).getTime() - new Date(b.datum).getTime())
                })
                const threadEntries = Object.entries(threads).filter(([,m]) => m.length > 1)
                return (<>
                  {threadEntries.map(([cid, msgs]) => {
                    const latest = msgs[msgs.length - 1]
                    const expanded = expandedThreads.has(cid)
                    return (
                      <div key={cid} className="border border-s112-border rounded-xl overflow-hidden">
                        <button type="button"
                          onClick={() => setExpandedThreads(prev => { const s=new Set(prev); expanded?s.delete(cid):s.add(cid); return s })}
                          className="w-full flex items-center gap-3 px-4 py-2.5 bg-s112-blue-50 hover:bg-s112-blue-100 transition-colors text-left">
                          <Mail size={16} className="text-s112-blue-700 shrink-0" />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-s112-text truncate">{latest.betreff}</p>
                            <p className="text-xs text-s112-muted">{msgs.length} E-Mails · {new Date(latest.datum).toLocaleDateString('de-AT')} · {expanded ? 'einklappen ▴' : 'ausklappen ▾'}</p>
                          </div>
                          <span className="text-xs bg-s112-blue-100 text-s112-blue-700 px-2 py-0.5 rounded-full font-semibold">{msgs.length}</span>
                        </button>
                        {expanded && (
                          <div className="divide-y divide-s112-border/40">
                            {msgs.map(a => <AktivitaetKarte key={a.id} a={a} writeOk={writeOk} firmaEmail={firma.email ?? undefined} firmaId={firma.id} />)}
                          </div>
                        )}
                      </div>
                    )
                  })}
                  {singles.map(a => <AktivitaetKarte key={a.id} a={a} writeOk={writeOk} firmaEmail={firma.email ?? undefined} firmaId={firma.id} />)}
                  {others.map(a => <AktivitaetKarte key={a.id} a={a} writeOk={writeOk} firmaEmail={firma.email ?? undefined} firmaId={firma.id} />)}
                </>)
              })()}
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
                className="text-xs font-medium text-s112-blue-700 border border-s112-teal/30 rounded-full px-2.5 py-0.5 hover:bg-s112-teal hover:text-s112-yellow transition-colors">
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
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div className="flex items-center gap-2 flex-wrap">
                      <span className={`text-xs px-2.5 py-0.5 rounded-full font-semibold ${stufeDef?.farbe ?? 'bg-[#F2F3F5] text-s112-text-1'}`}>
                        {stufeDef?.label ?? p.stufe}
                      </span>
                      <span className="text-sm font-medium text-s112-text">{p.titel}</span>
                      </div>
                      <Link href="/crm/pipeline" className="text-xs text-s112-blue-700 hover:underline shrink-0">→ Pipeline</Link>
                    </div>
                    <div className="flex gap-4 text-xs text-s112-muted flex-wrap">
                      {p.wert_euro != null && (
                        <span className="font-semibold text-s112-blue-700">
                          {fmtEur(p.wert_euro)}
                        </span>
                      )}
                      {p.wahrscheinlichkeit != null && <span>{p.wahrscheinlichkeit}%</span>}
                      {abschluss && <span>{abschluss}</span>}
                    </div>
                    {p.notizen && (
                      <p className="text-xs text-s112-text-2 italic">{p.notizen}</p>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
      {/* Tab: Verkäufe */}
      {tab === 'verkauefe' && (
        <div className="space-y-2">
          {verkaeufeSorted.length === 0 ? (
            <div className="card p-6 text-center text-s112-muted text-sm">Noch keine Verkäufe erfasst.</div>
          ) : (
            <div className="card p-0 overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-s112-bg border-b border-s112-border">
                    <th className="text-left px-4 py-2.5 font-semibold text-s112-text-1">Datum</th>
                    <th className="text-left px-4 py-2.5 font-semibold text-s112-text-1">Belegnr.</th>
                    <th className="text-right px-4 py-2.5 font-semibold text-s112-text-1">Betrag</th>
                    <th className="text-center px-4 py-2.5 font-semibold text-s112-text-1">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {verkaeufeSorted.map(v => {
                    const summe = verkaufSumme(v)
                    return (
                      <tr key={v.id} className="border-b border-s112-border last:border-0 hover:bg-s112-bg/50">
                        <td className="px-4 py-2.5 text-xs tabular-nums text-s112-muted">
                          {new Date(v.datum).toLocaleDateString('de-AT')}
                        </td>
                        <td className="px-4 py-2.5 text-xs font-medium text-s112-text">
                          <Link href={`/weinhandel/verkauf/${v.id}`} className="font-mono text-s112-blue-700 hover:underline">
                            {v.rechnungsnummer ?? 'ohne Belegnr.'}
                          </Link>
                          {v.transaktions_nr && <div className="font-mono text-s112-muted mt-0.5">{v.transaktions_nr}</div>}
                        </td>
                        <td className="px-4 py-2.5 text-right font-semibold text-s112-blue-700 tabular-nums">
                          {summe > 0
                            ? fmtEur(summe)
                            : <span className="text-s112-muted font-normal">–</span>}
                        </td>
                        <td className="px-4 py-2.5 text-center">
                          {v.storniert ? (
                            <span className="text-xs px-2 py-0.5 rounded-full bg-s112-err-bg text-s112-err-fg font-medium">Storniert</span>
                          ) : v.bezahlt ? (
                            <span className="text-xs px-2 py-0.5 rounded-full bg-s112-ok-bg text-s112-ok-fg font-medium">Bezahlt</span>
                          ) : (
                            <span className="text-xs px-2 py-0.5 rounded-full bg-s112-warn-bg text-s112-warn-fg font-medium">Offen</span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── E-Mail senden Modal ── */}
      {showEmailModal && firma.email && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          onClick={() => setShowEmailModal(false)}>
          <div {...dlgEmail} className="bg-white rounded-xl shadow-2xl p-6 w-full max-w-md mx-4"
            onClick={e => e.stopPropagation()}>
            <h3 className="text-base font-semibold text-s112-text mb-4 inline-flex items-center gap-1.5"><Mail size={16} />E-Mail senden</h3>
            <form onSubmit={sendEmail} className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-s112-text-2 mb-1">An</label>
                <input aria-label="An" value={firma.email} readOnly className="w-full border border-s112-border rounded-lg px-3 py-1.5 text-sm bg-s112-bg" />
              </div>
              <div>
                <label className="block text-xs font-medium text-s112-text-2 mb-1">Betreff *</label>
                <input aria-label="Betreff" value={emailBetreff} onChange={e => setEmailBetreff(e.target.value)} required autoFocus
                  className="w-full border border-s112-border rounded-lg px-3 py-1.5 text-sm focus:outline-hidden focus:ring-2 focus:ring-s112-teal/40" />
              </div>
              <div>
                <label className="block text-xs font-medium text-s112-text-2 mb-1">Nachricht</label>
                <textarea aria-label="Nachricht" value={emailText} onChange={e => setEmailText(e.target.value)} rows={5}
                  className="w-full border border-s112-border rounded-lg px-3 py-1.5 text-sm focus:outline-hidden focus:ring-2 focus:ring-s112-teal/40 resize-none" />
              </div>
              {emailResult && (
                <p className={`text-xs font-medium inline-flex items-center gap-1 ${emailResult === 'E-Mail gesendet' ? 'text-s112-ok-fg' : 'text-s112-err-fg'}`}>
                  {emailResult === 'E-Mail gesendet' ? <Check size={12} /> : <X size={12} />}
                  {emailResult}
                </p>
              )}
              <div className="flex gap-2 pt-1">
                <button type="submit" disabled={emailSending}
                  className="bg-s112-teal text-s112-yellow px-4 py-1.5 rounded-lg text-sm font-medium hover:bg-s112-teal/90 disabled:opacity-40">
                  {emailSending ? 'Senden…' : 'Senden'}
                </button>
                <button type="button" onClick={() => setShowEmailModal(false)}
                  className="text-sm px-4 py-1.5 rounded-lg border border-s112-border text-s112-text-2 hover:bg-s112-bg">
                  Abbrechen
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {copiedNum && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-s112-text text-white text-sm px-4 py-2 rounded-xl shadow-lg inline-flex items-center gap-1.5">
          <ClipboardCheck size={14} /> {copiedNum} kopiert
        </div>
      )}

        {/* ── Notizen Tab ── */}
        {tab === 'notizen' && (
          <div className="space-y-3">
            {writeOk && (
              <form onSubmit={async e => {
                e.preventDefault()
                if (!notizText.trim()) return
                setNotizLaden(true)
                const fd = new FormData()
                fd.set('art', 'notiz'); fd.set('betreff', notizText)
                fd.set('firma_id', firma.id)
                fd.set('datum', new Date().toISOString().split('T')[0]); fd.set('ganztags', 'true'); fd.set('erledigt', 'false')
                await createAktivitaet(fd)
                setNotizText(''); setNotizLaden(false)
              }} className="flex gap-2">
                <input value={notizText} onChange={e => setNotizText(e.target.value)}
                  placeholder="Neue Notiz…" required
                  className="flex-1 border border-s112-border rounded-lg px-3 py-1.5 text-sm focus:outline-hidden focus:ring-2 focus:ring-s112-teal/40" />
                <button type="submit" disabled={notizLaden}
                  className="bg-s112-teal text-s112-yellow px-4 py-1.5 rounded-lg text-sm font-medium hover:bg-s112-teal/90 disabled:opacity-40">
                  + Notiz
                </button>
              </form>
            )}
            <div className="space-y-2">
              {[...aktivitaeten.filter(a => a.art === 'notiz')].sort((a,b) => Number(a.erledigt) - Number(b.erledigt)).map(n => (
                <div key={n.id} className={`card p-4 flex gap-3 ${n.erledigt ? 'opacity-60' : ''}`}>
                  <button type="button" onClick={() => toggleAktivitaetErledigt(n.id, !n.erledigt)}
                    className={`mt-0.5 w-5 h-5 rounded-sm border-2 flex items-center justify-center shrink-0 ${n.erledigt ? 'bg-s112-ok border-s112-ok text-white' : 'border-s112-line-str hover:border-s112-ok/50'}`}>
                    {n.erledigt && <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>}
                  </button>
                  <div className="flex-1">
                    <p className={`text-sm ${n.erledigt ? 'text-s112-tertiary' : 'text-s112-text'}`}>{n.betreff}</p>
                    <p className="text-xs text-s112-muted mt-0.5">{new Date(n.datum).toLocaleDateString('de-AT')}</p>
                  </div>
                </div>
              ))}
              {aktivitaeten.filter(a => a.art === 'notiz').length === 0 && (
                <p className="text-center text-s112-muted text-sm py-8">Noch keine Notizen.</p>
              )}
            </div>
          </div>
        )}
    </div>
  )
}
