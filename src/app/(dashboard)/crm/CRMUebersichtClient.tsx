'use client'

import { useState, useMemo, useRef, useEffect, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { createAktivitaet, moveAktivitaet, updateAktivitaet, updatePipelineEintrag, toggleAktivitaetErledigt, deleteAktivitaet, deletePipelineEintrag } from './actions'
import { AKTIVITAET_ARTEN } from '@/lib/crm/types'
import { X, Lock, Pencil, Calendar, Check, Trash2 } from 'lucide-react'
import { fehlerText } from '@/lib/fehler'
import { useDialog } from '@/components/ui/useDialog'
import { tastaturBedienbar } from '@/lib/ui/tastatur'

// ── Typeahead-Suche ───────────────────────────────────────────────────────────
interface SucheItem { id: string; label: string; sub?: string }
function KundenSuche({ items = [], art, value, onChange, placeholder }: {
  items?: SucheItem[]; art?: 'kontakt' | 'firma'; value: string; onChange: (v: string) => void; placeholder?: string
}) {
  // art gesetzt → Treffer serverseitig über /api/crm/suche (17.9.2026), sonst
  // Filter über die mitgegebenen items.
  const [query, setQuery] = useState('')
  const [open,  setOpen]  = useState(false)
  const [server, setServer] = useState<SucheItem[]>([])
  const [gewaehlt, setGewaehlt] = useState<SucheItem | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const selected = items.find(i => i.id === value) ?? (gewaehlt?.id === value ? gewaehlt : null)
  const treffer = art
    ? server
    : query.length < 1
      ? items.slice(0, 50)
      : items.filter(i => (i.label + ' ' + (i.sub ?? '')).toLowerCase().includes(query.toLowerCase())).slice(0, 50)
  useEffect(() => {
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [])
  useEffect(() => {
    if (!art || !open) return
    const t = setTimeout(() => {
      fetch(`/api/crm/suche?art=${art}&q=${encodeURIComponent(query)}`)
        .then(r => r.json()).then(d => setServer(d.treffer ?? [])).catch(() => setServer([]))
    }, 250)
    return () => clearTimeout(t)
  }, [art, query, open])
  useEffect(() => {
    // Vorbelegter Wert (z.B. Bearbeiten) ohne Label → Namen nachladen
    if (!art || !value || selected) return
    fetch(`/api/crm/suche?art=${art}&ids=${encodeURIComponent(value)}`)
      .then(r => r.json()).then(d => { const t = (d.treffer ?? [])[0]; if (t) setGewaehlt(t) }).catch(() => {})
  }, [art, value, selected])
  return (
    <div ref={ref} className="relative">
      {selected ? (
        <div className="flex items-center gap-1 border border-s112-border rounded-lg px-2 py-1.5 bg-s112-bg">
          <span className="text-sm flex-1 truncate">{selected.label}</span>
          <button type="button" aria-label="Auswahl leeren" onClick={() => { onChange(''); setQuery('') }}
            className="text-s112-tertiary hover:text-s112-text-2 shrink-0 leading-none"><X size={13} /></button>
        </div>
      ) : (
        <>
          <input type="text" value={query}
            onChange={e => { setQuery(e.target.value); setOpen(true) }}
            onFocus={() => setOpen(true)}
            placeholder={placeholder ?? 'Suchen…'}
            className="border border-s112-border rounded-lg px-2 py-1.5 text-sm focus:outline-hidden w-full" />
          {open && treffer.length > 0 && (
            <ul className="absolute z-50 mt-1 w-full bg-white border border-s112-border rounded-lg shadow-lg max-h-48 overflow-y-auto">
              {treffer.map(i => (
                <li key={i.id}
                  onMouseDown={e => { e.preventDefault(); onChange(i.id); setGewaehlt(i); setQuery(''); setOpen(false) }}
                  className="px-3 py-2 hover:bg-s112-bg cursor-pointer">
                  <span className="text-sm font-medium">{i.label}</span>
                  {i.sub && <span className="text-xs text-s112-muted ml-1">{i.sub}</span>}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  )
}

// ── Verantwortlich-Auswahl (Aufgabenzuordnung, 22.9.2026) ────────────────────

export type MitgliedOption = { id: string; name: string }

/** Wert des Feldes „verantwortlich“: '' = Betrieb, 'alle' = für alle, sonst user_id */
function verantwortlichWert(e: { verantwortlich_id?: string | null; fuer_alle?: boolean } | null | undefined): string {
  if (e?.fuer_alle) return 'alle'
  return e?.verantwortlich_id ?? ''
}

function verantwortlichText(e: { verantwortlich_id?: string | null; fuer_alle?: boolean }, userProfiles: Record<string, string>, userId?: string | null): string {
  if (e.fuer_alle) return 'Alle im Betrieb'
  if (!e.verantwortlich_id) return 'Betrieb (niemand zugeordnet)'
  const name = userProfiles[e.verantwortlich_id] ?? 'Unbekannt'
  return e.verantwortlich_id === userId ? `${name} (ich)` : name
}

function VerantwortlichSelect({ mitglieder, userId, defaultValue, className }: {
  mitglieder: MitgliedOption[]; userId?: string | null; defaultValue: string; className: string
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-s112-text-2 mb-1">Verantwortlich</label>
      <select aria-label="Verantwortlich" name="verantwortlich" defaultValue={defaultValue} className={className}>
        {mitglieder.filter(m => m.id === userId).map(m => <option key={m.id} value={m.id}>{m.name} (ich)</option>)}
        <option value="alle">Alle im Betrieb</option>
        <option value="">Betrieb (niemand)</option>
        {mitglieder.filter(m => m.id !== userId).map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
      </select>
    </div>
  )
}

// ── Outlook-Termin (Einladung an Kollegen, Frei/Belegt) – Migration 225 ─────────

export type OutlookStatus = { verbunden: boolean; schreiben: boolean; schreibenAktiv: boolean; kollegen: { id: string; name: string }[] }
type FreiBelegtInfo = { id: string; name: string; verfuegbar: boolean; belegt: { von: string; bis: string; status: string; betreff?: string | null }[]; fehler?: string | null }

/** Block im Termin-Dialog: „In Outlook anlegen“ + Teilnehmer mit Frei/Belegt am gewählten Tag */
function OutlookBlock({ outlook, datum, aktiv, setAktiv, teilnehmer, setTeilnehmer }: {
  outlook: OutlookStatus; datum: string; aktiv: boolean; setAktiv: (v: boolean) => void
  teilnehmer: string[]; setTeilnehmer: (v: string[]) => void
}) {
  const [frei, setFrei] = useState<FreiBelegtInfo[] | null>(null)
  useEffect(() => {
    if (outlook.kollegen.length === 0) return
    let cancelled = false
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Laden/Abonnieren im Effekt: Lade- bzw. Startzustand setzen, Ergebnis kommt asynchron
    setFrei(null)
    fetch(`/api/crm/outlook-frei?datum=${datum}`).then(r => r.json()).then(j => { if (!cancelled) setFrei(j.ok ? j.kollegen : []) }).catch(() => { if (!cancelled) setFrei([]) })
    return () => { cancelled = true }
  }, [datum, outlook.kollegen.length])
  const darf = outlook.schreiben
  const toggle = (id: string) => setTeilnehmer(teilnehmer.includes(id) ? teilnehmer.filter(x => x !== id) : [...teilnehmer, id])
  return (
    <div className="rounded-lg border border-s112-border bg-s112-bg/40 px-3 py-2 space-y-1.5">
      <label className={`flex items-center gap-2 ${darf ? 'cursor-pointer' : 'opacity-60'}`}>
        <input type="checkbox" checked={aktiv && darf} disabled={!darf} onChange={e => setAktiv(e.target.checked)} className="accent-s112-teal" />
        <span className="text-xs font-medium text-s112-text-1">In Outlook anlegen{teilnehmer.length > 0 && aktiv && darf ? ` und ${teilnehmer.length} einladen` : ''}</span>
      </label>
      {!darf && (
        <p className="text-[11px] text-s112-tertiary">
          {outlook.schreibenAktiv
            ? 'Ihre Outlook-Verbindung hat noch kein Schreibrecht auf den Kalender – unter Nachrichten einmal trennen und neu verbinden.'
            : 'Termine in Outlook anlegen ist für diesen Betrieb noch nicht freigeschaltet (Berechtigung Calendars.ReadWrite in Entra). Frei/Belegt der Kollegen sehen Sie trotzdem.'}
        </p>
      )}
      {outlook.kollegen.length > 0 && (
        <ul className="space-y-1">
          {outlook.kollegen.map(k => {
            const f = frei?.find(x => x.id === k.id)
            return (
              <li key={k.id} className="flex items-start gap-2">
                <input type="checkbox" checked={teilnehmer.includes(k.id)} disabled={!darf} onChange={() => toggle(k.id)} className="accent-s112-teal mt-0.5" />
                <span className="min-w-0">
                  <span className="text-xs text-s112-text-1">{k.name}</span>
                  <span className="block text-[11px] text-s112-tertiary">
                    {frei === null ? 'Frei/Belegt wird geladen …'
                      : !f || !f.verfuegbar ? 'Frei/Belegt nicht abrufbar'
                      : f.belegt.length === 0 ? 'ganztägig frei'
                      : 'belegt ' + f.belegt.map(b => `${b.von}–${b.bis}${b.betreff ? ` (${b.betreff})` : ''}`).join(', ')}
                  </span>
                </span>
              </li>
            )
          })}
        </ul>
      )}
      {outlook.kollegen.length === 0 && <p className="text-[11px] text-s112-tertiary">Keine Kollegin/kein Kollege hat bisher ein Outlook-Konto verbunden.</p>}
    </div>
  )
}

// ── Typen ─────────────────────────────────────────────────────────────────────

export type KalenderEintrag = {
  ist_privat?: boolean | null
  erstellt_von?: string | null
  verantwortlich_id?: string | null   // zugewiesener Benutzer; null = Betrieb
  fuer_alle?: boolean                 // gilt für alle Mitglieder
  beschreibung?: string | null
  id: string
  datum: string          // YYYY-MM-DD
  titel: string
  typ: 'aktivitaet' | 'pipeline' | 'outlook' | 'privat'   // privat: KAN-17, fremder privater Termin – nur Zeitblock
  art?: string
  artIcon?: string
  ganztags?: boolean
  uhrzeit_von?: string | null   // "HH:MM:SS"
  uhrzeit_bis?: string | null
  bis_datum?: string | null    // Enddatum für mehrtägige Ganztags-Events
  ueberfaellig: boolean
  erledigt?: boolean
  href: string
  kontaktName?: string | null
  firmaName?: string | null
  stufe?: string
}

type ViewMode = 'zeitachse' | 'monat' | 'jahr'

// ── Datum-Hilfsfunktionen ─────────────────────────────────────────────────────

function addDays(date: Date, days: number): Date {
  const d = new Date(date)
  d.setDate(d.getDate() + days)
  return d
}

function startOfWeek(date: Date): Date {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  const day = d.getDay()
  d.setDate(d.getDate() - (day === 0 ? 6 : day - 1))
  return d
}

function toDateStr(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

const WOCHENTAGE      = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So']
const WOCHENTAGE_KURZ = ['M', 'D', 'M', 'D', 'F', 'S', 'S']
const MONATE = [
  'Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
  'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember',
]
const MONATE_KURZ = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez']

// ── Chip-Styling ──────────────────────────────────────────────────────────────

const ART_FARBEN: Record<string, string> = {
  anruf:      'bg-s112-ok-bg text-s112-ok-fg border-s112-ok/30',
  besprechung:'bg-[#F2F3F5] text-s112-text-1 border-s112-line-str',
  aufgabe:    'bg-[#F2F3F5] text-s112-text-1 border-s112-line-str',
  email:      'bg-s112-warn-bg text-s112-warn-fg border-s112-warn/30',
  verkostung: 'bg-[#F2F3F5] text-s112-text-1 border-s112-line-str',
  besuch:     'bg-s112-blue-50 text-s112-blue-700 border-s112-blue-100',
  messe:      'bg-s112-blue-50 text-s112-blue-700 border-s112-blue-100',
  angebot:    'bg-s112-warn-bg text-s112-warn-fg border-s112-warn/30',
  notiz:      'bg-s112-bg text-s112-text-2 border-s112-line',
  urlaub:     'bg-s112-warn-bg text-s112-warn-fg border-s112-warn/30',
  abwesenheit:'bg-s112-bg text-s112-text-2 border-s112-line',
}

function chipFarbe(e: KalenderEintrag): string {
  if (e.erledigt) return 'bg-s112-bg text-s112-tertiary border-s112-line opacity-60'
  if (e.ueberfaellig) return 'bg-s112-err text-white border-s112-err'
  if (e.typ === 'privat') return 'bg-[#F2F3F5] text-s112-text-2 border-s112-line italic'
  if (e.typ === 'outlook') return 'bg-s112-blue-50 text-s112-blue-700 border-s112-blue-100'
  if (e.typ === 'pipeline') return 'bg-[#F2F3F5] text-s112-text-1 border-s112-line-str'
  return ART_FARBEN[e.art ?? ''] ?? 'bg-s112-bg text-s112-text-2 border-s112-line'
}

// ── Eintrag-Chip ──────────────────────────────────────────────────────────────

function fmtT(t: string | null | undefined): string | null {
  if (!t) return null
  return t.slice(0, 5)  // "14:30:00" -> "14:30"
}

function EintragChip({ e, compact = false, onViewAkt }: { e: KalenderEintrag; compact?: boolean; onViewAkt?: (e: KalenderEintrag) => void }) {
  const farbe = chipFarbe(e)
  const overdueInline = e.ueberfaellig
    ? { backgroundColor: '#C9564E', color: '#ffffff', borderColor: '#8E3A34' }
    : undefined
  const von = !e.ganztags ? fmtT(e.uhrzeit_von) : null
  const bis = !e.ganztags ? fmtT(e.uhrzeit_bis) : null
  const zeitLabel = von ? (bis ? `${von}–${bis}` : von) : null

  return (
    <div role="button" tabIndex={0} onClick={() => onViewAkt?.(e)} onKeyDown={ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); onViewAkt?.(e) } }} title={`${e.titel}${e.kontaktName ? ` – ${e.kontaktName}` : ''}${e.firmaName ? ` (${e.firmaName})` : ''}`} className={e.typ === 'privat' ? 'cursor-default' : 'cursor-pointer'}>
      <div
        className={`border rounded truncate leading-snug transition-opacity hover:opacity-75
          ${compact ? 'text-[10px] px-1 py-px' : 'text-xs px-2 py-1'}
          ${farbe}`}
        style={overdueInline}>
        {zeitLabel && !compact && (
          <span className="font-semibold mr-1 tabular-nums">{zeitLabel}</span>
        )}
        {zeitLabel && compact && (
          <span className="font-semibold mr-0.5 tabular-nums">{von}</span>
        )}
        <span className="font-medium">{e.titel}</span>
        {!compact && (e.kontaktName || e.firmaName) && (
          <span className="block text-[10px] opacity-60 truncate mt-px">
            {e.kontaktName ?? e.firmaName}
          </span>
        )}
      </div>
    </div>
  )
}

// ── Wochen-Ansicht ────────────────────────────────────────────────────────────

// ── Zeitachsen-Ansicht (Outlook-Style) ────────────────────────────────────────

const HOUR_H = 64  // px per hour

function ZeitachseView({
  eintraege, current, heute, userProfiles = {}, mitglieder = [], userId = null, oeffneId = null, outlook = null,
}: {
  eintraege: KalenderEintrag[]
  current: Date
  heute: string
  userProfiles?: Record<string, string>
  mitglieder?: MitgliedOption[]
  userId?: string | null
  oeffneId?: string | null
  outlook?: OutlookStatus | null
}) {
  const router    = useRouter()
  const scrollRef = useRef<HTMLDivElement>(null)
  // Wochenbeginn als Zahl: monday/days behalten ihre Identität, solange die Woche gleich bleibt
  const wocheMs   = startOfWeek(current).getTime()
  const monday    = useMemo(() => new Date(wocheMs), [wocheMs])
  const days      = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(monday, i)), [monday])
  const [pending, startTransition] = useTransition()
  const [filterUser, setFilterUser] = useState<string>('alle')
  // Nur User mit aufloesbarem Namen (userProfiles) bekommen einen eigenen
  // Filter-Button. Termine koennen von Benutzern stammen, die inzwischen
  // aus dem Mandanten entfernt wurden bzw. deren profiles-Zeile nicht mehr
  // existiert - fuer die gaebe es sonst nur ein unklares ID-Kuerzel als
  // Button (siehe Kalender-Feedback 7.8.2026). Ihre Termine bleiben unter
  // "Alle" weiterhin sichtbar, nur der verwirrende Einzel-Filter faellt weg.
  const uniqueUsers = useMemo(
    () => [...new Set(eintraege.map(e => e.erstellt_von).filter(Boolean))].filter(uid => !!userProfiles[uid!]),
    [eintraege, userProfiles]
  )
  // Nach erstellendem User filtern, falls nicht "Alle" ausgewaehlt. uniqueUsers
  // bewusst weiterhin aus dem UNGEFILTERTEN eintraege ableiten (sonst wuerden
  // die Filter-Buttons nach dem Filtern selbst wieder verschwinden).
  //
  // Termine OHNE erstellt_von (Alt-/Importdaten von vor der Nachverfolgung, oder
  // durch ON DELETE SET NULL bei inzwischen entfernten Erstellern - siehe Migration
  // 050) lassen sich niemandem mehr zuordnen. Sie unter jedem Namens-Filter
  // stillschweigend verschwinden zu lassen (Kalender-Feedback 7.8.2026: "alle
  // Termine bis auf einen verschwunden") ist irrefuehrend - sie werden daher bei
  // JEDEM Filter mit angezeigt, nicht nur unter "Alle" (in der Detailansicht ist
  // durch "Erstellt von: -" trotzdem erkennbar, dass keine Zuordnung vorliegt).
  const gefilterteEintraege = useMemo(
    () => filterUser === 'alle' ? eintraege : eintraege.filter(e => e.erstellt_von === filterUser || !e.erstellt_von),
    [eintraege, filterUser]
  )

  // Aktivität-Detail anzeigen
  const [viewAkt,    setViewAkt]    = useState<KalenderEintrag | null>(null)
  // KAN-17: fremde private Termine sind nur ein Zeitblock – kein Detail-Dialog
  const zeigeEintrag = (e: KalenderEintrag) => { if (e.typ !== 'privat') setViewAkt(e) }
  // Termin aus dem Link (?oeffne=) öffnen – beim Rendern statt im Effekt; Startwert null, damit es wie bisher
  // auch beim ersten Anzeigen greift
  const [oeffneIdVorher, setOeffneIdVorher] = useState<string | null>(null)
  if ((oeffneId ?? null) !== oeffneIdVorher) {
    setOeffneIdVorher(oeffneId ?? null)
    const e = oeffneId ? eintraege.find(x => x.id === `a_${oeffneId}`) : undefined
    if (e) setViewAkt(e)
  }
  const [editAktMode,  setEditAktMode]  = useState(false)
  const [editPipeMode, setEditPipeMode] = useState(false)

  // neue Aktivität
  const [newAkt,         setNewAkt]         = useState<{ datum: string; von: string; bis: string; ganztags: boolean } | null>(null)
  const [newAktKontaktId, setNewAktKontaktId] = useState('')
  const [newAktFirmaId,   setNewAktFirmaId]   = useState('')
  const dlgView = useDialog(!!viewAkt, () => { setViewAkt(null); setEditAktMode(false); setEditPipeMode(false) }, 'Aktivität')
  const dlgNeu  = useDialog(!!newAkt, () => { setNewAkt(null); setNewAktKontaktId(''); setNewAktFirmaId('') }, 'Neue Aktivität')
  // Outlook: Termin auch im eigenen Outlook anlegen und Kollegen einladen (Migration 225)
  const [outlookAktiv, setOutlookAktiv]       = useState(false)
  const [outlookTeilnehmer, setOutlookTeilnehmer] = useState<string[]>([])
  const [hinweis, setHinweis]                 = useState<string | null>(null)
  useEffect(() => { if (!hinweis) return; const t = setTimeout(() => setHinweis(null), 8000); return () => clearTimeout(t) }, [hinweis])
  const [saveErr,   setSaveErr]   = useState<string | null>(null)
  // drag & drop
  const [dragInfo,   setDragInfo]   = useState<{ id: string; duration: number; ganztags?: boolean } | null>(null)
  const [dropTarget, setDropTarget] = useState<string | null>(null)

  useEffect(() => {
    if (scrollRef.current) {
      const now = new Date()
      const top = Math.max(0, (now.getHours() - 1) * HOUR_H)
      scrollRef.current.scrollTop = top
    }
  }, [monday])

  const byDay = useMemo(() => {
    const map: Record<string, { ganztags: KalenderEintrag[]; timed: KalenderEintrag[] }> = {}
    days.forEach(d => { map[toDateStr(d)] = { ganztags: [], timed: [] } })
    gefilterteEintraege.forEach(e => {
      if (!map[e.datum]) return
      // Mehrtägige Ganztags-Events → werden als Balken separat gerendert
      if (e.bis_datum && (e.ganztags !== false || !e.uhrzeit_von)) return
      if (e.ganztags !== false || !e.uhrzeit_von) map[e.datum].ganztags.push(e)
      else map[e.datum].timed.push(e)
    })
    return map
  }, [gefilterteEintraege, days])

  // Mehrtägige Ganztags-Events sichtbar in dieser Woche
  const multiDayGanztags = useMemo(() => {
    const weekStart = toDateStr(days[0])
    const weekEnd   = toDateStr(days[6])
    return gefilterteEintraege.filter(e =>
      e.bis_datum != null &&
      (e.ganztags !== false || !e.uhrzeit_von) &&
      e.datum    <= weekEnd &&
      e.bis_datum >= weekStart
    )
  }, [gefilterteEintraege, days])

  const now    = new Date()
  const nowTop = (now.getHours() * 60 + now.getMinutes()) / 60 * HOUR_H

  function vonTop(t: string): number {
    const [h, m] = t.split(':').map(Number)
    return h * HOUR_H + (m / 60) * HOUR_H
  }

  function blockHeight(von: string, bis: string | null | undefined): number {
    if (!bis) return HOUR_H / 2
    const [h1, m1] = von.split(':').map(Number)
    const [h2, m2] = bis.split(':').map(Number)
    const mins = (h2 * 60 + m2) - (h1 * 60 + m1)
    return Math.max(HOUR_H / 2, (mins / 60) * HOUR_H)
  }

  function toMin(t: string): number {
    const [h, m] = t.split(':').map(Number)
    return h * 60 + m
  }

  // Ordnet zeitlich ueberlappenden Terminen eines Tages Spalten zu (Outlook-/
  // Google-Kalender-Stil): statt sich gegenseitig zu verdecken, werden sich
  // ueberschneidende Termine nebeneinander dargestellt. Greedy Spalten-
  // Packing: Termine nach Startzeit sortiert, jeder Termin bekommt die erste
  // Spalte, deren letzter Termin schon zu Ende ist, sonst eine neue Spalte.
  // Zusammenhaengende Ueberlappungen (Cluster) teilen sich die Spaltenzahl,
  // getrennte Cluster (z.B. ein Termin um 9 Uhr, der naechste erst um 14 Uhr)
  // starten wieder bei voller Breite.
  function layoutOverlaps(items: KalenderEintrag[]): Map<string, { col: number; cols: number }> {
    const result = new Map<string, { col: number; cols: number }>()
    if (items.length === 0) return result

    type Ev = { id: string; start: number; end: number }
    const evs: Ev[] = items
      .map(e => {
        const start = e.uhrzeit_von ? toMin(e.uhrzeit_von) : 0
        // ECHTE Endzeit fuer die Ueberlappungs-Erkennung verwenden (nur ohne uhrzeit_bis
        // auf 30 Min. Default zurueckfallen) - NICHT zusaetzlich auf mind. 30 Min. auf-
        // runden, sonst werden kurze, unmittelbar aneinander anschliessende Termine
        // (z.B. 10:30-10:45 gefolgt von 10:45-11:15) faelschlich als ueberlappend erkannt
        // und nebeneinander statt hintereinander dargestellt. Die visuelle Mindesthoehe
        // fuer sehr kurze Termine wird unabhaengig davon bereits in blockHeight() (oben)
        // sichergestellt.
        const end = e.uhrzeit_bis ? toMin(e.uhrzeit_bis) : start + 30
        return { id: e.id, start, end }
      })
      .sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start))

    function flushCluster(cluster: Ev[]) {
      const colEnds: number[] = []
      const colOf = new Map<string, number>()
      for (const e of cluster) {
        let placed = colEnds.findIndex(end => end <= e.start)
        if (placed === -1) { placed = colEnds.length; colEnds.push(e.end) }
        else { colEnds[placed] = e.end }
        colOf.set(e.id, placed)
      }
      const cols = colEnds.length
      cluster.forEach(e => result.set(e.id, { col: colOf.get(e.id)!, cols }))
    }

    let cluster: Ev[] = []
    let clusterEnd = -Infinity
    for (const e of evs) {
      if (cluster.length === 0 || e.start < clusterEnd) {
        cluster.push(e)
        clusterEnd = Math.max(clusterEnd, e.end)
      } else {
        flushCluster(cluster)
        cluster = [e]
        clusterEnd = e.end
      }
    }
    if (cluster.length > 0) flushCluster(cluster)

    return result
  }

  function snapTime(clientY: number, rect: DOMRect): { von: string; bis: string; duration?: number } {
    const y = Math.max(0, clientY - rect.top)
    const totalMins = Math.min(23.5 * 60, (y / HOUR_H) * 60)
    const roundedMins = Math.floor(totalMins / 30) * 30
    const h = Math.floor(roundedMins / 60)
    const m = roundedMins % 60
    const endMins = Math.min(roundedMins + (dragInfo?.duration ?? 30), 24 * 60)
    const eh = Math.floor(endMins / 60)
    const em = endMins % 60
    return {
      von: `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`,
      bis: `${String(eh).padStart(2,'0')}:${String(em).padStart(2,'0')}`,
    }
  }

  // Klick auf Ganztags-Zeile → neue Ganztags-Aktivität
  function handleGanztagesClick(e: React.MouseEvent<HTMLDivElement>, dateStr: string) {
    if ((e.target as HTMLElement).closest('a, button')) return
    if (dragInfo) return
    setSaveErr(null)
    setNewAkt({ datum: dateStr, von: '', bis: '', ganztags: true })
  }

  // Klick auf freien Slot → neue Aktivität
  function handleSlotClick(e: React.MouseEvent<HTMLDivElement>, dateStr: string) {
    if ((e.target as HTMLElement).closest('a, button')) return
    if (dragInfo) return
    const { von, bis } = snapTime(e.clientY, e.currentTarget.getBoundingClientRect())
    setSaveErr(null)
    setNewAkt({ datum: dateStr, von, bis, ganztags: false })
  }

  // Aktivität speichern (Modal)
  function handleSaveAkt(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    fd.set('ganztags', newAkt?.ganztags ? 'true' : 'false')
    if (newAktKontaktId) fd.set('kontakt_id', newAktKontaktId)
    if (newAktFirmaId)   fd.set('firma_id',   newAktFirmaId)
    const outlookDaten = outlookAktiv && outlook?.schreiben ? {
      betreff: String(fd.get('betreff') || ''), datum: String(fd.get('datum') || ''), bis_datum: String(fd.get('bis_datum') || '') || null,
      ganztags: !!newAkt?.ganztags, von: String(fd.get('uhrzeit_von') || '') || null, bis: String(fd.get('uhrzeit_bis') || '') || null,
      beschreibung: String(fd.get('beschreibung') || '') || null, teilnehmer: outlookTeilnehmer,
    } : null
    startTransition(async () => {
      try {
        await createAktivitaet(fd)
        setNewAkt(null)
        setNewAktKontaktId('')
        setNewAktFirmaId('')
        setOutlookAktiv(false)
        setOutlookTeilnehmer([])
        router.refresh()
        if (outlookDaten) {
          // Aktivität ist gespeichert – Outlook ist „best effort“ und meldet sich nur mit einem Hinweis
          try {
            const j = await fetch('/api/crm/outlook-termin', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(outlookDaten) }).then(r => r.json())
            setHinweis(j.ok
              ? `In Outlook angelegt${j.eingeladen ? `, ${j.eingeladen} Einladung${j.eingeladen === 1 ? '' : 'en'} verschickt` : ''}.`
              : `Aktivität gespeichert, aber nicht in Outlook angelegt: ${j.meldung ?? j.grund ?? 'unbekannter Fehler'}`)
          } catch { setHinweis('Aktivität gespeichert, aber Outlook war nicht erreichbar.') }
        }
      } catch (err) {
        setSaveErr(fehlerText(err, 'Fehler beim Speichern'))
      }
    })
  }

  // Drop in Ganztags-Zeile → Datum ändern, ganztags behalten
  function handleGanztagsDrop(e: React.DragEvent<HTMLDivElement>, dateStr: string) {
    e.preventDefault()
    if (!dragInfo?.ganztags) return
    const id = dragInfo.id
    setDragInfo(null)
    setDropTarget(null)
    startTransition(async () => {
      await moveAktivitaet(id, dateStr, '', '')
      router.refresh()
    })
  }

  // Drop → Aktivität verschieben
  function handleDrop(e: React.DragEvent<HTMLDivElement>, dateStr: string) {
    e.preventDefault()
    if (!dragInfo) return
    const { von, bis } = snapTime(e.clientY, e.currentTarget.getBoundingClientRect())
    const id = dragInfo.id
    setDragInfo(null)
    setDropTarget(null)
    startTransition(async () => {
      await moveAktivitaet(id, dateStr, von, bis)
      router.refresh()
    })
  }

  const inputCls = 'w-full border border-s112-border rounded-lg px-3 py-1.5 text-sm focus:outline-hidden focus:ring-2 focus:ring-s112-teal/40'

  return (
    <>
    {hinweis && (
      <div className="mb-2 flex items-start justify-between gap-3 rounded-lg border border-s112-border bg-s112-blue-50 px-3 py-2 text-xs text-s112-blue-700 print:hidden">
        <span>{hinweis}</span>
        <button type="button" onClick={() => setHinweis(null)} className="shrink-0 text-s112-blue-700 hover:underline">schließen</button>
      </div>
    )}
    {/* User-Filter */}
    {uniqueUsers.length > 1 && (
      <div className="flex items-center gap-2 mb-2 print:hidden">
        <span className="text-xs text-s112-muted">Anzeigen:</span>
        <button onClick={() => setFilterUser('alle')} className={`text-xs px-2 py-1 rounded-lg ${filterUser==='alle'?'bg-s112-teal text-s112-yellow':'border border-s112-border text-s112-text-2 hover:bg-s112-bg'}`}>Alle</button>
        {uniqueUsers.map(uid => (
          <button key={uid!} onClick={() => setFilterUser(uid!)} className={`text-xs px-2 py-1 rounded-lg ${filterUser===uid?'bg-s112-teal text-s112-yellow':'border border-s112-border text-s112-text-2 hover:bg-s112-bg'}`}>
            {userProfiles[uid!] ?? uid!.slice(0,8)}
          </button>
        ))}
      </div>
    )}
    <div className="border border-s112-border rounded-xl overflow-hidden">

      {/* ── Sticky header: day names + Ganztags-Zeile ── */}
      <div className="sticky top-0 z-20 bg-white shadow-xs">
        <div className="grid border-b border-s112-border" style={{ gridTemplateColumns: '52px repeat(7, 1fr)' }}>
          <div className="bg-s112-bg border-r border-s112-border" />
          {days.map((d, i) => {
            const isToday = toDateStr(d) === heute
            return (
              <div key={i} className={`px-2 py-2 text-center border-l border-s112-border
                ${isToday ? 'bg-s112-teal text-s112-yellow' : 'bg-s112-bg'}`}>
                <div className={`text-[11px] font-medium ${isToday ? 'text-white/80' : 'text-s112-text-2'}`}>
                  {WOCHENTAGE[i]}
                </div>
                <div className={`text-lg font-semibold leading-tight ${isToday ? 'text-white' : 'text-s112-text'}`}>
                  {d.getDate()}
                </div>
              </div>
            )
          })}
        </div>
        {/* ── Multi-Day-Balken (Urlaub / Abwesenheit) ── */}
        {multiDayGanztags.length > 0 && (() => {
          const weekStartStr = toDateStr(days[0])
          const weekEndStr   = toDateStr(days[6])
          const barH = 20
          const totalH = multiDayGanztags.length * barH + 4
          return (
            <div className="relative border-b border-s112-border/60" style={{ height: `${totalH}px` }}>
              {/* Label links */}
              <div className="absolute left-0 top-0 h-full w-[52px] bg-s112-bg border-r border-s112-border z-10 flex items-end justify-end pb-1 pr-1">
                <span className="text-[10px] text-s112-tertiary leading-none">urlaub</span>
              </div>
              {/* Spalten-Trennlinien */}
              {days.map((_, i) => (
                <div key={i} className="absolute top-0 h-full border-l border-s112-border/40 pointer-events-none"
                  style={{ left: `calc(52px + ${i} * ((100% - 52px) / 7))` }} />
              ))}
              {/* Balken */}
              {multiDayGanztags.map((e, barIdx) => {
                const clampedStart = e.datum < weekStartStr ? weekStartStr : e.datum
                const clampedEnd   = (e.bis_datum ?? e.datum) > weekEndStr ? weekEndStr : (e.bis_datum ?? e.datum)
                const startIdx = days.findIndex(d => toDateStr(d) === clampedStart)
                const endIdx   = days.findIndex(d => toDateStr(d) === clampedEnd)
                if (startIdx < 0 || endIdx < 0) return null
                const spanDays = endIdx - startIdx + 1
                const colW = '((100% - 52px) / 7)'
                const isUrlaub    = e.art === 'urlaub'
                const startsEarly = e.datum < weekStartStr
                const endsLate    = (e.bis_datum ?? e.datum) > weekEndStr
                const br = startsEarly && endsLate ? '0' : startsEarly ? '0 4px 4px 0' : endsLate ? '4px 0 0 4px' : '4px'
                return (
                  <div key={e.id}
                    onClick={() => zeigeEintrag(e)} {...tastaturBedienbar(() => zeigeEintrag(e))}
                    title={`${isUrlaub ? 'Urlaub' : 'Abwesenheit'}${e.titel ? `: ${e.titel}` : ''}`}
                    className="absolute flex items-center gap-1 px-2 overflow-hidden cursor-pointer hover:opacity-80 z-20 text-white text-[10px] font-semibold select-none"
                    style={{
                      top:             `${2 + barIdx * barH}px`,
                      height:          `${barH - 2}px`,
                      left:            `calc(52px + ${startIdx} * ${colW}${startsEarly ? '' : ' + 2px'})`,
                      width:           `calc(${spanDays} * ${colW}${endsLate ? '' : ' - 4px'})`,
                      backgroundColor: isUrlaub ? '#D9A441' : '#99999D',
                      borderRadius:    br,
                    }}
                  >
                    {startsEarly && <span className="mr-0.5 opacity-70 shrink-0">◀</span>}
                    <span className="truncate">{e.titel ?? (isUrlaub ? 'Urlaub' : 'Abwesenheit')}</span>
                    {endsLate && <span className="ml-0.5 opacity-70 shrink-0">▶</span>}
                  </div>
                )
              })}
            </div>
          )
        })()}

        {/* ── Ganztags-Zeile (eintägige Events) ── */}
        <div className="grid border-b border-s112-border/60" style={{ gridTemplateColumns: '52px repeat(7, 1fr)' }}>
          <div className="bg-s112-bg border-r border-s112-border flex items-center justify-end px-1">
            <span className="text-[10px] text-s112-tertiary leading-none">ganztags</span>
          </div>
          {days.map((d, i) => {
            const dateStr  = toDateStr(d)
            const items    = byDay[dateStr]?.ganztags ?? []
            const isGDrop  = dropTarget === dateStr && dragInfo?.ganztags
            return (
              <div key={i}
                className={`border-l border-s112-border/60 p-1 space-y-0.5 min-h-[28px] cursor-pointer transition-colors ${isGDrop ? 'bg-s112-teal/10' : 'hover:bg-s112-bg/60'}`}
                onClick={(e) => handleGanztagesClick(e, dateStr)}
                {...tastaturBedienbar(() => { if (!dragInfo) { setSaveErr(null); setNewAkt({ datum: dateStr, von: '', bis: '', ganztags: true }) } }, null)}
                role="group" aria-label={`Neue ganztägige Aktivität am ${dateStr.split('-').reverse().join('.')}`}
                onDragOver={(e) => { if (dragInfo?.ganztags) { e.preventDefault(); setDropTarget(dateStr) } }}
                onDragLeave={() => setDropTarget(prev => prev === dateStr ? null : prev)}
                onDrop={(e) => handleGanztagsDrop(e, dateStr)}
              >
                {items.map(e => {
                  const isAkt  = e.typ === 'aktivitaet'
                  const aktId  = isAkt ? e.id.replace('a_', '') : ''
                  return (
                    <div key={e.id}
                      draggable={isAkt}
                      onDragStart={isAkt ? (ev) => {
                        ev.dataTransfer.setData('text/plain', aktId)
                        ev.dataTransfer.effectAllowed = 'move'
                        setDragInfo({ id: aktId, duration: 0, ganztags: true })
                      } : undefined}
                      onDragEnd={() => { setDragInfo(null); setDropTarget(null) }}
                      className={isAkt ? `cursor-grab active:cursor-grabbing ${dragInfo?.id === aktId ? 'opacity-40' : ''}` : ''}
                    >
                      <EintragChip e={e} compact onViewAkt={zeigeEintrag} />
                    </div>
                  )
                })}
              </div>
            )
          })}
        </div>
      </div>

      {/* ── Scrollable time grid ── */}
      <div ref={scrollRef} className="overflow-y-auto bg-white" style={{ height: '560px' }}>
        <div className="relative" style={{ height: `${24 * HOUR_H}px` }}>

          {/* Background: hour labels + grid lines */}
          <div className="absolute inset-0 grid pointer-events-none"
            style={{ gridTemplateColumns: '52px repeat(7, 1fr)' }}>
            <div className="relative bg-s112-bg border-r border-s112-border">
              {Array.from({ length: 24 }, (_, h) => (
                <div key={h} className="absolute w-full flex justify-end pr-2"
                  style={{ top: `${h * HOUR_H}px`, height: `${HOUR_H}px` }}>
                  <span className="text-[11px] text-s112-tertiary tabular-nums mt-1">
                    {String(h).padStart(2, '0')}:00
                  </span>
                </div>
              ))}
            </div>
            {days.map((_, i) => (
              <div key={i} className="relative border-l border-s112-border/30">
                {Array.from({ length: 24 }, (_, h) => (
                  <div key={h} className="absolute w-full"
                    style={{ top: `${h * HOUR_H}px`, height: `${HOUR_H}px` }}>
                    <div className="absolute top-0 w-full border-t border-s112-border/40" />
                    <div className="absolute top-1/2 w-full border-t border-s112-border/20 border-dashed" />
                  </div>
                ))}
              </div>
            ))}
          </div>

          {/* Events + click/drop zones per day column */}
          <div className="absolute inset-0 grid"
            style={{ gridTemplateColumns: '52px repeat(7, 1fr)' }}>
            <div />
            {days.map((d, i) => {
              const dateStr = toDateStr(d)
              const isToday = dateStr === heute
              const items   = byDay[dateStr]?.timed ?? []
              const layout  = layoutOverlaps(items)
              const isDrop  = dropTarget === dateStr && !!dragInfo
              return (
                <div key={i}
                  className={`relative border-l border-s112-border/30 cursor-crosshair transition-colors ${isDrop ? 'bg-s112-teal/5' : ''}`}
                  onClick={(e) => handleSlotClick(e, dateStr)}
                  // Tastatur: ohne Mausposition ein Termin um 09:00–10:00 (Uhrzeit im Dialog änderbar)
                  {...tastaturBedienbar(() => { if (!dragInfo) { setSaveErr(null); setNewAkt({ datum: dateStr, von: '09:00', bis: '10:00', ganztags: false }) } }, null)}
                  role="group" aria-label={`Neue Aktivität am ${dateStr.split('-').reverse().join('.')}`}
                  onDragOver={(e) => { if (dragInfo) { e.preventDefault(); setDropTarget(dateStr) } }}
                  onDragLeave={() => setDropTarget(prev => prev === dateStr ? null : prev)}
                  onDrop={(e) => handleDrop(e, dateStr)}
                >
                  {/* Timed events */}
                  {items.map(e => {
                    const top   = vonTop(e.uhrzeit_von!)
                    const h     = blockHeight(e.uhrzeit_von!, e.uhrzeit_bis)
                    const farbe = chipFarbe(e)
                    const isAkt = e.typ === 'aktivitaet'
                    const aktId = isAkt ? e.id.replace('a_', '') : ''
                    const beingDragged = dragInfo?.id === aktId
                    let dur = 30
                    if (e.uhrzeit_von && e.uhrzeit_bis) {
                      const [h1,m1] = e.uhrzeit_von.split(':').map(Number)
                      const [h2,m2] = e.uhrzeit_bis.split(':').map(Number)
                      dur = Math.max(30, (h2*60+m2) - (h1*60+m1))
                    }
                    // Ueberlappende Termine nebeneinander statt uebereinander:
                    // Spalte/Spaltenzahl aus layoutOverlaps() -> Breite in %
                    // je Spalte, mit 2px Abstand zwischen den Spalten.
                    const { col, cols } = layout.get(e.id) ?? { col: 0, cols: 1 }
                    const widthPct = 100 / cols
                    const leftPct  = col * widthPct
                    return (
                      <div key={e.id}
                        draggable={isAkt}
                        onDragStart={isAkt ? (ev) => {
                          ev.dataTransfer.setData('text/plain', aktId)
                          ev.dataTransfer.effectAllowed = 'move'
                          setDragInfo({ id: aktId, duration: dur })
                        } : undefined}
                        onDragEnd={() => { setDragInfo(null); setDropTarget(null) }}
                        onClick={ev => { if (!dragInfo) { ev.stopPropagation(); zeigeEintrag(e) } }}
                        {...tastaturBedienbar(() => zeigeEintrag(e))}
                        className={`absolute overflow-hidden rounded border transition-opacity
                          ${farbe}
                          ${isAkt ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer'}
                          ${beingDragged ? 'opacity-30' : 'hover:opacity-80'}`}
                        style={{
                          top: `${top}px`, height: `${h}px`, minHeight: `${HOUR_H / 2}px`,
                          left: `calc(${leftPct}% + 2px)`, width: `calc(${widthPct}% - 4px)`,
                          zIndex: 10 + col,
                        }}>
                        <div className="px-1.5 py-0.5">
                          <div className="text-[11px] font-semibold tabular-nums leading-tight">
                            {fmtT(e.uhrzeit_von)}{e.uhrzeit_bis ? `–${fmtT(e.uhrzeit_bis)}` : ''}
                          </div>
                          <div className={`text-[11px] font-medium truncate leading-tight`}>
                            {e.titel}
                          </div>
                          {h > 50 && (e.kontaktName || e.firmaName) && (
                            <div className="text-[10px] opacity-60 truncate">
                              {e.kontaktName ?? e.firmaName}
                            </div>
                          )}
                        </div>
                      </div>
                    )
                  })}
                  {/* Current time indicator */}
                  {isToday && (
                    <div className="absolute left-0 right-0 z-20 pointer-events-none"
                      style={{ top: `${nowTop}px` }}>
                      <div className="relative border-t-2 border-s112-err">
                        <div className="absolute -left-1.5 top-[-5px] w-3 h-3 rounded-full bg-s112-err" />
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>

    {/* ── Modal: Neue Aktivität ── */}

    {/* ── Aktivität Detail-Modal ── */}
    {viewAkt && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
        onClick={() => { setViewAkt(null); setEditAktMode(false); setEditPipeMode(false) }}>
        <div {...dlgView} className="bg-white rounded-xl shadow-2xl p-6 w-full max-w-md mx-4 max-h-[calc(100dvh-2rem)] overflow-y-auto"
          onClick={e => e.stopPropagation()}>

          {!editAktMode && !editPipeMode ? (
            <>
              {/* ── Detail-Ansicht ── */}
              <div className="flex items-start justify-between mb-3">
                <div>
                  <span className="font-semibold text-s112-text">{viewAkt.titel}</span>
                </div>
                <button aria-label="Schließen" onClick={() => { setViewAkt(null); setEditAktMode(false); setEditPipeMode(false) }} className="text-s112-muted hover:text-s112-text-1"><X size={18} /></button>
              </div>
              <div className="space-y-1.5 text-sm text-s112-text-2 mb-4">
                {viewAkt.bis_datum && viewAkt.bis_datum !== viewAkt.datum ? (
                  <p><span className="font-medium text-s112-text-1">Zeitraum:</span>{' '}
                    {new Date(viewAkt.datum + 'T12:00:00').toLocaleDateString('de-AT', { day: 'numeric', month: 'long' })}
                    {' – '}
                    {new Date(viewAkt.bis_datum + 'T12:00:00').toLocaleDateString('de-AT', { day: 'numeric', month: 'long', year: 'numeric' })}
                  </p>
                ) : (
                  <p><span className="font-medium text-s112-text-1">Datum:</span> {new Date(viewAkt.datum + 'T12:00:00').toLocaleDateString('de-AT', { weekday: 'long', day: 'numeric', month: 'long' })}</p>
                )}
                {viewAkt.kontaktName && <p><span className="font-medium text-s112-text-1">Kontakt:</span> {viewAkt.kontaktName}</p>}
                {viewAkt.firmaName   && <p><span className="font-medium text-s112-text-1">Firma:</span> {viewAkt.firmaName}</p>}
                {viewAkt.typ === 'aktivitaet' && (
                  <p><span className="font-medium text-s112-text-1">Erstellt von:</span>{' '}
                    {viewAkt.erstellt_von && userProfiles[viewAkt.erstellt_von]
                      ? userProfiles[viewAkt.erstellt_von]
                      : <span className="text-s112-tertiary">unbekannt (Alt-/Importdaten)</span>}
                  </p>
                )}
                {viewAkt.typ === 'aktivitaet' && (
                  <p><span className="font-medium text-s112-text-1">Verantwortlich:</span> {verantwortlichText(viewAkt, userProfiles, userId)}</p>
                )}
                {viewAkt.beschreibung && <p className="whitespace-pre-wrap text-s112-text-2 border-l-2 border-s112-border pl-2">{viewAkt.beschreibung}</p>}
                {viewAkt.ist_privat  && <p className="text-s112-tertiary text-xs inline-flex items-center gap-1"><Lock size={11} />Privater Termin</p>}
              </div>
              {saveErr && (
                <p role="alert" className="text-xs text-s112-err-fg bg-s112-err-bg border border-s112-err/30 rounded-lg px-3 py-2 mb-3">{saveErr}</p>
              )}
              {viewAkt.typ === 'aktivitaet' && viewAkt.art === 'aufgabe' && (
                <div className="mb-4 border-t border-s112-border/40 pt-3">
                  <button onClick={() => {
                    const aktId = viewAkt.id.replace('a_', '')
                    startTransition(async () => {
                      await toggleAktivitaetErledigt(aktId, !viewAkt.erledigt)
                      // Erledigte Aufgaben verschwinden aus dem Kalender (siehe crm/page.tsx) -
                      // Modal schliessen und Daten neu laden, damit der Eintrag sofort weg ist.
                      setViewAkt(null)
                      router.refresh()
                    })
                  }} disabled={pending}
                    className={`inline-flex items-center gap-2 text-sm px-3 py-1.5 rounded-lg border transition-colors disabled:opacity-50 ${
                      viewAkt.erledigt
                        ? 'bg-s112-ok-bg border-s112-ok/30 text-s112-ok-fg'
                        : 'border-s112-border text-s112-text-2 hover:border-s112-ok/50 hover:text-s112-ok-fg'
                    }`}>
                    <span className={`w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 ${
                      viewAkt.erledigt ? 'bg-s112-ok border-s112-ok text-white' : 'border-s112-line-str'
                    }`}>
                      {viewAkt.erledigt && <Check size={11} strokeWidth={3} />}
                    </span>
                    {viewAkt.erledigt ? 'Erledigt' : 'Als erledigt markieren'}
                  </button>
                </div>
              )}
              <div className="flex flex-wrap gap-2">
                {viewAkt.typ === 'aktivitaet' && (
                  <button onClick={() => setEditAktMode(true)}
                    className="bg-s112-teal text-s112-yellow px-4 py-1.5 rounded-lg text-sm font-medium hover:bg-s112-teal/90 inline-flex items-center gap-1.5">
                    <Pencil size={14} />Bearbeiten
                  </button>
                )}
                {viewAkt.typ === 'pipeline' && (
                  <button onClick={() => setEditPipeMode(true)}
                    className="bg-s112-teal text-s112-yellow px-4 py-1.5 rounded-lg text-sm font-medium hover:bg-s112-teal/90 inline-flex items-center gap-1.5">
                    <Pencil size={14} />Bearbeiten
                  </button>
                )}
                {viewAkt.kontaktName && (
                  <a href={viewAkt.href} className="border border-s112-teal text-s112-blue-700 px-4 py-1.5 rounded-lg text-sm font-medium hover:bg-s112-teal/10">
                    Zum Kontakt →
                  </a>
                )}
                {!viewAkt.kontaktName && viewAkt.firmaName && (
                  <a href={viewAkt.href} className="border border-s112-teal text-s112-blue-700 px-4 py-1.5 rounded-lg text-sm font-medium hover:bg-s112-teal/10">
                    Zur Firma →
                  </a>
                )}
                {viewAkt.typ === 'outlook' && viewAkt.href && viewAkt.href !== '#' && (
                  <a href={viewAkt.href} target="_blank" rel="noopener noreferrer"
                    className="border border-s112-blue-300 text-s112-blue-700 px-4 py-1.5 rounded-lg text-sm font-medium hover:bg-s112-blue-50">
                    In Outlook öffnen →
                  </a>
                )}
                {(viewAkt.typ === 'aktivitaet' || viewAkt.typ === 'pipeline') && (
                  <button onClick={() => {
                    if (!confirm(`"${viewAkt.titel}" wirklich löschen?`)) return
                    setSaveErr(null)
                    startTransition(async () => {
                      try {
                        if (viewAkt.typ === 'aktivitaet') {
                          await deleteAktivitaet(viewAkt.id.replace('a_', ''))
                        } else {
                          await deletePipelineEintrag(viewAkt.id.replace('p_', ''))
                        }
                        setViewAkt(null)
                        router.refresh()
                      } catch (err) {
                        setSaveErr(fehlerText(err, 'Fehler beim Löschen'))
                      }
                    })
                  }} disabled={pending}
                    className="text-s112-err border border-s112-err/30 px-4 py-1.5 rounded-lg text-sm font-medium hover:bg-s112-err-bg disabled:opacity-50 inline-flex items-center gap-1.5">
                    <Trash2 size={14} />Löschen
                  </button>
                )}
                <button onClick={() => { setViewAkt(null); setEditAktMode(false); setEditPipeMode(false) }}
                  className="text-sm px-4 py-1.5 rounded-lg border border-s112-border text-s112-text-2 hover:bg-s112-bg">
                  Schließen
                </button>
              </div>
            </>
          ) : editAktMode ? (
            <>
              {/* ── Bearbeiten-Formular ── */}
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-semibold text-s112-text text-base">Aktivität bearbeiten</h3>
                <button aria-label="Schließen" onClick={() => setEditAktMode(false)} className="text-s112-muted hover:text-s112-text-1"><X size={18} /></button>
              </div>
              <form onSubmit={async e => {
                e.preventDefault()
                const fd = new FormData(e.currentTarget)
                const ganztags = !(fd.get('uhrzeit_von') as string)
                fd.set('ganztags', ganztags ? 'true' : 'false')
                startTransition(async () => {
                  try {
                    const aktId = viewAkt.id.replace('a_', '')
                    await updateAktivitaet(aktId, fd)
                    setViewAkt(null)
                    setEditAktMode(false)
                    router.refresh()
                  } catch (err) {
                    setSaveErr(fehlerText(err, 'Fehler beim Speichern'))
                  }
                })
              }} className="space-y-3">
                <input type="hidden" name="erledigt" value={viewAkt.erledigt ? 'true' : 'false'} />
                <div>
                  <label className="block text-xs font-medium text-s112-text-2 mb-1">Art</label>
                  <select aria-label="Art" name="art" defaultValue={viewAkt.art ?? 'notiz'} className={inputCls}>
                    {AKTIVITAET_ARTEN.filter(a => !('nurAnzeige' in a)).map(a => (
                      <option key={a.value} value={a.value}>{a.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-s112-text-2 mb-1">Betreff</label>
                  <input aria-label="Betreff" name="betreff" defaultValue={viewAkt.titel} required className={inputCls} />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-xs font-medium text-s112-text-2 mb-1">Von</label>
                    <input aria-label="Von" type="date" name="datum" defaultValue={viewAkt.datum} required className={inputCls} />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-s112-text-2 mb-1">Bis (mehrtägig)</label>
                    <input aria-label="Bis (mehrtägig)" type="date" name="bis_datum" defaultValue={viewAkt.bis_datum ?? ''} className={inputCls} />
                  </div>
                </div>
                <VerantwortlichSelect mitglieder={mitglieder} userId={userId} defaultValue={verantwortlichWert(viewAkt)} className={inputCls} />
                <div>
                  <label className="block text-xs font-medium text-s112-text-2 mb-1">Bericht</label>
                  <textarea aria-label="Bericht" name="beschreibung" rows={3} defaultValue={viewAkt.beschreibung ?? ''} placeholder="Optional … (@Name benachrichtigt Kolleginnen/Kollegen)"
                    className={inputCls + ' resize-none'} />
                </div>
                {saveErr && <p className="text-xs text-s112-err-fg">{saveErr}</p>}
                <div className="flex gap-2 pt-1">
                  <button type="submit" disabled={pending}
                    className="bg-s112-teal text-s112-yellow px-4 py-1.5 rounded-lg text-sm font-semibold hover:bg-s112-teal/90 disabled:opacity-40">
                    {pending ? 'Speichern…' : 'Speichern'}
                  </button>
                  <button type="button" onClick={() => setEditAktMode(false)}
                    className="text-sm px-4 py-1.5 rounded-lg border border-s112-border text-s112-text-2 hover:bg-s112-bg">
                    Abbrechen
                  </button>
                </div>
              </form>
            </>
          ) : (
            <>
              {/* ── Pipeline-Eintrag bearbeiten ── */}
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-semibold text-s112-text text-base">Pipeline-Eintrag bearbeiten</h3>
                <button aria-label="Schließen" onClick={() => setEditPipeMode(false)} className="text-s112-muted hover:text-s112-text-1"><X size={18} /></button>
              </div>
              <form onSubmit={async e => {
                e.preventDefault()
                const fd = new FormData(e.currentTarget)
                const ganztags = !(fd.get('uhrzeit_von') as string)
                fd.set('ganztags', ganztags ? 'true' : 'false')
                startTransition(async () => {
                  try {
                    const pipeId = viewAkt!.id.replace('p_', '')
                    await updatePipelineEintrag(pipeId, fd)
                    setViewAkt(null); setEditPipeMode(false)
                    router.refresh()
                  } catch (err) {
                    setSaveErr(fehlerText(err, 'Fehler beim Speichern'))
                  }
                })
              }} className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-s112-text-2 mb-1">Titel</label>
                  <input aria-label="Titel" name="titel" defaultValue={viewAkt?.titel ?? ''} required className={inputCls} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-s112-text-2 mb-1">Termin</label>
                  <input aria-label="Termin" type="date" name="erwartetes_datum" defaultValue={viewAkt?.datum ?? ''} className={inputCls} />
                </div>
                <div className="flex items-center gap-3 flex-wrap">
                  <label className="flex items-center gap-1.5 text-xs text-s112-text-2 cursor-pointer">
                    <input type="checkbox" name="ganztags_check"
                      defaultChecked={viewAkt?.ganztags ?? true}
                      onChange={e => {
                        const form = (e.target as HTMLInputElement).closest('form')!
                        const von = form.querySelector<HTMLInputElement>('[name=uhrzeit_von]')!
                        const bis = form.querySelector<HTMLInputElement>('[name=uhrzeit_bis]')!
                        von.disabled = e.target.checked; bis.disabled = e.target.checked
                        if (e.target.checked) { von.value = ''; bis.value = '' }
                      }} className="rounded-sm" />
                    Ganztags
                  </label>
                  <input name="uhrzeit_von" type="time" step="1800"
                    defaultValue={viewAkt?.uhrzeit_von?.slice(0, 5) ?? ''}
                    disabled={viewAkt?.ganztags ?? true}
                    className={inputCls + ' w-28'} placeholder="Von" />
                  <span className="text-s112-tertiary text-xs">–</span>
                  <input name="uhrzeit_bis" type="time" step="1800"
                    defaultValue={viewAkt?.uhrzeit_bis?.slice(0, 5) ?? ''}
                    disabled={viewAkt?.ganztags ?? true}
                    className={inputCls + ' w-28'} placeholder="Bis" />
                </div>
                {saveErr && <p className="text-xs text-s112-err-fg">{saveErr}</p>}
                <div className="flex gap-2 pt-1">
                  <button type="submit" disabled={pending}
                    className="bg-s112-teal text-s112-yellow px-4 py-1.5 rounded-lg text-sm font-semibold hover:bg-s112-teal/90 disabled:opacity-40">
                    {pending ? 'Speichern…' : 'Speichern'}
                  </button>
                  <button type="button" onClick={() => setEditPipeMode(false)}
                    className="text-sm px-4 py-1.5 rounded-lg border border-s112-border text-s112-text-2 hover:bg-s112-bg">
                    Abbrechen
                  </button>
                </div>
              </form>
            </>
          )}
        </div>
      </div>
    )}

    {newAkt && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
        onClick={() => { setNewAkt(null); setNewAktKontaktId(''); setNewAktFirmaId('') }}>
        <div {...dlgNeu} className="bg-white rounded-xl shadow-2xl p-6 w-full max-w-md mx-4 max-h-[calc(100dvh-2rem)] overflow-y-auto"
          onClick={e => e.stopPropagation()}>
          <h3 className="text-base font-semibold text-s112-text mb-1">
            {newAkt?.ganztags ? <span className="inline-flex items-center gap-1.5"><Calendar size={16} />Ganztags-Aktivität</span> : 'Neue Aktivität'}
          </h3>
          <p className="text-xs text-s112-muted mb-4">
            {new Date(newAkt.datum + 'T12:00:00').toLocaleDateString('de-AT', { weekday: 'long', day: 'numeric', month: 'long' })}
          </p>
          <form onSubmit={handleSaveAkt} className="space-y-3">
            <input type="hidden" name="datum" value={newAkt.datum} />

            {/* Art + ggf. Zeit */}
            <div className={`gap-2 ${newAkt?.ganztags ? '' : 'grid grid-cols-2'}`}>
              <div>
                <label className="block text-xs font-medium text-s112-text-2 mb-1">Art</label>
                <select aria-label="Art" name="art" defaultValue="notiz" className={inputCls}>
                  {AKTIVITAET_ARTEN.filter(a => !('nurAnzeige' in a)).map(a => (
                    <option key={a.value} value={a.value}>{a.label}</option>
                  ))}
                </select>
              </div>
              {!newAkt?.ganztags && (
                <div>
                  <label className="block text-xs font-medium text-s112-text-2 mb-1">Zeit</label>
                  <div className="flex items-center gap-1">
                    <input type="time" name="uhrzeit_von" step="1800" defaultValue={newAkt.von}
                      className="border border-s112-border rounded-lg px-2 py-1.5 text-sm focus:outline-hidden w-full" />
                    <span className="text-xs text-s112-tertiary shrink-0">–</span>
                    <input type="time" name="uhrzeit_bis" step="1800" defaultValue={newAkt.bis}
                      className="border border-s112-border rounded-lg px-2 py-1.5 text-sm focus:outline-hidden w-full" />
                  </div>
                </div>
              )}
            </div>

            {/* Betreff */}
            <div>
              <label className="block text-xs font-medium text-s112-text-2 mb-1">Betreff *</label>
              <input aria-label="Betreff" name="betreff" required autoFocus placeholder="z.B. Weinverkostung, Rückruf …"
                className={inputCls} />
            </div>

            {/* Kontakt / Firma */}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs font-medium text-s112-text-2 mb-1">Kontakt</label>
                <KundenSuche
                  art="kontakt"
                  value={newAktKontaktId}
                  onChange={setNewAktKontaktId}
                  placeholder="Name suchen…"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-s112-text-2 mb-1">Firma</label>
                <KundenSuche
                  art="firma"
                  value={newAktFirmaId}
                  onChange={setNewAktFirmaId}
                  placeholder="Firmenname suchen…"
                />
              </div>
            </div>

            {/* Bis-Datum (für Mehrtagestermine) */}
            {newAkt?.ganztags && (
              <div>
                <label className="block text-xs font-medium text-s112-text-2 mb-1">Bis-Datum (leer = eintägig)</label>
                <input aria-label="Bis-Datum (leer = eintägig)" type="date" name="bis_datum" min={newAkt.datum}
                  className={inputCls} />
              </div>
            )}

            {/* Verantwortlich */}
            <VerantwortlichSelect mitglieder={mitglieder} userId={userId} defaultValue={userId ?? ''} className={inputCls} />

            {/* Bericht */}
            <div>
              <label className="block text-xs font-medium text-s112-text-2 mb-1">Bericht</label>
              <textarea aria-label="Bericht" name="beschreibung" rows={2} placeholder="Optional … (@Name benachrichtigt Kolleginnen/Kollegen)"
                className={inputCls + ' resize-none'} />
            </div>

            {/* Outlook: anlegen + Kollegen einladen, Frei/Belegt */}
            {outlook?.verbunden && (
              <OutlookBlock outlook={outlook} datum={newAkt.datum} aktiv={outlookAktiv} setAktiv={setOutlookAktiv}
                teilnehmer={outlookTeilnehmer} setTeilnehmer={setOutlookTeilnehmer} />
            )}

            {/* Privat */}
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" name="ist_privat" value="true"
                className="accent-s112-teal" />
              <span className="text-xs text-s112-text-2 inline-flex items-center gap-1"><Lock size={11} />Privater Termin (nur für mich sichtbar)</span>
            </label>

            {saveErr && (
              <p role="alert" className="text-xs text-s112-err-fg bg-s112-err-bg border border-s112-err/30 rounded-lg px-3 py-2">{saveErr}</p>
            )}

            <div className="flex gap-2 pt-1">
              <button type="submit" disabled={pending}
                className="bg-s112-teal text-s112-yellow px-4 py-1.5 rounded-lg text-sm font-medium hover:bg-s112-teal/90 disabled:opacity-40">
                {pending ? 'Speichern…' : 'Speichern'}
              </button>
              <button type="button" onClick={() => { setNewAkt(null); setNewAktKontaktId(''); setNewAktFirmaId('') }}
                className="text-sm px-4 py-1.5 rounded-lg border border-s112-border text-s112-text-2 hover:bg-s112-bg">
                Abbrechen
              </button>
            </div>
          </form>
        </div>
      </div>
    )}
    </>
  )
}

// ── Monats-Ansicht ────────────────────────────────────────────────────────────

function MonatView({ eintraege, current, heute }: { eintraege: KalenderEintrag[]; current: Date; heute: string }) {
  const year  = current.getFullYear()
  const month = current.getMonth()

  const { weeks } = useMemo(() => {
    const firstDay = new Date(year, month, 1)
    const lastDay  = new Date(year, month + 1, 0)
    const start    = startOfWeek(firstDay)
    const end      = addDays(startOfWeek(lastDay), 6)

    const ws: Date[][] = []
    let d = new Date(start)
    while (d <= end) {
      ws.push(Array.from({ length: 7 }, (_, i) => addDays(d, i)))
      d = addDays(d, 7)
    }
    return { weeks: ws }
  }, [year, month])

  const byDay = useMemo(() => {
    const map: Record<string, KalenderEintrag[]> = {}
    eintraege.forEach(e => {
      if (!map[e.datum]) map[e.datum] = []
      map[e.datum].push(e)
    })
    return map
  }, [eintraege])

  return (
    <div>
      <div className="grid grid-cols-7 mb-1">
        {WOCHENTAGE.map(d => (
          <div key={d} className="text-center text-xs font-medium text-s112-text-2 py-1">{d}</div>
        ))}
      </div>

      <div className="border border-s112-border rounded-xl overflow-hidden">
        <div className="grid grid-cols-7 divide-x divide-y divide-s112-border">
          {weeks.flatMap((week, wi) =>
            week.map((day, di) => {
              const dateStr      = toDateStr(day)
              const items        = byDay[dateStr] ?? []
              const isThisMonth  = day.getMonth() === month
              const isToday      = dateStr === heute
              const hasOverdue   = items.some(e => e.ueberfaellig)
              const extra        = items.length - 3

              return (
                <div key={`${wi}-${di}`}
                  className={`min-h-[80px] p-1.5 bg-white
                    ${!isThisMonth ? 'bg-s112-bg/50' : ''}
                    ${isToday ? 'ring-2 ring-inset ring-s112-teal/30' : ''}`}>
                  <div
                    className={`w-6 h-6 flex items-center justify-center rounded-full text-xs font-semibold mb-1
                      ${isToday ? 'bg-s112-teal text-s112-yellow' : isThisMonth ? 'text-s112-text-1' : 'text-s112-tertiary'}`}
                    style={!isToday && hasOverdue ? { backgroundColor: '#C9564E', color: '#fff' } : undefined}>
                    {day.getDate()}
                  </div>
                  <div className="space-y-0.5">
                    {items.slice(0, 3).map(e => (
                      <EintragChip key={e.id} e={e} compact />
                    ))}
                    {extra > 0 && (
                      <div className="text-[10px] text-s112-tertiary pl-0.5">+{extra} weitere</div>
                    )}
                  </div>
                </div>
              )
            })
          )}
        </div>
      </div>
    </div>
  )
}

// ── Jahres-Ansicht ────────────────────────────────────────────────────────────

function MiniMonat({
  year, monthIdx, byDay, heute,
}: {
  year: number; monthIdx: number; byDay: Record<string, KalenderEintrag[]>; heute: string
}) {
  const { weeks } = useMemo(() => {
    const firstDay = new Date(year, monthIdx, 1)
    const lastDay  = new Date(year, monthIdx + 1, 0)
    const start    = startOfWeek(firstDay)
    const end      = addDays(startOfWeek(lastDay), 6)

    const ws: Date[][] = []
    let d = new Date(start)
    while (d <= end) {
      ws.push(Array.from({ length: 7 }, (_, i) => addDays(d, i)))
      d = addDays(d, 7)
    }
    return { weeks: ws }
  }, [year, monthIdx])

  const prefix = `${year}-${String(monthIdx + 1).padStart(2, '0')}`
  const hasAny = Object.keys(byDay).some(k => k.startsWith(prefix))

  return (
    <div className={`border rounded-xl p-2.5 bg-white ${hasAny ? 'border-s112-border' : 'border-s112-border/50'}`}>
      <div className="text-xs font-semibold text-s112-text-1 mb-2 text-center">{MONATE_KURZ[monthIdx]}</div>
      <div className="grid grid-cols-7 mb-0.5">
        {WOCHENTAGE_KURZ.map((d, i) => (
          <div key={i} className="text-center text-[8px] text-s112-tertiary">{d}</div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {weeks.flatMap((week, wi) =>
          week.map((day, di) => {
            const dateStr     = toDateStr(day)
            const items       = byDay[dateStr] ?? []
            const isThisMonth = day.getMonth() === monthIdx
            const isToday     = dateStr === heute
            const hasOverdue  = items.some(e => e.ueberfaellig)
            const hasItems    = items.length > 0

            return (
              <div key={`${wi}-${di}`} className="flex items-center justify-center py-px">
                <div className={`w-[18px] h-[18px] flex items-center justify-center rounded-full text-[10px] font-medium
                  ${!isThisMonth ? 'opacity-20' : ''}
                  ${isToday
                    ? 'bg-s112-teal text-s112-yellow'
                    : hasItems
                      ? 'bg-s112-teal/10 text-s112-blue-700 font-semibold'
                      : 'text-s112-tertiary'}`}
                  style={!isToday && hasOverdue ? { backgroundColor: '#C9564E', color: '#fff' } : undefined}>
                  {day.getDate()}
                </div>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}

function JahrView({ eintraege, current, heute }: { eintraege: KalenderEintrag[]; current: Date; heute: string }) {
  const year = current.getFullYear()

  const byDay = useMemo(() => {
    const map: Record<string, KalenderEintrag[]> = {}
    eintraege.forEach(e => {
      if (!map[e.datum]) map[e.datum] = []
      map[e.datum].push(e)
    })
    return map
  }, [eintraege])

  return (
    <div className="grid grid-cols-3 md:grid-cols-4 gap-3">
      {Array.from({ length: 12 }, (_, i) => (
        <MiniMonat key={i} year={year} monthIdx={i} byDay={byDay} heute={heute} />
      ))}
    </div>
  )
}

// ── Hauptkomponente ───────────────────────────────────────────────────────────

interface Props {
  eintraege: KalenderEintrag[]
  heute: string
  userProfiles?: Record<string, string>
  mitglieder?: MitgliedOption[]
  userId?: string | null
  /** Aktivitäts-ID aus /crm?aktivitaet=… (Link aus Benachrichtigung): Woche wechseln + Detail öffnen */
  oeffneId?: string | null
  outlook?: OutlookStatus | null
}

export default function CRMUebersichtClient({ eintraege, heute, userProfiles = {}, mitglieder = [], userId = null, oeffneId = null, outlook = null }: Props) {
  const [view, setView]       = useState<ViewMode>('zeitachse')
  const [current, setCurrent] = useState<Date>(() => {
    const e = oeffneId ? eintraege.find(x => x.id === `a_${oeffneId}`) : null
    return e ? new Date(e.datum + 'T12:00:00') : new Date()
  })

  // ── Outlook-Kalender des angemeldeten Users spiegeln ──────────────────────
  // Läd die Termine aus dem verbundenen Outlook-Konto (falls vorhanden) für
  // einen großzügigen Zeitraum um die aktuell angezeigte Periode und mischt
  // sie (mit eigener Farbe/Kennzeichnung, siehe chipFarbe) unter die CRM-Termine.
  const [outlookEintraege, setOutlookEintraege] = useState<KalenderEintrag[]>([])
  // KAN-125: Outlook-Verbindung muss neu hergestellt werden (Hinweis statt stiller Leere)
  const [outlookNeuVerbinden, setOutlookNeuVerbinden] = useState<string | null>(null)
  // nur bei einem Monatswechsel neu laden (Jahr/Monat als Zahlen)
  const outlookJahr = current.getFullYear(), outlookMonat = current.getMonth()
  useEffect(() => {
    const von = new Date(outlookJahr, outlookMonat - 2, 1)
    const bis = new Date(outlookJahr, outlookMonat + 3, 0)
    const vonStr = toDateStr(von)
    const bisStr = toDateStr(bis)
    let cancelled = false
    fetch(`/api/crm/outlook-kalender?von=${vonStr}&bis=${bisStr}`)
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then(json => {
        if (cancelled) return
        // Die Route liefert bei einem echten Serverfehler (z.B. Token-Refresh-Problem
        // bei Microsoft) bewusst trotzdem HTTP 200 mit leerer Liste (damit das CRM nie
        // blockiert), setzt dabei aber ein "fehler"-Feld. In dem Fall NICHT die zuletzt
        // erfolgreich geladenen Termine mit der leeren Liste überschreiben.
        setOutlookNeuVerbinden(json.neuVerbinden ? String(json.fehler ?? '') : null)
        if (json.fehler) return
        setOutlookEintraege((json.eintraege ?? []) as KalenderEintrag[])
      })
      .catch(() => { /* Netzwerkfehler: zuletzt erfolgreich geladene Termine unveraendert lassen */ })
    return () => { cancelled = true }
  }, [outlookJahr, outlookMonat])

  const alleEintraege = useMemo(
    () => [...eintraege, ...outlookEintraege].sort((a, b) => a.datum.localeCompare(b.datum)),
    [eintraege, outlookEintraege]
  )

  function navigate(dir: number) {
    setCurrent(prev => {
      const d = new Date(prev)
      if (view === 'zeitachse') d.setDate(d.getDate() + dir * 7)
      else if (view === 'monat') d.setMonth(d.getMonth() + dir)
      else d.setFullYear(d.getFullYear() + dir)
      return d
    })
  }

  function goToday() { setCurrent(new Date()) }

  // nur ein Text – ohne useMemo (die Abhängigkeit current.toDateString() war kein einfacher Ausdruck)
  const periodLabel = (() => {
    if (view === 'zeitachse') {
      const mon = startOfWeek(current)
      const sun = addDays(mon, 6)
      const sameMon  = mon.getMonth() === sun.getMonth()
      const sameYear = mon.getFullYear() === sun.getFullYear()
      if (sameMon)  return `${mon.getDate()}. – ${sun.getDate()}. ${MONATE[mon.getMonth()]} ${mon.getFullYear()}`
      if (sameYear) return `${mon.getDate()}. ${MONATE_KURZ[mon.getMonth()]} – ${sun.getDate()}. ${MONATE_KURZ[sun.getMonth()]} ${sun.getFullYear()}`
      return `${mon.getDate()}. ${MONATE_KURZ[mon.getMonth()]} ${mon.getFullYear()} – ${sun.getDate()}. ${MONATE_KURZ[sun.getMonth()]} ${sun.getFullYear()}`
    }
    if (view === 'monat') return `${MONATE[current.getMonth()]} ${current.getFullYear()}`
    return `${current.getFullYear()}`
  })()

  const ueberfaelligCount = useMemo(
    () => alleEintraege.filter(e => e.ueberfaellig).length,
    [alleEintraege],
  )
  const heuteCount = useMemo(
    () => alleEintraege.filter(e => e.datum === heute).length,
    [alleEintraege, heute],
  )

  return (
    <div className="space-y-4">
      {outlookNeuVerbinden && (
        <div className="rounded-lg border border-s112-warn/30 bg-s112-warn-bg/40 px-3 py-2 text-sm text-s112-text-1" role="status">
          Outlook-Termine fehlen: {outlookNeuVerbinden}{' '}
          <a href="/nachrichten" className="font-medium text-s112-teal underline">Unter Nachrichten neu verbinden</a>
        </div>
      )}
      {/* ── Seitentitel ── */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold text-s112-text">CRM Übersicht</h1>
          <div className="flex items-center gap-3 mt-1 flex-wrap">
            <span className="text-sm text-s112-muted">Kalenderansicht</span>
            {heuteCount > 0 && (
              <span className="text-xs font-medium bg-s112-teal/10 text-s112-blue-700 rounded-full px-2 py-0.5">
                {heuteCount} heute
              </span>
            )}
            {ueberfaelligCount > 0 && (
              <span className="text-xs font-medium bg-s112-err-bg text-s112-err-fg rounded-full px-2 py-0.5">
                {ueberfaelligCount} überfällig
              </span>
            )}
          </div>
        </div>

        {/* View-Toggle */}
        <div className="flex items-center border border-s112-border rounded-lg overflow-hidden text-sm">
          {([
            { v: 'zeitachse', label: 'Woche'  },
            { v: 'monat',     label: 'Monat'  },
            { v: 'jahr',      label: 'Jahr'   },
          ] as { v: ViewMode; label: string }[]).map(({ v, label }) => (
            <button key={v} onClick={() => setView(v)}
              className={`px-3 py-1.5 font-medium transition-colors border-r last:border-r-0 border-s112-border
                ${view === v
                  ? 'bg-s112-teal text-s112-yellow'
                  : 'bg-white text-s112-text-2 hover:bg-s112-bg'}`}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Navigation ── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1">
          <button onClick={() => navigate(-1)}
            className="p-1.5 rounded-lg border border-s112-border hover:bg-s112-bg transition-colors text-s112-text-2"
            aria-label="Zurück">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <span className="text-sm font-semibold text-s112-text min-w-[200px] text-center px-2">
            {periodLabel}
          </span>
          <button onClick={() => navigate(1)}
            className="p-1.5 rounded-lg border border-s112-border hover:bg-s112-bg transition-colors text-s112-text-2"
            aria-label="Vor">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>

        <button onClick={goToday}
          className="text-xs font-medium text-s112-blue-700 border border-s112-teal/30 rounded-full px-3 py-1 hover:bg-s112-teal hover:text-s112-yellow transition-colors">
          Heute
        </button>
      </div>

      {/* ── Kalender ── */}
      {view === 'zeitachse' && <ZeitachseView eintraege={alleEintraege} current={current} heute={heute} userProfiles={userProfiles} mitglieder={mitglieder} userId={userId} oeffneId={oeffneId} outlook={outlook} />}
      {view === 'monat'     && <MonatView     eintraege={alleEintraege} current={current} heute={heute} />}
      {view === 'jahr'      && <JahrView      eintraege={alleEintraege} current={current} heute={heute} />}

      {/* ── Legende ── */}
      <div className="flex items-center gap-x-4 gap-y-1.5 pt-1 flex-wrap">
        <span className="text-[11px] font-medium text-s112-tertiary uppercase tracking-wide">Legende</span>
        {[
          { farbe: 'bg-s112-err-bg border-s112-err/30 text-s112-err-fg',     label: 'Überfällig' },
          { farbe: 'bg-[#F2F3F5] border-s112-line-str text-s112-text-1',  label: 'Pipeline'   },
          { farbe: 'bg-s112-ok-bg border-s112-ok/30',              label: 'Anruf'      },
          { farbe: 'bg-[#F2F3F5] border-s112-line-str',                label: 'Besprechung'},
          { farbe: 'bg-s112-warn-bg border-s112-warn/30',            label: 'E-Mail'     },
          { farbe: 'bg-[#F2F3F5] border-s112-line-str',            label: 'Verkostung' },
          { farbe: 'bg-s112-blue-50 border-s112-blue-100',                label: 'Besuch'     },
          { farbe: 'bg-s112-blue-50 border-s112-blue-100',            label: 'Messe'      },
          { farbe: 'bg-s112-warn-bg border-s112-warn/30',            label: 'Angebot'    },
          { farbe: 'bg-s112-bg border-s112-line',                label: 'Notiz'      },
          { farbe: 'bg-s112-blue-50 border-s112-blue-100',                  label: 'Outlook'    },
        ].map(({ farbe, label }) => (
          <div key={label} className="flex items-center gap-1">
            <div className={`w-3 h-3 rounded-sm border ${farbe}`} />
            <span className="text-[11px] text-s112-text-2">{label}</span>
          </div>
        ))}
      </div>

      {alleEintraege.length === 0 && (
        <div className="text-center py-12 text-s112-muted text-sm">
          Noch keine Einträge mit Datum vorhanden.
        </div>
      )}
    </div>
  )
}
