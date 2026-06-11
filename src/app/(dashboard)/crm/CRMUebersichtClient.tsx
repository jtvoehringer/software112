'use client'

import { useState, useMemo, useRef, useEffect, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { createAktivitaet, moveAktivitaet, updateAktivitaet } from './actions'
import { AKTIVITAET_ARTEN } from '@/lib/crm/types'
import Link from 'next/link'

// ── Typeahead-Suche ───────────────────────────────────────────────────────────
interface SucheItem { id: string; label: string; sub?: string }
function KundenSuche({ items, value, onChange, placeholder }: {
  items: SucheItem[]; value: string; onChange: (v: string) => void; placeholder?: string
}) {
  const [query, setQuery] = useState('')
  const [open,  setOpen]  = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const selected = items.find(i => i.id === value)
  const treffer = query.length < 1
    ? items.slice(0, 50)
    : items.filter(i => (i.label + ' ' + (i.sub ?? '')).toLowerCase().includes(query.toLowerCase())).slice(0, 50)
  useEffect(() => {
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [])
  return (
    <div ref={ref} className="relative">
      {selected ? (
        <div className="flex items-center gap-1 border border-s112-border rounded-lg px-2 py-1.5 bg-s112-bg">
          <span className="text-sm flex-1 truncate">{selected.label}</span>
          <button type="button" onClick={() => { onChange(''); setQuery('') }}
            className="text-gray-400 hover:text-gray-600 flex-shrink-0 leading-none">×</button>
        </div>
      ) : (
        <>
          <input type="text" value={query}
            onChange={e => { setQuery(e.target.value); setOpen(true) }}
            onFocus={() => setOpen(true)}
            placeholder={placeholder ?? 'Suchen…'}
            className="border border-s112-border rounded-lg px-2 py-1.5 text-sm focus:outline-none w-full" />
          {open && treffer.length > 0 && (
            <ul className="absolute z-50 mt-1 w-full bg-white border border-s112-border rounded-lg shadow-lg max-h-48 overflow-y-auto">
              {treffer.map(i => (
                <li key={i.id}
                  onMouseDown={e => { e.preventDefault(); onChange(i.id); setQuery(''); setOpen(false) }}
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

// ── Typen ─────────────────────────────────────────────────────────────────────

export type KalenderEintrag = {
  ist_privat?: boolean | null
  erstellt_von?: string | null
  id: string
  datum: string          // YYYY-MM-DD
  titel: string
  typ: 'aktivitaet' | 'pipeline'
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
  anruf:      'bg-green-50 text-green-700 border-green-100',
  email:      'bg-orange-50 text-orange-700 border-orange-100',
  verkostung: 'bg-purple-50 text-purple-700 border-purple-100',
  besuch:     'bg-blue-50 text-blue-700 border-blue-100',
  messe:      'bg-indigo-50 text-indigo-700 border-indigo-100',
  angebot:    'bg-yellow-50 text-yellow-800 border-yellow-100',
  notiz:      'bg-gray-50 text-gray-600 border-gray-100',
  urlaub:     'bg-amber-50 text-amber-700 border-amber-200',
  abwesenheit:'bg-slate-50 text-slate-600 border-slate-200',
}

function chipFarbe(e: KalenderEintrag): string {
  if (e.erledigt) return 'bg-gray-50 text-gray-400 border-gray-100 opacity-60'
  if (e.ueberfaellig) return 'bg-red-500 text-white border-red-600'
  if (e.typ === 'pipeline') return 'bg-teal-50 text-teal-700 border-teal-100'
  return ART_FARBEN[e.art ?? ''] ?? 'bg-gray-50 text-gray-600 border-gray-100'
}

// ── Eintrag-Chip ──────────────────────────────────────────────────────────────

function fmtT(t: string | null | undefined): string | null {
  if (!t) return null
  return t.slice(0, 5)  // "14:30:00" -> "14:30"
}

function EintragChip({ e, compact = false, onViewAkt }: { e: KalenderEintrag; compact?: boolean; onViewAkt?: (e: KalenderEintrag) => void }) {
  const farbe = chipFarbe(e)
  const overdueInline = e.ueberfaellig
    ? { backgroundColor: '#ef4444', color: '#ffffff', borderColor: '#dc2626' }
    : undefined
  const von = !e.ganztags ? fmtT(e.uhrzeit_von) : null
  const bis = !e.ganztags ? fmtT(e.uhrzeit_bis) : null
  const zeitLabel = von ? (bis ? `${von}–${bis}` : von) : null

  return (
    <div onClick={() => onViewAkt?.(e)} title={`${e.titel}${e.kontaktName ? ` – ${e.kontaktName}` : ''}${e.firmaName ? ` (${e.firmaName})` : ''}`} className="cursor-pointer">
      <div
        className={`border rounded truncate leading-snug transition-opacity hover:opacity-75
          ${compact ? 'text-[9px] px-1 py-px' : 'text-xs px-2 py-1'}
          ${farbe}`}
        style={overdueInline}>
        <span className="mr-0.5">{e.artIcon}</span>
        {zeitLabel && !compact && (
          <span className="font-semibold mr-1 tabular-nums">{zeitLabel}</span>
        )}
        {zeitLabel && compact && (
          <span className="font-semibold mr-0.5 tabular-nums">{von}</span>
        )}
        {e.erledigt && <span className="text-green-500 mr-0.5 flex-shrink-0">✓</span>}
        <span className="font-medium">{e.titel}</span>
        {!compact && (e.kontaktName || e.firmaName) && (
          <span className="block text-[9px] opacity-60 truncate mt-px">
            {e.kontaktName ?? e.firmaName}
          </span>
        )}
      </div>
    </div>
  )
}

// ── Wochen-Ansicht ────────────────────────────────────────────────────────────

function WochenView({ eintraege, current, heute }: { eintraege: KalenderEintrag[]; current: Date; heute: string }) {
  const monday = useMemo(() => startOfWeek(current), [current.toDateString()])
  const days   = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(monday, i)), [monday.getTime()])

  const byDay = useMemo(() => {
    const map: Record<string, KalenderEintrag[]> = {}
    days.forEach(d => { map[toDateStr(d)] = [] })
    eintraege.forEach(e => { if (map[e.datum]) map[e.datum].push(e) })
    return map
  }, [eintraege, monday.getTime()])

  return (
    <div className="border border-s112-border rounded-xl overflow-hidden">
      <div className="grid grid-cols-7 border-b border-s112-border">
        {days.map((d, i) => {
          const isToday = toDateStr(d) === heute
          return (
            <div key={i} className={`px-2 py-3 text-center border-r last:border-r-0 border-s112-border
              ${isToday ? 'bg-s112-teal text-white' : 'bg-s112-bg'}`}>
              <div className={`text-xs font-medium ${isToday ? 'text-white/80' : 'text-gray-500'}`}>
                {WOCHENTAGE[i]}
              </div>
              <div className={`text-xl font-bold leading-tight ${isToday ? 'text-white' : 'text-gray-800'}`}>
                {d.getDate()}
              </div>
              <div className={`text-[10px] ${isToday ? 'text-white/70' : 'text-gray-400'}`}>
                {MONATE_KURZ[d.getMonth()]}
              </div>
            </div>
          )
        })}
      </div>

      <div className="grid grid-cols-7 divide-x divide-s112-border bg-white">
        {days.map((d, i) => {
          const dateStr = toDateStr(d)
          const items = byDay[dateStr] ?? []
          const isToday = dateStr === heute
          return (
            <div key={i} className={`min-h-[140px] p-2 space-y-1 ${isToday ? 'ring-1 ring-inset ring-s112-teal/40' : ''}`}>
              {items.length === 0 ? (
                <div className="text-[10px] text-gray-300 text-center pt-8 select-none">–</div>
              ) : (
                items.map(e => <EintragChip key={e.id} e={e} />)
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Zeitachsen-Ansicht (Outlook-Style) ────────────────────────────────────────

const HOUR_H = 64  // px per hour

function ZeitachseView({
  eintraege, current, heute, kontakte, firmen,
}: {
  eintraege: KalenderEintrag[]
  current: Date
  heute: string
  kontakte: { id: string; name: string }[]
  firmen: { id: string; name: string }[]
}) {
  const router    = useRouter()
  const scrollRef = useRef<HTMLDivElement>(null)
  const monday    = useMemo(() => startOfWeek(current), [current.toDateString()])
  const days      = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(monday, i)), [monday.getTime()])
  const [pending, startTransition] = useTransition()
  const [filterUser, setFilterUser] = useState<string>('alle')
  const uniqueUsers = useMemo(() => [...new Set(eintraege.map(e => e.erstellt_von).filter(Boolean))], [eintraege])

  // Aktivität-Detail anzeigen
  const [viewAkt,    setViewAkt]    = useState<KalenderEintrag | null>(null)
  const [editAktMode, setEditAktMode] = useState(false)

  // neue Aktivität
  const [newAkt,         setNewAkt]         = useState<{ datum: string; von: string; bis: string; ganztags: boolean } | null>(null)
  const [newAktKontaktId, setNewAktKontaktId] = useState('')
  const [newAktFirmaId,   setNewAktFirmaId]   = useState('')
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
  }, [monday.getTime()])

  const byDay = useMemo(() => {
    const map: Record<string, { ganztags: KalenderEintrag[]; timed: KalenderEintrag[] }> = {}
    days.forEach(d => { map[toDateStr(d)] = { ganztags: [], timed: [] } })
    eintraege.forEach(e => {
      if (!map[e.datum]) return
      // Mehrtägige Ganztags-Events → werden als Balken separat gerendert
      if (e.bis_datum && (e.ganztags !== false || !e.uhrzeit_von)) return
      if (e.ganztags !== false || !e.uhrzeit_von) map[e.datum].ganztags.push(e)
      else map[e.datum].timed.push(e)
    })
    return map
  }, [eintraege, monday.getTime()])

  // Mehrtägige Ganztags-Events sichtbar in dieser Woche
  const multiDayGanztags = useMemo(() => {
    const weekStart = toDateStr(days[0])
    const weekEnd   = toDateStr(days[6])
    return eintraege.filter(e =>
      e.bis_datum != null &&
      (e.ganztags !== false || !e.uhrzeit_von) &&
      e.datum    <= weekEnd &&
      e.bis_datum >= weekStart
    )
  }, [eintraege, monday.getTime()])

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
    startTransition(async () => {
      try {
        await createAktivitaet(fd)
        setNewAkt(null)
        setNewAktKontaktId('')
        setNewAktFirmaId('')
        router.refresh()
      } catch (err) {
        setSaveErr(err instanceof Error ? err.message : 'Fehler beim Speichern')
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

  const inputCls = 'w-full border border-s112-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40'

  return (
    <>
    {/* User-Filter */}
    {uniqueUsers.length > 1 && (
      <div className="flex items-center gap-2 mb-2 print:hidden">
        <span className="text-xs text-s112-muted">Anzeigen:</span>
        <button onClick={() => setFilterUser('alle')} className={`text-xs px-2 py-1 rounded-lg ${filterUser==='alle'?'bg-s112-teal text-s112-yellow':'border border-s112-border text-gray-600 hover:bg-s112-bg'}`}>Alle</button>
        {uniqueUsers.map(uid => (
          <button key={uid!} onClick={() => setFilterUser(uid!)} className={`text-xs px-2 py-1 rounded-lg ${filterUser===uid?'bg-s112-teal text-s112-yellow':'border border-s112-border text-gray-600 hover:bg-s112-bg'}`}>
            {uid!.slice(0,8)}
          </button>
        ))}
      </div>
    )}
    <div className="border border-s112-border rounded-xl overflow-hidden">

      {/* ── Sticky header: day names + Ganztags-Zeile ── */}
      <div className="sticky top-0 z-20 bg-white shadow-sm">
        <div className="grid border-b border-s112-border" style={{ gridTemplateColumns: '52px repeat(7, 1fr)' }}>
          <div className="bg-s112-bg border-r border-s112-border" />
          {days.map((d, i) => {
            const isToday = toDateStr(d) === heute
            return (
              <div key={i} className={`px-2 py-2 text-center border-l border-s112-border
                ${isToday ? 'bg-s112-teal text-white' : 'bg-s112-bg'}`}>
                <div className={`text-[10px] font-medium ${isToday ? 'text-white/80' : 'text-gray-500'}`}>
                  {WOCHENTAGE[i]}
                </div>
                <div className={`text-lg font-bold leading-tight ${isToday ? 'text-white' : 'text-gray-800'}`}>
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
                <span className="text-[9px] text-gray-400 leading-none">urlaub</span>
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
                    onClick={() => setViewAkt(e)}
                    title={`${isUrlaub ? 'Urlaub' : 'Abwesenheit'}${e.titel ? `: ${e.titel}` : ''}`}
                    className="absolute flex items-center gap-1 px-2 overflow-hidden cursor-pointer hover:opacity-80 z-20 text-white text-[9px] font-semibold select-none"
                    style={{
                      top:             `${2 + barIdx * barH}px`,
                      height:          `${barH - 2}px`,
                      left:            `calc(52px + ${startIdx} * ${colW}${startsEarly ? '' : ' + 2px'})`,
                      width:           `calc(${spanDays} * ${colW}${endsLate ? '' : ' - 4px'})`,
                      backgroundColor: isUrlaub ? '#f59e0b' : '#94a3b8',
                      borderRadius:    br,
                    }}
                  >
                    {startsEarly && <span className="mr-0.5 opacity-70 flex-shrink-0">◀</span>}
                    <span className="flex-shrink-0">{isUrlaub ? '🏖' : '🚫'}</span>
                    <span className="truncate">{e.titel ?? (isUrlaub ? 'Urlaub' : 'Abwesenheit')}</span>
                    {endsLate && <span className="ml-0.5 opacity-70 flex-shrink-0">▶</span>}
                  </div>
                )
              })}
            </div>
          )
        })()}

        {/* ── Ganztags-Zeile (eintägige Events) ── */}
        <div className="grid border-b border-s112-border/60" style={{ gridTemplateColumns: '52px repeat(7, 1fr)' }}>
          <div className="bg-s112-bg border-r border-s112-border flex items-center justify-end px-1">
            <span className="text-[9px] text-gray-400 leading-none">ganztags</span>
          </div>
          {days.map((d, i) => {
            const dateStr  = toDateStr(d)
            const items    = byDay[dateStr]?.ganztags ?? []
            const isGDrop  = dropTarget === dateStr && dragInfo?.ganztags
            return (
              <div key={i}
                className={`border-l border-s112-border/60 p-1 space-y-0.5 min-h-[28px] cursor-pointer transition-colors ${isGDrop ? 'bg-s112-teal/10' : 'hover:bg-s112-bg/60'}`}
                onClick={(e) => handleGanztagesClick(e, dateStr)}
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
                      <EintragChip e={e} compact onViewAkt={setViewAkt} />
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
                  <span className="text-[10px] text-gray-400 tabular-nums mt-1">
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
              const isDrop  = dropTarget === dateStr && !!dragInfo
              return (
                <div key={i}
                  className={`relative border-l border-s112-border/30 cursor-crosshair transition-colors ${isDrop ? 'bg-s112-teal/5' : ''}`}
                  onClick={(e) => handleSlotClick(e, dateStr)}
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
                    return (
                      <Link key={e.id} href={e.href}
                        draggable={isAkt}
                        onDragStart={isAkt ? (ev) => {
                          ev.dataTransfer.setData('text/plain', aktId)
                          ev.dataTransfer.effectAllowed = 'move'
                          setDragInfo({ id: aktId, duration: dur })
                        } : undefined}
                        onDragEnd={() => { setDragInfo(null); setDropTarget(null) }}
                        onClick={e => { if (dragInfo) e.preventDefault() }}
                        className={`absolute left-1 right-1 overflow-hidden rounded border z-10 transition-opacity
                          ${farbe}
                          ${isAkt ? 'cursor-grab active:cursor-grabbing' : ''}
                          ${beingDragged ? 'opacity-30' : 'hover:opacity-80'}`}
                        style={{ top: `${top}px`, height: `${h}px`, minHeight: `${HOUR_H / 2}px` }}>
                        <div className="px-1.5 py-0.5">
                          <div className="text-[10px] font-bold tabular-nums leading-tight">
                            {fmtT(e.uhrzeit_von)}{e.uhrzeit_bis ? `–${fmtT(e.uhrzeit_bis)}` : ''}
                          </div>
                          <div className={`text-[10px] font-medium truncate leading-tight`}>
                            {e.artIcon} {e.titel}
                          </div>
                          {h > 50 && (e.kontaktName || e.firmaName) && (
                            <div className="text-[9px] opacity-60 truncate">
                              {e.kontaktName ?? e.firmaName}
                            </div>
                          )}
                        </div>
                      </Link>
                    )
                  })}
                  {/* Current time indicator */}
                  {isToday && (
                    <div className="absolute left-0 right-0 z-20 pointer-events-none"
                      style={{ top: `${nowTop}px` }}>
                      <div className="relative border-t-2 border-red-500">
                        <div className="absolute -left-1.5 -top-[5px] w-3 h-3 rounded-full bg-red-500" />
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
        onClick={() => { setViewAkt(null); setEditAktMode(false) }}>
        <div className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-md mx-4"
          onClick={e => e.stopPropagation()}>

          {!editAktMode ? (
            <>
              {/* ── Detail-Ansicht ── */}
              <div className="flex items-start justify-between mb-3">
                <div>
                  <span className="text-lg mr-2">{viewAkt.artIcon}</span>
                  <span className="font-bold text-gray-900">{viewAkt.titel}</span>
                </div>
                <button onClick={() => { setViewAkt(null); setEditAktMode(false) }} className="text-s112-muted hover:text-gray-700 text-lg">✕</button>
              </div>
              <div className="space-y-1.5 text-sm text-gray-600 mb-4">
                {viewAkt.bis_datum && viewAkt.bis_datum !== viewAkt.datum ? (
                  <p><span className="font-medium text-gray-700">Zeitraum:</span>{' '}
                    {new Date(viewAkt.datum + 'T12:00:00').toLocaleDateString('de-AT', { day: 'numeric', month: 'long' })}
                    {' – '}
                    {new Date(viewAkt.bis_datum + 'T12:00:00').toLocaleDateString('de-AT', { day: 'numeric', month: 'long', year: 'numeric' })}
                  </p>
                ) : (
                  <p><span className="font-medium text-gray-700">Datum:</span> {new Date(viewAkt.datum + 'T12:00:00').toLocaleDateString('de-AT', { weekday: 'long', day: 'numeric', month: 'long' })}</p>
                )}
                {viewAkt.kontaktName && <p><span className="font-medium text-gray-700">Kontakt:</span> {viewAkt.kontaktName}</p>}
                {viewAkt.firmaName   && <p><span className="font-medium text-gray-700">Firma:</span> {viewAkt.firmaName}</p>}
                {viewAkt.ist_privat  && <p className="text-gray-400 text-xs">🔒 Privater Termin</p>}
              </div>
              <div className="flex flex-wrap gap-2">
                {viewAkt.typ === 'aktivitaet' && (
                  <button onClick={() => setEditAktMode(true)}
                    className="bg-s112-teal text-white px-4 py-1.5 rounded-lg text-sm font-medium hover:bg-opacity-90">
                    ✏ Bearbeiten
                  </button>
                )}
                {viewAkt.kontaktName && (
                  <a href={viewAkt.href} className="border border-s112-teal text-s112-teal px-4 py-1.5 rounded-lg text-sm font-medium hover:bg-s112-teal/10">
                    Zum Kontakt →
                  </a>
                )}
                {!viewAkt.kontaktName && viewAkt.firmaName && (
                  <a href={viewAkt.href} className="border border-s112-teal text-s112-teal px-4 py-1.5 rounded-lg text-sm font-medium hover:bg-s112-teal/10">
                    Zur Firma →
                  </a>
                )}
                <button onClick={() => { setViewAkt(null); setEditAktMode(false) }}
                  className="text-sm px-4 py-1.5 rounded-lg border border-s112-border text-gray-600 hover:bg-s112-bg">
                  Schließen
                </button>
              </div>
            </>
          ) : (
            <>
              {/* ── Bearbeiten-Formular ── */}
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-bold text-gray-900 text-base">Aktivität bearbeiten</h3>
                <button onClick={() => setEditAktMode(false)} className="text-s112-muted hover:text-gray-700 text-lg">✕</button>
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
                    setSaveErr(err instanceof Error ? err.message : 'Fehler beim Speichern')
                  }
                })
              }} className="space-y-3">
                <input type="hidden" name="erledigt" value={viewAkt.erledigt ? 'true' : 'false'} />
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Art</label>
                  <select name="art" defaultValue={viewAkt.art ?? 'notiz'} className={inputCls}>
                    {AKTIVITAET_ARTEN.filter(a => !('nurAnzeige' in a)).map(a => (
                      <option key={a.value} value={a.value}>{a.icon} {a.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Betreff</label>
                  <input name="betreff" defaultValue={viewAkt.titel} required className={inputCls} />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Von</label>
                    <input type="date" name="datum" defaultValue={viewAkt.datum} required className={inputCls} />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Bis (mehrtägig)</label>
                    <input type="date" name="bis_datum" defaultValue={viewAkt.bis_datum ?? ''} className={inputCls} />
                  </div>
                </div>
                {saveErr && <p className="text-xs text-red-600">{saveErr}</p>}
                <div className="flex gap-2 pt-1">
                  <button type="submit" disabled={pending}
                    className="bg-s112-teal text-white px-4 py-1.5 rounded-lg text-sm font-semibold hover:bg-opacity-90 disabled:opacity-40">
                    {pending ? 'Speichern…' : 'Speichern'}
                  </button>
                  <button type="button" onClick={() => setEditAktMode(false)}
                    className="text-sm px-4 py-1.5 rounded-lg border border-s112-border text-gray-600 hover:bg-s112-bg">
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
        <div className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-md mx-4"
          onClick={e => e.stopPropagation()}>
          <h3 className="text-base font-bold text-gray-900 mb-1">{newAkt?.ganztags ? '📅 Ganztags-Aktivität' : 'Neue Aktivität'}</h3>
          <p className="text-xs text-s112-muted mb-4">
            {new Date(newAkt.datum + 'T12:00:00').toLocaleDateString('de-AT', { weekday: 'long', day: 'numeric', month: 'long' })}
          </p>
          <form onSubmit={handleSaveAkt} className="space-y-3">
            <input type="hidden" name="datum" value={newAkt.datum} />

            {/* Art + ggf. Zeit */}
            <div className={`gap-2 ${newAkt?.ganztags ? '' : 'grid grid-cols-2'}`}>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Art</label>
                <select name="art" defaultValue="notiz" className={inputCls}>
                  {AKTIVITAET_ARTEN.filter(a => !('nurAnzeige' in a)).map(a => (
                    <option key={a.value} value={a.value}>{a.icon} {a.label}</option>
                  ))}
                </select>
              </div>
              {!newAkt?.ganztags && (
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Zeit</label>
                  <div className="flex items-center gap-1">
                    <input type="time" name="uhrzeit_von" step="1800" defaultValue={newAkt.von}
                      className="border border-s112-border rounded-lg px-2 py-1.5 text-sm focus:outline-none w-full" />
                    <span className="text-xs text-gray-400 flex-shrink-0">–</span>
                    <input type="time" name="uhrzeit_bis" step="1800" defaultValue={newAkt.bis}
                      className="border border-s112-border rounded-lg px-2 py-1.5 text-sm focus:outline-none w-full" />
                  </div>
                </div>
              )}
            </div>

            {/* Betreff */}
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Betreff *</label>
              <input name="betreff" required autoFocus placeholder="z.B. Weinverkostung, Rückruf …"
                className={inputCls} />
            </div>

            {/* Kontakt / Firma */}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Kontakt</label>
                <KundenSuche
                  items={kontakte.map(k => ({ id: k.id, label: k.name }))}
                  value={newAktKontaktId}
                  onChange={setNewAktKontaktId}
                  placeholder="Name suchen…"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Firma</label>
                <KundenSuche
                  items={firmen.map(f => ({ id: f.id, label: f.name }))}
                  value={newAktFirmaId}
                  onChange={setNewAktFirmaId}
                  placeholder="Firmenname suchen…"
                />
              </div>
            </div>

            {/* Bis-Datum (für Mehrtagestermine) */}
            {newAkt?.ganztags && (
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Bis-Datum (leer = eintägig)</label>
                <input type="date" name="bis_datum" min={newAkt.datum}
                  className={inputCls} />
              </div>
            )}

            {/* Bericht */}
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Bericht</label>
              <textarea name="beschreibung" rows={2} placeholder="Optional …"
                className={inputCls + ' resize-none'} />
            </div>

            {/* Privat */}
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" name="ist_privat" value="true"
                className="accent-s112-teal" />
              <span className="text-xs text-gray-600">🔒 Privater Termin (nur für mich sichtbar)</span>
            </label>

            {saveErr && (
              <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{saveErr}</p>
            )}

            <div className="flex gap-2 pt-1">
              <button type="submit" disabled={pending}
                className="bg-s112-teal text-white px-4 py-1.5 rounded-lg text-sm font-medium hover:bg-opacity-90 disabled:opacity-40">
                {pending ? 'Speichern…' : 'Speichern'}
              </button>
              <button type="button" onClick={() => { setNewAkt(null); setNewAktKontaktId(''); setNewAktFirmaId('') }}
                className="text-sm px-4 py-1.5 rounded-lg border border-s112-border text-gray-600 hover:bg-s112-bg">
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

// ── Hilfsfunktion: Privat-Check ──────────────────────────────────────────────
function isPrivatFremder(e: KalenderEintrag, userId?: string) {
  return e.ist_privat && e.erstellt_von && e.erstellt_von !== userId
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
          <div key={d} className="text-center text-xs font-medium text-gray-500 py-1">{d}</div>
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
                      ${isToday ? 'bg-s112-teal text-white' : isThisMonth ? 'text-gray-700' : 'text-gray-300'}`}
                    style={!isToday && hasOverdue ? { backgroundColor: '#ef4444', color: '#fff' } : undefined}>
                    {day.getDate()}
                  </div>
                  <div className="space-y-0.5">
                    {items.slice(0, 3).map(e => (
                      <EintragChip key={e.id} e={e} compact />
                    ))}
                    {extra > 0 && (
                      <div className="text-[9px] text-gray-400 pl-0.5">+{extra} weitere</div>
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
      <div className="text-xs font-semibold text-gray-700 mb-2 text-center">{MONATE_KURZ[monthIdx]}</div>
      <div className="grid grid-cols-7 mb-0.5">
        {WOCHENTAGE_KURZ.map((d, i) => (
          <div key={i} className="text-center text-[8px] text-gray-400">{d}</div>
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
                <div className={`w-[18px] h-[18px] flex items-center justify-center rounded-full text-[9px] font-medium
                  ${!isThisMonth ? 'opacity-20' : ''}
                  ${isToday
                    ? 'bg-s112-teal text-white'
                    : hasItems
                      ? 'bg-s112-teal/10 text-s112-teal font-semibold'
                      : 'text-gray-400'}`}
                  style={!isToday && hasOverdue ? { backgroundColor: '#ef4444', color: '#fff' } : undefined}>
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
  kontakte: { id: string; name: string }[]
  firmen: { id: string; name: string }[]
}

export default function CRMUebersichtClient({ eintraege, heute, kontakte, firmen }: Props) {
  const [view, setView]       = useState<ViewMode>('zeitachse')
  const [current, setCurrent] = useState<Date>(() => new Date())

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

  const periodLabel = useMemo(() => {
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
  }, [view, current.toDateString()])

  const ueberfaelligCount = useMemo(
    () => eintraege.filter(e => e.ueberfaellig).length,
    [eintraege],
  )
  const heuteCount = useMemo(
    () => eintraege.filter(e => e.datum === heute).length,
    [eintraege, heute],
  )

  return (
    <div className="space-y-4">
      {/* ── Seitentitel ── */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">CRM Übersicht</h1>
          <div className="flex items-center gap-3 mt-1 flex-wrap">
            <span className="text-sm text-s112-muted">Kalenderansicht</span>
            {heuteCount > 0 && (
              <span className="text-xs font-medium bg-s112-teal/10 text-s112-teal rounded-full px-2 py-0.5">
                {heuteCount} heute
              </span>
            )}
            {ueberfaelligCount > 0 && (
              <span className="text-xs font-medium bg-red-100 text-red-700 rounded-full px-2 py-0.5">
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
                  ? 'bg-s112-teal text-white'
                  : 'bg-white text-gray-600 hover:bg-s112-bg'}`}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Navigation ── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1">
          <button onClick={() => navigate(-1)}
            className="p-1.5 rounded-lg border border-s112-border hover:bg-s112-bg transition-colors text-gray-600"
            aria-label="Zurück">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <span className="text-sm font-semibold text-gray-800 min-w-[200px] text-center px-2">
            {periodLabel}
          </span>
          <button onClick={() => navigate(1)}
            className="p-1.5 rounded-lg border border-s112-border hover:bg-s112-bg transition-colors text-gray-600"
            aria-label="Vor">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>

        <button onClick={goToday}
          className="text-xs font-medium text-s112-teal border border-s112-teal/30 rounded-full px-3 py-1 hover:bg-s112-teal hover:text-white transition-colors">
          Heute
        </button>
      </div>

      {/* ── Kalender ── */}
      {view === 'zeitachse' && <ZeitachseView eintraege={eintraege} current={current} heute={heute} kontakte={kontakte} firmen={firmen} />}
      {view === 'monat'     && <MonatView     eintraege={eintraege} current={current} heute={heute} />}
      {view === 'jahr'      && <JahrView      eintraege={eintraege} current={current} heute={heute} />}

      {/* ── Legende ── */}
      <div className="flex items-center gap-x-4 gap-y-1.5 pt-1 flex-wrap">
        <span className="text-[11px] font-medium text-gray-400 uppercase tracking-wide">Legende</span>
        {[
          { farbe: 'bg-red-50 border-red-200 text-red-700',     label: 'Überfällig' },
          { farbe: 'bg-teal-50 border-teal-100 text-teal-700',  label: 'Pipeline'   },
          { farbe: 'bg-green-50 border-green-100',              label: 'Anruf'      },
          { farbe: 'bg-orange-50 border-orange-100',            label: 'E-Mail'     },
          { farbe: 'bg-purple-50 border-purple-100',            label: 'Verkostung' },
          { farbe: 'bg-blue-50 border-blue-100',                label: 'Besuch'     },
          { farbe: 'bg-indigo-50 border-indigo-100',            label: 'Messe'      },
          { farbe: 'bg-yellow-50 border-yellow-100',            label: 'Angebot'    },
          { farbe: 'bg-gray-50 border-gray-100',                label: 'Notiz'      },
        ].map(({ farbe, label }) => (
          <div key={label} className="flex items-center gap-1">
            <div className={`w-3 h-3 rounded border ${farbe}`} />
            <span className="text-[11px] text-gray-500">{label}</span>
          </div>
        ))}
      </div>

      {eintraege.length === 0 && (
        <div className="text-center py-12 text-s112-muted text-sm">
          Noch keine Einträge mit Datum vorhanden.
        </div>
      )}
    </div>
  )
}
