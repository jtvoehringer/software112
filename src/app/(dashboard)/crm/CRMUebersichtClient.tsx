'use client'

import { useState, useMemo, useRef, useEffect } from 'react'
import Link from 'next/link'

// ── Typen ─────────────────────────────────────────────────────────────────────

export type KalenderEintrag = {
  id: string
  datum: string          // YYYY-MM-DD
  titel: string
  typ: 'aktivitaet' | 'pipeline'
  art?: string
  artIcon?: string
  ganztags?: boolean
  uhrzeit_von?: string | null   // "HH:MM:SS"
  uhrzeit_bis?: string | null
  ueberfaellig: boolean
  href: string
  kontaktName?: string | null
  firmaName?: string | null
  stufe?: string
}

type ViewMode = 'woche' | 'monat' | 'jahr' | 'zeitachse'

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
}

function chipFarbe(e: KalenderEintrag): string {
  if (e.ueberfaellig) return 'bg-red-500 text-white border-red-600'
  if (e.typ === 'pipeline') return 'bg-teal-50 text-teal-700 border-teal-100'
  return ART_FARBEN[e.art ?? ''] ?? 'bg-gray-50 text-gray-600 border-gray-100'
}

// ── Eintrag-Chip ──────────────────────────────────────────────────────────────

function fmtT(t: string | null | undefined): string | null {
  if (!t) return null
  return t.slice(0, 5)  // "14:30:00" -> "14:30"
}

function EintragChip({ e, compact = false }: { e: KalenderEintrag; compact?: boolean }) {
  const farbe = chipFarbe(e)
  const overdueInline = e.ueberfaellig
    ? { backgroundColor: '#ef4444', color: '#ffffff', borderColor: '#dc2626' }
    : undefined
  const von = !e.ganztags ? fmtT(e.uhrzeit_von) : null
  const bis = !e.ganztags ? fmtT(e.uhrzeit_bis) : null
  const zeitLabel = von ? (bis ? `${von}–${bis}` : von) : null

  return (
    <Link href={e.href} title={`${e.titel}${e.kontaktName ? ` – ${e.kontaktName}` : ''}${e.firmaName ? ` (${e.firmaName})` : ''}`}>
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
        <span className="font-medium">{e.titel}</span>
        {!compact && (e.kontaktName || e.firmaName) && (
          <span className="block text-[9px] opacity-60 truncate mt-px">
            {e.kontaktName ?? e.firmaName}
          </span>
        )}
      </div>
    </Link>
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

function ZeitachseView({ eintraege, current, heute }: { eintraege: KalenderEintrag[]; current: Date; heute: string }) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const monday    = useMemo(() => startOfWeek(current), [current.toDateString()])
  const days      = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(monday, i)), [monday.getTime()])

  // Scroll to ~1h before current time on mount / week-change
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
      if (e.ganztags !== false || !e.uhrzeit_von) map[e.datum].ganztags.push(e)
      else map[e.datum].timed.push(e)
    })
    return map
  }, [eintraege, monday.getTime()])

  const now    = new Date()
  const nowTop = (now.getHours() * 60 + now.getMinutes()) / 60 * HOUR_H

  function vonTop(t: string): number {
    const [h, m] = t.split(':').map(Number)
    return h * HOUR_H + (m / 60) * HOUR_H
  }

  function blockHeight(von: string, bis: string | null | undefined): number {
    if (!bis) return HOUR_H / 2          // 30 min default when no end time
    const [h1, m1] = von.split(':').map(Number)
    const [h2, m2] = bis.split(':').map(Number)
    const mins = (h2 * 60 + m2) - (h1 * 60 + m1)
    return Math.max(HOUR_H / 2, (mins / 60) * HOUR_H)
  }

  return (
    <div className="border border-s112-border rounded-xl overflow-hidden">

      {/* ── Sticky header: day names + Ganztags-Zeile ── */}
      <div className="sticky top-0 z-20 bg-white shadow-sm">
        {/* Day names */}
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

        {/* Ganztags row */}
        <div className="grid border-b border-s112-border/60" style={{ gridTemplateColumns: '52px repeat(7, 1fr)' }}>
          <div className="bg-s112-bg border-r border-s112-border flex items-center justify-end px-1">
            <span className="text-[9px] text-gray-400 leading-none">ganztags</span>
          </div>
          {days.map((d, i) => {
            const items = byDay[toDateStr(d)]?.ganztags ?? []
            return (
              <div key={i} className="border-l border-s112-border/60 p-1 space-y-0.5 min-h-[28px]">
                {items.map(e => <EintragChip key={e.id} e={e} compact />)}
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
            {/* Hour label column */}
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
            {/* Day grid lines */}
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

          {/* Events + current-time-line per day column */}
          <div className="absolute inset-0 grid"
            style={{ gridTemplateColumns: '52px repeat(7, 1fr)' }}>
            <div /> {/* spacer */}
            {days.map((d, i) => {
              const dateStr = toDateStr(d)
              const isToday = dateStr === heute
              const items   = byDay[dateStr]?.timed ?? []
              return (
                <div key={i} className="relative border-l border-s112-border/30">
                  {/* Timed events */}
                  {items.map(e => {
                    const top = vonTop(e.uhrzeit_von!)
                    const h   = blockHeight(e.uhrzeit_von!, e.uhrzeit_bis)
                    const farbe = chipFarbe(e)
                    return (
                      <Link key={e.id} href={e.href}
                        className={`absolute left-1 right-1 overflow-hidden rounded border z-10 hover:opacity-80 transition-opacity ${farbe}`}
                        style={{ top: `${top}px`, height: `${h}px`, minHeight: `${HOUR_H / 2}px` }}>
                        <div className="px-1.5 py-0.5">
                          <div className="text-[10px] font-bold tabular-nums leading-tight">
                            {fmtT(e.uhrzeit_von)}{e.uhrzeit_bis ? `–${fmtT(e.uhrzeit_bis)}` : ''}
                          </div>
                          <div className="text-[10px] font-medium truncate leading-tight">
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
}

export default function CRMUebersichtClient({ eintraege, heute }: Props) {
  const [view, setView]       = useState<ViewMode>('woche')
  const [current, setCurrent] = useState<Date>(() => new Date())

  function navigate(dir: number) {
    setCurrent(prev => {
      const d = new Date(prev)
      if (view === 'woche' || view === 'zeitachse') d.setDate(d.getDate() + dir * 7)
      else if (view === 'monat') d.setMonth(d.getMonth() + dir)
      else d.setFullYear(d.getFullYear() + dir)
      return d
    })
  }

  function goToday() { setCurrent(new Date()) }

  const periodLabel = useMemo(() => {
    if (view === 'woche' || view === 'zeitachse') {
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
            { v: 'zeitachse', label: 'Zeitachse' },
            { v: 'woche',     label: 'Woche'     },
            { v: 'monat',     label: 'Monat'     },
            { v: 'jahr',      label: 'Jahr'      },
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
      {view === 'zeitachse' && <ZeitachseView eintraege={eintraege} current={current} heute={heute} />}
      {view === 'woche'     && <WochenView    eintraege={eintraege} current={current} heute={heute} />}
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
