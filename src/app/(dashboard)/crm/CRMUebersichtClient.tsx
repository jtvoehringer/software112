'use client'

import { useState, useMemo } from 'react'
import Link from 'next/link'

// ── Typen ─────────────────────────────────────────────────────────────────────

export type KalenderEintrag = {
  id: string
  datum: string          // YYYY-MM-DD
  titel: string
  typ: 'aktivitaet' | 'pipeline'
  art?: string
  artIcon?: string
  ueberfaellig: boolean
  href: string
  kontaktName?: string | null
  firmaName?: string | null
  stufe?: string
}

type ViewMode = 'woche' | 'monat' | 'jahr'

// ── Datum-Hilfsfunktionen ─────────────────────────────────────────────────────

function addDays(date: Date, days: number): Date {
  const d = new Date(date)
  d.setDate(d.getDate() + days)
  return d
}

/** Montag der gegebenen Woche */
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
  if (e.ueberfaellig) return 'bg-red-50 text-red-700 border-red-200'
  if (e.typ === 'pipeline') return 'bg-teal-50 text-teal-700 border-teal-100'
  return ART_FARBEN[e.art ?? ''] ?? 'bg-gray-50 text-gray-600 border-gray-100'
}

// ── Eintrag-Chip ──────────────────────────────────────────────────────────────

function EintragChip({ e, compact = false }: { e: KalenderEintrag; compact?: boolean }) {
  const farbe = chipFarbe(e)
  return (
    <Link href={e.href} title={`${e.titel}${e.kontaktName ? ` – ${e.kontaktName}` : ''}${e.firmaName ? ` (${e.firmaName})` : ''}`}>
      <div className={`border rounded truncate leading-snug transition-opacity hover:opacity-75
        ${compact ? 'text-[9px] px-1 py-px' : 'text-xs px-2 py-1'}
        ${farbe}`}>
        <span className="mr-0.5">{e.artIcon}</span>
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
      {/* Tag-Kopfzeilen */}
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

      {/* Einträge pro Tag */}
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
      {/* Wochentag-Header */}
      <div className="grid grid-cols-7 mb-1">
        {WOCHENTAGE.map(d => (
          <div key={d} className="text-center text-xs font-medium text-gray-500 py-1">{d}</div>
        ))}
      </div>

      {/* Kalender-Grid */}
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

                  {/* Tageszahl */}
                  <div className={`w-6 h-6 flex items-center justify-center rounded-full text-xs font-semibold mb-1
                    ${isToday
                      ? 'bg-s112-teal text-white'
                      : hasOverdue
                        ? 'text-red-600 font-bold'
                        : isThisMonth
                          ? 'text-gray-700'
                          : 'text-gray-300'}`}>
                    {day.getDate()}
                  </div>

                  {/* Einträge (max 3) */}
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

      {/* Wochentag-Buchstaben */}
      <div className="grid grid-cols-7 mb-0.5">
        {WOCHENTAGE_KURZ.map((d, i) => (
          <div key={i} className="text-center text-[8px] text-gray-400">{d}</div>
        ))}
      </div>

      {/* Tage */}
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
                    : hasOverdue
                      ? 'bg-red-100 text-red-700 font-bold'
                      : hasItems
                        ? 'bg-s112-teal/10 text-s112-teal font-semibold'
                        : 'text-gray-400'}`}>
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
  const [view, setView]       = useState<ViewMode>('monat')
  const [current, setCurrent] = useState<Date>(() => new Date())

  function navigate(dir: number) {
    setCurrent(prev => {
      const d = new Date(prev)
      if (view === 'woche')  d.setDate(d.getDate() + dir * 7)
      else if (view === 'monat') d.setMonth(d.getMonth() + dir)
      else                   d.setFullYear(d.getFullYear() + dir)
      return d
    })
  }

  function goToday() { setCurrent(new Date()) }

  const periodLabel = useMemo(() => {
    if (view === 'woche') {
      const mon = startOfWeek(current)
      const sun = addDays(mon, 6)
      const sameMon = mon.getMonth() === sun.getMonth()
      const sameYear = mon.getFullYear() === sun.getFullYear()
      if (sameMon) return `${mon.getDate()}. – ${sun.getDate()}. ${MONATE[mon.getMonth()]} ${mon.getFullYear()}`
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
          {(['woche', 'monat', 'jahr'] as ViewMode[]).map(v => (
            <button key={v} onClick={() => setView(v)}
              className={`px-3 py-1.5 font-medium transition-colors
                ${view === v
                  ? 'bg-s112-teal text-white'
                  : 'bg-white text-gray-600 hover:bg-s112-bg'}`}>
              {v === 'woche' ? 'Woche' : v === 'monat' ? 'Monat' : 'Jahr'}
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
      {view === 'woche' && <WochenView eintraege={eintraege} current={current} heute={heute} />}
      {view === 'monat' && <MonatView eintraege={eintraege} current={current} heute={heute} />}
      {view === 'jahr'  && <JahrView  eintraege={eintraege} current={current} heute={heute} />}

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

      {/* Kein Inhalt */}
      {eintraege.length === 0 && (
        <div className="text-center py-12 text-s112-muted text-sm">
          Noch keine Einträge mit Datum vorhanden.
        </div>
      )}
    </div>
  )
}
